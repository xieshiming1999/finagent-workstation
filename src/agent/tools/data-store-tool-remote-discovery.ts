import { toolError, type ToolContext } from '../tool'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data/data-api-interface-router'
import type {
  DataApiProviderMode,
} from '../data/data-api-interface-contract'
import type { DataApiCacheMode } from '../data/data-api-cache-policy'
import { tushareCall } from '../data/tushare-fetcher'
import { DataStore } from '../data/store/data-store'
import { normalizeTushareParams } from './data-store-tool-utils'
import { dataStoreRemoteCopy } from '../runtime-copy'
import { providerForAkshareFunc } from '../data/akshare-provider-hints'
import {
  normalizeOutputProvider,
  normalizeProviderDiagnostic,
  normalizeProviderDiscovery,
  normalizeProviderStatus,
  selectOutputOnlyCapability,
  type OutputOnlyProvider,
} from '../data/output-only-interfaces'
import { routePolicyFields, safeJson } from './data-store-tool-remote-common'

export async function searchAkshare(input: Record<string, unknown>): Promise<string> {
  return providerDiscovery({ ...input, provider: 'akshare' })
}

export async function searchYfinance(input: Record<string, unknown>): Promise<string> {
  return providerDiscovery({ ...input, provider: 'yfinance' })
}

export async function searchTA(input: Record<string, unknown>): Promise<string> {
  return providerDiscovery({ ...input, provider: 'ta' })
}

export async function providerDiscovery(input: Record<string, unknown>): Promise<string> {
  const q = String(input.query ?? input.func ?? '')
  const provider = normalizeOutputProvider(input.provider ?? input.source) ?? 'akshare'
  const capability = selectOutputOnlyCapability('provider.discovery', provider)
  try {
    const url = discoveryUrl(provider, q)
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const json = await res.json() as Record<string, unknown>
    return JSON.stringify(normalizeProviderDiscovery({
      provider,
      query: q,
      raw: json,
      capabilityId: capability.id,
      sourceAction: discoverySourceAction(provider),
    }), null, 2)
  } catch (e) {
    return toolError(dataStoreRemoteCopy.providerDiscoveryFailed(provider, e instanceof Error ? e.message : String(e)))
  }
}

export async function sidecarStatus(): Promise<string> {
  const providers: Record<string, unknown> = {}
  try {
    const healthRes = await fetch('http://127.0.0.1:19800/health', { signal: AbortSignal.timeout(5000) })
    const health = await healthRes.json() as Record<string, unknown>
    providers.pythonSidecar = { status: health.status, version: health.version, online: true }
  } catch {
    providers.pythonSidecar = { status: 'offline', online: false, failureClass: 'provider_unavailable' }
  }

  try {
    const rlRes = await fetch('http://127.0.0.1:19800/rate_limit/status', { signal: AbortSignal.timeout(5000) })
    const rl = await rlRes.json() as Record<string, unknown>
    providers.rateLimiters = { status: 'online', akshare: rl.akshare ?? {}, yfinance: rl.yfinance ?? {} }
  } catch {
    providers.rateLimiters = { status: 'unavailable', failureClass: 'provider_unavailable' }
  }

  try {
    const { getGotdxUrl } = await import('../../main/sidecar')
    const gotdxUrl = getGotdxUrl()
    if (gotdxUrl) {
      const tdxRes = await fetch(`${gotdxUrl}/health`, { signal: AbortSignal.timeout(5000) })
      const tdx = await tdxRes.json() as Record<string, unknown>
      providers.gotdx = { status: tdx.status, exStatus: tdx.exStatus, url: gotdxUrl, online: true }
    } else {
      providers.gotdx = { status: 'unconfigured', online: false, failureClass: 'runtime_blocked' }
    }
  } catch {
    providers.gotdx = { status: 'offline', online: false, failureClass: 'provider_unavailable' }
  }

  return JSON.stringify(normalizeProviderStatus({
    raw: {
      provider: 'sidecar',
      providers,
      warnings: [],
    },
  }), null, 2)
}

export async function providerStatus(): Promise<string> {
  return sidecarStatus()
}

