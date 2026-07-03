import { createHash } from 'crypto'
import { toolError } from '../tool'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data/data-api-interface-router'
import type {
  DataApiProviderCapability,
  DataApiProviderMode,
} from '../data/data-api-interface-contract'
import type { DataApiCacheMode } from '../data/data-api-cache-policy'
import { normalizeTechnicalIndicatorSeries } from '../data/normalizers/technical-indicator-normalizer'
import { ingestEndpointResult } from '../data/ingestion/registry'
import { DataStore } from '../data/store/data-store'
import type { AlphaFactorRow } from '../data/store/data-store-types'
import { dataStoreRemoteCopy } from '../runtime-copy'
import {
  normalizeTechnicalIndicator,
} from '../data/output-only-interfaces'
import { routePolicyFields } from './data-store-tool-remote-common'

export async function callTA(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  return technicalIndicator(ds, input)
}

export async function technicalIndicator(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const indicator = String(input.func ?? '')
  if (!indicator) return toolError(dataStoreRemoteCopy.taMissingFunc())
  const symbol = String(input.code ?? input.symbol ?? '')
  if (!symbol) return toolError(dataStoreRemoteCopy.taMissingSymbol())
  const limit = Number(input.limit ?? 120)
  const fieldName = typeof input.fieldName === 'string' ? input.fieldName : undefined
  const since = typeof input.since === 'string' ? input.since : undefined
  try {
    const routed = await runDataApiInterfaceRoute(
      'technical.indicator_series',
      (capability): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
        if (capability.provider !== 'ta') return null
        return {
          capability,
          source: 'ta',
          run: async () => {
            const params = (input.params as Record<string, unknown>) ?? {}
            const qs = new URLSearchParams()
            qs.set('symbol', symbol)
            for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))

            const url = `http://127.0.0.1:19800/ta/${indicator}?${qs}`
            const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
            const json = await res.json() as Record<string, unknown>
            const normalized = normalizeTechnicalIndicator({
              indicator,
              symbol,
              params,
              raw: json,
              capabilityId: capability.id,
              sourceAction: 'technical_indicator',
            })
            if (!normalized.ok) {
              let msg = dataStoreRemoteCopy.taError(String((normalized.data as Record<string, unknown>).error ?? normalized.failureClass))
              if (json.expected_params) msg += `\n${dataStoreRemoteCopy.taExpectedParams(JSON.stringify(json.expected_params))}`
              if (json.hint) msg += `\n${dataStoreRemoteCopy.taHint(String(json.hint))}`
              if (json.available_categories) msg += `\n${dataStoreRemoteCopy.taCategories(Object.keys(json.available_categories as Record<string, unknown>).join(', '))}`
              throw new Error(msg)
            }
            const persistence = normalizeTechnicalIndicatorSeries(normalized)
            if (input.persist === false) {
              return persistence.rows as unknown as Array<Record<string, unknown>>
            }
            if (input.persist !== false && persistence.rows.length > 0) {
              ds.saveTechnicalIndicatorSeries(persistence.rows)
            }
            return ds.queryTechnicalIndicatorSeries({ symbol, indicator, fieldName, since, limit }) as unknown as Array<Record<string, unknown>>
          },
        }
      },
      {
        label: `technical indicator ${indicator}`,
        provider: typeof input.provider === 'string' ? input.provider : 'ta',
        providerMode: typeof input.providerMode === 'string' ? input.providerMode as DataApiProviderMode : undefined,
        cacheMode: typeof input.cacheMode === 'string' ? input.cacheMode as DataApiCacheMode : undefined,
        readCache: () => {
          const rows = ds.queryTechnicalIndicatorSeries({ symbol, indicator, fieldName, since, limit }) as unknown as Array<Record<string, unknown>>
          return rows.length > 0 ? rows : null
        },
      },
    )
    return JSON.stringify({
      ok: true,
      action: 'technical_indicator',
      symbol,
      indicator,
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      schemaId: 'technical_indicator_series',
      canonicalSchema: 'technical_indicator_series',
      canonicalTable: 'technical_indicator_series',
      status: routed.data.length > 0 ? 'success' : 'empty',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...routePolicyFields(routed),
      persistencePolicy: input.persist === false ? 'inspect-only' : 'canonical',
      data: { rows: routed.data },
      provenance: {
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        source: routed.source,
        schemaId: 'technical_indicator_series',
        canonicalSchema: 'technical_indicator_series',
        canonicalTable: 'technical_indicator_series',
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        ...routePolicyFields(routed),
        persistencePolicy: input.persist === false ? 'inspect-only' : 'canonical',
        sourceAction: 'technical_indicator',
        sourceDataTime: routed.data[0]?.source_date ?? null,
        fetchedAt: routed.data[0]?.fetched_at ?? new Date().toISOString(),
      },
    }, null, 2)
  } catch (e) {
    return toolError(dataStoreRemoteCopy.taCallFailed(e instanceof Error ? e.message : String(e)))
  }
}

