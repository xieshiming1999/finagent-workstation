import {
  readWindAnalyticsRows,
  readWindDocumentRows,
  readWindEconomicSeriesRows,
} from '../../../agent/data/data-api-interface-cache'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../../../agent/data/data-api-interface-router'

export interface WindRequirementResult {
  data: Array<Record<string, unknown>>
  source: string
  provenance: {
    interfaceId: string
    capabilityId: string
    provider: string
    source: string
    canonicalSchema: string
    canonicalTable: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision: string
    sourceDataTime?: string
    fetchedAt: string
  }
}

export class WindDataApiService {
  readFinancialDocuments(opts: {
    query?: string
    tool?: string
    code?: string
    limit?: number
  } = {}): Promise<WindRequirementResult> {
    return runWindRequirementRoute({
      interfaceId: 'wind.financial_document',
      label: 'Wind financial documents',
      canonicalSchema: 'wind_document',
      canonicalTable: 'wind_document',
      sourceTimeKeys: ['published_at', 'updated_at'],
      readCache: () => {
        const rows = readWindDocumentRows({
          query: opts.query,
          tool: opts.tool,
          code: opts.code,
          limit: opts.limit,
        })
        return rows.length > 0 ? { data: rows, source: 'local' } : null
      },
    })
  }

  readEconomicSeries(opts: {
    metricQuery?: string
    limit?: number
  } = {}): Promise<WindRequirementResult> {
    return runWindRequirementRoute({
      interfaceId: 'wind.economic_series',
      label: 'Wind economic series',
      canonicalSchema: 'wind_economic_series',
      canonicalTable: 'wind_economic_series',
      sourceTimeKeys: ['date', 'updated_at'],
      readCache: () => {
        const rows = readWindEconomicSeriesRows({
          metricQuery: opts.metricQuery,
          limit: opts.limit,
        })
        return rows.length > 0 ? { data: rows, source: 'local' } : null
      },
    })
  }

  readAnalyticsResult(opts: {
    question?: string
    limit?: number
  } = {}): Promise<WindRequirementResult> {
    return runWindRequirementRoute({
      interfaceId: 'wind.analytics_result',
      label: 'Wind analytics result',
      canonicalSchema: 'wind_analytics_result',
      canonicalTable: 'wind_analytics_result',
      sourceTimeKeys: ['value_date', 'updated_at'],
      readCache: () => {
        const rows = readWindAnalyticsRows({
          question: opts.question,
          limit: opts.limit,
        })
        return rows.length > 0 ? { data: rows, source: 'local' } : null
      },
    })
  }
}

async function runWindRequirementRoute(opts: {
  interfaceId: string
  label: string
  canonicalSchema: string
  canonicalTable: string
  sourceTimeKeys: string[]
  readCache: () => { data: Array<Record<string, unknown>>; source: string } | null
}): Promise<WindRequirementResult> {
  const routed = await runDataApiInterfaceRoute(
    opts.interfaceId,
    windProviderRoute,
    {
      label: opts.label,
      readCache: opts.readCache,
    },
  )
  const sourceDataTime = latestValue(routed.data.data, opts.sourceTimeKeys)
  return {
    data: routed.data.data,
    source: routed.data.source,
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      canonicalSchema: opts.canonicalSchema,
      canonicalTable: opts.canonicalTable,
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...(sourceDataTime ? { sourceDataTime } : {}),
      fetchedAt: new Date().toISOString(),
    },
  }
}

function latestValue(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): string | null {
  for (const key of keys) {
    let latest: string | null = null
    for (const row of rows) {
      const value = row[key]
      if (value == null) continue
      const text = String(value).trim()
      if (!text) continue
      if (latest == null || text.localeCompare(latest) > 0) latest = text
    }
    if (latest) return latest
  }
  return null
}

function windProviderRoute(): DataApiInterfaceRoute<{
  data: Array<Record<string, unknown>>
  source: string
}> | null {
  // Live Wind calls remain behind WindMcp so quota, credential, and result-cache
  // policy stay centralized. This requirement route is the reusable local-first
  // read path and will report credential-gated provider status on cache miss.
  return null
}
