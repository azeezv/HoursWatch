import {describe, expect, it} from 'vitest'
import {lastDays, monthToDate, rangeLength, shiftRange} from '../src/shared/range'
import {addDays, dayKey, startOfDay} from '../src/shared/time'

const day = (y: number, m: number, d: number) => startOfDay(new Date(y, m - 1, d, 12).getTime())

describe('range helpers', () => {
  it('counts inclusive days, also across a DST change', () => {
    expect(rangeLength(day(2026, 10, 25), day(2026, 10, 25))).toBe(1)
    expect(rangeLength(day(2026, 10, 25), day(2026, 10, 31))).toBe(7)
    // US spring-forward is 2026-03-08 (test TZ is America/New_York)
    expect(rangeLength(day(2026, 3, 1), day(2026, 3, 14))).toBe(14)
  })

  it('builds presets', () => {
    const today = day(2026, 10, 31)
    expect(lastDays(7, today).map(dayKey)).toEqual(['2026-10-25', '2026-10-31'])
    expect(monthToDate(today).map(dayKey)).toEqual(['2026-10-01', '2026-10-31'])
  })

  it('shifts by its own length and keeps it', () => {
    const today = day(2026, 10, 31)
    const [f, t] = shiftRange(day(2026, 10, 18), day(2026, 10, 24), 1, today)
    expect([dayKey(f), dayKey(t)]).toEqual(['2026-10-25', '2026-10-31'])
    const [pf, pt] = shiftRange(day(2026, 10, 25), day(2026, 10, 31), -1, today)
    expect([dayKey(pf), dayKey(pt)]).toEqual(['2026-10-18', '2026-10-24'])
    const [sf, st] = shiftRange(day(2026, 10, 30), day(2026, 10, 30), -1, today)
    expect(dayKey(sf)).toBe('2026-10-29')
    expect(dayKey(st)).toBe('2026-10-29')
  })

  it('never runs past today', () => {
    const today = day(2026, 10, 31)
    const [f, t] = shiftRange(day(2026, 10, 22), day(2026, 10, 28), 1, today)
    expect(rangeLength(f, t)).toBe(7)
    expect(dayKey(t)).toBe('2026-10-31')
    expect(addDays(f, 6)).toBe(t)
  })
})
