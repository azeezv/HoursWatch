import {describe, expect, it} from 'vitest'
import {buildCsv, CSV_HEADER, escapeCsv, exportFilename} from '../src/shared/csv'
import {segmentsForRange} from '../src/shared/stats'
import {addDays, splitByDay} from '../src/shared/time'
import type {Visit} from '../src/shared/types'

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime()
const v = (domain: string, start: number, end: number): Visit => ({
  id: domain + start,
  domain,
  startTime: start,
  endTime: end,
  durationMs: end - start,
  createdAt: start
})

describe('escapeCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"')
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsv('a\nb')).toBe('"a\nb"')
    expect(escapeCsv('plain')).toBe('plain')
    expect(escapeCsv(42)).toBe('42')
  })
  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(escapeCsv('@cmd')).toBe(`'@cmd`)
  })
})

describe('buildCsv', () => {
  it('has the required header and a correct row', () => {
    const csv = buildCsv(splitByDay(v('github.com', local(2025, 6, 10, 9, 5, 3), local(2025, 6, 10, 9, 10, 35))))
    const [header, row] = csv.split('\r\n')
    expect(header.split(',')).toEqual(CSV_HEADER)
    expect(row).toBe('2025-06-10,github.com,2025-06-10 09:05:03,2025-06-10 09:10:35,332,5m 32s')
  })

  it('splits midnight-crossing visits into one row per day with per-day durations', () => {
    const csv = buildCsv(splitByDay(v('a.com', local(2025, 6, 10, 23, 50), local(2025, 6, 11, 0, 20))))
    const rows = csv.trim().split('\r\n').slice(1)
    expect(rows).toEqual([
      '2025-06-10,a.com,2025-06-10 23:50:00,2025-06-11 00:00:00,600,10m 0s',
      '2025-06-11,a.com,2025-06-11 00:00:00,2025-06-11 00:20:00,1200,20m 0s'
    ])
  })

  it('clips to a requested range', () => {
    const visits = [
      v('a.com', local(2025, 6, 9, 10), local(2025, 6, 9, 11)),
      v('b.com', local(2025, 6, 10, 10), local(2025, 6, 10, 10, 30)),
      v('c.com', local(2025, 6, 12, 10), local(2025, 6, 12, 11))
    ]
    const segs = segmentsForRange(visits, local(2025, 6, 10), addDays(local(2025, 6, 11), 1))
    const rows = buildCsv(segs).trim().split('\r\n').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('b.com')
  })

  it('exports just the header for no data', () => {
    expect(buildCsv([])).toBe(CSV_HEADER.join(',') + '\r\n')
  })
})

describe('exportFilename', () => {
  it('encodes the day, range or export date', () => {
    expect(exportFilename({kind: 'day', day: local(2025, 6, 10)})).toBe('hourswatch-2025-06-10.csv')
    expect(exportFilename({kind: 'range', from: local(2025, 6, 1), to: local(2025, 6, 10)})).toBe(
      'hourswatch-2025-06-01_to_2025-06-10.csv'
    )
    expect(exportFilename({kind: 'all', today: local(2025, 6, 10)})).toBe(
      'hourswatch-all-history-2025-06-10.csv'
    )
  })
})
