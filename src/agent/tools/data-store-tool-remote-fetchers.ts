import { toolError, type ToolContext } from '../tool'
import { normalizeTdxEndpoint } from '../data/normalizers/tdx-normalizer'
import { ingestEndpointResult } from '../data/ingestion/registry'
import { tushareCall } from '../data/tushare-fetcher'
import { DataStore } from '../data/store/data-store'
import { formatIngestionResult, normalizeTushareParams } from './data-store-tool-utils'
import { dataStoreRemoteCopy } from '../runtime-copy'
import { providerForAkshareFunc } from '../data/akshare-provider-hints'
import { isKnownProviderSchema, safeJson, unknownSchemaMessage } from './data-store-tool-remote-common'

export async function callAkshare(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const func = String(input.func ?? '')
  if (!func) return toolError(dataStoreRemoteCopy.akshareMissingFunc())
  const startedAt = Date.now()
  const params = (input.params as Record<string, unknown>) ?? {}
  if (input.code && !params.symbol && !params.code) params.symbol = input.code

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const provider = providerForAkshareFunc(func)
  if (provider && !qs.has('_provider')) qs.set('_provider', provider)

  const url = `http://127.0.0.1:19800/akshare/${func}${qs.toString() ? `?${qs}` : ''}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      const body = await res.text()
      ds.saveApiCall({ source: 'akshare', tool: 'DataStore', action: 'akshare', endpoint: func, status: res.status, success: false, duration_ms: Date.now() - startedAt, error: body.slice(0, 500) })
      return toolError(dataStoreRemoteCopy.akshareError(res.status, body.slice(0, 500)))
    }
    const json = await res.json() as Record<string, unknown>
    if (json.error) {
      ds.saveApiCall({ source: 'akshare', tool: 'DataStore', action: 'akshare', endpoint: func, status: 0, success: false, duration_ms: Date.now() - startedAt, error: String(json.error).slice(0, 500) })
      return toolError(dataStoreRemoteCopy.akshareErrorText(String(json.error)))
    }
    const ingestion = input.persist !== false
      ? ingestEndpointResult(ds, { provider: 'akshare', endpoint: func, payload: json, params, code: String(input.code ?? params.symbol ?? params.code ?? ''), request: { action: 'akshare', func, params } })
      : null
    const data = json.data
    const prefix = ingestion ? `${formatIngestionResult(ingestion)}\n` : ''
    if (!ingestion && !isKnownProviderSchema('akshare', func)) {
      return toolError(unknownSchemaMessage('akshare', func))
    }
    if (!data) return prefix + JSON.stringify(json).slice(0, 2000)
    if (Array.isArray(data)) {
      const count = data.length
      const cols = Array.isArray(json.columns) ? `Columns: ${json.columns.join(', ')}\n` : ''
      if (count <= 20) return `${prefix}${cols}${func}: ${count} rows\n${data.map((r) => JSON.stringify(r)).join('\n')}`
      return `${prefix}${cols}${func}: ${count} rows\n${data.slice(0, 5).map((r) => JSON.stringify(r)).join('\n')}\n... (${count - 10} more) ...\n${data.slice(-5).map((r) => JSON.stringify(r)).join('\n')}`
    }
    return `${prefix}${func}: ${JSON.stringify(data).slice(0, 2000)}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({ source: 'akshare', tool: 'DataStore', action: 'akshare', endpoint: func, status: 0, success: false, duration_ms: Date.now() - startedAt, error: msg })
    return toolError(dataStoreRemoteCopy.akshareCallFailed(msg))
  }
}

