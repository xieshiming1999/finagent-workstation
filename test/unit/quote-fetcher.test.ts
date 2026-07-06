import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import {
  clearQuoteCache,
  fetchQuote,
} from '../../src/agent/data/fetchers/fetcher-quote'

describe('quote fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearQuoteCache()
    closeDb()
  })

  it('reads fresh quote snapshots from DataStore before provider calls', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'quote-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveQuoteSnapshots([{
        code: '600519',
        timestamp: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        source: 'tdx',
        name: '贵州茅台',
        price: 1288,
        change: 8,
        change_pct: 0.63,
        open: 1270,
        high: 1290,
        low: 1260,
        prev_close: 1280,
        volume: 100,
        amount: 200,
      }])
      const fetchMock = vi.fn(async () => {
        throw new Error('provider should not be called')
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await fetchQuote('600519')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('local')
      expect(result.provenance).toMatchObject({
        interfaceId: 'stock.quote',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
        cacheMode: 'cache-first',
        cacheDecision: expect.stringContaining('cache reader returned reusable canonical rows'),
      })
      expect(result.data[0]).toMatchObject({
        code: '600519',
        name: '贵州茅台',
        price: 1288,
      })
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('uses only matching provider cache for strict quote requests', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'quote-strict-provider-cache-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveQuoteSnapshots([{
        code: '600519',
        timestamp: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        source: 'akshare',
        name: 'wrong-provider-cache',
        price: 1,
      }])
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: [{ Code: '600519', Name: '贵州茅台', Price: 1281.91, LastClose: 1307.22 }],
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await fetchQuote('600519', { provider: 'tdx', providerMode: 'strict' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('tdx')
      expect(result.provenance).toMatchObject({
        provider: 'tdx',
        cacheStatus: 'provider-hit',
        cacheMode: 'cache-first',
        cacheDecision: expect.stringContaining('no reusable cache rows matched the requirement'),
      })
      expect(result.data[0].price).toBe(1281.91)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('can explicitly bypass quote cache for provider validation', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'quote-live-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveQuoteSnapshots([{
        code: '600519',
        timestamp: new Date().toISOString(),
        source: 'local-seed',
        price: 1,
      }])
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            List: [{ Code: '600519', Name: '贵州茅台', Price: 1281.91, LastClose: 1307.22 }],
          }),
        })),
      )

      const result = await fetchQuote('600519', { skipCache: true })

      expect(result.source).toBe('tdx')
      expect(result.provenance).toMatchObject({
        provider: 'tdx',
        cacheStatus: 'provider-hit',
        cacheMode: 'live-only',
        cacheDecision: expect.stringContaining('live-only bypasses reusable local data'),
      })
      expect(result.data[0].price).toBe(1281.91)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('does not treat recent ingest time as fresh quote source timestamp', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'quote-stale-source-'))
    try {
      cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
      const store = new DataStore(basePath)
      await store.init()
      store.saveQuoteSnapshots([{
        code: '600519',
        timestamp: '2000-01-01T09:30:00.000Z',
        fetched_at: new Date().toISOString(),
        source: 'tdx',
        name: 'stale-source-time',
        price: 1,
      }])
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: [{ Code: '600519', Name: '贵州茅台', Price: 1281.91, LastClose: 1307.22 }],
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await fetchQuote('600519')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.source).toBe('tdx')
      expect(result.provenance?.cacheStatus).toBe('provider-hit')
      expect(result.data[0].price).toBe(1281.91)
    } finally {
      closeDb()
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('keeps gotdx quote prices in yuan instead of dividing by 100', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          List: [
            {
              Name: '贵州茅台',
              Price: 1281.91,
              LastClose: 1307.22,
              Open: 1304,
              High: 1304,
              Low: 1276,
              Vol: 5000,
              Amount: 640000000,
            },
          ],
        }),
      })),
    )

    const result = await fetchQuote('600519')

    expect(result.source).toBe('tdx')
    expect(result.data[0]).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      price: 1281.91,
      prevClose: 1307.22,
      open: 1304,
      high: 1304,
      low: 1276,
    })
    expect(result.data[0].change).toBeCloseTo(-25.31)
    expect(result.data[0].changePct).toBeCloseTo(-1.936)
  })

  it('tries direct EastMoney before AkShare when TDX quote is unavailable', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.startsWith('http://127.0.0.1:19801/quote')) {
          return {
            ok: true,
            json: async () => ({ List: [] }),
          }
        }
        if (url.startsWith('https://push2delay.eastmoney.com/api/qt/stock/get')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                f43: 53.7,
                f44: 54.2,
                f45: 53.5,
                f46: 54.06,
                f47: 63000,
                f48: 338000000,
                f51: 0.95,
                f55: 7.32,
                f58: '中国平安',
                f60: 54.08,
                f116: 1000000000000,
                f168: 0.8,
                f170: -0.7,
              },
            }),
          }
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    const result = await fetchQuote('601318')

    expect(result.source).toBe('eastmoney')
    expect(result.data[0]).toMatchObject({
      code: '601318',
      name: '中国平安',
      price: 53.7,
      prevClose: 54.08,
    })
    expect(calls[0]).toContain('http://127.0.0.1:19801/quote')
    expect(calls[1]).toContain('https://push2delay.eastmoney.com/api/qt/stock/get')
    expect(calls).toHaveLength(2)
  })

  it('routes strict Sina stock quote requests through the governed Sina capability', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return {
          ok: true,
          text: async () =>
            'var hq_str_sh600519="贵州茅台,1304.00,1307.22,1281.91,1304.00,1276.00,1281.90,1281.91,123456,158261111.00,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-06-22,15:00:00,00,";',
        }
      }),
    )

    const result = await fetchQuote('600519', {
      provider: 'sina',
      providerMode: 'strict',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('https://hq.sinajs.cn/list=sh600519')
    expect(result.source).toBe('sina')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.quote',
      capabilityId: 'sina.stock.quote',
      provider: 'sina',
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: 'provider-hit',
      providerMode: 'strict',
      requestedProvider: 'sina',
    })
    expect(result.data[0]).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      price: 1281.91,
      prevClose: 1307.22,
    })
  })

  it('routes convertible-bond quotes through the governed Tencent bond interface', async () => {
    const calls: string[] = []
    const parts = Array.from({ length: 50 }, () => '0')
    parts[1] = 'PF Convertible'
    parts[3] = '110.800'
    parts[4] = '110.000'
    parts[5] = '110.200'
    parts[6] = '123'
    parts[31] = '0.800'
    parts[32] = '0.727'
    parts[33] = '111.000'
    parts[34] = '109.900'
    parts[37] = '456.7'
    parts[38] = '1.2'
    parts[39] = '15.3'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode(`v_sh110059="${parts.join('~')}";`).buffer,
        }
      }),
    )

    const result = await fetchQuote('110059', {
      provider: 'tencent',
      providerMode: 'strict',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('https://qt.gtimg.cn/q=sh110059')
    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'bond.convertible_quote',
      capabilityId: 'tencent.bond.convertible_quote',
      provider: 'tencent',
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: 'provider-hit',
      providerMode: 'strict',
      requestedProvider: 'tencent',
    })
    expect(result.data[0]).toMatchObject({
      code: '110059',
      name: 'PF Convertible',
      price: 110.8,
      prevClose: 110,
    })
  })

  it('routes global stock quotes through the Yahoo interface capability', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return {
          ok: true,
          json: async () => ({
            data: {
              symbol: 'AAPL',
              shortName: 'Apple Inc.',
              lastPrice: 210,
              previousClose: 200,
              open: 205,
              dayHigh: 212,
              dayLow: 204,
              lastVolume: 12345,
              marketCap: 3000000000000,
            },
          }),
        }
      }),
    )

    const result = await fetchQuote('AAPL')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/yfinance/fast_info?symbol=AAPL')
    expect(result.source).toBe('yfinance')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.quote',
      capabilityId: 'yahoo.stock.quote',
      provider: 'yahoo',
      cacheStatus: 'provider-hit',
    })
    expect(result.data[0]).toMatchObject({
      code: 'AAPL',
      name: 'Apple Inc.',
      price: 210,
      prevClose: 200,
      change: 10,
    })
  })

  it('routes strict Tencent HK quotes through the global-only quote capability', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        const text = 'v_hk00700="100~Tencent~00700~421.400~428.800~428.600~29472428.0~0~0~421.400~0~0~0~0~0~0~0~0~0~421.400~0~0~0~0~0~0~0~0~0~29472428.0~2026/06/25 16:08:16~-7.400~-1.73~428.600~418.000~421.400~29472428.0~12461262215.170~0~15.42~~0~0~2.47~0";'
        const bytes = Buffer.from(text, 'utf8')
        return {
          ok: true,
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
        }
      }),
    )

    const result = await fetchQuote('hk00700', {
      provider: 'tencent',
      providerMode: 'strict',
      skipCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('https://qt.gtimg.cn/q=hk00700')
    expect(result.source).toBe('tencent')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.quote',
      capabilityId: 'tencent.global.stock_quote',
      provider: 'tencent',
      cacheStatus: 'provider-hit',
      requestedProvider: 'tencent',
    })
    expect(result.data[0]).toMatchObject({
      code: 'hk00700',
      name: 'Tencent',
      price: 421.4,
      prevClose: 428.8,
      change: -7.4,
    })
  })

  it('rejects TDX quote rows for a different code before persisting them as the requested stock', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.startsWith('http://127.0.0.1:19801/quote')) {
          return {
            ok: true,
            json: async () => ({
              List: [{ Code: '600519', Price: 1291.91, LastClose: 1279 }],
            }),
          }
        }
        if (url.startsWith('https://push2delay.eastmoney.com/api/qt/stock/get')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                f43: 39.34,
                f44: 39.35,
                f45: 38.34,
                f46: 38.59,
                f47: 1119833,
                f48: 4373132288,
                f58: '招商银行',
                f60: 38.73,
                f170: 1.58,
              },
            }),
          }
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )

    const result = await fetchQuote('600036')

    expect(result.source).toBe('eastmoney')
    expect(result.data[0]).toMatchObject({
      code: '600036',
      name: '招商银行',
      price: 39.34,
    })
    expect(calls[0]).toContain('http://127.0.0.1:19801/quote')
    expect(calls[1]).toContain('https://push2delay.eastmoney.com/api/qt/stock/get')
  })
})
