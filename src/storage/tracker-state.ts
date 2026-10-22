import type {TrackerState} from '../shared/types'

export function emptyTracker(): TrackerState {
  return {
    tabId: null,
    windowId: null,
    domain: null,
    visitId: null,
    sessionStart: null,
    checkpoint: null,
    windowFocused: false,
    trackingActive: false,
    lastEndedAt: 0
  }
}

/** Validate persisted state; anything malformed becomes "no open session". */
export function normalizeTracker(raw: unknown): TrackerState {
  const base = emptyTracker()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<TrackerState>
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const open =
    typeof r.visitId === 'string' &&
    typeof r.domain === 'string' &&
    num(r.sessionStart) !== null &&
    num(r.checkpoint) !== null
  return {
    ...base,
    tabId: num(r.tabId),
    windowId: num(r.windowId),
    windowFocused: r.windowFocused === true,
    lastEndedAt: num(r.lastEndedAt) ?? 0,
    ...(open
      ? {
          domain: r.domain as string,
          visitId: r.visitId as string,
          sessionStart: r.sessionStart as number,
          checkpoint: r.checkpoint as number,
          trackingActive: true
        }
      : {})
  }
}
