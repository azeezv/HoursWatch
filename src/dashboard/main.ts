import {sendMessage} from '../background/messages'
import {DEFAULT_SETTINGS} from '../shared/settings'
import {computeStats} from '../shared/stats'
import {addDays, startOfDay, parseDayKey} from '../shared/time'
import type {Segment, Settings} from '../shared/types'
import {assignColors, initColors} from './colors'
import {Data} from './data'
import {$, debounce} from './dom'
import {renderBreakdown} from './components/breakdown'
import {renderDetails} from './components/details'
import {openExportDialog, openSettingsDialog} from './components/dialogs'
import {Header} from './components/header'
import {History} from './components/history'
import {renderSummary} from './components/summary'
import {Timeline} from './components/timeline'

const data = new Data()
let settings: Settings = DEFAULT_SETTINGS
let day = startOfDay(Date.now())
let daySegs: Segment[] = []
let domainFilter: string | null = null
let selected: Segment | null = null
let firstDay: number | null = null
let loadToken = 0

const alertEl = $('#alert')
const showError = (msg: string | null) => {
  alertEl.hidden = msg === null
  alertEl.textContent = msg ?? ''
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme
}

const header = new Header({
  onPrev: () => goTo(addDays(day, -1)),
  onNext: () => goTo(addDays(day, 1)),
  onToday: () => goTo(startOfDay(Date.now())),
  onPickDay: (key) => {
    const d = parseDayKey(key)
    if (d !== null) goTo(d)
  },
  onExport: () => openExportDialog(data, day),
  onSettings: () =>
    openSettingsDialog(data, settings, {
      onSaved: (s) => {
        settings = s
        applyTheme()
        render()
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

const history = new History(day, {
  onReload: () => void loadHistory(),
  onSelect: (seg) => select(seg),
  onDomain: (d) => setDomain(d)
})
$('#history').append(history.el)

function goTo(target: number) {
  const today = startOfDay(Date.now())
  day = Math.min(startOfDay(target), today)
  selected = null
  void refresh()
}

function setDomain(d: string | null) {
  domainFilter = d
  history.setDomain(d)
  render()
}

function select(seg: Segment | null) {
  if (seg && startOfDay(seg.start) !== day) {
    day = startOfDay(seg.start)
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
  const stats = computeStats(daySegs)
  header.update(day, day === today, firstDay)
  renderSummary($('#summary'), stats)
  timeline.update({
    segments: daySegs,
    dayStart: day,
    dayEnd: addDays(day, 1),
    now: day === today ? Date.now() : null,
    hour12: settings.hour12,
    highlightDomain: domainFilter,
    selected
  })
  renderBreakdown($('#breakdown'), stats, domainFilter, setDomain)
  renderDetails($('#details'), selected, settings.hour12, {
    onFilter: (d) => setDomain(d),
    onClose: () => select(null)
  })
  history.setData(history.filters.scope === 'day' ? daySegs : historySegs, settings.hour12, selected)
}

let historySegs: Segment[] = []

/** (Re)load the segments backing the history list for its current scope. */
async function loadHistory() {
  const token = ++loadToken
  const f = history.filters
  if (f.scope === 'day') {
    history.setData(daySegs, settings.hour12, selected)
    return
  }
  history.setLoading(true)
  try {
    const segs = f.scope === 'all' ? await data.all() : await data.range(history.range().from, history.range().to)
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
    ;[settings, daySegs, firstDay] = await Promise.all([data.settings(), data.day(day), data.firstStart()])
    await assignColors(computeStats(daySegs).breakdown.map((d) => d.domain))
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
  if (day === today) timeline.setNow(Date.now())
  else if (day === addDays(today, -1) && Date.now() - today < 60_000) void refresh() // midnight passed
}, 30_000)

void initColors().then(refresh)
// Ask the worker to checkpoint so the numbers are current; the resulting storage change re-renders.
void sendMessage({type: 'sync'})
