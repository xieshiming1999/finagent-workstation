import type * as dm from '../../../agent/data/data-manager'
import type { FetchProvenance } from '../../../agent/data/fetchers/base-fetcher'
import { fetchKlineDaily as fetchPreferredKlineDaily } from '../../../agent/data/fetchers/fetcher-kline-daily'
import { fetchIndexKline } from '../../../agent/data/fetchers/fetcher-index-kline'
import { getPreferredQuotes } from '../../../agent/tools/market-data-utils'
import { isCoreCnMarketIndexCode } from '../market-index-universe'

export interface QuoteProviderResult {
  batches: Array<{
    source: string
    quotes: dm.Quote[]
    provenance?: FetchProvenance
  }>
}

export interface KlineProviderResult {
  bars: Array<{
    date: string
    open: number
    close: number
    high: number
    low: number
    volume: number
    amount: number
    changePct: number | null
    turnoverRate: number | null
  }>
  source: string
  provenance?: FetchProvenance
}

export interface MarketDataProvider {
  readPreferredQuotes(codes: string[]): Promise<QuoteProviderResult>
  readPreferredDailyKline(
    code: string,
    options: { adjust: string; limit: number },
  ): Promise<KlineProviderResult | null>
  readKline(
    code: string,
    options: { period: string; adjust: string; limit: number },
  ): Promise<KlineProviderResult>
}

export class DefaultMarketDataProvider implements MarketDataProvider {
  async readPreferredQuotes(codes: string[]): Promise<QuoteProviderResult> {
    const results = await getPreferredQuotes(codes)
    return { batches: results.map((result) => ({ source: result.source, quotes: result.quotes, provenance: result.provenance })) }
  }

  async readPreferredDailyKline(
    code: string,
    options: { adjust: string; limit: number },
  ): Promise<KlineProviderResult | null> {
    if (isCoreCnMarketIndexCode(code)) {
      const preferred = await fetchIndexKline(code)
      return {
        bars: preferred.data.slice(-options.limit).map((bar) => ({
          date: bar.date,
          open: bar.open,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          volume: bar.volume ?? 0,
          amount: bar.amount ?? 0,
          changePct: bar.change_pct,
          turnoverRate: bar.turnover_rate,
        })),
        source: preferred.source,
        provenance: preferred.provenance,
      }
    }
    const preferred = await fetchPreferredKlineDaily(code, { adjust: options.adjust })
    if (!preferred) return null
    return {
      bars: preferred.data.slice(-options.limit).map((bar) => ({
        date: bar.date,
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume ?? 0,
        amount: bar.amount ?? 0,
        changePct: bar.change_pct,
        turnoverRate: bar.turnover_rate,
      })),
      source: preferred.source,
      provenance: preferred.provenance,
    }
  }

  async readKline(
    code: string,
    options: { period: string; adjust: string; limit: number },
  ): Promise<KlineProviderResult> {
    if (options.period !== 'daily') {
      throw new Error(`MarketDataProvider.readKline supports only governed daily K-line, got ${options.period}`)
    }
    const preferred = await this.readPreferredDailyKline(code, {
      adjust: options.adjust,
      limit: options.limit,
    })
    if (!preferred) {
      throw new Error(`No governed daily K-line provider returned rows for ${code}`)
    }
    return preferred
  }
}
