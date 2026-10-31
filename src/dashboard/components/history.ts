import {foldConsecutive} from '../../shared/stats'
import {dayKey, formatClock, formatDayShort, formatDuration} from '../../shared/time'
import type {Segment} from '../../shared/types'
import {domainColor} from '../colors'
import {debounce, h, replace} from '../dom'
import {icon} from '../icons'

/** `day` = the period selected in the header (one day or a range). */
export type Scope = 'day' | 'all'
export type SortKey = 'time' | 'duration' | 'domain'

export interface HistoryFilters {
  scope: Scope
  search: string
  domain: string | null
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
}

const PAGE = 200
/** Visits at least this long are highlighted. */
const LONG_MS = 60_000

const defaults = (): HistoryFilters => ({
  scope: 'day',
  search: '',
  domain: null,
  sortKey: 'time',
  sortDir: 'desc'
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
    h('option', {value: 'all'}, 'All history'))
  private sub = h('p', {class: 'panel-sub'})
  private reset_ = h('button', {class: 'btn btn-icon', type: 'button', title: 'Reset filters', 'aria-label': 'Reset filters'}, icon('reset', 16))
  private expandedGroups = new Set<string>()
  /** True when the "selected day" scope covers several days (week view). */
  private multiDay = false
  private chip = h('div', {class: 'chip-row'})
  private list = h('div', {class: 'history-list'})

  constructor(
    private cb: {
      /** Scope or range changed: the host must load different data. */
      onReload(): void
      onSelect(seg: Segment): void
      /** Domain filter changed from inside the list. */
      onDomain(domain: string | null): void
    }
  ) {
    this.filters = defaults()
    const rerender = () => {
      this.shown = PAGE
      this.renderList()
    }
    const debounced = debounce(() => {
      this.filters.search = this.search.value.trim().toLowerCase()
      rerender()
    }, 80)
    this.search.addEventListener('input', debounced)
    this.scope.addEventListener('change', () => {
      this.filters.scope = this.scope.value as Scope
      this.syncControls()
      this.cb.onReload()
    })
    this.reset_.addEventListener('click', () => this.reset())
    this.el = h(
      'div',
      {class: 'history'},
      h('div', {class: 'panel-head panel-head-wrap'},
        h('div', {}, h('h2', {id: 'h-history'}, 'Visit history'), this.sub),
        h('div', {class: 'filters'},
          h('span', {class: 'search-wrap'}, icon('search', 15), this.search),
          this.scope, this.reset_)),
      this.chip,
      this.list
    )
    this.syncControls()
  }

  setDomain(domain: string | null) {
    this.filters.domain = domain
    this.shown = PAGE
    this.syncControls()
    this.renderList()
  }

  reset() {
    const hadScope = this.filters.scope !== 'day'
    this.filters = defaults()
    this.search.value = ''
    this.syncControls()
    this.cb.onDomain(null)
    if (hadScope) this.cb.onReload()
    else this.renderList()
  }

  /** Week view: the default scope spans the week instead of one day. */
  setPeriod(multiDay: boolean) {
    if (multiDay === this.multiDay) return
    this.multiDay = multiDay
    this.scope.options[0].textContent = multiDay ? 'Selected range' : 'Selected day'
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
    const total = rows.reduce((t, r) => t + (r.end - r.start), 0)
    const f = this.filters
    const where = f.scope === 'day' ? (this.multiDay ? 'in the selected range' : 'for the selected day') : 'in all history'
    const narrowed = f.search || f.domain
    this.sub.textContent = rows.length === 0
      ? 'No detailed logs'
      : `${rows.length}${narrowed ? ` of ${this.segments.length}` : ''} detailed ${rows.length === 1 ? 'log' : 'logs'} ${where} · ${formatDuration(total)} total`

    if (rows.length === 0) {
      replace(this.list, h('p', {class: 'empty'}, narrowed ? 'No visits match these filters.' : 'No visits recorded for this selection.'))
      return
    }

    const items = this.items(rows)
    const page = items.slice(0, this.shown)
    const multi = f.scope !== 'day' || this.multiDay
    const byDay = multi && f.sortKey === 'time'
    const showDate = multi && !byDay

    const out: Array<HTMLElement> = [
      h('div', {class: 'row row-head'},
        this.sortHead('Website', 'domain'),
        h('span', {}, showDate ? 'Date' : ''),
        this.sortHead('Time interval', 'time'),
        this.sortHead('Duration', 'duration', 'num'))
    ]

    let lastDay = ''
    for (const item of page) {
      const first = item.segs[0]
      if (byDay && first.day !== lastDay) {
        lastDay = first.day
        const dayRows = rows.filter((r) => r.day === first.day)
        out.push(h('div', {class: 'group-head'}, h('strong', {}, formatDayShort(first.start)),
          h('span', {}, `${dayRows.length} ${dayRows.length === 1 ? 'visit' : 'visits'} · ${formatDuration(dayRows.reduce((t, r) => t + (r.end - r.start), 0))}`)))
      }
      if (item.segs.length === 1) out.push(this.row(first, showDate))
      else out.push(...this.groupRows(item.segs, showDate))
    }
    if (items.length > page.length) {
      out.push(h('button', {class: 'btn', type: 'button', onclick: () => { this.shown += PAGE; this.renderList() }}, `Show more (${items.length - page.length} remaining)`))
    }
    replace(this.list, ...out)
  }

  /** Back-to-back visits to the same website on the same day fold into one expandable row (time order only). */
  private items(rows: Segment[]): Array<{segs: Segment[]}> {
    if (this.filters.sortKey !== 'time') return rows.map((seg) => ({segs: [seg]}))
    return foldConsecutive(rows).map((segs) => ({segs}))
  }

  /** A clickable column title that sorts by that column (click again to reverse). */
  private sortHead(label: string, key: SortKey, cls = '') {
    const f = this.filters
    const on = f.sortKey === key
    return h('button', {
      class: `sort-head${on ? ' is-on' : ''} ${cls}`.trim(),
      type: 'button',
      'aria-label': `Sort by ${label}${on ? (f.sortDir === 'asc' ? ', ascending' : ', descending') : ''}`,
      onclick: () => {
        if (on) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc'
        else { f.sortKey = key; f.sortDir = key === 'domain' ? 'asc' : 'desc' }
        this.shown = PAGE
        this.renderList()
      }
    }, label, on ? h('span', {class: 'sort-arrow', 'aria-hidden': 'true'}, f.sortDir === 'asc' ? '↑' : '↓') : null)
  }

  private nameCell(seg: Segment, tag: string | null) {
    return h('button', {class: 'row-domain', type: 'button', title: `Show only ${seg.domain}`, onclick: () => { this.setDomain(seg.domain); this.cb.onDomain(seg.domain) }},
      h('i', {class: 'dot dot-round', style: {background: domainColor(seg.domain)}}), seg.domain,
      tag ? h('span', {class: 'tag', title: seg.host}, tag) : null)
  }

  private groupRows(segs: Segment[], showDate: boolean): HTMLElement[] {
    const head = segs[0]
    const key = `${head.visit.id}:${head.start}`
    const open = this.expandedGroups.has(key)
    const start = Math.min(...segs.map((s) => s.start))
    const end = Math.max(...segs.map((s) => s.end))
    const total = segs.reduce((t, s) => t + (s.end - s.start), 0)
    const hosts = new Set(segs.map((s) => s.host))
    const sub = (s: Segment) => (s.host !== s.domain ? s.host.slice(0, s.host.length - s.domain.length - 1) : null)
    const tag = hosts.size === 1 ? sub(head) : null
    const hasSel = segs.some((s) => this.selected?.visit.id === s.visit.id && this.selected.start === s.start)

    const row = h('div', {class: `row row-group${hasSel && !open ? ' is-selected' : ''}`},
      h('div', {class: 'row-name'},
        h('button', {class: `bd-toggle${open ? ' is-open' : ''}`, type: 'button', 'aria-expanded': open,
          'aria-label': `${open ? 'Hide' : 'Show'} ${segs.length} visits to ${head.domain}`,
          onclick: () => { if (open) this.expandedGroups.delete(key); else this.expandedGroups.add(key); this.renderList() }}),
        this.nameCell(head, tag)),
      h('span', {class: 'row-date'}, showDate ? dayKey(head.start) : ''),
      h('span', {class: 'row-time mono'}, `${formatClock(start, this.hour12)} – ${formatClock(end, this.hour12)}`),
      h('span', {class: 'num row-total'}, h('span', {class: 'pill pill-strong'}, `${segs.length} visits`), h('span', {class: `mono dur${total >= LONG_MS ? ' dur-long' : ''}`}, `${formatDuration(total)} total`)))
    if (!open) return [row]
    return [row, ...segs.map((s) => this.row(s, showDate, true, hosts.size > 1 ? sub(s) ?? s.host : null))]
  }

  private row(seg: Segment, showDate: boolean, child = false, tagOverride?: string | null) {
    const sel = this.selected?.visit.id === seg.visit.id && this.selected.start === seg.start
    const sub = seg.host !== seg.domain ? seg.host.slice(0, seg.host.length - seg.domain.length - 1) : null
    const ms = seg.end - seg.start
    return h(
      'div',
      {class: `row${child ? ' row-child' : ''}${sel ? ' is-selected' : ''}`},
      child ? h('span', {class: 'row-name row-name-child'}, tagOverride ? h('span', {class: 'tag', title: seg.host}, tagOverride) : null) : h('div', {class: 'row-name'}, h('span', {class: 'bd-toggle-gap', 'aria-hidden': 'true'}), this.nameCell(seg, sub)),
      h('span', {class: 'row-date'}, showDate ? dayKey(seg.start) : ''),
      h('button', {class: 'row-time mono', type: 'button', title: 'Show on timeline', onclick: () => this.cb.onSelect(seg)},
        `${formatClock(seg.start, this.hour12)} – ${formatClock(seg.end, this.hour12)}`,
        seg.continuesFromPrev ? h('span', {class: 'tag', title: 'Started the previous day'}, ' ← from prev. day') : null,
        seg.continuesToNext ? h('span', {class: 'tag', title: 'Continues the next day'}, ' to next day →') : null),
      h('span', {class: `num mono dur${ms >= LONG_MS ? ' dur-long' : ''}`}, formatDuration(ms))
    )
  }
}
