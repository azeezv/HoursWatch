/** Bump when the stored shape changes and add a migration in storage/migrations.ts. */
export const SCHEMA_VERSION = 1

/** One contiguous period of eligible (focused + active tab) browsing on one domain. */
export interface Visit {
  id: string
  /** Normalised hostname, e.g. `github.com` (a leading `www.` is dropped). */
  domain: string
  /** Absolute epoch ms. */
  startTime: number
  /** Absolute epoch ms, or null while the visit is still being tracked. */
  endTime: number | null
  /** Accumulated eligible time. Kept up to date at every checkpoint. */
  durationMs: number
  createdAt: number
}

/**
 * The tracker's persisted state machine. Everything needed to resume (or
 * safely abandon) a session after the service worker is suspended or killed.
 */
export interface TrackerState {
  tabId: number | null
  windowId: number | null
  domain: string | null
  /** Id of the open visit; null when nothing is being tracked. */
  visitId: string | null
  /** When the open visit started. */
  sessionStart: number | null
  /** Last moment at which eligibility was verified for the open visit. */
  checkpoint: number | null
  windowFocused: boolean
  /** True while a visit is open and accruing time. */
  trackingActive: boolean
  /** End of the most recently closed visit; new visits never start before it. */
  lastEndedAt: number
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  hour12: boolean
  /** Master switch: when false nothing is recorded. */
  trackingEnabled: boolean
  /** Visits shorter than this are discarded when they close. */
  minVisitSeconds: number
  /** Stop counting while the user is away (no input) or the screen is locked. */
  idleDetection: boolean
  /** Minutes without keyboard/mouse input before the user counts as away. */
  idleMinutes: number
  /** Show all subdomains of a site as one entry (`mail.google.com` + `docs.google.com` = `google.com`). */
  groupSubdomains: boolean
  /** Domains (and their subdomains) that are never recorded. */
  excludedDomains: string[]
}

/** Raw facts about the browser right now, as reported by the Chrome APIs. */
export interface WorldSnapshot {
  windowFocused: boolean
  windowId: number | null
  tabId: number | null
  url: string | null
  incognito: boolean
  /** From chrome.idle. `active` whenever idle detection is off or unavailable. */
  idleState: 'active' | 'idle' | 'locked'
}

/** A visit clipped to one local calendar day. */
export interface Segment {
  visit: Visit
  /** What the UI groups by: the site (`google.com`) or, with grouping off, the hostname. */
  domain: string
  /** The exact hostname that was visited (`mail.google.com`). */
  host: string
  start: number
  end: number
  /** Local day, `YYYY-MM-DD`. */
  day: string
  continuesFromPrev: boolean
  continuesToNext: boolean
}

/** One exact hostname inside a grouped website. */
export interface HostStat {
  host: string
  ms: number
  visits: number
  /** Share of the website's time, 0–100. */
  percent: number
}

export interface DomainStat {
  domain: string
  ms: number
  visits: number
  /** Hostnames making up this entry, largest first. */
  hosts: HostStat[]
  /** Share of the day's tracked time, 0–100. */
  percent: number
}

export interface DayStats {
  /** Union of all segments: wall-clock time with tracked browsing. */
  totalMs: number
  /** Plain sum of segment durations. Equals totalMs unless records overlap. */
  sumMs: number
  visitCount: number
  uniqueDomains: number
  topByTime: DomainStat | null
  topByVisits: DomainStat | null
  avgMs: number
  breakdown: DomainStat[]
}
