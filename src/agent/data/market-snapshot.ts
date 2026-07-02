import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fetchQuoteBatch } from './fetchers/fetcher-quote'
import { fetchSectorRanking } from './fetchers/fetcher-sector'
import { fetchLimitDownPool, fetchLimitUpPool } from './fetchers/fetcher-limit-pool'
import { fetchNorthbound } from './fetchers/fetcher-northbound'
import { runDataApiInterfaceRoute } from './data-api-interface-router'
import { readHotRankRows } from './data-api-interface-cache'
import * as adv from './eastmoney-advanced'
import type { HotRankItem } from './eastmoney-advanced'
import type { DataStore } from './store/data-store'
import { isChineseRuntime } from '../runtime-language'
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from '../../domain/market/analysis/analysis-evidence-contract'

const TRANSPORT_BACKOFF_MS = 15 * 60_000
const snapshotFetchBackoff = new Map<string, { until: number; reason: string }>()
type HotStockQuote = {
  price: number | null
  changePct: number | null
  source: string | null
  timestamp: string | null
  fetchedAt: string | null
  cacheStatus: 'cache' | 'fresh'
}

export type SnapshotLeaderCategory = 'industry' | 'concept' | 'area' | 'derivative' | 'ipo' | 'unknown'
export type SnapshotInstrumentType = 'sector' | 'option' | 'ipo' | 'unknown'

export interface SnapshotLeaderItem {
  code: string
  name: string
  displayName: string
  changePct: number
  category: SnapshotLeaderCategory
  instrumentType: SnapshotInstrumentType
  explanation?: string
  isFiltered: boolean
}

export interface MarketSnapshot {
  timestamp: string
  indices: Array<{ code: string; name: string; price: number; changePct: number }>
  topGainers: Array<{ code: string; name: string; changePct: number }>
  topLosers: Array<{ code: string; name: string; changePct: number }>
  limitUpCount: number
  limitDownCount: number
  northboundNet: number
  hotStocks: Array<{
    code: string
    name: string
    rank: number
    rankChange: number | null
    hotValue: number | null
    price: number | null
    changePct: number | null
    source?: string | null
    timestamp?: string | null
    fetchedAt?: string | null
    cacheStatus?: 'cache' | 'fresh'
  }>
  sectorLeaders: SnapshotLeaderItem[]
  nonSectorMovers: SnapshotLeaderItem[]
  failedSources: string[]
  regime: 'bullish' | 'bearish' | 'neutral'
  regimeReason: string
  analysisEvidence?: AnalysisEvidencePackage
}

