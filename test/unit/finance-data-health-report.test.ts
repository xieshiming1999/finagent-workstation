import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('finance data health report', () => {
  it('combines interface, provider, dataset, live status, and backlog evidence', () => {
    const output = execFileSync('node', [
      'scripts/finance_data_health_report.mjs',
      '--no-write',
      'true',
      '--fail-on-problem',
      'true',
      '--jsonOnly',
      'true',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    })
    const report = JSON.parse(output)

    expect(report.summary).toMatchObject({
      interfaces: 111,
      providers: 12,
      datasets: 63,
      liveProbeBacklogRows: 0,
      providerGapRows: 0,
      credentialActivationRows: 1,
      credentialValidatedRows: 37,
      policyDisabledRows: 5,
      providerGapPromotionCandidates: 0,
      providerGapSchemaKnownOutputOnly: 0,
      providerGapRouteImplementationRequired: 0,
      providerGapNonEquivalentWrappers: 0,
      providerGapLiveObserved: 0,
      credentialActivationLiveObserved: 0,
      credentialValidatedLiveObserved: 37,
      providerGapClassCounts: {},
      credentialActivationClassCounts: {
        'credential-or-quota-required': 1,
      },
      policyDisabledClassCounts: {
        'policy-disabled': 5,
      },
      problems: 0,
    })
    expect(report.summary.liveProviders).toBeGreaterThanOrEqual(10)
    expect(report.summary.detailedRows).toBeGreaterThanOrEqual(861)
    expect(report.summary.liveStatusRows).toBeGreaterThan(0)
    expect(report.summary.liveStatusPassed).toBeGreaterThan(0)
    expect(report.summary.liveStatusFailedOrBlocked).toBeGreaterThanOrEqual(0)
    expect(report.summary.failureActionRows).toBeGreaterThanOrEqual(0)
    expect(report.summary).not.toHaveProperty('completionAuditProblems')
    expect(report.summary.interfaceHealthCounts.observed).toBeGreaterThan(0)
    expect(report.summary.interfaceHealthCounts.registered).toBeGreaterThan(0)
    expect(
      report.summary.interfaceHealthCounts.observed +
        report.summary.interfaceHealthCounts.registered +
        (report.summary.interfaceHealthCounts.degraded ?? 0),
    ).toBe(report.summary.interfaces)

    const tdxProvider = report.providerHealth.find((row: { provider: string }) => row.provider === 'tdx')
    expect(tdxProvider).toMatchObject({
      healthState: 'available',
      liveProbeCount: expect.any(Number),
      liveFailures: 0,
      liveProbeBacklog: 0,
    })

    const tdxTopBoard = report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'market.tdx_top_board')
    expect(tdxTopBoard).toMatchObject({
      canonicalSchema: 'tdx_top_board',
      cacheStatus: 'implemented',
      healthState: 'observed',
      liveProbeBacklog: 0,
    })
    expect(tdxTopBoard.failures).toHaveLength(0)

    const quoteDataset = report.datasetHealth.find((row: { canonicalSchema: string }) => row.canonicalSchema === 'quote_snapshot')
    expect(quoteDataset).toMatchObject({
      healthState: 'observed',
      liveProbeBacklog: 0,
      failures: 0,
    })
    expect(quoteDataset.queryActions).toContain('query_quote')
    const fundCompanyInfo = report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'fund.company_info')
    expect(fundCompanyInfo).toMatchObject({
      canonicalSchema: 'stock_company_info',
      cacheStatus: 'implemented',
      healthState: 'observed',
      gatedProviders: [expect.objectContaining({ provider: 'wind', status: 'credential-gated' })],
      nextAction: expect.stringContaining('use cache/readback first'),
    })
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'stock.company_info')).toMatchObject({
      supportedProviders: expect.arrayContaining(['eastmoney', 'tdx']),
      gatedProviders: expect.arrayContaining([expect.objectContaining({ provider: 'wind', status: 'credential-gated' })]),
    })
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'market.margin_trading')).toMatchObject({
      supportedProviders: expect.arrayContaining(['akshare', 'szse']),
    })
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'calendar.trade_days')).toMatchObject({
      supportedProviders: expect.arrayContaining(['szse', 'tushare']),
      gatedProviders: [],
    })

    const windDocumentDataset = report.datasetHealth.find((row: { canonicalSchema: string }) => row.canonicalSchema === 'wind_document')
    expect(windDocumentDataset).toMatchObject({
      healthState: 'observed',
      queryActions: expect.arrayContaining(['query_wind_document']),
    })

    expect(report.failureActionQueue.length).toBeGreaterThanOrEqual(1)
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_sidecar_news')).toBeUndefined()
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_tdx_index_quote')).toBeUndefined()
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_tdx_quote')).toBeUndefined()
    expect(report.failureActionQueue.every((row: { presenceReason?: string; cacheDecision?: string; exitCondition?: string; retryPolicy?: string; nextAction?: string }) => row.presenceReason && row.cacheDecision && row.exitCondition && row.retryPolicy && row.nextAction)).toBe(true)
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_tushare_index_weight')).toMatchObject({
      provider: 'tushare',
      capabilityId: 'tushare.index.constituents',
      canonicalSchema: 'index_constituent',
      canonicalTable: 'index_constituent',
      readbackAction: 'query_index_constituents',
      cacheDecision: expect.stringContaining('query_index_constituents'),
      exitCondition: expect.stringContaining('endpoint entitlement or account permission changes'),
    })
    const tushareFailure = report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_tushare_index_weight')
    expect(tushareFailure.affectedCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interfaceId: 'index.constituents',
          provider: 'tushare',
          capabilityId: 'tushare.index.constituents',
        }),
      ]),
    )
    expect(tushareFailure.affectedCapabilities.every((capability: { provider?: string }) => capability.provider === 'tushare')).toBe(true)
    expect(tushareFailure.affectedCapabilities.some((capability: { capabilityId?: string }) => capability.capabilityId === 'akshare.index.constituents')).toBe(false)
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'electron_tdx_company_info')).toBeUndefined()
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'mobile_marketdata_tdx_top_board')).toBeUndefined()
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'mobile_marketdata_tushare')).toBeUndefined()
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'global.company_profile')).toMatchObject({
      healthState: 'observed',
      supportedProviders: expect.arrayContaining(['yahoo']),
      queryActions: expect.arrayContaining(['query_global_company_profile']),
      nextAction: expect.stringContaining('Maintain interface/readback contract'),
    })
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'mobile_marketdata_yahoo_earnings')).toBeUndefined()
    expect(report.failureActionQueue.find((row: { probeId?: string }) => row.probeId === 'mobile_marketdata_yahoo_options')).toBeUndefined()
    expect(report.liveProviderHealth.length).toBeGreaterThanOrEqual(11)
    expect(report.liveProviderHealth.find((row: { provider: string }) => row.provider === 'sidecar')).toMatchObject({
      healthState: 'observed',
      liveProbeCount: expect.any(Number),
      failures: 0,
    })
    expect(report.liveProviderHealth.find((row: { provider: string }) => row.provider === 'yfinance')).toMatchObject({
      normalizedProvider: 'yahoo',
      healthState: 'observed',
      failures: 0,
    })
    expect(report.liveProviderHealth.find((row: { provider: string }) => row.provider === 'sina')).toMatchObject({
      healthState: 'observed',
      liveProbeCount: 3,
      failures: 0,
    })
    expect(report.providerGapQueue).toHaveLength(0)
    expect(report.credentialActivationQueue).toHaveLength(1)
    expect(report.credentialValidatedQueue).toHaveLength(37)
    expect(report.policyDisabledQueue).toHaveLength(5)
    expect(report.providerGapQueue.every((row: { id?: string; interfaceId?: string; provider?: string; gapClass?: string; actionPriority?: number; cacheDecision?: string; nextAction?: string }) => row.id === `gap:${row.interfaceId}:${row.provider}` && row.gapClass && typeof row.actionPriority === 'number' && row.cacheDecision && row.nextAction)).toBe(true)
    expect(report.credentialActivationQueue.every((row: { id?: string; interfaceId?: string; provider?: string; reason?: string; cacheDecision?: string; nextAction?: string }) => row.id === `gap:${row.interfaceId}:${row.provider}` && row.reason && row.cacheDecision && row.nextAction)).toBe(true)
    expect(report.credentialValidatedQueue.every((row: { id?: string; interfaceId?: string; provider?: string; liveStatus?: string; normalizer?: string; canonicalTable?: string; cacheDecision?: string; nextAction?: string }) => row.id === `gap:${row.interfaceId}:${row.provider}` && row.liveStatus === 'passed' && row.normalizer && row.canonicalTable && row.cacheDecision && row.nextAction)).toBe(true)
    expect(report.policyDisabledQueue.every((row: { id?: string; interfaceId?: string; provider?: string; status?: string; gapClass?: string; cacheDecision?: string; nextAction?: string; reason?: string }) => row.id === `gap:${row.interfaceId}:${row.provider}` && row.status === 'disabled' && row.gapClass === 'policy-disabled' && row.cacheDecision && row.nextAction && row.reason)).toBe(true)
    expect(report.providerGapQueue.some((row: { gapClass?: string }) => row.gapClass === 'serial-live-retry')).toBe(false)
    expect(report.providerGapQueue.filter((row: { promotionCandidate?: boolean }) => row.promotionCandidate)).toHaveLength(0)
    expect(report.providerGapQueue.filter((row: { routeImplementationRequired?: boolean }) => row.routeImplementationRequired)).toHaveLength(0)
    expect(report.providerGapQueue.filter((row: { routeWiringStatus?: string }) => row.routeWiringStatus === 'non-equivalent-wrapper')).toHaveLength(0)
    expect(report.providerGapQueue.some((row: { provider: string }) => row.provider === 'wind' && row.status === 'output-only')).toBe(false)
    expect(report.credentialActivationQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'index.constituents' && row.provider === 'tushare')).toMatchObject({
      status: 'credential-gated',
      liveStatus: 'failed',
      gapClass: 'credential-or-quota-required',
      nextAction: expect.stringContaining('fix credential/quota/provider state'),
    })
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'index.constituents')).toMatchObject({
      healthState: 'observed',
      failures: expect.arrayContaining([
        expect.objectContaining({ failureClass: 'auth_permission' }),
      ]),
      nextAction: expect.stringContaining('keep gated-provider failures visible without degrading the interface'),
    })
    expect(report.providerGapQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'index.quote' && row.provider === 'eastmoney')).toBeUndefined()
    expect(report.providerGapQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'index.constituents' && row.provider === 'wind')).toBeUndefined()
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'option.chain_snapshot')).toMatchObject({
      canonicalSchema: 'yfinance_options',
      cacheStatus: 'implemented',
      healthState: 'registered',
      liveProbeBacklog: 0,
    })
    expect(report.credentialValidatedQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'fund.company_info' && row.provider === 'wind')).toMatchObject({
      status: 'credential-gated',
      gapClass: 'credential-or-quota-required',
      actionPriority: 2,
      liveStatus: 'passed',
    })
    expect(report.providerGapQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'market.unusual_activity' && row.provider === 'akshare')).toBeUndefined()
    expect(report.interfaceHealth.find((row: { interfaceId: string }) => row.interfaceId === 'market.unusual_activity').providerStatusCounts).toMatchObject({
      'not-supported': expect.any(Number),
    })
    expect(report.policyDisabledQueue.find((row: { interfaceId: string; provider: string }) => row.interfaceId === 'fund.nav_history' && row.provider === 'tushare')).toMatchObject({
      status: 'disabled',
      gapClass: 'policy-disabled',
      actionPriority: 5,
    })
    expect(report.problems).toEqual([])
  })

  it('renders workflow and gated providers explicitly in markdown', () => {
    execFileSync('node', [
      'scripts/finance_data_health_report.mjs',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    })
    const markdown = readFileSync('reports/integrations/finance_data_health_report_2026_06_18.md', 'utf-8')
    expect(markdown).toContain('| Interface | Purpose | Schema | Health | Workflow providers | Gated providers | Cache | Backlog | Failures | Next action |')
    expect(markdown).toContain('| `stock.company_info` | 个股公司资料与F10信息 | `stock_company_info` | observed | eastmoney, tdx | wind (credential-gated) | implemented | 0 | 0 |')
    expect(markdown).toContain('| `fund.company_info` | Fund company and product information | `stock_company_info` | observed | - | wind (credential-gated) | implemented | 0 | 0 |')
    expect(markdown).toContain('| `market.margin_trading` | 融资融券余额与交易明细 | `margin_trading` | observed | akshare, szse | - | implemented | 0 | 0 |')
    expect(markdown).toContain('| `index.constituents` | 指数成分股与权重 | `index_constituent` |')
    expect(markdown).toContain('| Probe | Provider | Family | Validation | Failure | Interfaces | Capability | Matrix rows | Schema/Table | Readback | Presence reason | Cache decision | Exit condition | Retry policy | Next action |')
    expect(markdown).toContain('| electron_tushare_index_weight | tushare | index_weight | credential-gated | auth_permission | index.constituents | tushare.index.constituents |')
    expect(markdown).toContain('Use query_index_constituents readback if local data is fresh enough')
    expect(markdown).toContain('no automatic retry until provider entitlement or permission changes')
    expect(markdown).toContain('Do not retry electron_tushare_index_weight automatically')
    expect(markdown).toContain('disabled Tushare capabilities are not provider fallbacks')
  })
})
