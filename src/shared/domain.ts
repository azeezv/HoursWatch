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
