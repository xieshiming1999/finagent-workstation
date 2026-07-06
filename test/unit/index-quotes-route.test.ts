import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { globalApiStats } from '../../src/agent/data/resilience'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

const sidecarFetch = vi.fn()
const gotdxFetch = vi.fn()
const waitForSidecarReady = vi.fn()
const getQuote = vi.fn()
const getQuoteBatch = vi.fn()
const tushareCall = vi.fn()
const fetchPreferredQuote = vi.fn()

function sinaResponse(text: string): { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

vi.mock('../../src/main/sidecar', () => ({
  sidecarFetch,
  gotdxFetch,
  waitForSidecarReady,
}))

vi.mock('../../src/agent/data/data-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agent/data/data-manager')>()
  return {
    ...actual,
    getQuote,
    getQuoteBatch,
  }
})

vi.mock('../../src/agent/data/tushare-fetcher', () => ({
  tushareCall,
}))

vi.mock('../../src/agent/data/fetchers/fetcher-quote', () => ({
  fetchQuote: fetchPreferredQuote,
}))

describe('index quote route', () => {
  afterEach(() => {
    closeDb()
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
    sidecarFetch.mockReset()
    gotdxFetch.mockReset()
    waitForSidecarReady.mockReset()
    getQuote.mockReset()
    getQuoteBatch.mockReset()
    tushareCall.mockReset()
    fetchPreferredQuote.mockReset()
    waitForSidecarReady.mockResolvedValue(true)
    fetchPreferredQuote.mockResolvedValue({
      data: [{ code: '600519', price: 1268, name: '贵州茅台' }],
      source: 'tdx',
    })
  })

  it('reuses fresh index quote_snapshot rows before provider calls', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'index-quote-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveQuoteSnapshots([
        {
          code: '000001',
          timestamp: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
          source: 'tdx:index_quote',
          name: '上证指数',
          price: 4031.51,
          change: 44.6,
          change_pct: 1.12,
          volume: 100,
          amount: 200,
        },
        {
          code: '399001',
          timestamp: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
          source: 'tdx:index_quote',
          name: '深证成指',
          price: 15266.63,
          change: 303.22,
          change_pct: 2.03,
          volume: 300,
          amount: 400,
        },
      ])
      gotdxFetch.mockResolvedValue({ error: 'provider should not be called' })
      sidecarFetch.mockResolvedValue({ error: 'provider should not be called' })
      const fetchMock = vi.fn(async () => sinaResponse(''))
      vi.stubGlobal('fetch', fetchMock)
      const { routeRequest } = await import('../../src/main/bridge-router')

      const result = await routeRequest('/api/finance/index/quotes', { code: '000001,399001' }, 'GET') as any

      expect(result.source).toBe('local')
      expect(result.cacheStatus).toBe('cache-hit')
      expect(result.provenance).toMatchObject({
        interfaceId: 'index.quote',
        capabilityId: 'local.cache',
        provider: 'local',
      })
      expect(result.data.map((row: any) => row.code)).toEqual(['000001', '399001'])
      expect(result.data.every((row: any) => row.cacheStatus === 'cache-hit')).toBe(true)
      expect(gotdxFetch).not.toHaveBeenCalled()
      expect(sidecarFetch).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('accepts query strings in Bridge finance paths for WebView compatibility', async () => {
    const { configureBridgeRouter, routeRequest } = await import('../../src/main/bridge-router')
    configureBridgeRouter({ basePath: '/tmp', getConfigValue: () => 'test-token' })

    const result = await routeRequest('/api/finance/quote?code=600519', {}, 'GET') as any

    expect(fetchPreferredQuote).toHaveBeenCalledWith('600519')
    expect(result.data).toEqual([{ code: '600519', price: 1268, name: '贵州茅台' }])
  })

  it('uses TDX lightweight index quotes before trying network fallbacks', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'index-quote-provider-hit-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      gotdxFetch
        .mockResolvedValueOnce({
          Code: '000001',
          Name: '上证指数',
          Price: 3600,
          LastClose: 3560,
          Open: 3570,
          High: 3610,
          Low: 3550,
        })
        .mockResolvedValueOnce({
          Code: '399001',
          Name: '深证成指',
          Price: 15704.71,
          LastClose: 15591.13,
          Open: 15600,
          High: 15800,
          Low: 15500,
        })
        .mockResolvedValueOnce({
          Code: '399006',
          Name: '创业板指',
          Price: 4122.99,
          LastClose: 4055.87,
          Open: 4060,
          High: 4130,
          Low: 4050,
        })
      sidecarFetch.mockResolvedValue({ error: 'ProxyError' })
      vi.stubGlobal('fetch', vi.fn(async () => sinaResponse([
          'var hq_str_s_sh000001="上证指数,3600,40,1.12,7431310,153740152";',
          'var hq_str_s_sz399001="深证成指,15704.71,113.58,0.73,792336422,167754822";',
          'var hq_str_s_sz399006="创业板指,4122.99,67.12,1.65,43564051,34726190";',
        ].join('\n'))))
      const { configureBridgeRouter, routeRequest } = await import('../../src/main/bridge-router')
      configureBridgeRouter({ basePath })

      const result = await routeRequest('/api/finance/index/quotes', { code: '000001,399001,399006' }, 'GET') as any

      expect(result.data).toHaveLength(3)
      expect(result.data.map((q: any) => q.price)).toEqual([3600, 15704.71, 4122.99])
      expect(result.data[1].changePct).toBeCloseTo(0.7285, 3)
      expect(result.source).toBe('tdx')
      expect(gotdxFetch).toHaveBeenCalledTimes(3)
      expect(sidecarFetch).not.toHaveBeenCalled()
      expect(waitForSidecarReady).not.toHaveBeenCalled()

      expect(store.queryQuoteSnapshots('000001', 1)[0]).toMatchObject({
        code: '000001',
        source: 'tdx:index_quote',
        price: 3600,
        change_pct: expect.closeTo(1.1235, 3),
      })

      gotdxFetch.mockReset()
      const cached = await routeRequest('/api/finance/index/quotes', { code: '000001,399001,399006' }, 'GET') as any
      expect(cached.source).toBe('local')
      expect(cached.cacheStatus).toBe('cache-hit')
      expect(cached.data.map((q: any) => q.code)).toEqual(['000001', '399001', '399006'])
      expect(gotdxFetch).not.toHaveBeenCalled()
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('falls back to Sina when TDX is unavailable before Python sidecar is ready', async () => {
    gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
    waitForSidecarReady.mockResolvedValue(false)
    sidecarFetch.mockResolvedValue({ error: 'Python sidecar not running. Setup: cd sidecar && uv sync && uv run server.py' })
    vi.stubGlobal('fetch', vi.fn(async () => sinaResponse('var hq_str_s_sh000001="上证指数,4083.97,8.97,0.22,7431310,153740152";')))
    const { routeRequest } = await import('../../src/main/bridge-router')

    const result = await routeRequest('/api/finance/index/quotes', { code: '000001' }, 'GET') as any

    expect(result.source).toBe('sina')
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('上证')
    expect(result.warning).toBeUndefined()
    expect(gotdxFetch).toHaveBeenCalledWith('/quote', { code: '000001', market: '1' })
    expect(sidecarFetch).not.toHaveBeenCalled()
    expect(waitForSidecarReady).not.toHaveBeenCalled()
  })

  it('falls back to AkShare only when TDX and Sina have no plausible index quote', async () => {
    gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
    vi.stubGlobal('fetch', vi.fn(async () => sinaResponse('var hq_str_s_sh000001="上证指数,0,0,0,0,0";')))
    sidecarFetch.mockResolvedValue({ data: [{ code: '000001', name: '上证', price: 4083.97, changePct: 0.22 }] })
    const { routeRequest } = await import('../../src/main/bridge-router')

    const result = await routeRequest('/api/finance/index/quotes', { code: '000001' }, 'GET') as any

    expect(result.source).toBe('akshare')
    expect(result.data).toHaveLength(1)
    expect(waitForSidecarReady).toHaveBeenCalledWith(3000)
    expect(sidecarFetch).toHaveBeenCalledWith('/index/quotes', { code: '000001' }, 0)
  })

  it('falls back to direct Tencent index quotes before sidecar routes', async () => {
    gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sinaResponse('var hq_str_s_sh000001="上证指数,0,0,0,0,0";'))
      .mockResolvedValueOnce(sinaResponse('v_sh000001="51~上证指数~000001~4083.97~4075.00~4070.00~0~0~0~4083.97~0~0~0~0~0~0~0~0~0~4083.97~0~0~0~0~0~0~0~0~0~7431310~2026/06/23 15:00:00~8.97~0.22~4090.00~4060.00~4083.97~7431310~153740152~0~0~~0~0~0~0~0";'))
    vi.stubGlobal('fetch', fetchMock)
    sidecarFetch.mockResolvedValue({ error: 'sidecar should not be called' })
    const { routeRequest } = await import('../../src/main/bridge-router')

    const result = await routeRequest('/api/finance/index/quotes', { code: '000001' }, 'GET') as any

    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'index.quote',
      capabilityId: 'tencent.index.quote',
      provider: 'tencent',
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
    })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      code: '000001',
      price: 4083.97,
      source: 'tencent:index_quote',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sidecarFetch).not.toHaveBeenCalled()
    expect(waitForSidecarReady).not.toHaveBeenCalled()
  })

  it('falls back to direct EastMoney index quotes with canonical persistence', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'index-quote-eastmoney-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
      vi.stubGlobal('fetch', vi.fn(async () => sinaResponse('var hq_str_s_sh000001="上证指数,0,0,0,0,0";')))
      sidecarFetch
        .mockResolvedValueOnce({ error: 'AkShare wrapper empty' })
        .mockResolvedValueOnce({
          data: [
            { 代码: '000001', 名称: '上证指数', 最新价: 4083.97, 涨跌幅: 0.22, 涨跌额: 8.97, 成交量: 7431310, 成交额: 153740152 },
            { 代码: '399001', 名称: '深证成指', 最新价: 14963.41, 涨跌幅: 0.75, 涨跌额: 111.43, 成交量: 792336422, 成交额: 167754822 },
          ],
          provider: 'eastmoney',
        })
      const { configureBridgeRouter, routeRequest } = await import('../../src/main/bridge-router')
      configureBridgeRouter({ basePath })

      const result = await routeRequest('/api/finance/index/quotes', { code: '000001,399001' }, 'GET') as any

      expect(result.source).toBe('eastmoney')
      expect(result.provenance).toMatchObject({
        interfaceId: 'index.quote',
        capabilityId: 'eastmoney.index.quote',
        provider: 'eastmoney',
        canonicalSchema: 'quote_snapshot',
        canonicalTable: 'quote_snapshot',
        cacheStatus: 'provider-hit',
      })
      expect(result.data.map((q: any) => q.code)).toEqual(['000001', '399001'])
      expect(sidecarFetch).toHaveBeenNthCalledWith(1, '/index/quotes', { code: '000001,399001' }, 0)
      expect(sidecarFetch).toHaveBeenNthCalledWith(2, '/akshare/stock_zh_index_spot_em', {
        symbol: 'all',
        _provider: 'eastmoney',
        _priority: 'interactive',
      }, 0)
      expect(store.queryQuoteSnapshots('000001', 1)[0]).toMatchObject({
        code: '000001',
        source: 'eastmoney:index_quote',
        price: 4083.97,
        change_pct: 0.22,
      })

      gotdxFetch.mockReset()
      sidecarFetch.mockReset()
      const cached = await routeRequest('/api/finance/index/quotes', { code: '000001,399001' }, 'GET') as any
      expect(cached.source).toBe('local')
      expect(cached.cacheStatus).toBe('cache-hit')
      expect(gotdxFetch).not.toHaveBeenCalled()
      expect(sidecarFetch).not.toHaveBeenCalled()
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('does not derive status bar quotes from corrupted Sina rows', async () => {
    gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
    sidecarFetch.mockResolvedValue({ error: 'ProxyError' })
    vi.stubGlobal('fetch', vi.fn(async () => sinaResponse('var hq_str_s_sz399001="深证成指,1,0,0,0,0";')))
    const { routeRequest } = await import('../../src/main/bridge-router')

    const result = await routeRequest('/api/finance/index/quotes', { code: '399001' }, 'GET') as any

    expect(result.data).toEqual([])
    expect(result.error).toBe('Market index data sources unavailable')
  })

  it('records which index-quote branches failed when no source returns usable data', async () => {
    const baseline = globalApiStats.getRecent(60).length
    gotdxFetch.mockResolvedValue({ error: 'gotdx sidecar not running' })
    sidecarFetch.mockResolvedValue({ error: 'ProxyError: upstream reset' })
    vi.stubGlobal('fetch', vi.fn(async () => sinaResponse('')))
    const { routeRequest } = await import('../../src/main/bridge-router')

    await routeRequest('/api/finance/index/quotes', { code: '000001' }, 'GET')

    const records = globalApiStats.getRecent(60).slice(baseline)
    const last = records[records.length - 1]
    expect(last.source).toBe('index-quotes')
    expect(last.success).toBe(false)
    expect(last.error).toContain('tdx:000001: gotdx sidecar not running')
    expect(last.error).toContain('sina:000001: missing')
    expect(last.error).toContain('akshare: EastMoney/AkShare request failed through the configured network proxy')
  })

  it('routes Bridge Tushare requests through the configured token', async () => {
    tushareCall.mockResolvedValue([{ cal_date: '20260605', is_open: 1 }])
    const { configureBridgeRouter, routeRequest } = await import('../../src/main/bridge-router')
    configureBridgeRouter({ basePath: '/tmp', getConfigValue: (key) => key === 'TUSHARE_TOKEN' ? 'test-token' : undefined })

    const result = await routeRequest('/api/finance/tushare', {
      api_name: 'trade_cal',
      params: { exchange: 'SSE', start_date: '20260601', end_date: '20260605' },
      fields: 'cal_date,is_open',
    }, 'POST') as any

    expect(tushareCall).toHaveBeenCalledWith(
      'test-token',
      'trade_cal',
      { exchange: 'SSE', start_date: '20260601', end_date: '20260605' },
      'cal_date,is_open',
    )
    expect(result).toMatchObject({
      source: 'tushare',
      api_name: 'trade_cal',
      count: 1,
      data: [{ cal_date: '20260605', is_open: 1 }],
    })
  })

  it('supports flat Bridge Tushare params for dashboard templates', async () => {
    tushareCall.mockResolvedValue([{ ts_code: '600519.SH' }])
    const { configureBridgeRouter, routeRequest } = await import('../../src/main/bridge-router')
    configureBridgeRouter({ basePath: '/tmp', getConfigValue: (key) => key === 'TUSHARE_TOKEN' ? 'test-token' : undefined })

    await routeRequest('/api/finance/tushare', {
      api_name: 'daily',
      ts_code: '600519.SH',
      fields: 'ts_code,trade_date,close',
    }, 'POST')

    expect(tushareCall).toHaveBeenCalledWith(
      'test-token',
      'daily',
      { ts_code: '600519.SH' },
      'ts_code,trade_date,close',
    )
  })
})