export async function alphaFactors(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const symbol = String(input.code ?? input.symbol ?? '')
  if (!symbol) return toolError('code or symbol required for alpha_factors')
  const period = String(input.period ?? 'daily')
  const limit = Number(input.limit ?? 120)
  const factorName = typeof input.factorName === 'string' ? input.factorName : (typeof input.factor === 'string' ? input.factor : undefined)
  const since = typeof input.since === 'string' ? input.since : undefined
  const params = { period, limit }
  try {
    const routed = await runDataApiInterfaceRoute(
      'stock.alpha_factors',
      (capability): DataApiInterfaceRoute<AlphaFactorRow[]> | null => {
        if (capability.provider !== 'akshare') return null
        return {
          capability,
          source: 'akshare',
          run: async () => {
            const qs = new URLSearchParams()
            qs.set('code', symbol)
            qs.set('period', period)
            qs.set('limit', String(limit))
            qs.set('_priority', 'background')
            const res = await fetch(`http://127.0.0.1:19800/alpha/factors?${qs}`, {
              signal: AbortSignal.timeout(45000),
            })
            const json = await res.json() as Record<string, unknown>
            if (!res.ok || json.error) {
              throw new Error(String(json.error ?? `alpha/factors HTTP ${res.status}`))
            }
            const rows = normalizeAlphaFactorRows({
              payload: json,
              symbol,
              provider: capability.provider,
              capabilityId: capability.id,
              sourceAction: 'alpha_factors',
              params,
            })
            if (input.persist !== false && rows.length > 0) {
              ds.saveAlphaFactorRows(rows)
            }
            if (input.persist === false) return rows
            return ds.queryAlphaFactorRows({ symbol, factorName, since, provider: capability.provider, limit: Number(input.limit ?? 200) })
          },
        }
      },
      {
        label: `alpha factors ${symbol}`,
        provider: typeof input.provider === 'string' ? input.provider : 'akshare',
        providerMode: typeof input.providerMode === 'string' ? input.providerMode as DataApiProviderMode : undefined,
        cacheMode: typeof input.cacheMode === 'string' ? input.cacheMode as DataApiCacheMode : undefined,
        readCache: () => {
          const rows = ds.queryAlphaFactorRows({ symbol, factorName, since, provider: typeof input.provider === 'string' ? input.provider : undefined, limit: Number(input.limit ?? 200) })
          return rows.length > 0 ? rows : null
        },
      },
    )
    return JSON.stringify({
      ok: true,
      action: 'alpha_factors',
      symbol,
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      schemaId: 'alpha_factor',
      canonicalSchema: 'alpha_factor',
      canonicalTable: 'alpha_factor',
      status: routed.data.length > 0 ? 'success' : 'empty',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...routePolicyFields(routed),
      persistencePolicy: input.persist === false ? 'inspect-only' : 'canonical',
      data: { rows: routed.data },
      provenance: {
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        source: routed.source,
        schemaId: 'alpha_factor',
        canonicalSchema: 'alpha_factor',
        canonicalTable: 'alpha_factor',
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        ...routePolicyFields(routed),
        persistencePolicy: input.persist === false ? 'inspect-only' : 'canonical',
        sourceAction: 'alpha_factors',
        sourceDataTime: routed.data[0]?.source_date ?? null,
        fetchedAt: routed.data[0]?.fetched_at ?? new Date().toISOString(),
      },
    }, null, 2)
  } catch (e) {
    return toolError(`alpha_factors failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function globalFundamentalOutput(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const symbol = String(input.symbol ?? input.code ?? '')
  if (!symbol) return toolError(dataStoreRemoteCopy.yfinanceMissingSymbol())
  const dataset = String(input.dataset ?? input.func ?? 'cash_flow')
  const allowed = new Set(['cash_flow', 'quarterly_cash_flow', 'eps_revisions', 'eps_trend', 'capital_gains'])
  if (!allowed.has(dataset)) {
    return toolError(`global_fundamental_output dataset must be one of ${Array.from(allowed).join(', ')}.`)
  }
  const target = globalFundamentalTarget(dataset)
  const startedAt = Date.now()
  try {
    const routed = await runDataApiInterfaceRoute<Array<Record<string, unknown>>>(
      target.interfaceId,
      (capability): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
        if (capability.provider !== 'yahoo') return null
        return {
          capability,
          source: 'yfinance',
          run: async () => {
            await fetchAndPersistGlobalFundamental(ds, input, symbol, dataset, capability, startedAt)
            return readGlobalFundamentalRows(ds, symbol, dataset, target.table, Number(input.limit ?? 50))
          },
        }
      },
      {
        label: `global fundamental ${dataset}`,
        provider: yahooProviderConstraint(input),
        providerMode: typeof input.providerMode === 'string' ? input.providerMode as DataApiProviderMode : undefined,
        cacheMode: typeof input.cacheMode === 'string' ? input.cacheMode as DataApiCacheMode : undefined,
        readCache: () => {
          const rows = readGlobalFundamentalRows(ds, symbol, dataset, target.table, Number(input.limit ?? 50))
          return rows.length > 0 ? rows : null
        },
      },
    )
    return JSON.stringify({
      ok: true,
      action: 'global_fundamental_output',
      symbol,
      dataset,
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      schemaId: target.schema,
      canonicalSchema: target.schema,
      canonicalTable: target.table,
      status: routed.data.length > 0 ? 'success' : 'empty',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...routePolicyFields(routed),
      persistencePolicy: 'persistable',
      data: { rows: routed.data },
      provenance: {
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        source: routed.source,
        schemaId: target.schema,
        canonicalSchema: target.schema,
        canonicalTable: target.table,
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        ...routePolicyFields(routed),
        persistencePolicy: 'persistable',
        sourceAction: 'global_fundamental_output',
        fetchedAt: new Date().toISOString(),
      },
    }, null, 2)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({
      source: 'yfinance',
      provider: yahooProviderConstraint(input) ?? 'yahoo',
      interface_id: target.interfaceId,
      capability_id: `yahoo.${target.interfaceId}`,
      tool: 'DataStore',
      action: 'global_fundamental_output',
      endpoint: dataset,
      status: 0,
      success: false,
      duration_ms: Date.now() - startedAt,
      error: msg,
    })
    return toolError(`global_fundamental_output ${dataset} failed through ${target.interfaceId}: ${msg}`)
  }
}

function normalizeAlphaFactorRows(input: {
  payload: Record<string, unknown>
  symbol: string
  provider: string
  capabilityId: string
  sourceAction: string
  params: Record<string, unknown>
}): AlphaFactorRow[] {
  const factors = input.payload.factors
  if (factors == null || typeof factors !== 'object' || Array.isArray(factors)) return []
  const fetchedAt = new Date().toISOString()
  const paramsJson = JSON.stringify(input.params)
  const paramsHash = createHash('sha1').update(paramsJson).digest('hex')
  const sourceDate = typeof input.payload.source_date === 'string'
    ? input.payload.source_date
    : fetchedAt.substring(0, 10)
  const bars = Number(input.payload.bars ?? input.params.limit)
  const rows: AlphaFactorRow[] = []
  for (const [factorName, rawValue] of Object.entries(factors as Record<string, unknown>)) {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) continue
    rows.push({
      provider: input.provider,
      capability_id: input.capabilityId,
      source_action: input.sourceAction,
      symbol: cleanSymbol(input.symbol),
      factor_name: factorName,
      params_hash: paramsHash,
      source_date: sourceDate,
      value,
      bars: Number.isFinite(bars) ? bars : null,
      fetched_at: fetchedAt,
      params_json: paramsJson,
      raw_json: JSON.stringify({ factorName, value: rawValue, payloadCode: input.payload.code }),
    })
  }
  return rows
}

function cleanSymbol(symbol: string): string {
  return symbol.replace(/^(SH|SZ|BJ)/i, '').replace(/\.[A-Z]+$/i, '')
}

async function fetchAndPersistGlobalFundamental(
  ds: DataStore,
  input: Record<string, unknown>,
  symbol: string,
  dataset: string,
  capability: DataApiProviderCapability,
  startedAt: number,
): Promise<void> {
  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  qs.set('symbol', symbol)
  for (const [key, value] of Object.entries(params)) if (value != null) qs.set(key, String(value))
  const url = `http://127.0.0.1:19800/yfinance/${dataset}?${qs}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  const json = await res.json() as unknown
  const error = res.ok ? undefined : JSON.stringify(json).slice(0, 500)
  ds.saveApiCall({
    source: 'yfinance',
    provider: capability.provider,
    interface_id: globalFundamentalTarget(dataset).interfaceId,
    capability_id: capability.id,
    tool: 'DataStore',
    action: 'global_fundamental_output',
    endpoint: dataset,
    status: res.status,
    success: res.ok,
    duration_ms: Date.now() - startedAt,
    error,
  })
  if (!res.ok) throw new Error(error ?? `HTTP ${res.status}`)
  const ingestion = ingestEndpointResult(ds, {
    provider: 'yfinance',
    endpoint: dataset,
    payload: json,
    params,
    code: symbol,
    source: 'yfinance',
    request: { action: 'global_fundamental_output', dataset, symbol, params },
  })
  if (!ingestion?.persisted) throw new Error(`No registered yfinance ingestion result for ${dataset}`)
}

function readGlobalFundamentalRows(
  ds: DataStore,
  symbol: string,
  dataset: string,
  table: string,
  limit: number,
): Array<Record<string, unknown>> {
  if (table === 'yfinance_corporate_actions') {
    return ds.query<Record<string, unknown>>(
      'SELECT * FROM yfinance_corporate_actions WHERE symbol = ? AND action_type = ? ORDER BY action_date DESC, updated_at DESC LIMIT ?',
      symbol,
      dataset,
      limit,
    )
  }
  return ds.query<Record<string, unknown>>(
    'SELECT * FROM yfinance_statement_items WHERE symbol = ? AND statement_type = ? ORDER BY period DESC, item LIMIT ?',
    symbol,
    dataset,
    limit,
  )
}

function globalFundamentalTarget(dataset: string): { interfaceId: string; schema: string; table: string } {
  if (dataset === 'capital_gains') {
    return {
      interfaceId: 'global.corporate_actions',
      schema: 'yfinance_corporate_actions',
      table: 'yfinance_corporate_actions',
    }
  }
  return {
    interfaceId: 'global.financial_statements',
    schema: 'yfinance_statement_items',
    table: 'yfinance_statement_items',
  }
}

function yahooProviderConstraint(input: Record<string, unknown>): string | undefined {
  if (typeof input.provider !== 'string') return undefined
  const provider = input.provider.trim().toLowerCase()
  if (!provider) return undefined
  return provider === 'yfinance' ? 'yahoo' : provider
}
