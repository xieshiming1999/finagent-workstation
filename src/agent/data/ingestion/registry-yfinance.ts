import type { DataStore, KlineRow, QuoteSnapshotRow } from '../store/data-store'
import type { IngestionRequest, IngestionResult } from './registry'
import {
  asRecord,
  booleanField,
  inferOptionExpiry,
  normalizeDate,
  numberField,
  quoteSnapshotFromRecord,
  result,
  safeJson,
  sha256,
  stringField,
} from './registry-common'

export function ingestYfinance(store: DataStore, request: IngestionRequest, source: string): IngestionResult | null {
  const endpoint = request.endpoint
  const payload = request.payload as any
  const data = payload?.data
  const code = request.code ?? stringField(asRecord(payload) ?? {}, ['symbol']) ?? stringField(request.params ?? {}, ['symbol'])

  if (endpoint === 'fast_info') {
    const row = normalizeYfinanceFastInfo(asRecord(data), code, source)
    if (!row) return null
    store.saveQuoteSnapshots([row])
    return result(request, 'quote_snapshot', 'quote_snapshot', 1)
  }
  if (endpoint === 'history') {
    const rows = (Array.isArray(data) ? data : []).map((row) => normalizeYfinanceHistoryRow(row, code, request, source)).filter((row): row is KlineRow => !!row)
    store.saveKline(rows)
    return result(request, 'kline_daily', 'kline_daily', rows.length)
  }
  if (['info', 'get_info'].includes(endpoint)) {
    const rows = normalizeYfinanceProfileFields(asRecord(data), code, source)
    store.saveYfinanceProfileFields(rows)
    return result(request, 'yfinance_profile_fields', 'yfinance_profile_fields', rows.length)
  }
  if (isYfinanceStatementEndpoint(endpoint)) {
    const rows = normalizeYfinanceStatementItems(data, code, endpoint, source)
    store.saveYfinanceStatementItems(rows)
    return result(request, 'yfinance_statement_items', 'yfinance_statement_items', rows.length)
  }
  if (['recommendations', 'recommendations_summary', 'upgrades_downgrades'].includes(endpoint)) {
    const rows = normalizeYfinanceRecommendations(data, code, source)
    store.saveYfinanceRecommendations(rows)
    return result(request, 'yfinance_recommendations', 'yfinance_recommendations', rows.length)
  }
  if (endpoint === 'news') {
    const rows = normalizeYfinanceNews(data, code, source)
    store.saveYfinanceNews(rows)
    return result(request, 'yfinance_news', 'yfinance_news', rows.length)
  }
  if (endpoint === 'options') {
    const rows = normalizeYfinanceOptionExpiries(data, code, source)
    store.saveYfinanceOptionExpiries(rows)
    return result(request, 'yfinance_option_expiries', 'yfinance_option_expiries', rows.length)
  }
  if (endpoint === 'option_chain') {
    const rows = normalizeYfinanceOptionContracts(payload, code, normalizeDate(request.params?.date) ?? '', source)
    store.saveYfinanceOptionContracts(rows)
    return result(request, 'yfinance_option_contracts', 'yfinance_option_contracts', rows.length)
  }
  if (['actions', 'dividends', 'splits', 'capital_gains'].includes(endpoint)) {
    const rows = normalizeYfinanceCorporateActions(data, code, endpoint, source)
    store.saveYfinanceCorporateActions(rows)
    return result(request, 'yfinance_corporate_actions', 'yfinance_corporate_actions', rows.length)
  }
  if (['institutional_holders', 'mutualfund_holders', 'major_holders'].includes(endpoint)) {
    const rows = normalizeYfinanceHolders(data, code, endpoint, source)
    store.saveYfinanceHolders(rows)
    return result(request, 'yfinance_holders', 'yfinance_holders', rows.length)
  }
  if (endpoint === 'insider_transactions') {
    const rows = normalizeYfinanceInsiderTransactions(data, code, source)
    store.saveYfinanceInsiderTransactions(rows)
    return result(request, 'yfinance_insider_transactions', 'yfinance_insider_transactions', rows.length)
  }
  return null
}

