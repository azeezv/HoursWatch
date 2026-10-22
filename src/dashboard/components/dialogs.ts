import {sendMessage} from '../../background/messages'
import {buildCsv, csvBlob, exportFilename, type ExportRange} from '../../shared/csv'
import {parseExcludedDomains} from '../../shared/domain'
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

export function openExportDialog(data: Data, day: number) {
  let mode: 'day' | 'range' | 'all' = 'day'
  const today = startOfDay(Date.now())
  const from = h('input', {type: 'date', class: 'input', value: dayKey(addDays(day, -6)), 'aria-label': 'From date'})
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

  const enabled = h('input', {type: 'checkbox', checked: current.trackingEnabled, onchange: () => save({trackingEnabled: enabled.checked})})
  const minVisit = h('input', {type: 'number', class: 'input input-num', min: '0', max: '600', step: '1', value: String(current.minVisitSeconds),
    onchange: () => save({minVisitSeconds: Math.min(600, Math.max(0, Number(minVisit.value) || 0))})})
  const excluded = h('textarea', {class: 'input', rows: 3, placeholder: 'e.g. mybank.com\nmail.example.com', value: current.excludedDomains.join('\n'),
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

  const field = (label: string, control: Node, help?: string) =>
    h('label', {class: 'field'}, h('span', {class: 'field-label'}, label), control, help ? h('span', {class: 'help'}, help) : null)

  const {close} = modal('Settings',
    h('div', {class: 'dialog-body'},
      h('label', {class: 'check'}, enabled, h('span', {}, 'Track browsing activity'), h('span', {class: 'help'}, 'Turn off to pause all recording.')),
      field('Theme', theme),
      field('Time format', hour12),
      field('Ignore visits shorter than (seconds)', minVisit, 'Filters out tabs you only flicked past.'),
      field('Never track these websites', excluded, 'One per line. Subdomains are included.'),
      h('hr', {}),
      h('h3', {}, 'Privacy'),
      h('ul', {class: 'privacy'},
        h('li', {}, 'Recorded: the website’s domain (e.g. github.com) and when you were actively looking at it — start, end and duration.'),
        h('li', {}, 'Never recorded: page URLs, titles, page content, form entries, passwords, cookies, or anything from private (incognito) windows.'),
        h('li', {}, 'Everything is stored only on this computer in Chrome’s local extension storage. Nothing is ever sent over the network — there is no server, account or analytics.'),
        h('li', {}, 'Time counts only while Chrome is the focused window and the site is the active tab.')),
      usage, danger, note))
}
