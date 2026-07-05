import { beforeEach, describe, expect, it, vi } from 'vitest'

const gotdxFetch = vi.fn()
const sidecarFetch = vi.fn()

function sinaResponse(text: string): { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

vi.mock('../../src/main/sidecar', () => ({
  gotdxFetch,
  sidecarFetch,
  waitForSidecarReady: vi.fn(async () => true),
}))

describe('DefaultBridgeFinanceProvider', () => {
  beforeEach(() => {
    gotdxFetch.mockReset()
    sidecarFetch.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses TDX lightweight quote endpoint before network fallbacks for status-bar indices', async () => {
    gotdxFetch
      .mockResolvedValueOnce({
        Code: '000001',
        Name: '上证指数',
        Price: 4031.5129,
        LastClose: 3987.0147,
        Open: 3990,
        High: 4040,
        Low: 3980,
      })
      .mockResolvedValueOnce({
        Code: '399001',
        Name: '深证成指',
        Price: 14963.41,
        LastClose: 14851.978,
        Open: 14860,
        High: 15000,
        Low: 14800,
      })
    const fetchMock = vi.fn(async () => sinaResponse([
        'var hq_str_s_sh000001="上证指数,4031.5129,44.4982,1.12,7431310,153740152";',
        'var hq_str_s_sz399001="深证成指,14963.41,111.432,0.75,792336422,167754822";',
      ].join('\n')))
    vi.stubGlobal('fetch', fetchMock)

    const { DefaultBridgeFinanceProvider } = await import('../../src/domain/market/providers/bridge-finance-provider')
    const provider = new DefaultBridgeFinanceProvider()
    const result = await provider.readIndexQuotes(['000001', '399001'])

    expect(gotdxFetch).toHaveBeenCalledWith('/quote', { code: '000001', market: '1' })
    expect(gotdxFetch).toHaveBeenCalledWith('/quote', { code: '399001', market: '0' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result?.source).toBe('tdx')
    expect(result?.data).toMatchObject([
      { code: '000001', name: '上证指数', price: 4031.5129, source: 'tdx:index_quote' },
      { code: '399001', name: '深证成指', price: 14963.41, source: 'tdx:index_quote' },
    ])
  })
})
