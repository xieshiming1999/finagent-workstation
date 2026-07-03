import type { ToolContext } from '../../../agent/tool'
import { toNumOrNull } from '../../../agent/tools/market-data-utils'
import { EastmoneyMarketDataRepository } from '../repositories/eastmoney-market-data-repository'
import type { EastmoneyResult } from './eastmoney-market-data-service'

export class EastmoneyMarketDataPersistenceService {
  constructor(private readonly repository: EastmoneyMarketDataRepository = new EastmoneyMarketDataRepository()) {}

  persist(ctx: ToolContext, result: EastmoneyResult): void {
    switch (result.kind) {
      case 'sector_constituents':
        this.repository.saveSectorConstituents(ctx, result.sectorName, result.items)
        return
      case 'sector_ranking':
        this.repository.saveSectorRanking(ctx, result.sectorType, result.sectors)
        return
      case 'limit_up':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, industry: item.industry ?? null, raw: item })))
        this.repository.saveLimitPool(ctx, result.tradeDate, 'up', result.items)
        return
      case 'limit_down':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, industry: item.industry ?? null, raw: item })))
        this.repository.saveLimitPool(ctx, result.tradeDate, 'down', result.items)
        return
      case 'dragon_tiger':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, raw: item })))
        this.repository.saveDragonTiger(ctx, result.items)
        return
      case 'northbound_holding':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, raw: item })))
        this.repository.saveNorthboundHolding(ctx, result.items)
        return
      case 'northbound_flow':
        this.repository.saveNorthboundFlow(ctx, result.items)
        return
      case 'hot_rank':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, raw: item })))
        this.repository.saveHotRank(ctx, result.items, result.provenance?.source ?? result.provenance?.provider ?? 'eastmoney')
        return
      case 'flow_rank':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, raw: item })))
        this.repository.saveFlowRank(ctx, result.period, result.items, result.provenance?.source ?? result.provenance?.provider ?? 'eastmoney')
        return
      case 'unusual':
        this.repository.saveStockList(ctx, result.items.map((item) => ({ code: item.code, name: item.name, raw: item })))
        this.repository.saveUnusualActivity(ctx, result.items, result.provenance?.source ?? result.provenance?.provider ?? 'eastmoney')
        return
      case 'chip':
        this.repository.saveChipDistribution(ctx, result.code, result.items)
        return
      case 'etf':
        this.repository.saveEtfQuotes(ctx, result.items)
        return
      case 'earnings':
        this.repository.saveFundamentals(ctx, result.code, result.rows, toNumOrNull)
        return
    }
  }
}
