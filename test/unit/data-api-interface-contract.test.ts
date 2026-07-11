import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildDataApiCapabilityMatrix,
  cacheCoverageForInterface,
  dataApiCacheCoverage,
  eligibleCapabilitiesForInterface,
  getDataApiInterface,
  listDataApiInterfaces,
  listDataApiProviders,
  registeredCapabilitiesForInterface,
  validateDataApiInterfaceContract,
} from '../../src/agent/data/data-api-interface-contract'
import { runDataApiInterfaceRoute } from '../../src/agent/data/data-api-interface-router'
import { setCurrentRuntimeBasePath } from '../../src/agent/data/current-runtime-base-path'

describe('data API interface provider contract', () => {
  it('defines interface-owned provider capability registration', () => {
    const problems = validateDataApiInterfaceContract()
    expect(problems).toEqual([])

    const interfaces = listDataApiInterfaces()
    expect(interfaces.length).toBeGreaterThanOrEqual(10)
    expect(listDataApiProviders()).toEqual([
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

    const fundNav = getDataApiInterface('fund.nav_history')
    expect(fundNav).toMatchObject({
      canonicalSchema: 'fund_nav',
      dataStoreTables: ['fund_nav'],
      queryActions: ['query_fund_nav'],
    })
    expect(fundNav?.params).toEqual(expect.arrayContaining(['provider', 'providerMode']))
    expect(fundNav?.capabilities.map((item) => item.provider)).toEqual(expect.arrayContaining(['akshare', 'eastmoney', 'tushare', 'wind']))

    const limitPool = getDataApiInterface('market.limit_pool')
    expect(limitPool).toMatchObject({
      canonicalSchema: 'limit_pool',
      dataStoreTables: ['limit_pool'],
      queryActions: ['query_limit_pool'],
    })
    expect(limitPool?.capabilities.map((item) => item.provider)).toEqual(expect.arrayContaining(['eastmoney', 'akshare', 'tdx', 'tushare', 'wind']))
    expect(getDataApiInterface('calendar.trade_days')?.capabilities.map((item) => item.provider)).toEqual(expect.arrayContaining(['szse', 'akshare', 'tushare']))
    expect(getDataApiInterface('calendar.trade_days')?.capabilities.find((item) => item.id === 'akshare.calendar.trade_days')).toMatchObject({
      provider: 'akshare',
      status: 'supported',
      upstreamOrigin: 'sina',
      adapter: 'tool_trade_date_hist_sina',
      canonicalTable: 'trade_calendar',
      probeId: 'sina.reference.akshare.tool_trade_date_hist_sina',
    })
    expect(getDataApiInterface('stock.daily_valuation')?.capabilities.map((item) => item.provider)).toEqual(expect.arrayContaining(['akshare', 'tushare', 'eastmoney', 'tdx', 'wind']))
    expect(getDataApiInterface('data.feed_status')).toMatchObject({
      canonicalSchema: 'data_feed_config',
      dataStoreTables: ['data_feed_config'],
      queryActions: ['data_feeds'],
    })
    expect(getDataApiInterface('data.feed_status')?.capabilities.find((item) => item.id === 'local.data.feed_status')).toMatchObject({
      provider: 'local',
      status: 'supported',
      adapter: 'DataStore data_feeds',
      canonicalTable: 'data_feed_config',
    })
    expect(getDataApiInterface('index.constituents')?.capabilities.find((item) => item.id === 'tushare.index.constituents')).toMatchObject({
      provider: 'tushare',
      status: 'credential-gated',
      adapter: 'index_weight',
      canonicalTable: 'index_constituent',
      probeId: 'electron_tushare_index_weight',
    })
    expect(getDataApiInterface('index.constituents')?.capabilities.find((item) => item.id === 'akshare.index.constituents')).toMatchObject({
      provider: 'akshare',
      status: 'supported',
      upstreamOrigin: 'sina',
      adapter: 'index_stock_cons',
      canonicalTable: 'index_constituent',
      probeId: 'sina.wrapper.akshare_index_stock_cons',
      reason: expect.stringContaining('not direct Sina provider ability'),
    })
    expect(getDataApiInterface('index.quote')?.capabilities.find((item) => item.id === 'eastmoney.index.quote')).toMatchObject({
      adapter: 'sidecar direct EastMoney stock_zh_index_spot_em clist route',
      probeId: 'electron_eastmoney_index_quote',
    })
    expect(getDataApiInterface('index.quote')?.capabilities.find((item) => item.id === 'akshare.index.quote')).toMatchObject({
      adapter: 'sidecar /index/quotes',
      probeId: 'electron_sidecar_index_quotes',
    })
    expect(getDataApiInterface('index.quote')?.capabilities.find((item) => item.id === 'sina.index.quote')).toMatchObject({
      provider: 'sina',
      status: 'supported',
      adapter: 'hq.sinajs.cn s_ index symbols',
      normalizer: 'getIndexQuotesFromSina',
      canonicalTable: 'quote_snapshot',
      probeId: 'electron_sina_index_quote',
    })
    expect(getDataApiInterface('index.quote')?.capabilities.find((item) => item.id === 'tencent.index.quote')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      adapter: 'qt.gtimg.cn index quote symbols',
      normalizer: 'getIndexQuotesFromTencent',
      canonicalTable: 'quote_snapshot',
      probeId: 'tencent.direct.index_quote',
    })
    expect(getDataApiInterface('stock.quote')?.capabilities.find((item) => item.id === 'sina.stock.quote')).toMatchObject({
      provider: 'sina',
      status: 'supported',
      adapter: 'hq.sinajs.cn A-share quote symbols',
      normalizer: 'sinaQuotes',
      canonicalTable: 'quote_snapshot',
      probeId: 'electron_sina_quote',
    })
    expect(getDataApiInterface('stock.risk_metrics')).toMatchObject({
      canonicalSchema: 'stock_company_info',
      dataStoreTables: ['stock_company_info'],
      queryActions: ['query_stock_risk_metrics', 'query_company_info'],
    })
    expect(getDataApiInterface('stock.daily_valuation')).toMatchObject({
      canonicalSchema: 'fundamental',
      dataStoreTables: ['fundamental'],
      queryActions: ['query_stock_daily_valuation', 'query_fundamental'],
    })
    expect(getDataApiInterface('stock.company_info')).toMatchObject({
      canonicalSchema: 'stock_company_info',
      dataStoreTables: ['stock_company_info'],
      queryActions: ['query_stock_company_info', 'query_company_info'],
    })
    expect(getDataApiInterface('market.sector_ranking')).toMatchObject({
      canonicalSchema: 'sector_rank',
      dataStoreTables: ['sector_ranking'],
      queryActions: ['query_sector_ranking', 'query_sector'],
    })
    expect(getDataApiInterface('market.board_ranking')).toMatchObject({
      canonicalSchema: 'sector_rank',
      dataStoreTables: ['sector_ranking'],
      queryActions: ['query_board_ranking', 'query_sector'],
    })
    expect(getDataApiInterface('stock.quote')).toMatchObject({
      canonicalSchema: 'quote_snapshot',
      dataStoreTables: ['quote_snapshot'],
      queryActions: ['query_quote'],
    })
    expect(getDataApiInterface('index.quote')).toMatchObject({
      canonicalSchema: 'quote_snapshot',
      dataStoreTables: ['quote_snapshot'],
      queryActions: ['query_index_quote', 'query_quote'],
    })
    expect(getDataApiInterface('fund.etf_quote')).toMatchObject({
      canonicalSchema: 'quote_snapshot',
      dataStoreTables: ['quote_snapshot', 'stock_list'],
      queryActions: ['query_etf_quote', 'query_quote', 'stock_list'],
    })
    expect(getDataApiInterface('fund.listed_fund_quote')).toMatchObject({
      canonicalSchema: 'quote_snapshot',
      dataStoreTables: ['quote_snapshot', 'stock_list'],
      queryActions: ['query_listed_fund_quote', 'query_quote', 'stock_list'],
    })
    expect(getDataApiInterface('fund.listed_fund_quote')?.capabilities.find((item) => item.id === 'tencent.fund.listed_fund_quote')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      canonicalTable: 'quote_snapshot',
    })
    expect(getDataApiInterface('bond.convertible_quote')).toMatchObject({
      canonicalSchema: 'quote_snapshot',
      dataStoreTables: ['quote_snapshot'],
      queryActions: ['query_bond_quote', 'query_quote'],
    })
    expect(getDataApiInterface('bond.convertible_quote')?.capabilities.find((item) => item.id === 'tencent.bond.convertible_quote')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      canonicalTable: 'quote_snapshot',
    })
    expect(getDataApiInterface('bond.convertible_daily_kline')).toMatchObject({
      canonicalSchema: 'kline_daily',
      dataStoreTables: ['kline_daily'],
      queryActions: ['query_bond_kline', 'query_kline'],
    })
    expect(getDataApiInterface('bond.convertible_daily_kline')?.capabilities.find((item) => item.id === 'tencent.bond.convertible_daily_kline')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      canonicalTable: 'kline_daily',
    })
    expect(getDataApiInterface('fund.etf_daily_ohlcv_bars')).toMatchObject({
      canonicalSchema: 'kline_daily',
      dataStoreTables: ['kline_daily'],
      queryActions: ['query_kline'],
    })
    expect(getDataApiInterface('fund.etf_daily_ohlcv_bars')?.capabilities.find((item) => item.id === 'akshare.sina.fund.etf_daily_ohlcv_bars')).toMatchObject({
      provider: 'akshare',
      status: 'supported',
      upstreamOrigin: 'sina',
      canonicalTable: 'kline_daily',
    })
    expect(getDataApiInterface('fund.etf_daily_ohlcv_bars')?.capabilities.find((item) => item.id === 'tencent.fund.etf_daily_ohlcv_bars')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      canonicalTable: 'kline_daily',
    })
    expect(getDataApiInterface('fund.etf_daily_ohlcv_bars')?.capabilities.find((item) => item.id === 'sina.fund.etf_daily_ohlcv_bars')).toMatchObject({
      provider: 'sina',
      status: 'not-supported',
    })
    expect(getDataApiInterface('fund.etf_transactions')).toMatchObject({
      canonicalSchema: 'transactions',
      dataStoreTables: ['transactions'],
      queryActions: ['query_transactions'],
    })
    expect(getDataApiInterface('fund.etf_transactions')?.capabilities.find((item) => item.id === 'tencent.fund.etf_transactions')).toMatchObject({
      provider: 'tencent',
      status: 'supported',
      canonicalTable: 'transactions',
    })
    expect(getDataApiInterface('market.board_members')).toMatchObject({
      canonicalSchema: 'industry_map',
      dataStoreTables: ['industry_map', 'quote_snapshot', 'stock_list'],
      queryActions: ['query_board_members', 'query_industry_map', 'query_quote'],
    })
    expect(getDataApiInterface('market.sector_constituents')).toMatchObject({
      canonicalSchema: 'industry_map',
      dataStoreTables: ['industry_map', 'quote_snapshot', 'stock_list'],
      queryActions: ['query_sector_constituents', 'query_industry_map', 'query_quote'],
    })
  })

  it('treats data API interfaces as canonical normalization boundaries', () => {
    for (const item of listDataApiInterfaces()) {
      for (const capability of item.capabilities) {
        if (capability.status !== 'supported') continue
        expect(capability.normalizer, `${item.id}/${capability.id} normalizer`).toBeTruthy()
        expect(capability.canonicalTable, `${item.id}/${capability.id} canonicalTable`).toBeTruthy()
        if (item.dataStoreTables.length === 0) {
          expect(item.freshnessPolicy, `${item.id}/${capability.id} generated local evidence`).toMatch(/^generated-/)
        } else {
          expect(item.dataStoreTables, `${item.id}/${capability.id} table ownership`).toContain(capability.canonicalTable)
        }
      }
    }
  })

  it('keeps concrete normalizer hooks backed by implementation source', () => {
    const corpus = sourceCorpus([
      join(process.cwd(), 'src/agent/data'),
      join(process.cwd(), 'src/agent/tools'),
      join(process.cwd(), 'src/domain/market'),
    ])
    const missing = listDataApiInterfaces()
      .flatMap((item) =>
        item.capabilities.flatMap((capability) =>
          concreteImplementationHooks(capability.normalizer).map((hook) => ({
            hook,
            ref: `${item.id}/${capability.id}`,
          })),
        ),
      )
      .filter(({ hook }) => !corpus.includes(hook))
      .map(({ ref, hook }) => `${ref}:${hook}`)

    expect(missing).toEqual([])
  })

  it('keeps interface readback actions backed by implementation source', () => {
    const corpus = sourceCorpus([
      join(process.cwd(), 'src/agent/data'),
      join(process.cwd(), 'src/agent/tools'),
      join(process.cwd(), 'src/domain/market'),
    ])
    const missing = listDataApiInterfaces()
      .flatMap((item) =>
        item.queryActions.map((action) => ({
          action,
          ref: item.id,
        })),
      )
      .filter(({ action }) => !corpus.includes(action))
      .map(({ ref, action }) => `${ref}:${action}`)

    expect(missing).toEqual([])
  })

  it('keeps normal workflow provider branches aligned with supported capabilities', () => {
    const quoteFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-quote.ts'), 'utf-8')
    const klineFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-kline-daily.ts'), 'utf-8')
    const indexKlineFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-index-kline.ts'), 'utf-8')
    const fundListFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-fund-list.ts'), 'utf-8')
    const fundNavFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-fund-nav.ts'), 'utf-8')
    const fundHoldingFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-fund-holding.ts'), 'utf-8')
    const fundManagerFetcher = readFileSync(join(process.cwd(), 'src/agent/data/fetchers/fetcher-fund-manager.ts'), 'utf-8')
    const fundService = readFileSync(join(process.cwd(), 'src/domain/market/services/fund-market-data-fetch-service.ts'), 'utf-8')
    const bridgeProvider = readFileSync(join(process.cwd(), 'src/domain/market/providers/bridge-finance-provider.ts'), 'utf-8')
    const transactionsService = readFileSync(join(process.cwd(), 'src/domain/market/services/transactions-market-data-service.ts'), 'utf-8')

    expectSupportedProvidersCovered('stock.quote', quoteFetcher, ['tdx', 'eastmoney', 'sina', 'akshare', 'tencent', 'yahoo'])
    expectSupportedProvidersCovered('stock.daily_kline', klineFetcher, ['tdx', 'eastmoney', 'akshare', 'sina', 'yahoo', 'tencent'])
    expectSupportedProvidersCovered('index.daily_kline', indexKlineFetcher, ['tdx', 'eastmoney', 'akshare', 'tencent'])
    expectSupportedProvidersCovered('index.quote', bridgeProvider, ['tdx', 'sina', 'tencent', 'akshare', 'eastmoney'])
    expectSupportedProvidersCovered('fund.identity_list', fundListFetcher, ['eastmoney', 'akshare'])
    expectSupportedProvidersCovered('fund.performance_metrics', fundListFetcher, ['eastmoney', 'akshare'])
    expectSupportedProvidersCovered('fund.nav_history', fundNavFetcher, ['eastmoney', 'akshare'])
    expectSupportedProvidersCovered('fund.holding', fundHoldingFetcher, ['eastmoney', 'akshare'])
    expectSupportedProvidersCovered('fund.manager', fundManagerFetcher, ['eastmoney', 'akshare'])
    expectSupportedProvidersCovered('fund.etf_quote', fundService, ['eastmoney', 'akshare', 'sina', 'tencent'])
    expectSupportedProvidersCovered('fund.listed_fund_quote', fundService, ['tencent'])
    expectSupportedProvidersCovered('bond.convertible_quote', quoteFetcher, ['tencent'])
    expectSupportedProvidersCovered('bond.convertible_daily_kline', klineFetcher, ['tencent'])
    expectSupportedProvidersCovered('fund.etf_daily_ohlcv_bars', klineFetcher, ['akshare', 'tencent'])
    expectSupportedProvidersCovered('fund.etf_transactions', transactionsService, ['tencent'])
  })

  it('declares DataStore-first cache coverage for every interface', () => {
    const rows = buildDataApiCapabilityMatrix()
    expect(rows.map((row) => row.cacheLookup.status)).toEqual(expect.arrayContaining([
      'implemented',
    ]))
    expect(cacheCoverageForInterface('stock.quote')).toMatchObject({
      status: 'implemented',
      reader: 'readRecentQuoteSnapshot',
    })
    expect(cacheCoverageForInterface('index.daily_kline')).toMatchObject({
      status: 'implemented',
      reader: 'readKlineRows',
    })
    expect(cacheCoverageForInterface('fund.etf_daily_ohlcv_bars')).toMatchObject({
      status: 'implemented',
      reader: 'readKlineRows',
    })
    expect(cacheCoverageForInterface('fund.listed_fund_quote')).toMatchObject({
      status: 'implemented',
      reader: 'readEtfQuoteRows',
    })
    expect(cacheCoverageForInterface('bond.convertible_quote')).toMatchObject({
      status: 'implemented',
      reader: 'readRecentQuoteSnapshot',
    })
    expect(cacheCoverageForInterface('bond.convertible_daily_kline')).toMatchObject({
      status: 'implemented',
      reader: 'readKlineRows',
    })
    expect(cacheCoverageForInterface('fund.etf_transactions')).toMatchObject({
      status: 'implemented',
      reader: 'readTransactionRows',
    })
    expect(cacheCoverageForInterface('news.finance_feed')).toMatchObject({
      status: 'implemented',
      reader: 'readFinanceNewsRows',
    })
    expect(cacheCoverageForInterface('market.screening')).toMatchObject({
      status: 'implemented',
      reader: 'readMarketScreeningSnapshots',
    })
    expect(cacheCoverageForInterface('stock.shareholders')).toMatchObject({
      status: 'implemented',
      reader: 'readStockShareholderRows',
    })
    const datastoreRowsWithoutCacheDeclaration = rows
      .filter((row) => row.dataStoreTables.length > 0)
      .filter((row) => row.cacheLookup.status === 'none')
      .map((row) => row.interfaceId)
    expect(datastoreRowsWithoutCacheDeclaration).toEqual([])
    expect(rows.filter((row) => row.cacheLookup.status === 'not-implemented').map((row) => row.interfaceId)).toEqual([])
  })

  it('keeps cache coverage reader declarations backed by implementation source', () => {
    const corpus = sourceCorpus([
      join(process.cwd(), 'src/agent/data'),
      join(process.cwd(), 'src/agent/tools'),
      join(process.cwd(), 'src/domain/market'),
    ])
    const interfaceIds = listDataApiInterfaces().map((item) => item.id).sort()
    expect(Object.keys(dataApiCacheCoverage.interfaces).sort()).toEqual(interfaceIds)

    const missing = Object.entries(dataApiCacheCoverage.interfaces)
      .filter(([, coverage]) => coverage.status === 'implemented')
      .filter(([, coverage]) => !coverage.reader || !corpus.includes(coverage.reader))
      .map(([interfaceId, coverage]) => `${interfaceId}:${coverage.reader ?? '<missing-reader>'}`)

    expect(missing).toEqual([])
  })

  it('keeps disabled Tushare capabilities registered as disabled, not callable support', () => {
    const matrix = buildDataApiCapabilityMatrix()
    expect(matrix.find((row) => row.interfaceId === 'fund.nav_history')?.providers.tushare).toBe('disabled')
    expect(matrix.find((row) => row.interfaceId === 'fund.identity_list')?.providers.tushare).toBe('disabled')
    expect(matrix.find((row) => row.interfaceId === 'stock.money_flow')?.providers.tushare).toBe('disabled')

    expect(eligibleCapabilitiesForInterface('fund.nav_history', { provider: 'tushare', providerMode: 'strict' })).toEqual([])
    expect(registeredCapabilitiesForInterface('fund.nav_history', { provider: 'tushare', providerMode: 'strict' })[0]).toMatchObject({
      provider: 'tushare',
      status: 'disabled',
    })
  })

  it('supports provider preference and strict provider constraints at the interface layer', () => {
    expect(eligibleCapabilitiesForInterface('stock.daily_kline').map((item) => item.provider).slice(0, 4)).toEqual([
      'tdx',
      'eastmoney',
      'akshare',
      'sina',
    ])

    expect(eligibleCapabilitiesForInterface('stock.daily_kline', {
      provider: 'akshare',
      providerMode: 'preferred',
    }).map((item) => item.provider)[0]).toBe('akshare')

    expect(eligibleCapabilitiesForInterface('stock.daily_kline', {
      provider: 'eastmoney',
      providerMode: 'strict',
    }).map((item) => item.provider)).toEqual(['eastmoney'])

    expect(eligibleCapabilitiesForInterface('stock.daily_kline', {
      provider: 'tushare',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'tushare',
      status: 'credential-gated',
    })
    expect(registeredCapabilitiesForInterface('stock.daily_kline', {
      provider: 'tushare',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'tushare',
      status: 'credential-gated',
    })

    expect(eligibleCapabilitiesForInterface('stock.identity_list').map((item) => item.provider)).toEqual([
      'tdx',
      'sina',
      'eastmoney',
      'akshare',
      'tencent',
    ])
    expect(registeredCapabilitiesForInterface('stock.identity_list', {
      provider: 'eastmoney',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'eastmoney',
      status: 'supported',
      adapter: 'push2delay clist stock universe',
    })
    expect(registeredCapabilitiesForInterface('stock.identity_list', {
      provider: 'tushare',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'tushare',
      status: 'credential-gated',
    })

    expect(eligibleCapabilitiesForInterface('stock.daily_valuation').map((item) => item.provider)).toEqual([
      'akshare',
      'eastmoney',
      'tdx',
    ])
    expect(registeredCapabilitiesForInterface('stock.daily_valuation', {
      provider: 'tdx',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'tdx',
      status: 'supported',
    })

    expect(eligibleCapabilitiesForInterface('calendar.trade_days').map((item) => item.provider)).toEqual(['szse', 'akshare'])
    expect(registeredCapabilitiesForInterface('calendar.trade_days', {
      provider: 'akshare',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'akshare',
      status: 'supported',
      upstreamOrigin: 'sina',
    })
    expect(registeredCapabilitiesForInterface('calendar.trade_days', {
      provider: 'tushare',
      providerMode: 'strict',
    })[0]).toMatchObject({
      provider: 'tushare',
      status: 'credential-gated',
    })
  })

  it('generates matrix artifacts from the same code-owned contract', () => {
    const jsonOut = join(process.cwd(), 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json')
    const mdOut = join(process.cwd(), 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.md')
    const output = execFileSync('node', [
      'scripts/finance_data_api_provider_matrix.mjs',
      '--no-write',
      'true',
      '--jsonOnly',
      'true',
      '--fail-on-problem',
      'true',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })
    expect(existsSync(jsonOut)).toBe(true)
    expect(existsSync(mdOut)).toBe(true)
    const payload = JSON.parse(output) as any
    expect(payload.summary.interfaces).toBeGreaterThanOrEqual(10)
    expect(payload.summary.problems).toBe(0)
    expect(payload.summary.cacheStatusCounts.implemented).toBeGreaterThan(10)
    const reusableProviderShapeGaps = payload.rows.flatMap((row: any) =>
      Object.values(row.providers)
        .filter((provider: any) => ['supported', 'global-only', 'credential-gated', 'quota-gated', 'transport-unstable'].includes(provider.status))
        .filter((provider: any) => !provider.normalizer || (row.dataStoreTables.length > 0 && !provider.canonicalTable))
        .map((provider: any) => `${row.interfaceId}/${provider.capabilityId}:${provider.status}`),
    )
    expect(reusableProviderShapeGaps).toEqual([])
    const reusableProviderTableOwnershipGaps = payload.rows.flatMap((row: any) =>
      Object.values(row.providers)
        .filter((provider: any) => ['supported', 'global-only', 'credential-gated', 'quota-gated', 'transport-unstable'].includes(provider.status))
        .filter((provider: any) => provider.canonicalTable && row.dataStoreTables.length > 0 && !row.dataStoreTables.includes(provider.canonicalTable))
        .map((provider: any) => `${row.interfaceId}/${provider.capabilityId}:${provider.canonicalTable}`),
    )
    expect(reusableProviderTableOwnershipGaps).toEqual([])
    expect(payload.rows.find((row: any) => row.interfaceId === 'fund.nav_history').providers.tushare.status).toBe('disabled')
    expect(payload.rows.find((row: any) => row.interfaceId === 'index.daily_kline').cacheLookup).toMatchObject({
      status: 'implemented',
      reader: 'readKlineRows',
    })
    expect(readFileSync(mdOut, 'utf-8')).toContain('| Category | Data API Interface | Chinese Purpose |')
    expect(readFileSync(mdOut, 'utf-8')).toContain('| fund_etf | `fund.nav_history` | 基金净值历史 | `fund_nav` | `fund_nav` |')
    expect(readFileSync(mdOut, 'utf-8')).toContain('Cache Lookup')
  })

  it('keeps capability probe IDs traceable to durable raw/status artifacts', () => {
    const inventory = JSON.parse(readFileSync(join(process.cwd(), 'reports/integrations/finance_api_surface_inventory_2026_06_17.json'), 'utf-8')) as any
    const liveStatusReport = JSON.parse(readFileSync(join(process.cwd(), 'reports/integrations/finance_live_status_report_2026_06_18.json'), 'utf-8')) as any

    const knownProbeIds = new Set<string>()
    for (const row of inventory.liveProbeRows ?? []) if (row.id) knownProbeIds.add(row.id)
    for (const group of ['passedApis', 'failures', 'credentialOrQuotaGatedApis', 'transportUnstableApis', 'runtimeBlockedApis']) {
      for (const row of liveStatusReport[group] ?? []) if (row.id) knownProbeIds.add(row.id)
    }
    for (const script of [
      'scripts/finance_sina_first_level_probe.mjs',
      'scripts/probe_tencent_first_level.mjs',
      'scripts/probe_tencent_broad_discovery.mjs',
    ]) {
      const source = readFileSync(join(process.cwd(), script), 'utf-8')
      for (const match of source.matchAll(/id:\s*['"]([^'"]+)['"]/g)) knownProbeIds.add(match[1])
      for (const match of source.matchAll(/candidate\(['"]([^'"]+)['"]/g)) knownProbeIds.add(match[1])
    }
    for (const artifact of [
      'reports/integrations/finance_data_unification_audit_2026_06_17.json',
      'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
      'reports/integrations/finance_output_only_api_contract_probe_2026_06_18.json',
    ]) {
      const source = readFileSync(join(process.cwd(), artifact), 'utf-8')
      for (const match of source.matchAll(/sina\.reference\.akshare\.[a-z0-9_]+/g)) knownProbeIds.add(match[0])
    }

    const missing = listDataApiInterfaces()
      .flatMap((item) => item.capabilities.map((capability) => ({ interfaceId: item.id, ...capability })))
      .filter((capability) => capability.probeId)
      .filter((capability) => !knownProbeIds.has(capability.probeId!))
      .map((capability) => `${capability.interfaceId}/${capability.id}:${capability.probeId}`)

    expect(missing).toEqual([])
  })

  it('keeps provider constraints independent from cache policy and requires matching provider evidence for strict cache hits', async () => {
    const cacheReader = vi.fn(() => 'cached')
    const strict = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      if (capability.provider !== 'tdx') return null
      return { capability, run: async () => 'tdx-provider' }
    }, {
      provider: 'tdx',
      providerMode: 'strict',
      readCache: cacheReader,
    })

    expect(cacheReader).toHaveBeenCalled()
    expect(strict).toMatchObject({
      data: 'tdx-provider',
      provider: 'tdx',
      cacheStatus: 'provider-hit',
      cacheMode: 'cache-first',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      cacheDecision: expect.stringContaining('does not satisfy strict provider tdx'),
    })

    const liveOnly = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      if (capability.provider !== 'tdx') return null
      return { capability, run: async () => 'tdx-provider' }
    }, {
      provider: 'tdx',
      providerMode: 'strict',
      cacheMode: 'live-only',
      readCache: cacheReader,
    })
    expect(liveOnly).toMatchObject({
      data: 'tdx-provider',
      provider: 'tdx',
      cacheStatus: 'provider-hit',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      cacheDecision: expect.stringContaining('live-only bypasses reusable local data'),
    })

    await expect(runDataApiInterfaceRoute('stock.quote', () => null, {
      label: 'quote',
      cacheMode: 'cache-only',
      readCache: () => null,
    })).rejects.toThrow(/quote cache-only lookup missed/)
  })

  it('rejects mismatched structured cache hits for strict provider requests', async () => {
    const provider = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      if (capability.provider !== 'tdx') return null
      return { capability, run: async () => [{ code: '600519', source: 'tdx' }] }
    }, {
      provider: 'tdx',
      providerMode: 'strict',
      readCache: () => ({
        cacheHit: true,
        data: [{ code: '600519', price: 1200, source: 'eastmoney' }],
        provider: 'eastmoney',
        source: 'eastmoney',
        capabilityId: 'local.cache',
      }),
    })

    expect(provider).toMatchObject({
      data: [{ code: '600519', source: 'tdx' }],
      provider: 'tdx',
      cacheStatus: 'provider-hit',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      cacheDecision: expect.stringContaining('does not satisfy strict provider tdx'),
    })

    await expect(runDataApiInterfaceRoute('stock.quote', () => null, {
      label: 'quote',
      provider: 'tdx',
      providerMode: 'strict',
      cacheMode: 'cache-only',
      readCache: () => ({
        cacheHit: true,
        data: [{ code: '600519', price: 1200, source: 'eastmoney' }],
        provider: 'eastmoney',
        source: 'eastmoney',
      }),
    })).rejects.toThrow(/cache rows came from eastmoney, which does not satisfy strict provider tdx/)
  })

  it('preserves cached provider provenance when cache readers return structured hits', async () => {
    const strict = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      if (capability.provider !== 'tdx') return null
      return { capability, run: async () => [{ code: '600519', source: 'tdx' }] }
    }, {
      provider: 'tdx',
      providerMode: 'strict',
      readCache: () => ({
        cacheHit: true,
        data: [{ code: '600519', price: 1200, source: 'tdx' }],
        provider: 'tdx',
        source: 'tdx',
        capabilityId: 'local.cache',
        cacheDecision: 'cache-first hit tdx quote_snapshot rows for requested strict provider',
      }),
    })

    expect(strict).toMatchObject({
      data: [{ code: '600519', price: 1200, source: 'tdx' }],
      capabilityId: 'local.cache',
      provider: 'tdx',
      source: 'tdx',
      cachedCapabilityId: 'local.cache',
      cachedProvider: 'tdx',
      cachedSource: 'tdx',
      cacheStatus: 'cache-hit',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      cacheDecision: 'cache-first hit tdx quote_snapshot rows for requested strict provider',
    })
  })

  it('returns explicit cache reuse decisions with local cache hits and provider fallthrough', async () => {
    const cached = await runDataApiInterfaceRoute('stock.quote', () => null, {
      cacheMode: 'cache-first',
      readCache: () => 'cached-quote',
    })
    expect(cached).toMatchObject({
      data: 'cached-quote',
      provider: 'local',
      cacheStatus: 'cache-hit',
      cacheMode: 'cache-first',
      cacheDecision: expect.stringContaining('cache reader returned reusable canonical rows'),
    })

    const provider = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      if (capability.provider !== 'tdx') return null
      return { capability, run: async () => 'tdx-provider' }
    }, {
      cacheMode: 'cache-first',
      readCache: () => null,
    })
    expect(provider).toMatchObject({
      data: 'tdx-provider',
      provider: 'tdx',
      cacheStatus: 'provider-hit',
      cacheDecision: expect.stringContaining('no reusable cache rows matched the requirement'),
    })
  })

  it('stops provider iteration on quota and auth failures', async () => {
    const attempted: string[] = []

    await expect(runDataApiInterfaceRoute('stock.quote', (capability) => {
      attempted.push(capability.provider)
      if (capability.provider === 'tdx') {
        return {
          capability,
          run: async () => {
            throw new Error('HTTP 429')
          },
        }
      }
      return { capability, run: async () => `${capability.provider}-provider` }
    }, {
      label: 'quote',
      cacheMode: 'live-only',
    })).rejects.toThrow(/quote interface providers failed: tdx: HTTP 429/)

    expect(attempted).toEqual(['tdx'])
  })

  it('continues provider fallback after ordinary transport failures', async () => {
    const attempted: string[] = []
    const routed = await runDataApiInterfaceRoute('stock.quote', (capability) => {
      attempted.push(capability.provider)
      if (capability.provider === 'tdx') {
        return {
          capability,
          run: async () => {
            throw new Error('socket hang up')
          },
        }
      }
      if (capability.provider === 'eastmoney') {
        return { capability, run: async () => 'eastmoney-provider' }
      }
      return null
    }, {
      cacheMode: 'live-only',
    })

    expect(routed).toMatchObject({
      data: 'eastmoney-provider',
      provider: 'eastmoney',
      cacheStatus: 'provider-hit',
    })
    expect(attempted).toEqual(['tdx', 'eastmoney'])
  })

  it('uses runtime probe evidence to skip temporarily blocked providers before fallback', async () => {
    const runtimeBasePath = mkdtempSync(join(tmpdir(), 'route-runtime-probe-'))
    const liveStatusDir = join(runtimeBasePath, 'data', 'runtime-probes', 'live-status')
    mkdirSync(liveStatusDir, { recursive: true })
    const temporaryBlockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    writeFileSync(
      join(liveStatusDir, 'latest.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        summary: { total: 1, passed: 0, failed: 1, blocked: 0 },
        failures: [{
          id: 'electron_tdx_quote',
          provider: 'tdx',
          status: 'failed',
          validationState: 'runtime-blocked',
          failureClass: 'transport',
          temporaryBlockUntil,
          routeBlockScope: 'capability',
        }],
      }),
      'utf-8',
    )
    setCurrentRuntimeBasePath(runtimeBasePath)
    const attempted: string[] = []
    try {
      const routed = await runDataApiInterfaceRoute('stock.quote', (capability) => {
        attempted.push(capability.provider)
        if (capability.provider === 'eastmoney') {
          return { capability, run: async () => 'eastmoney-provider' }
        }
        return null
      }, {
        cacheMode: 'live-only',
      })

      expect(routed).toMatchObject({
        data: 'eastmoney-provider',
        provider: 'eastmoney',
        cacheStatus: 'provider-hit',
      })
      expect(attempted).not.toContain('tdx')
      expect(attempted[0]).toBe('eastmoney')
    } finally {
      setCurrentRuntimeBasePath(null)
    }
  })

  it('uses runtime probe evidence to stop strict blocked provider routing before provider calls', async () => {
    const runtimeBasePath = mkdtempSync(join(tmpdir(), 'route-runtime-strict-block-'))
    const liveStatusDir = join(runtimeBasePath, 'data', 'runtime-probes', 'live-status')
    mkdirSync(liveStatusDir, { recursive: true })
    const temporaryBlockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    writeFileSync(
      join(liveStatusDir, 'latest.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        summary: { total: 1, passed: 0, failed: 1, blocked: 0 },
        failures: [{
          id: 'electron_tdx_quote',
          provider: 'tdx',
          status: 'failed',
          validationState: 'runtime-blocked',
          failureClass: 'transport',
          temporaryBlockUntil,
          routeBlockScope: 'capability',
        }],
      }),
      'utf-8',
    )
    setCurrentRuntimeBasePath(runtimeBasePath)
    const attempted: string[] = []
    try {
      await expect(runDataApiInterfaceRoute('stock.quote', (capability) => {
        attempted.push(capability.provider)
        return { capability, run: async () => 'should-not-run' }
      }, {
        cacheMode: 'live-only',
        provider: 'tdx',
        providerMode: 'strict',
        allowFallback: false,
      })).rejects.toThrow(
        /no runtime-eligible providers after probe evidence and activation-state gating: tdx:temporarily-blocked/,
      )

      expect(attempted).toEqual([])
    } finally {
      setCurrentRuntimeBasePath(null)
    }
  })
})

