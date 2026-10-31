import {domainFromUrl, isExcluded} from '../shared/domain'
import {normalizeSettings} from '../shared/settings'
import type {Settings, TrackerState, Visit, WorldSnapshot} from '../shared/types'
import {migrate} from '../storage/migrations'
import {KEYS, type KeyValueStore} from '../storage/store'
import {emptyTracker, normalizeTracker} from '../storage/tracker-state'
import {VisitBatch, VisitRepo} from '../storage/visit-repo'

/**
 * If the open visit was last verified longer ago than this, we cannot know
 * what happened in between (service worker killed, laptop asleep, crash), so
 * the visit is closed at its last verified moment instead of being stretched.
 * The checkpoint alarm fires every minute, so healthy gaps are well below this.
 */
export const MAX_GAP_MS = 150_000

/** Event-driven syncs skip rewriting an unchanged session more often than this. */
const MIN_CHECKPOINT_WRITE_MS = 1_000

/**
 * Verification-poll syncs only persist a refreshed checkpoint this often. The
 * poll exists to *notice* eligibility changes quickly (see index.ts); it must
 * not turn into a storage write per tick.
 */
export const POLL_CHECKPOINT_WRITE_MS = 15_000

export interface Env {
  now(): number
  /**
   * True exactly once per browser run / extension (re)load (backed by
   * storage.session, which is wiped on both). A session persisted from before
   * that point is stale and must not be continued.
   */
  isFreshBoot?(): Promise<boolean>
  /**
   * Raw facts about the focused window / active tab / user presence. May throw.
   * `idleSeconds` is the away threshold, or null when idle detection is off.
   */
  snapshot(idleSeconds: number | null): Promise<WorldSnapshot>
}

interface Target {
  domain: string
  tabId: number
  windowId: number
}

/**
 * The tracking state machine.
 *
 * Every Chrome event (tab activated, window focus, navigation, ...) just calls
 * `sync(at)`. `sync` asks the browser what is true *now* — which window is
 * focused, which tab is active, what its URL is — and reconciles the persisted
 * session with that:
 *
 *   open session, target gone or other domain -> close it at `at`
 *   open session, same domain                 -> checkpoint it at `at`
 *   no session, eligible target               -> open one at `at`
 *
 * A target is eligible only if the window is focused, the tab is active and
 * the user is present (not idle/locked). When the user went idle, the visit
 * is ended at the moment their last input happened (now - threshold), so the
 * waiting period is not counted; a locked screen ends it immediately.
 *
 * Why reconcile instead of trusting events: Chrome does not reliably emit an
 * event when focus moves to another *application* (notably on Linux), so the
 * caller also runs a cheap verification `sync` while a visit is open.
 *
 * Because it re-derives the truth each time (and never counts a period it
 * could not verify), it is idempotent, order-insensitive and survives
 * service-worker restarts. Calls are serialised so state is never interleaved.
 */
export class TrackingEngine {
  private queue: Promise<unknown> = Promise.resolve()
  private repo: VisitRepo
  private ready: Promise<void> | null = null

  constructor(
    private store: KeyValueStore,
    private env: Env
  ) {
    this.repo = new VisitRepo(store)
  }

  /**
   * Reconcile with the browser. `at` is when the triggering event happened.
   * Resolves to whether a visit is currently being tracked.
   * `poll` marks a periodic verification (rather than a real event): it still
   * reacts immediately to any change, but throttles pure checkpoint writes.
   */
  sync(at: number = this.env.now(), opts: {poll?: boolean} = {}): Promise<boolean> {
    return this.enqueue(() => this.run(at, opts.poll === true))
  }

