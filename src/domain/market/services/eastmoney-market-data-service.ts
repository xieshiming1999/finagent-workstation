import { flowRankPeriod, today } from '../../../agent/tools/market-data-utils'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
  type DataApiInterfaceRouteResult,
} from '../../../agent/data/data-api-interface-router'
import type { DataApiProviderCapability, DataApiProviderMode } from '../../../agent/data/data-api-interface-contract'
import {
  readDragonTigerRows,
  readFlowRankRows,
  readHotRankRows,
  readLimitPoolRows,
  readNorthboundFlowRows,
  readNorthboundHoldingRows,
  readSectorConstituentRows,
  readUnusualActivityRows,
} from '../../../agent/data/data-api-interface-cache'
import {
  DefaultEastmoneyMarketProvider,
  type EastmoneyMarketProvider,
} from '../providers/eastmoney-market-provider'
import type * as adv from '../../../agent/data/eastmoney-advanced'
import type * as dm from '../../../agent/data/data-manager'
import type { FetchProvenance } from '../../../agent/data/fetchers/base-fetcher'
import type { LimitItem } from '../../../agent/data/fetchers/fetcher-limit-pool'
import type { NorthboundRow } from '../../../agent/data/fetchers/fetcher-northbound'
import { fetchSectorRanking, type SectorRow } from '../../../agent/data/fetchers/fetcher-sector'
import { getGotdxUrl } from '../../../main/sidecar'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../../../agent/data/provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'
const BACKGROUND_TIMEOUT_MS = EASTMONEY_RUNTIME_TIMEOUT_MS
const TDX_RUNTIME_TIMEOUT_MS = 30_000

export type EastmoneyResult = (
  | { kind: 'sector_constituents'; sectorName: string; items: dm.Quote[] }
  | { kind: 'sector_ranking'; sectorType: 'industry' | 'concept' | 'area'; sectors: dm.SectorItem[] }
  | { kind: 'limit_up'; tradeDate: string; items: adv.LimitUpItem[] }
  | { kind: 'limit_down'; tradeDate: string; items: adv.LimitDownItem[] }
  | { kind: 'dragon_tiger'; items: adv.DragonTigerItem[] }
  | { kind: 'northbound_holding'; code: string; items: adv.NorthboundHoldingItem[] }
  | { kind: 'northbound_flow'; items: adv.NorthboundFlowItem[] }
  | { kind: 'hot_rank'; items: adv.HotRankItem[] }
  | { kind: 'flow_rank'; period: string; items: adv.FlowRankItem[] }
  | { kind: 'unusual'; items: adv.UnusualActivityItem[] }
  | { kind: 'chip'; code: string; items: Array<Record<string, unknown>> }
  | { kind: 'etf'; items: Array<Record<string, unknown>> }
  | { kind: 'earnings'; code: string; rows: Array<Record<string, unknown>> }
) & { provenance?: FetchProvenance }

export interface EastmoneyDataApiOptions {
  provider?: string
  providerMode?: DataApiProviderMode
  cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
  skipCache?: boolean
  allowFallback?: boolean
  allowDegraded?: boolean
}

type SectorConstituentsResult = Extract<EastmoneyResult, { kind: 'sector_constituents' }>
type SectorRankingResult = Extract<EastmoneyResult, { kind: 'sector_ranking' }>
type LimitUpResult = Extract<EastmoneyResult, { kind: 'limit_up' }>
type LimitDownResult = Extract<EastmoneyResult, { kind: 'limit_down' }>
type DragonTigerResult = Extract<EastmoneyResult, { kind: 'dragon_tiger' }>
type NorthboundResult = Extract<EastmoneyResult, { kind: 'northbound_holding' | 'northbound_flow' }>
type HotRankResult = Extract<EastmoneyResult, { kind: 'hot_rank' }>
type FlowRankResult = Extract<EastmoneyResult, { kind: 'flow_rank' }>
type UnusualResult = Extract<EastmoneyResult, { kind: 'unusual' }>
type ChipResult = Extract<EastmoneyResult, { kind: 'chip' }>
type EtfResult = Extract<EastmoneyResult, { kind: 'etf' }>
type EarningsResult = Extract<EastmoneyResult, { kind: 'earnings' }>