export async function buildMarketSnapshot(tradingDate?: string, dataStore?: DataStore | null): Promise<MarketSnapshot> {
  const chinese = isChineseRuntime()
  const failures: string[] = []
  const sectorResult = await safeFetch('sector-ranking', () => fetchSectorRanking('industry'), failures)
  const limitUpResult = await safeFetch('limit-up-pool', () => fetchLimitUpPool(tradingDate), failures)
  const limitDownResult = await safeFetch('limit-down-pool', () => fetchLimitDownPool(tradingDate), failures)
  const northboundResult = await safeFetch('northbound-flow', () => fetchNorthbound(50), failures)
  const hotRankData = await safeFetch('hot-rank', () => fetchHotRankViaInterface(10, dataStore), failures) ?? []
  const limitUpData = limitUpResult?.data ?? []
  const limitDownData = limitDownResult?.data ?? []
  const northboundData = northboundResult?.data ?? []
  if (dataStore?.isReady && sectorResult?.provenance?.cacheStatus === 'provider-hit') dataStore.saveSectorRanking(today(), 'industry', records(sectorResult.data))
  if (dataStore?.isReady && limitUpResult?.provenance?.cacheStatus === 'provider-hit') dataStore.saveLimitPool(records(limitUpData))
  if (dataStore?.isReady && limitDownResult?.provenance?.cacheStatus === 'provider-hit') dataStore.saveLimitPool(records(limitDownData))
  if (dataStore?.isReady && northboundResult?.provenance?.cacheStatus === 'provider-hit') dataStore.saveNorthboundFlow(records(northboundData))
  const hotQuotes = await safeFetch('hot-stock-quotes', () => loadHotStockQuotes(hotRankData.map((h) => h.code), dataStore), failures) ?? new Map()

  const rawSectorData = sectorResult?.data.map((s) => ({
    code: s.code,
    name: s.name,
    changePct: s.change_pct,
  })) ?? []
  const classifiedLeaders = rawSectorData.map((row) => classifySnapshotLeader(row.code, row.name, row.changePct))
  const sectorData = classifiedLeaders.filter((row) => !row.isFiltered)
  const nonSectorMovers = classifiedLeaders.filter((row) => row.isFiltered && row.category !== 'unknown')

  const upSectors = sectorData.filter((s) => s.changePct > 0).length
  const downSectors = sectorData.filter((s) => s.changePct < 0).length
  const northboundNet = northboundData.reduce((s, n) => s + (n.net_buy ?? 0), 0)

  let regime: 'bullish' | 'bearish' | 'neutral' = 'neutral'
  let regimeReason = ''

  if (upSectors > downSectors * 2 && limitUpData.length > limitDownData.length * 3) {
    regime = 'bullish'
    regimeReason = chinese
      ? `${upSectors} 个板块上涨，${downSectors} 个下跌；涨停 ${limitUpData.length} 家，跌停 ${limitDownData.length} 家`
      : `${upSectors} sectors up vs ${downSectors} down, ${limitUpData.length} limit-up vs ${limitDownData.length} limit-down`
  } else if (downSectors > upSectors * 2 && limitDownData.length > limitUpData.length * 2) {
    regime = 'bearish'
    regimeReason = chinese
      ? `${downSectors} 个板块下跌，${upSectors} 个上涨；跌停 ${limitDownData.length} 家`
      : `${downSectors} sectors down vs ${upSectors} up, ${limitDownData.length} limit-down`
  } else {
    regimeReason = chinese
      ? `分化：上涨板块 ${upSectors} 个，下跌板块 ${downSectors} 个`
      : `Mixed: ${upSectors} up / ${downSectors} down sectors`
  }

  if (northboundNet > 5e8) {
    regimeReason += chinese
      ? `，北向净流入 ${(northboundNet / 1e8).toFixed(1)} 亿`
      : `, northbound net inflow ${(northboundNet / 1e8).toFixed(1)}e`
  } else if (northboundNet < -5e8) {
    regimeReason += chinese
      ? `，北向净流出 ${(Math.abs(northboundNet) / 1e8).toFixed(1)} 亿`
      : `, northbound net outflow ${(Math.abs(northboundNet) / 1e8).toFixed(1)}e`
  }

  const snapshot: Omit<MarketSnapshot, 'analysisEvidence'> = {
    timestamp: new Date().toISOString(),
    indices: [],
    topGainers: sectorData.slice(0, 5).map((s) => ({ code: s.code, name: s.name, changePct: s.changePct })),
    topLosers: sectorData.slice(-5).reverse().map((s) => ({ code: s.code, name: s.name, changePct: s.changePct })),
    limitUpCount: limitUpData.length,
    limitDownCount: limitDownData.length,
    northboundNet,
    hotStocks: hotRankData.map((h) => ({
      code: h.code,
      name: h.name,
      rank: h.rank,
      rankChange: h.rankChange,
      hotValue: h.hotValue,
      price: hotQuotes.get(h.code)?.price ?? null,
      changePct: hotQuotes.get(h.code)?.changePct ?? null,
      source: hotQuotes.get(h.code)?.source ?? null,
      timestamp: hotQuotes.get(h.code)?.timestamp ?? null,
      fetchedAt: hotQuotes.get(h.code)?.fetchedAt ?? null,
      cacheStatus: hotQuotes.get(h.code)?.cacheStatus,
    })),
    sectorLeaders: sectorData.slice(0, 10),
    nonSectorMovers: nonSectorMovers.slice(0, 10),
    failedSources: failures,
    regime,
    regimeReason,
  }
  return {
    ...snapshot,
    analysisEvidence: buildMarketSnapshotAnalysisEvidence(snapshot),
  }
}

