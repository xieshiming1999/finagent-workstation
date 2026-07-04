import {
  DefaultMarketDataProvider,
  type KlineProviderResult,
  type MarketDataProvider,
  type QuoteProviderResult,
} from '../providers/market-data-provider'

export class MarketDataFetchService {
  constructor(private readonly provider: MarketDataProvider = new DefaultMarketDataProvider()) {}

  readQuotes(codes: string[]): Promise<QuoteProviderResult> {
    return this.provider.readPreferredQuotes(codes)
  }

  async readKline(
    code: string,
    options: { period: string; adjust: string; limit: number },
  ): Promise<KlineProviderResult> {
    const preferred = options.period === 'daily'
      ? await this.provider.readPreferredDailyKline(code, { adjust: options.adjust, limit: options.limit })
      : null
    if (preferred) return preferred
    return this.provider.readKline(code, options)
  }
}
