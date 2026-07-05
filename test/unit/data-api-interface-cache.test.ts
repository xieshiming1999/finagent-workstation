import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

describe('data API interface cache reuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    closeDb()
  })

  it('reuses canonical stock identity rows before provider calls', async () => {
    const basePath = createStoreBase('stock-list-cache-')
    try {
      const store = await initStore(basePath)
      store.saveStockList(Array.from({ length: 100 }, (_, i) => {
        const code = String(600000 + i).padStart(6, '0')
        return {
          code,
          name: `stock-${i}`,
          market: 'SH',
          industry: null,
          list_date: null,
          delist_date: null,
          stock_type: 'stock',
          updated_at: '2026-06-17T00:00:00.000Z',
        }
      }))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchStockListA } = await import('../../src/agent/data/fetchers/fetcher-stock-list')
      const result = await fetchStockListA()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.data).toHaveLength(100)
      expect(result.provenance).toMatchObject({
        interfaceId: 'stock.identity_list',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses canonical fund identity rows before provider calls', async () => {
    const basePath = createStoreBase('fund-list-cache-')
    try {
      const store = await initStore(basePath)
      store.saveFundList(Array.from({ length: 20 }, (_, i) => ({
        code: String(100000 + i).padStart(6, '0'),
        name: `fund-${i}`,
        fund_type: 'mixed',
        company: null,
        manager: null,
        setup_date: null,
        total_size: 1000 - i,
        nav: 1 + i / 100,
        nav_date: '2026-06-16',
        return_1y: null,
        return_3y: null,
        return_ytd: null,
        updated_at: '2026-06-17T00:00:00.000Z',
      })))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchFundList } = await import('../../src/agent/data/fetchers/fetcher-fund-list')
      const result = await fetchFundList()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.data).toHaveLength(20)
      expect(result.provenance).toMatchObject({
        interfaceId: 'fund.identity_list',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses canonical fund performance rows before provider calls', async () => {
    const basePath = createStoreBase('fund-performance-cache-')
    try {
      const store = await initStore(basePath)
      store.saveFundPerformanceMetrics(Array.from({ length: 20 }, (_, i) => ({
        code: String(100000 + i).padStart(6, '0'),
        metric_date: '2026-06-16',
        provider: 'seed',
        capability_id: 'seed.fund.performance_metrics',
        source_action: 'fund_open_fund_rank_em',
        nav: 1 + i / 100,
        return_ytd: i,
        return_1w: null,
        return_1m: null,
        return_3m: null,
        return_6m: null,
        return_1y: i + 10,
        return_2y: null,
        return_3y: i + 30,
        return_since_inception: null,
        fetched_at: '2026-06-17T00:00:00.000Z',
        raw_json: null,
      })))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchFundPerformanceMetrics } = await import('../../src/agent/data/fetchers/fetcher-fund-list')
      const result = await fetchFundPerformanceMetrics()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.data).toHaveLength(20)
      expect(result.provenance).toMatchObject({
        interfaceId: 'fund.performance_metrics',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        canonicalSchema: 'fund_performance_metrics',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses canonical index constituent rows before provider calls', async () => {
    const basePath = createStoreBase('index-constituents-cache-')
    try {
      const store = await initStore(basePath)
      store.saveIndexConstituents(Array.from({ length: 12 }, (_, i) => ({
        index_code: '000300',
        stock_code: String(600000 + i).padStart(6, '0'),
        stock_name: `component-${i}`,
        weight: 1 + i / 10,
        as_of_date: '2026-06-17',
        provider: 'seed',
        capability_id: 'seed.index.constituents',
        source_action: 'index_stock_cons',
        fetched_at: '2026-06-17T00:00:00.000Z',
        raw_json: null,
      })))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchIndexComponents } = await import('../../src/agent/data/fetchers/fetcher-index-components')
      const result = await fetchIndexComponents('000300')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.data).toHaveLength(12)
      expect(result.provenance).toMatchObject({
        interfaceId: 'index.constituents',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        canonicalSchema: 'index_constituent',
        canonicalTable: 'index_constituent',
      })
      expect(store.queryIndexConstituents({ indexCode: '000300', limit: 20 })).toHaveLength(12)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses trade calendar only when the requested year has full date coverage', async () => {
    const basePath = createStoreBase('calendar-cache-')
    try {
      const store = await initStore(basePath)
      store.saveCalendar(calendarRowsForYear(2026))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchTradeCalendar } = await import('../../src/agent/data/fetchers/fetcher-calendar')
      const result = await fetchTradeCalendar(2026)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.data[0].date).toBe('2026-01-01')
      expect(result.data[result.data.length - 1].date).toBe('2026-12-31')
      expect(result.provenance).toMatchObject({
        interfaceId: 'calendar.trade_days',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses canonical market and fund detail rows before provider calls', async () => {
    const basePath = createStoreBase('market-detail-cache-')
    try {
      const store = await initStore(basePath)
      store.saveFundNav([{ code: '000001', date: '2026-06-16', nav: 1.23, acc_nav: 2.34, daily_return: 0.5, source: 'seed' }])
      store.saveFundHolding([{
        fund_code: '000001',
        report_date: '2026-03-31',
        stock_code: '600519',
        stock_name: '贵州茅台',
        hold_shares: 100,
        hold_value: 200,
        hold_pct: 3,
        rank: 1,
        source: 'seed',
      }])
      store.saveMoneyFlow([{
        code: '600519',
        date: '2026-06-16',
        main_net: 1,
        small_net: 2,
        medium_net: 3,
        large_net: 4,
        super_large_net: 5,
        close_price: 1288,
        change_pct: 0.6,
        source: 'seed',
      }])
      store.saveLimitPool([{
        date: '2026-06-16',
        code: '600519',
        name: '贵州茅台',
        limit_type: 'up',
        change_pct: 10,
        first_limit_time: null,
        last_limit_time: null,
        open_count: 0,
        limit_reason: null,
        continuous_days: 1,
        source: 'seed',
      }])
      store.saveNorthboundFlow([{
        trade_date: '2026-06-16',
        mutual_type: '沪股通',
        buy_amount: 10,
        sell_amount: 2,
        net_buy: 8,
        hold_market_cap: null,
        source: 'seed',
      }])
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchFundNav } = await import('../../src/agent/data/fetchers/fetcher-fund-nav')
      const { fetchFundHolding } = await import('../../src/agent/data/fetchers/fetcher-fund-holding')
      const { fetchMoneyFlow } = await import('../../src/agent/data/fetchers/fetcher-money-flow')
      const { fetchLimitUpPool } = await import('../../src/agent/data/fetchers/fetcher-limit-pool')
      const { fetchNorthbound } = await import('../../src/agent/data/fetchers/fetcher-northbound')

      const results = [
        await fetchFundNav('000001'),
        await fetchFundHolding('000001'),
        await fetchMoneyFlow('600519'),
        await fetchLimitUpPool('2026-06-16'),
        await fetchNorthbound(),
      ]

      expect(fetchMock).not.toHaveBeenCalled()
      expect(results.map((result) => result.source)).toEqual(['local', 'local', 'local', 'local', 'local'])
      expect(results.every((result) => result.provenance?.provider === 'local')).toBe(true)
      expect(results.every((result) => result.provenance?.cacheStatus === 'cache-hit')).toBe(true)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses canonical technical indicator series rows', async () => {
    const basePath = createStoreBase('technical-indicator-cache-')
    try {
      const store = await initStore(basePath)
      store.saveTechnicalIndicatorSeries([
        {
          provider: 'ta',
          capability_id: 'ta.technical.indicator_series',
          source_action: 'technical_indicator',
          symbol: '600519',
          indicator: 'rsi',
          field_name: 'RSI_14',
          params_hash: 'default',
          source_date: '2026-06-16',
          value: 61.5,
          fetched_at: '2026-06-17T00:00:00.000Z',
          params_json: '{"length":14}',
          raw_json: '{"RSI_14":61.5}',
        },
      ])

      const { readTechnicalIndicatorSeries } = await import('../../src/agent/data/data-api-interface-cache')
      const rows = readTechnicalIndicatorSeries({
        symbol: '600519',
        indicator: 'rsi',
        fieldName: 'RSI_14',
        since: '2026-06-01',
      })

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        provider: 'ta',
        capability_id: 'ta.technical.indicator_series',
        symbol: '600519',
        indicator: 'rsi',
        field_name: 'RSI_14',
        source_date: '2026-06-16',
        value: 61.5,
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})

function createStoreBase(prefix: string): string {
  const basePath = mkdtempSync(join(tmpdir(), prefix))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
  return basePath
}

async function initStore(basePath: string): Promise<DataStore> {
  const store = new DataStore(basePath)
  await store.init()
  return store
}

function calendarRowsForYear(year: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    rows.push({
      date,
      market: 'CN',
      is_trading_day: day.getUTCDay() === 0 || day.getUTCDay() === 6 ? 0 : 1,
      year,
      month: day.getUTCMonth() + 1,
    })
  }
  return rows
}
