import {describe, expect, it} from 'vitest'
import {clipSegmentsTo, computeStats, coreDomains, foldConsecutive, percentChange, segmentsForRange} from '../src/shared/stats'
import type {Visit} from '../src/shared/types'

const visit = (id: string, domain: string, startTime: number, ms: number): Visit =>
  ({id, domain, startTime, endTime: startTime + ms, durationMs: ms, createdAt: startTime})

describe('percentChange', () => {
  it('rounds and signs the change', () => {
    expect(percentChange(112, 100)).toBe(12)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(100, 100)).toBe(0)
  })
  it('is null with nothing to compare against', () => {
    expect(percentChange(10, 0)).toBeNull()
    expect(percentChange(0, 0)).toBeNull()
  })
})

describe('clipSegmentsTo', () => {
  const segs = segmentsForRange([visit('a', 'a.com', 0, 100), visit('b', 'b.com', 150, 100), visit('c', 'c.com', 300, 50)], 0, 1000)
  it('drops what starts after the limit and trims what straddles it', () => {
    const out = clipSegmentsTo(segs, 200)
    expect(out.map((s) => [s.domain, s.start, s.end])).toEqual([['a.com', 0, 100], ['b.com', 150, 200]])
    expect(computeStats(out).totalMs).toBe(150)
  })
})

describe('coreDomains', () => {
  const stats = (parts: Array<[string, number]>) =>
    computeStats(segmentsForRange(parts.map(([d, ms], i) => visit(String(i), d, i * 1000, ms)), 0, 1e9)).breakdown

  it('finds the smallest top set reaching 80%', () => {
    const r = coreDomains(stats([['a.com', 50], ['b.com', 32], ['c.com', 10], ['d.com', 8]]))
    expect(r?.count).toBe(2)
    expect(Math.round(r!.percent)).toBe(82)
  })
  it('counts a single dominant site as one', () => {
    expect(coreDomains(stats([['a.com', 90], ['b.com', 10]]))?.count).toBe(1)
  })
  it('is null without time', () => {
    expect(coreDomains([])).toBeNull()
  })
})

describe('foldConsecutive', () => {
  const day = 86_400_000 * 3
  const segs = segmentsForRange(
    [visit('1', 'a.com', 0, 10), visit('2', 'a.com', 20, 10), visit('3', 'b.com', 40, 10), visit('4', 'a.com', 60, 10), visit('5', 'a.com', day, 10)],
    0, day * 2)
  it('merges only neighbouring visits of one site within a day', () => {
    expect(foldConsecutive(segs).map((run) => run.map((s) => s.visit.id))).toEqual([['1', '2'], ['3'], ['4'], ['5']])
  })
  it('does not fold when nothing is adjacent', () => {
    expect(foldConsecutive([])).toEqual([])
  })
})
