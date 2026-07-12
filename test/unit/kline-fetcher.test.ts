import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

describe('fetchKlineDaily', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    closeDb()
  })

  it('reads daily K-line rows from DataStore before provider calls', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'kline-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveKline(Array.from({ length: 10 }, (_, index) => ({
        code: '600519',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        open: 10 + index,
        high: 11 + index,
        low: 9 + index,
        close: 10.5 + index,
        volume: 1000 + index,
        amount: 2000 + index,
        change_pct: 1,
        turnover_rate: null,
        adjust: 'qfq',
        source: 'tdx',
      })))
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
      const result = await fetchKlineDaily('600519')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.provenance).toMatchObject({
        interfaceId: 'stock.daily_kline',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        cacheMode: 'cache-first',
        cacheDecision: expect.stringContaining('cache reader returned reusable canonical rows'),
      })
      expect(result.data).toHaveLength(10)
      expect(result.data[0]).toMatchObject({ code: '600519', close: 10.5 })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('uses only matching provider cache for strict K-line requests', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'kline-strict-provider-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveKline(Array.from({ length: 10 }, (_, index) => ({
        code: '600519',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        amount: 1,
        change_pct: 0,
        turnover_rate: null,
        adjust: 'qfq',
        source: 'akshare',
      })))
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: Array.from({ length: 10 }, (_, index) => ({
            DateTime: `2026-06-${String(index + 1).padStart(2, '0')} 15:00:00`,
            Open: 1200 + index,
            High: 1210 + index,
            Low: 1190 + index,
            Close: 1205 + index,
            Vol: 1000 + index,
            Amount: 100000 + index,
          })),
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
      const result = await fetchKlineDaily('600519', { provider: 'tdx', providerMode: 'strict' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('tdx')
      expect(result.provenance).toMatchObject({
        provider: 'tdx',
        cacheStatus: 'provider-hit',
        cacheMode: 'cache-first',
        cacheDecision: expect.stringContaining('no reusable cache rows matched the requirement'),
      })
      expect(result.data[0].close).toBe(1205)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('can explicitly bypass K-line cache for provider validation', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'kline-live-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveKline(Array.from({ length: 10 }, (_, index) => ({
        code: '600519',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        amount: 1,
        change_pct: 0,
        turnover_rate: null,
        adjust: 'qfq',
        source: 'local-seed',
      })))
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: Array.from({ length: 10 }, (_, index) => ({
            DateTime: `2026-06-${String(index + 1).padStart(2, '0')} 15:00:00`,
            Open: 1200 + index,
            High: 1210 + index,
            Low: 1190 + index,
            Close: 1205 + index,
            Vol: 1000 + index,
            Amount: 100000 + index,
          })),
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
      const result = await fetchKlineDaily('600519', { skipCache: true })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('tdx')
      expect(result.provenance).toMatchObject({
        provider: 'tdx',
        cacheStatus: 'provider-hit',
        cacheMode: 'live-only',
        cacheDecision: expect.stringContaining('live-only bypasses reusable local data'),
      })
      expect(result.data[0].close).toBe(1205)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('does not treat K-line cache as a hit when requested end date is not covered', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'kline-gap-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveKline(Array.from({ length: 10 }, (_, index) => ({
        code: '600519',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        amount: 1,
        change_pct: 0,
        turnover_rate: null,
        adjust: 'qfq',
        source: 'local-seed',
      })))
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: Array.from({ length: 10 }, (_, index) => ({
            DateTime: `2026-06-${String(index + 11).padStart(2, '0')} 15:00:00`,
            Open: 1200 + index,
            High: 1210 + index,
            Low: 1190 + index,
            Close: 1205 + index,
            Vol: 1000 + index,
            Amount: 100000 + index,
          })),
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
      const result = await fetchKlineDaily('600519', { start: '2026-06-01', end: '2026-06-20' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.provenance?.cacheStatus).toBe('provider-hit')
      expect(result.data[0].date).toBe('2026-06-11')
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('passes the TDX market parameter when fetching A-share K-line data', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('http://127.0.0.1:19801/kline')
      expect(url).toContain('code=600519')
      expect(url).toContain('market=1')
      return {
        ok: true,
        json: async () => ({
          List: Array.from({ length: 10 }, (_, index) => ({
            DateTime: `2026-06-${String(index + 1).padStart(2, '0')} 15:00:00`,
            Open: 1200 + index,
            High: 1210 + index,
            Low: 1190 + index,
            Close: 1205 + index,
            Vol: 1000 + index,
            Amount: 100000 + index,
          })),
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('600519')

    expect(result.source).toBe('tdx')
    expect(result.data).toHaveLength(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('runs feed-scoped EastMoney K-line route before AkShare compatibility', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => ({
          data: {
            klines: [
              '2026-06-01,10,10.5,11,9,1000,2000,0.5,1.2,0.1,2.3',
            ],
          },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('600519', { providers: ['eastmoneyDirect', 'akshare'] })

    expect(result.source).toBe('eastmoney')
    expect(result.data[0]).toMatchObject({ code: '600519', close: 10.5, source: 'eastmoney' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('push2his.eastmoney.com/api/qt/stock/kline/get')
    expect(calls[0]).not.toContain('/akshare/stock_zh_a_hist')
  })

  it('falls back to governed unadjusted K-line when broad adjusted providers are unavailable', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('money.finance.sina.com.cn')) {
        return {
          ok: true,
          json: async () => [
            { day: '2026-06-01', open: '10', high: '11', low: '9', close: '10.5', volume: '1000' },
            { day: '2026-06-02', open: '10.5', high: '11.5', low: '10', close: '11', volume: '1100' },
          ],
        }
      }
      return {
        ok: true,
        json: async () => ({ List: [], data: { klines: [] }, dataList: [] }),
        arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('600519', { skipCache: true })

    expect(result.source).toBe('sina')
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      code: '600519',
      date: '2026-06-01',
      close: 10.5,
      adjust: 'none',
      source: 'sina',
    })
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'sina.stock.daily_kline',
      provider: 'sina',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
    expect(result.provenance?.cacheDecision).toContain('Adjusted qfq provider route failed')
    expect(calls.some((url) => url.includes('money.finance.sina.com.cn'))).toBe(true)
  })

  it('honors strict EastMoney K-line provider requests with canonical provenance', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => ({
          data: {
            klines: [
              '2026-06-01,10,10.5,11,9,1000,2000,0.5,1.2,0.1,2.3',
              '2026-06-02,10.5,11,11.5,10,1100,2100,0.5,4.8,0.1,2.4',
            ],
          },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('600519', { provider: 'eastmoney', providerMode: 'strict', skipCache: true })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('push2his.eastmoney.com/api/qt/stock/kline/get')
    expect(calls[0]).not.toContain('/akshare/stock_zh_a_hist')
    expect(result.source).toBe('eastmoney')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'eastmoney.stock.daily_kline',
      provider: 'eastmoney',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      code: '600519',
      date: '2026-06-01',
      close: 10.5,
      source: 'eastmoney',
    })
  })

  it('honors strict Tencent HFQ K-line requests through the governed interface', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode([
          'kline_dayhfq={',
          '"data":{"sh600519":{"hfqday":[',
          '["2026-06-01","1200","1205","1210","1190","1000","","","2000"],',
          '["2026-06-02","1205","1215","1220","1200","1100","","","2100"]',
          ']}}',
          '}',
        ].join('')).buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('600519', {
      provider: 'tencent',
      providerMode: 'strict',
      adjust: 'hfq',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get')
    expect(calls[0]).toContain('kline_dayhfq')
    expect(calls[0]).toContain('hfq')
    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'tencent.stock.daily_kline',
      provider: 'tencent',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      code: '600519',
      date: '2026-06-01',
      close: 1205,
      amount: 2000,
      adjust: 'hfq',
      source: 'tencent',
    })
  })

  it('routes ETF daily K-line through the governed ETF OHLCV interface', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode([
          'kline_dayqfq={',
          '"data":{"sh510050":{"qfqday":[',
          '["2026-06-01","3.10","3.12","3.13","3.09","1000","","","2000"],',
          '["2026-06-02","3.12","3.15","3.16","3.11","1100","","","2100"]',
          ']}}',
          '}',
        ].join('')).buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('510050', {
      provider: 'tencent',
      providerMode: 'strict',
      adjust: 'qfq',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get')
    expect(calls[0]).toContain('sh510050')
    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'fund.etf_daily_ohlcv_bars',
      capabilityId: 'tencent.fund.etf_daily_ohlcv_bars',
      provider: 'tencent',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      code: '510050',
      date: '2026-06-01',
      close: 3.12,
      amount: 2000,
      adjust: 'qfq',
      source: 'tencent',
    })
  })

  it('routes convertible-bond daily K-line through the governed Tencent bond interface', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode([
          'kline_day={',
          '"data":{"sh110059":{"day":[',
          '["2026-06-01","110.10","110.80","111.00","109.90","1000","","","2000"],',
          '["2026-06-02","110.80","111.20","111.50","110.50","1200","","","2400"]',
          ']}}',
          '}',
        ].join('')).buffer,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('110059', {
      provider: 'tencent',
      providerMode: 'strict',
      adjust: 'none',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get')
    expect(calls[0]).toContain('sh110059')
    expect(calls[0]).toContain('kline_day')
    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'bond.convertible_daily_kline',
      capabilityId: 'tencent.bond.convertible_daily_kline',
      provider: 'tencent',
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      code: '110059',
      date: '2026-06-01',
      close: 110.8,
      amount: 2000,
      adjust: 'none',
      source: 'tencent',
    })
  })

  it('rejects adjusted convertible-bond daily K-line as unsupported by the governed route', async () => {
    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    await expect(fetchKlineDaily('110059', {
      provider: 'tencent',
      providerMode: 'strict',
      adjust: 'qfq',
      skipCache: true,
    })).rejects.toThrow('Convertible bond daily K-line is governed only for unadjusted Tencent bars')
  })

  it('routes global stock K-line through the Yahoo interface capability', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => ({
          data: [
            { _index: '2026-06-15 00:00:00', Open: 200, High: 215, Low: 199, Close: 210, Volume: 12345 },
          ],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchKlineDaily } = await import('../../src/agent/data/fetchers/fetcher-kline-daily')
    const result = await fetchKlineDaily('AAPL')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/yfinance/history?symbol=AAPL')
    expect(result.source).toBe('yfinance')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'yahoo.stock.daily_kline',
      provider: 'yahoo',
      cacheStatus: 'provider-hit',
    })
    expect(result.data[0]).toMatchObject({
      code: 'AAPL',
      date: '2026-06-15',
      close: 210,
      source: 'yfinance',
    })
  })
})
