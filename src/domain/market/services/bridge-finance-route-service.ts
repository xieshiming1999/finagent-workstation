import type { ToolContext } from '../../../agent/tool'
import { DefaultBridgeFinanceProvider } from '../providers/bridge-finance-provider'
import { getLocalStore } from '../../../agent/tools/market-data-utils'
import { resolveStockNames } from '../../../agent/data/symbol-name-cache'
import type { QuoteSnapshotRow } from '../../../agent/data/store/data-store'
import { ingestEndpointResult } from '../../../agent/data/ingestion/registry'
import { EastmoneyMarketDataService } from './eastmoney-market-data-service'
import type { EastmoneyDataApiOptions, EastmoneyResult } from './eastmoney-market-data-service'
import { EastmoneyMarketDataPersistenceService } from './eastmoney-market-data-persistence-service'
import { FlowMarketDataService } from './flow-market-data-service'
import { FinanceNewsDataApiService } from './finance-news-data-api-service'
import { FundMarketDataFetchService } from './fund-market-data-fetch-service'
import { MarketDataResolveService } from './market-data-resolve-service'
import { TushareMarketDataService } from './tushare-market-data-service'
import { YahooMarketDataService } from './yahoo-market-data-service'
import * as indicators from '../../../agent/data/indicators'

type RouteContext = {
  basePath: string
  getConfigValue?: (key: string) => unknown
}

const readService = new MarketDataResolveService()
const flowService = new FlowMarketDataService()
const fundFetchService = new FundMarketDataFetchService()
const eastmoneyService = new EastmoneyMarketDataService()
const eastmoneyPersistence = new EastmoneyMarketDataPersistenceService()
const yahooService = new YahooMarketDataService()
const tushareService = new TushareMarketDataService()
const bridgeProvider = new DefaultBridgeFinanceProvider()
const newsService = new FinanceNewsDataApiService(bridgeProvider)

