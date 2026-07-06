import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

vi.mock('../../src/agent/data/queue/rate-limiter', () => ({
  rateLimitedFetch: vi.fn(async (_source: string, fn: () => unknown) => fn()),
}))

vi.mock('../../src/agent/data/fetchers/fetcher-fund-list', () => ({
  fetchFundList: vi.fn(async () => ({
    data: [{
      code: '110011',
      name: '易方达中小盘',
      fund_type: null,
      company: null,
      manager: null,
      setup_date: null,
      total_size: null,
      nav: null,
      nav_date: null,
      return_1y: null,
      return_3y: null,
      return_ytd: null,
      updated_at: '2026-06-15T00:00:00.000Z',
    }],
    source: 'akshare',
    fetchedAt: '2026-06-15T00:00:00.000Z',
  })),
}))

vi.mock('../../src/agent/data/fetchers/fetcher-fund-nav', () => ({
  fetchFundNav: vi.fn(async (code: string) => ({
    data: [{ code, date: '2026-06-15', nav: 1.23, acc_nav: null, daily_return: null, source: 'akshare' }],
    source: 'akshare',
    fetchedAt: '2026-06-15T00:00:00.000Z',
  })),
}))

vi.mock('../../src/agent/data/fetchers/fetcher-etf', () => ({
  fetchEtfQuotes: vi.fn(async (_limit: number, source: string) => ({
    stocks: [{
      code: source === 'sina' ? '159998' : '510300',
      name: source === 'sina' ? '计算机ETF天弘' : source === 'tencent' ? '沪深300ETF腾讯' : '沪深300ETF',
      market: 'ETF',
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'etf',
      updated_at: '2026-06-22T00:00:00.000Z',
    }],
    quotes: [{
      code: source === 'sina' ? '159998' : '510300',
      timestamp: '2026-06-22T00:00:00.000Z',
      fetched_at: '2026-06-22T00:00:00.000Z',
      source: `${source}:etf`,
      name: source === 'sina' ? '计算机ETF天弘' : source === 'tencent' ? '沪深300ETF腾讯' : '沪深300ETF',
      price: source === 'sina' ? 1.045 : source === 'tencent' ? 4.21 : 4.2,
      change: null,
      change_pct: source === 'sina' ? 3.363 : 0.72,
      volume: 100000,
      amount: null,
    }],
  })),
  fetchTencentListedFundQuotes: vi.fn(async () => ({
    stocks: [{
      code: '511880',
      name: '银华日利ETF',
      market: 'LISTED_FUND',
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'listed_fund',
      updated_at: '2026-06-22T00:00:00.000Z',
    }],
    quotes: [{
      code: '511880',
      timestamp: '2026-06-22T00:00:00.000Z',
      fetched_at: '2026-06-22T00:00:00.000Z',
      source: 'tencent:listed_fund',
      name: '银华日利ETF',
      price: 100.554,
      change: null,
      change_pct: 0.01,
      volume: 1396193,
      amount: 14038113563,
    }],
  })),
}))

