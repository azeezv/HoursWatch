import type {Settings} from './types'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  hour12: false,
  trackingEnabled: true,
  minVisitSeconds: 1,
  excludedDomains: []
}

/** Coerce whatever is in storage into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const minVisit = Number(r.minVisitSeconds)
  return {
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    hour12: typeof r.hour12 === 'boolean' ? r.hour12 : DEFAULT_SETTINGS.hour12,
    trackingEnabled:
      typeof r.trackingEnabled === 'boolean' ? r.trackingEnabled : DEFAULT_SETTINGS.trackingEnabled,
    minVisitSeconds:
      Number.isFinite(minVisit) && minVisit >= 0 && minVisit <= 600
        ? minVisit
        : DEFAULT_SETTINGS.minVisitSeconds,
    excludedDomains: Array.isArray(r.excludedDomains)
      ? r.excludedDomains.filter((d): d is string => typeof d === 'string')
      : []
  }
}
