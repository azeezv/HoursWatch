import {describe, expect, it} from 'vitest'
import {DEFAULT_SETTINGS, normalizeSettings} from '../src/shared/settings'

describe('normalizeSettings', () => {
  it('defaults idle detection to on with a 5 minute threshold', () => {
    expect(normalizeSettings(undefined)).toMatchObject({idleDetection: true, idleMinutes: 5})
    expect(DEFAULT_SETTINGS.idleMinutes).toBe(5)
  })
  it('accepts valid values and rejects bad ones', () => {
    expect(normalizeSettings({idleMinutes: 10, idleDetection: false})).toMatchObject({idleMinutes: 10, idleDetection: false})
    for (const bad of [0, -3, 'x', null, 99999, NaN]) expect(normalizeSettings({idleMinutes: bad}).idleMinutes).toBe(5)
    expect(normalizeSettings({idleDetection: 'yes'}).idleDetection).toBe(true)
  })
  it('upgrades settings saved before idle detection existed', () => {
    expect(normalizeSettings({theme: 'dark', hour12: true, trackingEnabled: true, minVisitSeconds: 2, excludedDomains: []}))
      .toMatchObject({theme: 'dark', idleDetection: true, idleMinutes: 5})
  })
})

describe('groupSubdomains', () => {
  it('defaults to on and survives a round trip', () => {
    expect(normalizeSettings({}).groupSubdomains).toBe(true)
    expect(normalizeSettings({groupSubdomains: false}).groupSubdomains).toBe(false)
    expect(normalizeSettings({groupSubdomains: 'no'}).groupSubdomains).toBe(true)
  })
})
