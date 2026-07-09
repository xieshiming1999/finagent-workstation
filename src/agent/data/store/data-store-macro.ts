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
  opts: {
    family?: string
    status?: string
    source?: string
    target?: string
    assets?: string[]
    regions?: string[]
    sectors?: string[]
    families?: string[]
    limit?: number
  } = {},
): Row[] {
  const where = ['1=1']
  const params: unknown[] = []
  if (opts.family) {
    where.push('family = ?')
    params.push(opts.family)
  }
  if (opts.families && opts.families.length > 0) {
    where.push(`family IN (${opts.families.map(() => '?').join(',')})`)
    params.push(...opts.families)
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
  ).map(decodeFactorRow).filter((row) => matchesRelevance(row, opts))
}

function matchesRelevance(row: Row, opts: {
  target?: string
  assets?: string[]
  regions?: string[]
  sectors?: string[]
}): boolean {
  const needles = [
    opts.target,
    ...(opts.assets ?? []),
    ...(opts.regions ?? []),
    ...(opts.sectors ?? []),
  ].map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean)
  if (needles.length === 0) return true
  const haystack = [
    row.factor_id,
    row.family,
    row.title,
    row.summary,
    row.source_name,
    row.expected_direction,
    ...stringList(row.affected_assets),
    ...stringList(row.affected_regions),
    ...stringList(row.affected_sectors),
    ...stringList(row.transmission_channels),
  ].map((value) => String(value ?? '').toLowerCase())
  return needles.some((needle) => haystack.some((value) => value.includes(needle)))
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '')).filter(Boolean)
}

function decodeFactorRow(row: Row): Row {
  const next: Row = { ...row }
  for (const field of JSON_FIELDS) {
    const storageKey = `${field}_json`
    next[field] = decodeJson(row[storageKey])
    delete next[storageKey]
  }
  next.raw_json = decodeJson(row.raw_json)
  const macroValues = asRecord(next.macro_values)
  const raw = asRecord(next.raw_json)
  next.evidence_tier = next.evidence_tier ?? macroValues.evidenceTier ?? raw.evidence_tier
  next.limitations = next.limitations ?? macroValues.limitations ?? limitationList(macroValues.limitation) ?? raw.limitations
  next.linked_macro_evidence_ids =
    next.linked_macro_evidence_ids ?? macroValues.linkedMacroEvidenceIds ?? raw.linked_macro_evidence_ids
  next.access_status = next.access_status ?? accessStatus(next)
  next.freshness_status = next.freshness_status ?? freshnessStatus(next)
  next.confidence_effect = next.confidence_effect ?? confidenceEffect(next)
  next.missing_evidence = next.missing_evidence ?? missingEvidence(next)
  next.next_evidence_action = next.next_evidence_action ?? nextEvidenceAction(next)
  next.asset_impact = next.asset_impact ?? assetImpact(next)
  return next
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function limitationList(value: unknown): string[] | undefined {
  const text = clean(value)
  return text ? [text] : undefined
}

function accessStatus(row: Row): string {
  const retrieval = asRecord(row.retrieval_test)
  const value = clean(
    retrieval.accessStatus ??
    retrieval.access_class ??
    retrieval.accessClass ??
    retrieval.status ??
    row.failure_class ??
    row.status,
  )?.toLowerCase() ?? ''
  if (!value) return 'public'
  if (value.includes('api-key')) return 'api-key-required'
  if (value.includes('credential') || value.includes('quota')) return 'credential-gated'
  if (value.includes('manual')) return 'manual-browser'
  if (value.includes('anti-bot')) return 'anti-bot'
  if (value.includes('security') || value.includes('blocked')) return 'security-blocked'
  if (value.includes('do-not-scrape')) return 'do-not-scrape'
  if (value.includes('licensed') || value.includes('paywall')) return 'licensed-needed'
  if (row.failure_class) return 'security-blocked'
  return 'public'
}

function freshnessStatus(row: Row): string {
  const access = accessStatus(row)
  if (/(blocked|manual|anti-bot|licensed|do-not-scrape|security)/.test(access)) return 'blocked'
  const source = parseDate(clean(row.source_published_at ?? row.event_at) ?? undefined)
  const fetched = parseDate(clean(row.fetched_at) ?? undefined)
  if (!source && !fetched) return 'missing'
  if (!source || !fetched) return 'acceptable'
  const days = Math.abs(fetched.getTime() - source.getTime()) / 86_400_000
  if (days <= 7) return 'fresh'
  if (days <= 60) return 'acceptable'
  return 'stale'
}

function confidenceEffect(row: Row): string {
  const retrieval = asRecord(row.retrieval_test)
  const explicit = clean(retrieval.confidenceEffect ?? retrieval.confidence_effect)
  if (explicit) return explicit
  const access = accessStatus(row)
  const freshness = freshnessStatus(row)
  if (row.failure_class || freshness === 'missing') return 'insufficient evidence'
  if (access !== 'public' || freshness === 'blocked' || freshness === 'stale') return 'lowers confidence'
  if (clean(row.evidence_tier)?.includes('official') && freshness === 'fresh') return 'raises confidence'
  if (clean(row.evidence_tier)?.includes('news')) return 'neutral'
  return 'mixed'
}

function missingEvidence(row: Row): string {
  const retrieval = asRecord(row.retrieval_test)
  const explicit = clean(retrieval.missingEvidence ?? retrieval.missing_evidence)
  if (explicit) return explicit
  if (clean(row.failure_class)) return clean(row.failure_class) ?? '-'
  const limitations = stringList(row.limitations).join('; ')
  return limitations || '-'
}

function nextEvidenceAction(row: Row): string {
  const retrieval = asRecord(row.retrieval_test)
  const explicit = clean(retrieval.nextAction ?? retrieval.next_action)
  if (explicit) return explicit
  const access = accessStatus(row)
  const freshness = freshnessStatus(row)
  if (row.failure_class) return 'do not retry automatically; inspect source boundary'
  if (/(manual|anti-bot|licensed|do-not-scrape|security)/.test(access)) return 'manual-browser evidence or do not retry'
  if (access === 'credential-gated' || access === 'api-key-required') return 'configure credential then serial probe'
  if (freshness === 'stale' || freshness === 'missing') return 'refresh allowed source then readback'
  return 'use cache/readback'
}

function assetImpact(row: Row): string {
  const direction = clean(row.expected_direction)?.toLowerCase() ?? ''
  if (/(positive|tailwind|利好|上行)/.test(direction)) return 'positive tailwind'
  if (/(negative|headwind|利空|下行)/.test(direction)) return 'negative headwind'
  if (/(mixed|分化|双向)/.test(direction)) return 'mixed'
  if (/(watch|monitor|观察|context)/.test(direction)) return 'watch-only'
  return stringList(row.affected_assets).length > 0 ? 'watch-only' : 'no direct relevance'
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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
