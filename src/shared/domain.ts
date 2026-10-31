/**
 * Decide whether a URL is trackable and reduce it to a domain.
 * Only http(s) pages are eligible: browser-internal pages, extension pages
 * (including this dashboard), file:, about:, data:, view-source: and the
 * Chrome Web Store are not.
 */
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  let host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return null
  if (host.startsWith('www.') && host.length > 4) host = host.slice(4)

  // The Web Store is restricted for extensions; treat as unsupported.
  if (host === 'chromewebstore.google.com') return null
  if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return null

  return host
}

/** True if `domain` equals an excluded entry or is a subdomain of one. */
export function isExcluded(domain: string, excluded: readonly string[]): boolean {
  return excluded.some((e) => domain === e || domain.endsWith(`.${e}`))
}

/** Clean user-entered exclusion text into normalised domains. */
export function parseExcludedDomains(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(/[\s,]+/)) {
    if (!raw) continue
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    const d = domainFromUrl(candidate)
    if (d) seen.add(d)
  }
  return [...seen]
}

/**
 * Second-level labels that, under a two-letter country TLD, form a public suffix
 * (`co.uk`, `com.au`, `ac.jp` ...). A compact stand-in for the Public Suffix List.
 */
const CC_SECOND_LEVEL = new Set([
  'co', 'com', 'org', 'net', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'gob', 'gouv', 'mil', 'nom', 'ltd', 'plc', 'sch', 'me', 'id', 'in'
])

/** Hosting platforms where every subdomain is a different site (`alice.github.io`). */
const PLATFORM_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'blogspot.com', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'onrender.com', 'fly.dev',
  'wordpress.com', 'tumblr.com', 'substack.com', 'notion.site', 'myshopify.com', 'wixsite.com', 'repl.co', 'glitch.me'
])

/**
 * The site a hostname belongs to: `mail.google.com` -> `google.com`,
 * `news.bbc.co.uk` -> `bbc.co.uk`, `alice.github.io` -> `alice.github.io`.
 * IP addresses and single-label hosts (`localhost`) are returned unchanged.
 * Approximate: it does not bundle the full Public Suffix List.
 */
export function siteOf(host: string): string {
  if (host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return host // IPv6 / IPv4
  const labels = host.split('.')
  if (labels.length <= 2) return host

  let suffixLen = 1
  const last2 = labels.slice(-2).join('.')
  if (PLATFORM_SUFFIXES.has(last2)) suffixLen = 2
  else if (labels[labels.length - 1].length === 2 && CC_SECOND_LEVEL.has(labels[labels.length - 2])) suffixLen = 2

  if (labels.length <= suffixLen + 1) return host
  return labels.slice(-(suffixLen + 1)).join('.')
}
