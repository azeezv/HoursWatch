import type {WorldSnapshot} from '../shared/types'
import type {Env} from './engine'

const NONE: WorldSnapshot = {
  windowFocused: false,
  windowId: null,
  tabId: null,
  url: null,
  incognito: false,
  idleState: 'active'
}

/**
 * Opening the toolbar popup moves focus out of the browser window (Chrome
 * reports the window as unfocused). The popup announces itself over a port so
 * that this does not end the visit it is about to display.
 */
let popupPorts = 0
export function setPopupOpen(open: boolean) {
  popupPorts = Math.max(0, popupPorts + (open ? 1 : -1))
}

/** The popup's page loads shortly after the focus change; give it time to connect. */
const POPUP_GRACE_MS = 500

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

  async snapshot(idleSeconds: number | null): Promise<WorldSnapshot> {
    let win: chrome.windows.Window
    try {
      win = await chrome.windows.getLastFocused()
    } catch {
      return NONE // no windows open (e.g. Chrome running in background)
    }
    if (win.state === 'minimized') return NONE
    if (!win.focused && popupPorts === 0) {
      await new Promise((r) => setTimeout(r, POPUP_GRACE_MS))
      if (popupPorts === 0) {
        try {
          win = await chrome.windows.getLastFocused()
        } catch {
          return NONE
        }
        if (!win.focused) return NONE
      }
    }
    if (win.id === undefined) return NONE

    const [tab] = await chrome.tabs.query({active: true, windowId: win.id})
    if (!tab || tab.id === undefined) return {...NONE, windowFocused: true, windowId: win.id}

    return {
      windowFocused: true,
      windowId: win.id,
      tabId: tab.id,
      url: tab.url ?? null,
      incognito: win.incognito || tab.incognito,
      idleState: await queryIdle(idleSeconds)
    }
  }
}

/**
 * User presence. If the idle API is unavailable or fails we report `active`:
 * presence is a refinement, and breaking all tracking over it would be worse.
 */
async function queryIdle(idleSeconds: number | null): Promise<WorldSnapshot['idleState']> {
  if (idleSeconds === null) return 'active'
  try {
    return await chrome.idle.queryState(Math.max(15, idleSeconds))
  } catch {
    return 'active'
  }
}