export async function providerCoverage(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const provider = String(input.provider ?? input.source ?? 'tdx')
  const limit = Number(input.limit ?? 50)
  const readRows = () => {
    const counts = ds.queryTdxSecurityCounts({
      scope: input.scope ? String(input.scope) : undefined,
      market: input.market ? String(input.market) : undefined,
      limit,
    }) as unknown as Array<Record<string, unknown>>
    const sampling = ds.queryTdxChartSampling({
      scope: input.scope ? String(input.scope) : undefined,
      code: input.code ? String(input.code) : undefined,
      market: input.market ? String(input.market) : undefined,
      category: input.category ? String(input.category) : undefined,
      limit,
    }) as unknown as Array<Record<string, unknown>>
    return { counts, sampling }
  }
  const routed = await runDataApiInterfaceRoute(
    'provider.coverage',
    (capability): DataApiInterfaceRoute<{ counts: Array<Record<string, unknown>>; sampling: Array<Record<string, unknown>> }> | null => {
      if (capability.provider !== 'tdx') return null
      return { capability, source: 'tdx', run: async () => readRows() }
    },
    {
      label: 'provider coverage metadata',
      provider,
      providerMode: typeof input.providerMode === 'string' ? input.providerMode as DataApiProviderMode : undefined,
      cacheMode: typeof input.cacheMode === 'string' ? input.cacheMode as DataApiCacheMode : undefined,
      readCache: () => {
        const rows = readRows()
        return rows.counts.length || rows.sampling.length ? rows : null
      },
    },
  )
  const { counts, sampling } = routed.data
  const warnings = counts.length || sampling.length
    ? []
    : ['No local TDX coverage metadata rows. Run the registered TDX metadata fetch path before relying on coverage.']
  return JSON.stringify({
    ok: true,
    action: 'provider_coverage',
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    source: routed.source,
    schemaId: 'provider_coverage',
    canonicalSchema: 'provider_coverage',
    canonicalTables: ['tdx_security_count', 'tdx_chart_sampling'],
    status: counts.length || sampling.length ? 'success' : 'empty',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
    ...routePolicyFields(routed),
    persistencePolicy: 'persistable',
    warnings,
    data: {
      provider: routed.provider,
      market: input.market ? String(input.market) : null,
      category: input.category ? String(input.category) : null,
      count: counts.length,
      samplingCount: sampling.length,
      counts,
      sampling,
      updatedAt: new Date().toISOString(),
    },
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      schemaId: 'provider_coverage',
      canonicalSchema: 'provider_coverage',
      canonicalTables: ['tdx_security_count', 'tdx_chart_sampling'],
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...routePolicyFields(routed),
      persistencePolicy: 'persistable',
      sourceAction: 'provider_coverage',
      fetchedAt: new Date().toISOString(),
    },
  }, null, 2)
}

export async function providerTableMetadata(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const provider = String(input.provider ?? input.source ?? 'tdx')
  const limit = Number(input.limit ?? 50)
  const readRows = () => {
    const categories = ds.queryExCategories(limit) as unknown as Array<Record<string, unknown>>
    const rows = ds.queryExTableEntries({
      code: input.code ? String(input.code) : undefined,
      category: input.category ? String(input.category) : undefined,
      limit,
    }) as unknown as Array<Record<string, unknown>>
    return { categories, rows }
  }
  const routed = await runDataApiInterfaceRoute(
    'provider.table_metadata',
    (capability): DataApiInterfaceRoute<{ categories: Array<Record<string, unknown>>; rows: Array<Record<string, unknown>> }> | null => {
      if (capability.provider !== 'tdx') return null
      return { capability, source: 'tdx', run: async () => readRows() }
    },
    {
      label: 'provider table metadata',
      provider,
      providerMode: typeof input.providerMode === 'string' ? input.providerMode as DataApiProviderMode : undefined,
      cacheMode: typeof input.cacheMode === 'string' ? input.cacheMode as DataApiCacheMode : undefined,
      readCache: () => {
        const data = readRows()
        return data.categories.length || data.rows.length ? data : null
      },
    },
  )
  const { categories, rows } = routed.data
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const warnings = categories.length || rows.length
    ? []
    : ['No local ExTDX table metadata rows. Run the registered TDX metadata fetch path before relying on table metadata.']
  return JSON.stringify({
    ok: true,
    action: 'provider_table_metadata',
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    source: routed.source,
    schemaId: 'provider_table_metadata',
    canonicalSchema: 'provider_table_metadata',
    canonicalTables: ['ex_category', 'ex_table_entry'],
    status: rows.length || categories.length ? 'success' : 'empty',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
    ...routePolicyFields(routed),
    persistencePolicy: 'persistable',
    warnings,
    data: {
      provider: routed.provider,
      table: input.table ? String(input.table) : 'extdx',
      columns,
      rowCount: rows.length,
      categories,
      sampleRows: rows.slice(0, 20),
    },
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      schemaId: 'provider_table_metadata',
      canonicalSchema: 'provider_table_metadata',
      canonicalTables: ['ex_category', 'ex_table_entry'],
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      ...routePolicyFields(routed),
      persistencePolicy: 'persistable',
      sourceAction: 'provider_table_metadata',
      fetchedAt: new Date().toISOString(),
    },
  }, null, 2)
}