function expectSupportedProvidersCovered(interfaceId: string, sourceText: string, expectedProviders: string[]): void {
  const item = getDataApiInterface(interfaceId)
  const supported = item?.capabilities
    .filter((capability) => capability.status === 'supported' || capability.status === 'global-only')
    .map((capability) => capability.provider) ?? []
  expect(supported, `${interfaceId} supported providers`).toEqual(expect.arrayContaining(expectedProviders))
  for (const provider of expectedProviders) {
    expect(sourceText, `${interfaceId}/${provider} runtime branch`).toContain(`'${provider}'`)
  }
}

function concreteImplementationHooks(value?: string): string[] {
  if (!value) return []
  return value
    .split('/')
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item))
}

function sourceCorpus(paths: string[]): string {
  const files: string[] = []
  for (const path of paths) collectSourceFiles(path, files)
  return files.map((file) => readFileSync(file, 'utf-8')).join('\n')
}

function collectSourceFiles(path: string, files: string[]): void {
  const stat = statSync(path)
  if (stat.isFile()) {
    if (path.endsWith('data-api-interface-contract.ts')) return
    if (/\.(ts|tsx|js|mjs)$/.test(path)) files.push(path)
    return
  }
  for (const child of readdirSync(path)) {
    collectSourceFiles(join(path, child), files)
  }
}
