import {normalizeSettings} from '../shared/settings'
import {chromeStore, KEYS} from '../storage/store'
import {chromeEnv} from './chrome-env'
import {TrackingEngine} from './engine'
import type {Message, Reply} from './messages'

const ALARM = 'hourswatch-checkpoint'

const engine = new TrackingEngine(chromeStore(), chromeEnv)

/**
 * While a visit is open we re-verify eligibility every second. This is NOT how
 * time is counted (durations come from absolute timestamps, so a late or
 * missed tick never changes a duration); it only lets us notice quickly that
 * the user left Chrome. It is needed because Chrome does not reliably fire
 * windows.onFocusChanged when focus moves to another application (verified on
 * Linux). The loop runs only while a visit is open; when nothing is being
 * tracked everything is event-driven and the worker is free to sleep.
 */
const VERIFY_EVERY_MS = 1000
let verifier: ReturnType<typeof setInterval> | undefined
let verifying = false

function setVerifying(on: boolean) {
  if (on && verifier === undefined) {
    verifier = setInterval(() => {
      if (verifying) return // never stack checks if one is slow
      verifying = true
      run(Date.now(), true, 'verify').finally(() => (verifying = false))
    }, VERIFY_EVERY_MS)
  } else if (!on && verifier !== undefined) {
    clearInterval(verifier)
    verifier = undefined
  }
}

function run(at: number, poll: boolean, reason: string): Promise<void> {
  return engine.sync(at, {poll}).then(
    (tracking) => setVerifying(tracking),
    (e) => console.error(`[HoursWatch] sync failed (${reason})`, e)
  )
}

/**
 * Run a sync, stamping the time at which the event *arrived*, not when the
 * (serialised, async) work finally runs. Errors are logged, never thrown.
 */
function sync(reason: string) {
  void run(Date.now(), false, reason)
}

// ---- Listeners are registered synchronously so a cold-started service worker
// ---- receives the event that woke it.

chrome.tabs.onActivated.addListener(() => sync('tab-activated'))
chrome.tabs.onCreated.addListener(() => sync('tab-created'))
chrome.tabs.onRemoved.addListener(() => sync('tab-removed'))
chrome.tabs.onReplaced.addListener(() => sync('tab-replaced'))
chrome.tabs.onAttached.addListener(() => sync('tab-attached'))
chrome.tabs.onDetached.addListener(() => sync('tab-detached'))
chrome.tabs.onUpdated.addListener((_id, change) => {
  // URL commits (including same-document/SPA navigations) and load state changes.
  if (change.url !== undefined || change.status !== undefined || change.discarded !== undefined) {
    sync('tab-updated')
  }
})
chrome.windows.onFocusChanged.addListener(() => sync('window-focus'))
chrome.windows.onRemoved.addListener(() => sync('window-removed'))

// The user came back (or went away/locked): idle -> active is what lets us
// resume tracking immediately, since nothing else fires when you touch the mouse.
chrome.idle.onStateChanged.addListener(() => sync('idle-state'))

// Heartbeat: keeps the open visit's checkpoint fresh so a crash loses at most
// about a minute, and lets us notice sleep/suspension gaps. Time itself is
// never counted by this timer; it only re-verifies eligibility.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) sync('alarm')
})

// A session left over from before a browser restart / extension reload is
// detected inside the engine via the storage.session boot marker.
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm()
  sync('startup')
})
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm()
  sync('installed')
})

// Best effort when the worker is about to be suspended.
chrome.runtime.onSuspend?.addListener(() => sync('suspend'))

// Pausing / excluding domains takes effect immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && KEYS.settings in changes) {
    applyIdleInterval()
    sync('settings')
  }
})

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  // Only our own extension pages may talk to the worker.
  if (sender.id !== chrome.runtime.id) return false
  const work =
    msg?.type === 'sync'
      ? engine.sync().then(setVerifying)
      : msg?.type === 'deleteAll'
        ? engine.deleteAll().then(() => engine.sync().then(setVerifying))
        : null
  if (!work) return false
  work.then(
    () => sendResponse({ok: true} satisfies Reply),
    (e) => sendResponse({ok: false, error: String(e?.message ?? e)} satisfies Reply)
  )
  return true
})

/** Make chrome.idle.onStateChanged use the user's threshold (API minimum is 15 s). */
function applyIdleInterval() {
  chrome.storage.local.get(KEYS.settings).then((raw) => {
    const s = normalizeSettings(raw[KEYS.settings])
    chrome.idle.setDetectionInterval(Math.max(15, Math.round(s.idleMinutes * 60)))
  })
}

function ensureAlarm() {
  chrome.alarms.get(ALARM).then((a) => {
    if (!a) chrome.alarms.create(ALARM, {periodInMinutes: 1})
  })
}

// Every worker (re)start: make sure the heartbeat exists and reconcile.
ensureAlarm()
applyIdleInterval()
sync('worker-start')
