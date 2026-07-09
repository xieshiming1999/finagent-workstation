import { createHash } from 'crypto'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../../../agent/data/data-api-interface-router'
import type { DataApiCacheMode } from '../../../agent/data/data-api-cache-policy'
import type {
  DataApiProviderCapability,
  DataApiProviderMode,
} from '../../../agent/data/data-api-interface-contract'
import { WindMcpTool } from '../../../agent/tools/wind-mcp'
import type { ToolContext } from '../../../agent/tool'
import { getLocalStore } from '../../../agent/tools/market-data-utils'
import type { BridgeFinanceProvider } from '../providers/bridge-finance-provider'

type NewsRow = Record<string, unknown>
type WindNewsInvoker = (
  ctx: ToolContext,
  query: string,
  limit: number,
) => Promise<void>

const DEFAULT_FINANCE_NEWS_PRIORITY_QUERY = 'A股 财经 市场'

export interface FinanceNewsRouteResult {
  data: NewsRow[]
  source: string
  cacheStatus: 'cache-hit' | 'provider-hit'
  sourceHealth: {
    status: 'live' | 'cached'
    provider: string
    lastSuccessfulFetch?: string
    nextRetryPolicy: string
  }
  provenance: {
    interfaceId: string
    capabilityId: string
    provider: string
    canonicalSchema: string
    canonicalTable: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision: string
    providerMode: string
    requestedProvider?: string
    allowFallback: boolean
  }
}

export class FinanceNewsDataApiService {
  constructor(
    private readonly provider: BridgeFinanceProvider,
    private readonly invokeWind: WindNewsInvoker = callWindFinanceNews,
  ) {}

  async readNewsFeed(
    ctx: ToolContext,
    params: Record<string, unknown>,
  ): Promise<FinanceNewsRouteResult> {
    const keyword = cleanString(params.keyword ?? params.query)
    const priorityKeyword = cleanString(params.priority_query ?? params.priorityQuery)
    const fetchKeyword = keyword ?? priorityKeyword ?? DEFAULT_FINANCE_NEWS_PRIORITY_QUERY
    const readKeyword = keyword ?? ''
    const sourceFilter = cleanString(params.source)
    const limit = numeric(params.limit ?? params.max_enrich, 50)
    const routed = await runDataApiInterfaceRoute<NewsRow[]>(
      'news.finance_feed',
      (capability): DataApiInterfaceRoute<NewsRow[]> | null => {
        if (capability.provider === 'akshare') {
          return {
            capability,
            source: 'akshare',
            run: () => this.fetchAkshareNews(ctx, capability, params, fetchKeyword, readKeyword, priorityKeyword, sourceFilter, limit),
          }
        }
        if (capability.provider === 'wind') {
          return {
            capability,
            source: 'wind',
            run: () => this.fetchWindNews(ctx, capability, fetchKeyword, readKeyword, priorityKeyword, sourceFilter, limit),
          }
        }
        if (capability.provider === 'sina') {
          return {
            capability,
            source: 'sina',
            run: () => this.fetchSinaNews(ctx, capability, fetchKeyword, readKeyword, priorityKeyword, sourceFilter, limit),
          }
        }
        return null
      },
      {
        label: 'finance news feed',
        provider: cleanString(params.provider),
        providerMode: cleanString(params.providerMode) as DataApiProviderMode | undefined,
        cacheMode: cleanString(params.cacheMode) as DataApiCacheMode | undefined,
        allowDegraded: true,
        readCache: async () => {
          const rows = await readFinanceNewsRows(ctx, {
            keyword: readKeyword,
            priorityKeyword,
            source: sourceFilter,
            limit,
          })
          return rows.length > 0 ? rows : null
        },
      },
    )
    return {
      data: routed.data,
      source: routed.source,
      cacheStatus: routed.cacheStatus,
      sourceHealth: newsSourceHealth(routed.cacheStatus, routed.provider, routed.data),
      provenance: {
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        canonicalSchema: 'finance_news',
        canonicalTable: 'finance_news',
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        providerMode: routed.providerMode,
        requestedProvider: routed.requestedProvider,
        allowFallback: routed.allowFallback,
      },
    }
  }

