import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApiHealthFocus, buildRuntimeProbeFocus, filterRecent, groupRecentCalls, type ApiCallRow } from '../../src/renderer/components/ApiHealthPanel'

describe('API Health panel model', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters request rows to the selected recent debug window', () => {
    const rows: ApiCallRow[] = [
      row({ endpoint: '/api/recent', created_at: '2026-06-15T11:45:00.000Z', success: false }),
      row({ endpoint: '/api/old', created_at: '2026-06-15T10:00:00.000Z', success: false }),
    ]

    expect(filterRecent(rows, 30).map((item) => item.endpoint)).toEqual(['/api/recent'])
  })

  it('groups recent calls by source and endpoint with failures first', () => {
    const groups = groupRecentCalls([
      row({ source: 'eastmoney', endpoint: '/api/qt/clist/get', success: false, error: 'fetch failed', duration_ms: 6500, created_at: '2026-06-15T11:59:00.000Z' }),
      row({ source: 'eastmoney', endpoint: '/api/qt/clist/get', success: true, status: 200, duration_ms: 500, created_at: '2026-06-15T11:58:00.000Z' }),
      row({ source: 'tdx', endpoint: 'quote', success: true, status: 200, duration_ms: 80, created_at: '2026-06-15T11:59:30.000Z' }),
    ])

    expect(groups[0]).toMatchObject({
      source: 'eastmoney',
      endpoint: '/api/qt/clist/get',
      count: 2,
      successCount: 1,
      failureCount: 1,
      lastError: 'fetch failed',
    })
    expect(groups[0].p95Latency).toBe(6500)
    expect(groups[1]).toMatchObject({ source: 'tdx', endpoint: 'quote', failureCount: 0 })
  })

  it('builds governance focus rows from data-health queues', () => {
    const focus = buildApiHealthFocus({
      summary: {},
      failureActionQueue: [{
        provider: 'eastmoney',
        family: 'market.hot_rank',
        probeId: 'electron_eastmoney_hot_rank',
        validationState: 'runtime-blocked',
        failureClass: 'provider-contract',
        affectedInterfaces: ['market.hot_rank'],
        affectedCapabilities: [{
          interfaceId: 'market.hot_rank',
          capabilityId: 'eastmoney.market.hot_rank',
          canonicalSchema: 'hot_rank',
          readbackAction: 'query_hot_rank',
        }],
        nextAction: 'check direct EastMoney route',
      }],
      providerGapQueue: [{
        interfaceId: 'market.margin_trading',
        provider: 'akshare',
        gapClass: 'route-implementation-required',
        actionPriority: 3,
        capabilityId: 'akshare.market.margin_trading',
        probeId: 'electron_sidecar_margin',
        liveStatus: 'passed',
        normalizer: 'normalizeAkshareMarginTradingRow',
        canonicalTable: 'margin_trading',
        nextAction: 'finish readback',
      }],
      credentialActivationQueue: [{
        interfaceId: 'fund.company_info',
        provider: 'wind',
        status: 'credential-gated',
        actionPriority: 2,
        capabilityId: 'wind.fund.company_info',
        probeId: 'electron_wind_fund_info',
        liveStatus: 'passed',
        normalizer: 'normalizeWindFundInfo',
        canonicalTable: 'fund_company_info',
        nextAction: 'activate WIND_API_KEY',
      }],
      credentialValidatedQueue: [{
        interfaceId: 'wind.analytics_result',
        provider: 'wind',
        status: 'credential-gated',
        actionPriority: 4,
        capabilityId: 'wind.wind.analytics_result',
        probeId: 'electron_wind_analytics',
        liveStatus: 'passed',
        normalizer: 'normalizeWindAnalytics',
        canonicalTable: 'wind_analytics_result',
        nextAction: 'keep validated evidence visible',
      }],
    })

    expect(focus.rows).toHaveLength(4)
    expect(focus.rows[0]).toMatchObject({
      label: 'provider-contract',
      tone: 'bad',
      interfaceId: 'market.hot_rank',
      provider: 'eastmoney',
      evidence: 'capability eastmoney.market.hot_rank · schema hot_rank · readback query_hot_rank · interface market.hot_rank · probe electron_eastmoney_hot_rank',
      retryPolicy: 'retry only as a bounded targeted probe',
    })
    expect(focus.rows[1]).toMatchObject({
      label: 'route-implementation-required',
      interfaceId: 'market.margin_trading',
      provider: 'akshare',
      evidence: 'capability akshare.market.margin_trading · probe electron_sidecar_margin · live passed · normalizeAkshareMarginTradingRow/margin_trading',
      retryPolicy: 'do not retry until route implementation exists',
    })
    expect(focus.rows[2]).toMatchObject({
      label: 'passed',
      interfaceId: 'fund.company_info',
      provider: 'wind',
      retryPolicy: 'no broad retry; run the registered credential probe serially',
    })
    expect(focus.rows[3]).toMatchObject({
      label: 'passed',
      interfaceId: 'wind.analytics_result',
      provider: 'wind',
      nextAction: 'keep validated evidence visible',
      retryPolicy: 'no broad retry; rerun only the registered credential probe when evidence is stale or configuration changes',
    })
  })

  it('builds runtime probe focus rows from recommended and blocked targets', () => {
    const focus = buildRuntimeProbeFocus({
      recommendedTargets: [{
        probeId: 'tdx.runtime_probe',
        interfaceId: 'index.quote',
        provider: 'tdx',
        nextAction: 'Run selected TDX probe',
        expectedExitCondition: 'Passing evidence restores route readiness',
      }],
      blockedTargets: [{
        probeId: 'wind.analytics_probe',
        interfaceId: 'wind.analytics_result',
        provider: 'wind',
        reason: 'Credential is not validated',
        expectedExitCondition: 'Credential validation succeeds or route remains gated',
      }],
    })

    expect(focus).toMatchObject({
      recommendedCount: 1,
      blockedCount: 1,
    })
    expect(focus.rows).toEqual([
      expect.objectContaining({
        label: 'recommended probe',
        tone: 'warn',
        interfaceId: 'index.quote',
        provider: 'tdx',
        nextAction: 'Run selected TDX probe',
        exitCondition: 'Passing evidence restores route readiness',
      }),
      expect.objectContaining({
        label: 'blocked route',
        tone: 'bad',
        interfaceId: 'wind.analytics_result',
        provider: 'wind',
        nextAction: 'Credential is not validated',
        exitCondition: 'Credential validation succeeds or route remains gated',
      }),
    ])
  })
})

function row(overrides: Partial<ApiCallRow>): ApiCallRow {
  return {
    source: 'eastmoney',
    endpoint: '/api/test',
    status: 0,
    duration_ms: 100,
    success: false,
    created_at: '2026-06-15T11:59:00.000Z',
    ...overrides,
  }
}
