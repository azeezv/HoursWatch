import {effectiveEnd} from '../shared/time'
import type {Visit} from '../shared/types'
import {KEYS, type KeyValueStore} from './store'

const DAY_MS = 86_400_000

/**
 * Visits are stored in buckets keyed by the UTC date of their start time.
 * UTC (not local) bucketing means a timezone or DST change never moves
 * existing records between buckets; a local day maps to at most a few
 * neighbouring buckets, and range queries filter by real timestamps.
 */
export function bucketKey(ts: number): string {
  return KEYS.bucketPrefix + new Date(ts).toISOString().slice(0, 10)
}

/** Reads visits, optionally caching buckets (the dashboard keeps them in sync via `invalidate`). */
export class VisitRepo {
  private cache = new Map<string, Visit[]>()
  private indexCache: string[] | null = null

  constructor(
    private store: KeyValueStore,
    private useCache = false
  ) {}

  /** Drop cached data for changed storage keys. */
  invalidate(changedKeys: string[]) {
    for (const k of changedKeys) {
      if (k === KEYS.index) this.indexCache = null
      else this.cache.delete(k)
    }
  }

  clearCache() {
    this.cache.clear()
    this.indexCache = null
  }

  async index(): Promise<string[]> {
    if (this.useCache && this.indexCache) return this.indexCache
    const raw = (await this.store.get([KEYS.index]))[KEYS.index]
    const idx = Array.isArray(raw) ? (raw as string[]) : []
    if (this.useCache) this.indexCache = idx
    return idx
  }

  async readBuckets(keys: string[]): Promise<Map<string, Visit[]>> {
    const out = new Map<string, Visit[]>()
    const missing: string[] = []
    for (const k of keys) {
      const hit = this.useCache ? this.cache.get(k) : undefined
      if (hit) out.set(k, hit)
      else missing.push(k)
    }
    if (missing.length) {
      const raw = await this.store.get(missing)
      for (const k of missing) {
        const v = Array.isArray(raw[k]) ? (raw[k] as Visit[]) : []
        out.set(k, v)
        if (this.useCache) this.cache.set(k, v)
      }
    }
    return out
  }

  /** Visits overlapping [from, to), sorted by start. `to` may be Infinity. */
  async getRange(from: number, to: number): Promise<Visit[]> {
    // One extra UTC day back so long/crossing visits that started earlier are found.
    const lo = bucketKey(Math.max(0, from - DAY_MS))
    const hi = Number.isFinite(to) ? bucketKey(to - 1) : '￿'
    const keys = (await this.index()).filter((k) => k >= lo && k <= hi)
    const buckets = await this.readBuckets(keys)
    const out: Visit[] = []
    for (const key of keys) {
      for (const v of buckets.get(key) ?? []) {
        if (v.startTime < to && effectiveEnd(v) > from) out.push(v)
      }
    }
    return out.sort((a, b) => a.startTime - b.startTime)
  }

  async getAll(): Promise<Visit[]> {
    return this.getRange(0, Infinity)
  }

  /** Earliest recorded start time, or null when empty. */
  async firstStart(): Promise<number | null> {
    const keys = await this.index()
    if (!keys.length) return null
    const b = await this.readBuckets([keys[0]])
    const first = b.get(keys[0])?.[0]
    return first ? first.startTime : null
  }

  /** Remove every visit bucket, the index and the domain color map (it lists visited sites). Settings are kept. */
  async deleteAll(): Promise<void> {
    const everything = await this.store.get(null)
    const keys = Object.keys(everything).filter(
      (k) => k.startsWith(KEYS.bucketPrefix) || k === KEYS.index || k === KEYS.colors
    )
    if (keys.length) await this.store.remove(keys)
    this.clearCache()
  }
}

/**
 * A working set of bucket edits that is flushed with a single
 * `store.set`, together with the tracker state, so they persist atomically.
 */
export class VisitBatch {
  private buckets = new Map<string, Visit[]>()
  private dirty = new Set<string>()
  private indexTouched = false

  constructor(private repo: VisitRepo) {}

  private async load(key: string): Promise<Visit[]> {
    let b = this.buckets.get(key)
    if (!b) {
      b = [...((await this.repo.readBuckets([key])).get(key) ?? [])]
      this.buckets.set(key, b)
    }
    return b
  }

  async find(visitId: string, startTime: number): Promise<Visit | undefined> {
    return (await this.load(bucketKey(startTime))).find((v) => v.id === visitId)
  }

  async upsert(visit: Visit): Promise<void> {
    const key = bucketKey(visit.startTime)
    const b = await this.load(key)
    const i = b.findIndex((v) => v.id === visit.id)
    if (i >= 0) b[i] = visit
    else {
      b.push(visit)
      b.sort((a, c) => a.startTime - c.startTime)
      this.indexTouched = true
    }
    this.dirty.add(key)
  }

  async remove(visit: Visit): Promise<void> {
    const key = bucketKey(visit.startTime)
    const b = await this.load(key)
    const i = b.findIndex((v) => v.id === visit.id)
    if (i >= 0) {
      b.splice(i, 1)
      this.dirty.add(key)
    }
  }

  get isDirty(): boolean {
    return this.dirty.size > 0
  }

  async toPatch(): Promise<Record<string, unknown>> {
    const patch: Record<string, unknown> = {}
    for (const key of this.dirty) patch[key] = this.buckets.get(key)
    if (this.indexTouched) {
      const idx = new Set(await this.repo.index())
      for (const key of this.dirty) idx.add(key)
      patch[KEYS.index] = [...idx].sort()
    }
    return patch
  }
}
