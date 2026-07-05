import { describe, expect, it } from 'vitest'
import {
  classifyApiFailure,
  classifyApiFailures,
  isFinanceApiFailure,
  shouldStopProviderRetries,
} from '../../src/agent/api-failure-classifier'

describe('finance API failure classifier', () => {
  it('classifies recent provider failures for triage and doctor visibility', () => {
    expect(classifyApiFailure({ status: 0, error: 'network/proxy blocked upstream request' })).toBe('transport')
    expect(classifyApiFailure({ status: 0, failureClass: 'schema-or-contract', error: 'provider contract mismatch' })).toBe('contract_mismatch')
    expect(classifyApiFailure({ status: 429, error: 'rate limit exceeded' })).toBe('quota_rate_limit')
    expect(classifyApiFailure({ status: 400, error: 'invalid parameter: fs' })).toBe('invalid_parameters')
    expect(classifyApiFailure({ status: 502, error: 'bad gateway' })).toBe('provider_outage')
    expect(classifyApiFailure({ error: 'quota permission schema timeout' })).toBe('unknown')
  })

  it('groups failures with example endpoints', () => {
    const grouped = classifyApiFailures([
      { endpoint: '/api/finance/index/quotes', failureClass: 'transport', error: 'network/proxy blocked upstream request' },
      { endpoint: '/api/qt/clist/get', failureClass: 'transport', error: 'fetch failed' },
      { endpoint: '/api/qt/stock/get', failureClass: 'schema-or-contract', error: 'provider contract mismatch' },
    ])

    expect(grouped.map((row) => `${row.classification}:${row.count}`)).toEqual([
      'transport:2',
      'contract_mismatch:1',
    ])
    expect(grouped[0].examples[0]).toContain('/api/finance/index/quotes')
  })

  it('detects finance-related rows even when source is generic', () => {
    expect(isFinanceApiFailure({ source: 'bridge', endpoint: '/api/finance/index/quotes' })).toBe(true)
    expect(isFinanceApiFailure({ source: 'sidecar', endpoint: '/news' })).toBe(true)
    expect(isFinanceApiFailure({ source: 'eastmoney', endpoint: '/api/qt/clist/get' })).toBe(true)
    expect(isFinanceApiFailure({ source: 'browser', endpoint: '/api/user/profile' })).toBe(false)
  })

  it('marks quota and auth failures as provider retry stop conditions', () => {
    expect(shouldStopProviderRetries({ status: 429, error: 'TUSHARE_RATE_LIMIT: trade_cal frequency limited' })).toBe(true)
    expect(shouldStopProviderRetries({ status: 403, error: 'KEY_MISSING: WIND_API_KEY is required' })).toBe(true)
    expect(shouldStopProviderRetries({ status: 0, error: 'provider contract mismatch' })).toBe(false)
    expect(shouldStopProviderRetries({ status: 0, error: 'network/proxy blocked upstream request' })).toBe(false)
  })
})
