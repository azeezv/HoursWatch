import {TrackingEngine, type Env} from '../src/background/engine'
import type {Visit, WorldSnapshot} from '../src/shared/types'
import {MemoryStore} from '../src/storage/memory-store'
import {VisitRepo} from '../src/storage/visit-repo'

/** Simulated browser + clock. Mutate it, then call `engine.sync()` like an event would. */
export class FakeBrowser implements Env {
  time: number
  focused = true
  incognito = false
  windowId = 1
  /** tabId -> url, per the active tab of the focused window */
  tabs = new Map<number, string>()
  activeTab: number | null = null
  failSnapshot = false
  fresh = false

  constructor(start: number) {
    this.time = start
  }

  now = () => this.time

  async isFreshBoot() {
    const f = this.fresh
    this.fresh = false
    return f
  }

  async snapshot(): Promise<WorldSnapshot> {
    if (this.failSnapshot) throw new Error('chrome api unavailable')
    if (!this.focused) {
      return {windowFocused: false, windowId: null, tabId: null, url: null, incognito: false}
    }
    return {
      windowFocused: true,
      windowId: this.windowId,
      tabId: this.activeTab,
      url: this.activeTab === null ? null : (this.tabs.get(this.activeTab) ?? null),
      incognito: this.incognito
    }
  }

  advance(ms: number) {
    this.time += ms
  }
  open(tabId: number, url: string, activate = true) {
    this.tabs.set(tabId, url)
    if (activate) this.activeTab = tabId
  }
}

export const SEC = 1000
export const MIN = 60 * SEC
export const HOUR = 60 * MIN

export function setup(start = new Date(2025, 5, 10, 9, 0, 0).getTime()) {
  const store = new MemoryStore()
  const browser = new FakeBrowser(start)
  const engine = new TrackingEngine(store, browser)
  const repo = new VisitRepo(store)
  /** A fresh engine on the same store/browser, as after a service worker restart. */
  const restart = () => new TrackingEngine(store, browser)
  const visits = (): Promise<Visit[]> => repo.getAll()
  return {store, browser, engine, repo, restart, visits}
}
