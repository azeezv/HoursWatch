import {dayKey, formatDayHeader, formatRange, addDays} from '../../shared/time'
import {h, replace} from '../dom'
import {icon} from '../icons'

export type Mode = 'day' | 'week'

export interface HeaderHandlers {
  onPrev(): void
  onNext(): void
  onToday(): void
  onYesterday(): void
  onWeek(): void
  onPickDay(dayKey: string): void
  onTheme(): void
  onExport(): void
  onSettings(): void
}

export interface HeaderState {
  mode: Mode
  /** Selected day (the last day of the range in week mode), local midnight. */
  day: number
  /** Local midnight of today. */
  today: number
  /** Earliest day with data, for the date picker. */
  minDay: number | null
  /** The theme currently showing. */
  theme: 'light' | 'dark'
  /** Days in the week range. */
  weekDays: number
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
  private input = h('input', {type: 'date', class: 'date-input', 'aria-label': 'Choose date', tabIndex: -1})
  private prev = h('button', {class: 'icon-btn', type: 'button'}, icon('left', 16))
  private next = h('button', {class: 'icon-btn', type: 'button'}, icon('right', 16))
  private pick = h('button', {class: 'date-btn', type: 'button', title: 'Choose a date'}, icon('calendar', 16), this.title)
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
    this.input.addEventListener('change', () => this.input.value && handlers.onPickDay(this.input.value))
    this.pick.addEventListener('click', () => {
      try { this.input.showPicker() } catch { this.input.focus() }
    })

    this.el = h(
      'header',
      {class: 'app-header'},
      h('div', {class: 'brand'}, LOGO(), h('span', {class: 'brand-name'}, 'HoursWatch')),
      h(
        'nav',
        {class: 'day-nav', 'aria-label': 'Date navigation'},
        h('div', {class: 'pill-group date-pill'}, this.prev, h('h1', {class: 'date-title'}, this.pick), this.next, this.input),
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
    const isWeek = s.mode === 'week'
    const unit = isWeek ? 'week' : 'day'
    const atToday = s.day >= s.today
    this.title.textContent = isWeek ? formatRange(addDays(s.day, -(s.weekDays - 1)), s.day) : formatDayHeader(s.day)
    this.input.value = dayKey(s.day)
    this.input.max = dayKey(s.today)
    if (s.minDay !== null) this.input.min = dayKey(s.minDay)

    for (const [btn, label] of [[this.prev, `Previous ${unit}`], [this.next, `Next ${unit}`]] as const) {
      btn.title = label
      btn.setAttribute('aria-label', label)
    }
    this.next.disabled = atToday

    const yesterday = addDays(s.today, -1)
    this.setActive(this.today, s.mode === 'day' && s.day === s.today)
    this.setActive(this.yesterday, s.mode === 'day' && s.day === yesterday)
    this.setActive(this.week, isWeek)

    const next = s.theme === 'dark' ? 'light' : 'dark'
    this.theme.title = this.theme.ariaLabel = `Switch to ${next} theme`
    replace(this.theme, icon(s.theme === 'dark' ? 'sun' : 'moon', 17))
  }

  private setActive(btn: HTMLButtonElement, on: boolean) {
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', String(on))
  }
}