export function buildMarketSnapshotAnalysisEvidence(snapshot: Omit<MarketSnapshot, 'analysisEvidence'>): AnalysisEvidencePackage {
  const missingEvidence = [
    ...(snapshot.sectorLeaders.length === 0 ? ['sector_leaders'] : []),
    ...(snapshot.hotStocks.length === 0 ? ['hot_rank'] : []),
    ...(snapshot.northboundNet === 0 ? ['northbound_flow_direction'] : []),
    ...snapshot.failedSources.map((source) => `failed_source:${source}`),
    'news_context',
    'strategy_validation',
  ]
  const coverageStatus = snapshot.failedSources.length === 0 && snapshot.sectorLeaders.length > 0
    ? 'sufficient_for_analysis'
    : 'partial'
  return createAnalysisEvidencePackage({
    kind: 'market_analysis',
    subject: { type: 'market', id: 'cn-a-share-market', name: 'A-share market snapshot' },
    observedFacts: [
      `timestamp=${snapshot.timestamp}`,
      `regime=${snapshot.regime}`,
      `limitUp=${snapshot.limitUpCount}`,
      `limitDown=${snapshot.limitDownCount}`,
      `northboundNet=${snapshot.northboundNet}`,
      `sectorLeaders=${snapshot.sectorLeaders.length}`,
      `hotStocks=${snapshot.hotStocks.length}`,
      `failedSources=${snapshot.failedSources.length}`,
    ],
    interpretations: [
      `market_regime:${snapshot.regime}`,
      `regime_reason:${snapshot.regimeReason}`,
    ],
    missingEvidence,
    confidence: coverageStatus === 'sufficient_for_analysis' ? 'medium' : 'low',
    strategyReadiness: 'analysis_only',
    sourceCoverage: {
      sources: ['market_snapshot', 'sector_rank', 'limit_pool', 'northbound_flow', 'hot_rank'],
      interfaceId: 'market.overview',
      capabilityId: 'electron.market_snapshot.aggregate',
      canonicalSchema: 'market_snapshot',
      readbackAction: 'loadLatestSnapshot',
      sourceDataTime: snapshot.timestamp.slice(0, 10),
      fetchedAt: snapshot.timestamp,
      cacheStatus: 'snapshot',
      coverageStatus,
    },
  })
}

async function fetchHotRankViaInterface(limit: number, dataStore?: DataStore | null): Promise<HotRankItem[]> {
  const routed = await runDataApiInterfaceRoute(
    'market.hot_rank',
    (capability) => {
      if (capability.provider !== 'eastmoney') return null
      return {
        capability,
        source: 'eastmoney',
        run: () => adv.fetchHotRank(limit, adv.backgroundAkshareOptions(), dataStore),
      }
    },
    {
      label: 'hot rank',
      cacheMode: 'cache-first',
      readCache: () => {
        const rows = readHotRankRows({ limit, minRows: 1 })
        return rows.length > 0 ? rows : null
      },
    },
  )
  if (dataStore?.isReady && routed.cacheStatus === 'provider-hit' && routed.data.length > 0) {
    dataStore.saveHotRank(routed.data.map((item) => ({
      date: today(),
      code: item.code,
      name: item.name,
      rank: item.rank,
      heat: item.hotValue,
      rank_change: item.rankChange,
      source: routed.provider,
    })))
  }
  return routed.data
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function records<T extends object>(rows: T[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...row }) as Record<string, unknown>)
}

async function loadHotStockQuotes(codes: string[], dataStore?: DataStore | null): Promise<Map<string, HotStockQuote>> {
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)))
  const quotes = new Map<string, HotStockQuote>()
  const missing: string[] = []
  for (const code of uniqueCodes) {
    const cached = dataStore?.isReady ? dataStore.getRecentQuoteSnapshot(code, 5 * 60_000) : null
    if (cached?.price != null) {
      quotes.set(code, {
        price: cached.price,
        changePct: cached.change_pct ?? null,
        source: cached.source ?? null,
        timestamp: cached.timestamp ?? null,
        fetchedAt: cached.fetched_at ?? null,
        cacheStatus: 'cache',
      })
    } else {
      missing.push(code)
    }
  }
  if (missing.length === 0) return quotes

  const fetched = await fetchQuoteBatch(missing)
  if (dataStore?.isReady && fetched.data.length > 0) {
    dataStore.saveQuoteSnapshots(fetched.data.map((quote) => ({
      code: quote.code,
      timestamp: fetched.fetchedAt,
      source: fetched.source,
      name: quote.name,
      price: quote.price,
      change: quote.change,
      change_pct: quote.changePct,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      prev_close: quote.prevClose,
      volume: quote.volume,
      amount: quote.amount,
      pe: quote.pe,
      pb: quote.pb,
      market_cap: quote.marketCap,
      turnover_rate: quote.turnoverRate,
      raw_json: JSON.stringify(quote),
    })))
  }
  for (const quote of fetched.data) {
    quotes.set(quote.code, {
      price: quote.price,
      changePct: quote.changePct,
      source: fetched.source,
      timestamp: fetched.fetchedAt,
      fetchedAt: fetched.fetchedAt,
      cacheStatus: 'fresh',
    })
  }
  return quotes
}

