import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

const repoRoot = join(process.cwd(), '..')
const jsonOut = join(repoRoot, 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json')
const mdOut = join(repoRoot, 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.md')
const inventoryPath = join(repoRoot, 'reports/integrations/finance_api_surface_inventory_2026_06_17.json')

describe('detailed finance API call provider matrix', () => {
  beforeAll(() => {
    execFileSync('node', ['scripts/finance_detailed_api_call_provider_matrix.mjs', '--fail-on-problem', 'true'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })
  })

  it('covers every inventoried API/action row with every provider column', () => {
    expect(existsSync(jsonOut)).toBe(true)
    expect(existsSync(mdOut)).toBe(true)

    const report = JSON.parse(readFileSync(jsonOut, 'utf-8')) as any
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8')) as any
    expect(report.summary.totalRows).toBe(inventory.rows.length)
    expect(report.summary.inventoryRows).toBe(inventory.rows.length)
    expect(report.summary.problems).toBe(0)
    expect(report.summary.knownSurfaceRows).toBe(inventory.rows.length)
    expect(report.summary.unclassifiedRows).toBe(0)
    expect(report.summary.outputOnlyInterfaceRows).toBeGreaterThanOrEqual(18)
    expect(report.summary.providerRowsWithoutSurface).toBe(0)
    expect(Object.values(report.summary.rowsByLiveProbeRequirement).reduce((sum: number, count: any) => sum + Number(count), 0)).toBe(report.summary.totalRows)
    expect(report.summary.rowsByLiveProbeRequirement['live-tested']).toBeGreaterThan(0)
    expect(report.summary.rowsByLiveProbeRequirement['live-tested-via-capability']).toBeGreaterThan(0)
    expect(report.summary.rowsByLiveProbeRequirement['needs-live-probe'] ?? 0).toBe(0)
    expect(report.summary.rowsByLiveProbeRequirement['needs-live-status-evidence'] ?? 0).toBe(0)
    expect(report.summary.rowsByLiveProbeRequirement['not-required-local-or-control']).toBeGreaterThan(0)
    expect(report.summary.rowsByKind['registered-provider-capability']).toBe(63)
    expect(report.summary.rowsByKind['live-probe-contract-row']).toBe(9)
    expect(report.summary.rowsByGovernanceAction['add-live-probe'] ?? 0).toBe(0)
    expect(report.summary.rowsByGovernanceAction['add-readback'] ?? 0).toBe(0)
    expect(report.summary.rowsByGovernanceAction).toMatchObject({
      'governed-local': expect.any(Number),
      'governed-derived': expect.any(Number),
      'governed-contract': expect.any(Number),
      'governed-control': expect.any(Number),
    })
    expect(report.summary.rowsByGovernanceAction['governed']).toBeGreaterThan(300)
    expect(report.summary.rowsByGovernanceAction['governed-output-only']).toBeGreaterThanOrEqual(20)
    for (const interfaceId of ['provider.coverage', 'provider.table_metadata']) {
      const rows = report.rows.filter((row: any) => row.interfaceId === interfaceId)
      expect(rows.length, interfaceId).toBeGreaterThan(0)
      expect(rows.every((row: any) => ['governed', 'inspect-live-failure'].includes(row.governanceAction)), interfaceId).toBe(true)
      expect(rows.every((row: any) => row.persistenceStatus === 'persistable'), interfaceId).toBe(true)
    }
    expect(report.summary.rowsWithNoDurableLiveEvidence).toBe(0)
    expect(report.summary.unreferencedLiveStatusRows).toBe(0)
    expect(report.summary.rowsWithMissingDurableLiveEvidence).toBe(report.summary.rowsWithNoDurableLiveEvidence)
    expect(report.summary.rowsWithPartialDurableLiveEvidence).toBeGreaterThanOrEqual(0)
    expect(report.providerColumns).toEqual([
      'local',
      'eastmoney',
      'akshare',
      'tdx',
      'tushare',
      'wind',
      'yahoo',
      'sina',
      'tencent',
      'szse',
      'tradingview',
      'ta',
    ])

    const missingProviderCells = report.rows
      .filter((row: any) => report.providerColumns.some((provider: string) => !row.providerSupport[provider]))
      .map((row: any) => row.rowId)
    expect(missingProviderCells).toEqual([])
  })

  it('maps refactored requirement fetches to registered provider capabilities', () => {
    const report = JSON.parse(readFileSync(jsonOut, 'utf-8')) as any
    const rowFor = (action: string) => report.rows.find((row: any) => row.action === action || row.endpoint === action)

    expect(rowFor('query_money_flow')).toMatchObject({
      interfaceId: 'stock.money_flow',
      canonicalSchema: 'money_flow',
    })
    expect(rowFor('query_money_flow').providerSupport.eastmoney).toMatchObject({
      status: 'supported',
      capabilityId: 'eastmoney.stock.money_flow',
    })
    expect(rowFor('query_fund_holding')).toMatchObject({
      interfaceId: 'fund.holding',
      canonicalSchema: 'fund_holding',
    })
    expect(rowFor('query_fund_manager')).toMatchObject({
      interfaceId: 'fund.manager',
      canonicalSchema: 'fund_manager',
    })
    expect(rowFor('query_trade_calendar')).toMatchObject({
      interfaceId: 'calendar.trade_days',
      canonicalSchema: 'trade_calendar',
    })
    expect(rowFor('query_trade_calendar').providerSupport.szse).toMatchObject({
      status: 'supported',
      capabilityId: 'szse.calendar.trade_days',
    })
    expect(rowFor('chip')).toMatchObject({
      interfaceId: 'stock.chip_distribution',
      canonicalSchema: 'chip_distribution',
    })
    expect(rowFor('query_chip')).toMatchObject({
      interfaceId: 'stock.chip_distribution',
      canonicalSchema: 'chip_distribution',
    })
    expect(rowFor('hot_rank')).toMatchObject({
      interfaceId: 'market.hot_rank',
      canonicalSchema: 'hot_rank',
    })
    expect(rowFor('query_hot_rank')).toMatchObject({
      interfaceId: 'market.hot_rank',
      canonicalSchema: 'hot_rank',
    })
    expect(rowFor('dragon_tiger')).toMatchObject({
      interfaceId: 'market.dragon_tiger',
      canonicalSchema: 'dragon_tiger',
    })
    expect(rowFor('query_dragon_tiger')).toMatchObject({
      interfaceId: 'market.dragon_tiger',
      canonicalSchema: 'dragon_tiger',
    })
    expect(rowFor('unusual')).toMatchObject({
      interfaceId: 'market.unusual_activity',
      canonicalSchema: 'unusual_activity',
    })
    expect(rowFor('query_unusual')).toMatchObject({
      interfaceId: 'market.unusual_activity',
      canonicalSchema: 'unusual_activity',
    })
    expect(rowFor('flow_rank')).toMatchObject({
      interfaceId: 'market.flow_rank',
      canonicalSchema: 'flow_rank',
    })
    expect(rowFor('margin')).toMatchObject({
      interfaceId: 'market.margin_trading',
      canonicalSchema: 'margin_trading',
      persistenceStatus: 'persistable',
      readbackStatus: 'readback-defined',
    })
    expect(rowFor('tdx_tick_chart')).toMatchObject({
      interfaceId: 'stock.tick_chart_intraday',
      canonicalSchema: 'tick_chart_intraday',
    })
    expect(rowFor('tdx_transactions')).toMatchObject({
      interfaceId: 'stock.transactions',
      canonicalSchema: 'transactions',
    })
    expect(rowFor('tdx_volume_profile')).toMatchObject({
      interfaceId: 'stock.volume_profile',
      canonicalSchema: 'volume_profile',
    })
    expect(rowFor('tdx_xdxr')).toMatchObject({
      interfaceId: 'stock.xdxr_events',
      canonicalSchema: 'xdxr_event',
    })
    expect(rowFor('tdx_auction')).toMatchObject({
      interfaceId: 'stock.auction_snapshot',
      canonicalSchema: 'auction_snapshot',
    })
    expect(rowFor('tdx_company_info')).toMatchObject({
      interfaceId: 'stock.company_info',
      canonicalSchema: 'stock_company_info',
    })
    expect(rowFor('tdx_block')).toMatchObject({
      interfaceId: 'market.tdx_block_member',
      canonicalSchema: 'tdx_block_member',
    })
    expect(rowFor('tdx_top_board')).toMatchObject({
      interfaceId: 'market.tdx_top_board',
      canonicalSchema: 'tdx_top_board',
    })
    expect(rowFor('tdx_momentum')).toMatchObject({
      interfaceId: 'index.momentum',
      canonicalSchema: 'tdx_index_momentum',
    })
    expect(rowFor('yahoo_options')).toMatchObject({
      interfaceId: 'option.chain_snapshot',
      canonicalSchema: 'yfinance_options',
    })
    expect(rowFor('yahoo_actions')).toMatchObject({
      interfaceId: 'global.corporate_actions',
      canonicalSchema: 'yfinance_corporate_actions',
    })
    expect(rowFor('yahoo_news')).toMatchObject({
      interfaceId: 'global.finance_news',
      canonicalSchema: 'yfinance_news',
    })
    expect(rowFor('yahoo_earnings')).toMatchObject({
      interfaceId: 'global.company_profile',
      canonicalSchema: 'yfinance_profile_fields',
    })
    expect(rowFor('query_wind_document')).toMatchObject({
      interfaceId: 'wind.financial_document',
      canonicalSchema: 'wind_document',
      persistenceStatus: 'persistable',
      readbackStatus: 'readback-defined',
    })

    const eastmoneyEarnings = report.rows.find((row: any) => row.provider === 'eastmoney' && row.action === 'earnings')
    expect(eastmoneyEarnings).toMatchObject({
      interfaceId: 'stock.daily_valuation',
      canonicalSchema: 'fundamental',
      persistenceStatus: 'persistable',
      readbackStatus: 'readback-defined',
    })
    expect(eastmoneyEarnings.providerSupport.eastmoney).toMatchObject({
      status: 'supported',
      capabilityId: 'eastmoney.stock.daily_valuation',
    })

    const yahooEarningsDates = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'earnings_dates')
    expect(yahooEarningsDates).toMatchObject({
      interfaceId: 'global.earnings_calendar',
      canonicalSchema: 'yfinance_statement_items',
    })
    expect(yahooEarningsDates.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.earnings_calendar',
    })

    const yahooEarningsEstimate = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'earnings_estimate')
    expect(yahooEarningsEstimate).toMatchObject({
      interfaceId: 'global.earnings_estimates',
      canonicalSchema: 'yfinance_statement_items',
    })

    const yahooEarningsHistory = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'earnings_history')
    expect(yahooEarningsHistory).toMatchObject({
      interfaceId: 'global.earnings_history',
      canonicalSchema: 'yfinance_statement_items',
    })
    expect(yahooEarningsHistory.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.earnings_history',
    })

    const yahooEpsRevisions = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'eps_revisions')
    expect(yahooEpsRevisions).toMatchObject({
      interfaceId: 'global.eps_revisions',
      canonicalSchema: 'yfinance_statement_items',
    })
    expect(yahooEpsRevisions.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.eps_revisions',
    })

    const yahooEpsTrend = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'eps_trend')
    expect(yahooEpsTrend).toMatchObject({
      interfaceId: 'global.eps_trend',
      canonicalSchema: 'yfinance_statement_items',
    })
    expect(yahooEpsTrend.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.eps_trend',
    })

    const yahooQuarterlyCashFlow = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'quarterly_cash_flow')
    expect(yahooQuarterlyCashFlow).toMatchObject({
      interfaceId: 'global.quarterly_financial_statements',
      canonicalSchema: 'yfinance_statement_items',
    })
    expect(yahooQuarterlyCashFlow.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.quarterly_financial_statements',
    })

    const yahooUpgrades = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'upgrades_downgrades')
    expect(yahooUpgrades).toMatchObject({
      interfaceId: 'global.upgrade_downgrade_events',
      canonicalSchema: 'yfinance_recommendations',
    })

    const yahooInsiderTransactions = report.rows.find((row: any) => row.provider === 'yfinance' && row.endpoint === 'insider_transactions')
    expect(yahooInsiderTransactions).toMatchObject({
      interfaceId: 'global.insider_transactions',
      canonicalSchema: 'yfinance_insider_transactions',
    })
    expect(yahooInsiderTransactions.providerSupport.yahoo).toMatchObject({
      status: 'global-only',
      capabilityId: 'yahoo.global.insider_transactions',
    })

    const tushareIndexDaily = report.rows.find((row: any) => row.provider === 'tushare' && row.endpoint === 'index_daily')
    expect(tushareIndexDaily).toMatchObject({
      interfaceId: 'index.daily_kline',
      canonicalSchema: 'kline_daily',
    })
    expect(tushareIndexDaily.providerSupport.tushare).toMatchObject({
      status: 'credential-gated',
      capabilityId: 'tushare.index.daily_kline',
    })

    const akshareHolders = report.rows.find((row: any) => row.provider === 'akshare' && row.endpoint === 'holders')
    expect(akshareHolders).toMatchObject({
      interfaceId: 'stock.shareholders',
      canonicalSchema: 'stock_shareholder',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
      interfaceGovernance: 'data-api-interface',
      persistenceStatus: 'persistable',
      readbackStatus: 'readback-defined',
    })
    expect(akshareHolders.providerSupport.akshare).toMatchObject({
      status: 'supported',
      capabilityId: 'akshare.stock.shareholders',
    })
  })

  it('keeps unsupported or diagnostic raw surfaces explicit instead of hiding them', () => {
    const report = JSON.parse(readFileSync(jsonOut, 'utf-8')) as any
    expect(report.summary.unclassifiedRows).toBe(0)

    const rawPayload = report.rows.find((row: any) => row.action === 'query_raw_payload')
    expect(rawPayload).toMatchObject({
      interfaceId: null,
      surfaceId: 'local.readback.query_raw_payload',
      interfaceCoverageStatus: 'local-readback-or-status-surface',
    })

    const queryYfinance = report.rows.find((row: any) => row.action === 'query_yfinance' && row.runtime === 'finagent_workstation')
    expect(queryYfinance).toMatchObject({
      interfaceId: 'global.company_profile',
      surfaceId: 'global.company_profile',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
      persistenceStatus: 'persistable',
      readbackStatus: 'readback-defined',
      governanceAction: 'governed',
    })

    const falseReadbackDebt = report.rows
      .filter((row: any) => row.liveProbeRequirement === 'not-required-local-or-control')
      .filter((row: any) => row.governanceAction === 'add-readback' || row.readbackStatus === 'missing-readback')
      .map((row: any) => `${row.rowId}:${row.interfaceCoverageStatus}:${row.action ?? row.endpoint}`)
    expect(falseReadbackDebt).toEqual([])

    const genericAkshare = report.rows.find((row: any) => row.family === 'DataStore' && row.action === 'akshare')
    expect(genericAkshare).toMatchObject({
      interfaceId: 'provider.diagnostic',
      surfaceId: 'provider.diagnostic',
      interfaceCoverageStatus: 'normalized-output-only-interface',
      interfaceSource: 'registered-output-only-interface',
      outputOnlyCategory: 'diagnostic',
      outputOnlyReason: expect.stringContaining('Generic provider escape hatches'),
    })
    expect(genericAkshare.providerSupport.akshare.status).toBe('diagnostic-only')

    for (const action of ['akshare_search', 'yfinance_search', 'ta_search']) {
      expect(report.rows.find((row: any) => row.action === action || row.endpoint === action)).toMatchObject({
        interfaceId: 'provider.discovery',
        interfaceCoverageStatus: 'normalized-output-only-interface',
        outputOnlyCategory: 'discovery',
        outputOnlyReason: expect.stringContaining('Provider search/listing surfaces'),
      })
    }
    expect(report.rows.find((row: any) => row.action === 'sidecar_status' || row.endpoint === 'sidecar_status')).toMatchObject({
      interfaceId: 'provider.status',
      interfaceCoverageStatus: 'normalized-output-only-interface',
      outputOnlyCategory: 'status',
      outputOnlyReason: expect.stringContaining('Runtime/provider health snapshots'),
    })
    expect(report.rows
      .filter((row: any) => row.interfaceCoverageStatus === 'normalized-output-only-interface')
      .every((row: any) => row.outputOnlyCategory && row.outputOnlyReason)).toBe(true)
    expect(report.rows.find((row: any) => row.action === 'coverage' && row.runtime === 'finagent_workstation')).toMatchObject({
      interfaceId: 'data.coverage',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
      canonicalSchema: 'data_coverage',
      governanceAction: 'governed',
    })
    expect(report.rows.find((row: any) => row.action === 'backtest' && row.runtime === 'shared_mobile')).toMatchObject({
      interfaceCoverageStatus: 'derived-local-analysis-surface',
      surfaceCategory: 'derived-analysis',
      surfaceReason: expect.stringContaining('computed from governed input datasets'),
    })
    expect(report.rows.find((row: any) => row.action === 'fetch')).toMatchObject({
      interfaceCoverageStatus: 'queue-control-surface',
      surfaceCategory: 'queue-control',
      surfaceReason: expect.stringContaining('schedule or inspect data tasks'),
    })
    expect(report.rows.find((row: any) => row.endpoint === 'provider_routing_policy' && row.runtime === 'shared_mobile')).toMatchObject({
      interfaceCoverageStatus: 'contract-census-surface',
      surfaceCategory: 'contract-census',
      surfaceReason: expect.stringContaining('shared-mobile contract coverage'),
    })
    expect(report.rows.find((row: any) => row.action === 'help' && row.interfaceCoverageStatus === 'tool-action-not-data-interface')).toMatchObject({
      surfaceCategory: 'tool-control',
      surfaceReason: expect.stringContaining('operational guidance'),
    })
    expect(report.rows
      .filter((row: any) => ['local-readback-or-status-surface', 'derived-local-analysis-surface', 'contract-census-surface', 'queue-control-surface', 'tool-action-not-data-interface'].includes(row.interfaceCoverageStatus))
      .every((row: any) => row.surfaceCategory && row.surfaceReason)).toBe(true)
    expect(report.rows.find((row: any) => row.action === 'ta' || row.endpoint === 'ta')).toMatchObject({
      interfaceId: 'technical.indicator_series',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
    })
    expect(report.rows.find((row: any) => row.action === 'scan' || row.endpoint === 'scan')).toMatchObject({
      interfaceId: 'market.screening',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
    })

    const tdxIndexInfoAlias = report.rows.find((row: any) => row.endpoint === 'api/index_info')
    expect(tdxIndexInfoAlias).toMatchObject({
      interfaceId: 'index.quote',
      interfaceCoverageStatus: 'mapped-to-data-api-interface',
      readbackStatus: 'readback-defined',
      governanceAction: 'governed',
    })

    const providerRowsWithoutSurface = report.rows
      .filter((row: any) => ['eastmoney', 'akshare', 'tdx', 'tushare', 'wind', 'yfinance', 'sidecar', 'tradingview', 'ta'].includes(row.provider))
      .filter((row: any) => !row.surfaceId)
      .map((row: any) => `${row.rowId}:${row.provider}:${row.endpoint}`)
    expect(providerRowsWithoutSurface).toEqual([])

    expect(report.summary.rowsByInterfaceCoverageStatus['missing-data-api-interface'] ?? 0).toBe(0)
    expect(report.summary.rowsByInterfaceCoverageStatus).toMatchObject({
      'derived-local-analysis-surface': expect.any(Number),
      'contract-census-surface': expect.any(Number),
      'queue-control-surface': expect.any(Number),
    })
  })
})