describe('FundMarketDataFetchService', () => {
  afterEach(() => {
    closeDb()
    vi.clearAllMocks()
  })

  it('passes eastmoney fund identity priority into the data API interface fetcher', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchFundList } = await import('../../src/agent/data/fetchers/fetcher-fund-list')

    const result = await new FundMarketDataFetchService().readFundList(['eastmoneyDirect'])

    expect(fetchFundList).toHaveBeenCalledWith({ providers: ['eastmoneyDirect'] })
    expect(result.source).toBe('akshare')
    expect(result.data[0]).toMatchObject({ code: '110011', name: '易方达中小盘' })
  })

  it('passes eastmoney fund NAV priority into the data API interface fetcher', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchFundNav } = await import('../../src/agent/data/fetchers/fetcher-fund-nav')

    const result = await new FundMarketDataFetchService().readFundNav('110011', undefined, ['eastmoneyDirect'])

    expect(fetchFundNav).toHaveBeenCalledWith('110011', undefined, { providers: ['eastmoneyDirect'] })
    expect(result.source).toBe('akshare')
    expect(result.data[0]).toMatchObject({ code: '110011', nav: 1.23 })
  })

  it('reuses cached ETF identities and quotes before provider calls', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'etf-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveStockList([{
        code: '510300',
        name: '沪深300ETF',
        market: 'ETF',
        industry: null,
        list_date: null,
        delist_date: null,
        stock_type: 'etf',
        updated_at: new Date().toISOString(),
      }])
      store.saveQuoteSnapshots([{
        code: '510300',
        timestamp: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        source: 'eastmoney:etf',
        name: '沪深300ETF',
        price: 4.2,
        change: null,
        change_pct: 0.72,
        volume: 100000,
        amount: null,
      }])

      const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
      const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')

      const result = await new FundMarketDataFetchService().readEtfQuotes(20)

      expect(fetchEtfQuotes).not.toHaveBeenCalled()
      expect(result.stocks).toEqual([expect.objectContaining({ code: '510300', stock_type: 'etf' })])
      expect(result.quotes).toEqual([expect.objectContaining({ code: '510300', price: 4.2 })])
      expect(result.provenance).toMatchObject({
        interfaceId: 'fund.etf_quote',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        cacheMode: 'cache-first',
        cacheDecision: expect.stringContaining('cache reader returned reusable canonical rows'),
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('routes ETF quote provider preference to the matching provider capability', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')

    await new FundMarketDataFetchService().readEtfQuotes(10, ['akshare'])

    expect(fetchEtfQuotes).toHaveBeenCalledWith(10, 'akshare')
  })

  it('routes strict Sina ETF quote requests through the Sina capability', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')

    const result = await new FundMarketDataFetchService().readEtfQuotes(10, [], {
      provider: 'sina',
      cacheMode: 'live-only',
    })

    expect(fetchEtfQuotes).toHaveBeenCalledWith(10, 'sina')
    expect(result.quotes[0]).toMatchObject({ code: '159998', source: 'sina:etf' })
    expect(result.provenance).toMatchObject({
      interfaceId: 'fund.etf_quote',
      capabilityId: 'sina.fund.etf_quote',
      provider: 'sina',
      cacheStatus: 'provider-hit',
    })
  })

  it('routes strict Tencent ETF quote requests through the Tencent capability', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')

    const result = await new FundMarketDataFetchService().readEtfQuotes(10, [], {
      provider: 'tencent',
      cacheMode: 'live-only',
    })

    expect(fetchEtfQuotes).toHaveBeenCalledWith(10, 'tencent')
    expect(result.quotes[0]).toMatchObject({ code: '510300', source: 'tencent:etf', price: 4.21 })
    expect(result.provenance).toMatchObject({
      interfaceId: 'fund.etf_quote',
      capabilityId: 'tencent.fund.etf_quote',
      provider: 'tencent',
      cacheStatus: 'provider-hit',
    })
  })

  it('routes strict Tencent listed-fund quote requests through the listed-fund interface', async () => {
    const { FundMarketDataFetchService } = await import('../../src/domain/market/services/fund-market-data-fetch-service')
    const { fetchTencentListedFundQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')

    const result = await new FundMarketDataFetchService().readListedFundQuotes(10, [], {
      provider: 'tencent',
      cacheMode: 'live-only',
    })

    expect(fetchTencentListedFundQuotes).toHaveBeenCalledWith(10)
    expect(result.quotes[0]).toMatchObject({ code: '511880', source: 'tencent:listed_fund', price: 100.554 })
    expect(result.stocks[0]).toMatchObject({ code: '511880', stock_type: 'listed_fund' })
    expect(result.provenance).toMatchObject({
      interfaceId: 'fund.listed_fund_quote',
      capabilityId: 'tencent.fund.listed_fund_quote',
      provider: 'tencent',
      cacheStatus: 'provider-hit',
    })
  })
})
