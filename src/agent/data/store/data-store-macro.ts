type Row = Record<string, unknown>

type StoreDeps = {
  exec(sql: string, ...params: unknown[]): void
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
}

const JSON_FIELDS = [
  'affected_assets',
  'affected_regions',
  'affected_sectors',
  'transmission_channels',
  'evidence_items',
  'macro_values',
  'retrieval_test',
] as const

export function saveMarketMovingFactors(store: StoreDeps, rows: Row[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO market_moving_factor (
        factor_id,family,title,summary,source_name,source_url,source_type,
        source_published_at,fetched_at,event_at,next_catalyst_at,
        affected_assets_json,affected_regions_json,affected_sectors_json,
        transmission_channels_json,expected_direction,severity,confidence,
        status,failure_class,evidence_items_json,macro_values_json,
        retrieval_test_json,raw_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      clean(row.factor_id),
      clean(row.family),
      clean(row.title),
      clean(row.summary),
      clean(row.source_name),
      clean(row.source_url),
      clean(row.source_type) || 'provider',
      clean(row.source_published_at),
      clean(row.fetched_at) || new Date().toISOString(),
      clean(row.event_at),
      clean(row.next_catalyst_at),
      encodeJson(row.affected_assets),
      encodeJson(row.affected_regions),
      encodeJson(row.affected_sectors),
      encodeJson(row.transmission_channels),
      clean(row.expected_direction),
      clean(row.severity),
      clean(row.confidence),
      clean(row.status) || 'watch',
      clean(row.failure_class),
      encodeJson(row.evidence_items),
      encodeJson(row.macro_values),
      encodeJson(row.retrieval_test),
      encodeJson(row.raw_json ?? row),
    )
  }
}

export function queryMarketMovingFactors(
  store: StoreDeps,
  opts: { family?: string; status?: string; source?: string; limit?: number } = {},
): Row[] {
  const where = ['1=1']
  const params: unknown[] = []
  if (opts.family) {
    where.push('family = ?')
    params.push(opts.family)
  }
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  }
  if (opts.source) {
    where.push('source_name = ?')
    params.push(opts.source)
  }
  params.push(opts.limit ?? 80)
  return store.query<Row>(
    `SELECT * FROM market_moving_factor
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(event_at, source_published_at, fetched_at) DESC, fetched_at DESC
     LIMIT ?`,
    ...params,
  ).map(decodeFactorRow)
}

function decodeFactorRow(row: Row): Row {
  const next: Row = { ...row }
  for (const field of JSON_FIELDS) {
    const storageKey = `${field}_json`
    next[field] = decodeJson(row[storageKey])
    delete next[storageKey]
  }
  next.raw_json = decodeJson(row.raw_json)
  return next
}

function encodeJson(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function clean(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}
