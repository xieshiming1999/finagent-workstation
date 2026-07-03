export interface FinanceKlineResult {
  code: string
  source: string | null
  rows: Array<Record<string, unknown>>
}

export function parseFinanceKlineResult(value: string): FinanceKlineResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.contract !== 'market-kline-result-v1') return null
  if (parsed.action !== 'kline' && parsed.action !== 'query_kline') return null
  if (typeof parsed.code !== 'string' || !Array.isArray(parsed.rows)) return null
  const rows = parsed.rows.filter(isRecord)
  if (rows.length !== parsed.rows.length) return null
  const source = typeof parsed.source === 'string'
    ? parsed.source
    : isRecord(parsed.provenance)
      ? typeof parsed.provenance.provider === 'string'
        ? parsed.provenance.provider
        : typeof parsed.provenance.source === 'string'
          ? parsed.provenance.source
          : null
      : null
  return { code: parsed.code, source, rows }
}

export function summarizeFinanceKlineWindow(value: string): string | null {
  const parsed = parseFinanceKlineResult(value)
  if (!parsed || parsed.rows.length === 0) return null
  const first = rowDate(parsed.rows[0])
  const last = rowDate(parsed.rows.at(-1))
  if (!first || !last) return null
  return `${first} ~ ${last}, ${parsed.rows.length} rows${parsed.source ? `, source: ${parsed.source}` : ''}`
}

function rowDate(row: Record<string, unknown> | undefined): string | null {
  return row && typeof row.date === 'string' && row.date.trim() ? row.date.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