  private async fetchAkshareNews(
    ctx: ToolContext,
    capability: DataApiProviderCapability,
    params: Record<string, unknown>,
    fetchKeyword: string,
    readKeyword: string,
    priorityKeyword: string | undefined,
    sourceFilter: string | undefined,
    limit: number,
  ): Promise<NewsRow[]> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    const result = await this.provider.callSidecarRoute('/news', {
      ...params,
      query: fetchKeyword,
      keyword: fetchKeyword,
    })
    const error = resultError(result)
    if (error) {
      await recordNewsApiCall(ctx, capability, startedAt, false, error)
      throw new Error(String(error))
    }
    const rows = normalizeFinanceNews(result, limit)
    const store = getLocalStore(ctx)
    if (!store.isReady) await store.init()
    store.saveFinanceNews(rows)
    const reread = await readFinanceNewsRows(ctx, {
      keyword: readKeyword,
      priorityKeyword,
      source: sourceFilter,
      limit,
      minFetchedAt: fetchedAt,
    })
    await assertNewsReadbackUsable(ctx, capability, startedAt, reread, 'AkShare refresh returned empty finance_news readback rows')
    return reread
  }

  private async fetchWindNews(
    ctx: ToolContext,
    capability: DataApiProviderCapability,
    fetchKeyword: string,
    readKeyword: string,
    priorityKeyword: string | undefined,
    sourceFilter: string | undefined,
    limit: number,
  ): Promise<NewsRow[]> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    try {
      await this.invokeWind(ctx, fetchKeyword, limit)
      const reread = await readFinanceNewsRows(ctx, {
        keyword: readKeyword,
        priorityKeyword,
        source: sourceFilter,
        limit,
        minFetchedAt: fetchedAt,
      })
      await assertNewsReadbackUsable(ctx, capability, startedAt, reread, 'Wind refresh returned empty finance_news readback rows')
      return reread
    } catch (error) {
      await recordNewsApiCall(ctx, capability, startedAt, false, error)
      throw error
    }
  }

  private async fetchSinaNews(
    ctx: ToolContext,
    capability: DataApiProviderCapability,
    fetchKeyword: string,
    readKeyword: string,
    priorityKeyword: string | undefined,
    sourceFilter: string | undefined,
    limit: number,
  ): Promise<NewsRow[]> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    try {
      const params = new URLSearchParams({
        pageid: '153',
        lid: '2516',
        k: fetchKeyword,
        num: String(Math.max(1, Math.min(limit, 50))),
        page: '1',
      })
      const response = await fetch(`https://feed.mix.sina.com.cn/api/roll/get?${params}`, {
        headers: {
          Referer: 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`Sina finance news HTTP ${response.status}`)
      const result = await response.json()
      const rows = normalizeFinanceNews(result, limit)
      const store = getLocalStore(ctx)
      if (!store.isReady) await store.init()
      store.saveFinanceNews(rows)
      const reread = await readFinanceNewsRows(ctx, {
        keyword: readKeyword,
        priorityKeyword,
        source: sourceFilter,
        limit,
        minFetchedAt: fetchedAt,
      })
      await assertNewsReadbackUsable(ctx, capability, startedAt, reread, 'Sina refresh returned empty finance_news readback rows')
      return reread
    } catch (error) {
      await recordNewsApiCall(ctx, capability, startedAt, false, error)
      throw error
    }
  }
}

async function readFinanceNewsRows(
  ctx: ToolContext,
  options: {
    keyword: string
    priorityKeyword?: string
    source?: string
    limit: number
    minFetchedAt?: string
  },
): Promise<NewsRow[]> {
  const store = getLocalStore(ctx)
  if (!store.isReady) await store.init()
  const rows = store.queryFinanceNews({
    keyword: options.keyword,
    source: options.source,
    limit: options.limit,
  }) as unknown as NewsRow[]
  if (!options.minFetchedAt) return prioritizeNewsRows(rows.map(newsRowForUi), options.priorityKeyword)
  const cutoff = Date.parse(options.minFetchedAt)
  return prioritizeNewsRows(rows
    .filter((row) => {
      const fetchedAt = normalizePublishedAt(row.fetched_at)
      if (!fetchedAt) return false
      const parsed = Date.parse(fetchedAt)
      return Number.isFinite(parsed) && parsed >= cutoff
    })
    .map(newsRowForUi), options.priorityKeyword)
}

async function assertNewsReadbackUsable(
  ctx: ToolContext,
  capability: DataApiProviderCapability,
  startedAt: number,
  rows: NewsRow[],
  message: string,
): Promise<void> {
  if (rows.length > 0) {
    await recordNewsApiCall(ctx, capability, startedAt, true)
    return
  }
  const error = `source-health:empty-result:${message}; use cached/readback finance_news rows if available and do not retry this provider again in the same workflow turn`
  await recordNewsApiCall(ctx, capability, startedAt, false, error)
  throw new Error(error)
}

function newsSourceHealth(
  cacheStatus: 'cache-hit' | 'provider-hit',
  provider: string,
  rows: NewsRow[],
): FinanceNewsRouteResult['sourceHealth'] {
  return {
    status: cacheStatus === 'cache-hit' ? 'cached' : 'live',
    provider,
    lastSuccessfulFetch: latestString(rows, ['fetched_at', 'fetchedAt']),
    nextRetryPolicy: cacheStatus === 'cache-hit'
      ? 'use-cache-first; refresh only when the user asks for live news or cache freshness is insufficient'
      : 'live rows were queryable; normal cache-first reuse is allowed',
  }
}

