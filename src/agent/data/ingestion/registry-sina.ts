import type { DataStore } from '../store/data-store'
import type { IngestionRequest, IngestionResult } from './registry'
import { normalizeDate, numberField, result, safeJson, stringField, today } from './registry-common'

export function ingestSina(store: DataStore, request: IngestionRequest, source: string): IngestionResult | null {
  if (request.endpoint !== 'stock_transactions') return null
  const rows = normalizeSinaTransactionRows(request, source)
  store.saveTransactions(rows)
  return result(request, 'transactions', 'transactions', rows.length)
}

function normalizeSinaTransactionRows(request: IngestionRequest, source: string): Array<Record<string, unknown>> {
  const payloadRows = Array.isArray(request.payload)
    ? request.payload
    : Array.isArray((request.payload as Record<string, unknown> | null)?.data)
      ? ((request.payload as Record<string, unknown>).data as unknown[])
      : []
  const code = cleanCode(String(request.code ?? request.params?.code ?? request.params?.symbol ?? ''))
  const tradeDate = normalizeDate(request.params?.date ?? request.params?.tradeDate ?? today()) ?? today()
  const rows: Array<Record<string, unknown>> = []
  for (const item of payloadRows) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const price = numberField(row, ['price'])
    const volume = numberField(row, ['volume'])
    const time = stringField(row, ['ticktime']) ?? stringField(row, ['time'])
    const rowCode = cleanCode(stringField(row, ['symbol']) ?? stringField(row, ['code']) ?? code)
    if (!rowCode || !time) continue
    rows.push({
      code: rowCode,
      trade_date: tradeDate,
      time,
      price,
      volume,
      amount: price != null && volume != null ? price * volume : null,
      direction: normalizeSinaDirection(stringField(row, ['kind'])),
      source,
      raw_json: safeJson(row),
    })
  }
  return rows
}

function normalizeSinaDirection(kind: string | null): string {
  if (kind === 'U') return 'buy'
  if (kind === 'D') return 'sell'
  if (kind === 'E') return 'neutral'
  return kind ?? ''
}

function cleanCode(value: string): string {
  return value.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').trim()
}