export async function providerDiagnostic(ds: DataStore, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const provider = normalizeOutputProvider(input.provider ?? input.source ?? input.action)
  if (!provider) return toolError('provider required for provider_diagnostic. Use provider:"akshare"|"yfinance"|"tdx"|"ta"|"tushare"|"sina"|"tencent".')
  switch (provider) {
    case 'akshare':
      return diagnosticAkshare(input)
    case 'yfinance':
      return diagnosticYfinance(input)
    case 'tdx':
      return diagnosticTdx(ds, input)
    case 'ta':
      return diagnosticTA(input)
    case 'tushare':
      return diagnosticTushare(input, ctx)
    case 'sina':
      return diagnosticSina(input)
    case 'tencent':
      return diagnosticTencent(input)
    default:
      return toolError(`provider_diagnostic does not support provider "${provider}".`)
  }
}

async function diagnosticAkshare(input: Record<string, unknown>): Promise<string> {
  const func = String(input.func ?? input.endpoint ?? '')
  if (!func) return toolError(dataStoreRemoteCopy.akshareMissingFunc())
  const params = (input.params as Record<string, unknown>) ?? {}
  if (input.code && !params.symbol && !params.code) params.symbol = input.code
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const provider = providerForAkshareFunc(func)
  if (provider && !qs.has('_provider')) qs.set('_provider', provider)
  const url = `http://127.0.0.1:19800/akshare/${func}${qs.toString() ? `?${qs}` : ''}`
  return diagnosticFetch('akshare', 'akshare.provider.diagnostic', func, { func, params }, url, 'provider_diagnostic')
}

async function diagnosticYfinance(input: Record<string, unknown>): Promise<string> {
  const func = String(input.func ?? input.endpoint ?? '')
  if (!func) return toolError(dataStoreRemoteCopy.yfinanceMissingFunc())
  const symbol = String(input.symbol ?? input.code ?? '')
  if (!symbol) return toolError(dataStoreRemoteCopy.yfinanceMissingSymbol())
  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  qs.set('symbol', symbol)
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const url = `http://127.0.0.1:19800/yfinance/${func}?${qs}`
  return diagnosticFetch('yfinance', 'yfinance.provider.diagnostic', func, { func, symbol, params }, url, 'provider_diagnostic')
}

async function diagnosticTA(input: Record<string, unknown>): Promise<string> {
  const indicator = String(input.func ?? input.endpoint ?? '')
  if (!indicator) return toolError(dataStoreRemoteCopy.taMissingFunc())
  const symbol = String(input.symbol ?? input.code ?? '')
  if (!symbol) return toolError(dataStoreRemoteCopy.taMissingSymbol())
  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  qs.set('symbol', symbol)
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const url = `http://127.0.0.1:19800/ta/${indicator}?${qs}`
  return diagnosticFetch('ta', 'ta.provider.diagnostic', indicator, { indicator, symbol, params }, url, 'provider_diagnostic')
}