  /** Delete all recorded visits, then resume tracking cleanly. */
  deleteAll(): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureReady()
      await this.repo.deleteAll()
      await this.store.set({[KEYS.tracker]: emptyTracker()})
      await this.run(this.env.now(), false)
    })
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  private ensureReady(): Promise<void> {
    this.ready ??= migrate(this.store).then(() => undefined)
    return this.ready
  }

  private async run(at: number, poll: boolean): Promise<boolean> {
    await this.ensureReady()
    const closeStale = (await this.env.isFreshBoot?.()) === true

    const raw = await this.store.get([KEYS.tracker, KEYS.settings])
    const state = normalizeTracker(raw[KEYS.tracker])
    const settings = normalizeSettings(raw[KEYS.settings])
    const batch = new VisitBatch(this.repo)
    const before = JSON.stringify(state)

    let now = at
    if (state.visitId !== null) {
      const checkpoint = state.checkpoint as number
      if (closeStale || now - checkpoint > MAX_GAP_MS) {
        // Cannot vouch for the time since the checkpoint: end the visit there.
        await this.close(state, batch, settings, checkpoint)
      } else {
        // Never let a skewed clock move time backwards.
        now = Math.max(now, checkpoint)
      }
    }

    let world: WorldSnapshot | null = null
    try {
      world = await this.env.snapshot(settings.idleDetection ? Math.round(settings.idleMinutes * 60) : null)
    } catch {
      world = null
    }

    if (!world) {
      // Eligibility cannot be verified: stop the visit at the last verified moment.
      if (state.visitId !== null) await this.close(state, batch, settings, state.checkpoint as number)
      state.windowFocused = false
    } else {
      state.windowFocused = world.windowFocused
      const target = settings.trackingEnabled ? eligibleTarget(world, settings) : null

      if (state.visitId !== null && (!target || target.domain !== state.domain)) {
        // If idleness is the *only* thing making the tab ineligible, the user
        // stopped interacting `idleMinutes` ago: end the visit there, not now.
        const idleOnly =
          !target && world.idleState === 'idle' && eligibleTarget({...world, idleState: 'active'}, settings) !== null
        const end = idleOnly ? now - settings.idleMinutes * 60_000 : now
        await this.close(state, batch, settings, Math.max(end, state.sessionStart as number))
      }

      if (state.visitId !== null && target) {
        await this.checkpoint(state, batch, target, now, poll ? POLL_CHECKPOINT_WRITE_MS : MIN_CHECKPOINT_WRITE_MS)
      } else if (target) {
        await this.open(state, batch, target, Math.max(now, state.lastEndedAt))
      }
    }

    if (batch.isDirty || JSON.stringify(state) !== before) {
      await this.store.set({...(await batch.toPatch()), [KEYS.tracker]: state})
    }
    return state.trackingActive
  }

  private async open(state: TrackerState, batch: VisitBatch, t: Target, at: number) {
    const visit: Visit = {
      id: crypto.randomUUID(),
      domain: t.domain,
      startTime: at,
      endTime: null,
      durationMs: 0,
      createdAt: at
    }
    await batch.upsert(visit)
    Object.assign(state, {
      tabId: t.tabId,
      windowId: t.windowId,
      domain: t.domain,
      visitId: visit.id,
      sessionStart: at,
      checkpoint: at,
      trackingActive: true
    })
  }

  private async checkpoint(state: TrackerState, batch: VisitBatch, t: Target, at: number, minWriteMs: number) {
    const start = state.sessionStart as number
    state.tabId = t.tabId
    state.windowId = t.windowId
    if (at - (state.checkpoint as number) < minWriteMs) return
    const visit = await batch.find(state.visitId as string, start)
    if (!visit) {
      // The record vanished (e.g. data deleted): start a fresh visit instead.
      await this.open(state, batch, t, Math.max(at, state.lastEndedAt))
      return
    }
    visit.durationMs = at - start
    await batch.upsert(visit)
    state.checkpoint = at
  }

  private async close(state: TrackerState, batch: VisitBatch, settings: Settings, endAt: number) {
    const start = state.sessionStart as number
    const visit = await batch.find(state.visitId as string, start)
    const end = Math.max(endAt, start)
    if (visit) {
      if (end - start < settings.minVisitSeconds * 1000) {
        await batch.remove(visit)
      } else {
        visit.endTime = end
        visit.durationMs = end - start
        await batch.upsert(visit)
      }
    }
    Object.assign(state, {
      tabId: null,
      windowId: null,
      domain: null,
      visitId: null,
      sessionStart: null,
      checkpoint: null,
      trackingActive: false,
      lastEndedAt: Math.max(state.lastEndedAt, end)
    })
  }
}

/** The tab that may accrue time right now, or null. */
export function eligibleTarget(world: WorldSnapshot, settings: Settings): Target | null {
  if (!world.windowFocused || world.incognito || world.idleState !== 'active') return null
  if (world.tabId === null || world.windowId === null) return null
  const domain = domainFromUrl(world.url)
  if (!domain || isExcluded(domain, settings.excludedDomains)) return null
  return {domain, tabId: world.tabId, windowId: world.windowId}
}
