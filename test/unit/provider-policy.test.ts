import { describe, expect, it } from 'vitest'
import {
  normalizeFinanceProviders,
  providerOrder,
  requiresSerialCalls,
} from '../../src/agent/data/provider-policy'
import { cachePolicyFor } from '../../src/agent/data/cache-policy'

describe('finance provider policy', () => {
  it('keeps desktop quote provider fallback TDX, direct EastMoney, then AkShare compatibility', () => {
    expect(providerOrder('quote')).toEqual([
      'tdx',
      'eastmoneyDirect',
      'akshare',
    ])
  })

  it('keeps A-share kline routing TDX before direct EastMoney and AkShare compatibility', () => {
    expect(providerOrder('kline')).toEqual([
      'tdx',
      'eastmoneyDirect',
      'akshare',
    ])
  })

  it('routes index K-line through validated gotdx before direct EastMoney and AkShare compatibility', () => {
    expect(providerOrder('indexKline')).toEqual([
      'tdx',
      'eastmoneyDirect',
      'akshare',
    ])
  })

  it('keeps status-bar index quotes on TDX quote before network-heavy fallbacks', () => {
    expect(providerOrder('indexQuote')).toEqual([
      'tdx',
      'sina',
      'akshare',
    ])
  })

  it('gates Wind and Tushare for research-oriented data', () => {
    expect(providerOrder('fundamental')).toEqual([
      'eastmoneyDirect',
      'tdx',
    ])
    expect(
      providerOrder('fundamental', {
        windConfigured: true,
        windQuotaAvailable: true,
        tushareConfigured: true,
        tusharePermissionLikely: true,
      }),
    ).toEqual(['wind', 'tushare', 'eastmoneyDirect', 'tdx'])
  })

  it('does not route normal policy through unsupported provider-interface cells', () => {
    expect(providerOrder('intradayTick', { windConfigured: true })).toEqual(['tdx'])
    expect(providerOrder('sector', { windConfigured: true })).toEqual([
      'eastmoneyDirect',
      'akshare',
      'tdx',
    ])
    expect(
      providerOrder('dragonTiger', {
        windConfigured: true,
        windQuotaAvailable: true,
        tushareConfigured: true,
        tusharePermissionLikely: true,
      }),
    ).toEqual(['eastmoneyDirect'])
    expect(providerOrder('moneyFlow', { tushareConfigured: true })).toEqual([
      'eastmoneyDirect',
      'akshare',
    ])
    expect(providerOrder('moneyFlow', { windConfigured: true })).toEqual([
      'eastmoneyDirect',
      'akshare',
      'wind',
    ])
  })

  it('keeps local storage freshness in cache policy, not provider policy', () => {
    expect(providerOrder('quote')).not.toContain('local')
    expect(cachePolicyFor('quote')).toMatchObject({ mode: 'cache-first', maxAgeMs: 15_000 })
    expect(cachePolicyFor('kline')).toMatchObject({ mode: 'cache-first', minRows: 10 })
  })

  it('applies feed-scoped provider order after policy gates and aliases', () => {
    expect(normalizeFinanceProviders('akshare, eastmoney, tdx, akshare')).toEqual([
      'akshare',
      'eastmoneyDirect',
      'tdx',
    ])
    expect(providerOrder('kline', {}, normalizeFinanceProviders('akshare, tdx'))).toEqual([
      'akshare',
      'tdx',
    ])
    expect(providerOrder('kline', {}, normalizeFinanceProviders('eastmoney, akshare'))).toEqual([
      'eastmoneyDirect',
      'akshare',
    ])
    expect(providerOrder('fundamental', {}, normalizeFinanceProviders('wind, tushare, eastmoney'))).toEqual([
      'eastmoneyDirect',
    ])
  })

  it('filters temporarily blocked providers before preferred order is applied', () => {
    expect(
      providerOrder('quote', {
        temporarilyBlockedProviders: ['tdx'],
      }),
    ).toEqual(['eastmoneyDirect', 'akshare'])

    expect(
      providerOrder(
        'quote',
        { temporarilyBlockedProviders: ['tdx', 'eastmoneyDirect'] },
        normalizeFinanceProviders('tdx, eastmoney, akshare'),
      ),
    ).toEqual(['akshare'])

    expect(
      providerOrder(
        'fundamental',
        {
          windConfigured: true,
          windQuotaAvailable: true,
          tushareConfigured: true,
          tusharePermissionLikely: true,
          temporarilyBlockedProviders: ['wind', 'tushare'],
        },
        normalizeFinanceProviders('wind, tushare, eastmoney'),
      ),
    ).toEqual(['eastmoneyDirect'])
  })

  it('marks network-heavy providers as serial-call providers', () => {
    expect(requiresSerialCalls('tdx')).toBe(false)
    expect(requiresSerialCalls('eastmoneyDirect')).toBe(true)
    expect(requiresSerialCalls('sina')).toBe(true)
    expect(requiresSerialCalls('tencent')).toBe(true)
    expect(requiresSerialCalls('akshare')).toBe(true)
  })
})