async function diagnosticTdx(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const tdxAction = String(input.tdx_action ?? input.func ?? input.endpoint ?? '')
  if (!tdxAction) return toolError(dataStoreRemoteCopy.tdxMissingAction())
  let gotdxUrl = ''
  try {
    const { getGotdxUrl } = await import('../../main/sidecar')
    gotdxUrl = getGotdxUrl() ?? ''
  } catch {
    gotdxUrl = ''
  }
  if (!gotdxUrl) {
    const msg = dataStoreRemoteCopy.gotdxUnavailable()
    ds.saveApiCall({ source: 'tdx', tool: 'DataStore', action: 'provider_diagnostic', endpoint: tdxAction, status: 0, success: false, duration_ms: 0, error: msg })
    return toolError(msg)
  }
  const code = String(input.code ?? '')
  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  if (code) qs.set('code', code)
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const url = `${gotdxUrl}/${tdxAction}${qs.toString() ? `?${qs}` : ''}`
  return diagnosticFetch('tdx', 'tdx.provider.diagnostic', tdxAction, { tdx_action: tdxAction, code, params }, url, 'provider_diagnostic')
}

async function diagnosticTushare(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const apiName = String(input.api_name ?? input.func ?? input.endpoint ?? '')
  if (!apiName) return toolError(dataStoreRemoteCopy.tushareMissingApiName())
  const token = String(ctx.getConfigValue?.('TUSHARE_TOKEN') ?? '').trim()
  if (!token) {
    const normalized = normalizeProviderDiagnostic({
      provider: 'tushare',
      endpointOrAction: apiName,
      requestShape: { api_name: apiName, params: normalizeTushareParams(input) },
      raw: { error: 'TUSHARE_TOKEN is not configured' },
      capabilityId: 'tushare.provider.diagnostic',
      sourceAction: 'provider_diagnostic',
      statusCode: 403,
    })
    return JSON.stringify(normalized, null, 2)
  }
  try {
    const data = await tushareCall(token, apiName, normalizeTushareParams(input), input.fields == null || input.fields === '' ? undefined : String(input.fields))
    return JSON.stringify(normalizeProviderDiagnostic({
      provider: 'tushare',
      endpointOrAction: apiName,
      requestShape: { api_name: apiName, params: normalizeTushareParams(input) },
      raw: { data },
      capabilityId: 'tushare.provider.diagnostic',
      sourceAction: 'provider_diagnostic',
    }), null, 2)
  } catch (e) {
    return JSON.stringify(normalizeProviderDiagnostic({
      provider: 'tushare',
      endpointOrAction: apiName,
      requestShape: { api_name: apiName, params: normalizeTushareParams(input) },
      raw: { error: e instanceof Error ? e.message : String(e) },
      capabilityId: 'tushare.provider.diagnostic',
      sourceAction: 'provider_diagnostic',
    }), null, 2)
  }
}

async function diagnosticSina(input: Record<string, unknown>): Promise<string> {
  const endpoint = String(input.func ?? input.endpoint ?? input.url ?? 'quote')
  const params = (input.params as Record<string, unknown>) ?? {}
  const url = diagnosticSinaUrl(endpoint, input, params)
  if (typeof url !== 'string') return toolError(url.error)
  return diagnosticFetch('sina', 'sina.provider.diagnostic', endpoint, { endpoint, params }, url, 'provider_diagnostic')
}

async function diagnosticTencent(input: Record<string, unknown>): Promise<string> {
  const endpoint = String(input.func ?? input.endpoint ?? input.url ?? 'quote')
  const params = (input.params as Record<string, unknown>) ?? {}
  const url = diagnosticTencentUrl(endpoint, input, params)
  if (typeof url !== 'string') return toolError(url.error)
  return diagnosticFetch('tencent', 'tencent.provider.diagnostic', endpoint, { endpoint, params }, url, 'provider_diagnostic')
}

async function diagnosticFetch(
  provider: OutputOnlyProvider,
  capabilityId: string,
  endpointOrAction: string,
  requestShape: Record<string, unknown>,
  url: string,
  sourceAction: string,
): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const raw = await safeJson(res)
    return JSON.stringify(normalizeProviderDiagnostic({
      provider,
      endpointOrAction,
      requestShape,
      raw,
      capabilityId,
      sourceAction,
      statusCode: res.status,
      error: res.ok ? undefined : JSON.stringify(raw).slice(0, 500),
    }), null, 2)
  } catch (e) {
    return JSON.stringify(normalizeProviderDiagnostic({
      provider,
      endpointOrAction,
      requestShape,
      raw: { error: e instanceof Error ? e.message : String(e) },
      capabilityId,
      sourceAction,
    }), null, 2)
  }
}

