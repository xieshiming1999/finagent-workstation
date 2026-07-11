import { describe, expect, it, vi } from 'vitest'
import { FetchQueue, type FetchTask } from '../../src/agent/data/queue/fetch-queue'
import { fetchKlineDaily } from '../../src/agent/data/fetchers/fetcher-kline-daily'
import { fetchQuote } from '../../src/agent/data/fetchers/fetcher-quote'
import { ingestEndpointResult } from '../../src/agent/data/ingestion/registry'

vi.mock('../../src/agent/data/fetchers/fetcher-kline-daily', () => ({
  fetchKlineDaily: vi.fn(),
}))

vi.mock('../../src/agent/data/fetchers/fetcher-quote', () => ({
  fetchQuote: vi.fn(),
}))

vi.mock('../../src/agent/data/ingestion/registry', () => ({
  ingestEndpointResult: vi.fn(() => ({ count: 2 })),
}))

vi.mock('../../src/main/sidecar', () => ({
  getGotdxUrl: vi.fn(() => 'http://127.0.0.1:19801'),
  getSidecarUrl: vi.fn(() => 'http://127.0.0.1:19800'),
}))

vi.mock('../../src/agent/data/queue/rate-limiter', () => ({
  rateLimitedFetch: vi.fn((_source: string, run: () => unknown) => run()),
}))

function makeTask(params: Record<string, unknown>): FetchTask {
  return {
    id: 1,
    taskType: 'kline_batch',
    code: null,
    params,
    status: 'running',
    priority: 5,
    progress: null,
    createdAt: '2026-06-12T00:00:00.000Z',
    error: null,
  }
}

