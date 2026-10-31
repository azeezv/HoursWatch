import {sendMessage} from '../background/messages'
import {DEFAULT_SETTINGS} from '../shared/settings'
import {clipSegmentsTo, computeStats, groupSegments, percentChange} from '../shared/stats'
import {lastDays, rangeLength, shiftRange} from '../shared/range'
import {addDays, dayKey, startOfDay} from '../shared/time'
import type {Segment, Settings} from '../shared/types'
import {assignColors, initColors} from './colors'
import {Data} from './data'
import {$, debounce} from './dom'
import {renderBreakdown} from './components/breakdown'
import {renderDetails} from './components/details'
import {openExportDialog, openSettingsDialog} from './components/dialogs'
import {Header} from './components/header'
import {History} from './components/history'
import {renderSummary, type SummaryContext} from './components/summary'
import {Timeline} from './components/timeline'
import {renderWeek} from './components/week'

const data = new Data()
let settings: Settings = DEFAULT_SETTINGS
/** Selected days, inclusive, local midnights. A single day has `from === to`. */
let from = startOfDay(Date.now())
let to = from
/** Segments of the selected period. */
let periodSegs: Segment[] = []
let domainFilter: string | null = null
let selected: Segment | null = null
let firstDay: number | null = null
let loadToken = 0
let summaryCtx: SummaryContext = {prevTotalMs: null, change: null, prevLabel: 'yesterday'}

const alertEl = $('#alert')
const showError = (msg: string | null) => {
  alertEl.hidden = msg === null
  alertEl.textContent = msg ?? ''
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme
}

/** The theme actually showing (resolves "match system"). */
function effectiveTheme(): 'light' | 'dark' {
  if (settings.theme !== 'system') return settings.theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const isRange = () => from !== to

const header = new Header({
  onPrev: () => goTo(...shiftRange(from, to, -1, startOfDay(Date.now()))),
  onNext: () => goTo(...shiftRange(from, to, 1, startOfDay(Date.now()))),
  onToday: () => goTo(startOfDay(Date.now()), startOfDay(Date.now())),
  onYesterday: () => goTo(addDays(startOfDay(Date.now()), -1), addDays(startOfDay(Date.now()), -1)),
  onWeek: () => goTo(...lastDays(7, startOfDay(Date.now()))),
  onRange: (f, t) => goTo(f, t),
  onTheme: () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark'
    settings = {...settings, theme: next}
    applyTheme()
    render()
    void data.saveSettings(settings)
  },
  onExport: () => openExportDialog(data, from, to),
  onSettings: () =>
    openSettingsDialog(data, settings, {
      onSaved: (s) => {
        settings = s
        applyTheme()
        void refresh() // grouping changes what every list shows
      },
      onDeleted: () => {
        selected = null
        void refresh()
      }
    })
})
$('#header').replaceWith(header.el)

const timeline = new Timeline((seg) => select(seg))
$('#timeline').append(timeline.el)

const history = new History({
  onReload: () => void loadHistory(),
  onSelect: (seg) => select(seg),
  onDomain: (d) => setDomain(d)
})
$('#history').append(history.el)

function goTo(nextFrom: number, nextTo: number) {
  const today = startOfDay(Date.now())
  to = Math.min(startOfDay(nextTo), today)
  from = Math.min(startOfDay(nextFrom), to)
  selected = null
  void refresh()
}

function setDomain(d: string | null) {
  domainFilter = d
  history.setDomain(d)
  render()
}

function select(seg: Segment | null) {
  // A visit is shown on the 24-hour timeline, so leave the range view for its day.
  if (seg && (isRange() || startOfDay(seg.start) !== from)) {
    from = to = startOfDay(seg.start)
    selected = seg
    void refresh()
    return
  }
  selected = seg
  render()
}