export async function routeFinanceRequest(
  path: string,
  params: Record<string, unknown>,
  routeContext: RouteContext,
): Promise<unknown> {
  const route = path.replace('/api/finance/', '')
  const ctx = buildBridgeToolContext(routeContext)

  try {
    if (route === 'quote' || route === 'eastmoney/quote') {
      const code = String(params.code ?? params.ts_code ?? '')
      if (!code) return { error: 'Missing code parameter' }
      const codes = code.includes(',') ? code.split(',').map((item) => item.trim()).filter(Boolean) : [code]
      const result = await readService.readQuotes(ctx, codes)
      if (codes.length === 1 && result.quotes.length === 0) {
        return { error: `No quote for ${codes[0]}` }
      }
      const quotes = await enrichBlankQuoteNames(ctx, result.quotes)
      return {
        data: quotes,
        cachedCount: result.cachedCount,
        freshCount: result.freshCount,
        freshSources: result.freshSources,
        provenance: result.provenance,
      }
    }

    if (route === 'index/quotes') {
      const code = String(params.code ?? params.codes ?? '')
      const codes = code
        ? code.split(',').map((value) => value.trim()).filter(Boolean)
        : ['000001', '399001', '399006']
      const result = await bridgeProvider.readIndexQuotes(codes)
      if (!result) {
        return {
          data: [],
          error: 'Market index data sources unavailable',
        }
      }
      const fetchedAt = new Date().toISOString()
      const cacheStatus = result.cacheStatus ?? 'provider-hit'
      persistIndexQuoteProviderHit(ctx, result.data, result.source, cacheStatus, fetchedAt)
      return {
        ...result,
        fetchedAt,
        cacheStatus,
        data: result.data.map((row) => ({
          ...row,
          source: row.source ?? result.source,
          fetchedAt,
          cacheStatus,
        })),
      }
    }

    if (route === 'kline' || route === 'eastmoney/kline') {
      const code = String(params.code ?? params.ts_code ?? '')
      if (!code) return { error: 'Missing code parameter' }
      const result = await readService.readKline(ctx, code, {
        period: String(params.period ?? 'daily'),
        adjust: String(params.adjust ?? 'qfq'),
        limit: Number(params.limit ?? 120),
      })
      return {
        data: result.bars,
        source: result.source,
        period: result.period,
        adjust: result.adjust,
        provenance: result.provenance,
      }
    }

    if (route === 'technical') {
      const code = String(params.code ?? params.ts_code ?? '')
      if (!code) return { error: 'Missing code parameter' }
      const limit = Math.max(30, Math.min(Number(params.limit ?? 120), 300))
      const result = await readService.readKline(ctx, code, {
        period: String(params.period ?? 'daily'),
        adjust: String(params.adjust ?? 'qfq'),
        limit,
      })
      if (result.bars.length === 0) return { error: `No K-line data for ${code}` }
      const technical = computeTechnicalSnapshot(result.bars)
      return {
        data: technical,
        source: result.source,
        period: result.period,
        adjust: result.adjust,
        provenance: result.provenance,
        asOf: technical.asOf,
        fetchedAt: new Date().toISOString(),
      }
    }

    if (route === 'flow' || route === 'eastmoney/flow') {
      const code = String(params.code ?? params.ts_code ?? '')
      if (!code) return { error: 'Missing code parameter' }
      return { data: await flowService.fetchFlow(ctx, code, Number(params.days ?? 30)) }
    }

    if (route === 'sector' || route === 'eastmoney/sector') {
      const result = await eastmoneyService.readSectorWithOptions(params, Number(params.limit ?? 50), dataApiOptions(params))
      persistProviderHit(ctx, result)
      return {
        data: result.kind === 'sector_constituents' ? result.items : result.sectors,
        kind: result.kind,
        sectorType: result.kind === 'sector_ranking' ? result.sectorType : undefined,
        sectorName: result.kind === 'sector_constituents' ? result.sectorName : undefined,
        provenance: result.provenance,
      }
    }

    if (route === 'limit_up' || route === 'eastmoney/limit_up') {
      const result = await eastmoneyService.readLimitUpWithOptions(params.date ? String(params.date) : undefined, dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, tradeDate: result.tradeDate, provenance: result.provenance }
    }

    if (route === 'limit_down' || route === 'eastmoney/limit_down') {
      const result = await eastmoneyService.readLimitDownWithOptions(params.date ? String(params.date) : undefined, dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, tradeDate: result.tradeDate, provenance: result.provenance }
    }

    if (route === 'dragon_tiger' || route === 'eastmoney/dragon_tiger') {
      const result = await eastmoneyService.readDragonTigerWithOptions(Number(params.limit ?? 50), dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, provenance: result.provenance }
    }

    if (route === 'northbound' || route === 'eastmoney/northbound') {
      const code = String(params.code ?? params.ts_code ?? '')
      const result = code.trim()
        ? await eastmoneyService.readNorthboundHoldingWithOptions(code, Number(params.limit ?? 50), dataApiOptions(params))
        : await eastmoneyService.readNorthboundFlowWithOptions(Number(params.limit ?? 50), dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, kind: result.kind, provenance: result.provenance }
    }

    if (route === 'hot_rank' || route === 'eastmoney/hot_rank') {
      const result = await eastmoneyService.readHotRankWithOptions(Number(params.limit ?? 50), dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, provenance: result.provenance }
    }

    if (route === 'flow_rank' || route === 'eastmoney/flow_rank') {
      const result = await eastmoneyService.readFlowRankWithOptions(Number(params.days ?? 1), dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, period: result.period, provenance: result.provenance }
    }

    if (route === 'unusual' || route === 'eastmoney/unusual') {
      const result = await eastmoneyService.readUnusualWithOptions(dataApiOptions(params))
      persistProviderHit(ctx, result)
      return { data: result.items, provenance: result.provenance }
    }

    if (route === 'yahoo/price') {
      const symbol = String(params.symbol ?? params.code ?? '')
      if (!symbol) return { error: 'Missing symbol' }
      const data = await yahooService.fetchQuote(ctx, symbol)
      return data ? { data } : { error: `No Yahoo data for ${symbol}` }
    }

    if (route === 'yahoo/history') {
      const symbol = String(params.symbol ?? params.code ?? '')
      if (!symbol) return { error: 'Missing symbol' }
      return { data: await yahooService.fetchHistory(ctx, symbol, String(params.range ?? '6mo')) }
    }

    if (route === 'tushare') {
      return await tushareService.fetchRows(params, ctx, '', Number(params.limit ?? 1000))
    }

    if (route === 'news' || route === 'sidecar/news') {
      return await newsService.readNewsFeed(ctx, params)
    }

    if (route === 'fund/nav') {
      const code = String(params.code ?? params.symbol ?? params.fundCode ?? '')
      if (!code) return { error: 'Missing fund code parameter' }
      const providers = params.provider ? [params.provider as never] : []
      const result = await fundFetchService.readFundNav(
        code,
        typeof params.start === 'string' ? params.start : (typeof params.startDate === 'string' ? params.startDate : undefined),
        providers,
      )
      const store = getLocalStore(ctx)
      if (!store.isReady) await store.init()
      store.saveFundNav(result.data as unknown as Array<Record<string, unknown>>)
      return {
        data: result.data,
        source: result.source,
        fetchedAt: result.fetchedAt,
        provenance: result.provenance,
      }
    }

    if (
      route.startsWith('sidecar/') ||
      route === 'index/list' ||
      route === 'margin' ||
      route === 'holders'
    ) {
      const sidecarPath = route.startsWith('sidecar/')
        ? `/${route.replace('sidecar/', '')}`
        : `/${route}`
      if (!isAllowedFetchOnlySidecarRoute(route)) {
        const message = `Unclassified sidecar finance route "${route}" is not available as normal workflow data. Add a governed interface, output-only diagnostic, or explicit unsupported classification before calling this route.`
        await recordBridgeRouteApiCall(ctx, route, sidecarPath, Date.now(), false, message)
        return { error: message }
      }
      return callFetchOnlySidecarRoute(ctx, route, sidecarPath, params)
    }

    if (route.startsWith('gotdx/')) {
      const gotdxPath = `/${route.replace('gotdx/', '')}`
      return bridgeProvider.callGotdxRoute(gotdxPath, params)
    }

    return { error: `Unknown finance route: ${route}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function computeTechnicalSnapshot(bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number }>): Record<string, unknown> {
  const normalizedBars = bars.map((bar) => ({
    ...bar,
    volume: bar.volume ?? 0,
    amount: 0,
    changePct: null,
    turnoverRate: null,
  }))
  const latest = normalizedBars[normalizedBars.length - 1]
  const macd = indicators.macd(normalizedBars)
  const boll = indicators.boll(normalizedBars)
  const kdj = indicators.kdj(normalizedBars)
  return {
    codeDate: latest.date,
    asOf: latest.date,
    close: latest.close,
    sma5: lastValue(indicators.sma(normalizedBars, 5)),
    sma10: lastValue(indicators.sma(normalizedBars, 10)),
    sma20: lastValue(indicators.sma(normalizedBars, 20)),
    sma60: lastValue(indicators.sma(normalizedBars, 60)),
    rsi14: lastValue(indicators.rsi(normalizedBars, 14)),
    macd: {
      dif: lastValue(macd.dif),
      dea: lastValue(macd.dea),
      macd: lastValue(macd.macd),
    },
    boll: {
      upper: lastValue(boll.upper),
      middle: lastValue(boll.middle),
      lower: lastValue(boll.lower),
    },
    kdj: {
      k: lastValue(kdj.k),
      d: lastValue(kdj.d),
      j: lastValue(kdj.j),
    },
  }
}

function lastValue(result: { values: Array<{ value: number | null }> }): number | null {
  for (let i = result.values.length - 1; i >= 0; i--) {
    const value = result.values[i]?.value
    if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(4))
  }
  return null
}

function persistIndexQuoteProviderHit(
  ctx: ToolContext,
  rows: Array<Record<string, unknown>>,
  source: string,
  cacheStatus: 'cache-hit' | 'provider-hit',
  fetchedAt: string,
): void {
  if (cacheStatus !== 'provider-hit' || rows.length === 0) return
  const snapshots = rows
    .map((row) => indexQuoteSnapshot(row, source, fetchedAt))
    .filter((row): row is QuoteSnapshotRow => row != null)
  if (snapshots.length === 0) return
  try {
    getLocalStore(ctx).saveQuoteSnapshots(snapshots)
  } catch {
    // Index quotes are a UI health surface. Persistence must not hide valid live data.
  }
}

function indexQuoteSnapshot(row: Record<string, unknown>, source: string, fetchedAt: string): QuoteSnapshotRow | null {
  const code = cleanString(row.code ?? row.Code)
  const price = numeric(row.price ?? row.Price ?? row.close ?? row.Close)
  if (!code || price == null || price <= 0) return null
  const rowSource = cleanString(row.source) ?? source
  const timestamp = cleanString(row.timestamp ?? row.time ?? row.tradeTime ?? row.trade_time) ?? fetchedAt
  return {
    code,
    timestamp,
    fetched_at: cleanString(row.fetchedAt ?? row.fetched_at) ?? fetchedAt,
    source: rowSource,
    name: cleanString(row.name ?? row.Name) ?? code,
    price,
    change: numeric(row.change ?? row.Change),
    change_pct: numeric(row.changePct ?? row.change_pct ?? row.ChangePct),
    open: numeric(row.open ?? row.Open),
    high: numeric(row.high ?? row.High),
    low: numeric(row.low ?? row.Low),
    prev_close: numeric(row.prevClose ?? row.prev_close ?? row.LastClose),
    volume: numeric(row.volume ?? row.Volume ?? row.Vol),
    amount: numeric(row.amount ?? row.Amount),
    raw_json: JSON.stringify(row),
  }
}

function cleanString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function numeric(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function persistProviderHit(ctx: ToolContext, result: EastmoneyResult): void {
  if (result.provenance?.cacheStatus === 'cache-hit') return
  eastmoneyPersistence.persist(ctx, result)
}

function dataApiOptions(params: Record<string, unknown>): EastmoneyDataApiOptions {
  const cacheMode = String(params.cacheMode ?? '').trim()
  const providerMode = String(params.providerMode ?? '').trim()
  return {
    provider: params.provider == null ? undefined : String(params.provider),
    providerMode: providerMode === 'auto' || providerMode === 'preferred' || providerMode === 'strict'
      ? providerMode
      : undefined,
    cacheMode: cacheMode === 'cache-first' || cacheMode === 'live-only' || cacheMode === 'cache-only'
      ? cacheMode
      : undefined,
    skipCache: params.skipCache === true,
    allowFallback: typeof params.allowFallback === 'boolean' ? params.allowFallback : undefined,
    allowDegraded: typeof params.allowDegraded === 'boolean' ? params.allowDegraded : undefined,
  }
}

async function callFetchOnlySidecarRoute(
  ctx: ToolContext,
  route: string,
  sidecarPath: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const startedAt = Date.now()
  try {
    const result = await bridgeProvider.callSidecarRoute(sidecarPath, params)
    const error = resultError(result)
    if (!error) await persistSidecarProviderHit(ctx, route, result, params)
    await recordBridgeRouteApiCall(ctx, route, sidecarPath, startedAt, !error, error)
    return result
  } catch (error) {
    await recordBridgeRouteApiCall(ctx, route, sidecarPath, startedAt, false, error)
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function persistSidecarProviderHit(
  ctx: ToolContext,
  route: string,
  payload: unknown,
  params: Record<string, unknown>,
): Promise<void> {
  const normalized = route.startsWith('sidecar/') ? route.replace('sidecar/', '') : route
  if (normalized !== 'margin') return
  try {
    const store = getLocalStore(ctx)
    if (!store.isReady) await store.init()
    ingestEndpointResult(store, {
      provider: 'akshare',
      endpoint: 'margin',
      payload,
      params,
      code: String(params.code ?? params.symbol ?? ''),
      source: 'akshare',
      request: { action: normalized, params },
    })
  } catch {
    // Bridge routes must still return valid live data if persistence has a local-store issue.
  }
}

function resultError(result: unknown): unknown {
  if (!result || typeof result !== 'object') return null
  const error = (result as { error?: unknown }).error
  return error == null || error === '' ? null : error
}

async function recordBridgeRouteApiCall(
  ctx: ToolContext,
  route: string,
  endpoint: string,
  startedAt: number,
  success: boolean,
  error?: unknown,
): Promise<void> {
  try {
    const store = getLocalStore(ctx)
    if (!store.isReady) await store.init()
    const surface = bridgeProviderSurface(route, endpoint)
    store.saveApiCall({
      source: surface.provider,
      provider: surface.provider,
      interface_id: surface.surfaceId,
      capability_id: surface.capabilityId ?? surface.surfaceId,
      tool: 'BridgeIPC',
      action: route,
      endpoint,
      status: success ? 200 : 0,
      success,
      duration_ms: Date.now() - startedAt,
      error: error == null ? null : error instanceof Error ? error.message : String(error),
    })
  } catch {}
}

function bridgeProviderSurface(
  route: string,
  endpoint: string,
): { provider: string; surfaceId: string; capabilityId?: string } {
  const normalized = route.startsWith('sidecar/')
    ? route.replace('sidecar/', '')
    : endpoint.replace(/^\//, '')
  const known: Record<string, { provider: string; surfaceId: string; capabilityId?: string }> = {
    'index/list': { provider: 'akshare', surfaceId: 'provider.akshare.index_list' },
    news: { provider: 'akshare', surfaceId: 'news.finance_feed', capabilityId: 'akshare.news.finance_feed' },
    margin: { provider: 'akshare', surfaceId: 'market.margin_trading', capabilityId: 'akshare.market.margin_trading' },
    holders: { provider: 'akshare', surfaceId: 'provider.akshare.holders' },
  }
  return known[normalized] ?? {
    provider: 'sidecar',
    surfaceId: `provider.sidecar.${normalized.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`,
  }
}

function isAllowedFetchOnlySidecarRoute(route: string): boolean {
  const normalized = route.startsWith('sidecar/') ? route.replace('sidecar/', '') : route
  return normalized === 'index/list' || normalized === 'margin' || normalized === 'holders'
}

async function enrichBlankQuoteNames<T extends { code: string; name?: string }>(
  ctx: ToolContext,
  quotes: T[],
): Promise<T[]> {
  const missing = quotes
    .filter((quote) => !quote.name || quote.name === quote.code)
    .map((quote) => quote.code)
  if (missing.length === 0) return quotes
  const names = await resolveStockNames(missing, getLocalStore(ctx))
  if (names.size === 0) return quotes
  return quotes.map((quote) => {
    if (quote.name && quote.name !== quote.code) return quote
    const name = names.get(cleanCode(quote.code))
    return name ? { ...quote, name } : quote
  })
}

function cleanCode(code: string): string {
  return String(code ?? '').replace(/^S[HZ]/i, '').replace(/^\d\./, '')
}

function buildBridgeToolContext(routeContext: RouteContext): ToolContext {
  const basePath = routeContext.basePath
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: `${basePath}/memory`,
    bundleDir: `${basePath}/bundle`,
    projectLocalDir: `${process.cwd()}/.finagent-workstation`,
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set<string>(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: null as never,
    teamRegistry: null as never,
    getConfigValue: routeContext.getConfigValue,
  }
}