export async function marginTrading(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const startedAt = Date.now()
  const params = (input.params as Record<string, unknown>) ?? {}
  const code = String(input.code ?? input.symbol ?? params.code ?? params.symbol ?? '')
  const date = String(input.date ?? params.date ?? '')
  if (code) params.code = code
  if (date) params.date = date
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value != null) qs.set(key, String(value))
  const url = `http://127.0.0.1:19800/margin${qs.toString() ? `?${qs}` : ''}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const json = await safeJson(res) as Record<string, unknown>
    if (!res.ok || json?.error) {
      const error = json?.error ?? JSON.stringify(json).slice(0, 500)
      ds.saveApiCall({
        source: 'akshare',
        provider: 'akshare',
        interface_id: 'market.margin_trading',
        capability_id: 'akshare.market.margin_trading',
        tool: 'DataStore',
        action: 'margin_trading',
        endpoint: 'margin',
        status: res.status,
        success: false,
        duration_ms: Date.now() - startedAt,
        error: String(error).slice(0, 500),
      })
      return toolError(`AkShare margin trading failed: ${String(error).slice(0, 500)}`)
    }
    const ingestion = input.persist !== false
      ? ingestEndpointResult(ds, {
        provider: 'akshare',
        endpoint: 'margin',
        payload: json,
        params,
        code,
        source: 'akshare',
        request: { action: 'margin_trading', code, params },
      })
      : null
    ds.saveApiCall({
      source: 'akshare',
      provider: 'akshare',
      interface_id: 'market.margin_trading',
      capability_id: 'akshare.market.margin_trading',
      tool: 'DataStore',
      action: 'margin_trading',
      endpoint: 'margin',
      status: res.status,
      success: true,
      duration_ms: Date.now() - startedAt,
    })
    const prefix = ingestion ? `${formatIngestionResult(ingestion)}\n` : ''
    const rows = ds.queryMarginTradingRows({ code: code || undefined, tradeDate: date || undefined, provider: 'akshare', limit: Number(input.limit ?? 30) })
    if (rows.length === 0) return `${prefix}margin_trading: 0 persisted rows`
    return `${prefix}margin_trading (${rows.length} rows):\n${rows.map((r) => `${r.trade_date} ${r.code} ${r.name ?? ''} financingBuy:${r.financing_buy ?? '-'} financingBal:${r.financing_balance ?? '-'} shortSellVol:${r.margin_sell_volume ?? '-'} total:${r.total_balance ?? '-'}`).join('\n')}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({
      source: 'akshare',
      provider: 'akshare',
      interface_id: 'market.margin_trading',
      capability_id: 'akshare.market.margin_trading',
      tool: 'DataStore',
      action: 'margin_trading',
      endpoint: 'margin',
      status: 0,
      success: false,
      duration_ms: Date.now() - startedAt,
      error: msg,
    })
    return toolError(`AkShare margin trading failed: ${msg}`)
  }
}

export async function callTushare(ds: DataStore, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const apiName = String(input.api_name ?? input.func ?? '')
  if (!apiName) return toolError(dataStoreRemoteCopy.tushareMissingApiName())
  const token = String(ctx.getConfigValue?.('TUSHARE_TOKEN') ?? '').trim()
  if (!token) return toolError(dataStoreRemoteCopy.tushareKeyMissing())

  const params = normalizeTushareParams(input)
  const fields = input.fields == null || input.fields === '' ? undefined : String(input.fields)
  const startedAt = Date.now()

  try {
    const data = await tushareCall(token, apiName, params, fields)
    if (!isKnownProviderSchema('tushare', apiName)) {
      return toolError(unknownSchemaMessage('tushare', apiName))
    }
    const ingestion = input.persist !== false
      ? ingestEndpointResult(ds, { provider: 'tushare', endpoint: apiName, payload: { data }, params, code: String(input.code ?? params.ts_code ?? params.code ?? ''), source: 'tushare', request: { action: 'tushare', api_name: apiName, params, fields } })
      : null
    const prefix = ingestion ? `${formatIngestionResult(ingestion)}\n` : ''
    const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
    const preview = data.slice(0, limit).map((row) => JSON.stringify(row)).join('\n')
    const truncated = data.length > limit ? `\n... (${data.length - limit} more rows)` : ''
    return `${prefix}${apiName}: ${data.length} rows\n${preview}${truncated}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({ source: 'tushare', tool: 'DataStore', action: 'tushare', endpoint: apiName, status: 0, success: false, duration_ms: Date.now() - startedAt, error: msg })
    if (msg.startsWith('TUSHARE_RATE_LIMIT')) return toolError(dataStoreRemoteCopy.tushareRateLimit(msg))
    return toolError(dataStoreRemoteCopy.tushareCallFailed(msg))
  }
}

export async function callTdx(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const tdxAction = String(input.tdx_action ?? '')
  if (!tdxAction) return toolError(dataStoreRemoteCopy.tdxMissingAction())
  const startedAt = Date.now()

  let gotdxUrl: string
  try {
    const { getGotdxUrl } = await import('../../main/sidecar')
    gotdxUrl = getGotdxUrl() ?? ''
  } catch {
    gotdxUrl = ''
  }
  if (!gotdxUrl) {
    const msg = dataStoreRemoteCopy.gotdxUnavailable()
    ds.saveApiCall({ source: 'tdx', tool: 'DataStore', action: 'tdx', endpoint: tdxAction, status: 0, success: false, duration_ms: Date.now() - startedAt, error: msg })
    return toolError(msg)
  }

  const code = String(input.code ?? '')
  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  if (code) qs.set('code', code)
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))

  const url = `${gotdxUrl}/${tdxAction}${qs.toString() ? `?${qs}` : ''}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const body = await res.text()
      ds.saveApiCall({ source: 'tdx', tool: 'DataStore', action: 'tdx', endpoint: tdxAction, status: res.status, success: false, duration_ms: Date.now() - startedAt, error: body.slice(0, 500) })
      return toolError(dataStoreRemoteCopy.tdxError(res.status, body))
    }
    const data = await res.json()
    const ingestion = input.persist !== false
      ? ingestEndpointResult(ds, { provider: 'tdx', endpoint: tdxAction, payload: data, params, code, request: { action: 'tdx', tdx_action: tdxAction, code, params } })
      : null
    const prefix = ingestion ? `${formatIngestionResult(ingestion)}\n` : ''
    if (!ingestion && !isKnownProviderSchema('tdx', tdxAction)) {
      return toolError(unknownSchemaMessage('tdx', tdxAction))
    }
    return prefix + JSON.stringify(normalizeTdxEndpoint(tdxAction, data, { code, ...params }), null, 2).slice(0, 3000)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({ source: 'tdx', tool: 'DataStore', action: 'tdx', endpoint: tdxAction, status: 0, success: false, duration_ms: Date.now() - startedAt, error: msg })
    return toolError(dataStoreRemoteCopy.tdxCallFailed(msg))
  }
}

