import {formatDuration} from '../../shared/time'
import {h, replace} from '../dom'

export interface DayTotal {
  /** Local midnight. */
  day: number
  totalMs: number
}

const weekday = (ts: number) => new Intl.DateTimeFormat(undefined, {weekday: 'short'}).format(ts)
const dayNum = (ts: number) => new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(ts)

/** One bar per day of the range; clicking a bar opens that day. */
export function renderWeek(root: HTMLElement, days: DayTotal[], today: number, onPick: (day: number) => void) {
  const max = Math.max(1, ...days.map((d) => d.totalMs))
  const best = days.reduce((a, d) => (d.totalMs > a.totalMs ? d : a), days[0])
  replace(
    root,
    h(
      'div',
      {class: 'week', role: 'list'},
      ...days.map((d) =>
        h(
          'button',
          {
            class: `week-day${d.day === today ? ' is-today' : ''}${d.totalMs > 0 && d === best ? ' is-best' : ''}`,
            type: 'button',
            role: 'listitem',
            title: `${dayNum(d.day)}: ${d.totalMs > 0 ? formatDuration(d.totalMs) : 'nothing tracked'}. Click to open this day.`,
            onclick: () => onPick(d.day)
          },
          h('span', {class: 'week-value mono'}, d.totalMs > 0 ? formatDuration(d.totalMs) : '–'),
          h('span', {class: 'week-track'}, h('span', {class: 'week-bar', style: {height: `${(d.totalMs / max) * 100}%`}})),
          h('span', {class: 'week-label'}, h('strong', {}, weekday(d.day)), h('span', {}, dayNum(d.day)))
        )
      )
    )
  )
}