async function safeFetch<T>(label: string, fn: () => Promise<T>, failures: string[]): Promise<T | null> {
  const backoff = snapshotFetchBackoff.get(label)
  if (backoff) {
    if (Date.now() < backoff.until) {
      failures.push(`${label}: skipped after recent transport failure (${backoff.reason})`)
      return null
    }
    snapshotFetchBackoff.delete(label)
  }

  try {
    const result = await fn()
    snapshotFetchBackoff.delete(label)
    return result
  } catch (error) {
    const message = shortError(error)
    failures.push(`${label}: ${message}`)
    if (isTransportError(error)) {
      snapshotFetchBackoff.set(label, { until: Date.now() + TRANSPORT_BACKOFF_MS, reason: message })
    }
    return null
  }
}

export function saveSnapshot(basePath: string, snapshot: MarketSnapshot): void {
  const dir = join(basePath, 'snapshots')
  mkdirSync(dir, { recursive: true })
  const date = snapshot.timestamp.split('T')[0]
  writeFileSync(join(dir, `${date}.json`), JSON.stringify(snapshot, null, 2), 'utf-8')
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(snapshot, null, 2), 'utf-8')
}

export function loadLatestSnapshot(basePath: string): MarketSnapshot | null {
  const filePath = join(basePath, 'snapshots/latest.json')
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function formatSnapshot(s: MarketSnapshot): string {
  const chinese = isChineseRuntime()
  const lines = [
    chinese ? `市场快照 (${s.timestamp.split('T')[0]})` : `Market Snapshot (${s.timestamp.split('T')[0]})`,
    chinese ? `情绪: ${regimeLabel(s.regime)} - ${s.regimeReason}` : `Regime: ${regimeLabel(s.regime)} - ${s.regimeReason}`,
    chinese ? `涨停: ${s.limitUpCount}  跌停: ${s.limitDownCount}` : `Limit up: ${s.limitUpCount}  Limit down: ${s.limitDownCount}`,
    '',
    chinese ? '领涨板块:' : 'Top Sectors:',
    ...s.sectorLeaders.map((sl) => `  ${sl.displayName}: ${sl.changePct >= 0 ? '+' : ''}${sl.changePct.toFixed(2)}%`),
    '',
    ...(s.failedSources.length > 0 ? [chinese ? '数据告警:' : 'Data warnings:', ...s.failedSources.map((source) => `  ${source}`), ''] : []),
    ...(s.nonSectorMovers.length > 0
      ? [
          chinese ? '其他异动品种:' : 'Non-sector movers:',
          ...s.nonSectorMovers.map((sl) => `  ${sl.displayName}: ${sl.changePct >= 0 ? '+' : ''}${sl.changePct.toFixed(2)}%${sl.explanation ? ` (${sl.explanation})` : ''}`),
          '',
        ]
      : []),
    chinese ? '热门个股:' : 'Hot stocks:',
    ...s.hotStocks.map((h) => `  #${h.rank} ${h.name} (${h.code}) ${formatHotQuote(h.price, h.changePct)} ${chinese ? '热度' : 'Heat'}:${formatHotValue(h.hotValue)} ${chinese ? '排名变化' : 'Rank change'}:${formatRankChange(h.rankChange)}`),
  ]
  return lines.join('\n')
}

export function classifySnapshotLeader(code: string, name: string, changePct: number): SnapshotLeaderItem {
  const chinese = isChineseRuntime()
  const trimmed = name.trim()
  const normalizedCode = code.trim()
  const option = parseOptionLikeName(trimmed)
  if (option) {
    return {
      code,
      name: trimmed,
      displayName: option.displayName,
      changePct,
      category: 'derivative',
      instrumentType: 'option',
      explanation: chinese
        ? `${option.optionType} | ${option.expiryLabel}到期 | 行权价 ${option.strike}`
        : `${option.optionType} | expires ${option.expiryLabel} | strike ${option.strike}`,
      isFiltered: true,
    }
  }

  if (/^N[\u4e00-\u9fa5A-Za-z0-9]+$/.test(trimmed)) {
    return {
      code,
      name: trimmed,
      displayName: trimmed,
      changePct,
      category: 'ipo',
      instrumentType: 'ipo',
      explanation: chinese ? '新股 / 次新股风格标的' : 'IPO / recent-listing style instrument',
      isFiltered: true,
    }
  }

  if (!/^BK\d{4,}$/i.test(normalizedCode)) {
    return {
      code,
      name: trimmed,
      displayName: trimmed,
      changePct,
      category: 'unknown',
      instrumentType: 'unknown',
      explanation: chinese ? '非板块代码，已从领涨板块中过滤' : 'Non-sector code filtered out of top sectors',
      isFiltered: true,
    }
  }

  return {
    code,
    name: trimmed,
    displayName: trimmed,
    changePct,
    category: 'industry',
    instrumentType: 'sector',
    isFiltered: false,
  }
}

function parseOptionLikeName(
  name: string,
): { displayName: string; optionType: string; expiryLabel: string; strike: string } | null {
  const chinese = isChineseRuntime()
  const match = name.match(/^(.*?)(沽|购)(\d{1,2})月(\d+)\s*$/)
  if (!match) return null
  const [, underlying, side, month, strike] = match
  const base = underlying.trim().replace(/^科创板/, '').replace(/板$/, '')
  return {
    displayName: chinese
      ? `${base} ${side === '沽' ? '沽权' : '购权'} ${strike}`
      : `${base} ${side === '沽' ? 'Put' : 'Call'} ${strike}`,
    optionType: chinese ? (side === '沽' ? '期权沽' : '期权购') : (side === '沽' ? 'put option' : 'call option'),
    expiryLabel: chinese ? `${month}月` : `month ${month}`,
    strike,
  }
}

function regimeLabel(regime: MarketSnapshot['regime']): string {
  const chinese = isChineseRuntime()
  switch (regime) {
    case 'bullish':
      return chinese ? '强势' : 'Bullish'
    case 'bearish':
      return chinese ? '弱势' : 'Bearish'
    default:
      return chinese ? '震荡' : 'Neutral'
  }
}

function formatHotValue(value: number | null): string {
  const chinese = isChineseRuntime()
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-'
  if (value >= 1e8) return chinese ? `${(value / 1e8).toFixed(1)}亿` : `${(value / 1e8).toFixed(1)}e8`
  if (value >= 1e4) return chinese ? `${(value / 1e4).toFixed(1)}万` : `${(value / 1e4).toFixed(1)}e4`
  return `${Math.round(value)}`
}

function formatRankChange(value: number | null): string {
  const chinese = isChineseRuntime()
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (value === 0) return chinese ? '持平' : 'flat'
  return value > 0
    ? chinese ? `上升${value}` : `up ${value}`
    : chinese ? `下降${Math.abs(value)}` : `down ${Math.abs(value)}`
}

function formatHotQuote(price: number | null, changePct: number | null): string {
  const priceText = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price.toFixed(price >= 100 ? 2 : 3).replace(/\.?0+$/, '') : '-'
  const changeText = typeof changePct === 'number' && Number.isFinite(changePct) ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '-'
  return `${priceText} ${changeText}`
}

function shortError(error: unknown): string {
  const text = errorToText(error)
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function isTransportError(error: unknown): boolean {
  return /fetch failed|UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|RemoteDisconnected|Empty reply from server/i.test(errorToText(error))
}

function errorToText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as Error & { cause?: unknown }).cause
  if (!cause) return error.message
  if (cause instanceof Error) return `${error.message}: ${cause.message}`
  try {
    return `${error.message}: ${JSON.stringify(cause)}`
  } catch {
    return error.message
  }
}