describe('FetchQueue kline batch accounting', () => {
  it('persists quote fetch tasks into quote_snapshot rows', async () => {
    vi.mocked(fetchQuote).mockResolvedValue({
      data: [{
        code: '600519',
        name: '贵州茅台',
        price: 1182.99,
        change: -1.09,
        changePct: -0.09,
        open: 1199,
        high: 1199,
        low: 1175.01,
        prevClose: 1184.08,
        volume: 31472,
        amount: 3733611264,
        pe: 13.52,
        pb: 6.25,
        marketCap: null,
        turnoverRate: null,
      }],
      source: 'eastmoney',
      fetchedAt: '2026-06-26T05:50:40.000Z',
      provenance: { interfaceId: 'stock.quote', provider: 'eastmoney' },
    } as any)
    const store = {
      saveQuoteSnapshots: vi.fn(),
    }
    const queue = new FetchQueue(store as any)
    const task: FetchTask = {
      id: 2,
      taskType: 'quote',
      code: '600519',
      params: { forceLive: true },
      status: 'running',
      priority: 3,
      progress: null,
      createdAt: '2026-06-26T00:00:00.000Z',
      error: null,
    }

    await (queue as any).execQuote(task)

    expect(fetchQuote).toHaveBeenCalledWith('600519', expect.objectContaining({ forceLive: true }))
    expect(store.saveQuoteSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({
        code: '600519',
        source: 'eastmoney',
        price: 1182.99,
        change_pct: -0.09,
        fetched_at: '2026-06-26T05:50:40.000Z',
      }),
    ])
    expect(task.progress).toMatchObject({
      fetched: 1,
      total: 1,
      saved: 1,
    })
  })

  it('persists stock_company_info fetch tasks through the TDX ingestion registry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ List: [{ title: '公司概况', filename: 'profile.txt' }] }),
    } as Response)
    const store = {
      saveApiCall: vi.fn(),
    }
    const queue = new FetchQueue(store as any)
    const task: FetchTask = {
      id: 3,
      taskType: 'stock_company_info',
      code: '600519',
      params: {},
      status: 'running',
      priority: 3,
      progress: null,
      createdAt: '2026-06-26T00:00:00.000Z',
      error: null,
    }

    await (queue as any).execStockCompanyInfo(task)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19801/company_info?code=600519',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(ingestEndpointResult).toHaveBeenCalledWith(
      store,
      expect.objectContaining({
        provider: 'tdx',
        endpoint: 'company_info',
        code: '600519',
        source: 'tdx',
      }),
    )
    expect(store.saveApiCall).toHaveBeenCalledWith(expect.objectContaining({
      source: 'tdx',
      action: 'stock_company_info',
      endpoint: 'company_info',
      success: true,
    }))
    expect(task.progress).toMatchObject({
      fetched: 1,
      total: 1,
      saved: 2,
    })
    fetchMock.mockRestore()
  })

  it('persists finance_news fetch tasks through the governed news interface', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          {
            title: '茅台市场新闻',
            summary: '贵州茅台相关市场动态',
            source: 'akshare',
            published_at: '2026-06-26T06:00:00.000Z',
            url: 'https://example.test/news/1',
          },
        ],
      }),
    } as Response)
    const store = {
      saveFinanceNews: vi.fn(),
      saveApiCall: vi.fn(),
    }
    const queue = new FetchQueue(store as any)
    const task: FetchTask = {
      id: 4,
      taskType: 'finance_news',
      code: '600519',
      params: { keyword: '贵州茅台', limit: 10 },
      status: 'running',
      priority: 3,
      progress: null,
      createdAt: '2026-06-26T00:00:00.000Z',
      error: null,
    }

    await (queue as any).execFinanceNews(task)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19800/news?query=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&keyword=%E8%B4%B5%E5%B7%9E%E8%8C%85%E5%8F%B0&limit=10',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(store.saveFinanceNews).toHaveBeenCalledWith([
      expect.objectContaining({
        title: '茅台市场新闻',
        source: 'akshare',
      }),
    ])
    expect(store.saveApiCall).toHaveBeenCalledWith(expect.objectContaining({
      source: 'akshare',
      provider: 'akshare',
      interface_id: 'news.finance_feed',
      capability_id: 'akshare.news.finance_feed',
      action: 'finance_news',
      endpoint: '/news',
      success: true,
    }))
    expect(task.progress).toMatchObject({
      fetched: 1,
      total: 1,
      saved: 1,
    })
    fetchMock.mockRestore()
  })

  it('fails the batch when every symbol fails and no bars are saved', async () => {
    vi.mocked(fetchKlineDaily).mockRejectedValue(new Error('TDX code mismatch'))
    const store = {
      getCoverage: vi.fn(() => null),
      saveKline: vi.fn(),
      saveApiCall: vi.fn(),
      updateTaskStatus: vi.fn(),
    }
    const queue = new FetchQueue(store as any)
    ;(queue as any).running = true

    const task = makeTask({ codes: ['600519', '600036'], start: '2026-06-01', end: '2026-06-12' })

    await expect((queue as any).execKlineBatch(task)).rejects.toThrow(/kline_batch failed for all 2\/2/)

    expect(store.saveKline).not.toHaveBeenCalled()
    expect(store.saveApiCall).toHaveBeenCalledTimes(2)
    expect(store.saveApiCall).toHaveBeenCalledWith(expect.objectContaining({
      source: 'market-data',
      tool: 'FetchQueue',
      action: 'kline_batch',
      endpoint: 'kline_batch',
      success: false,
      error: expect.stringContaining('600519: TDX code mismatch'),
    }))
    expect(task.progress).toMatchObject({
      fetched: 2,
      total: 2,
      saved: 0,
      failed: 2,
      skipped: 0,
    })
  })

  it('records scoped single-provider kline failures under that provider source', async () => {
    vi.mocked(fetchKlineDaily).mockRejectedValue(new Error('TDX unavailable'))
    const store = {
      getCoverage: vi.fn(() => null),
      saveKline: vi.fn(),
      saveApiCall: vi.fn(),
      updateTaskStatus: vi.fn(),
    }
    const queue = new FetchQueue(store as any)
    ;(queue as any).running = true

    const task = makeTask({
      codes: ['600519'],
      start: '2026-06-01',
      end: '2026-06-12',
      source_priority: 'tdx',
    })

    await expect((queue as any).execKlineBatch(task)).rejects.toThrow(/kline_batch failed for all 1\/1/)

    expect(store.saveApiCall).toHaveBeenCalledWith(expect.objectContaining({
      source: 'tdx',
      endpoint: 'kline_batch',
      error: expect.stringContaining('600519: TDX unavailable'),
    }))
  })
})
