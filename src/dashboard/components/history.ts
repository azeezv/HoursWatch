import {addDays, dayKey, formatClock, formatDayShort, formatDuration, parseDayKey, startOfDay} from '../../shared/time'
import type {Segment} from '../../shared/types'
import {domainColor} from '../colors'
import {debounce, h, replace} from '../dom'

export type Scope = 'day' | 'range' | 'all'
export type SortKey = 'time' | 'duration' | 'domain'

export interface HistoryFilters {
  scope: Scope
  search: string
  domain: string | null
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  /** `YYYY-MM-DD` inputs for the custom range. */
  from: string
  to: string
}

const PAGE = 200

const defaults = (day: number): HistoryFilters => ({
  scope: 'day',
  search: '',
  domain: null,
  sortKey: 'time',
  sortDir: 'desc',
  from: dayKey(addDays(day, -6)),
  to: dayKey(day)
})

/**
 * Searchable, filterable, sortable visit list. Filtering/sorting/searching are
 * in-memory over the segments the host loaded for the current scope, so typing
 * never reloads the dashboard.
 */
export class History {
  readonly el: HTMLElement
  filters: HistoryFilters
  private segments: Segment[] = []
  private loading = false
  private error: string | null = null
  private shown = PAGE
  private hour12 = false
  private selected: Segment | null = null

  private search = h('input', {type: 'search', class: 'input', placeholder: 'Search websites…', 'aria-label': 'Search websites'})
  private scope = h('select', {class: 'input', 'aria-label': 'History scope'},
    h('option', {value: 'day'}, 'Selected day'),
    h('option', {value: 'range'}, 'Date range'),
    h('option', {value: 'all'}, 'All history'))
  private from = h('input', {type: 'date', class: 'input', 'aria-label': 'From date'})
  private to = h('input', {type: 'date', class: 'input', 'aria-label': 'To date'})
  private rangeBox = h('span', {class: 'range-box'}, this.from, h('span', {}, '→'), this.to)
  private sortKey = h('select', {class: 'input', 'aria-label': 'Sort by'},
    h('option', {value: 'time'}, 'Sort: visit time'),
    h('option', {value: 'duration'}, 'Sort: duration'),
    h('option', {value: 'domain'}, 'Sort: domain'))
  private sortDir = h('button', {class: 'btn btn-icon', type: 'button'})
  private chip = h('div', {class: 'chip-row'})
  private list = h('div', {class: 'history-list'})

  constructor(
    day: number,
    private cb: {
      /** Scope or range changed: the host must load different data. */
      onReload(): void
      onSelect(seg: Segment): void
      /** Domain filter changed from inside the list. */
      onDomain(domain: string | null): void
    }
  ) {
    this.filters = defaults(day)
    const rerender = () => {
      this.shown = PAGE
      this.renderList()
    }
    const debounced = debounce(() => {
      this.filters.search = this.search.value.trim().toLowerCase()
      rerender()
    }, 80)
    this.search.addEventListener('input', debounced)
    this.sortKey.addEventListener('change', () => {
      this.filters.sortKey = this.sortKey.value as SortKey
      rerender()
    })
    this.sortDir.addEventListener('click', () => {
      this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc'
      this.syncControls()
      rerender()
    })
    this.scope.addEventListener('change', () => {
      this.filters.scope = this.scope.value as Scope
      this.syncControls()
      this.cb.onReload()
    })
    const rangeChanged = () => {
      if (!this.from.value || !this.to.value) return
      if (this.from.value > this.to.value) [this.from.value, this.to.value] = [this.to.value, this.from.value]
      this.filters.from = this.from.value
      this.filters.to = this.to.value
      this.cb.onReload()
    }
    this.from.addEventListener('change', rangeChanged)
    this.to.addEventListener('change', rangeChanged)

    this.el = h(
      'div',
      {class: 'history'},
      h('div', {class: 'filters'}, this.search, this.scope, this.rangeBox, this.sortKey, this.sortDir,
        h('button', {class: 'btn', type: 'button', onclick: () => this.reset(day)}, 'Reset filters')),
      this.chip,
      this.list
    )
    this.syncControls()
  }

  /** Inclusive local-day bounds of the current range scope. */
  range(): {from: number; to: number} {
    const from = parseDayKey(this.filters.from) ?? startOfDay(Date.now())
    const to = parseDayKey(this.filters.to) ?? from
    return {from, to}
  }

  setDomain(domain: string | null) {
    this.filters.domain = domain
    this.shown = PAGE
    this.syncControls()
    this.renderList()
  }

  reset(day: number = startOfDay(Date.now())) {
    const hadScope = this.filters.scope !== 'day'
    this.filters = defaults(day)
    this.search.value = ''
    this.syncControls()
    this.cb.onDomain(null)
    if (hadScope) this.cb.onReload()
    else this.renderList()
  }

  setLoading(loading: boolean) {
    this.loading = loading
    if (loading) this.renderList()
  }

  setError(message: string | null) {
    this.error = message
    this.renderList()
  }

