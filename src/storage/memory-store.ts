import type {KeyValueStore} from './store'

/** In-memory KeyValueStore with the same copy-on-read/write semantics as chrome.storage. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>()
  writes = 0

  async get(keys: string[] | null) {
    const out: Record<string, unknown> = {}
    for (const k of keys ?? [...this.data.keys()]) {
      if (this.data.has(k)) out[k] = structuredClone(this.data.get(k))
    }
    return out
  }

  async set(items: Record<string, unknown>) {
    this.writes++
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v))
  }

  async remove(keys: string[]) {
    for (const k of keys) this.data.delete(k)
  }
}
