import {dayKey, formatClock, formatDayShort, formatDuration} from '../../shared/time'
import type {Segment} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

const pair = (label: string, value: string) => h('div', {}, h('dt', {}, label), h('dd', {}, value))

export function renderDetails(
  root: HTMLElement,
  seg: Segment | null,
  hour12: boolean,
  actions: {onFilter(domain: string): void; onClose(): void}
) {
  root.hidden = seg === null
  if (!seg) {
    replace(root)
    return
  }
  const v = seg.visit
  const vEnd = v.endTime ?? v.startTime + v.durationMs
  const crosses = seg.continuesFromPrev || seg.continuesToNext
  const stamp = (t: number) => `${formatDayShort(t)}, ${formatClock(t, hour12)}`
  replace(
    root,
    h(
      'div',
      {class: 'details'},
      h('div', {class: 'details-title'}, h('i', {class: 'dot', style: {background: domainColor(seg.domain)}}), h('strong', {}, seg.domain), v.endTime === null ? h('span', {class: 'badge badge-live'}, 'In progress') : null),
      h(
        'dl',
        {},
        seg.host !== seg.domain ? pair('Hostname', seg.host) : null,
        pair('Date', dayKey(seg.start)),
        pair('Start', formatClock(seg.start, hour12)),
        pair('End', formatClock(seg.end, hour12)),
        pair('Duration', formatDuration(seg.end - seg.start))
      ),
      crosses ? h('p', {class: 'note'}, `This visit crosses midnight: it ran ${stamp(v.startTime)} → ${stamp(vEnd)} (${formatDuration(v.durationMs)} in total) and is split across days.`) : null,
      h(
        'div',
        {class: 'details-actions'},
        h('button', {class: 'btn btn-small', type: 'button', onclick: () => actions.onFilter(seg.domain)}, `Filter to ${seg.domain}`),
        h('button', {class: 'btn btn-small', type: 'button', onclick: actions.onClose}, 'Close')
      )
    )
  )
}
