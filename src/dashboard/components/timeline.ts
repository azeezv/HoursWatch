import {formatClock, formatDuration} from '../../shared/time'
import type {Segment} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

export interface TimelineInput {
  segments: Segment[]
  /** Local midnight at the start of the day; `dayEnd` is the next local midnight. */
  dayStart: number
  dayEnd: number
  /** Current time when viewing today, otherwise null. */
  now: number | null
  hour12: boolean
  highlightDomain: string | null
  selected: Segment | null
}

const ZOOMS = [1, 2, 4, 8, 16, 32, 64]
const TICK_MINUTES = [5, 10, 15, 30, 60, 120, 180, 360]
const MIN_LABEL_PX = 68

/**
 * Horizontal 24-hour timeline. Positions and widths are percentages of the
 * day's real length (23/24/25h on DST days), so blocks are proportional to
 * time. Zoom just widens the canvas inside a horizontally scrollable viewport.
 */
export class Timeline {
  readonly el: HTMLElement
  private scroll: HTMLElement
  private canvas: HTMLElement
  private axis: HTMLElement
  private track: HTMLElement
  private zoomLabel: HTMLElement
  private zoomOut: HTMLButtonElement
  private zoomIn: HTMLButtonElement
  private nowBtn: HTMLButtonElement
  private tooltip: HTMLElement
  private input: TimelineInput | null = null
  private zoom = 1
  private nowEl: HTMLElement | null = null

