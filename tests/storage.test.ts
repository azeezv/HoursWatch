import {afterEach, describe, expect, it, vi} from 'vitest'
import {TrackingEngine} from '../src/background/engine'
import {SCHEMA_VERSION, type Visit} from '../src/shared/types'
import {MemoryStore} from '../src/storage/memory-store'
import {migrate, type Migration} from '../src/storage/migrations'
import {chromeStore, KEYS} from '../src/storage/store'
import {bucketKey, VisitBatch, VisitRepo} from '../src/storage/visit-repo'
import {FakeBrowser, MIN} from './helpers'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const mk = (id: string, start: number, end: number | null, domain = 'a.com'): Visit => ({
  id,
  domain,
  startTime: start,
  endTime: end,
  durationMs: (end ?? start) - start,
  createdAt: start
})

async function save(store: MemoryStore, ...visits: Visit[]) {
  const repo = new VisitRepo(store)
  const batch = new VisitBatch(repo)
  for (const v of visits) await batch.upsert(v)
  await store.set(await batch.toPatch())
  return repo
}

describe('VisitRepo', () => {
  it('returns visits overlapping a local day, including ones that started the evening before', async () => {
    const store = new MemoryStore()
    const repo = await save(
      store,
      mk('before', local(2025, 6, 9, 10), local(2025, 6, 9, 11)),
      mk('cross', local(2025, 6, 9, 23, 50), local(2025, 6, 10, 0, 10)),
      mk('in', local(2025, 6, 10, 12), local(2025, 6, 10, 13)),
      mk('after', local(2025, 6, 11, 1), local(2025, 6, 11, 2))
    )
    const day = await repo.getRange(local(2025, 6, 10), local(2025, 6, 11))
    expect(day.map((v) => v.id)).toEqual(['cross', 'in'])
  })

  it('finds late-evening visits whose UTC date is the next day', async () => {
    // 22:00 New York is already the next UTC day.
    const store = new MemoryStore()
    const late = mk('late', local(2025, 6, 10, 22), local(2025, 6, 10, 23))
    expect(bucketKey(late.startTime)).toBe('visits:2025-06-11')
    const repo = await save(store, late)
    expect((await repo.getRange(local(2025, 6, 10), local(2025, 6, 11))).map((v) => v.id)).toEqual(['late'])
    expect(await repo.getRange(local(2025, 6, 11), local(2025, 6, 12))).toEqual([])
  })

  it('is independent of the local timezone used to read it', async () => {
    const store = new MemoryStore()
    const repo = await save(store, mk('x', Date.UTC(2025, 5, 10, 3), Date.UTC(2025, 5, 10, 4)))
    // The same instant is addressed purely by timestamps, so any day window works.
    expect((await repo.getRange(Date.UTC(2025, 5, 10, 0), Date.UTC(2025, 5, 11, 0))).length).toBe(1)
  })

  it('getAll / firstStart / deleteAll', async () => {
    const store = new MemoryStore()
    await store.set({[KEYS.settings]: {theme: 'dark'}})
    const repo = await save(
      store,
      mk('1', local(2025, 1, 5, 10), local(2025, 1, 5, 11)),
      mk('2', local(2025, 6, 5, 10), local(2025, 6, 5, 11))
    )
    expect((await repo.getAll()).map((v) => v.id)).toEqual(['1', '2'])
    expect(await repo.firstStart()).toBe(local(2025, 1, 5, 10))
    await repo.deleteAll()
    expect(await repo.getAll()).toEqual([])
    expect(await repo.firstStart()).toBeNull()
    expect(store.data.get(KEYS.settings)).toEqual({theme: 'dark'})
  })

  it('caches reads until invalidated', async () => {
    const store = new MemoryStore()
    await save(store, mk('1', local(2025, 6, 10, 10), local(2025, 6, 10, 11)))
    const repo = new VisitRepo(store, true)
    await repo.getAll()
    const spy = vi.spyOn(store, 'get')
    await repo.getAll()
    expect(spy).not.toHaveBeenCalled()
    await save(store, mk('2', local(2025, 6, 10, 12), local(2025, 6, 10, 13)))
    repo.invalidate([bucketKey(local(2025, 6, 10, 12)), KEYS.index])
    expect((await repo.getAll()).map((v) => v.id)).toEqual(['1', '2'])
  })
})

