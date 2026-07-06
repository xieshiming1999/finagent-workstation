import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('sidecar startup-aware HTTP helper', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('waits for sidecar readiness and retries once on initial local connect failure', async () => {
    let requestCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      requestCount += 1
      if (requestCount === 1) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      return new Response(JSON.stringify({ data: [{ ok: true }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchSidecarJson, resetSidecarHealthForTest } = await import('../../src/agent/data/sidecar-http')
    resetSidecarHealthForTest()

    const res = await fetchSidecarJson('/akshare/stock_zt_pool_em', { timeoutMs: 500, startupWaitMs: 50 })
    const json = await res.json()

    expect(json).toEqual({ data: [{ ok: true }] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19800/health',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:19800/akshare/stock_zt_pool_em',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('throws a startup-specific error when the sidecar never becomes ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchSidecarJson, resetSidecarHealthForTest } = await import('../../src/agent/data/sidecar-http')
    resetSidecarHealthForTest()

    await expect(fetchSidecarJson('/yfinance/fast_info?symbol=AAPL', {
      timeoutMs: 500,
      startupWaitMs: 20,
    })).rejects.toThrow(/Python sidecar is still starting/i)
  })
})
