import {SCHEMA_VERSION} from '../shared/types'
import {KEYS, type KeyValueStore} from './store'

/** `migrations[n]` upgrades stored data from version n to n + 1. */
export type Migration = (store: KeyValueStore) => Promise<void>
export const MIGRATIONS: Record<number, Migration> = {
  // Example for a future change:
  // 1: async (store) => { ...rewrite buckets to the v2 shape... },
}

/**
 * Bring storage up to `target`. A store with no version is treated as new
 * (v0 -> current) and just gets stamped. Returns the final version.
 */
export async function migrate(
  store: KeyValueStore,
  target = SCHEMA_VERSION,
  migrations: Record<number, Migration> = MIGRATIONS
): Promise<number> {
  const stored = (await store.get([KEYS.schema]))[KEYS.schema]
  if (typeof stored !== 'number') {
    await store.set({[KEYS.schema]: target})
    return target
  }
  let version = stored
  while (version < target) {
    const step = migrations[version]
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`)
    await step(store)
    version++
    await store.set({[KEYS.schema]: version})
  }
  return version
}
