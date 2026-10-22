import {describe, expect, it} from 'vitest'
import {MAX_GAP_MS} from '../src/background/engine'
import {KEYS} from '../src/storage/store'
import {HOUR, MIN, SEC, setup} from './helpers'

describe('tracking: starting and tab switching', () => {
  it('starts tracking when an eligible tab is active in a focused window', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://github.com/foo')
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({domain: 'github.com', endTime: null, durationMs: 0})
    expect(v[0].startTime).toBe(browser.time)
  })

  it('closes the previous visit and tracks the newly active site on tab switch', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://github.com/')
    browser.open(2, 'https://youtube.com/watch', false)
    await engine.sync()
    browser.advance(30 * SEC)
    browser.activeTab = 2
    await engine.sync()
    browser.advance(45 * SEC)
    browser.activeTab = 1
    await engine.sync()
    browser.advance(10 * SEC)
    await engine.sync()

    const v = await visits()
    expect(v.map((x) => [x.domain, x.durationMs, x.endTime !== null])).toEqual([
      ['github.com', 30 * SEC, true],
      ['youtube.com', 45 * SEC, true],
      ['github.com', 10 * SEC, false] // open visit checkpointed
    ])
    expect(v[1].startTime).toBe(v[0].endTime) // contiguous, no overlap
  })

  it('never counts time on background tabs', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    browser.open(2, 'https://b.com/', false)
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync() // b.com stays in background for the whole time
    const v = await visits()
    expect(v.find((x) => x.domain === 'b.com')).toBeUndefined()
    expect(v[0]).toMatchObject({domain: 'a.com', durationMs: 1 * MIN})
  })

  it('continues one visit when switching between tabs of the same domain', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://github.com/a')
    browser.open(2, 'https://github.com/b', false)
    await engine.sync()
    browser.advance(20 * SEC)
    browser.activeTab = 2
    await engine.sync()
    browser.advance(20 * SEC)
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(40 * SEC)
  })
})

describe('tracking: window focus', () => {
  it('pauses when another application is focused and resumes on return', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://docs.example.com/')
    await engine.sync()
    browser.advance(1 * MIN)
    browser.focused = false
    await engine.sync() // alt-tab away
    browser.advance(10 * MIN) // time passes unfocused
    await engine.sync()
    browser.focused = true
    await engine.sync() // back
    browser.advance(30 * SEC)
    await engine.sync()

    const v = await visits()
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({durationMs: 1 * MIN})
    expect(v[0].endTime).toBe(v[0].startTime + 1 * MIN)
    expect(v[1].durationMs).toBe(30 * SEC)
    expect(v[1].startTime).toBe(v[0].endTime! + 10 * MIN)
    const total = v.reduce((s, x) => s + x.durationMs, 0)
    expect(total).toBe(1 * MIN + 30 * SEC) // the 10 unfocused minutes are excluded
  })

  it('does not accrue while unfocused even if syncs keep arriving', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    browser.focused = false
    for (let i = 0; i < 5; i++) {
      browser.advance(1 * MIN)
      await engine.sync()
    }
    expect(await visits()).toHaveLength(0)
  })
})

describe('tracking: navigation', () => {
  it('switches the tracked domain when the active tab navigates to another site', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(20 * SEC)
    browser.tabs.set(1, 'https://b.org/page')
    await engine.sync()
    browser.advance(15 * SEC)
    await engine.sync()
    const v = await visits()
    expect(v.map((x) => [x.domain, x.durationMs])).toEqual([
      ['a.com', 20 * SEC],
      ['b.org', 15 * SEC]
    ])
  })

  it('does not split or double count same-domain navigation', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://github.com/')
    await engine.sync()
    for (const path of ['/a', '/a/b', '/c?x=1#frag']) {
      browser.advance(10 * SEC)
      browser.tabs.set(1, `https://github.com${path}`)
      await engine.sync()
    }
    // Duplicate events for the same navigation must not add time either.
    await engine.sync()
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(30 * SEC)
  })

  it('treats www. and the bare domain as the same site', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://www.example.com/')
    await engine.sync()
    browser.advance(5 * SEC)
    browser.tabs.set(1, 'https://example.com/x')
    await engine.sync()
    expect(await visits()).toHaveLength(1)
  })

  it.each([
    'chrome://settings',
    'chrome-extension://abcdef/dashboard/index.html',
    'about:blank',
    'file:///home/me/a.html',
    'view-source:https://a.com',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    'data:text/html,hi',
    ''
  ])('treats %s as ineligible and records nothing', async (url) => {
    const {browser, engine, visits} = setup()
    browser.open(1, url)
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    expect(await visits()).toHaveLength(0)
  })

  it('pauses on an ineligible page and resumes afterwards (dashboard usage is not counted)', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    browser.open(2, 'chrome-extension://id/dashboard/index.html', false)
    await engine.sync()
    browser.advance(1 * MIN)
    browser.activeTab = 2
    await engine.sync()
    browser.advance(5 * MIN)
    await engine.sync()
    browser.activeTab = 1
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    const v = await visits()
    expect(v.map((x) => x.durationMs)).toEqual([1 * MIN, 1 * MIN])
  })

  it('ignores incognito windows', async () => {
    const {browser, engine, visits} = setup()
    browser.incognito = true
    browser.open(1, 'https://secret.example/')
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    expect(await visits()).toHaveLength(0)
  })

  it('closes the visit when the active tab is closed', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(40 * SEC)
    browser.tabs.delete(1)
    browser.activeTab = null
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({durationMs: 40 * SEC})
    expect(v[0].endTime).not.toBeNull()
  })
})

