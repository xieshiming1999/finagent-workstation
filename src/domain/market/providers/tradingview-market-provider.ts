import * as dm from '../../../agent/data/data-manager'

export interface TradingviewMarketProvider {
  readScan(
    tickers: string[],
    indicators?: string[],
    timeframe?: string,
  ): Promise<Array<Record<string, unknown>>>
}

export class DataManagerTradingviewMarketProvider
  implements TradingviewMarketProvider {
  readScan(
    tickers: string[],
    indicators?: string[],
    timeframe?: string,
  ): Promise<Array<Record<string, unknown>>> {
    return dm.getTvScan(tickers, indicators, timeframe)
  }
}
