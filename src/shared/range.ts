import {addDays, startOfDay} from './time'

const DAY_MS = 86_400_000

/** Number of local days in [from, to], both inclusive and local-midnight aligned (DST safe). */
export function rangeLength(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS) + 1
}

/** The `n` days ending on `today`. */
export function lastDays(n: number, today: number): [number, number] {
  return [addDays(today, -(n - 1)), today]
}

/** First of the current month up to `today`. */
export function monthToDate(today: number): [number, number] {
  const d = new Date(today)
  return [startOfDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime()), today]
}

/**
 * Move a range by its own length (`dir` -1 = earlier, 1 = later). The result
 * never extends past `today`; it is slid back so the length is kept.
 */
export function shiftRange(from: number, to: number, dir: 1 | -1, today: number): [number, number] {
  const n = rangeLength(from, to)
  const nextFrom = addDays(from, dir * n)
  const nextTo = addDays(to, dir * n)
  if (nextTo > today) return lastDays(n, today)
  return [nextFrom, nextTo]
}