describe('persistence across restarts', () => {
  it('keeps records and settings when everything is re-instantiated on the same storage', async () => {
    const store = new MemoryStore()
    const browser = new FakeBrowser(local(2025, 6, 10, 9))
    const first = new TrackingEngine(store, browser)
    browser.open(1, 'https://a.com/')
    await first.sync()
    browser.advance(2 * MIN)
    browser.focused = false
    await first.sync()

    // "Close and reopen Chrome": brand-new engine + repo, same storage.
    const reopened = new VisitRepo(store)
    const v = await reopened.getAll()
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({domain: 'a.com', durationMs: 2 * MIN})
  })

  it('writes the visit and tracker state in one atomic set', async () => {
    const store = new MemoryStore()
    const browser = new FakeBrowser(local(2025, 6, 10, 9))
    const engine = new TrackingEngine(store, browser)
    const spy = vi.spyOn(store, 'set')
    browser.open(1, 'https://a.com/')
    await engine.sync()
    const call = spy.mock.calls.find(([items]) => KEYS.tracker in items && Object.keys(items).some((k) => k.startsWith('visits:')))
    expect(call).toBeTruthy()
  })

  it('does not rewrite storage when nothing changed', async () => {
    const store = new MemoryStore()
    const browser = new FakeBrowser(local(2025, 6, 10, 9))
    const engine = new TrackingEngine(store, browser)
    await engine.sync()
    await engine.sync()
    const writes = store.writes
    await engine.sync()
    expect(store.writes).toBe(writes)
  })

  it('scales: only the buckets for the requested day are read', async () => {
    const store = new MemoryStore()
    const many: Visit[] = []
    for (let d = 1; d <= 28; d++) many.push(mk(`v${d}`, local(2025, 2, d, 12), local(2025, 2, d, 13)))
    const repo = await save(store, ...many)
    const spy = vi.spyOn(store, 'get')
    await new VisitRepo(store).getRange(local(2025, 2, 10), local(2025, 2, 11))
    const requested = spy.mock.calls.flatMap(([keys]) => keys ?? [])
    expect(requested.filter((k) => k.startsWith('visits:')).length).toBeLessThanOrEqual(3)
    expect(repo).toBeTruthy()
  })
})

describe('chromeStore adapter', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('delegates to chrome.storage.local', async () => {
    const calls: string[] = []
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (k: string[]) => (calls.push('get'), {a: 1, k}),
          set: async () => void calls.push('set'),
          remove: async () => void calls.push('remove')
        }
      }
    })
    const s = chromeStore()
    await s.get(['a'])
    await s.set({a: 1})
    await s.remove(['a'])
    expect(calls).toEqual(['get', 'set', 'remove'])
  })
})

describe('migrations', () => {
  it('stamps a fresh install with the current version', async () => {
    const store = new MemoryStore()
    expect(await migrate(store)).toBe(SCHEMA_VERSION)
    expect(store.data.get(KEYS.schema)).toBe(SCHEMA_VERSION)
  })
  it('runs each missing step in order and stamps progress', async () => {
    const store = new MemoryStore()
    await store.set({[KEYS.schema]: 1, legacy: 'x'})
    const order: number[] = []
    const migrations: Record<number, Migration> = {
      1: async (s) => (order.push(1), s.set({step: 'two'})),
      2: async () => void order.push(2)
    }
    expect(await migrate(store, 3, migrations)).toBe(3)
    expect(order).toEqual([1, 2])
    expect(store.data.get('step')).toBe('two')
    expect(store.data.get(KEYS.schema)).toBe(3)
  })
  it('refuses to guess when a step is missing', async () => {
    const store = new MemoryStore()
    await store.set({[KEYS.schema]: 1})
    await expect(migrate(store, 2, {})).rejects.toThrow(/No migration/)
  })
  it('leaves newer-than-known data alone', async () => {
    const store = new MemoryStore()
    await store.set({[KEYS.schema]: 99})
    expect(await migrate(store)).toBe(99)
  })
})

describe('delete-all and the color map', () => {
  it('removes the domain color assignments too (they list visited sites)', async () => {
    const store = new MemoryStore()
    await store.set({[KEYS.colors]: {'a.com': 1}, [KEYS.settings]: {theme: 'dark'}})
    const repo = await save(store, mk('1', local(2025, 6, 10, 10), local(2025, 6, 10, 11)))
    await repo.deleteAll()
    expect(store.data.has(KEYS.colors)).toBe(false)
    expect(store.data.get(KEYS.settings)).toEqual({theme: 'dark'})
  })
})