function discoveryUrl(provider: OutputOnlyProvider, query: string): string {
  if (provider === 'yfinance') return `http://127.0.0.1:19800/yfinance_search?q=${encodeURIComponent(query)}`
  if (provider === 'ta') return `http://127.0.0.1:19800/ta_search?q=${encodeURIComponent(query)}`
  return `http://127.0.0.1:19800/akshare_search?q=${encodeURIComponent(query)}`
}

function discoverySourceAction(provider: OutputOnlyProvider): string {
  if (provider === 'yfinance') return 'yfinance_search'
  if (provider === 'ta') return 'ta_search'
  return 'akshare_search'
}

function diagnosticSinaUrl(endpoint: string, input: Record<string, unknown>, params: Record<string, unknown>): string | { error: string } {
  if (/^https?:\/\//i.test(endpoint)) return allowedDiagnosticUrl(endpoint, ['finance.sina.com.cn', 'money.finance.sina.com.cn', 'vip.stock.finance.sina.com.cn', 'hq.sinajs.cn'])
  const code = String(input.code ?? input.symbol ?? params.code ?? params.symbol ?? '')
  if ((endpoint === 'quote' || endpoint === 'hq') && code) return `https://hq.sinajs.cn/list=${sinaSymbol(code)}`
  if (endpoint === 'kline' && code) {
    const scale = String(params.scale ?? input.scale ?? '240')
    const ma = String(params.ma ?? input.ma ?? 'no')
    const datalen = String(params.datalen ?? input.limit ?? '120')
    const qs = new URLSearchParams({ symbol: sinaSymbol(code), scale, ma, datalen })
    return `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?${qs}`
  }
  return { error: 'sina provider_diagnostic requires url, or endpoint:"quote"|"kline" with code/symbol.' }
}

function diagnosticTencentUrl(endpoint: string, input: Record<string, unknown>, params: Record<string, unknown>): string | { error: string } {
  if (/^https?:\/\//i.test(endpoint)) return allowedDiagnosticUrl(endpoint, ['qt.gtimg.cn', 'web.ifzq.gtimg.cn'])
  const code = String(input.code ?? input.symbol ?? params.code ?? params.symbol ?? '')
  if ((endpoint === 'quote' || endpoint === 'hq') && code) return `https://qt.gtimg.cn/q=${tencentSymbol(code)}`
  if (endpoint === 'kline' && code) {
    const period = String(params.period ?? input.period ?? 'day')
    const adjust = String(params.adjust ?? input.adjust ?? 'qfq')
    const limit = String(params.limit ?? input.limit ?? '120')
    const qs = new URLSearchParams({ param: `${tencentSymbol(code)},${period},,,${limit},${adjust}` })
    return `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${qs}`
  }
  return { error: 'tencent provider_diagnostic requires url, or endpoint:"quote"|"kline" with code/symbol.' }
}

function allowedDiagnosticUrl(rawUrl: string, allowedHosts: string[]): string | { error: string } {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return { error: `provider_diagnostic URL host "${host}" is not allowed for this provider.` }
    }
    return parsed.toString()
  } catch {
    return { error: `Invalid provider_diagnostic URL: ${rawUrl}` }
  }
}

function sinaSymbol(code: string): string {
  const clean = cleanMarketCode(code)
  if (/^(sh|sz|bj)/i.test(code)) return code.toLowerCase()
  if (clean.startsWith('6') || clean.startsWith('5') || clean.startsWith('9')) return `sh${clean}`
  if (clean.startsWith('8') || clean.startsWith('4')) return `bj${clean}`
  return `sz${clean}`
}

function tencentSymbol(code: string): string {
  const clean = cleanMarketCode(code)
  if (/^(sh|sz|bj)/i.test(code)) return code.toLowerCase()
  if (clean.startsWith('6') || clean.startsWith('5') || clean.startsWith('9')) return `sh${clean}`
  if (clean.startsWith('8') || clean.startsWith('4')) return `bj${clean}`
  return `sz${clean}`
}

function cleanMarketCode(value: string): string {
  return value.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').trim()
}
