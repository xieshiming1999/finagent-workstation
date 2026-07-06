import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  OUTPUT_ONLY_INTERFACES,
  OUTPUT_ONLY_KNOWLEDGE_RECORDS,
  getOutputOnlyInterface,
} from '../../src/agent/data/output-only-interfaces'
import * as outputOnlyInterfaces from '../../src/agent/data/output-only-interfaces'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import type { ToolContext } from '../../src/agent/tool'

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-output-only-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

function makeCtx(basePath: string): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
    getConfigValue: () => undefined,
  }
}

describe('output-only finance API normalization', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    vi.unstubAllGlobals()
    closeDb()
    for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it('registers non-persisted interfaces with provider capabilities and knowledge records', () => {
    expect(OUTPUT_ONLY_INTERFACES.map((item) => item.id)).toEqual([
      'provider.discovery',
      'provider.diagnostic',
      'provider.status',
      'provider.reference_dataset',
      'market.intraday_ohlcv_bars',
      'stock.transaction_count',
      'market.classification_members',
      'stock.esg_rating_collection',
      'fund.dividend_factor',
      'fund.etf_daily_ohlcv_bars',
    ])

    for (const item of OUTPUT_ONLY_INTERFACES) {
      expect(item.persistencePolicy).toBe('output-only')
      expect(item.unknownSchemaPolicy).toBe('reject-normal-workflow')
      expect(item.capabilities.length, item.id).toBeGreaterThan(0)
      for (const capability of item.capabilities) {
        expect(capability.interfaceId).toBe(item.id)
        expect(capability.schemaId).toBe(item.schemaId)
        expect(capability.normalizer).toBeTruthy()
        expect(capability.persistencePolicy).toBe('output-only')
      }
    }

    expect(getOutputOnlyInterface('provider.discovery').capabilities.map((item) => item.provider)).toEqual([
      'akshare',
      'yfinance',
      'ta',
    ])
    expect(getOutputOnlyInterface('provider.diagnostic').capabilities.map((item) => item.provider)).toEqual([
      'akshare',
      'yfinance',
      'tdx',
      'ta',
      'tushare',
      'sina',
      'tencent',
    ])
    expect(getOutputOnlyInterface('market.intraday_ohlcv_bars').capabilities.map((item) => item.provider)).toEqual(['sina'])
    expect(getOutputOnlyInterface('stock.transaction_count').capabilities.map((item) => item.provider)).toEqual(['sina'])
    expect(getOutputOnlyInterface('market.classification_members').capabilities.map((item) => item.provider)).toEqual(['sina'])
    expect(getOutputOnlyInterface('stock.esg_rating_collection').capabilities.map((item) => item.provider)).toEqual(['sina'])
    expect(getOutputOnlyInterface('fund.dividend_factor').capabilities.map((item) => item.provider)).toEqual(['sina'])
    expect(getOutputOnlyInterface('fund.etf_daily_ohlcv_bars').capabilities.map((item) => item.provider)).toEqual(['sina', 'akshare', 'tencent'])
    expect(getOutputOnlyInterface('fund.etf_daily_ohlcv_bars').capabilities.map((item) => item.status)).toEqual([
      'diagnostic-only',
      'diagnostic-only',
      'diagnostic-only',
    ])
    expect(getOutputOnlyInterface('fund.etf_daily_ohlcv_bars').capabilities[1].reason).toContain('governed fund.etf_daily_ohlcv_bars Data API interface')
    expect(getOutputOnlyInterface('provider.reference_dataset').capabilities).toEqual([
      expect.objectContaining({
        id: 'akshare.sina.reference_dataset',
        provider: 'akshare',
        status: 'supported',
      }),
    ])

    for (const record of OUTPUT_ONLY_KNOWLEDGE_RECORDS) {
      expect(record.persistencePolicy).toBe('output-only')
      expect(record.parameterContract).toBeTruthy()
      expect(record.responseContract.topLevelFields).toContain('provenance')
      expect(record.availability.negativeCaseBehavior).toContain('typed error')
      expect(record.usagePolicy.retryPolicy).toContain('Do not retry')
    }
  })

  it('normalizes AkShare/Sina reference datasets as bounded output-only evidence', () => {
    const result = outputOnlyInterfaces.normalizeAkshareSinaReferenceDataset({
      functionName: 'stock_financial_report_sina',
      params: { stock: '600519', symbol: '资产负债表' },
      raw: { data: [{ 报告日: '2025-12-31', 资产总计: 100 }] },
    })

    expect(result).toMatchObject({
      ok: true,
      interfaceId: 'provider.reference_dataset',
      schemaId: 'provider_reference_dataset_result',
      status: 'success',
      provider: 'akshare',
      data: {
        upstreamOrigin: 'sina',
        functionName: 'stock_financial_report_sina',
        rowCount: 1,
        sampleColumns: ['报告日', '资产总计'],
      },
      provenance: {
        capabilityId: 'akshare.sina.reference_dataset',
        persistencePolicy: 'output-only',
        cacheStatus: 'not-cacheable',
        cacheDecision: expect.stringContaining('not eligible for canonical persistence'),
      },
    })
  })

  it('normalizes Sina known-schema output-only rows without canonical persistence', () => {
    const intraday = outputOnlyInterfaces.normalizeSinaIntradayOhlcvBars({
      symbol: 'sh600519',
      raw: [{ day: '2026-06-23 09:35:00', open: '1280', high: '1282', low: '1279', close: '1281', volume: '1000' }],
    })
    expect(intraday).toMatchObject({
      interfaceId: 'market.intraday_ohlcv_bars',
      schemaId: 'intraday_ohlcv_bar_result',
      provider: 'sina',
      status: 'success',
      provenance: {
        capabilityId: 'sina.market.intraday_ohlcv_bars',
        persistencePolicy: 'output-only',
        cacheStatus: 'not-cacheable',
        cacheDecision: expect.stringContaining('not eligible for canonical persistence'),
      },
    })
    expect(intraday.data.bars).toEqual([
      expect.objectContaining({ time: '2026-06-23 09:35:00', close: 1281, volume: 1000 }),
    ])

    const count = outputOnlyInterfaces.normalizeSinaStockTransactionCount({
      symbol: 'sh600519',
      date: '2026-06-23',
      pageSize: 60,
      raw: { count: 121 },
    })
    expect(count).toMatchObject({
      interfaceId: 'stock.transaction_count',
      schemaId: 'stock_transaction_count_result',
      provider: 'sina',
      status: 'success',
      data: {
        symbol: 'sh600519',
        date: '2026-06-23',
        count: 121,
        pageSize: 60,
        estimatedPages: 3,
      },
      provenance: {
        capabilityId: 'sina.stock.transaction_count',
        persistencePolicy: 'output-only',
        cacheStatus: 'not-cacheable',
      },
    })

    const dividend = outputOnlyInterfaces.normalizeSinaFundDividendFactor({
      symbol: '159998',
      raw: { data: [{ fsrq: '2026-06-20', fh: '0.012', ljjz: '1.023' }] },
    })
    expect(dividend).toMatchObject({
      interfaceId: 'fund.dividend_factor',
      schemaId: 'fund_dividend_factor_result',
      provider: 'sina',
      status: 'success',
      provenance: {
        capabilityId: 'sina.fund.dividend_factor',
        persistencePolicy: 'output-only',
        cacheStatus: 'not-cacheable',
      },
    })
    expect(dividend.data.rows).toEqual([
      expect.objectContaining({ date: '2026-06-20', dividend: 0.012, factor: 1.023 }),
    ])

    const hfqDividend = outputOnlyInterfaces.normalizeSinaFundDividendFactor({
      symbol: 'sh510050',
      raw: { total: 1, data: [{ d: '2025-12-17', f: '1', s: '1.0000000000000000', u: '0.7970000000000000' }] },
    })
    expect(hfqDividend.data.rows).toEqual([
      expect.objectContaining({ date: '2025-12-17', dividend: 0.797, factor: 1 }),
    ])

    const etfBars = outputOnlyInterfaces.normalizeSinaFundEtfDailyOhlcvBars({
      symbol: 'sh510050',
      raw: { data: [{ date: '2026-06-23', open: 1.01, high: 1.02, low: 1, close: 1.015, volume: 1000, amount: 1015 }] },
    })
    expect(etfBars).toMatchObject({
      interfaceId: 'fund.etf_daily_ohlcv_bars',
      schemaId: 'fund_etf_daily_ohlcv_bar_result',
      provider: 'akshare',
      status: 'success',
      provenance: {
        capabilityId: 'akshare.sina.fund.etf_daily_ohlcv_bars',
        persistencePolicy: 'output-only',
        cacheStatus: 'not-cacheable',
      },
    })
    expect(etfBars.data.bars).toEqual([
      expect.objectContaining({ date: '2026-06-23', close: 1.015, amount: 1015 }),
    ])
  })

  it('normalizes Sina controlled batch results with checkpoint and failure classification', () => {
    const members = outputOnlyInterfaces.normalizeSinaClassificationMemberBatch({
      raw: {
        nodeCount: 2,
        fetchedPages: 1,
        completed: false,
        checkpoint: { nextNodeIndex: 1, nextPage: 1 },
        failedPages: [],
        rows: [{ nodeCode: 'new_blhy', nodeName: '玻璃行业', symbol: 'sh600586', name: '金晶科技', trade: '5.1', changepercent: '1.2' }],
      },
    })
    expect(members).toMatchObject({
      ok: true,
      action: 'sina_classification_members_batch',
      interfaceId: 'market.classification_members',
      schemaId: 'market_classification_member_batch_result',
      provider: 'sina',
      status: 'success',
      data: {
        rowCount: 1,
        completed: false,
        checkpoint: { nextNodeIndex: 1, nextPage: 1 },
      },
      provenance: {
        capabilityId: 'sina.market.classification_members',
        persistencePolicy: 'output-only',
      },
    })
    expect(members.data.rows).toEqual([
      expect.objectContaining({ nodeCode: 'new_blhy', symbol: 'sh600586', trade: 5.1, changePercent: 1.2 }),
    ])

    const esg = outputOnlyInterfaces.normalizeSinaEsgRatingCollection({
      raw: {
        totalStocks: 1,
        fetchedPages: 1,
        completed: true,
        failedPages: [],
        rows: [{ symbol: 'SH600519', market: 'CN', agency: 'msci', agencyName: 'MSCI', esgScore: 'AA', esgDate: '2026-06-23' }],
      },
    })
    expect(esg).toMatchObject({
      ok: true,
      action: 'sina_esg_rating_collection',
      interfaceId: 'stock.esg_rating_collection',
      schemaId: 'stock_esg_rating_collection_result',
      provider: 'sina',
      status: 'success',
      data: { rowCount: 1, completed: true, checkpoint: null },
      provenance: {
        capabilityId: 'sina.stock.esg_rating_collection',
        persistencePolicy: 'output-only',
      },
    })
    expect(esg.data.rows).toEqual([
      expect.objectContaining({ symbol: 'SH600519', agency: 'msci', agencyName: 'MSCI', esgDate: '2026-06-23' }),
    ])
  })

  it('keeps registered normalizers and DataStore action exposure executable', () => {
    const exported = outputOnlyInterfaces as unknown as Record<string, unknown>
    for (const item of OUTPUT_ONLY_INTERFACES) {
      for (const capability of item.capabilities) {
        expect(typeof exported[capability.normalizer], capability.normalizer).toBe('function')
      }
    }

    const actionEnum = (new DataStoreTool().inputSchema.properties.action.enum ?? []) as string[]
    expect(actionEnum).toEqual(expect.arrayContaining([
      'provider_discovery',
      'provider_diagnostic',
      'provider_status',
      'provider_coverage',
      'provider_table_metadata',
      'global_fundamental_output',
      'technical_indicator',
      'sina_classification_members_batch',
      'sina_esg_rating_collection',
      'sina_fund_dividend_factor',
      'sina_intraday_ohlcv_bars',
    ]))
  })

  it('routes agent-facing discovery through output-only interfaces and TA calls through the canonical indicator interface', async () => {
    const basePath = makeBasePath()
    cleanupPaths.push(basePath)
    const store = new DataStore(basePath)
    await store.init()
    const tool = new DataStoreTool()
    tool.setDataStore(store)

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/akshare_search')) {
        return new Response(JSON.stringify({ total: 2, functions: ['stock_zh_a_spot_em', 'fund_open_fund_info_em'] }), { status: 200 })
      }
      if (url.includes('/ta/rsi')) {
        return new Response(JSON.stringify({ name: 'RSI', columns: ['rsi'], data: [45.1, 48.2, 51.3] }), { status: 200 })
      }
      if (url.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok', version: 'test' }), { status: 200 })
      }
      if (url.includes('/rate_limit/status')) {
        return new Response(JSON.stringify({ akshare: { interactive: { current_interval: 1 } }, yfinance: {} }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch)

    const discovery = JSON.parse(await tool.call('disc', {
      action: 'provider_discovery',
      provider: 'akshare',
      query: 'spot',
    }, makeCtx(basePath)))
    expect(discovery).toMatchObject({
      action: 'provider_discovery',
      interfaceId: 'provider.discovery',
      schemaId: 'provider_discovery_result',
      provider: 'akshare',
      status: 'success',
    })
    expect(discovery.data.items[0]).toMatchObject({ id: 'stock_zh_a_spot_em' })
    expect(discovery.provenance.persistencePolicy).toBe('output-only')
    expect(discovery.provenance.cacheDecision).toContain('not eligible for canonical persistence')

    const indicator = JSON.parse(await tool.call('ta', {
      action: 'technical_indicator',
      func: 'rsi',
      code: '600519',
    }, makeCtx(basePath)))
    expect(indicator).toMatchObject({
      action: 'technical_indicator',
      interfaceId: 'technical.indicator_series',
      schemaId: 'technical_indicator_series',
      provider: 'ta',
      providerMode: 'strict',
      requestedProvider: 'ta',
      allowFallback: true,
      status: expect.any(String),
    })
    expect(indicator.provenance).toMatchObject({
      persistencePolicy: 'canonical',
      providerMode: 'strict',
      requestedProvider: 'ta',
      allowFallback: true,
    })

    const status = JSON.parse(await tool.call('status', {
      action: 'provider_status',
    }, makeCtx(basePath)))
    expect(status).toMatchObject({
      action: 'provider_status',
      interfaceId: 'provider.status',
      schemaId: 'provider_status_result',
      provider: 'sidecar',
    })
    expect(status.data.providers.pythonSidecar).toMatchObject({ online: true })
  })

  it('routes Sina batch collectors through normalized output-only interfaces', async () => {
    const basePath = makeBasePath()
    cleanupPaths.push(basePath)
    const store = new DataStore(basePath)
    await store.init()
    const tool = new DataStoreTool()
    tool.setDataStore(store)

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('Market_Center.getHQNodes')) {
        return new Response(JSON.stringify([
          ['行业', null, null, [['玻璃行业', null, 'new_blhy']]],
        ]), { status: 200 })
      }
      if (url.includes('Market_Center.getHQNodeData')) {
        return new Response(JSON.stringify([
          { symbol: 'sh600586', name: '金晶科技', trade: '5.1', changepercent: '1.2' },
        ]), { status: 200 })
      }
      if (url.includes('EsgService.getEsgStocks')) {
        return new Response(JSON.stringify({
          result: {
            data: {
              info: {
                total: 1,
                stocks: [
                  {
                    symbol: 'SH600519',
                    market: 'CN',
                    esg_info: [
                      { agency: 'msci', agency_name: 'MSCI', esg_score: 'AA', esg_dt: '2026-06-23', remark: null },
                    ],
                  },
                ],
              },
            },
          },
        }), { status: 200 })
      }
      if (url.includes('/realstock/company/sh510050/hfq.js')) {
        return new Response('var sh510050hfq={"total":1,"data":[{"d":"2025-12-17","f":"1","s":"1.0000000000000000","u":"0.7970000000000000"}]};', { status: 200 })
      }
      if (url.includes('CN_MarketData.getKLineData') && url.includes('symbol=sh600519') && url.includes('scale=5')) {
        return new Response(JSON.stringify([
          { day: '2026-06-24 09:35:00', open: '10.1', high: '10.3', low: '10.0', close: '10.2', volume: '12000' },
        ]), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch)

    const classification = JSON.parse(await tool.call('sina-classification', {
      action: 'sina_classification_members_batch',
      maxNodes: 1,
      maxPagesPerNode: 1,
      pageSize: 10,
    }, makeCtx(basePath)))
    expect(classification).toMatchObject({
      action: 'sina_classification_members_batch',
      interfaceId: 'market.classification_members',
      schemaId: 'market_classification_member_batch_result',
      provider: 'sina',
      status: 'success',
      data: {
        rowCount: 1,
        fetchedPages: 1,
      },
    })
    expect(classification.data.rows[0]).toMatchObject({ nodeCode: 'new_blhy', symbol: 'sh600586' })

    const esg = JSON.parse(await tool.call('sina-esg', {
      action: 'sina_esg_rating_collection',
      maxPages: 1,
      pageSize: 10,
    }, makeCtx(basePath)))
    expect(esg).toMatchObject({
      action: 'sina_esg_rating_collection',
      interfaceId: 'stock.esg_rating_collection',
      schemaId: 'stock_esg_rating_collection_result',
      provider: 'sina',
      status: 'success',
      data: {
        rowCount: 1,
        fetchedPages: 1,
        completed: true,
      },
    })
    expect(esg.data.rows[0]).toMatchObject({ symbol: 'SH600519', agency: 'msci' })

    const dividend = JSON.parse(await tool.call('sina-dividend-factor', {
      action: 'sina_fund_dividend_factor',
      symbol: '510050',
    }, makeCtx(basePath)))
    expect(dividend).toMatchObject({
      action: 'sina_fund_dividend_factor',
      interfaceId: 'fund.dividend_factor',
      schemaId: 'fund_dividend_factor_result',
      provider: 'sina',
      status: 'success',
      canonicalSchema: 'fund_dividend_factor',
      canonicalTable: 'fund_dividend_factor',
      readbackAction: 'query_fund_dividend_factor',
      persistencePolicy: 'persisted',
      cacheStatus: 'provider-hit',
      persistedRows: 1,
      data: {
        symbol: 'sh510050',
        rowCount: 1,
      },
    })
    expect(dividend.data.rows[0]).toMatchObject({ date: '2025-12-17', dividend: 0.797, factor: 1 })
    expect(store.query<Record<string, unknown>>('SELECT * FROM fund_dividend_factor')).toHaveLength(1)
    const readback = await tool.call('fund-dividend-readback', {
      action: 'query_fund_dividend_factor',
      code: 'sh510050',
    }, makeCtx(basePath))
    expect(readback).toContain('interface:fund.dividend_factor')
    expect(readback).toContain('table:fund_dividend_factor')
    expect(readback).toContain('2025-12-17')

    const intraday = JSON.parse(await tool.call('sina-intraday-ohlcv', {
      action: 'sina_intraday_ohlcv_bars',
      code: '600519',
      intervalMinutes: 5,
    }, makeCtx(basePath)))
    expect(intraday).toMatchObject({
      action: 'sina_intraday_ohlcv_bars',
      interfaceId: 'market.intraday_ohlcv_bars',
      schemaId: 'intraday_ohlcv_bar_result',
      provider: 'sina',
      status: 'success',
      canonicalSchema: 'intraday_ohlcv_bars',
      canonicalTable: 'intraday_ohlcv_bars',
      readbackAction: 'query_intraday_ohlcv_bars',
      persistencePolicy: 'persisted',
      cacheStatus: 'provider-hit',
      persistedRows: 1,
      data: {
        symbol: 'sh600519',
        rowCount: 1,
      },
    })
    expect(intraday.data.bars[0]).toMatchObject({ time: '2026-06-24 09:35:00', close: 10.2, volume: 12000 })
    expect(store.query<Record<string, unknown>>('SELECT * FROM intraday_ohlcv_bars')).toHaveLength(1)
    const intradayReadback = await tool.call('intraday-ohlcv-readback', {
      action: 'query_intraday_ohlcv_bars',
      code: 'sh600519',
      intervalMinutes: 5,
    }, makeCtx(basePath))
    expect(intradayReadback).toContain('interface:market.intraday_ohlcv_bars')
    expect(intradayReadback).toContain('table:intraday_ohlcv_bars')
    expect(intradayReadback).toContain('2026-06-24 09:35:00')
    expect(store.query<Record<string, unknown>>('SELECT * FROM raw_api_payload')).toHaveLength(0)
  })

  it('routes provider metadata and global fundamentals through data interfaces', async () => {
    const basePath = makeBasePath()
    cleanupPaths.push(basePath)
    const store = new DataStore(basePath)
    await store.init()
    const tool = new DataStoreTool()
    tool.setDataStore(store)

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/yfinance/eps_trend?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [
            { _index: 'estimate', '2026Q1': 2.1, '2026Q2': 2.3 },
          ],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch)

    const coverage = JSON.parse(await tool.call('coverage-meta', {
      action: 'provider_coverage',
      provider: 'tdx',
    }, makeCtx(basePath)))
    expect(coverage).toMatchObject({
      ok: true,
      action: 'provider_coverage',
      interfaceId: 'provider.coverage',
      schemaId: 'provider_coverage',
      canonicalSchema: 'provider_coverage',
      provider: 'tdx',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      status: 'empty',
      persistencePolicy: 'persistable',
    })
    expect(coverage.canonicalTables).toEqual(['tdx_security_count', 'tdx_chart_sampling'])
    expect(coverage.provenance).toMatchObject({
      interfaceId: 'provider.coverage',
      provider: 'tdx',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      persistencePolicy: 'persistable',
      canonicalTables: ['tdx_security_count', 'tdx_chart_sampling'],
    })

    const table = JSON.parse(await tool.call('table-meta', {
      action: 'provider_table_metadata',
      provider: 'tdx',
    }, makeCtx(basePath)))
    expect(table).toMatchObject({
      ok: true,
      action: 'provider_table_metadata',
      interfaceId: 'provider.table_metadata',
      schemaId: 'provider_table_metadata',
      canonicalSchema: 'provider_table_metadata',
      provider: 'tdx',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      status: 'empty',
      persistencePolicy: 'persistable',
    })
    expect(table.canonicalTables).toEqual(['ex_category', 'ex_table_entry'])
    expect(table.provenance).toMatchObject({
      interfaceId: 'provider.table_metadata',
      provider: 'tdx',
      providerMode: 'strict',
      requestedProvider: 'tdx',
      allowFallback: true,
      persistencePolicy: 'persistable',
      canonicalTables: ['ex_category', 'ex_table_entry'],
    })

    const global = JSON.parse(await tool.call('global-fundamental', {
      action: 'global_fundamental_output',
      provider: 'yfinance',
      symbol: 'AAPL',
      dataset: 'eps_trend',
      cacheMode: 'live-only',
    }, makeCtx(basePath)))
    expect(global).toMatchObject({
      ok: true,
      action: 'global_fundamental_output',
      interfaceId: 'global.financial_statements',
      capabilityId: 'yahoo.global.financial_statements',
      schemaId: 'yfinance_statement_items',
      provider: 'yahoo',
      providerMode: 'strict',
      requestedProvider: 'yahoo',
      allowFallback: true,
      status: 'success',
      cacheStatus: 'provider-hit',
      persistencePolicy: 'persistable',
    })
    expect(global.data.rows).toHaveLength(2)
    expect(global.provenance).toMatchObject({
      interfaceId: 'global.financial_statements',
      provider: 'yahoo',
      providerMode: 'strict',
      requestedProvider: 'yahoo',
      allowFallback: true,
      canonicalTable: 'yfinance_statement_items',
      persistencePolicy: 'persistable',
    })

    const cached = JSON.parse(await tool.call('global-fundamental-cache', {
      action: 'global_fundamental_output',
      provider: 'yfinance',
      symbol: 'AAPL',
      dataset: 'eps_trend',
      cacheMode: 'cache-only',
    }, makeCtx(basePath)))
    expect(cached).toMatchObject({
      interfaceId: 'global.financial_statements',
      cacheStatus: 'cache-hit',
    })
    expect(cached.data.rows).toHaveLength(2)

    await expect(tool.call('query-yf-statements', {
      action: 'query_yfinance',
      symbol: 'AAPL',
      dataset: 'statements',
    }, makeCtx(basePath))).resolves.toContain('2026Q2 eps_trend estimate: 2.3')
  })
})
