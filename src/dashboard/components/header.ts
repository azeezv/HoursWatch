import {lastDays} from '../../shared/range'
import {addDays, formatDayHeader, formatRange} from '../../shared/time'
import {h, replace} from '../dom'
import {icon} from '../icons'
import {closePicker, isPickerOpen, openRangePicker} from './datepicker'

export interface HeaderHandlers {
  onPrev(): void
  onNext(): void
  onToday(): void
  onYesterday(): void
  onWeek(): void
  /** A day (from === to) or a range was chosen. */
  onRange(from: number, to: number): void
  onTheme(): void
  onExport(): void
  onSettings(): void
}

export interface HeaderState {
  /** Selected range, inclusive, local midnights (a single day has from === to). */
  from: number
  to: number
  /** Local midnight of today. */
  today: number
  /** Earliest day with data. */
  minDay: number | null
  /** The theme currently showing. */
  theme: 'light' | 'dark'
}

const LOGO = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 32 32')
  svg.setAttribute('width', '28')
  svg.setAttribute('height', '28')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML =
    '<rect width="32" height="32" rx="7" fill="#4f46e5"/><circle cx="16" cy="15" r="9" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M16 9.5V15l4 2.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="27" width="7" height="1.6" rx=".8" fill="#fbbf24"/><rect x="14" y="27" width="9" height="1.6" rx=".8" fill="#34d399"/><rect x="24" y="27" width="3" height="1.6" rx=".8" fill="#f472b6"/>'
  return svg
}

export class Header {
  readonly el: HTMLElement
  private title = h('span', {class: 'date-text', id: 'date-title'})
  private pill = h('div', {class: 'pill-group date-pill'})
  private state: HeaderState | null = null
  private prev = h('button', {class: 'icon-btn', type: 'button'}, icon('left', 16))
  private next = h('button', {class: 'icon-btn', type: 'button'}, icon('right', 16))
  private pick = h('button', {class: 'date-btn', type: 'button', title: 'Choose a date or range', 'aria-haspopup': 'dialog'}, icon('calendar', 16), this.title)
  private today = h('button', {class: 'seg-btn', type: 'button'}, 'Today')
  private yesterday = h('button', {class: 'seg-btn', type: 'button'}, 'Yesterday')
  private week = h('button', {class: 'seg-btn', type: 'button'}, '7 Days')
  private theme = h('button', {class: 'icon-btn icon-btn-box', type: 'button'})

  constructor(handlers: HeaderHandlers) {
    this.prev.addEventListener('click', handlers.onPrev)
    this.next.addEventListener('click', handlers.onNext)
    this.today.addEventListener('click', handlers.onToday)
    this.yesterday.addEventListener('click', handlers.onYesterday)
    this.week.addEventListener('click', handlers.onWeek)
    this.theme.addEventListener('click', handlers.onTheme)
    this.pick.addEventListener('click', () => {
      const st = this.state
      if (isPickerOpen()) return closePicker()
      if (st) openRangePicker({host: this.pill, from: st.from, to: st.to, today: st.today, minDay: st.minDay, onPick: handlers.onRange})
    })

    this.pill.append(this.prev, h('h1', {class: 'date-title'}, this.pick), this.next)
    this.el = h(
      'header',
      {class: 'app-header'},
      h('div', {class: 'brand'}, LOGO(), h('span', {class: 'brand-name'}, 'HoursWatch')),
      h(
        'nav',
        {class: 'day-nav', 'aria-label': 'Date navigation'},
        this.pill,
        h('div', {class: 'pill-group seg', role: 'group', 'aria-label': 'Period'}, this.today, this.yesterday, this.week)
      ),
      h(
        'div',
        {class: 'header-actions'},
        this.theme,
        h('button', {class: 'btn btn-export', type: 'button', onclick: handlers.onExport}, icon('download', 15), 'Export CSV'),
        h('button', {class: 'icon-btn icon-btn-box', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: handlers.onSettings}, icon('settings', 17))
      )
    )
  }

  update(s: HeaderState) {
    this.state = s
    const single = s.from === s.to
    this.title.textContent = single ? formatDayHeader(s.to) : formatRange(s.from, s.to)

    for (const [btn, label] of [[this.prev, single ? 'Previous day' : 'Previous period'], [this.next, single ? 'Next day' : 'Next period']] as const) {
      btn.title = label
      btn.setAttribute('aria-label', label)
    }
    this.next.disabled = s.to >= s.today

    const yesterday = addDays(s.today, -1)
    const [weekFrom] = lastDays(7, s.today)
    this.setActive(this.today, single && s.to === s.today)
    this.setActive(this.yesterday, single && s.to === yesterday)
    this.setActive(this.week, s.from === weekFrom && s.to === s.today)

    const next = s.theme === 'dark' ? 'light' : 'dark'
    this.theme.title = this.theme.ariaLabel = `Switch to ${next} theme`
    replace(this.theme, icon(s.theme === 'dark' ? 'sun' : 'moon', 17))
  }

  private setActive(btn: HTMLButtonElement, on: boolean) {
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', String(on))
  }
}
