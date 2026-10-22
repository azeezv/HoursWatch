import {formatDuration} from '../../shared/time'
import type {DayStats} from '../../shared/types'
import {domainColor} from '../colors'
import {h, replace} from '../dom'

function card(label: string, value: string, sub?: string, color?: string) {
  return h(
    'div',
    {class: 'card'},
    h('div', {class: 'card-label'}, label),
    h('div', {class: 'card-value'}, color ? h('i', {class: 'dot', style: {background: color}}) : null, value),
    sub ? h('div', {class: 'card-sub'}, sub) : null
  )
}

export function renderSummary(root: HTMLElement, s: DayStats) {
  const top = s.topByTime
  const most = s.topByVisits
  replace(
    root,
    card('Total tracked time', formatDuration(s.totalMs), 'Time with a focused, active website tab'),
    card('Website visits', String(s.visitCount), s.visitCount ? `Avg ${formatDuration(s.avgMs)} per visit` : undefined),
    card('Unique websites', String(s.uniqueDomains)),
    card('Most time on', top ? top.domain : '—', top ? `${formatDuration(top.ms)} · ${top.percent.toFixed(0)}%` : undefined, top ? domainColor(top.domain) : undefined),
    card('Most visits', most ? most.domain : '—', most ? `${most.visits} ${most.visits === 1 ? 'visit' : 'visits'}` : undefined, most ? domainColor(most.domain) : undefined),
    // Only surfaces if records ever overlap, which tracking is built to prevent.
    s.sumMs !== s.totalMs
      ? h('p', {class: 'note card-wide'}, `Overlapping records detected: tracked time counts shared periods once (${formatDuration(s.totalMs)}); the sum of visit durations is ${formatDuration(s.sumMs)}.`)
      : null
  )
}
