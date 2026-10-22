import {chromeStore, KEYS} from '../storage/store'

/**
 * Categorical palette: the first ten are the most distinct, the rest are
 * darker/lighter relatives. Mid-lightness so blocks read on light and dark themes.
 */
export const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#59a14f', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#8c8c8c',
  '#2b5c8a', '#c46a0a', '#b63a3c', '#3f7a37', '#8a5a80', '#3f8f8a', '#b99a1f', '#d6637a', '#75543f', '#6b6b6b',
  '#7fa9d3', '#f5b26b', '#f08a8c', '#8ccf80'
]

const slots = new Map<string, number>()

function hashSlot(domain: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < domain.length; i++) {
    hash ^= domain.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % PALETTE.length
}

/** The color for a domain. Falls back to a stable hash until `assignColors` has seen it. */
export function domainColor(domain: string): string {
  return PALETTE[(slots.get(domain) ?? hashSlot(domain)) % PALETTE.length]
}

/** Load persisted assignments and keep them in sync with other extension pages. */
export async function initColors(): Promise<void> {
  const raw = (await chromeStore().get([KEYS.colors]))[KEYS.colors]
  load(raw)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEYS.colors in changes) load(changes[KEYS.colors].newValue)
  })
}

function load(raw: unknown) {
  slots.clear()
  if (raw && typeof raw === 'object') {
    for (const [d, i] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof i === 'number') slots.set(d, i)
    }
  }
}

/**
 * Give each not-yet-seen domain its own palette slot (in the order given, so
 * pass the most important first). Persisted so a site keeps its color forever.
 */
export async function assignColors(domains: Iterable<string>): Promise<void> {
  const fresh: string[] = []
  for (const d of domains) if (!slots.has(d) && !fresh.includes(d)) fresh.push(d)
  if (fresh.length === 0) return

  const used = new Map<number, number>()
  for (const i of slots.values()) used.set(i % PALETTE.length, (used.get(i % PALETTE.length) ?? 0) + 1)
  for (const d of fresh) {
    // Least-used slot first (lowest index wins ties): unique until the palette runs out.
    let best = 0
    for (let i = 1; i < PALETTE.length; i++) if ((used.get(i) ?? 0) < (used.get(best) ?? 0)) best = i
    slots.set(d, best)
    used.set(best, (used.get(best) ?? 0) + 1)
  }
  try {
    await chromeStore().set({[KEYS.colors]: Object.fromEntries(slots)})
  } catch {
    // Colors are cosmetic; failing to persist must never break the UI.
  }
}
