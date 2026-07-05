import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../../src/agent/data/provider-timeouts'

const fetchSidecarJson = vi.fn()

vi.mock('../../src/agent/data/sidecar-http', () => ({
  fetchSidecarJson,
  isSidecarStartupError: () => false,
}))

describe('EastMoney runtime timeout policy', () => {
  beforeEach(() => {
    fetchSidecarJson.mockReset()
    fetchSidecarJson.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        data: [
          {
            '代码': '600519',
            '名称': '贵州茅台',
            '最新价': 1000,
            '涨跌幅': 1,
            '连板数': 2,
            '所属行业': '白酒',
            '首次封板时间': '09:30:00',
          },
        ],
      }),
    })
  })

  it('uses the extended EastMoney timeout for inferred EastMoney-backed sidecar calls', async () => {
    const { fetchContinuousLimitPool } = await import('../../src/agent/data/eastmoney-advanced')

    await fetchContinuousLimitPool('2026-06-18')

    expect(fetchSidecarJson).toHaveBeenCalledWith(
      expect.stringContaining('/akshare/stock_zt_pool_strong_em'),
      expect.objectContaining({ timeoutMs: EASTMONEY_RUNTIME_TIMEOUT_MS }),
    )
  })
})
