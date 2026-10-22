import {normalizeSettings} from '../shared/settings'
import {daySegments, segmentsForRange} from '../shared/stats'
import {addDays, startOfDay} from '../shared/time'
import type {Segment, Settings} from '../shared/types'
import {chromeStore, KEYS} from '../storage/store'
import {VisitRepo} from '../storage/visit-repo'

/** Read access to stored data for the UI, kept fresh via storage change events. */
export class Data {
  private store = chromeStore()
  readonly repo = new VisitRepo(this.store, true)
  private listeners = new Set<() => void>()

  constructor() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      this.repo.invalidate(Object.keys(changes))
      for (const cb of this.listeners) cb()
    })
  }

  onChange(cb: () => void) {
    this.listeners.add(cb)
  }

  async settings(): Promise<Settings> {
    return normalizeSettings((await this.store.get([KEYS.settings]))[KEYS.settings])
  }

  async saveSettings(s: Settings) {
    await this.store.set({[KEYS.settings]: s})
  }

  /** Segments for one local day (visits overlapping it, clipped to it). */
  async day(dayStart: number): Promise<Segment[]> {
    const end = addDays(dayStart, 1)
    return segmentsForRange(await this.repo.getRange(dayStart, end), dayStart, end)
  }

  /** Per-day segments for [fromDay, toDay] inclusive (any times; snapped to local days). */
  async range(fromDay: number, toDay: number): Promise<Segment[]> {
    const from = startOfDay(fromDay)
    const to = addDays(startOfDay(toDay), 1)
    return daySegments(await this.repo.getRange(from, to), from, to)
  }

  async all(): Promise<Segment[]> {
    const visits = await this.repo.getAll()
    return daySegments(visits, 0, Infinity)
  }

  firstStart() {
    return this.repo.firstStart()
  }
}
