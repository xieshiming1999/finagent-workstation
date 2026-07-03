import type { ToolContext } from '../../../agent/tool'
import type * as adv from '../../../agent/data/eastmoney-advanced'
import type * as dm from '../../../agent/data/data-manager'
import { quoteToSnapshot } from '../../../agent/data/normalizers/quote-normalizer'
import { getLocalStore, normalizeCnMarket, today } from '../../../agent/tools/market-data-utils'

export class EastmoneyMarketDataRepository {
  saveStockList(
    ctx: ToolContext,
    items: Array<{ code: string; name: string; industry?: string | null; stockType?: string; raw?: unknown }>,
  ): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveStockList(items
        .filter((item) => item.code && item.name)
        .map((item) => ({
          code: item.code,
          name: item.name,
          market: item.stockType === 'etf' ? 'ETF' : normalizeCnMarket(item.code),
          industry: item.industry ?? null,
          list_date: null,
          delist_date: null,
          stock_type: item.stockType ?? 'stock',
          updated_at: new Date().toISOString(),
          raw_json: JSON.stringify(item.raw ?? item),
        })))
    } catch {}
  }

  saveSectorConstituents(
    ctx: ToolContext,
    sectorName: string,
    items: dm.Quote[],
  ): void {
    if (items.length === 0) return
    try {
      const store = getLocalStore(ctx)
      store.saveQuoteSnapshots(items.map((item) => quoteToSnapshot(item, 'eastmoney')))
      store.saveStockList(items.map((item) => ({
        code: item.code,
        name: item.name,
        market: item.code.startsWith('6') ? 'SH' : (item.code.startsWith('4') || item.code.startsWith('8') || item.code.startsWith('9') ? 'BJ' : 'SZ'),
        industry: sectorName,
        list_date: null,
        delist_date: null,
        stock_type: 'stock',
        updated_at: new Date().toISOString(),
        raw_json: JSON.stringify(item),
      })))
      store.saveIndustryMap(items.map((item) => ({
        code: item.code,
        industry_l1: sectorName,
        industry_l2: null,
        industry_l3: null,
        updated_at: new Date().toISOString(),
      })))
    } catch {}
  }

  saveSectorRanking(
    ctx: ToolContext,
    sectorType: string,
    sectors: dm.SectorItem[],
  ): void {
    if (sectors.length === 0) return
    try {
      getLocalStore(ctx).saveSectorRanking(today(), sectorType, sectors.map((sector, index) => ({
        code: sector.code,
        name: sector.name,
        change_pct: sector.changePct,
        turnover_rate: sector.turnoverRate,
        up_count: sector.upCount,
        down_count: sector.downCount,
        leading_stock: sector.leadingStock ?? null,
        leading_pct: null,
        rank: index + 1,
        source: 'eastmoney',
      })))
    } catch {}
  }

  saveLimitPool(
    ctx: ToolContext,
    date: string,
    limitType: 'up' | 'down',
    items: adv.LimitUpItem[] | adv.LimitDownItem[],
  ): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveLimitPool(items.map((item) => ({
        date,
        code: item.code,
        name: item.name,
        limit_type: limitType,
        change_pct: item.changePct,
        first_limit_time: 'firstLimitTime' in item ? item.firstLimitTime : null,
        last_limit_time: 'lastLimitTime' in item ? item.lastLimitTime : null,
        open_count: 'limitCount' in item ? item.limitCount : null,
        limit_reason: item.industry,
        continuous_days: 'days' in item ? item.days : null,
        source: 'eastmoney',
      })))
    } catch {}
  }

  saveDragonTiger(ctx: ToolContext, items: adv.DragonTigerItem[]): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveDragonTiger(items.map((item) => ({
        date: item.tradeDate,
        code: item.code,
        name: item.name,
        reason: item.reason,
        buy_amt: item.buyAmt,
        sell_amt: item.sellAmt,
        net_amt: item.netAmt,
        accum_amount: item.accumAmount,
        source: 'eastmoney',
      })))
    } catch {}
  }

  saveNorthboundHolding(ctx: ToolContext, items: adv.NorthboundHoldingItem[]): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveNorthboundHolding(items.map((item) => ({
        trade_date: item.tradeDate,
        code: item.code,
        name: item.name,
        hold_market_cap: item.holdMarketCap,
        hold_ratio: item.holdRatio,
        source: 'eastmoney',
        raw_json: JSON.stringify(item),
      })))
    } catch {}
  }

  saveNorthboundFlow(ctx: ToolContext, items: adv.NorthboundFlowItem[]): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveNorthboundFlow(items.map((item) => ({
        trade_date: item.tradeDate,
        mutual_type: item.mutualType,
        buy_amount: item.buyAmount,
        sell_amount: item.sellAmount,
        net_buy: item.netBuy,
        hold_market_cap: item.holdMarketCap,
        source: 'eastmoney',
        raw_json: JSON.stringify(item),
      })))
    } catch {}
  }

  saveHotRank(ctx: ToolContext, items: adv.HotRankItem[], source = 'eastmoney'): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveHotRank(items.map((item) => ({
        date: today(),
        code: item.code,
        name: item.name,
        rank: item.rank,
        heat: item.hotValue,
        rank_change: item.rankChange,
        source,
      })))
    } catch {}
  }

  saveFlowRank(ctx: ToolContext, period: string, items: adv.FlowRankItem[], source = 'eastmoney'): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveFlowRank(items.map((item) => ({
        trade_date: today(),
        period,
        code: item.code,
        name: item.name,
        main_net: item.mainNetInflow,
        main_pct: null,
        super_large_net: null,
        super_large_pct: null,
        large_net: null,
        large_pct: null,
        medium_net: null,
        medium_pct: null,
        source,
        raw_json: JSON.stringify(item),
      })))
    } catch {}
  }

  saveUnusualActivity(ctx: ToolContext, items: adv.UnusualActivityItem[], source = 'eastmoney'): void {
    if (items.length === 0) return
    try {
      getLocalStore(ctx).saveUnusualActivity(items.map((item) => ({
        event_date: today(),
        code: item.code,
        event_time: item.time,
        event_type: item.type,
        name: item.name,
        info: item.description ?? null,
        source,
        raw_json: JSON.stringify(item),
      })))
    } catch {}
  }

  saveChipDistribution(ctx: ToolContext, code: string, rows: Array<Record<string, unknown>>): void {
    if (rows.length === 0) return
    try {
      getLocalStore(ctx).saveChipDistribution(rows.map((row) => ({
        code,
        trade_date: String(row.TRADE_DATE ?? row.date ?? today()).slice(0, 10),
        avg_cost: Number(row.AVG_COST ?? row.COST_AVG ?? row.avgCost ?? 0) || null,
        profit_ratio: Number(row.PROFIT_RATIO ?? row.WINNER_RATE ?? row.profitRatio ?? 0) || null,
        concentration70: Number(row.CONCENTRATION_70 ?? row.COST_70 ?? row.concentration70 ?? 0) || null,
        concentration90: Number(row.CONCENTRATION_90 ?? row.COST_90 ?? row.concentration90 ?? 0) || null,
        current_price: Number(row.CLOSE_PRICE ?? row.currentPrice ?? 0) || null,
        method: row.METHOD ?? row.method ?? null,
        source: 'eastmoney',
        raw_json: JSON.stringify(row),
      })))
    } catch {}
  }

  saveEtfQuotes(ctx: ToolContext, items: Array<Record<string, unknown>>): void {
    if (items.length === 0) return
    try {
      const store = getLocalStore(ctx)
      const snapshots = items.map((item) => quoteToSnapshot({
        code: String(item.f12 ?? ''),
        name: String(item.f14 ?? item.f12 ?? ''),
        price: Number(item.f2 ?? 0),
        change: 0,
        changePct: Number(item.f3 ?? 0),
        open: 0,
        high: 0,
        low: 0,
        prevClose: 0,
        volume: Number(item.f5 ?? 0),
        amount: 0,
      } as dm.Quote, 'eastmoney:etf'))
      store.saveQuoteSnapshots(snapshots)
      store.saveStockList(items.map((item) => ({
        code: String(item.f12 ?? ''),
        name: String(item.f14 ?? item.f12 ?? ''),
        market: 'ETF',
        industry: null,
        list_date: null,
        delist_date: null,
        stock_type: 'etf',
        updated_at: new Date().toISOString(),
        raw_json: JSON.stringify(item),
      })))
    } catch {}
  }

  saveFundamentals(
    ctx: ToolContext,
    code: string,
    rows: Array<Record<string, unknown>>,
    toNumOrNull: (value: unknown) => number | null,
  ): void {
    if (rows.length === 0) return
    try {
      getLocalStore(ctx).saveFundamental(rows.map((row) => ({
        code,
        report_date: String(row.REPORT_DATE ?? '').slice(0, 10),
        revenue: toNumOrNull(row.TOTALOPERATEREVE),
        revenue_yoy: toNumOrNull(row.TOTALOPERATEREVETZ),
        net_profit: toNumOrNull(row.PARENTNETPROFIT),
        profit_yoy: toNumOrNull(row.PARENTNETPROFITTZ),
        gross_margin: toNumOrNull(row.XSMLL),
        net_margin: toNumOrNull(row.XSJLL),
        roe: toNumOrNull(row.ROEJQ),
        debt_ratio: toNumOrNull(row.ZCFZL),
        pe_ttm: null,
        pb: null,
        market_cap: null,
        source: 'eastmoney:earnings',
        raw_json: JSON.stringify(row),
      })))
    } catch {}
  }
}
