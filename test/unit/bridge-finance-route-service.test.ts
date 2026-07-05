import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb } from '../../src/agent/data/store/db'

describe('bridge-finance-route-service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    closeDb()
  })

  it('routes quote requests through the read service boundary', async () => {
    const readQuotes = vi.fn(async () => ({
      quotes: [{ code: '600519', name: 'Moutai', price: 1500 }],
      cachedCount: 1,
      freshCount: 0,
      freshSources: [],
      provenance: [{
        interfaceId: 'stock.quote',
        capabilityId: 'local.cache',
        provider: 'local',
        canonicalSchema: 'quote_snapshot',
        cacheStatus: 'cache-hit',
      }],
    }))

    vi.doMock('../../src/domain/market/services/market-data-resolve-service', () => ({
      MarketDataResolveService: class {
        readQuotes = readQuotes
        readKline = vi.fn()
      },
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/quote',
      { code: '600519' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(readQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: '/tmp/finagent-workstation-test' }),
      ['600519'],
    )
    expect(result).toMatchObject({
      data: [{ code: '600519', name: 'Moutai', price: 1500 }],
      cachedCount: 1,
      freshCount: 0,
      provenance: [expect.objectContaining({ interfaceId: 'stock.quote', provider: 'local' })],
    })
  })

  it('routes technical dashboard requests through local K-line indicators', async () => {
    const bars = Array.from({ length: 80 }, (_, index) => ({
      date: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000 + index,
      amount: 100000 + index,
      changePct: 0.1,
    }))
    const readKline = vi.fn(async () => ({
      bars,
      source: 'local',
      period: 'daily',
      adjust: 'qfq',
      provenance: [{ interfaceId: 'stock.daily_kline', provider: 'local' }],
    }))

    vi.doMock('../../src/domain/market/services/market-data-resolve-service', () => ({
      MarketDataResolveService: class {
        readQuotes = vi.fn()
        readKline = readKline
      },
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/technical',
      { code: '600519', limit: 80 },
      { basePath: '/tmp/finagent-workstation-test' },
    ) as { data: Record<string, unknown>; source: string; asOf: string }

    expect(readKline).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: '/tmp/finagent-workstation-test' }),
      '600519',
      expect.objectContaining({ period: 'daily', adjust: 'qfq', limit: 80 }),
    )
    expect(result.source).toBe('local')
    expect(result.asOf).toBe('2026-03-24')
    expect(result.data).toMatchObject({
      asOf: '2026-03-24',
      close: 180,
      macd: expect.any(Object),
      boll: expect.any(Object),
      kdj: expect.any(Object),
    })
  })

  it('fills missing quote names through stock identity cache instead of a direct provider URL', async () => {
    const readQuotes = vi.fn(async () => ({
      quotes: [{ code: '600519', name: '600519', price: 1500 }],
      cachedCount: 1,
      freshCount: 0,
      freshSources: [],
      provenance: [{
        interfaceId: 'stock.quote',
        capabilityId: 'local.cache',
        provider: 'local',
        canonicalSchema: 'quote_snapshot',
        cacheStatus: 'cache-hit',
      }],
    }))
    const store = { isReady: true }
    const getLocalStore = vi.fn(() => store)
    const resolveStockNames = vi.fn(async () => new Map([['600519', '贵州茅台']]))
    const fetchSpy = vi.fn()

    vi.stubGlobal('fetch', fetchSpy)
    vi.doMock('../../src/domain/market/services/market-data-resolve-service', () => ({
      MarketDataResolveService: class {
        readQuotes = readQuotes
        readKline = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore,
    }))
    vi.doMock('../../src/agent/data/symbol-name-cache', () => ({
      resolveStockNames,
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/quote',
      { code: '600519' },
      { basePath: '/tmp/finagent-workstation-test' },
    ) as { data: Array<{ code: string; name: string }> }

    expect(resolveStockNames).toHaveBeenCalledWith(['600519'], store)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.data[0]).toMatchObject({ code: '600519', name: '贵州茅台' })
  })

  it('routes yahoo price requests through the yahoo service boundary', async () => {
    const fetchQuote = vi.fn(async () => ({ symbol: 'AAPL', price: 213.4 }))

    vi.doMock('../../src/domain/market/services/yahoo-market-data-service', () => ({
      YahooMarketDataService: class {
        fetchQuote = fetchQuote
      },
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/yahoo/price',
      { symbol: 'AAPL' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(fetchQuote).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: '/tmp/finagent-workstation-test' }),
      'AAPL',
    )
    expect(result).toMatchObject({ data: { symbol: 'AAPL', price: 213.4 } })
  })

  it('routes fund NAV bridge requests through the fund data API service', async () => {
    const readFundNav = vi.fn(async () => ({
      data: [{ code: '000001', date: '2026-06-16', nav: 1.234, acc_nav: 1.5, daily_return: 0.2, source: 'eastmoney' }],
      source: 'eastmoney',
      fetchedAt: '2026-06-17T00:00:00.000Z',
      provenance: {
        interfaceId: 'fund.nav_history',
        capabilityId: 'eastmoney.fund.nav_history',
        provider: 'eastmoney',
        canonicalSchema: 'fund_nav',
        canonicalTable: 'fund_nav',
        cacheStatus: 'provider-hit',
      },
    }))
    const saveFundNav = vi.fn()
    const callSidecarRoute = vi.fn()

    vi.doMock('../../src/domain/market/services/fund-market-data-fetch-service', () => ({
      FundMarketDataFetchService: class {
        readFundNav = readFundNav
      },
    }))
    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        saveFundNav,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/fund/nav',
      { code: '000001', start: '2026-01-01', provider: 'eastmoneyDirect' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(callSidecarRoute).not.toHaveBeenCalled()
    expect(readFundNav).toHaveBeenCalledWith('000001', '2026-01-01', ['eastmoneyDirect'])
    expect(saveFundNav).toHaveBeenCalledWith([
      expect.objectContaining({ code: '000001', date: '2026-06-16', nav: 1.234 }),
    ])
    expect(result).toMatchObject({
      data: [expect.objectContaining({ code: '000001', nav: 1.234 })],
      provenance: {
        interfaceId: 'fund.nav_history',
        capabilityId: 'eastmoney.fund.nav_history',
        provider: 'eastmoney',
      },
    })
  })

  it('routes sidecar news through the data API requirement boundary', async () => {
    const callSidecarRoute = vi.fn(async () => ({
      data: [{ title: 'headline', summary: 'summary', published_at: new Date().toISOString() }],
    }))
    const savedNews: Array<Record<string, unknown>> = []
    const saveFinanceNews = vi.fn((rows: Array<Record<string, unknown>>) => {
      savedNews.splice(0, savedNews.length, ...rows)
    })
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        queryFinanceNews: vi.fn(() => savedNews),
        saveFinanceNews,
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/sidecar/news',
      { query: 'headline' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(callSidecarRoute).toHaveBeenCalledWith('/news', { query: 'headline', keyword: 'headline' })
    expect(saveFinanceNews).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'headline', summary: 'summary', source: 'akshare' }),
    ])
    expect(saveApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'akshare',
        interface_id: 'news.finance_feed',
        capability_id: 'akshare.news.finance_feed',
        success: true,
      }),
    )
    expect(result).toMatchObject({
      data: [expect.objectContaining({ title: 'headline', summary: 'summary' })],
      cacheStatus: 'provider-hit',
      provenance: {
        interfaceId: 'news.finance_feed',
        capabilityId: 'akshare.news.finance_feed',
        provider: 'akshare',
      },
    })
  })

  it('routes direct Sina news through the finance news interface', async () => {
    const savedNews: Array<Record<string, unknown>> = []
    const saveFinanceNews = vi.fn((rows: Array<Record<string, unknown>>) => {
      savedNews.splice(0, savedNews.length, ...rows)
    })
    const saveApiCall = vi.fn()

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      expect(url).toContain('feed.mix.sina.com.cn/api/roll/get')
      return jsonResponse({
        result: {
          data: [{
            title: '新浪财经 headline',
            summary: 'summary',
            url: 'https://finance.sina.com.cn/news',
            media_name: '新浪财经',
            ctime: Math.floor(Date.now() / 1000),
          }],
        },
      })
    }))
    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = vi.fn()
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        queryFinanceNews: vi.fn(() => savedNews),
        saveFinanceNews,
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/sidecar/news',
      { query: 'headline', provider: 'sina', providerMode: 'strict', cacheMode: 'live-only' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(saveFinanceNews).toHaveBeenCalledWith([
      expect.objectContaining({ title: '新浪财经 headline', source: '新浪财经', publisher: '新浪财经' }),
    ])
    expect(saveApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'sina',
        interface_id: 'news.finance_feed',
        capability_id: 'sina.news.finance_feed',
        endpoint: 'feed.mix.sina.com.cn/api/roll/get',
        success: true,
      }),
    )
    expect(result).toMatchObject({
      data: [expect.objectContaining({ title: '新浪财经 headline' })],
      cacheStatus: 'provider-hit',
      provenance: {
        interfaceId: 'news.finance_feed',
        capabilityId: 'sina.news.finance_feed',
        provider: 'sina',
      },
    })
  })

  it('adds provenance metadata to index quote bridge responses', async () => {
    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn(async () => ({
          source: 'sina',
          data: [{ code: '000001', name: '上证', price: 4031.5, changePct: 1.12 }],
        }))
        callSidecarRoute = vi.fn()
        callGotdxRoute = vi.fn()
      },
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/index/quotes',
      { code: '000001' },
      { basePath: '/tmp/finagent-workstation-test' },
    ) as any

    expect(result.source).toBe('sina')
    expect(result.cacheStatus).toBe('provider-hit')
    expect(result.fetchedAt).toEqual(expect.any(String))
    expect(result.data[0]).toMatchObject({
      code: '000001',
      source: 'sina',
      cacheStatus: 'provider-hit',
      fetchedAt: expect.any(String),
    })
  })

  it('records known diagnostic sidecar successes with provider surface provenance', async () => {
    const callSidecarRoute = vi.fn(async () => ({ data: [{ code: '000001', name: '上证' }] }))
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/index/list',
      {},
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(result).toMatchObject({ data: [{ code: '000001', name: '上证' }] })
    expect(callSidecarRoute).toHaveBeenCalledWith('/index/list', {})
    expect(saveApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'akshare',
        provider: 'akshare',
        interface_id: 'provider.akshare.index_list',
        capability_id: 'provider.akshare.index_list',
        action: 'index/list',
        endpoint: '/index/list',
        status: 200,
        success: true,
      }),
    )
  })

  it('records known diagnostic sidecar failures with provider surface provenance', async () => {
    const callSidecarRoute = vi.fn(async () => ({ error: 'margin unavailable' }))
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/margin',
      {},
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(result).toMatchObject({ error: 'margin unavailable' })
    expect(saveApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'akshare',
        provider: 'akshare',
        interface_id: 'market.margin_trading',
        capability_id: 'akshare.market.margin_trading',
        action: 'margin',
        endpoint: '/margin',
        status: 0,
        success: false,
        error: 'margin unavailable',
        tool: 'BridgeIPC',
      }),
    )
  })

  it('blocks unclassified sidecar bridge routes before provider calls', async () => {
    const callSidecarRoute = vi.fn(async () => ({ data: [{ value: 1 }] }))
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/sidecar/unclassified',
      {},
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(callSidecarRoute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      error: expect.stringContaining('Unclassified sidecar finance route "sidecar/unclassified"'),
    })
    expect(saveApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'sidecar',
        provider: 'sidecar',
        interface_id: 'provider.sidecar.unclassified',
        capability_id: 'provider.sidecar.unclassified',
        action: 'sidecar/unclassified',
        endpoint: '/unclassified',
        status: 0,
        success: false,
        error: expect.stringContaining('Unclassified sidecar finance route'),
        tool: 'BridgeIPC',
      }),
    )
  })

  it('preserves news enrichment parameters for sidecar news requests', async () => {
    const callSidecarRoute = vi.fn(async () => ({
      data: [{ title: 'headline', summary: 'summary', published_at: new Date().toISOString() }],
    }))
    const savedNews: Array<Record<string, unknown>> = []
    const saveFinanceNews = vi.fn((rows: Array<Record<string, unknown>>) => {
      savedNews.splice(0, savedNews.length, ...rows)
    })
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        queryFinanceNews: vi.fn(() => savedNews),
        saveFinanceNews,
        saveApiCall,
      })),
    }))

    const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
    const result = await routeFinanceRequest(
      '/api/finance/sidecar/news',
      { query: 'headline', enrich: 'true', max_enrich: '8' },
      { basePath: '/tmp/finagent-workstation-test' },
    )

    expect(callSidecarRoute).toHaveBeenCalledWith('/news', { query: 'headline', keyword: 'headline', enrich: 'true', max_enrich: '8' })
    expect(result).toMatchObject({ data: [{ title: 'headline', summary: 'summary' }] })
  })

  it('records sidecar news failures in API health with interface provenance', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-news-sidecar-'))
    const callSidecarRoute = vi.fn(async () => ({ error: 'sidecar news unavailable' }))
    const saveApiCall = vi.fn()

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', () => ({
      getLocalStore: vi.fn(() => ({
        isReady: true,
        init: vi.fn(),
        queryFinanceNews: vi.fn(() => []),
        saveApiCall,
      })),
    }))

    try {
      const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
      const result = await routeFinanceRequest(
        '/api/finance/sidecar/news',
        { query: 'headline', enrich: 'true' },
        { basePath },
      )

      expect(result).toMatchObject({
        error: expect.stringContaining('news feed interface providers failed'),
      })
      expect(saveApiCall).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'akshare',
          provider: 'akshare',
          interface_id: 'news.finance_feed',
          capability_id: 'akshare.news.finance_feed',
          tool: 'BridgeIPC',
          action: 'sidecar/news',
          endpoint: '/news',
          success: false,
          error: 'sidecar news unavailable',
        }),
      )
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('reuses fresh finance news cache before sidecar calls', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-news-cache-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    const callSidecarRoute = vi.fn(async () => {
      throw new Error('sidecar should not be called')
    })

    vi.doMock('../../src/domain/market/providers/bridge-finance-provider', () => ({
      DefaultBridgeFinanceProvider: class {
        readIndexQuotes = vi.fn()
        callSidecarRoute = callSidecarRoute
        callGotdxRoute = vi.fn()
      },
    }))
    vi.doMock('../../src/agent/tools/market-data-utils', async () => {
      const { DataStore } = await import('../../src/agent/data/store/data-store')
      let store: InstanceType<typeof DataStore> | null = null
      return {
        getLocalStore: vi.fn(() => {
          if (!store) store = new DataStore(basePath)
          return store
        }),
      }
    })

    try {
      const { DataStore } = await import('../../src/agent/data/store/data-store')
      const store = new DataStore(basePath)
      await store.init()
      store.saveFinanceNews([{
        news_id: 'cached-news-1',
        title: 'cached headline',
        summary: 'cached summary',
        publisher: 'cache',
        published_at: new Date().toISOString(),
        url: 'https://example.com/news',
        source: 'akshare',
      }])

      const { routeFinanceRequest } = await import('../../src/domain/market/services/bridge-finance-route-service')
      const result = await routeFinanceRequest(
        '/api/finance/sidecar/news',
        { query: 'cached' },
        { basePath },
      )

      expect(callSidecarRoute).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        data: [expect.objectContaining({ title: 'cached headline', summary: 'cached summary' })],
        cacheStatus: 'cache-hit',
        provenance: {
          interfaceId: 'news.finance_feed',
          capabilityId: 'local.cache',
          provider: 'akshare',
        },
      })

      const { DataStoreTool } = await import('../../src/agent/tools/data-store-tool')
      const tool = new DataStoreTool()
      tool.setDataStore(store)
      await expect(tool.call('news-readback', {
        action: 'query_finance_news',
        query: 'cached',
      }, { basePath, serviceBaseUrl: '' })).resolves.toContain('cached headline')
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}
