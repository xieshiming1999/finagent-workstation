import * as tv from './tradingview-fetcher'
import { cached } from './data-manager-shared'

export async function getTvScan(tickers: string[], indicators?: string[], timeframe?: string) {
  const key = `tv:${tickers.join(',')}:${timeframe ?? '1d'}`
  return cached(key, 30_000, () => tv.tvScan(tickers, indicators, timeframe))
}