  setData(segments: Segment[], hour12: boolean, selected: Segment | null) {
    this.segments = segments
    this.hour12 = hour12
    this.selected = selected
    this.loading = false
    this.error = null
    this.renderList()
  }

  private syncControls() {
    const f = this.filters
    this.scope.value = f.scope
    this.sortKey.value = f.sortKey
    this.from.value = f.from
    this.to.value = f.to
    this.rangeBox.hidden = f.scope !== 'range'
    this.sortDir.textContent = f.sortDir === 'asc' ? '↑' : '↓'
    const label = f.sortDir === 'asc' ? 'Ascending' : 'Descending'
    this.sortDir.title = this.sortDir.ariaLabel = `${label} (click to reverse)`
    replace(
      this.chip,
      f.domain
        ? h('span', {class: 'chip'}, h('i', {class: 'dot', style: {background: domainColor(f.domain)}}), f.domain,
            h('button', {type: 'button', 'aria-label': `Clear ${f.domain} filter`, onclick: () => { this.setDomain(null); this.cb.onDomain(null) }}, '×'))
        : null
    )
  }

  private visible(): Segment[] {
    const {search, domain, sortKey, sortDir} = this.filters
    let rows = this.segments
    if (domain) rows = rows.filter((s) => s.domain === domain)
    if (search) rows = rows.filter((s) => s.domain.includes(search) || s.host.includes(search))
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const c =
        sortKey === 'duration'
          ? a.end - a.start - (b.end - b.start)
          : sortKey === 'domain'
            ? a.domain.localeCompare(b.domain) || a.start - b.start
            : a.start - b.start
      return c * dir
    })
  }

  private renderList() {
    if (this.error) {
      replace(this.list, h('p', {class: 'empty error', role: 'alert'}, this.error))
      return
    }
    if (this.loading) {
      replace(this.list, h('p', {class: 'empty'}, 'Loading…'))
      return
    }
    const rows = this.visible()
    if (rows.length === 0) {
      const filtered = this.filters.search || this.filters.domain
      replace(this.list, h('p', {class: 'empty'}, filtered ? 'No visits match these filters.' : 'No visits recorded for this selection.'))
      return
    }

    const total = rows.reduce((s, r) => s + (r.end - r.start), 0)
    const page = rows.slice(0, this.shown)
    const grouped = this.filters.scope !== 'day' && this.filters.sortKey === 'time'
    const showDate = this.filters.scope !== 'day' && !grouped

    const out: Array<HTMLElement> = [
      h('div', {class: 'history-meta'}, `${rows.length} ${rows.length === 1 ? 'record' : 'records'} · ${formatDuration(total)} total`),
      h('div', {class: 'row row-head', 'aria-hidden': 'true'}, h('span', {}, 'Website'), h('span', {}, showDate ? 'Date' : ''), h('span', {}, 'Start – End'), h('span', {class: 'num'}, 'Duration'))
    ]

    let lastDay = ''
    for (const seg of page) {
      if (grouped && seg.day !== lastDay) {
        lastDay = seg.day
        const dayRows = rows.filter((r) => r.day === seg.day)
        out.push(h('div', {class: 'group-head'}, h('strong', {}, formatDayShort(seg.start)),
          h('span', {}, `${dayRows.length} ${dayRows.length === 1 ? 'visit' : 'visits'} · ${formatDuration(dayRows.reduce((s, r) => s + (r.end - r.start), 0))}`)))
      }
      out.push(this.row(seg, showDate))
    }
    if (rows.length > page.length) {
      out.push(h('button', {class: 'btn', type: 'button', onclick: () => { this.shown += PAGE; this.renderList() }}, `Show more (${rows.length - page.length} remaining)`))
    }
    replace(this.list, ...out)
  }

  private row(seg: Segment, showDate: boolean) {
    const sel = this.selected?.visit.id === seg.visit.id && this.selected.start === seg.start
    return h(
      'div',
      {class: `row${sel ? ' is-selected' : ''}`},
      h('button', {class: 'row-domain', type: 'button', title: `Show only ${seg.domain}`, onclick: () => { this.setDomain(seg.domain); this.cb.onDomain(seg.domain) }},
        h('i', {class: 'dot', style: {background: domainColor(seg.domain)}}), seg.domain,
        seg.host !== seg.domain ? h('span', {class: 'row-host', title: seg.host}, seg.host.slice(0, seg.host.length - seg.domain.length - 1)) : null),
      h('span', {class: 'row-date'}, showDate ? dayKey(seg.start) : ''),
      h('button', {class: 'row-time', type: 'button', title: 'Show on timeline', onclick: () => this.cb.onSelect(seg)},
        `${formatClock(seg.start, this.hour12)} – ${formatClock(seg.end, this.hour12)}`,
        seg.continuesFromPrev ? h('span', {class: 'tag', title: 'Started the previous day'}, ' ← from prev. day') : null,
        seg.continuesToNext ? h('span', {class: 'tag', title: 'Continues the next day'}, ' to next day →') : null),
      h('span', {class: 'num'}, formatDuration(seg.end - seg.start))
    )
  }
}