describe('tracking: settings', () => {
  it('discards visits shorter than the minimum', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    browser.open(2, 'https://b.com/', false)
    await engine.sync()
    browser.advance(400) // < 1s flick-through
    browser.activeTab = 2
    await engine.sync()
    browser.advance(5 * SEC)
    await engine.sync()
    const v = await visits()
    expect(v.map((x) => x.domain)).toEqual(['b.com'])
  })

  it('records nothing while tracking is paused, and stops the open visit', async () => {
    const {browser, engine, store, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(30 * SEC)
    await store.set({[KEYS.settings]: {trackingEnabled: false}})
    await engine.sync()
    browser.advance(5 * MIN)
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(30 * SEC)
  })

  it('never records excluded domains or their subdomains', async () => {
    const {browser, engine, store, visits} = setup()
    await store.set({[KEYS.settings]: {excludedDomains: ['bank.com']}})
    browser.open(1, 'https://login.bank.com/')
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    expect(await visits()).toHaveLength(0)
  })
})

describe('tracking: recovery after service worker suspension / restart', () => {
  it('resumes the open visit on a new engine instance when the gap is small', async () => {
    const {browser, engine, restart, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(50 * SEC)
    await engine.sync() // checkpoint
    // worker is killed; user keeps reading for 40s; heartbeat wakes a fresh worker
    browser.advance(40 * SEC)
    await restart().sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(90 * SEC)
  })

  it('does not count a gap that cannot be verified (sleep / crash)', async () => {
    const {browser, engine, restart, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync() // last verified moment
    const verifiedAt = browser.time
    browser.advance(3 * HOUR) // laptop asleep / worker dead
    await restart().sync()
    browser.advance(20 * SEC)
    await restart().sync()

    const v = await visits()
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({durationMs: 1 * MIN, endTime: verifiedAt})
    expect(v[1].startTime).toBe(verifiedAt + 3 * HOUR)
    expect(v[1].durationMs).toBe(20 * SEC)
    expect(MAX_GAP_MS).toBeLessThan(3 * HOUR)
  })

  it('closes a persisted visit at its checkpoint on browser restart, even for a quick restart', async () => {
    const {browser, engine, restart, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(1 * MIN)
    await engine.sync()
    const checkpoint = browser.time
    browser.advance(60 * SEC) // chrome quits, relaunches within the gap limit
    browser.fresh = true
    await restart().sync()
    browser.advance(10 * SEC)
    await restart().sync()
    const v = await visits()
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({durationMs: 1 * MIN, endTime: checkpoint})
    expect(v[1].startTime).toBe(checkpoint + 60 * SEC)
    expect(v[1].durationMs).toBe(10 * SEC)
  })

  it('stops the visit at the last checkpoint if eligibility cannot be verified', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(30 * SEC)
    await engine.sync()
    const cp = browser.time
    browser.advance(40 * SEC)
    browser.failSnapshot = true
    await engine.sync()
    const v = await visits()
    expect(v[0]).toMatchObject({durationMs: 30 * SEC, endTime: cp})
  })

  it('survives corrupted tracker state', async () => {
    const {browser, engine, store, visits} = setup()
    await store.set({[KEYS.tracker]: {visitId: 5, domain: null, checkpoint: 'x'}})
    browser.open(1, 'https://a.com/')
    await engine.sync()
    expect(await visits()).toHaveLength(1)
  })

  it('recovers when the open visit record has disappeared', async () => {
    const {browser, engine, repo, store, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(10 * SEC)
    await repo.deleteAll()
    await engine.sync()
    browser.advance(10 * SEC)
    await engine.sync()
    expect((await visits()).length).toBe(1)
    expect(store.data.get(KEYS.tracker)).toMatchObject({trackingActive: true})
  })
})

describe('tracking: clock safety and serialisation', () => {
  it('never produces negative durations or overlapping visits if the clock steps back', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    browser.open(2, 'https://b.com/', false)
    await engine.sync()
    browser.advance(30 * SEC)
    await engine.sync()
    browser.advance(-20 * SEC) // NTP correction
    browser.activeTab = 2
    await engine.sync()
    browser.advance(30 * SEC)
    await engine.sync()
    const v = await visits()
    for (const x of v) expect(x.durationMs).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < v.length; i++) expect(v[i].startTime).toBeGreaterThanOrEqual(v[i - 1].endTime!)
  })

  it('handles a burst of concurrent events without duplicate sessions', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    await Promise.all([engine.sync(), engine.sync(), engine.sync(), engine.sync()])
    expect(await visits()).toHaveLength(1)
  })

  it('a visit spanning midnight is stored once with absolute timestamps', async () => {
    const start = new Date(2025, 5, 10, 23, 50, 0).getTime()
    const {browser, engine, visits} = setup(start)
    browser.open(1, 'https://a.com/')
    await engine.sync()
    for (let i = 0; i < 20; i++) {
      browser.advance(1 * MIN)
      await engine.sync()
    }
    browser.focused = false
    await engine.sync()
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(20 * MIN)
    expect(new Date(v[0].startTime).getDate()).toBe(10)
    expect(new Date(v[0].endTime!).getDate()).toBe(11)
  })
})