export class EastmoneyMarketDataService {
  constructor(private readonly provider: EastmoneyMarketProvider = new DefaultEastmoneyMarketProvider()) {}

  async readSector(
    input: Record<string, unknown>,
    limit: number,
  ): Promise<SectorConstituentsResult | SectorRankingResult> {
    return this.readSectorWithOptions(input, limit)
  }

  async readSectorWithOptions(
    input: Record<string, unknown>,
    limit: number,
    opts: EastmoneyDataApiOptions = {},
  ): Promise<SectorConstituentsResult | SectorRankingResult> {
    const sectorCode = String(input.sectorCode ?? input.boardCode ?? '').trim()
    const sectorType = String(input.type ?? input.boardType ?? 'industry') as 'industry' | 'concept' | 'area'
    if (sectorCode) {
      const sectorName = String(input.sectorName ?? input.boardName ?? sectorCode).trim()
      const interfaceId = sectorType === 'concept' ? 'market.board_members' : 'market.sector_constituents'
      const routed = await runDataApiInterfaceRoute(
        interfaceId,
        (capability) => this.sectorConstituentRoute(capability, { code: sectorCode, name: sectorName }, sectorType, limit),
        {
          label: interfaceId === 'market.board_members' ? 'board members' : 'sector constituents',
          cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
          provider: opts.provider,
          providerMode: opts.providerMode,
          allowFallback: opts.allowFallback,
          allowDegraded: opts.allowDegraded,
          readCache: () => {
            const rows = readSectorConstituentRows(sectorName === sectorCode ? '' : sectorName, { limit, minRows: 1 })
            return rows.length > 0 ? { kind: 'sector_constituents' as const, sectorName, items: rows } : null
          },
        },
      )
      return withRouteProvenance(routed, 'industry_map')
    }
    const result = await fetchSectorRanking(sectorType === 'concept' ? 'concept' : 'industry', {
      interfaceId: sectorType === 'concept' ? 'market.board_ranking' : 'market.sector_ranking',
      provider: opts.provider,
      providerMode: opts.providerMode,
      cacheMode: opts.skipCache ? 'live-only' : opts.cacheMode,
      allowFallback: opts.allowFallback,
      allowDegraded: opts.allowDegraded,
      skipCache: opts.skipCache,
    })
    return {
      kind: 'sector_ranking',
      sectorType,
      sectors: result.data.slice(0, limit).map(sectorRowToItem),
      provenance: result.provenance,
    }
  }

  async readLimitUp(date?: string): Promise<LimitUpResult> {
    return this.readLimitUpWithOptions(date)
  }

  async readLimitDown(date?: string): Promise<LimitDownResult> {
    return this.readLimitDownWithOptions(date)
  }

  async readDragonTiger(limit: number): Promise<DragonTigerResult> {
    return this.readDragonTigerWithOptions(limit)
  }

  async readNorthbound(code: string, limit: number): Promise<NorthboundResult> {
    if (code.trim()) {
      return this.readNorthboundHoldingWithOptions(code.trim(), limit)
    }
    return this.readNorthboundFlowWithOptions(limit)
  }

