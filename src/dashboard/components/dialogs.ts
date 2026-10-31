import {sendMessage} from '../../background/messages'
import {buildCsv, csvBlob, exportFilename, type ExportRange} from '../../shared/csv'
import {parseExcludedDomains} from '../../shared/domain'
import {DEFAULT_SETTINGS, MAX_IDLE_MINUTES} from '../../shared/settings'
import {addDays, dayKey, formatDayLong, formatDuration, parseDayKey, startOfDay} from '../../shared/time'
import type {Settings} from '../../shared/types'
import type {Data} from '../data'
import {h, replace} from '../dom'

function modal(title: string, ...body: Array<Node | null>) {
  const dlg = h('dialog', {class: 'dialog', 'aria-labelledby': 'dlg-title'})
  const close = () => {
    dlg.close()
    dlg.remove()
  }
  dlg.append(
    h('div', {class: 'dialog-head'}, h('h2', {id: 'dlg-title'}, title),
      h('button', {class: 'btn btn-icon', type: 'button', 'aria-label': 'Close', onclick: close}, '×')),
    ...(body.filter(Boolean) as Node[])
  )
  dlg.addEventListener('cancel', () => dlg.remove())
  dlg.addEventListener('click', (e) => e.target === dlg && close())
  document.body.append(dlg)
  dlg.showModal()
  return {dlg, close}
}

// ---------------------------------------------------------------- export

/** Opens with the header's selection: a single day, or its range preselected. */
export function openExportDialog(data: Data, rangeFrom: number, rangeTo: number) {
  const day = rangeTo
  const multi = rangeFrom !== rangeTo
  let mode: 'day' | 'range' | 'all' = multi ? 'range' : 'day'
  const today = startOfDay(Date.now())
  const from = h('input', {type: 'date', class: 'input', value: dayKey(multi ? rangeFrom : addDays(day, -6)), 'aria-label': 'From date'})
  const to = h('input', {type: 'date', class: 'input', value: dayKey(day), 'aria-label': 'To date'})
  const status = h('p', {class: 'note', 'aria-live': 'polite'})
  const go = h('button', {class: 'btn btn-primary', type: 'button'}, 'Download CSV')

  const radio = (value: typeof mode, label: string, extra?: Node) =>
    h('label', {class: 'radio'},
      h('input', {type: 'radio', name: 'export-mode', value, checked: value === mode, onchange: () => { mode = value; refresh() }}),
      h('span', {}, label), extra ?? null)

  async function build(): Promise<{range: ExportRange; csv: string; rows: number} | string> {
    if (mode === 'day') {
      const segs = await data.range(day, day)
      return {range: {kind: 'day', day}, csv: buildCsv(segs), rows: segs.length}
    }
    if (mode === 'range') {
      const f = parseDayKey(from.value)
      const t = parseDayKey(to.value)
      if (f === null || t === null) return 'Choose both a start and an end date.'
      const [a, b] = f <= t ? [f, t] : [t, f]
      const segs = await data.range(a, b)
      return {range: {kind: 'range', from: a, to: b}, csv: buildCsv(segs), rows: segs.length}
    }
    const segs = await data.all()
    return {range: {kind: 'all', today}, csv: buildCsv(segs), rows: segs.length}
  }

  async function refresh() {
    go.disabled = true
    status.textContent = 'Counting records…'
    try {
      const r = await build()
      if (typeof r === 'string') status.textContent = r
      else {
        status.textContent = r.rows === 0 ? 'No records in this selection; the file would only contain headers.' : `${r.rows} ${r.rows === 1 ? 'row' : 'rows'} will be exported.`
        go.disabled = false
      }
    } catch (e) {
      status.textContent = `Could not read your data: ${e instanceof Error ? e.message : e}`
    }
  }

  const {close} = modal('Export to CSV',
    h('div', {class: 'dialog-body'},
      h('p', {class: 'note'}, 'The file is generated in your browser and never leaves this computer.'),
      radio('day', `Selected day (${formatDayLong(day)})`),
      radio('range', 'Date range', h('span', {class: 'range-box'}, from, h('span', {}, '→'), to)),
      radio('all', 'All recorded history'),
      status),
    h('div', {class: 'dialog-foot'},
      h('button', {class: 'btn', type: 'button', onclick: () => close()}, 'Cancel'), go))

  from.addEventListener('change', () => { mode = 'range'; syncRadio(); refresh() })
  to.addEventListener('change', () => { mode = 'range'; syncRadio(); refresh() })
  function syncRadio() {
    document.querySelectorAll<HTMLInputElement>('input[name=export-mode]').forEach((r) => (r.checked = r.value === mode))
  }

  go.addEventListener('click', async () => {
    const r = await build()
    if (typeof r === 'string') return void (status.textContent = r)
    const url = URL.createObjectURL(csvBlob(r.csv))
    const a = h('a', {href: url, download: exportFilename(r.range)})
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    close()
  })
  void refresh()
}

