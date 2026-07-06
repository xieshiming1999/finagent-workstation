import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIndustryMap } from '../../src/agent/data/fetchers/fetcher-industry'
import { fetchSectors, fetchSectorStocks } from '../../src/agent/data/eastmoney-fetcher'

vi.mock('../../src/agent/data/eastmoney-fetcher', () => ({
  fetchSectors: vi.fn(),
  fetchSectorStocks: vi.fn(),
}))

const fetchSectorsMock = vi.mocked(fetchSectors)
const fetchSectorStocksMock = vi.mocked(fetchSectorStocks)

describe('industry fetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T09:30:00.000Z'))
    fetchSectorsMock.mockReset()
    fetchSectorStocksMock.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses direct EastMoney board-code constituents for the automatic path', async () => {
    fetchSectorsMock.mockResolvedValue([{ code: 'BK0475', name: '白酒', changePct: 1, turnoverRate: null, upCount: null, downCount: null, leadingStock: null, leadingChangePct: null }])
    fetchSectorStocksMock.mockResolvedValue([{ code: '600519', name: '贵州茅台', price: 1281.91, change: null, changePct: null, open: null, high: null, low: null, prevClose: null, volume: null, amount: null, pe: null, pb: null, marketCap: null, turnoverRate: null }])

    const resultPromise = fetchIndustryMap()
    await vi.advanceTimersByTimeAsync(1500)
    const result = await resultPromise

    expect(result.source).toBe('eastmoney')
    expect(result.data).toMatchObject([{ code: '600519', industry_l1: '白酒' }])
    expect(fetchSectorStocksMock).toHaveBeenCalledWith({ code: 'BK0475', name: '白酒', changePct: 1, turnoverRate: null, upCount: null, downCount: null, leadingStock: null, leadingChangePct: null }, 'industry')
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('stock_board_industry_cons_em'), expect.anything())
  })

  it('uses AkShare only as a board-list fallback, not as a constituent fallback', async () => {
    fetchSectorsMock.mockRejectedValue(new Error('direct board list unavailable'))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ '板块代码': 'BK0475', '板块名称': '白酒' }] }),
    } as Response)
    fetchSectorStocksMock.mockResolvedValue([{ code: '600809', name: '山西汾酒', price: 210, change: null, changePct: null, open: null, high: null, low: null, prevClose: null, volume: null, amount: null, pe: null, pb: null, marketCap: null, turnoverRate: null }])

    const resultPromise = fetchIndustryMap()
    await vi.advanceTimersByTimeAsync(1500)
    const result = await resultPromise

    expect(result.data).toMatchObject([{ code: '600809', industry_l1: '白酒' }])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stock_board_industry_name_em?_provider=eastmoney'),
      expect.anything(),
    )
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('stock_board_industry_cons_em'), expect.anything())
    expect(fetchSectorStocksMock).toHaveBeenCalledWith({ code: 'BK0475', name: '白酒' }, 'industry')
  })
})