  async readLimitUpWithOptions(date?: string, opts: EastmoneyDataApiOptions = {}): Promise<LimitUpResult> {
    const tradeDate = date ?? today()
    const routed = await runDataApiInterfaceRoute(
      'market.limit_pool',
      (capability) => this.marketEventRoute(capability, () => this.provider.readLimitUp(date).then((items) => ({ kind: 'limit_up' as const, tradeDate, items }))),
      {
        label: 'limit-up pool',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readLimitPoolRows('up', { date, minRows: 1 })
          return rows.length > 0 ? { kind: 'limit_up' as const, tradeDate, items: rows.map(limitPoolToLimitUp) } : null
        },
      },
    )
    return withRouteProvenance(routed, 'limit_pool')
  }

  async readLimitDownWithOptions(date?: string, opts: EastmoneyDataApiOptions = {}): Promise<LimitDownResult> {
    const tradeDate = date ?? today()
    const routed = await runDataApiInterfaceRoute(
      'market.limit_pool',
      (capability) => this.marketEventRoute(capability, () => this.provider.readLimitDown(date).then((items) => ({ kind: 'limit_down' as const, tradeDate, items }))),
      {
        label: 'limit-down pool',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readLimitPoolRows('down', { date, minRows: 1 })
          return rows.length > 0 ? { kind: 'limit_down' as const, tradeDate, items: rows.map(limitPoolToLimitDown) } : null
        },
      },
    )
    return withRouteProvenance(routed, 'limit_pool')
  }

  async readNorthboundFlowWithOptions(limit: number, opts: EastmoneyDataApiOptions = {}): Promise<Extract<EastmoneyResult, { kind: 'northbound_flow' }>> {
    const routed = await runDataApiInterfaceRoute(
      'market.northbound_flow',
      (capability) => this.marketEventRoute(capability, () => this.provider.readNorthboundFlow(limit).then((items) => ({ kind: 'northbound_flow' as const, items }))),
      {
        label: 'northbound flow',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readNorthboundFlowRows({ minRows: 1, limit })
          return rows.length > 0 ? { kind: 'northbound_flow' as const, items: rows.map(northboundFlowToItem) } : null
        },
      },
    )
    return withRouteProvenance(routed, 'northbound_flow')
  }

  async readNorthboundHoldingWithOptions(
    code: string,
    limit: number,
    opts: EastmoneyDataApiOptions = {},
  ): Promise<Extract<EastmoneyResult, { kind: 'northbound_holding' }>> {
    const cleanCode = code.trim()
    const routed = await runDataApiInterfaceRoute(
      'market.northbound_holding',
      (capability) => this.marketEventRoute(capability, () => this.provider.readNorthboundHolding(cleanCode, limit).then((items) => ({ kind: 'northbound_holding' as const, code: cleanCode, items }))),
      {
        label: 'northbound holding',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readNorthboundHoldingRows({ code: cleanCode, limit, minRows: 1 })
          return rows.length > 0 ? { kind: 'northbound_holding' as const, code: cleanCode, items: rows } : null
        },
      },
    )
    return withRouteProvenance(routed, 'northbound_holding')
  }

  async readHotRank(limit: number): Promise<HotRankResult> {
    return this.readHotRankWithOptions(limit)
  }

  async readFlowRank(days: number): Promise<FlowRankResult> {
    const period = flowRankPeriod(days)
    return this.readFlowRankWithOptions(days, { period })
  }

  async readUnusual(): Promise<UnusualResult> {
    return this.readUnusualWithOptions()
  }

  async readDragonTigerWithOptions(limit: number, opts: EastmoneyDataApiOptions = {}): Promise<DragonTigerResult> {
    const routed = await runDataApiInterfaceRoute(
      'market.dragon_tiger',
      (capability) => this.marketEventRoute(capability, () => this.provider.readDragonTiger(limit).then((items) => ({ kind: 'dragon_tiger' as const, items }))),
      {
        label: 'dragon tiger',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readDragonTigerRows({ limit, minRows: 1 })
          return rows.length > 0 ? { kind: 'dragon_tiger' as const, items: rows } : null
        },
      },
    )
    return withRouteProvenance(routed, 'dragon_tiger')
  }

  async readHotRankWithOptions(limit: number, opts: EastmoneyDataApiOptions = {}): Promise<HotRankResult> {
    const routed = await runDataApiInterfaceRoute(
      'market.hot_rank',
      (capability) => this.hotRankRoute(capability, limit),
      {
        label: 'hot rank',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readHotRankRows({ limit, minRows: 1 })
          return rows.length > 0 ? { kind: 'hot_rank' as const, items: rows } : null
        },
      },
    )
    return withRouteProvenance(routed, 'hot_rank')
  }

  async readFlowRankWithOptions(
    days: number,
    opts: EastmoneyDataApiOptions & { period?: string } = {},
  ): Promise<FlowRankResult> {
    const period = opts.period ?? flowRankPeriod(days)
    const routed = await runDataApiInterfaceRoute(
      'market.flow_rank',
      (capability) => this.flowRankRoute(capability, days, period),
      {
        label: 'flow rank',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readFlowRankRows({ period, limit: 50, minRows: 1 })
          return rows.length > 0 ? { kind: 'flow_rank' as const, period, items: rows } : null
        },
      },
    )
    return withRouteProvenance(routed, 'flow_rank')
  }

  async readUnusualWithOptions(opts: EastmoneyDataApiOptions = {}): Promise<UnusualResult> {
    const routed = await runDataApiInterfaceRoute(
      'market.unusual_activity',
      (capability) => this.unusualRoute(capability),
      {
        label: 'unusual activity',
        cacheMode: opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first'),
        provider: opts.provider,
        providerMode: opts.providerMode,
        allowFallback: opts.allowFallback,
        allowDegraded: opts.allowDegraded,
        readCache: () => {
          const rows = readUnusualActivityRows({ limit: 50, minRows: 1 })
          return rows.length > 0 ? { kind: 'unusual' as const, items: rows } : null
        },
      },
    )
    return withRouteProvenance(routed, 'unusual_activity')
  }

  private marketEventRoute<T extends EastmoneyResult>(
    capability: DataApiProviderCapability,
    run: () => Promise<T>,
  ): DataApiInterfaceRoute<T> | null {
    if (capability.provider !== 'eastmoney') return null
    return { capability, source: 'eastmoney', run }
  }

  private sectorConstituentRoute(
    capability: DataApiProviderCapability,
    sector: { code: string; name: string },
    sectorType: 'industry' | 'concept' | 'area',
    limit: number,
  ): DataApiInterfaceRoute<SectorConstituentsResult> | null {
    if (capability.provider === 'eastmoney') {
      return {
        capability,
        source: 'eastmoney',
        run: () => this.provider.readSectorStocks(sector, sectorType, limit).then((items) => ({
          kind: 'sector_constituents' as const,
          sectorName: sector.name,
          items,
        })),
      }
    }
    if (capability.provider === 'sina') {
      return {
        capability,
        source: 'sina',
        run: () => fetchSinaSectorConstituents(sector, limit),
      }
    }
    return null
  }

  private flowRankRoute(
    capability: DataApiProviderCapability,
    days: number,
    period: string,
  ): DataApiInterfaceRoute<FlowRankResult> | null {
    if (capability.provider === 'eastmoney') {
      return {
        capability,
        source: 'eastmoney',
        run: () => this.provider.readFlowRank(days).then((items) => ({ kind: 'flow_rank' as const, period, items })),
      }
    }
    if (capability.provider === 'akshare') {
      return {
        capability,
        source: 'akshare:eastmoney',
        run: () => fetchAkshareFlowRank(days, period),
      }
    }
    return null
  }

  private hotRankRoute(
    capability: DataApiProviderCapability,
    limit: number,
  ): DataApiInterfaceRoute<HotRankResult> | null {
    if (capability.provider === 'eastmoney') {
      return {
        capability,
        source: 'eastmoney',
        run: () => this.provider.readHotRank(limit).then((items) => ({ kind: 'hot_rank' as const, items })),
      }
    }
    if (capability.provider === 'akshare') {
      return {
        capability,
        source: 'akshare:eastmoney',
        run: () => fetchAkshareHotRank(limit),
      }
    }
    return null
  }

  private unusualRoute(
    capability: DataApiProviderCapability,
  ): DataApiInterfaceRoute<UnusualResult> | null {
    if (capability.provider === 'eastmoney') {
      return {
        capability,
        source: 'eastmoney',
        run: () => this.provider.readUnusual().then((items) => ({ kind: 'unusual' as const, items })),
      }
    }
    if (capability.provider === 'tdx') {
      return {
        capability,
        source: 'tdx',
        run: () => fetchTdxUnusualActivity(),
      }
    }
    return null
  }

  async readChip(code: string): Promise<ChipResult> {
    const rows = await this.provider.readChip(code)
    return { kind: 'chip', code, items: rows }
  }

  async readEtf(limit: number): Promise<EtfResult> {
    const rows = await this.provider.readEtf(limit)
    return { kind: 'etf', items: rows }
  }

  async readEarnings(code: string): Promise<EarningsResult> {
    const rows = await this.provider.readEarnings(code)
    return { kind: 'earnings', code, rows }
  }
}

