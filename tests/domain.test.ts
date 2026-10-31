import {describe, expect, it} from 'vitest'
import {domainFromUrl, isExcluded, parseExcludedDomains, siteOf} from '../src/shared/domain'
import {computeStats, groupSegments, segmentsForRange} from '../src/shared/stats'

describe('domainFromUrl', () => {
  it.each([
    ['https://github.com/a/b?q=1#x', 'github.com'],
    ['http://WWW.Example.COM:8080/', 'example.com'],
    ['https://sub.domain.co.uk/', 'sub.domain.co.uk'],
    ['http://localhost:3000/', 'localhost'],
    ['http://192.168.1.5/admin', '192.168.1.5'],
    ['https://example.com./', 'example.com']
  ])('%s -> %s', (url, domain) => expect(domainFromUrl(url)).toBe(domain))

  it.each([null, undefined, '', 'not a url', 'chrome://newtab', 'chrome-extension://x/y.html', 'ftp://a.com'])(
    '%s is not trackable',
    (u) => expect(domainFromUrl(u as string)).toBeNull()
  )
})

describe('exclusions', () => {
  it('matches the domain and its subdomains only', () => {
    expect(isExcluded('bank.com', ['bank.com'])).toBe(true)
    expect(isExcluded('login.bank.com', ['bank.com'])).toBe(true)
    expect(isExcluded('notbank.com', ['bank.com'])).toBe(false)
  })
  it('parses user input', () => {
    expect(parseExcludedDomains('https://www.Bank.com/x, mail.google.com\nfoo.org  junk junk')).toEqual([
      'bank.com',
      'mail.google.com',
      'foo.org',
      'junk'
    ])
  })
})

describe('siteOf', () => {
  it.each([
    ['mail.google.com', 'google.com'],
    ['a.b.c.google.com', 'google.com'],
    ['google.com', 'google.com'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['bbc.co.uk', 'bbc.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['gov.uk', 'gov.uk'],
    ['alice.github.io', 'alice.github.io'],
    ['docs.alice.github.io', 'alice.github.io'],
    ['localhost', 'localhost'],
    ['192.168.1.10', '192.168.1.10'],
    ['[::1]', '[::1]'],
    ['sub.localhost', 'sub.localhost']
  ])('%s -> %s', (host, site) => {
    expect(siteOf(host)).toBe(site)
  })
})

describe('groupSegments', () => {
  const visit = (id: string, domain: string, startTime: number, ms: number) =>
    ({id, domain, startTime, endTime: startTime + ms, durationMs: ms, createdAt: startTime})
  const visits = [
    visit('a', 'mail.google.com', 1_000, 60_000),
    visit('b', 'docs.google.com', 100_000, 30_000),
    visit('c', 'github.com', 200_000, 10_000)
  ]
  const segs = segmentsForRange(visits, 0, 1_000_000)

  it('merges subdomains of one site into one breakdown entry', () => {
    const stats = computeStats(groupSegments(segs, true))
    expect(stats.breakdown.map((d) => [d.domain, d.ms, d.visits])).toEqual([
      ['google.com', 90_000, 2],
      ['github.com', 10_000, 1]
    ])
    expect(stats.uniqueDomains).toBe(2)
  })

  it('keeps hostnames when grouping is off, and always remembers the exact host', () => {
    const stats = computeStats(groupSegments(segs, false))
    expect(stats.uniqueDomains).toBe(3)
    const grouped = groupSegments(segs, true)
    expect(grouped.map((s) => s.host)).toEqual(['mail.google.com', 'docs.google.com', 'github.com'])
  })

  it('lists the hostnames inside each site, largest first', () => {
    const [google, github] = computeStats(groupSegments(segs, true)).breakdown
    expect(google.hosts.map((x) => [x.host, x.ms, Math.round(x.percent)])).toEqual([
      ['mail.google.com', 60_000, 67],
      ['docs.google.com', 30_000, 33]
    ])
    expect(github.hosts).toHaveLength(1)
    expect(github.hosts[0]).toMatchObject({host: 'github.com', percent: 100})
  })
})
