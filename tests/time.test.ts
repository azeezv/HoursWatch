import {describe, expect, it} from 'vitest'
import {computeStats, segmentsForRange} from '../src/shared/stats'
import {
  addDays,
  clipVisit,
  dayKey,
  formatDuration,
  parseDayKey,
  splitByDay,
  startOfDay,
  unionLength
} from '../src/shared/time'
import type {Visit} from '../src/shared/types'

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime()

const visit = (domain: string, start: number, end: number | null, durationMs?: number): Visit => ({
  id: `${domain}-${start}`,
  domain,
  startTime: start,
  endTime: end,
  durationMs: durationMs ?? (end ?? start) - start,
  createdAt: start
})

describe('environment', () => {
  it('runs in America/New_York so DST tests are meaningful', () => {
    expect(new Date(2025, 2, 9, 12).getTimezoneOffset()).toBe(240) // EDT
    expect(new Date(2025, 0, 9, 12).getTimezoneOffset()).toBe(300) // EST
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '1s'],
    [45_000, '45s'],
    [332_000, '5m 32s'],
    [3_600_000, '1h 0m'],
    [4_320_000, '1h 12m'],
    [90_000_000, '25h 0m']
  ])('%i ms -> %s', (ms, out) => expect(formatDuration(ms)).toBe(out))
})

describe('day keys', () => {
  it('round-trips', () => {
    const t = local(2025, 6, 10, 15, 30)
    expect(dayKey(t)).toBe('2025-06-10')
    expect(parseDayKey('2025-06-10')).toBe(startOfDay(t))
  })
  it('rejects malformed or impossible dates', () => {
    expect(parseDayKey('2025-02-30')).toBeNull()
    expect(parseDayKey('nope')).toBeNull()
  })
})

describe('midnight and DST', () => {
  it('splits a visit that crosses local midnight into two day segments', () => {
    const v = visit('a.com', local(2025, 6, 10, 23, 50), local(2025, 6, 11, 0, 20))
    const segs = splitByDay(v)
    expect(segs.map((s) => [s.day, s.end - s.start])).toEqual([
      ['2025-06-10', 10 * 60_000],
      ['2025-06-11', 20 * 60_000]
    ])
    expect(segs[0]).toMatchObject({continuesFromPrev: false, continuesToNext: true})
    expect(segs[1]).toMatchObject({continuesFromPrev: true, continuesToNext: false})
    expect(segs[0].end).toBe(segs[1].start)
    expect(segs[0].end).toBe(local(2025, 6, 11))
  })

  it('shows a crossing visit on both days in daily reports', () => {
    const v = visit('a.com', local(2025, 6, 10, 23, 50), local(2025, 6, 11, 0, 20))
    const d10 = segmentsForRange([v], local(2025, 6, 10), addDays(local(2025, 6, 10), 1))
    const d11 = segmentsForRange([v], local(2025, 6, 11), addDays(local(2025, 6, 11), 1))
    expect(computeStats(d10).totalMs).toBe(10 * 60_000)
    expect(computeStats(d11).totalMs).toBe(20 * 60_000)
    expect(computeStats(d10).visitCount).toBe(1)
    expect(computeStats(d11).visitCount).toBe(1)
  })

  it('spans three days for a very long visit', () => {
    const v = visit('a.com', local(2025, 6, 10, 20), local(2025, 6, 12, 4))
    expect(splitByDay(v).map((s) => s.day)).toEqual(['2025-06-10', '2025-06-11', '2025-06-12'])
  })

  it('handles the 23-hour spring-forward day', () => {
    const start = local(2025, 3, 9)
    const end = addDays(start, 1)
    expect((end - start) / 3_600_000).toBe(23)
    const v = visit('a.com', local(2025, 3, 8, 23, 0), local(2025, 3, 9, 4, 0))
    const day = segmentsForRange([v], start, end)
    // 00:00 EST -> 04:00 EDT is 3 real hours
    expect(computeStats(day).totalMs).toBe(3 * 3_600_000)
  })

  it('handles the 25-hour fall-back day', () => {
    const start = local(2025, 11, 2)
    const end = addDays(start, 1)
    expect((end - start) / 3_600_000).toBe(25)
    const v = visit('a.com', local(2025, 11, 2, 0, 30), local(2025, 11, 2, 3, 30))
    expect(splitByDay(v)).toHaveLength(1)
    expect(computeStats(segmentsForRange([v], start, end)).totalMs).toBe(4 * 3_600_000)
  })

  it('treats an open visit as ending at start + accrued duration', () => {
    const v = visit('a.com', local(2025, 6, 10, 9), null, 5 * 60_000)
    const seg = clipVisit(v, local(2025, 6, 10), local(2025, 6, 11))!
    expect(seg.end - seg.start).toBe(5 * 60_000)
  })

  it('ignores visits outside the window', () => {
    const v = visit('a.com', local(2025, 6, 9, 10), local(2025, 6, 9, 11))
    expect(clipVisit(v, local(2025, 6, 10), local(2025, 6, 11))).toBeNull()
  })
})

