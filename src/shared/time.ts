import type {Segment, Visit} from './types'

/**
 * Local-calendar helpers. Days are built with the Date constructor rather than
 * by adding 24h, so DST days (23h or 25h long) come out right.
 */

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** `dayStart` shifted by `n` calendar days (not 24h blocks). */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/** Local `YYYY-MM-DD`. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Start (local midnight) of a `YYYY-MM-DD` key, or null if malformed. */
export function parseDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date.getTime()
}

/** Local time `YYYY-MM-DD HH:mm:ss` — the format used in CSV exports. */
export function formatLocalDateTime(ts: number): string {
  const d = new Date(ts)
  return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Clock time for display. */
export function formatClock(ts: number, hour12: boolean, withSeconds = true): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12
  }).format(ts)
}

export function formatDayLong(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(ts)
}

export function formatDayShort(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(ts)
}

/** `5m 32s`, `1h 12m`, `45s`. Rounded to the nearest second. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** End of a visit; an open visit ends at its last checkpoint (start + accrued time). */
export function effectiveEnd(v: Visit): number {
  return v.endTime ?? v.startTime + v.durationMs
}

/**
 * Clip a visit to [from, to). Returns null when it does not overlap.
 * `continues*` flags are relative to the visit's true extent, not the window.
 */
export function clipVisit(v: Visit, from: number, to: number): Segment | null {
  const vEnd = effectiveEnd(v)
  const start = Math.max(v.startTime, from)
  const end = Math.min(vEnd, to)
  if (end <= start) return null
  return {
    visit: v,
    domain: v.domain,
    start,
    end,
    day: dayKey(start),
    continuesFromPrev: v.startTime < start,
    continuesToNext: vEnd > end
  }
}

/** Split a visit at every local midnight it crosses. */
export function splitByDay(v: Visit): Segment[] {
  const vEnd = effectiveEnd(v)
  if (vEnd <= v.startTime) return []
  const out: Segment[] = []
  let dayStart = startOfDay(v.startTime)
  while (dayStart < vEnd) {
    const next = addDays(dayStart, 1)
    const seg = clipVisit(v, dayStart, next)
    if (seg) out.push(seg)
    dayStart = next
  }
  return out
}

/** Merge [start, end) intervals and return total covered length. */
export function unionLength(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let [curStart, curEnd] = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e
    } else {
      total += curEnd - curStart
      ;[curStart, curEnd] = [s, e]
    }
  }
  return total + (curEnd - curStart)
}