/** Re-render everything that depends on already loaded data (cheap, synchronous). */
function render() {
  const today = startOfDay(Date.now())
  const stats = computeStats(periodSegs)
  const week = isRange()
  header.update({from, to, today, minDay: firstDay, theme: effectiveTheme()})
  renderSummary($('#summary'), stats, {...summaryCtx, change: percentChange(stats.totalMs, summaryCtx.prevTotalMs ?? 0)})

  $('#h-timeline').textContent = week ? 'Daily totals' : '24-hour timeline'
  $('#timeline').hidden = week
  $('#week').hidden = !week
  if (week) {
    const byDay = new Map<string, Segment[]>()
    for (const seg of periodSegs) byDay.set(seg.day, [...(byDay.get(seg.day) ?? []), seg])
    const totals = Array.from({length: rangeLength(from, to)}, (_, i) => {
      const d = addDays(from, i)
      return {day: d, totalMs: computeStats(byDay.get(dayKey(d)) ?? []).totalMs}
    })
    renderWeek($('#week'), totals, today, (d) => goTo(d, d))
    renderDetails($('#details'), null, settings.hour12, {onFilter: () => {}, onClose: () => {}})
  } else {
    timeline.update({
      segments: periodSegs,
      dayStart: from,
      dayEnd: addDays(from, 1),
      now: from === today ? Date.now() : null,
      hour12: settings.hour12,
      highlightDomain: domainFilter,
      selected
    })
    renderDetails($('#details'), selected, settings.hour12, {
      onFilter: (d) => setDomain(d),
      onClose: () => select(null)
    })
  }
  renderBreakdown($('#breakdown'), stats, domainFilter, setDomain)
  history.setPeriod(week)
  history.setData(history.filters.scope === 'day' ? periodSegs : historySegs, settings.hour12, selected)
}

let historySegs: Segment[] = []

/** (Re)load the segments backing the history list for its current scope. */
async function loadHistory() {
  const token = ++loadToken
  const f = history.filters
  if (f.scope === 'day') {
    history.setData(periodSegs, settings.hour12, selected)
    return
  }
  history.setLoading(true)
  try {
    const raw = await data.all()
    const segs = groupSegments(raw, settings.groupSubdomains)
    if (token !== loadToken) return // a newer request superseded this one
    await assignColors(computeStats(segs).breakdown.map((d) => d.domain))
    historySegs = segs
    history.setData(segs, settings.hour12, selected)
  } catch (e) {
    if (token === loadToken) history.setError(`Could not load history: ${e instanceof Error ? e.message : e}`)
  }
}

async function refresh() {
  try {
    showError(null)
    const len = rangeLength(from, to)
    const prevFrom = addDays(from, -len)
    const load = (a: number, b: number) => (a === b ? data.day(a) : data.range(a, b))
    const [from0, to0] = [from, to] // the selection can change while loading
    const [s, rawPeriod, first, rawPrev] = await Promise.all([data.settings(), load(from0, to0), data.firstStart(), load(prevFrom, addDays(from0, -1))])
    settings = s
    firstDay = first
    periodSegs = groupSegments(rawPeriod, settings.groupSubdomains)
    // The current period is only partly over, so compare it with the one before it up to the same point.
    if (from0 !== from || to0 !== to) return // superseded by a newer selection
    const inProgress = to === startOfDay(Date.now())
    const prevSegs = inProgress ? clipSegmentsTo(rawPrev, prevFrom + (Date.now() - from)) : rawPrev
    const prevTotal = computeStats(prevSegs).totalMs
    summaryCtx = {
      prevTotalMs: prevTotal > 0 ? prevTotal : null,
      change: null,
      prevLabel: len === 1 ? (inProgress ? 'yesterday' : 'previous day') : `previous ${len} days`
    }
    await assignColors(computeStats(periodSegs).breakdown.map((d) => d.domain))
    applyTheme()
    render()
    if (history.filters.scope !== 'day') void loadHistory()
  } catch (e) {
    showError(`Could not read stored data: ${e instanceof Error ? e.message : e}. Try reloading the page.`)
  }
}

// Live updates: the worker checkpoints the open visit every minute.
data.onChange(debounce(() => void refresh(), 300))
setInterval(() => {
  const today = startOfDay(Date.now())
  if (!isRange() && from === today) timeline.setNow(Date.now())
  else if (from === addDays(today, -1) && to === from && Date.now() - today < 60_000) void refresh() // midnight passed
}, 30_000)

void initColors().then(refresh)
// Ask the worker to checkpoint so the numbers are current; the resulting storage change re-renders.
void sendMessage({type: 'sync'})
