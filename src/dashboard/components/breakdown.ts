import {formatDuration} from '../../shared/time'
import type {DayStats, DomainStat} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

/** How many websites are listed until "View all" is pressed. */
const TOP = 6

/** Websites whose subdomain list is open; survives re-renders. */
const expanded = new Set<string>()
let showAll = false

/** True when the entry is made of more than just its own name (subdomains to show). */
const hasSubdomains = (d: DomainStat) => d.hosts.length > 1 || (d.hosts.length === 1 && d.hosts[0].host !== d.domain)

const pct = (p: number) => `${p.toFixed(p < 10 ? 1 : 0)}%`
const visitsText = (n: number) => `${n} ${n === 1 ? 'visit' : 'visits'}`

export function renderBreakdown(
  root: HTMLElement,
  stats: DayStats,
  activeDomain: string | null,
  onPick: (domain: string | null) => void
) {
  const again = () => renderBreakdown(root, stats, activeDomain, onPick)
  const all = stats.breakdown
  const canExpand = all.length > TOP
  const list = showAll || !canExpand ? all : all.slice(0, TOP)

  const head = h(
    'div',
    {class: 'panel-head'},
    h('div', {}, h('h2', {id: 'h-breakdown'}, 'Website breakdown'), h('p', {class: 'panel-sub'}, 'Ranked by total accumulated time')),
    canExpand
      ? h('button', {class: 'link-btn', type: 'button', 'aria-expanded': showAll, onclick: () => { showAll = !showAll; again() }}, showAll ? 'Show top 6' : 'View all')
      : null
  )

  if (all.length === 0) {
    replace(root, head, h('p', {class: 'empty'}, 'Nothing tracked yet. Browse to a website with Chrome focused and it will show up here.'))
    return
  }

  const max = all[0].ms || 1
  replace(
    root,
    head,
    h(
      'ul',
      {class: 'breakdown'},
      ...list.map((d) => {
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
                again()
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
            h('span', {class: 'bd-name'}, h('i', {class: 'dot dot-round', style: {background: domainColor(d.domain)}}), d.domain),
            h('span', {class: 'bd-time'}, formatDuration(d.ms)),
            h('span', {class: 'bd-pct'}, pct(d.percent)),
            h('span', {class: 'pill'}, visitsText(d.visits))
          )),
          h('div', {class: 'bd-bar', 'aria-hidden': 'true'}, h('div', {class: 'bd-fill', style: {width: `${(d.ms / max) * 100}%`, background: domainColor(d.domain)}})),
          open
            ? h('ul', {class: 'bd-hosts', 'aria-label': `Hostnames under ${d.domain}`},
                ...d.hosts.map((x) =>
                  h('li', {class: 'bd-host'},
                    h('span', {class: 'bd-host-name', title: x.host}, x.host === d.domain ? `${x.host} (main)` : x.host),
                    h('span', {class: 'bd-time'}, formatDuration(x.ms)),
                    h('span', {class: 'bd-pct'}, pct(x.percent)),
                    h('span', {class: 'bd-visits'}, visitsText(x.visits)),
                    h('div', {class: 'bd-bar bd-host-bar', 'aria-hidden': 'true'}, h('div', {class: 'bd-fill', style: {width: `${x.percent}%`, background: domainColor(d.domain)}}))
                  )))
            : null
        )
      })
    ),
    h('div', {class: 'panel-foot'},
      h('span', {}, list.length === all.length ? `Showing all ${all.length} ${all.length === 1 ? 'website' : 'websites'}` : `Showing top ${list.length} of ${all.length} websites`),
      h('span', {class: 'mono'}, `Total ${formatDuration(stats.totalMs)}`))
  )
}
