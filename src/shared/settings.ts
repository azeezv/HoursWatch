import type {Settings} from './types'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  hour12: false,
  trackingEnabled: true,
  minVisitSeconds: 1,
  idleDetection: true,
  idleMinutes: 5,
  groupSubdomains: true,
  excludedDomains: []
}

/** chrome.idle cannot detect sooner than 15 seconds. */
export const MIN_IDLE_MINUTES = 0.25
export const MAX_IDLE_MINUTES = 120

/** Coerce whatever is in storage into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const minVisit = Number(r.minVisitSeconds)
  const idleMinutes = Number(r.idleMinutes)
  return {
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    hour12: typeof r.hour12 === 'boolean' ? r.hour12 : DEFAULT_SETTINGS.hour12,
    trackingEnabled:
      typeof r.trackingEnabled === 'boolean' ? r.trackingEnabled : DEFAULT_SETTINGS.trackingEnabled,
    minVisitSeconds:
      Number.isFinite(minVisit) && minVisit >= 0 && minVisit <= 600
        ? minVisit
        : DEFAULT_SETTINGS.minVisitSeconds,
    idleDetection:
      typeof r.idleDetection === 'boolean' ? r.idleDetection : DEFAULT_SETTINGS.idleDetection,
    idleMinutes:
      Number.isFinite(idleMinutes) && idleMinutes >= MIN_IDLE_MINUTES && idleMinutes <= MAX_IDLE_MINUTES
        ? idleMinutes
        : DEFAULT_SETTINGS.idleMinutes,
    groupSubdomains:
      typeof r.groupSubdomains === 'boolean' ? r.groupSubdomains : DEFAULT_SETTINGS.groupSubdomains,
    excludedDomains: Array.isArray(r.excludedDomains)
      ? r.excludedDomains.filter((d): d is string => typeof d === 'string')
      : []
  }
}
