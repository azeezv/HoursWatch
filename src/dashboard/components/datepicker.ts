import {lastDays, monthToDate} from '../../shared/range'
import {addDays, dayKey, formatRange, startOfDay} from '../../shared/time'
import {h, replace} from '../dom'
import {icon} from '../icons'

export interface PickerOptions {
  /** Element the popover is anchored to (must be `position: relative`). */
  host: HTMLElement
  from: number
  to: number
  today: number
  /** Earliest day with data, enables "All time". */
  minDay: number | null
  onPick(from: number, to: number): void
}

let current: {close(): void} | null = null

export const isPickerOpen = () => current !== null
export const closePicker = () => current?.close()

const monthTitle = (m: number) => new Intl.DateTimeFormat(undefined, {month: 'long', year: 'numeric'}).format(m)
/** Monday-first weekday initials. */
const weekdays = Array.from({length: 7}, (_, i) => new Intl.DateTimeFormat(undefined, {weekday: 'short'}).format(new Date(2024, 0, 1 + i)).slice(0, 2))

/**
 * A month calendar for choosing one day or a range: click the first day, then
 * the last (click the same day twice for a single day). Presets sit above it.
 */
export function openRangePicker(o: PickerOptions) {
  current?.close()

  let view = startOfDay(new Date(new Date(o.to).getFullYear(), new Date(o.to).getMonth(), 1).getTime())
  let anchor: number | null = null // first click of a new selection
  let hover: number | null = null

  const pop = h('div', {class: 'picker', role: 'dialog', 'aria-label': 'Choose dates'})
  const select = (a: number, b: number) => {
    const [f, t] = a <= b ? [a, b] : [b, a]
    close()
    o.onPick(f, Math.min(t, o.today))
  }

  const render = () => {
    const lo = anchor !== null ? Math.min(anchor, hover ?? anchor) : o.from
    const hi = anchor !== null ? Math.max(anchor, hover ?? anchor) : o.to
    const first = new Date(view)
    const gridStart = addDays(view, -((first.getDay() + 6) % 7))

    const cells = Array.from({length: 42}, (_, i) => {
      const d = addDays(gridStart, i)
      const inMonth = new Date(d).getMonth() === first.getMonth()
      const future = d > o.today
      const cls = ['pk-day', !inMonth && 'is-out', d === o.today && 'is-today', d >= lo && d <= hi && 'in-range', d === lo && 'is-start', d === hi && 'is-end']
        .filter(Boolean)
        .join(' ')
      return h('button', {
        class: cls,
        type: 'button',
        disabled: future,
        'aria-label': dayKey(d),
        'aria-pressed': d >= lo && d <= hi,
        onpointerenter: () => { if (anchor !== null && hover !== d) { hover = d; render() } },
        onclick: () => {
          if (anchor === null) { anchor = d; hover = d; render() } else select(anchor, d)
        }
      }, String(new Date(d).getDate()))
    })

    const presets: Array<[string, () => [number, number]]> = [
      ['Last 7 days', () => lastDays(7, o.today)],
      ['Last 30 days', () => lastDays(30, o.today)],
      ['This month', () => monthToDate(o.today)]
    ]
    if (o.minDay !== null) presets.push(['All time', () => [o.minDay as number, o.today]])

    const monthNav = (dir: -1 | 1) => () => {
      const d = new Date(view)
      view = startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime())
      render()
    }
    const nextDisabled = addDays(view, 40) > o.today && new Date(view).getMonth() === new Date(o.today).getMonth() && new Date(view).getFullYear() === new Date(o.today).getFullYear()

    replace(
      pop,
      h('div', {class: 'pk-presets'}, ...presets.map(([label, get]) => h('button', {class: 'pk-chip', type: 'button', onclick: () => select(...get())}, label))),
      h('div', {class: 'pk-nav'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: monthNav(-1)}, icon('left', 16)),
        h('strong', {}, monthTitle(view)),
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Next month', disabled: nextDisabled, onclick: monthNav(1)}, icon('right', 16))),
      h('div', {class: 'pk-grid pk-week'}, ...weekdays.map((w) => h('span', {}, w))),
      h('div', {class: 'pk-grid', onpointerleave: () => { if (anchor !== null) { hover = anchor; render() } }}, ...cells),
      h('p', {class: 'pk-hint', 'aria-live': 'polite'}, anchor === null ? `Selected: ${formatRange(o.from, o.to)}. Click a day to start a new range.` : 'Now click the last day (click the same day again for a single day).')
    )
  }

  const onDown = (e: PointerEvent) => { if (!o.host.contains(e.target as Node)) close() }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  function close() {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey)
    pop.remove()
    if (current === handle) current = null
  }
  const handle = {close}
  current = handle
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onKey)

  render()
  o.host.append(pop)
}
