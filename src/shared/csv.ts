import {dayKey, formatDuration, formatLocalDateTime} from './time'
import type {Segment} from './types'

export const CSV_HEADER = [
  'Date',
  'Website Domain',
  'Visit Start Time',
  'Visit End Time',
  'Duration in Seconds',
  'Duration (Human-Readable)'
]

/** RFC 4180 quoting, plus neutralising spreadsheet formula injection. */
export function escapeCsv(value: string | number): string {
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * One row per day-segment, so a visit that crosses midnight appears once for
 * each day with the correct per-day duration. Times are local, 24-hour.
 */
export function buildCsv(segments: Segment[]): string {
  const rows = [...segments]
    .sort((a, b) => a.start - b.start || a.domain.localeCompare(b.domain))
    .map((s) => {
      const ms = s.end - s.start
      return [
        dayKey(s.start),
        s.domain,
        formatLocalDateTime(s.start),
        formatLocalDateTime(s.end),
        Math.round(ms / 1000),
        formatDuration(ms)
      ]
        .map(escapeCsv)
        .join(',')
    })
  return [CSV_HEADER.map(escapeCsv).join(','), ...rows].join('\r\n') + '\r\n'
}

export type ExportRange =
  | {kind: 'day'; day: number}
  | {kind: 'range'; from: number; to: number}
  | {kind: 'all'; today: number}

export function exportFilename(range: ExportRange): string {
  switch (range.kind) {
    case 'day':
      return `hourswatch-${dayKey(range.day)}.csv`
    case 'range':
      return `hourswatch-${dayKey(range.from)}_to_${dayKey(range.to)}.csv`
    case 'all':
      return `hourswatch-all-history-${dayKey(range.today)}.csv`
  }
}

/** UTF-8 BOM so Excel detects the encoding. */
export function csvBlob(csv: string): Blob {
  return new Blob(['﻿', csv], {type: 'text/csv;charset=utf-8'})
}
