import type {WorldSnapshot} from '../shared/types'
import type {Env} from './engine'

const NONE: WorldSnapshot = {
  windowFocused: false,
  windowId: null,
  tabId: null,
  url: null,
  incognito: false
}

/** Reads the real browser state. Throws if the APIs are unavailable. */
export const chromeEnv: Env = {
  now: () => Date.now(),

  async isFreshBoot() {
    const key = 'boot'
    const seen = await chrome.storage.session.get(key)
    if (seen[key]) return false
    await chrome.storage.session.set({[key]: true})
    return true
  },

  async snapshot(): Promise<WorldSnapshot> {
    let win: chrome.windows.Window
    try {
      win = await chrome.windows.getLastFocused()
    } catch {
      return NONE // no windows open (e.g. Chrome running in background)
    }
    if (win.id === undefined || !win.focused || win.state === 'minimized') return NONE

    const [tab] = await chrome.tabs.query({active: true, windowId: win.id})
    if (!tab || tab.id === undefined) return {...NONE, windowFocused: true, windowId: win.id}

    return {
      windowFocused: true,
      windowId: win.id,
      tabId: tab.id,
      url: tab.url ?? null,
      incognito: win.incognito || tab.incognito
    }
  }
}
