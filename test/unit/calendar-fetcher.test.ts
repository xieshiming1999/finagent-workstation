import { afterEach, describe, expect, it, vi } from 'vitest'

describe('trade calendar fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the live SZSE monthly calendar endpoint and returns canonical rows', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      urls.push(url)
      const month = url.match(/month=(\d{4}-\d{2})/)?.[1] ?? '2026-01'
      return {
        ok: true,
        json: async () => ({
          data: [
            { jyrq: `${month}-01`, jybz: '0' },
            { jyrq: `${month}-02`, jybz: '1' },
          ],
        }),
      } as Response
    }))

    const { fetchTradeCalendar } = await import('../../src/agent/data/fetchers/fetcher-calendar')
    const result = await fetchTradeCalendar(2026)

    expect(urls).toHaveLength(12)
    expect(urls[0]).toContain('/api/report/exchange/onepersistenthour/monthList?month=2026-01')
    expect(result.source).toBe('szse')
    expect(result.data).toHaveLength(24)
    expect(result.data[0]).toMatchObject({ date: '2026-01-01', market: 'CN', is_trading_day: 0, year: 2026, month: 1 })
    expect(result.data[1]).toMatchObject({ date: '2026-01-02', market: 'CN', is_trading_day: 1, year: 2026, month: 1 })
  })
})
