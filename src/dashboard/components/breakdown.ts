import {formatDuration} from '../../shared/time'
import type {DayStats, DomainStat} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

/** Websites whose subdomain list is open; survives re-renders. */
const expanded = new Set<string>()

/** True when the entry is made of more than just its own name (subdomains to show). */
const hasSubdomains = (d: DomainStat) => d.hosts.length > 1 || (d.hosts.length === 1 && d.hosts[0].host !== d.domain)

export function renderBreakdown(
  root: HTMLElement,
  stats: DayStats,
  activeDomain: string | null,
  onPick: (domain: string | null) => void,
  rerender: () => void = () => renderBreakdown(root, stats, activeDomain, onPick)
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
        const subs = hasSubdomains(d)
        const open = subs && expanded.has(d.domain)
        const toggle = subs
          ? h('button', {
              class: `bd-toggle${open ? ' is-open' : ''}`,
              type: 'button',
              'aria-expanded': open,
              'aria-label': `${open ? 'Hide' : 'Show'} subdomains of ${d.domain}`,
              title: `${open ? 'Hide' : 'Show'} ${d.hosts.length} ${d.hosts.length === 1 ? 'hostname' : 'hostnames'}`,
              onclick: () => {
                if (open) expanded.delete(d.domain)
                else expanded.add(d.domain)
                rerender()
              }
            })
          : h('span', {class: 'bd-toggle-gap', 'aria-hidden': 'true'})
        return h(
          'li',
          {class: `bd-row${active ? ' is-active' : ''}`},
          h('div', {class: 'bd-line'}, toggle, h(
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
          )),
          h('div', {class: 'bd-bar', 'aria-hidden': 'true'}, h('div', {class: 'bd-fill', style: {width: `${(d.ms / max) * 100}%`, background: domainColor(d.domain)}})),
          open
            ? h('ul', {class: 'bd-hosts', 'aria-label': `Hostnames under ${d.domain}`},
                ...d.hosts.map((x) =>
                  h('li', {class: 'bd-host'},
                    h('span', {class: 'bd-host-name', title: x.host}, x.host === d.domain ? `${x.host} (main)` : x.host),
                    h('span', {class: 'bd-time'}, formatDuration(x.ms)),
                    h('span', {class: 'bd-pct'}, `${x.percent.toFixed(x.percent < 10 ? 1 : 0)}%`),
                    h('span', {class: 'bd-visits'}, `${x.visits} ${x.visits === 1 ? 'visit' : 'visits'}`),
                    h('div', {class: 'bd-bar bd-host-bar', 'aria-hidden': 'true'}, h('div', {class: 'bd-fill', style: {width: `${x.percent}%`, background: domainColor(d.domain)}}))
                  )))
            : null
        )
      })
    )
  )
}