  constructor(private onSelect: (seg: Segment) => void) {
    this.zoomOut = h('button', {class: 'btn btn-icon', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => this.stepZoom(-1)}, '−')
    this.zoomIn = h('button', {class: 'btn btn-icon', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => this.stepZoom(1)}, '+')
    this.zoomLabel = h('span', {class: 'tl-zoom-label', 'aria-live': 'polite'}, '1×')
    this.nowBtn = h('button', {class: 'btn btn-small', type: 'button', onclick: () => this.scrollToNow()}, 'Jump to now')

    this.axis = h('div', {class: 'tl-axis', 'aria-hidden': 'true'})
    this.track = h('div', {class: 'tl-track', role: 'list', 'aria-label': 'Visits on this day'})
    this.canvas = h('div', {class: 'tl-canvas'}, this.axis, this.track)
    this.scroll = h('div', {class: 'tl-scroll', tabIndex: 0, 'aria-label': '24-hour timeline, scrollable'}, this.canvas)
    this.tooltip = h('div', {class: 'tl-tooltip', role: 'tooltip', hidden: true})

    const legend = h(
      'div',
      {class: 'tl-legend'},
      h('span', {class: 'tl-legend-item'}, h('i', {class: 'tl-swatch tl-swatch-active'}), 'Tracked browsing (color per website)'),
      h('span', {class: 'tl-legend-item'}, h('i', {class: 'tl-swatch tl-swatch-gap'}), 'No tracked browsing'),
      h('span', {class: 'tl-legend-item'}, h('i', {class: 'tl-swatch tl-swatch-now'}), 'Current time')
    )

    this.el = h(
      'div',
      {class: 'timeline'},
      h(
        'div',
        {class: 'tl-toolbar'},
        h('span', {class: 'tl-hint'}, 'Ctrl + scroll to zoom'),
        h('span', {class: 'tl-controls'}, this.nowBtn, this.zoomOut, this.zoomLabel, this.zoomIn)
      ),
      this.scroll,
      legend,
      this.tooltip
    )

    this.scroll.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        this.stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX)
      },
      {passive: false}
    )
    new ResizeObserver(() => this.layoutAxis()).observe(this.scroll)
  }

  update(input: TimelineInput) {
    const prevDay = this.input?.dayStart
    this.input = input
    this.renderTrack()
    this.layoutAxis()
    this.nowBtn.hidden = input.now === null
    if (prevDay !== input.dayStart) {
      this.scroll.scrollLeft = 0
      if (input.now !== null && this.zoom > 1) this.scrollToNow()
    }
  }

  /** Move only the "now" marker (called on a timer). */
  setNow(now: number | null) {
    if (!this.input) return
    this.input.now = now
    this.placeNow()
  }

  private span() {
    return (this.input?.dayEnd ?? 1) - (this.input?.dayStart ?? 0)
  }

  private pct(ts: number) {
    return ((ts - (this.input as TimelineInput).dayStart) / this.span()) * 100
  }

  private renderTrack() {
    const inp = this.input as TimelineInput
    const blocks = inp.segments.map((seg) => {
      const dim = inp.highlightDomain !== null && inp.highlightDomain !== seg.domain
      const selected = inp.selected?.visit.id === seg.visit.id && inp.selected.start === seg.start
      const label = `${seg.domain}, ${formatClock(seg.start, inp.hour12)} to ${formatClock(seg.end, inp.hour12)}, ${formatDuration(seg.end - seg.start)}`
      const b = h('button', {
        class: ['tl-block', dim && 'is-dim', selected && 'is-selected', seg.continuesFromPrev && 'cont-prev', seg.continuesToNext && 'cont-next']
          .filter(Boolean)
          .join(' '),
        type: 'button',
        role: 'listitem',
        'aria-label': label,
        'aria-pressed': selected,
        style: {
          left: `${this.pct(seg.start)}%`,
          width: `${((seg.end - seg.start) / this.span()) * 100}%`,
          background: domainColor(seg.domain)
        },
        onclick: () => this.onSelect(seg)
      })
      b.addEventListener('pointerenter', (e) => this.showTip(seg, e.clientX, e.clientY))
      b.addEventListener('pointermove', (e) => this.moveTip(e.clientX, e.clientY))
      b.addEventListener('pointerleave', () => this.hideTip())
      b.addEventListener('focus', () => {
        const r = b.getBoundingClientRect()
        this.showTip(seg, r.left + r.width / 2, r.top)
      })
      b.addEventListener('blur', () => this.hideTip())
      return b
    })

    this.nowEl = h('div', {class: 'tl-now', 'aria-hidden': 'true'}, h('span', {class: 'tl-now-label'}, 'Now'))
    replace(
      this.track,
      inp.segments.length === 0 ? h('div', {class: 'tl-empty'}, 'No tracked browsing on this day') : null,
      h('div', {class: 'tl-grid'}),
      ...blocks,
      this.nowEl
    )
    this.placeNow()
  }

  private placeNow() {
    const inp = this.input
    if (!this.nowEl || !inp) return
    const visible = inp.now !== null && inp.now >= inp.dayStart && inp.now <= inp.dayEnd
    this.nowEl.hidden = !visible
    if (visible) this.nowEl.style.left = `${this.pct(inp.now as number)}%`
  }

  /** Tick labels adapt to the zoomed width so they never overlap. */
  private layoutAxis() {
    const inp = this.input
    if (!inp) return
    const width = this.canvas.clientWidth || this.scroll.clientWidth
    const span = this.span()
    const pxPerMin = width / (span / 60_000)
    const step = TICK_MINUTES.find((m) => m * pxPerMin >= MIN_LABEL_PX) ?? 360
    const stepMs = step * 60_000

    const ticks: HTMLElement[] = []
    const lines: HTMLElement[] = []
    for (let t = inp.dayStart; t <= inp.dayEnd; t += stepMs) {
      const left = `${this.pct(t)}%`
      const isEnd = t === inp.dayEnd
      const isStart = t === inp.dayStart
      const label = isEnd && !inp.hour12 ? '24:00' : formatClock(t, inp.hour12, false)
      ticks.push(h('span', {class: `tl-tick${isStart ? ' is-first' : ''}${isEnd ? ' is-last' : ''}`, style: {left}}, label))
      lines.push(h('i', {class: 'tl-line', style: {left}}))
    }
    replace(this.axis, ...ticks)
    const grid = this.track.querySelector('.tl-grid')
    if (grid) replace(grid, ...lines)
  }

  private stepZoom(dir: 1 | -1, anchorClientX?: number) {
    const i = ZOOMS.indexOf(this.zoom)
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]
    if (next === this.zoom) return
    const rect = this.scroll.getBoundingClientRect()
    const anchorX = anchorClientX !== undefined ? anchorClientX - rect.left : rect.width / 2
    const frac = (this.scroll.scrollLeft + anchorX) / this.canvas.clientWidth
    this.zoom = next
    this.canvas.style.width = `${next * 100}%`
    this.zoomLabel.textContent = `${next}×`
    this.zoomOut.disabled = next === ZOOMS[0]
    this.zoomIn.disabled = next === ZOOMS[ZOOMS.length - 1]
    this.layoutAxis()
    this.scroll.scrollLeft = frac * this.canvas.clientWidth - anchorX
  }

  private scrollToNow() {
    const inp = this.input
    if (!inp || inp.now === null) return
    const x = (this.pct(inp.now) / 100) * this.canvas.clientWidth
    this.scroll.scrollTo({left: x - this.scroll.clientWidth / 2, behavior: 'smooth'})
  }

  // ---- tooltip ----

  private showTip(seg: Segment, x: number, y: number) {
    const inp = this.input as TimelineInput
    const v = seg.visit
    replace(
      this.tooltip,
      h('div', {class: 'tip-domain'}, h('i', {class: 'dot', style: {background: domainColor(seg.domain)}}), seg.domain),
      h('div', {}, `${formatClock(seg.start, inp.hour12)} – ${formatClock(seg.end, inp.hour12)}`),
      h('div', {class: 'tip-duration'}, formatDuration(seg.end - seg.start)),
      seg.continuesFromPrev || seg.continuesToNext
        ? h('div', {class: 'tip-note'}, `Visit crosses midnight (total ${formatDuration(v.durationMs)})`)
        : null
    )
    this.tooltip.hidden = false
    this.moveTip(x, y)
  }

  private moveTip(x: number, y: number) {
    const t = this.tooltip
    const host = this.el.getBoundingClientRect()
    const w = t.offsetWidth
    const left = Math.min(Math.max(x - host.left + 12, 0), host.width - w)
    t.style.left = `${left}px`
    t.style.top = `${y - host.top - t.offsetHeight - 14}px`
  }

  private hideTip() {
    this.tooltip.hidden = true
  }
}