function normalizeYfinanceFastInfo(data: Record<string, unknown> | null, code: string | null | undefined, source: string): QuoteSnapshotRow | null {
  if (!data || !code) return null
  const price = numberField(data, ['lastPrice', 'regularMarketPrice', 'currentPrice', 'price'])
  const prevClose = numberField(data, ['previousClose', 'regularMarketPreviousClose', 'prevClose'])
  const change = price != null && prevClose != null ? price - prevClose : null
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null
  return {
    code,
    source,
    name: stringField(data, ['shortName', 'longName', 'name']) ?? code,
    price,
    change,
    change_pct: changePct,
    open: numberField(data, ['open', 'regularMarketOpen']),
    high: numberField(data, ['dayHigh', 'regularMarketDayHigh', 'high']),
    low: numberField(data, ['dayLow', 'regularMarketDayLow', 'low']),
    prev_close: prevClose,
    volume: numberField(data, ['lastVolume', 'regularMarketVolume', 'volume']),
    market_cap: numberField(data, ['marketCap']),
    raw_json: safeJson(data),
  }
}

function isYfinanceStatementEndpoint(endpoint: string): boolean {
  return ['financials', 'quarterly_financials', 'income_stmt', 'quarterly_income_stmt', 'balance_sheet', 'balancesheet', 'quarterly_balance_sheet', 'quarterly_balancesheet', 'cash_flow', 'cashflow', 'quarterly_cash_flow', 'quarterly_cashflow', 'earnings_dates', 'earnings_estimate', 'earnings_history', 'eps_revisions', 'eps_trend'].includes(endpoint)
}

function normalizeYfinanceProfileFields(data: Record<string, unknown> | null, code: string | null | undefined, source: string): Array<Record<string, unknown>> {
  if (!data || !code) return []
  const updatedAt = new Date().toISOString()
  return Object.entries(data).map(([key, value]) => ({
    symbol: code, field_key: key, field_value: value == null ? null : typeof value === 'object' ? safeJson(value) : String(value),
    field_type: Array.isArray(value) ? 'array' : value == null ? 'null' : typeof value, source, updated_at: updatedAt, raw_json: safeJson({ [key]: value }),
  }))
}

function normalizeYfinanceStatementItems(data: unknown, code: string | null | undefined, endpoint: string, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const rows = Array.isArray(data) ? data : []
  const updatedAt = new Date().toISOString()
  const out: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const r = asRecord(row)
    if (!r) continue
    const item = stringField(r, ['_index', 'index', 'metric', 'item']) ?? 'unknown'
    for (const [period, value] of Object.entries(r)) {
      if (['_index', 'index', 'metric', 'item'].includes(period)) continue
      const n = Number(value)
      out.push({ symbol: code, statement_type: endpoint, period: normalizeDate(period) ?? period, item, value: Number.isFinite(n) ? n : null, source, updated_at: updatedAt, raw_json: safeJson({ item, period, value }) })
    }
  }
  return out
}

function normalizeYfinanceRecommendations(data: unknown, code: string | null | undefined, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  return (Array.isArray(data) ? data : []).map((row) => {
    const r = asRecord(row) ?? {}
    return {
      symbol: code,
      period: stringField(r, ['period', 'Period', '_index']) ?? 'unknown',
      strong_buy: numberField(r, ['strongBuy', 'strong_buy', 'Strong Buy']),
      buy: numberField(r, ['buy', 'Buy']),
      hold: numberField(r, ['hold', 'Hold']),
      sell: numberField(r, ['sell', 'Sell']),
      strong_sell: numberField(r, ['strongSell', 'strong_sell', 'Strong Sell']),
      source,
      updated_at: updatedAt,
      raw_json: safeJson(row),
    }
  }).filter((row) => row.period)
}

