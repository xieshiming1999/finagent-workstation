import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { fmtAmt, fmtVol, getLocalStore, recordDirectApiFailure } from '../../../agent/tools/market-data-utils'
import { fetchChipDistribution } from '../../../agent/data/fetchers/fetcher-chip-distribution'
import { fetchFundamental } from '../../../agent/data/fetchers/fetcher-fundamental'
import { EastmoneyMarketDataService, type EastmoneyDataApiOptions, type EastmoneyResult } from './eastmoney-market-data-service'
import { EastmoneyMarketDataPersistenceService } from './eastmoney-market-data-persistence-service'
import { FundMarketDataFetchService } from './fund-market-data-fetch-service'

export class EastmoneyMarketDataActionService {
  constructor(
    private readonly service: EastmoneyMarketDataService = new EastmoneyMarketDataService(),
    private readonly persistence: EastmoneyMarketDataPersistenceService = new EastmoneyMarketDataPersistenceService(),
    private readonly fundFetchService: FundMarketDataFetchService = new FundMarketDataFetchService(),
  ) {}

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    switch (action) {
      case 'sector':
        return this.handleSector(input, ctx, limit)
      case 'limit_up':
        return this.handleLimitUp(input, ctx, limit)
      case 'dragon_tiger':
        return this.handleDragonTiger(input, ctx, limit)
      case 'northbound':
        return this.handleNorthbound(input, ctx, code, limit)
      case 'hot_rank':
        return this.handleHotRank(input, ctx, limit)
      case 'flow_rank':
        return this.handleFlowRank(input, ctx)
      case 'limit_down':
        return this.handleLimitDown(input, ctx, limit)
      case 'unusual':
        return this.handleUnusual(input, ctx, limit)
      case 'chip':
        return this.handleChip(input, ctx, code)
      case 'etf':
        return this.handleEtf(input, ctx, limit)
      case 'earnings':
        return this.handleEarnings(input, ctx, code)
      default:
        return toolError(`Unsupported EastMoney action: ${action}`)
    }
  }

  private async handleSector(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const startedAt = Date.now()
    let result
    try {
      result = await this.service.readSectorWithOptions(input, limit, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'sector', endpoint: sectorInterfaceId(input), startedAt, error: e })
      const cached = this.cachedSectorText(input, ctx, limit)
      if (cached) return cached
      return toolError(`Sector fetch failed: ${e}`)
    }
    if (result.kind === 'sector_constituents') {
      const { sectorName, items } = result
      if (items.length === 0) return `No sector constituent data for ${String(input.sectorCode ?? '').trim()}`
      const header = `${sectorName} constituents (${items.length})\nCode\tName\tPrice\tPct\tPE\tTurnover`
      const rows = items.slice(0, limit).map((i) =>
        `${i.code}\t${i.name}\t${i.price}\t${i.changePct}%\t${i.pe == null ? '-' : i.pe}\t${i.turnoverRate == null ? '-' : i.turnoverRate}%`)
      return `${header}\n${rows.join('\n')}`
    }

    const { sectorType: type, sectors } = result
    if (sectors.length === 0) return this.cachedSectorText(input, ctx, limit) ?? 'No sector data'
    const header = `${type} sectors (${sectors.length})\nCode\tName\tChangePct\tUp\tDown\tLeading`
    const rows = sectors.slice(0, limit).map((s) => `${s.code}\t${s.name}\t${s.changePct.toFixed(2)}%\t${s.upCount}\t${s.downCount}\t${s.leadingStock ?? '-'}`)
    return `${header}\n${rows.join('\n')}`
  }

  private async handleLimitUp(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const date = input.date ? String(input.date) : undefined
    const startedAt = Date.now()
    try {
      const result = await this.service.readLimitUpWithOptions(date, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return 'No limit-up stocks today'
      const header = `Limit-Up Pool (${items.length} stocks)\nCode\tName\tPrice\tPct\tIndustry\tDays\tTime`
      const rows = items.slice(0, limit).map((i) =>
        `${i.code}\t${i.name}\t${i.price}\t${i.changePct.toFixed(1)}%\t${i.industry}\t${i.days}d\t${i.firstLimitTime}`)
      return `${header}\n${rows.join('\n')}`
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'limit_up', endpoint: 'market.limit_pool', startedAt, error: e })
      return toolError(`Limit-up pool fetch failed: ${e}`)
    }
  }

  private async handleDragonTiger(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readDragonTigerWithOptions(limit, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return 'No dragon tiger data today'
      return items.slice(0, limit).map((i) => `${i.code} ${i.name} buy:${fmtAmt(i.buyAmt)} sell:${fmtAmt(i.sellAmt)} net:${fmtAmt(i.netAmt)} — ${i.reason}`).join('\n')
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'dragon_tiger', endpoint: 'market.dragon_tiger', startedAt, error: e })
      return toolError(`Dragon tiger fetch failed: ${e}`)
    }
  }

  private async handleNorthbound(input: Record<string, unknown>, ctx: ToolContext, code: string, limit: number): Promise<string> {
    const holdingCode = code.trim()
    const startedAt = Date.now()
    try {
      const result = code.trim()
        ? await this.service.readNorthboundHoldingWithOptions(code, limit, dataApiOptions(input))
        : await this.service.readNorthboundFlowWithOptions(limit, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      if (result.kind === 'northbound_holding') {
        const items = result.items
        if (items.length === 0) return `No northbound holding data for ${holdingCode}`
        return items.slice(0, limit).map((i) => `${i.tradeDate} ${i.code} ${i.name} hold:${fmtAmt(i.holdMarketCap)} ratio:${i.holdRatio.toFixed(2)}%`).join('\n')
      }

      const items = result.items
      if (items.length === 0) return 'No northbound flow data today'
      return items.slice(0, limit).map((i) => `${i.tradeDate} ${i.mutualType} buy:${fmtAmt(i.buyAmount)} sell:${fmtAmt(i.sellAmount)} net:${fmtAmt(i.netBuy)} hold:${fmtAmt(i.holdMarketCap)}`).join('\n')
    } catch (e) {
      const action = holdingCode ? 'northbound_holding' : 'northbound_flow'
      const endpoint = holdingCode ? 'market.northbound_holding' : 'market.northbound_flow'
      recordDirectApiFailure(ctx, { source: 'eastmoney', action, endpoint, startedAt, error: e })
      return toolError(`Northbound ${holdingCode ? 'holding' : 'flow'} fetch failed: ${e}`)
    }
  }

  private async handleHotRank(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readHotRankWithOptions(limit, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return 'No hot rank data'
      return items.map((i) => {
        const name = i.name ? ` ${i.name}` : ''
        const hot = i.hotValue == null ? '-' : String(i.hotValue)
        const change = i.rankChange == null ? '-' : `${i.rankChange > 0 ? '+' : ''}${i.rankChange}`
        return `#${i.rank} ${i.code}${name} hot:${hot} change:${change}`
      }).join('\n')
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'hot_rank', endpoint: 'market.hot_rank', startedAt, error: e })
      return toolError(`Hot rank fetch failed: ${e}`)
    }
  }

  private async handleFlowRank(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const days = Number(input.days ?? 1)
    const startedAt = Date.now()
    try {
      const result = await this.service.readFlowRankWithOptions(days, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return this.cachedFlowRankText(input, ctx) ?? 'No flow ranking data'
      return items.map((i) => `${i.code} ${i.name} flow:${fmtAmt(i.mainNetInflow)} pct:${i.changePct.toFixed(2)}%`).join('\n')
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'flow_rank', endpoint: 'market.flow_rank', startedAt, error: e })
      const cached = this.cachedFlowRankText(input, ctx)
      if (cached) return cached
      return toolError(`Flow rank fetch failed: ${e}`)
    }
  }

  private async handleLimitDown(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const date = input.date ? String(input.date) : undefined
    const startedAt = Date.now()
    try {
      const result = await this.service.readLimitDownWithOptions(date, dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return 'No limit-down stocks'
      return items.slice(0, limit).map((i) => `${i.code} ${i.name} ${i.price} ${i.changePct.toFixed(1)}% ${i.industry}`).join('\n')
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'limit_down', endpoint: 'market.limit_pool', startedAt, error: e })
      return toolError(`Limit-down pool fetch failed: ${e}`)
    }
  }

  private async handleUnusual(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readUnusualWithOptions(dataApiOptions(input))
      this.persistProviderHit(ctx, result)
      const items = result.items
      if (items.length === 0) return 'No unusual activity detected'
      return items.slice(0, limit).map((i) => `${i.code} ${i.name} ${i.type} ${i.description ?? ''}`).join('\n')
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'unusual', endpoint: 'market.unusual_activity', startedAt, error: e })
      return toolError(`Unusual activity fetch failed: ${e}`)
    }
  }

  private async handleEarnings(input: Record<string, unknown>, ctx: ToolContext, code: string): Promise<string> {
    if (!code) return toolError('code required. Example: MarketData(action: "earnings", code: "600519")')
    if (!/^\d{6}$/.test(code)) return toolError('A-share 6-digit code required for earnings. Use yahoo_earnings for non-A-share symbols.')
    const startedAt = Date.now()
    try {
      const opts = dataApiOptions({ provider: 'eastmoney', ...input })
      const result = await fetchFundamental(code, opts)
      if (result.provenance?.cacheStatus !== 'cache-hit') getLocalStore(ctx).saveFundamental(result.data)
      if (result.data.length === 0) return `No financial data for ${code}`
      const periods = result.data.slice(0, 4).map((row) => ({
        period: row.report_date,
        reportDate: row.report_date,
        revenue: row.revenue,
        revenueYoY: row.revenue_yoy,
        netProfit: row.net_profit,
        netProfitYoY: row.profit_yoy,
        grossMargin: row.gross_margin,
        netMargin: row.net_margin,
        roe: row.roe,
        debtRatio: row.debt_ratio,
      }))
      return JSON.stringify({
        action: 'earnings',
        interfaceId: result.provenance?.interfaceId ?? 'stock.daily_valuation',
        source: result.source,
        code,
        latestReport: periods[0]?.period ?? '',
        periods,
        provenance: result.provenance,
      }, null, 2)
    } catch (e) {
      recordDirectApiFailure(ctx, {
        source: 'eastmoney',
        action: 'earnings',
        endpoint: 'stock.daily_valuation',
        startedAt,
        error: e,
      })
      return toolError(`Earnings data fetch failed: ${e}`)
    }
  }

  private async handleChip(input: Record<string, unknown>, ctx: ToolContext, code: string): Promise<string> {
    if (!code) return toolError('code required. Example: MarketData(action: "chip", code: "600519")')
    const startedAt = Date.now()
    try {
      const opts = dataApiOptions({ provider: 'eastmoney', ...input })
      const result = await fetchChipDistribution(code, {
        ...opts,
        date: input.date == null ? undefined : String(input.date),
        limit: Number(input.limit ?? 20),
      })
      if (result.provenance?.cacheStatus !== 'cache-hit') getLocalStore(ctx).saveChipDistribution(result.data)
      if (result.data.length === 0) return `No chip data for ${code}`
      return JSON.stringify({
        action: 'chip',
        interfaceId: result.provenance?.interfaceId ?? 'stock.chip_distribution',
        source: result.source,
        code,
        items: result.data.slice(0, Number(input.limit ?? 5)),
        provenance: result.provenance,
      }, null, 2)
    } catch (e) {
      recordDirectApiFailure(ctx, {
        source: 'eastmoney',
        action: 'chip',
        endpoint: 'stock.chip_distribution',
        startedAt,
        error: e,
      })
      return toolError(`Chip data fetch failed: ${e}`)
    }
  }

  private async handleEtf(input: Record<string, unknown>, ctx: ToolContext, limit: number): Promise<string> {
    const startedAt = Date.now()
    try {
      const providers = input.provider ? [String(input.provider) as never] : []
      const result = await this.fundFetchService.readEtfQuotes(limit, providers, {
        provider: input.provider == null ? undefined : String(input.provider),
      })
      if (result.provenance?.cacheStatus !== 'cache-hit') {
        const store = getLocalStore(ctx)
        store.saveStockList(result.stocks)
        store.saveQuoteSnapshots(result.quotes)
      }
      const quotes = result.quotes
      if (quotes.length === 0) return 'No ETF data'
      const header = 'Code\tName\tPrice\tChangePct\tVolume'
      const rows = quotes.slice(0, limit).map((quote) =>
        `${quote.code}\t${quote.name ?? quote.code}\t${quote.price ?? '-'}\t${quote.change_pct ?? '-'}%\t${fmtVol(Number(quote.volume ?? 0))}`)
      return `${header}\n${rows.join('\n')}`
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'eastmoney', action: 'etf', endpoint: 'fund.etf_quote', startedAt, error: e })
      return toolError(`ETF fetch failed: ${e}`)
    }
  }

  private cachedSectorText(input: Record<string, unknown>, ctx: ToolContext, limit: number): string | null {
    const sectorCode = String(input.sectorCode ?? '').trim()
    if (sectorCode) return null
    const type = String(input.type ?? 'industry')
    try {
      const rows = getLocalStore(ctx).querySectorRanking(input.date as string | undefined, type, limit)
      if (rows.length === 0) return null
      const header = `${type} sectors (${rows.length}, cached)\nCode\tName\tChangePct\tUp\tDown\tLeading`
      const lines = rows.map((row) => `${row.code}\t${row.name}\t${Number(row.change_pct ?? 0).toFixed(2)}%\t${row.up_count ?? '-'}\t${row.down_count ?? '-'}\t${row.leading_stock ?? '-'}`)
      return `${header}\n${lines.join('\n')}`
    } catch {
      return null
    }
  }

  private cachedFlowRankText(input: Record<string, unknown>, ctx: ToolContext): string | null {
    try {
      const rows = getLocalStore(ctx).queryFlowRank(input.period ? String(input.period) : undefined, input.code ? String(input.code) : undefined, input.date as string | undefined, Number(input.limit ?? 50))
      if (rows.length === 0) return null
      return rows.map((row) => `${row.code} ${row.name ?? ''} flow:${fmtAmt(Number(row.main_net ?? 0))} pct:${row.main_pct ?? '-'}% (cached)`).join('\n')
    } catch {
      return null
    }
  }

  private persistProviderHit(ctx: ToolContext, result: EastmoneyResult): void {
    if (result.provenance?.cacheStatus === 'cache-hit') return
    this.persistence.persist(ctx, result)
  }

}

function sectorInterfaceId(input: Record<string, unknown>): string {
  return input.sectorCode || input.sectorName ? 'market.sector_constituents' : 'market.sector_ranking'
}

function dataApiOptions(input: Record<string, unknown>): EastmoneyDataApiOptions {
  const cacheMode = String(input.cacheMode ?? '').trim()
  const providerMode = String(input.providerMode ?? '').trim()
  return {
    provider: input.provider == null ? undefined : String(input.provider),
    providerMode: providerMode === 'auto' || providerMode === 'preferred' || providerMode === 'strict'
      ? providerMode
      : undefined,
    cacheMode: cacheMode === 'cache-first' || cacheMode === 'live-only' || cacheMode === 'cache-only'
      ? cacheMode
      : undefined,
    skipCache: input.skipCache === true,
    allowFallback: typeof input.allowFallback === 'boolean' ? input.allowFallback : undefined,
    allowDegraded: typeof input.allowDegraded === 'boolean' ? input.allowDegraded : undefined,
  }
}