describe('unionLength', () => {
  it('does not double count overlaps', () => {
    expect(unionLength([[0, 10], [5, 15], [20, 30]])).toBe(25)
    expect(unionLength([[0, 10], [0, 10]])).toBe(10)
    expect(unionLength([])).toBe(0)
  })
})

describe('computeStats', () => {
  const day = local(2025, 6, 10)
  const visits = [
    visit('github.com', day + 9 * 3.6e6, day + 9 * 3.6e6 + 30 * 60_000),
    visit('youtube.com', day + 10 * 3.6e6, day + 10 * 3.6e6 + 10 * 60_000),
    visit('github.com', day + 11 * 3.6e6, day + 11 * 3.6e6 + 20 * 60_000),
    visit('news.com', day + 12 * 3.6e6, day + 12 * 3.6e6 + 5 * 60_000),
    visit('news.com', day + 13 * 3.6e6, day + 13 * 3.6e6 + 5 * 60_000),
    visit('news.com', day + 14 * 3.6e6, day + 14 * 3.6e6 + 5 * 60_000)
  ]
  const stats = computeStats(segmentsForRange(visits, day, addDays(day, 1)))

  it('totals, counts and averages', () => {
    expect(stats.totalMs).toBe(75 * 60_000)
    expect(stats.sumMs).toBe(stats.totalMs)
    expect(stats.visitCount).toBe(6)
    expect(stats.uniqueDomains).toBe(3)
    expect(stats.avgMs).toBe((75 * 60_000) / 6)
  })
  it('finds top domains by time and by visits', () => {
    expect(stats.topByTime?.domain).toBe('github.com')
    expect(stats.topByVisits?.domain).toBe('news.com')
  })
  it('breaks down by domain, sorted, with percentages summing to 100', () => {
    expect(stats.breakdown.map((b) => b.domain)).toEqual(['github.com', 'news.com', 'youtube.com'])
    expect(stats.breakdown[0]).toMatchObject({ms: 50 * 60_000, visits: 2})
    expect(stats.breakdown.reduce((s, b) => s + b.percent, 0)).toBeCloseTo(100)
  })
  it('is empty-safe', () => {
    const e = computeStats([])
    expect(e).toMatchObject({totalMs: 0, visitCount: 0, uniqueDomains: 0, topByTime: null, avgMs: 0})
  })
  it('reports union less than sum when records overlap', () => {
    const overlapping = [
      visit('a.com', day, day + 10 * 60_000),
      visit('b.com', day + 5 * 60_000, day + 15 * 60_000)
    ]
    const s = computeStats(segmentsForRange(overlapping, day, addDays(day, 1)))
    expect(s.sumMs).toBe(20 * 60_000)
    expect(s.totalMs).toBe(15 * 60_000)
  })
})
