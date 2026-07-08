import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { screenFund, screenStock } from '../../src/agent/tools/data-store-tool-remote'
import { DataProcessTool } from '../../src/agent/tools/data-process'
import type { ToolContext } from '../../src/agent/tool'

const cleanupPaths: string[] = []

describe('DataStore screening failure logging', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    closeDb()
    for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it('logs failed stock screening without persisting reusable screening rows', async () => {
    const store = await openStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'sidecar unavailable' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(screenStock(store, { limit: 2 })).rejects.toThrow('sidecar unavailable')

    expect(store.queryMarketScreeningSnapshots()).toHaveLength(0)
    expect(apiCalls(store)).toEqual([
      expect.objectContaining({
        source: 'akshare',
        tool: 'DataStore',
        action: 'screen_stock',
        endpoint: 'screener/stock',
        success: 0,
        error: 'sidecar unavailable',
      }),
    ])
  })

  it('logs failed fund screening HTTP responses without persisting reusable screening rows', async () => {
    const store = await openStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fund screener timeout', { status: 504 })))

    await expect(screenFund(store, { limit: 2 })).rejects.toThrow('fund screener timeout')

    expect(store.queryMarketScreeningSnapshots()).toHaveLength(0)
    expect(apiCalls(store)).toEqual([
      expect.objectContaining({
        source: 'akshare',
        tool: 'DataStore',
        action: 'screen_fund',
        endpoint: 'screener/fund',
        status: 504,
        success: 0,
        error: 'fund screener timeout',
      }),
    ])
  })

  it('normalizes common PE/ROE screening aliases before calling the sidecar', async () => {
    const store = await openStore()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      expect(body).toMatchObject({
        limit: 5,
        gates: [
          { factor: 'pe_ttm', op: '<=', value: 20 },
          { factor: 'roe', op: '>=', value: 15 },
        ],
      })
      return new Response(JSON.stringify({
        status: 'ok',
        total_universe: 10,
        passed_gates: 1,
        returned: 1,
        gate_diagnostics: [
          { factor: 'pe_ttm', op: '<=', value: 20, available_rows: 9, total_rows: 10, missing_rows: 1, status: 'ok' },
          { factor: 'roe', op: '>=', value: 15, available_rows: 2, total_rows: 3, missing_rows: 1, status: 'ok' },
        ],
        stocks: [{ code: '600519', name: '贵州茅台', price: 1200, factors: { pe_ttm: 18, roe: 20 } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await screenStock(store, {
      limit: 5,
      params: { pe_max: 20, roe_min: 15 },
    })

    expect(result).toContain('10 universe -> 1 passed -> 1 returned')
    expect(result).toContain('Gate coverage:')
    expect(result).toContain('pe_ttm <= 20: available 9/10')
    expect(result).toContain('roe >= 15: available 2/3')
    expect(result).toContain('pe_ttm:18')
    expect(result).toContain('roe:20')
  })

  it('surfaces fund screener source and coverage diagnostics', async () => {
    const store = await openStore()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      mode: '4433',
      total_universe: 100,
      passed: 2,
      returned: 1,
      data_source: 'local',
      coverage: { rows: 100, return_1y: 80, return_3y: 60, nav: 90 },
      funds: [{ code: '110011', name: '易方达中小盘', nav: 5.12, return_1y: 12.3, return_3y: 45.6 }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const result = await screenFund(store, { mode: '4433', limit: 1 })
    expect(JSON.parse(result)).toMatchObject({
      action: 'screen_fund',
      interfaceId: 'fund.candidate_research',
      provider: 'local',
      mode: '4433',
      totalUniverse: 100,
      passed: 2,
      returned: 1,
      coverage: { rows: 100, return_1y: 80, return_3y: 60, nav: 90 },
      candidates: [{ code: '110011', name: '易方达中小盘' }],
    })
  })

  it('rejects DataProcess stock statistics for explicit fund symbols', async () => {
    const store = await openStore()
    store.saveFundList([{
      code: '000001',
      name: '华夏成长混合',
      fund_type: 'mixed',
      company: null,
      manager: null,
      setup_date: null,
      total_size: 10,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-06-26',
    }])
    const tool = new DataProcessTool()

    await expect(tool.call('dp-fund-stats', { action: 'stats', code: '000001.OF' }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))).rejects.toThrow(
      'known fund code in fund_list',
    )
  })

  it('allows ambiguous bare stock codes when local K-line rows exist', async () => {
    const store = await openStore()
    store.saveFundList([{
      code: '000001',
      name: '华夏成长混合',
      fund_type: 'mixed',
      company: null,
      manager: null,
      setup_date: null,
      total_size: 10,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-06-26',
    }])
    store.saveKline(Array.from({ length: 25 }, (_, index) => ({
      code: '000001',
      date: `2026-05-${String(index + 1).padStart(2, '0')}`,
      open: 10 + index * 0.1,
      high: 10.2 + index * 0.1,
      low: 9.8 + index * 0.1,
      close: 10.1 + index * 0.1,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))
    const tool = new DataProcessTool()

    await expect(tool.call('dp-stock-indicators', { action: 'indicators', code: '000001', indicators: ['rsi'] }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))).resolves.toContain(
      '"action": "indicators"',
    )
  })

  it('returns typed technical indicator evidence for stock K-line rows', async () => {
    const store = await openStore()
    store.saveKline(Array.from({ length: 30 }, (_, index) => ({
      code: '300059',
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      open: 20 + index * 0.1,
      high: 20.2 + index * 0.1,
      low: 19.8 + index * 0.1,
      close: 20.1 + index * 0.1,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))

    const result = await new DataProcessTool().call(
      'dp-stock-indicators',
      { action: 'indicators', code: '300059', indicators: ['rsi'] },
      makeCtx(cleanupPaths[cleanupPaths.length - 1]),
    )

    expect(JSON.parse(result)).toMatchObject({
      action: 'indicators',
      code: '300059',
      bars: 30,
      latest: { date: '2026-06-30', close: 23 },
      interfaceId: 'technical.indicator_series',
      canonicalSchema: 'technical_indicator_series',
      canonicalTable: 'technical_indicator_series',
      provider: 'local',
      indicators: { rsi14: expect.any(Number) },
    })
  })

  it('does not classify core market index codes as funds when fund_list has colliding codes', async () => {
    const store = await openStore()
    store.saveFundList([{
      code: '000300',
      name: '华夏沪深300ETF联接',
      fund_type: 'index',
      company: null,
      manager: null,
      setup_date: null,
      total_size: 10,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-06-26',
    }])
    store.saveKline(Array.from({ length: 25 }, (_, index) => ({
      code: '000300',
      date: `2026-05-${String(index + 1).padStart(2, '0')}`,
      open: 10 + index * 0.1,
      high: 10.2 + index * 0.1,
      low: 9.8 + index * 0.1,
      close: 10.1 + index * 0.1,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))
    const tool = new DataProcessTool()

    const output = await tool.call('dp-index-indicators', {
      action: 'indicators',
      code: '000300',
      indicators: ['rsi'],
    }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))

    expect(JSON.parse(output)).toMatchObject({ action: 'indicators', code: '000300', bars: 25 })
    expect(output).not.toContain('known fund code in fund_list')
  })

  it('returns analysis evidence with governed provenance for summary', async () => {
    const store = await openStore()
    store.saveKline(Array.from({ length: 130 }, (_, index) => ({
      code: '600519',
      date: new Date(Date.UTC(2026, 6, 2 - (129 - index))).toISOString().slice(0, 10),
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100.5 + index,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))
    const tool = new DataProcessTool()

    const output = await tool.call('dp-summary', { action: 'summary', code: '600519', limit: 120 }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))
    const payload = JSON.parse(output)

    expect(payload.action).toBe('summary')
    expect(payload.interfaceId).toBe('stock.daily_kline')
    expect(payload.canonicalTable).toBe('kline_daily')
    expect(payload.analysisEvidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'stock_analysis',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        interfaceId: 'stock.daily_kline',
        canonicalSchema: 'kline_daily',
        canonicalTable: 'kline_daily',
        readbackAction: 'query_kline',
        sourceDataTime: expect.any(String),
        cacheStatus: 'cache-hit',
      },
    })
  })

  it('returns fund analysis evidence for watch signal checks', async () => {
    const store = await openStore()
    store.saveFundNav([
      { code: '001198', date: '2026-06-25', nav: 1.9, acc_nav: 1.9, daily_return: 0.3, source: 'test', fetched_at: '2026-06-25T16:00:00Z' },
    ])
    const tool = new DataProcessTool({
      watchlistItems: () => [{
        id: 'fund-watch-1',
        groupId: 'funds',
        symbol: '001198',
        name: '东方惠新灵活配置混合A',
        type: 'fund',
        status: 'watching',
        source: 'test',
        tags: [],
        addedAt: '2026-06-25T10:00:00Z',
        priceAtAdd: 0,
        targetEntryPrice: 2.0,
        conditions: [{ field: 'nav', op: '<=', value: 2.0, action: 'ui_alert', triggered: false }],
      }],
    })

    const output = await tool.call('dp-watch-signal', {
      action: 'watch_signal_check',
      type: 'fund',
      status: 'watching',
    }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))
    const payload = JSON.parse(output)

    expect(payload.action).toBe('watch_signal_check')
    expect(payload.count).toBe(1)
    expect(payload.analysisEvidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'fund_analysis',
      strategyReadiness: 'analysis_only',
      subject: {
        type: 'fund',
      },
      sourceCoverage: {
        interfaceId: 'fund.nav_history',
        canonicalSchema: 'fund_nav',
        canonicalTable: 'fund_nav',
        readbackAction: 'query_fund_nav',
        sourceDataTime: '2026-06-25',
        cacheStatus: 'local-hit',
        coverageStatus: 'sufficient_for_analysis',
      },
    })
    expect(payload.analysisEvidence.observedFacts).toContain('triggered=1')
  })

  it('returns candidate research evidence for DataProcess screen', async () => {
    const store = await openStore()
    store.saveQuoteSnapshots([
      quoteSnapshot({ code: '600519', name: '贵州茅台', price: 1500, change_pct: 1.2 }),
      quoteSnapshot({ code: '000858', name: '五粮液', price: 130, change_pct: -0.5 }),
      quoteSnapshot({ code: '300059', name: '东方财富', price: 20, change_pct: 2.3 }),
    ])
    const tool = new DataProcessTool()

    const output = await tool.call('dp-screen', {
      action: 'screen',
      code: '600519,000858,300059',
    }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))
    const payload = JSON.parse(output)

    expect(payload.action).toBe('screen')
    expect(payload.count).toBe(3)
    expect(payload.summary).toContain('Screened 3 stocks')
    expect(payload.analysisEvidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'candidate_research',
      strategyReadiness: 'candidate',
      subject: {
        type: 'candidate_set',
      },
      sourceCoverage: {
        interfaceId: 'stock.quote',
        canonicalSchema: 'quote_snapshot',
        canonicalTable: 'quote_snapshot',
        readbackAction: 'query_quote',
        cacheStatus: 'cache-hit',
        coverageStatus: 'sufficient_for_analysis',
      },
    })
  })

  it('returns stock analysis evidence for support summary', async () => {
    const store = await openStore()
    store.saveKline(Array.from({ length: 80 }, (_, index) => ({
      code: '600519',
      date: new Date(Date.UTC(2026, 6, 2 - (79 - index))).toISOString().slice(0, 10),
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))
    const tool = new DataProcessTool()

    const output = await tool.call('dp-support-summary', {
      action: 'support_summary',
      code: '600519',
      limit: 80,
    }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))
    const payload = JSON.parse(output)

    expect(payload.action).toBe('support_summary')
    expect(payload.analysisEvidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'stock_analysis',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        interfaceId: 'stock.daily_kline',
        canonicalSchema: 'kline_daily',
        canonicalTable: 'kline_daily',
        readbackAction: 'query_kline',
        sourceDataTime: expect.any(String),
        cacheStatus: 'cache-hit',
        coverageStatus: 'sufficient_for_technical',
      },
    })
  })

  it('returns stock analysis evidence for volume analysis', async () => {
    const store = await openStore()
    store.saveKline(Array.from({ length: 80 }, (_, index) => ({
      code: '600519',
      date: new Date(Date.UTC(2026, 6, 2 - (79 - index))).toISOString().slice(0, 10),
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000 + index,
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'qfq',
      source: 'fixture',
    })))
    const tool = new DataProcessTool()

    const output = await tool.call('dp-volume', {
      action: 'volume',
      code: '600519',
      limit: 80,
    }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))
    const payload = JSON.parse(output)

    expect(payload.action).toBe('volume')
    expect(payload.summary).toContain('Volume Analysis for 600519')
    expect(payload.analysisEvidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'stock_analysis',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        interfaceId: 'stock.daily_kline',
        canonicalSchema: 'kline_daily',
        canonicalTable: 'kline_daily',
        readbackAction: 'query_kline',
        sourceDataTime: expect.any(String),
        cacheStatus: 'cache-hit',
        coverageStatus: 'sufficient_for_technical',
      },
    })
  })

  it('returns DataProcess help without requiring a stock code', async () => {
    await openStore()
    const tool = new DataProcessTool()

    await expect(tool.call('dp-help', { action: 'help' }, makeCtx(cleanupPaths[cleanupPaths.length - 1]))).resolves.toContain(
      'DataProcess actions:',
    )
  })

  it('queries fund identity by code and category aliases', async () => {
    const store = await openStore()
    store.saveFundList([
      fundListRow({ code: '001198', name: '东方惠新灵活配置混合A', fund_type: '混合型' }),
      fundListRow({ code: '000009', name: '易方达天天理财货币A', fund_type: '货币型' }),
    ])

    expect(store.queryFundList({ code: '001198' })).toEqual([
      expect.objectContaining({ code: '001198', name: '东方惠新灵活配置混合A' }),
    ])
    expect(store.queryFundList({ type: 'mixed' })).toEqual([
      expect.objectContaining({ code: '001198' }),
    ])
    expect(store.queryFundList({ type: 'money' })).toEqual([
      expect.objectContaining({ code: '000009' }),
    ])
  })

  it('returns recent fund NAV rows and honors startDate/endDate aliases through the tool', async () => {
    const store = await openStore()
    store.saveFundNav([
      { code: '001198', date: '2024-01-02', nav: 1.1, acc_nav: 1.1, daily_return: 0.1, source: 'test' },
      { code: '001198', date: '2026-06-24', nav: 1.8, acc_nav: 1.8, daily_return: 0.2, source: 'test' },
      { code: '001198', date: '2026-06-25', nav: 1.9, acc_nav: 1.9, daily_return: 0.3, source: 'test' },
    ])

    expect(store.queryFundNav('001198', { limit: 1 })).toEqual([
      expect.objectContaining({ date: '2026-06-25', nav: 1.9 }),
    ])

    const { queryFundNav } = await import('../../src/agent/tools/data-store-tool-query-core-funds')
    const output = queryFundNav(store, {
      fundCode: '001198',
      startDate: '2026-06-24',
      endDate: '2026-06-25',
      limit: 2,
    })

    expect(output).toContain('2026-06-25')
    expect(output).toContain('2026-06-24')
    expect(output).not.toContain('2024-01-02')
  })
})

async function openStore(): Promise<DataStore> {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-screening-failure-'))
  cleanupPaths.push(basePath)
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
  const store = new DataStore(basePath)
  await store.init()
  return store
}

function apiCalls(store: DataStore): Array<Record<string, unknown>> {
  return store.query('SELECT source, tool, action, endpoint, status, success, error FROM api_call_log ORDER BY id ASC') as Array<Record<string, unknown>>
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
  }
}

function fundListRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    code: '000000',
    name: '测试基金',
    fund_type: '混合型',
    company: null,
    manager: null,
    setup_date: null,
    total_size: 10,
    nav: null,
    nav_date: null,
    return_1y: null,
    return_3y: null,
    return_ytd: null,
    updated_at: '2026-06-26',
    ...overrides,
  }
}

function quoteSnapshot(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    code: '000000',
    timestamp: '2026-07-02T15:00:00',
    fetched_at: new Date().toISOString(),
    source: 'fixture',
    name: '测试股票',
    price: 10,
    change_pct: 0,
    ...overrides,
  }
}
