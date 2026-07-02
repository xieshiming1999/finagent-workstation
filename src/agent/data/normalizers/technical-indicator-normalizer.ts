import { createHash } from 'crypto'
import type { TechnicalIndicatorSeriesRow } from '../store/data-store-types'
import type { NormalizedTechnicalIndicatorResult } from '../output-only-interfaces'

type Row = Record<string, unknown>

export interface TechnicalIndicatorPersistenceResult {
  interfaceId: 'technical.indicator_series'
  schemaId: 'technical_indicator_series'
  provider: 'ta'
  capabilityId: string
  cacheStatus: 'provider-hit'
  canonicalTable: 'technical_indicator_series'
  sourceDataTime: string | null
  fetchedAt: string
  rows: TechnicalIndicatorSeriesRow[]
}

export function normalizeTechnicalIndicatorSeries(
  normalized: NormalizedTechnicalIndicatorResult,
): TechnicalIndicatorPersistenceResult {
  const data = normalized.data as {
    indicator?: unknown
    symbol?: unknown
    parameters?: unknown
    series?: unknown
  }
  const indicator = String(data.indicator ?? normalized.action)
  const symbol = String(data.symbol ?? '')
  const params = isRecord(data.parameters) ? data.parameters : {}
  const paramsJson = JSON.stringify(params)
  const paramsHash = createHash('sha1').update(paramsJson).digest('hex')
  const fetchedAt = normalized.provenance.fetchedAt
  const rows: TechnicalIndicatorSeriesRow[] = []

  for (const point of Array.isArray(data.series) ? data.series : []) {
    if (!isRecord(point)) continue
    const sourceDate = String(point.timestamp ?? '')
    if (!sourceDate) continue
    const values = isRecord(point.values) ? point.values : {}
    for (const [fieldName, value] of Object.entries(values)) {
      if (fieldName === 'date' || fieldName === 'timestamp') continue
      const numeric = numberOrNull(value)
      if (numeric == null) continue
      rows.push({
        provider: 'ta',
        capability_id: normalized.provenance.capabilityId,
        source_action: normalized.provenance.sourceAction,
        symbol,
        indicator,
        field_name: fieldName,
        params_hash: paramsHash,
        source_date: sourceDate,
        value: numeric,
        fetched_at: fetchedAt,
        params_json: paramsJson,
        raw_json: JSON.stringify(point.values),
      })
    }
  }

  return {
    interfaceId: 'technical.indicator_series',
    schemaId: 'technical_indicator_series',
    provider: 'ta',
    capabilityId: normalized.provenance.capabilityId,
    cacheStatus: 'provider-hit',
    canonicalTable: 'technical_indicator_series',
    sourceDataTime: rows[rows.length - 1]?.source_date ?? null,
    fetchedAt,
    rows,
  }
}

function isRecord(value: unknown): value is Row {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