export async function callYfinance(ds: DataStore, input: Record<string, unknown>): Promise<string> {
  const func = String(input.func ?? '')
  if (!func) return toolError(dataStoreRemoteCopy.yfinanceMissingFunc())
  const startedAt = Date.now()
  const symbol = String(input.symbol ?? input.code ?? '')
  if (!symbol) return toolError(dataStoreRemoteCopy.yfinanceMissingSymbol())

  const params = (input.params as Record<string, unknown>) ?? {}
  const qs = new URLSearchParams()
  qs.set('symbol', symbol)
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))

  const url = `http://127.0.0.1:19800/yfinance/${func}?${qs}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      const body = await res.text()
      ds.saveApiCall({ source: 'yfinance', tool: 'DataStore', action: 'yfinance', endpoint: func, status: res.status, success: false, duration_ms: Date.now() - startedAt, error: body.slice(0, 500) })
      return toolError(dataStoreRemoteCopy.yfinanceError(res.status, body.slice(0, 500)))
    }
    const json = await res.json() as Record<string, unknown>
    if (json.error) {
      ds.saveApiCall({ source: 'yfinance', tool: 'DataStore', action: 'yfinance', endpoint: func, status: 0, success: false, duration_ms: Date.now() - startedAt, error: String(json.error).slice(0, 500) })
      return toolError(dataStoreRemoteCopy.yfinanceErrorText(String(json.error)))
    }
    const ingestion = input.persist !== false
      ? ingestEndpointResult(ds, { provider: 'yfinance', endpoint: func, payload: json, params, code: symbol, source: 'yfinance', request: { action: 'yfinance', func, symbol, params } })
      : null
    const prefix = ingestion ? `${formatIngestionResult(ingestion)}\n` : ''
    if (!ingestion && !isKnownProviderSchema('yfinance', func)) {
      return toolError(unknownSchemaMessage('yfinance', func))
    }
    const data = json.data
    if (!data) return prefix + JSON.stringify(json).slice(0, 3000)
    if (Array.isArray(data)) {
      const count = data.length
      const cols = Array.isArray(json.columns) ? `Columns: ${json.columns.join(', ')}\n` : ''
      if (count <= 20) return `${prefix}${cols}${symbol} ${func}: ${count} rows\n${data.map((r) => JSON.stringify(r)).join('\n')}`
      return `${prefix}${cols}${symbol} ${func}: ${count} rows\n${data.slice(0, 5).map((r) => JSON.stringify(r)).join('\n')}\n... (${count - 10} more) ...\n${data.slice(-5).map((r) => JSON.stringify(r)).join('\n')}`
    }
    if (typeof data === 'object') {
      const entries = Object.entries(data)
      if (entries.length <= 30) return `${prefix}${symbol} ${func}:\n${entries.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
      return `${prefix}${symbol} ${func} (${entries.length} fields):\n${entries.slice(0, 30).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n  ... (${entries.length - 30} more)`
    }
    return `${prefix}${symbol} ${func}: ${String(data).slice(0, 2000)}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ds.saveApiCall({ source: 'yfinance', tool: 'DataStore', action: 'yfinance', endpoint: func, status: 0, success: false, duration_ms: Date.now() - startedAt, error: msg })
    return toolError(dataStoreRemoteCopy.yfinanceCallFailed(msg))
  }
}
