import {coreDomains} from '../../shared/stats'
import {formatDuration} from '../../shared/time'
import type {DayStats} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace, type Child} from '../dom'
import {icon, type IconName} from '../icons'

type Tone = 'blue' | 'amber' | 'violet'

function card(label: string, badge: Node, body: Child[]) {
  return h('div', {class: 'card'}, h('div', {class: 'card-top'}, h('div', {class: 'card-label'}, label), badge), ...body)
}

const iconBadge = (name: IconName, tone: Tone) => h('span', {class: `card-badge tone-${tone}`}, icon(name))

/** A site's letter tile, in its timeline color. */
const avatar = (domain: string) => h('span', {class: 'avatar', style: {background: domainColor(domain)}, 'aria-hidden': 'true'}, domain.charAt(0).toUpperCase())

/** "Avg 1m 39s per visit" with the numbers emphasised. */
function emphasised(text: string): Child[] {
  return text.split(/(\d+[hms])/g).map((part) => (/^\d+[hms]$/.test(part) ? h('b', {}, part) : part))
}

export interface SummaryContext {
  /** Tracked time over the comparison period (yesterday, to the same time of day when viewing today); null if none. */
  prevTotalMs: number | null
  /** Rounded percent change vs that period, or null. */
  change: number | null
  /** "yesterday" / "previous day" */
  prevLabel: string
}

function trend(ctx: SummaryContext): Node {
  if (ctx.change === null) return h('div', {class: 'card-sub'}, 'Time with a focused, active tab')
  const up = ctx.change > 0
  const flat = ctx.change === 0
  const text = `${up ? '+' : ctx.change < 0 ? '−' : ''}${Math.abs(ctx.change)}%`
  return h(
    'div',
    {class: 'card-sub'},
    h('span', {class: `trend ${flat ? 'is-flat' : up ? 'is-up' : 'is-down'}`}, flat ? null : icon(up ? 'up' : 'down', 13), text),
    ` vs ${ctx.prevLabel}`
  )
}

export function renderSummary(root: HTMLElement, s: DayStats, ctx: SummaryContext) {
  const top = s.topByTime
  const most = s.topByVisits
  const core = s.uniqueDomains >= 3 ? coreDomains(s.breakdown) : null
  const siteCard = (label: string, d: typeof top, left: string, right: string | null) =>
    h(
      'div',
      {class: 'card'},
      h('div', {class: 'card-top'}, h('div', {class: 'card-label'}, label), d ? avatar(d.domain) : null),
      h('div', {class: 'card-value card-site-name', title: d?.domain}, d ? d.domain : '—'),
      d ? h('div', {class: 'card-sub card-split'}, h('b', {}, left), right ? h('span', {}, right) : null) : null
    )

  replace(
    root,
    card('Total tracked time', iconBadge('timer', 'blue'), [h('div', {class: 'card-value'}, formatDuration(s.totalMs)), trend(ctx)]),
    card('Website visits', iconBadge('click', 'blue'), [
      h('div', {class: 'card-value'}, String(s.visitCount)),
      s.visitCount ? h('div', {class: 'card-sub'}, ...emphasised(`Avg ${formatDuration(s.avgMs)} per visit`)) : null
    ]),
    card('Unique websites', iconBadge('globe', 'violet'), [
      h('div', {class: 'card-value'}, String(s.uniqueDomains)),
      core ? h('div', {class: 'card-sub'}, h('b', {}, `${core.count} core ${core.count === 1 ? 'domain' : 'domains'}`), ` (${core.percent.toFixed(0)}% time)`) : null
    ]),
    siteCard('Most time on', top, top ? formatDuration(top.ms) : '', top ? `${top.percent.toFixed(0)}% of total` : null),
    siteCard('Most visited', most, most ? `${most.visits} ${most.visits === 1 ? 'visit' : 'visits'}` : '', most ? `Avg ${formatDuration(most.ms / Math.max(1, most.visits))}` : null),
    // Only surfaces if records ever overlap, which tracking is built to prevent.
    s.sumMs !== s.totalMs
      ? h('p', {class: 'note card-wide'}, `Overlapping records detected: tracked time counts shared periods once (${formatDuration(s.totalMs)}); the sum of visit durations is ${formatDuration(s.sumMs)}.`)
      : null
  )
}
