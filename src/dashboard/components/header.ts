import {formatDayLong, dayKey} from '../../shared/time'
import {h, replace} from '../dom'

export interface HeaderHandlers {
  onPrev(): void
  onNext(): void
  onToday(): void
  onPickDay(dayKey: string): void
  onExport(): void
  onSettings(): void
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
  private title = h('h1', {class: 'date-title', id: 'date-title'})
  private input = h('input', {type: 'date', class: 'date-input', 'aria-label': 'Choose date'})
  private prev = h('button', {class: 'btn btn-icon', type: 'button', title: 'Previous day', 'aria-label': 'Previous day'}, '‹')
  private next = h('button', {class: 'btn btn-icon', type: 'button', title: 'Next day', 'aria-label': 'Next day'}, '›')
  private today = h('button', {class: 'btn', type: 'button'}, 'Today')

  constructor(handlers: HeaderHandlers) {
    this.prev.addEventListener('click', handlers.onPrev)
    this.next.addEventListener('click', handlers.onNext)
    this.today.addEventListener('click', handlers.onToday)
    this.input.addEventListener('change', () => this.input.value && handlers.onPickDay(this.input.value))

    this.el = h(
      'header',
      {class: 'app-header'},
      h('div', {class: 'brand'}, LOGO(), h('span', {class: 'brand-name'}, 'HoursWatch')),
      h('nav', {class: 'day-nav', 'aria-label': 'Day navigation'}, this.prev, this.title, this.next, this.input, this.today),
      h(
        'div',
        {class: 'header-actions'},
        h('button', {class: 'btn', type: 'button', onclick: handlers.onExport}, 'Export CSV'),
        h('button', {class: 'btn', type: 'button', onclick: handlers.onSettings}, 'Settings')
      )
    )
  }

  update(dayStart: number, isToday: boolean, minDay: number | null) {
    replace(this.title, formatDayLong(dayStart), isToday ? h('span', {class: 'badge'}, 'Today') : null)
    this.input.value = dayKey(dayStart)
    this.input.max = dayKey(Date.now())
    if (minDay !== null) this.input.min = dayKey(minDay)
    this.next.disabled = isToday
    this.today.disabled = isToday
  }
}