function latestString(rows: NewsRow[], keys: string[]): string | undefined {
  let latest: string | undefined
  for (const row of rows) {
    for (const key of keys) {
      const value = cleanString(row[key])
      if (!value) continue
      if (!latest || value > latest) latest = value
    }
  }
  return latest
}

async function callWindFinanceNews(
  ctx: ToolContext,
  query: string,
  limit: number,
): Promise<void> {
  const tool = new WindMcpTool((key) => ctx.getConfigValue?.(key)?.toString())
  const result = await tool.call(
    'finance_news',
    {
      action: 'call',
      server: 'financial_docs',
      tool: 'get_financial_news',
      arguments: {
        query,
        top_k: limit,
      },
    },
    ctx,
  )
  if (result.startsWith('Error:')) {
    throw new Error(result.replace(/^Error:\s*/, ''))
  }
}

export function normalizeFinanceNews(result: unknown, limit = 50): NewsRow[] {
  const rawItems = Array.isArray(result)
    ? result
    : Array.isArray((result as { data?: unknown } | null)?.data)
      ? (result as { data: unknown[] }).data
      : Array.isArray((result as { result?: { data?: unknown } } | null)?.result?.data)
      ? (result as { result: { data: unknown[] } }).result.data
      : []
  const fetchedAt = new Date().toISOString()
  return rawItems.slice(0, limit).map((item, index) => {
    const row = item && typeof item === 'object' ? item as NewsRow : { title: String(item ?? '') }
    const title = cleanString(row.title ?? row.headline ?? row.name) ?? `news-${index + 1}`
    const url = cleanString(row.url ?? row.link ?? row.href)
    const publishedAt = normalizePublishedAt(row.published_at ?? row.publishedAt ?? row.pubDate ?? row.ctime ?? row.createtime ?? row.time ?? row.datetime ?? row.date)
    const source = cleanString(row.source ?? row.provider ?? row.media_name ?? row.publisher) ?? 'akshare'
    return {
      news_id: cleanString(row.news_id ?? row.id) ?? newsId(source, title, url, publishedAt),
      title,
      summary: cleanString(row.summary ?? row.description ?? row.brief),
      content: cleanString(row.content ?? row.body),
      publisher: cleanString(row.publisher ?? row.media ?? row.media_name ?? row.source),
      published_at: publishedAt,
      url,
      source,
      fetched_at: fetchedAt,
      raw_json: JSON.stringify(row),
    }
  })
}

function newsRowForUi(row: NewsRow): NewsRow {
  return {
    ...row,
    id: row.news_id ?? row.id,
    link: row.url ?? row.link,
    publishedAt: row.published_at ?? row.publishedAt,
  }
}

async function recordNewsApiCall(
  ctx: ToolContext,
  capability: DataApiProviderCapability,
  startedAt: number,
  success: boolean,
  error?: unknown,
): Promise<void> {
  try {
    const store = getLocalStore(ctx)
    if (!store.isReady) await store.init()
    store.saveApiCall({
      source: capability.provider,
      provider: capability.provider,
      interface_id: 'news.finance_feed',
      capability_id: capability.id,
      tool: capability.provider === 'wind' ? 'WindMcp' : 'BridgeIPC',
      action: capability.provider === 'wind' ? 'financial_docs.get_financial_news' : capability.provider === 'sina' ? 'sina/feed.mix.roll' : 'sidecar/news',
      endpoint: capability.provider === 'wind' ? 'financial_docs/get_financial_news' : capability.provider === 'sina' ? 'feed.mix.sina.com.cn/api/roll/get' : '/news',
      status: success ? 200 : 0,
      success,
      duration_ms: Date.now() - startedAt,
      error: error == null ? null : String(error),
    })
  } catch {}
}

function resultError(result: unknown): unknown {
  if (!result || typeof result !== 'object') return null
  const error = (result as { error?: unknown }).error
  return error == null || error === '' ? null : error
}

function cleanString(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text.length > 0 ? text : undefined
}

function numeric(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function normalizePublishedAt(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value)
}

function prioritizeNewsRows(rows: NewsRow[], priorityKeyword?: string): NewsRow[] {
  const terms = String(priorityKeyword ?? '')
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
  if (terms.length === 0) return rows
  return [...rows].sort((a, b) => scoreNewsRow(b, terms) - scoreNewsRow(a, terms))
}

function scoreNewsRow(row: NewsRow, terms: string[]): number {
  const haystack = [
    row.title,
    row.summary,
    row.content,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ')
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function newsId(source: string, title: string, url?: string, publishedAt?: string | null): string {
  return createHash('sha256')
    .update(`${source}\n${title}\n${url ?? ''}\n${publishedAt ?? ''}`)
    .digest('hex')
    .slice(0, 24)
}