// -------------------------------------------------------------- settings

export function openSettingsDialog(
  data: Data,
  settings: Settings,
  hooks: {onSaved(s: Settings): void; onDeleted(): void}
) {
  let current = {...settings}
  const save = async (patch: Partial<Settings>) => {
    current = {...current, ...patch}
    try {
      await data.saveSettings(current)
      hooks.onSaved(current)
      note.textContent = ''
    } catch (e) {
      note.textContent = `Could not save settings: ${e instanceof Error ? e.message : e}`
    }
  }
  const note = h('p', {class: 'note error', role: 'alert'})

  const theme = h('select', {class: 'input', onchange: () => save({theme: theme.value as Settings['theme']})},
    h('option', {value: 'system'}, 'Match system'), h('option', {value: 'light'}, 'Light'), h('option', {value: 'dark'}, 'Dark'))
  theme.value = current.theme

  const hour12 = h('select', {class: 'input', onchange: () => save({hour12: hour12.value === '12'})},
    h('option', {value: '24'}, '24-hour (14:30)'), h('option', {value: '12'}, '12-hour (2:30 PM)'))
  hour12.value = current.hour12 ? '12' : '24'

  const toggle = (checked: boolean, label: string, onchange: (on: boolean) => void) => {
    const input = h('input', {type: 'checkbox', role: 'switch', checked, 'aria-label': label, onchange: () => onchange(input.checked)})
    return {input, el: h('span', {class: 'switch'}, input, h('span', {class: 'switch-track'}))}
  }
  const enabled = toggle(current.trackingEnabled, 'Tracking', (on) => save({trackingEnabled: on}))
  const group = toggle(current.groupSubdomains, 'Group subdomains', (on) => save({groupSubdomains: on}))
  const idleOn = toggle(current.idleDetection, 'Pause when away', (on) => {
    idleMin.disabled = !on
    void save({idleDetection: on})
  })
  const idleMin = h('input', {type: 'number', class: 'input input-num', min: '1', max: String(MAX_IDLE_MINUTES), step: '1', value: String(current.idleMinutes), disabled: !current.idleDetection,
    'aria-label': 'Minutes of inactivity before you count as away',
    onchange: () => {
      const v = Math.min(MAX_IDLE_MINUTES, Math.max(1, Number(idleMin.value) || DEFAULT_SETTINGS.idleMinutes))
      idleMin.value = String(v)
      void save({idleMinutes: v})
    }})
  const minVisit = h('input', {type: 'number', class: 'input input-num', min: '0', max: '600', step: '1', value: String(current.minVisitSeconds),
    'aria-label': 'Ignore visits shorter than this many seconds',
    onchange: () => {
      const v = Math.min(600, Math.max(0, Number(minVisit.value) || 0))
      minVisit.value = String(v)
      void save({minVisitSeconds: v})
    }})
  const excluded = h('textarea', {class: 'input', rows: 3, placeholder: 'mybank.com\nmail.example.com', value: current.excludedDomains.join('\n'),
    'aria-label': 'Websites never tracked, one per line',
    onchange: () => {
      const list = parseExcludedDomains(excluded.value)
      excluded.value = list.join('\n')
      void save({excludedDomains: list})
    }})

  const usage = h('p', {class: 'note'}, 'Calculating stored data…')
  void (async () => {
    try {
      const [bytes, visits] = await Promise.all([chrome.storage.local.getBytesInUse(null), data.repo.getAll()])
      usage.textContent = `Stored locally: ${visits.length} visits (${(bytes / 1024).toFixed(1)} KB), covering ${formatDuration(visits.reduce((s, v) => s + (v.endTime ?? v.startTime + v.durationMs) - v.startTime, 0))} of browsing.`
    } catch {
      usage.textContent = ''
    }
  })()

  const danger = h('div', {class: 'danger'})
  const showDanger = (confirming: boolean) =>
    replace(danger,
      confirming
        ? h('div', {class: 'danger-confirm'}, h('strong', {}, 'Delete all recorded activity? This cannot be undone.'),
            h('button', {class: 'btn', type: 'button', onclick: () => showDanger(false)}, 'Cancel'),
            h('button', {class: 'btn btn-danger', type: 'button', onclick: async () => {
              const r = await sendMessage({type: 'deleteAll'})
              if (!r.ok) {
                // Worker unreachable: fall back to clearing directly.
                try { await data.repo.deleteAll() } catch (e) { note.textContent = `Delete failed: ${e instanceof Error ? e.message : e}`; return }
              }
              hooks.onDeleted()
              close()
            }}, 'Yes, delete everything'))
        : h('button', {class: 'btn btn-danger-outline', type: 'button', onclick: () => showDanger(true)}, 'Delete all activity data…'))
  showDanger(false)

  const row = (label: string, hint: string | null, control: Node) =>
    h('div', {class: 's-row'},
      h('div', {class: 's-text'}, h('span', {class: 's-label'}, label), hint ? h('span', {class: 'help'}, hint) : null),
      control)
  const section = (title: string, ...rows: Node[]) =>
    h('section', {class: 's-section'}, h('h3', {class: 's-title'}, title), h('div', {class: 's-card'}, ...rows))

  const {close} = modal('Settings',
    h('div', {class: 'dialog-body'},
      section('General',
        row('Tracking', 'Switch off to pause recording. Nothing is saved while it’s off.', enabled.el),
        row('Theme', null, theme),
        row('Time format', null, hour12)),
      section('Rules',
        row('Group subdomains', 'Count mail.google.com as google.com.', group.el),
        row('Pause when away', 'Stop counting when you’re idle or the screen is locked.', idleOn.el),
        row('Away after (minutes)', null, idleMin),
        row('Ignore short visits (seconds)', null, minVisit),
        h('div', {class: 's-row s-stack'},
          h('div', {class: 's-text'}, h('span', {class: 's-label'}, 'Never track'), h('span', {class: 'help'}, 'One website per line. Subdomains included.')),
          excluded)),
      section('Data',
        h('div', {class: 's-row s-stack'}, usage),
        h('details', {class: 's-row s-stack privacy'},
          h('summary', {}, 'How your data is handled'),
          h('p', {class: 'help'}, 'Only the domain and the start, end and duration of each visit are saved — never URLs, titles, page content or incognito activity. Everything stays on this computer; nothing is sent anywhere.')),
        h('div', {class: 's-row'}, h('div', {class: 's-text'}, h('span', {class: 's-label'}, 'Delete all data')), danger)),
      h('p', {class: 'about'},
        `HoursWatch ${chrome.runtime.getManifest().version} · `,
        h('a', {href: 'https://github.com/azeezv/HoursWatch', target: '_blank', rel: 'noopener noreferrer'}, 'Open source on GitHub'),
        ' · ',
        h('a', {href: 'mailto:report@azeezv.me?subject=HoursWatch%20feedback'}, 'Report a bug')),
      note))
}
