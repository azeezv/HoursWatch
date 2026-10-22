import {clipVisit, splitByDay, unionLength} from './time'
import type {DayStats, DomainStat, Segment, Visit} from './types'

/** Clip visits to [from, to) and drop those that do not overlap. */
export function segmentsForRange(visits: Visit[], from: number, to: number): Segment[] {
  const out: Segment[] = []
  for (const v of visits) {
    const s = clipVisit(v, from, to)
    if (s) out.push(s)
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * Summaries for a set of segments (normally one day).
 * `totalMs` is the union of the intervals, so overlapping records can never be
 * double counted; `sumMs` is the naive sum and is shown only if it differs.
 */
export function computeStats(segments: Segment[]): DayStats {
  const byDomain = new Map<string, {ms: number; visitIds: Set<string>}>()
  let sumMs = 0
  const visitIds = new Set<string>()
  const intervals: Array<[number, number]> = []

  for (const s of segments) {
    const ms = s.end - s.start
    sumMs += ms
    intervals.push([s.start, s.end])
    visitIds.add(s.visit.id)
    let d = byDomain.get(s.domain)
    if (!d) byDomain.set(s.domain, (d = {ms: 0, visitIds: new Set()}))
    d.ms += ms
    d.visitIds.add(s.visit.id)
  }

  const totalMs = unionLength(intervals)
  const breakdown: DomainStat[] = [...byDomain.entries()]
    .map(([domain, d]) => ({
      domain,
      ms: d.ms,
      visits: d.visitIds.size,
      percent: sumMs > 0 ? (d.ms / sumMs) * 100 : 0
    }))
    .sort((a, b) => b.ms - a.ms || a.domain.localeCompare(b.domain))

  const topByVisits =
    [...breakdown].sort((a, b) => b.visits - a.visits || b.ms - a.ms)[0] ?? null

  return {
    totalMs,
    sumMs,
    visitCount: visitIds.size,
    uniqueDomains: byDomain.size,
    topByTime: breakdown[0] ?? null,
    topByVisits,
    avgMs: visitIds.size > 0 ? sumMs / visitIds.size : 0,
    breakdown
  }
}

/**
 * Split visits at local midnights and keep the day-segments that fall inside
 * [from, to). `from`/`to` must be local-midnight aligned. Used by history and export.
 */
export function daySegments(visits: Visit[], from: number, to: number): Segment[] {
  const out: Segment[] = []
  for (const v of visits) {
    for (const s of splitByDay(v)) if (s.start >= from && s.end <= to) out.push(s)
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}
