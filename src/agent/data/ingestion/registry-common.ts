import { createHash } from 'crypto'
import type { DataStore, QuoteSnapshotRow } from '../store/data-store'
import type { IngestionRequest, IngestionResult } from './registry'

export function saveRawPayload(store: DataStore, request: IngestionRequest, isError: boolean): void {
  const createdAt = new Date().toISOString()
  const requestJson = JSON.stringify(request.request ?? {
    provider: request.provider,
    endpoint: request.endpoint,
    params: request.params ?? {},
    code: request.code ?? null,
  })
  store.saveRawApiPayload({
    source: request.provider,
    endpoint: request.endpoint,
    request_hash: sha256(requestJson),
    request_json: requestJson,
    response_json: safeJson(request.payload),
    is_error: isError,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  })
}

export function result(request: IngestionRequest, schema: string, table: string, count: number): IngestionResult {
  return { persisted: true, rawSaved: false, provider: request.provider, endpoint: request.endpoint, schema, table, count }
}

export function outputOnlyResult(request: IngestionRequest, schema: string, warning: string): IngestionResult {
  return { persisted: false, rawSaved: false, provider: request.provider, endpoint: request.endpoint, schema, table: 'output_only', count: 0, warning }
}

export function quoteSnapshotFromRecord(q: Record<string, unknown>, source: string): QuoteSnapshotRow | null {
  const code = stringField(q, ['code', 'Code'])
  if (!code) return null
  const fetchedAt = new Date().toISOString()
  return {
    code,
    timestamp: normalizeSnapshotTimestamp(q) ?? fetchedAt,
    fetched_at: fetchedAt,
    source,
    name: stringField(q, ['name', 'Name']) ?? code,
    price: numberField(q, ['price', 'Price']),
    change: numberField(q, ['change', 'Change']),
    change_pct: numberField(q, ['changePct', 'change_pct']),
    open: numberField(q, ['open', 'Open']),
    high: numberField(q, ['high', 'High']),
    low: numberField(q, ['low', 'Low']),
    prev_close: numberField(q, ['prevClose', 'prev_close', 'PreClose']),
    volume: numberField(q, ['volume', 'Volume', 'Vol']),
    amount: numberField(q, ['amount', 'Amount']),
    pe: numberField(q, ['pe', 'PE']),
    pb: numberField(q, ['pb', 'PB']),
    market_cap: numberField(q, ['market_cap', 'marketCap', 'MarketCap']),
    turnover_rate: numberField(q, ['turnover_rate', 'turnoverRate', 'TurnoverRate']),
    raw_json: safeJson(q),
  }
}

export function normalizeSnapshotTimestamp(q: Record<string, unknown>): string | null {
  return normalizeTimestamp(stringField(q, [
    'timestamp', 'Timestamp', 'trade_time', 'tradeTime', 'time', 'Time',
    'DateTime', 'datetime', 'dateTime', 'trade_date', 'tradeDate', 'date', 'Date',
  ]))
}

export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  const spaced = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/)
  if (spaced) return `${spaced[1]}T${spaced[2]}.000Z`
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  const dateOnly = normalizeDate(trimmed)
  if (dateOnly) return `${dateOnly}T00:00:00.000Z`
  const dt = splitDateTime(trimmed)
  if (dt.date && dt.time) return `${dt.date}T${dt.time}.000Z`
  if (dt.date) return `${dt.date}T00:00:00.000Z`
  return null
}

export function booleanField(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (value === true) return 1
    if (value === false) return 0
    if (value === 1 || value === '1' || value === 'true') return 1
    if (value === 0 || value === '0' || value === 'false') return 0
  }
  return null
}

export function amountWanDiff(row: Record<string, unknown>, buyKey: string, sellKey: string): number {
  return (numberField(row, [buyKey]) ?? 0) - (numberField(row, [sellKey]) ?? 0)
}

export function inferOptionExpiry(contractSymbol: string): string {
  const match = contractSymbol.match(/(\d{6})[CP]/)
  if (!match) return 'unknown'
  const raw = match[1]
  const year = Number(raw.slice(0, 2)) + 2000
  return `${year}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`
}

export function stripTushareCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = String(raw).trim()
  if (!value) return null
  return value.split('.')[0].replace(/^(SH|SZ|BJ)/i, '')
}

export function tushareSuffix(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parts = String(raw).split('.')
  return parts.length > 1 ? parts[1].toUpperCase() : null
}

export function cleanCode(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = String(value).replace(/^(sh|sz|bj|csi)/i, '').replace(/\.([A-Z]+)$/i, '').trim()
  return cleaned || null
}

export function normalizeEventTime(value: string | null | undefined): string | null {
  if (!value) return null
  return normalizeTime(String(value))
}

export function normalizeAdjust(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'qfq' || raw === '1') return 'qfq'
  if (raw === 'hfq' || raw === '2') return 'hfq'
  return 'none'
}

export function flowRankPeriodForIndicator(indicator: string): string {
  if (indicator === '3日') return '3day'
  if (indicator === '5日') return '5day'
  if (indicator === '10日') return '10day'
  return 'today'
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function stringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value != null && value !== '') return String(value)
  }
  return null
}

export function numberField(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (value == null || value === '' || value === '-') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function splitDateTime(raw: string): { date: string | null; time: string | null } {
  const value = String(raw ?? '').trim()
  if (!value) return { date: null, time: null }
  const compact = value.replaceAll('/', '-')
  const match = compact.match(/^(\d{4}-?\d{2}-?\d{2})[ T]?(.+)$/)
  if (match) return { date: normalizeDate(match[1]), time: normalizeTime(match[2]) }
  return { date: null, time: normalizeTime(compact) }
}

export function normalizeTime(raw: string): string | null {
  const value = raw.trim()
  const match = value.match(/(\d{1,2}):?(\d{2})(?::?(\d{2}))?/)
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}:${(match[3] ?? '00').padStart(2, '0')}`
}

export function normalizeDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const value = String(raw).slice(0, 10).replaceAll('/', '-')
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const compact = String(raw).replace(/\D/g, '')
  if (compact.length >= 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  return null
}

export function normalizeTdxStockMarket(code: string, market?: string | null): string {
  const value = String(market ?? '').trim().toLowerCase()
  if (value === '1' || value === 'sh' || code.startsWith('6')) return 'SH'
  if (value === '0' || value === 'sz') return 'SZ'
  if (value === '2' || value === 'bj' || code.startsWith('8') || code.startsWith('4')) return 'BJ'
  return code.startsWith('6') ? 'SH' : 'SZ'
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function safeJson(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
