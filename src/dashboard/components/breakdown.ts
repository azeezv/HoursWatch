import {formatDuration} from '../../shared/time'
import type {DayStats} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

export function renderBreakdown(
  root: HTMLElement,
  stats: DayStats,
  activeDomain: string | null,
  onPick: (domain: string | null) => void
) {
  if (stats.breakdown.length === 0) {
    replace(root, h('p', {class: 'empty'}, 'Nothing tracked yet. Browse to a website with Chrome focused and it will show up here.'))
    return
  }
  const max = stats.breakdown[0].ms || 1
  replace(
    root,
    h(
      'ul',
      {class: 'breakdown'},
      ...stats.breakdown.map((d) => {
        const active = activeDomain === d.domain
        return h(
          'li',
          {class: `bd-row${active ? ' is-active' : ''}`},
          h(
            'button',
            {
              class: 'bd-main',
              type: 'button',
              'aria-pressed': active,
              title: active ? 'Clear website filter' : `Filter history and timeline to ${d.domain}`,
              onclick: () => onPick(active ? null : d.domain)
            },
            h('span', {class: 'bd-name'}, h('i', {class: 'dot', style: {background: domainColor(d.domain)}}), d.domain),
            h('span', {class: 'bd-time'}, formatDuration(d.ms)),
            h('span', {class: 'bd-pct'}, `${d.percent.toFixed(d.percent < 10 ? 1 : 0)}%`),
            h('span', {class: 'bd-visits'}, `${d.visits} ${d.visits === 1 ? 'visit' : 'visits'}`)
          ),
          h('div', {class: 'bd-bar', 'aria-hidden': 'true'}, h('div', {class: 'bd-fill', style: {width: `${(d.ms / max) * 100}%`, background: domainColor(d.domain)}}))
        )
      })
    )
  )
}
