import {
  DataManagerTradingviewMarketProvider,
  type TradingviewMarketProvider,
} from '../providers/tradingview-market-provider'
import { eligibleCapabilitiesForInterface } from '../../../agent/data/data-api-interface-contract'
import { normalizeScreeningSnapshot } from '../../../agent/data/normalizers/screening-normalizer'
import type { DataStore } from '../../../agent/data/store/data-store'

export class ScanMarketDataService {
  constructor(
    private readonly provider: TradingviewMarketProvider = new DataManagerTradingviewMarketProvider(),
  ) {}

  async readScan(
    code: string,
    input: Record<string, unknown>,
    store?: DataStore,
  ): Promise<string> {
    if (!code) {
      throw new Error(
        'tickers required. Example: MarketData(action: "scan", code: "BINANCE:BTCUSDT,NASDAQ:AAPL")',
      )
    }

    const tickers = code.split(',').map((ticker) => ticker.trim()).filter(Boolean)
    const indicators = Array.isArray(input.indicators)
      ? input.indicators.filter((value): value is string => typeof value === 'string')
      : undefined
    const timeframe = String(input.timeframe ?? '1d')

    const results = await this.provider.readScan(tickers, indicators, timeframe)
    const capability = eligibleCapabilitiesForInterface('market.screening', { provider: 'tradingview' })[0]
    if (!capability) throw new Error('TradingView market.screening capability is not registered')
    const normalized = normalizeScreeningSnapshot({
      provider: 'tradingview',
      capabilityId: capability.id,
      sourceAction: 'scan',
      universe: tickers,
      filters: { indicators: indicators ?? [], timeframe },
      sort: {},
      rows: results,
    })
    if (store) store.saveMarketScreeningSnapshots(normalized.persistenceRows)
    return JSON.stringify(normalized, null, 2)
  }
}
