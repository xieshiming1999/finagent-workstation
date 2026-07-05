import { describe, expect, it } from 'vitest'
import {
  cacheSourceForProvider,
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  strictCacheSourceFromFetchOptions,
} from '../../src/agent/data/fetchers/fetcher-interface-utils'

describe('fetcher interface options', () => {
  it('keeps cache policy separate from explicit provider selection', () => {
    expect(cacheModeFromFetchOptions({ provider: 'tdx', providerMode: 'strict' })).toBe('cache-first')
    expect(strictCacheSourceFromFetchOptions({ provider: 'tdx', providerMode: 'strict' })).toBe('tdx')
    expect(providerConstraintFromFetchOptions({ provider: 'tdx', providerMode: 'strict' })).toMatchObject({
      provider: 'tdx',
      providerMode: 'strict',
    })
  })

  it('uses live-only only when cache policy explicitly asks for it', () => {
    expect(cacheModeFromFetchOptions({ provider: 'tdx', cacheMode: 'live-only' })).toBe('live-only')
    expect(cacheModeFromFetchOptions({ provider: 'tdx', skipCache: true })).toBe('live-only')
  })

  it('keeps legacy provider lists as preferred routing constraints', () => {
    expect(providerConstraintFromFetchOptions({ providers: ['eastmoneyDirect'] })).toMatchObject({
      provider: 'eastmoney',
      providerMode: 'preferred',
    })
    expect(strictCacheSourceFromFetchOptions({ providers: ['eastmoneyDirect'] })).toBeUndefined()
    expect(cacheSourceForProvider('yahoo')).toBe('yfinance')
  })
})
