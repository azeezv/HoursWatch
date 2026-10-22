import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {assignColors, domainColor, initColors, PALETTE} from '../src/dashboard/colors'
import {MemoryStore} from '../src/storage/memory-store'
import {KEYS} from '../src/storage/store'

describe('domain colors', () => {
  let store: MemoryStore
  beforeEach(() => {
    store = new MemoryStore()
    vi.stubGlobal('chrome', {
      storage: {
        local: {get: (k: string[]) => store.get(k), set: (i: Record<string, unknown>) => store.set(i), remove: (k: string[]) => store.remove(k)},
        onChanged: {addListener: () => undefined}
      }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('gives every new domain its own color, and keeps it', async () => {
    await initColors()
    const domains = ['docs.google.com', 'reddit.com', 'youtube.com', 'github.com', 'x.com', 'a.org', 'b.org', 'c.org', 'd.org']
    await assignColors(domains)
    const colors = domains.map(domainColor)
    expect(new Set(colors).size).toBe(domains.length) // no two sites share a color
    await assignColors(['zzz.com', ...domains]) // later days don't disturb earlier assignments
    expect(domains.map(domainColor)).toEqual(colors)
    expect(store.data.get(KEYS.colors)).toBeTruthy()
  })

  it('persists across page loads', async () => {
    await initColors()
    await assignColors(['one.com', 'two.com'])
    const first = [domainColor('one.com'), domainColor('two.com')]
    await initColors() // "new page"
    expect([domainColor('one.com'), domainColor('two.com')]).toEqual(first)
  })

  it('reuses colors only once the palette is exhausted, spreading evenly', async () => {
    await initColors()
    const many = Array.from({length: PALETTE.length + 3}, (_, i) => `site${i}.com`)
    await assignColors(many)
    expect(new Set(many.map(domainColor)).size).toBe(PALETTE.length)
  })

  it('has a stable fallback before assignment', () => {
    expect(domainColor('never-seen.com')).toBe(domainColor('never-seen.com'))
    expect(PALETTE).toContain(domainColor('never-seen.com'))
  })
})
