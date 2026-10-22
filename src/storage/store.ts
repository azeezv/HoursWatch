/** The slice of chrome.storage.local the app uses, so tests can swap it out. */
export interface KeyValueStore {
  get(keys: string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export function chromeStore(): KeyValueStore {
  const area = chrome.storage.local
  return {
    get: (keys) => area.get(keys as string[]) as Promise<Record<string, unknown>>,
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys)
  }
}

export const KEYS = {
  schema: 'schemaVersion',
  settings: 'settings',
  tracker: 'tracker',
  /** Sorted list of bucket keys that exist. */
  index: 'visitIndex',
  /** domain -> palette slot, so each site keeps one color across days. */
  colors: 'domainColors',
  bucketPrefix: 'visits:'
} as const