describe('deleteAll', () => {
  it('removes every visit, keeps settings, and resumes tracking', async () => {
    const {browser, engine, store, visits} = setup()
    await store.set({[KEYS.settings]: {theme: 'dark'}})
    browser.open(1, 'https://a.com/')
    await engine.sync()
    browser.advance(1 * MIN)
    browser.focused = false
    await engine.sync()
    expect(await visits()).toHaveLength(1)
    await engine.deleteAll()
    expect(await visits()).toHaveLength(0)
    expect(store.data.get(KEYS.settings)).toEqual({theme: 'dark'})
    expect([...store.data.keys()].filter((k) => k.startsWith('visits:'))).toEqual([])
  })
})

describe('tracking: leaving Chrome for another app without a focus event', () => {
  // Chrome (notably on Linux) does not emit windows.onFocusChanged when focus
  // moves to another application, so a periodic verification sync must catch it.
  it('a verification poll ends the visit as soon as the window is found unfocused', async () => {
    const {browser, engine, visits} = setup()
    browser.open(1, 'https://a.com/')
    expect(await engine.sync()).toBe(true)
    browser.advance(10 * SEC)
    browser.focused = false // no event is delivered...
    browser.advance(1 * SEC)
    expect(await engine.sync(browser.time, {poll: true})).toBe(false) // ...the poll notices
    browser.advance(30 * SEC)
    await engine.sync(browser.time, {poll: true})
    const v = await visits()
    expect(v).toHaveLength(1)
    expect(v[0].durationMs).toBe(11 * SEC) // not 41s
    expect(v[0].endTime).not.toBeNull()
  })

  it('poll syncs reflect real changes immediately but throttle pure checkpoint writes', async () => {
    const {browser, engine, store, visits} = setup()
    browser.open(1, 'https://a.com/')
    await engine.sync()
    const writes = store.writes
    for (let i = 0; i < 10; i++) {
      browser.advance(1 * SEC)
      await engine.sync(browser.time, {poll: true})
    }
    expect(store.writes).toBe(writes) // 10s of healthy polling wrote nothing
    browser.advance(10 * SEC)
    await engine.sync(browser.time, {poll: true}) // 20s since last write
    expect(store.writes).toBe(writes + 1)
    expect((await visits())[0].durationMs).toBe(20 * SEC)
  })

  it('reports whether tracking is active so the caller can start/stop polling', async () => {
    const {browser, engine} = setup()
    expect(await engine.sync()).toBe(false)
    browser.open(1, 'https://a.com/')
    expect(await engine.sync()).toBe(true)
    browser.tabs.set(1, 'chrome://settings')
    expect(await engine.sync()).toBe(false)
  })
})
