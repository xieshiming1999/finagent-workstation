import type { DataApiCacheMode } from '../../../agent/data/data-api-cache-policy'
import type { DataApiProviderCapability, DataApiProviderMode } from '../../../agent/data/data-api-interface-contract'
import { runDataApiInterfaceRoute, type DataApiInterfaceRoute } from '../../../agent/data/data-api-interface-router'
import type { ToolContext } from '../../../agent/tool'
import { getLocalStore } from '../../../agent/tools/market-data-utils'
import type { YahooMarketDataService } from './yahoo-market-data-service'

export async function readYahooOptionDailyKline(
  service: YahooMarketDataService,
  input: Record<string, unknown>,
  ctx: ToolContext,
  code: string,
  limit: number,
): Promise<string> {
  const range = String(input.range ?? input.period ?? '6mo')
  const routed = await runDataApiInterfaceRoute<Array<Record<string, unknown>>>(
    'option.daily_kline',
    (capability): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
      if (capability.provider !== 'yahoo') return null
      return {
        capability,
        source: 'yfinance',
        run: async () => {
          await service.fetchHistory(ctx, code, range)
          return readOptionDailyKlineRows(ctx, code, input, limit)
        },
      }
    },
    {
      label: 'option daily kline',
      provider: yahooProviderConstraint(input),
      providerMode: typeof input.providerMode === 'string' ? (input.providerMode as DataApiProviderMode) : undefined,
      cacheMode: typeof input.cacheMode === 'string' ? (input.cacheMode as DataApiCacheMode) : undefined,
      readCache: () => {
        const rows = readOptionDailyKlineRows(ctx, code, input, limit)
        return rows.length > 0 ? rows : null
      },
    },
  )
  const rows = routed.data
  if (!Array.isArray(rows) || rows.length === 0) {
    return `No governed option.daily_kline rows for ${code}`
  }
  return JSON.stringify(
    {
      action: 'option_daily_kline',
      symbol: code,
      count: rows.length,
      source: routed.source,
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      providerId: 'yahoo',
      ...yahooGlobalProvenance(rows),
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      data: rows.slice(0, limit),
    },
    null,
    2,
  )
}

function readOptionDailyKlineRows(
  ctx: ToolContext,
  code: string,
  input: Record<string, unknown>,
  limit: number,
): Array<Record<string, unknown>> {
  return getLocalStore(ctx).queryKline(code, {
    start: typeof input.start === 'string' ? input.start : undefined,
    end: typeof input.end === 'string' ? input.end : undefined,
    adjust: 'none',
    limit,
  }) as unknown as Array<Record<string, unknown>>
}

function yahooGlobalProvenance(value: unknown): Record<string, unknown> {
  return {
    providerStatus: 'global-only',
    marketScope: ['US', 'HK', 'global'],
    globalOnly: true,
    asOf: latestYahooTimestamp(value, [
      'timestamp',
      'as_of',
      'asOf',
      'published_at',
      'action_date',
      'last_trade_date',
      'period',
      'reported_date',
      'start_date',
    ]),
    fetchedAt: latestYahooTimestamp(value, ['fetched_at', 'fetchedAt', 'updated_at']),
  }
}

function latestYahooTimestamp(value: unknown, keys: string[]): string | null {
  let latest: string | null = null
  const seen = new Set<unknown>()
  const visit = (node: unknown): void => {
    if (node == null) return
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const row = node as Record<string, unknown>
    for (const key of keys) {
      const raw = row[key]
      if (raw == null) continue
      const text = String(raw)
      if (!text) continue
      if (!latest || text > latest) latest = text
    }
    for (const child of Object.values(row)) visit(child)
  }
  visit(value)
  return latest
}

function yahooProviderConstraint(input: Record<string, unknown>): DataApiProviderCapability['provider'] | undefined {
  if (input.provider == null) return undefined
  const provider = String(input.provider).trim().toLowerCase()
  if (!provider) return undefined
  return provider === 'yfinance' ? 'yahoo' : (provider as DataApiProviderCapability['provider'])
}
