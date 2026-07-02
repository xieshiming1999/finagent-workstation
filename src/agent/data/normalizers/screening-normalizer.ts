import type { MarketScreeningSnapshotRow } from '../store/data-store-types'

type Row = Record<string, unknown>

export interface ScreeningNormalizationInput {
  provider: string
  capabilityId: string
  sourceAction: string
  universe: unknown[]
  filters?: Record<string, unknown>
  sort?: Record<string, unknown>
  rows: Row[]
  screenedAt?: string
  fetchedAt?: string
}

export interface ScreeningNormalizationResult {
  action: 'market_screening'
  interfaceId: 'market.screening'
  schemaId: 'screening_result'
  provider: string
  capabilityId: string
  status: 'success' | 'empty'
  persistencePolicy: 'canonical'
  data: {
    provider: string
    universe: string[]
    filters: Record<string, unknown>
    sort: Record<string, unknown>
    rows: Array<{ symbol: string; name: string | null; market: string | null; rank: number | null; score: number | null; fields: Row }>
  }
  persistenceRows: MarketScreeningSnapshotRow[]
}

export function normalizeScreeningSnapshot(input: ScreeningNormalizationInput): ScreeningNormalizationResult {
  const screenedAt = input.screenedAt ?? new Date().toISOString()
  const fetchedAt = input.fetchedAt ?? screenedAt
  const universe = input.universe.map((item) => String(item)).filter(Boolean)
  const filters = input.filters ?? {}
  const sort = input.sort ?? {}
  const rows = input.rows.map((row, index) => normalizeScreeningRow(row, index + 1))
  return {
    action: 'market_screening',
    interfaceId: 'market.screening',
    schemaId: 'screening_result',
    provider: input.provider,
    capabilityId: input.capabilityId,
    status: rows.length ? 'success' : 'empty',
    persistencePolicy: 'canonical',
    data: {
      provider: input.provider,
      universe,
      filters,
      sort,
      rows,
    },
    persistenceRows: rows
      .filter((row) => row.symbol)
      .map((row) => ({
        provider: input.provider,
        capability_id: input.capabilityId,
        source_action: input.sourceAction,
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        rank: row.rank,
        score: row.score,
        screened_at: screenedAt,
        fetched_at: fetchedAt,
        universe_json: JSON.stringify(universe),
        filters_json: JSON.stringify(filters),
        sort_json: JSON.stringify(sort),
        fields_json: JSON.stringify(row.fields),
        raw_json: JSON.stringify(row.fields),
      })),
  }
}

function normalizeScreeningRow(row: Row, fallbackRank: number): ScreeningNormalizationResult['data']['rows'][number] {
  return {
    symbol: String(row.symbol ?? row.ticker ?? row.code ?? ''),
    name: nullableString(row.name),
    market: nullableString(row.market),
    rank: numberOrNull(row.rank ?? row.position ?? fallbackRank),
    score: numberOrNull(row.score ?? row.composite_score ?? row['Recommend.All']),
    fields: row,
  }
}

function nullableString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value)
  return text ? text : null
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
