import type { ToolContext } from '../../../agent/tool'
import type { KlineRow } from '../../../agent/data/store/data-store'
import { cachePolicyFor, shouldFetchAfterMiss, shouldReadCache, type CachePolicy } from '../../../agent/data/cache-policy'
import { LocalMarketDataRepository } from '../repositories/local-market-data-repository'
import { isCoreCnMarketIndexCode } from '../market-index-universe'
import { MarketDataFetchService } from './market-data-fetch-service'
import { MarketDataReadService, type KlineReadResult, type QuoteReadResult } from './market-data-read-service'

export class MarketDataResolveService {
  private readonly repository = new LocalMarketDataRepository()

  constructor(
    private readonly readService: MarketDataReadService = new MarketDataReadService(),
    private readonly fetchService: MarketDataFetchService = new MarketDataFetchService(),
  ) {}

  async readQuotes(ctx: ToolContext, codes: string[], policy: Partial<CachePolicy> = {}): Promise<QuoteReadResult> {
    const resolvedPolicy = cachePolicyFor('quote', policy)
    const cached = shouldReadCache(resolvedPolicy)
      ? this.readService.readQuotes(ctx, codes, resolvedPolicy)
      : emptyQuoteRead(codes, 'live-only skips reusable storage')
    if (cached.status === 'hit' || !shouldFetchAfterMiss(resolvedPolicy)) return cached

    const fetched = await this.fetchService.readQuotes(cached.missingCodes)
    for (const batch of fetched.batches) this.repository.saveQuotes(ctx, batch.quotes, batch.source)
    const fetchedQuotes = fetched.batches.flatMap((batch) => batch.quotes)
    return {
      ...cached,
      quotes: [...cached.quotes, ...fetchedQuotes],
      freshCount: fetchedQuotes.length,
      freshSources: [...new Set(fetched.batches.map((batch) => batch.source))],
      provenance: [
        ...(cached.provenance ?? []),
        ...fetched.batches.map((batch) => batch.provenance).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      ],
    }
  }

  async readKline(
    ctx: ToolContext,
    code: string,
    options: { period?: string; adjust?: string; limit?: number; policy?: Partial<CachePolicy> } = {},
  ): Promise<KlineReadResult> {
    const period = options.period ?? 'daily'
    const requestedAdjust = options.adjust ?? 'qfq'
    const adjust = period === 'daily' && isCoreCnMarketIndexCode(code) ? 'none' : requestedAdjust
    const limit = options.limit ?? 60
    const resolvedPolicy = cachePolicyFor(period === 'daily' ? 'kline' : 'intradayTick', options.policy ?? {})
    const cached = shouldReadCache(resolvedPolicy)
      ? this.readService.readKline(ctx, code, { period, adjust, limit, policy: resolvedPolicy })
      : emptyKlineRead(period, adjust, 'live-only skips reusable storage')
    if (cached.status === 'hit' || !shouldFetchAfterMiss(resolvedPolicy)) return cached

    const fetched = await this.fetchService.readKline(code, { period, adjust, limit })
    if (period === 'daily' && fetched.bars.length > 0) {
      this.repository.saveKline(ctx, fetched.bars.map((bar) => providerBarToKlineRow(code, adjust, fetched.source, bar)))
    }
    return {
      bars: fetched.bars,
      source: fetched.source,
      period,
      adjust,
      status: 'hit',
      reason: `fetched via ${fetched.source} after ${cached.status}: ${cached.reason}`,
      coverage: { rowCount: fetched.bars.length, requiredRows: Math.min(limit, resolvedPolicy.minRows ?? 10) },
      provenance: fetched.provenance,
    }
  }
}

function emptyQuoteRead(codes: string[], reason: string): QuoteReadResult {
  return {
    quotes: [],
    cachedCount: 0,
    freshCount: 0,
    freshSources: [],
    status: 'miss',
    missingCodes: codes,
    staleCodes: [],
    reason,
    provenance: [],
  }
}

function emptyKlineRead(period: string, adjust: string, reason: string): KlineReadResult {
  return {
    bars: [],
    source: 'local',
    period,
    adjust,
    status: 'miss',
    reason,
    coverage: { rowCount: 0, requiredRows: 0 },
  }
}

function providerBarToKlineRow(
  code: string,
  adjust: string,
  source: string,
  bar: KlineReadResult['bars'][number],
): KlineRow {
  return {
    code,
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
    change_pct: bar.changePct ?? null,
    turnover_rate: bar.turnoverRate ?? null,
    adjust,
    source,
  }
}