function normalizeYfinanceNews(data: unknown, code: string | null | undefined, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  return (Array.isArray(data) ? data : []).map((row, index) => {
    const r = asRecord(row) ?? {}
    const content = asRecord(r.content) ?? r
    const click = asRecord(content.clickThroughUrl) ?? asRecord(content.canonicalUrl)
    const thumbnail = asRecord(content.thumbnail)
    return {
      symbol: code,
      news_id: stringField(r, ['id']) ?? stringField(content, ['id']) ?? sha256(safeJson(row)),
      title: stringField(content, ['title']),
      publisher: stringField(content, ['provider', 'publisher']) ?? stringField(asRecord(content.provider) ?? {}, ['displayName']),
      published_at: stringField(content, ['pubDate', 'displayTime']) ?? String(index),
      link: stringField(click ?? {}, ['url']) ?? stringField(thumbnail ?? {}, ['originalUrl']),
      summary: stringField(content, ['summary', 'description']),
      source,
      updated_at: updatedAt,
      raw_json: safeJson(row),
    }
  })
}

function normalizeYfinanceOptionExpiries(data: unknown, code: string | null | undefined, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  return (Array.isArray(data) ? data : []).map((expiry) => ({ symbol: code, expiry_date: normalizeDate(expiry) ?? String(expiry), source, updated_at: updatedAt })).filter((row) => row.expiry_date)
}

function normalizeYfinanceOptionContracts(payload: Record<string, unknown>, code: string | null | undefined, expiry: string, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  const out: Array<Record<string, unknown>> = []
  for (const optionType of ['calls', 'puts'] as const) {
    const rows = Array.isArray(payload[optionType]) ? payload[optionType] as unknown[] : []
    for (const row of rows) {
      const r = asRecord(row)
      const contract = r ? stringField(r, ['contractSymbol']) : null
      if (!r || !contract) continue
      out.push({
        symbol: code, expiry_date: expiry || inferOptionExpiry(contract), option_type: optionType === 'calls' ? 'call' : 'put',
        contract_symbol: contract, strike: numberField(r, ['strike']), last_price: numberField(r, ['lastPrice']), bid: numberField(r, ['bid']), ask: numberField(r, ['ask']),
        change: numberField(r, ['change']), percent_change: numberField(r, ['percentChange']), volume: numberField(r, ['volume']),
        open_interest: numberField(r, ['openInterest']), implied_volatility: numberField(r, ['impliedVolatility']), in_the_money: booleanField(r, ['inTheMoney']),
        currency: stringField(r, ['currency']), last_trade_date: stringField(r, ['lastTradeDate']), source, updated_at: updatedAt, raw_json: safeJson(row),
      })
    }
  }
  return out
}

function normalizeYfinanceCorporateActions(data: unknown, code: string | null | undefined, endpoint: string, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  const out: Array<Record<string, unknown>> = []
  if (Array.isArray(data)) {
    for (const row of data) {
      const r = asRecord(row)
      if (!r) continue
      const date = normalizeDate(stringField(r, ['_index', 'date', 'Date']))
      if (!date) continue
      if (endpoint === 'dividends') {
        const value = numberField(r, ['amount', 'dividend', 'value'])
        if (value != null && value !== 0) {
          out.push({ symbol: code, action_type: 'dividend', action_date: date, value, source, updated_at: updatedAt, raw_json: safeJson(row) })
        }
        continue
      }
      if (endpoint === 'splits') {
        const value = splitRatioValue(r)
        if (value != null && value !== 0) {
          out.push({ symbol: code, action_type: 'split', action_date: date, value, source, updated_at: updatedAt, raw_json: safeJson(row) })
        }
        continue
      }
      for (const [key, value] of Object.entries(r)) {
        if (['_index', 'date', 'Date'].includes(key)) continue
        const n = Number(value)
        if (!Number.isFinite(n) || n === 0) continue
        out.push({ symbol: code, action_type: key, action_date: date, value: n, source, updated_at: updatedAt, raw_json: safeJson(row) })
      }
    }
    return out
  }
  const r = asRecord(data)
  if (!r) return []
  for (const [dateKey, value] of Object.entries(r)) {
    const date = normalizeDate(dateKey)
    const n = Number(value)
    if (!date || !Number.isFinite(n)) continue
    out.push({ symbol: code, action_type: endpoint, action_date: date, value: n, source, updated_at: updatedAt, raw_json: safeJson({ [dateKey]: value }) })
  }
  return out
}

