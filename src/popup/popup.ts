import {sendMessage} from '../background/messages'
import {assignColors, domainColor, initColors} from '../dashboard/colors'
import {h, replace} from '../dashboard/dom'
import {normalizeSettings} from '../shared/settings'
import {computeStats, groupSegments, segmentsForRange} from '../shared/stats'
import {addDays, formatClock, formatDuration, startOfDay} from '../shared/time'
import type {Settings, TrackerState} from '../shared/types'
import {chromeStore, KEYS} from '../storage/store'
import {normalizeTracker} from '../storage/tracker-state'
import {VisitRepo} from '../storage/visit-repo'

// Tells the worker the popup is showing, so the focus change caused by opening
// it is not mistaken for leaving the browser.
chrome.runtime.connect({name: 'popup'})

const store = chromeStore()
const repo = new VisitRepo(store)
const root = document.getElementById('root') as HTMLElement
let ticker: ReturnType<typeof setInterval> | undefined

async function load() {
  // Ask the worker to checkpoint the open visit so numbers are current.
  await sendMessage({type: 'sync'})
  const dayStart = startOfDay(Date.now())
  const dayEnd = addDays(dayStart, 1)
  const [raw, visits] = await Promise.all([store.get([KEYS.settings, KEYS.tracker]), repo.getRange(dayStart, dayEnd)])
  const settings: Settings = normalizeSettings(raw[KEYS.settings])
  const tracker: TrackerState = normalizeTracker(raw[KEYS.tracker])
  const segs = groupSegments(segmentsForRange(visits, dayStart, dayEnd), settings.groupSubdomains)
  await initColors()
  await assignColors(computeStats(segs).breakdown.map((d) => d.domain))
  render(settings, tracker, dayStart, dayEnd, segs)
}

function render(settings: Settings, tracker: TrackerState, dayStart: number, dayEnd: number, segs: ReturnType<typeof segmentsForRange>) {
  const stats = computeStats(segs)
  const loadedAt = Date.now()
  const live = tracker.trackingActive

  const total = h('b', {}, formatDuration(stats.totalMs))
  const status = h('div', {class: 'pp-status', role: 'status'},
    h('i', {class: `pp-pulse${live ? ' is-on' : ''}`}),
    live
      ? h('span', {}, 'Tracking ', h('strong', {}, tracker.domain ?? ''))
      : h('span', {}, settings.trackingEnabled ? 'Not tracking this page' : 'Tracking is paused'))

  const span = dayEnd - dayStart
  const strip = h('div', {class: 'pp-strip', 'aria-hidden': 'true'},
    ...segs.map((s) => h('i', {style: {left: `${((s.start - dayStart) / span) * 100}%`, width: `${((s.end - s.start) / span) * 100}%`, background: domainColor(s.domain)}})),
    h('div', {class: 'tl-now', style: {left: `${((Date.now() - dayStart) / span) * 100}%`}}))

  const toggle = h('button', {class: 'btn', type: 'button', onclick: async () => {
    await store.set({[KEYS.settings]: {...settings, trackingEnabled: !settings.trackingEnabled}})
    void load()
  }}, settings.trackingEnabled ? 'Pause' : 'Resume')

  replace(root, h('div', {class: 'pp'},
    h('div', {class: 'pp-head'}, h('div', {class: 'pp-brand'}, 'HoursWatch'), h('span', {class: 'note'}, formatClock(Date.now(), settings.hour12, false))),
    status,
    h('div', {class: 'pp-stats'},
      h('div', {class: 'pp-stat'}, total, h('span', {}, 'Today')),
      h('div', {class: 'pp-stat'}, h('b', {}, String(stats.visitCount)), h('span', {}, 'Visits')),
      h('div', {class: 'pp-stat'}, h('b', {}, String(stats.uniqueDomains)), h('span', {}, 'Sites'))),
    h('div', {}, strip, h('div', {class: 'pp-axis'}, h('span', {}, '00'), h('span', {}, '06'), h('span', {}, '12'), h('span', {}, '18'), h('span', {}, '24'))),
    stats.breakdown.length
      ? h('div', {}, h('h2', {class: 'pp-h'}, 'Top websites today'),
          h('ul', {class: 'pp-list'}, ...stats.breakdown.slice(0, 5).map((d) =>
            h('li', {}, h('span', {class: 'name'}, h('i', {class: 'dot', style: {background: domainColor(d.domain)}}), d.domain), h('span', {}, formatDuration(d.ms)),
              h('div', {class: 'bd-bar'}, h('div', {class: 'bd-fill', style: {width: `${(d.ms / stats.breakdown[0].ms) * 100}%`, background: domainColor(d.domain)}}))))))
      : h('p', {class: 'note'}, 'Nothing tracked yet today.'),
    h('div', {class: 'pp-actions'},
      h('button', {class: 'btn btn-primary', type: 'button', onclick: () => { void chrome.runtime.openOptionsPage(); window.close() }}, 'Open dashboard'),
      toggle)))

  // Tick the visible total while the open visit is accruing (display only).
  clearInterval(ticker)
  if (live) {
    ticker = setInterval(() => {
      total.textContent = formatDuration(stats.totalMs + (Date.now() - loadedAt))
    }, 1000)
  }
}

load().catch((e) => {
  replace(root, h('div', {class: 'pp'}, h('p', {class: 'error', role: 'alert'}, `Could not load data: ${e instanceof Error ? e.message : e}`)))
})
