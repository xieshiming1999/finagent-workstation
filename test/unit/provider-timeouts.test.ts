import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  EASTMONEY_RUNTIME_TIMEOUT_MS,
  isEastmoneyBackedUrl,
  timeoutForEastmoneyBackedUrl,
} from '../../src/agent/data/provider-timeouts'

describe('provider runtime timeout policy', () => {
  it('uses an extended timeout for EastMoney direct and EastMoney-backed sidecar paths', () => {
    expect(timeoutForEastmoneyBackedUrl('https://push2delay.eastmoney.com/api/qt/clist/get')).toBe(EASTMONEY_RUNTIME_TIMEOUT_MS)
    expect(timeoutForEastmoneyBackedUrl('/akshare/stock_zh_a_spot_em?_priority=background&_provider=eastmoney')).toBe(EASTMONEY_RUNTIME_TIMEOUT_MS)
    expect(timeoutForEastmoneyBackedUrl('/akshare/stock_zh_a_spot_em?_priority=background&_provider%3Deastmoney')).toBe(EASTMONEY_RUNTIME_TIMEOUT_MS)
  })

  it('keeps non-EastMoney providers on the generic timeout budget', () => {
    expect(isEastmoneyBackedUrl('/akshare/fund_etf_spot_em?_priority=background')).toBe(false)
    expect(timeoutForEastmoneyBackedUrl('/akshare/fund_etf_spot_em?_priority=background')).toBe(DEFAULT_PROVIDER_TIMEOUT_MS)
    expect(timeoutForEastmoneyBackedUrl('/yfinance/history?symbol=AAPL', 60_000)).toBe(60_000)
  })
})