function splitRatioValue(row: Record<string, unknown>): number | null {
  const direct = numberField(row, ['ratio', 'value', 'split'])
  if (direct != null) return direct
  const rawRatio = stringField(row, ['splitRatio', 'ratioText'])
  if (rawRatio?.includes(':')) {
    const [left, right] = rawRatio.split(':').map((part) => Number(part.trim()))
    if (Number.isFinite(left) && Number.isFinite(right) && right !== 0) return left / right
  }
  const numerator = numberField(row, ['numerator'])
  const denominator = numberField(row, ['denominator'])
  if (numerator != null && denominator != null && denominator !== 0) return numerator / denominator
  return null
}

function normalizeYfinanceHolders(data: unknown, code: string | null | undefined, endpoint: string, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  return (Array.isArray(data) ? data : []).map((row, index) => {
    const r = asRecord(row) ?? {}
    return {
      symbol: code,
      holder_type: endpoint,
      holder_name: stringField(r, ['Holder', 'holder', 'Name', 'name', '_index']) ?? `holder#${index + 1}`,
      reported_date: normalizeDate(stringField(r, ['Date Reported', 'dateReported', 'reportedDate', '_index'])) ?? 'unknown',
      pct_held: numberField(r, ['pctHeld', 'pct_held']),
      shares: numberField(r, ['Shares', 'shares']),
      value: numberField(r, ['Value', 'value']),
      pct_change: numberField(r, ['pctChange', 'pct_change']),
      source,
      updated_at: updatedAt,
      raw_json: safeJson(row),
    }
  })
}

function normalizeYfinanceInsiderTransactions(data: unknown, code: string | null | undefined, source: string): Array<Record<string, unknown>> {
  if (!code) return []
  const updatedAt = new Date().toISOString()
  return (Array.isArray(data) ? data : []).map((row) => {
    const r = asRecord(row) ?? {}
    return {
      symbol: code,
      transaction_id: sha256(safeJson(row)),
      insider: stringField(r, ['Insider', 'insider']),
      position: stringField(r, ['Position', 'position']),
      transaction_text: stringField(r, ['Text', 'text', 'Transaction', 'transaction']),
      start_date: normalizeDate(stringField(r, ['Start Date', 'startDate', 'Date', 'date'])) ?? stringField(r, ['Start Date', 'startDate']),
      ownership: stringField(r, ['Ownership', 'ownership']),
      shares: numberField(r, ['Shares', 'shares']),
      value: numberField(r, ['Value', 'value']),
      source,
      updated_at: updatedAt,
      raw_json: safeJson(row),
    }
  })
}

function normalizeYfinanceHistoryRow(row: unknown, code: string | null | undefined, request: IngestionRequest, source: string): KlineRow | null {
  const r = asRecord(row)
  if (!r || !code) return null
  const date = normalizeDate(stringField(r, ['_index', 'Date', 'date', 'Datetime', 'datetime']))
  const open = numberField(r, ['Open', 'open'])
  const high = numberField(r, ['High', 'high'])
  const low = numberField(r, ['Low', 'low'])
  const close = numberField(r, ['Close', 'close'])
  if (!date || open == null || high == null || low == null || close == null) return null
  return {
    code, date, open, high, low, close,
    volume: numberField(r, ['Volume', 'volume']),
    amount: null, change_pct: null, turnover_rate: null,
    adjust: String(request.params?.adjust ?? (request.params?.auto_adjust === 'true' ? 'auto' : 'none')),
    source,
  }
}
