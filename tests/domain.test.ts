import {describe, expect, it} from 'vitest'
import {domainFromUrl, isExcluded, parseExcludedDomains} from '../src/shared/domain'

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