function withRouteProvenance<T extends EastmoneyResult>(
  routed: DataApiInterfaceRouteResult<T>,
  canonicalTable: string,
): T {
  return {
    ...routed.data,
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      canonicalSchema: canonicalTable,
      canonicalTable,
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
    },
  }
}

async function fetchSinaSectorConstituents(
  sector: { code: string; name: string },
  limit: number,
): Promise<SectorConstituentsResult> {
  const params = new URLSearchParams({
    page: '1',
    num: String(Math.max(1, Math.min(limit, 200))),
    sort: 'symbol',
    asc: '1',
    node: sector.code,
    symbol: '',
    _s_r_a: 'page',
  })
  const res = await fetch(`http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?${params}`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  if (!res.ok) throw new Error(`Sina sector constituents failed: ${res.status}`)
  const rows = await res.json() as Array<Record<string, unknown>>
  const items = Array.isArray(rows) ? rows.map(sinaConstituentToQuote).filter((item): item is dm.Quote => item != null) : []
  return { kind: 'sector_constituents', sectorName: sector.name || sector.code, items }
}

function sinaConstituentToQuote(row: Record<string, unknown>): dm.Quote | null {
  const code = cleanSinaSymbol(String(row.code ?? row.symbol ?? ''))
  if (!code) return null
  const price = num(row.trade)
  const prevClose = num(row.settlement)
  return {
    code,
    name: String(row.name ?? code),
    price,
    change: num(row.pricechange),
    changePct: num(row.changepercent),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    prevClose,
    volume: num(row.volume),
    amount: num(row.amount),
    pe: nullableNum(row.per),
    pb: nullableNum(row.pb),
    marketCap: nullableNum(row.mktcap),
    turnoverRate: nullableNum(row.turnoverratio),
    source: 'sina',
  }
}

function cleanSinaSymbol(value: string): string {
  return value.replace(/^(sh|sz|bj)/i, '').trim()
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function nullableNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function fetchAkshareFlowRank(days: number, period: string): Promise<FlowRankResult> {
  const indicator = flowRankIndicator(days)
  const params = new URLSearchParams({
    indicator,
    _priority: 'background',
    _provider: 'eastmoney',
  })
  const res = await fetch(`${SIDECAR}/akshare/stock_individual_fund_flow_rank?${params}`, {
    signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`AkShare flow rank failed: ${res.status}`)
  const json = await res.json() as Record<string, any>
  const rows = Array.isArray(json?.data) ? json.data : []
  const items = rows.map((row: Record<string, unknown>) => ({
    code: compactCode(row['代码'] ?? row.code ?? row['股票代码']),
    name: String(row['名称'] ?? row.name ?? ''),
    mainNetInflow: Number(row[`${indicator}主力净流入-净额`] ?? row['主力净流入-净额'] ?? row['今日主力净流入-净额'] ?? 0),
    changePct: Number(row['涨跌幅'] ?? row[`${indicator}涨跌幅`] ?? row['今日涨跌幅'] ?? 0),
  })).filter((item) => item.code)
  return { kind: 'flow_rank', period, items }
}

async function fetchAkshareHotRank(limit: number): Promise<HotRankResult> {
  const params = new URLSearchParams({
    _priority: 'background',
    _provider: 'eastmoney',
  })
  const res = await fetch(`${SIDECAR}/akshare/stock_hot_rank_em?${params}`, {
    signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`AkShare hot rank failed: ${res.status}`)
  const json = await res.json() as Record<string, any>
  const rows = Array.isArray(json?.data) ? json.data.slice(0, limit) : []
  const items = rows.map((row: Record<string, unknown>, index: number) => ({
    code: compactCode(row['代码'] ?? row.code ?? row['股票代码']),
    name: String(row['名称'] ?? row.name ?? ''),
    rank: Number(row['排名'] ?? row.rank ?? index + 1),
    rankChange: nullableNumber(row['排名变化'] ?? row['历史排名变化'] ?? row.rank_change),
    hotValue: nullableNumber(row['人气值'] ?? row.heat ?? row.hotValue),
  })).filter((item) => item.code)
  const missingNames = items.filter((item) => !item.name).map((item) => item.code)
  if (missingNames.length > 0) {
    const names = await fetchQuoteNames(missingNames)
    for (const item of items) if (!item.name) item.name = names.get(item.code) ?? ''
  }
  return { kind: 'hot_rank', items }
}

async function fetchTdxUnusualActivity(): Promise<UnusualResult> {
  const gotdxUrl = getGotdxUrl()
  if (!gotdxUrl) throw new Error('gotdx sidecar not running. TDX unusual activity unavailable.')
  const params = new URLSearchParams({
    market: '1',
    start: '0',
    count: '50',
  })
  const res = await fetch(`${gotdxUrl}/api/unusual?${params}`, {
    signal: AbortSignal.timeout(TDX_RUNTIME_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`TDX unusual activity failed: ${res.status}`)
  const payload = await res.json() as Record<string, unknown>
  const rows = Array.isArray(payload.List) ? payload.List : Array.isArray(payload.data) ? payload.data : []
  const items = rows
    .map((row) => normalizeTdxUnusualItem(row))
    .filter((item): item is adv.UnusualActivityItem => !!item)
  return { kind: 'unusual', items }
}

function normalizeTdxUnusualItem(row: unknown): adv.UnusualActivityItem | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const code = compactCode(record.code ?? record.Code)
  const time = String(record.time ?? record.Time ?? '')
  if (!code || !time) return null
  return {
    code,
    name: String(record.name ?? record.Name ?? ''),
    price: nullableNumber(record.price ?? record.Price ?? record.value ?? record.Value) ?? 0,
    changePct: nullableNumber(record.changePct ?? record.ChangePct ?? record.pct ?? record.Pct) ?? 0,
    type: String(record.eventType ?? record.event_type ?? record.unusual_type ?? record.UnusualType ?? 'tdx_unusual'),
    time,
    description: String(record.eventName ?? record.event_name ?? record.desc ?? record.Desc ?? record.description ?? record.Description ?? record.value ?? record.Value ?? ''),
  }
}

async function fetchQuoteNames(codes: string[]): Promise<Map<string, string>> {
  const secids = codes.map(eastmoneySecid).filter(Boolean)
  if (secids.length === 0) return new Map()
  const params = new URLSearchParams({
    secids: secids.join(','),
    fields: 'f12,f14',
    fltt: '2',
    invt: '2',
  })
  const res = await fetch(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?${params}`, {
    signal: AbortSignal.timeout(EASTMONEY_RUNTIME_TIMEOUT_MS),
  })
  if (!res.ok) return new Map()
  const json = await res.json() as Record<string, any>
  const rows = Array.isArray(json?.data?.diff) ? json.data.diff : []
  const pairs: Array<readonly [string, string]> = rows
    .map((row: Record<string, unknown>) => [compactCode(row.f12), String(row.f14 ?? '')] as const)
    .filter((pair: readonly [string, string]) => Boolean(pair[0] && pair[1]))
  return new Map(pairs)
}

function eastmoneySecid(value: unknown): string {
  const code = compactCode(value)
  if (!code) return ''
  return `${code.startsWith('6') ? '1' : '0'}.${code}`
}

function flowRankIndicator(days: number): string {
  if (days >= 10) return '10日'
  if (days >= 5) return '5日'
  if (days >= 3) return '3日'
  return '今日'
}

function compactCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\.(SH|SZ|BJ)$/i, '')
    .replace(/^(SH|SZ|BJ)/i, '')
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function limitPoolToLimitUp(row: LimitItem): adv.LimitUpItem {
  return {
    code: row.code,
    name: row.name,
    price: 0,
    changePct: row.change_pct,
    amount: 0,
    turnoverRate: 0,
    firstLimitTime: row.first_limit_time ?? '',
    lastLimitTime: row.last_limit_time ?? '',
    limitCount: row.open_count,
    days: row.continuous_days,
    industry: row.limit_reason ?? '',
  }
}

function limitPoolToLimitDown(row: LimitItem): adv.LimitDownItem {
  return {
    code: row.code,
    name: row.name,
    price: 0,
    changePct: row.change_pct,
    amount: 0,
    turnoverRate: 0,
    industry: row.limit_reason ?? '',
  }
}

function northboundFlowToItem(row: NorthboundRow): adv.NorthboundFlowItem {
  return {
    tradeDate: row.trade_date,
    mutualType: row.mutual_type,
    buyAmount: row.buy_amount,
    sellAmount: row.sell_amount,
    netBuy: row.net_buy,
    holdMarketCap: row.hold_market_cap,
  }
}

function sectorRowToItem(row: SectorRow): dm.SectorItem {
  return {
    code: row.code,
    name: row.name,
    changePct: row.change_pct,
    turnoverRate: row.turnover_rate,
    upCount: row.up_count,
    downCount: row.down_count,
    leadingStock: row.leading_stock,
    leadingChangePct: row.leading_pct,
  }
}
