import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { DataStore } from '../agent/data/store/data-store'
import { macroNumericSeriesCatalog } from '../agent/tools/data-store-tool-query-macro'
import { MACRO_RESEARCH_SOURCES, type MacroResearchSource } from '../agent/tools/macro-research-source-catalog'
import type { AppConfig } from './config'

type FactorRow = Record<string, unknown>

type SourceState =
  | 'ok'
  | 'fallback-only'
  | 'credential-gated'
  | 'permission-blocked'
  | 'security-control'
  | 'unsupported'

export interface MacroFactorSourceStatus {
  id: string
  name: string
  state: SourceState
  detail: string
}

export interface MacroFactorRadarResult {
  rows: FactorRow[]
  sources: MacroFactorSourceStatus[]
  numericSeriesCatalog: Record<string, unknown>[]
  generatedAt: string
  error?: string
}

const FACTOR_SCHEMA = 'market_moving_factor_v1'

export async function refreshMacroFactorRadar(
  ds: DataStore,
  config: AppConfig,
  basePath?: string,
): Promise<MacroFactorRadarResult> {
  const generatedAt = new Date().toISOString()
  const rows: FactorRow[] = [...seedFactorRows(generatedAt)]
  const sources: MacroFactorSourceStatus[] = sourceRegistrySnapshot()

  const fredKey = configValue(config, 'FRED_API_KEY')
  const beaKey = configValue(config, 'BEA_API_KEY') || readBeaKeyFile()
  const eiaKey = configValue(config, 'EIA_API_KEY')
  const officialResults = await Promise.all([
    fetchFredFactors(fredKey, generatedAt),
    fetchBlsFactors(generatedAt),
    fetchBeaFactors(beaKey, generatedAt),
    fetchWorldBankFactors(generatedAt),
    fetchImfFactors(generatedAt),
    fetchOecdFactors(generatedAt),
    fetchEiaFactors(eiaKey, generatedAt),
    fetchNbsChinaFactors(generatedAt),
  ])
  for (const result of officialResults) {
    rows.push(...result.rows)
    sources.push(result.source)
  }

  const windRows = extractWindCachedFactors(ds, generatedAt, config)
  rows.push(...windRows.rows)
  sources.push(windRows.source)

  const newsRows = extractNewsCachedFactors(ds, generatedAt)
  rows.push(...newsRows.rows)
  sources.push(newsRows.source)

  const macroEvidenceRows = extractSourceReaderMacroEvidence(basePath, generatedAt)
  rows.push(...macroEvidenceRows.rows)
  sources.push(macroEvidenceRows.source)

  ds.saveMarketMovingFactors(rows)
  return {
    rows: ds.queryMarketMovingFactors({ limit: 80 }),
    sources,
    numericSeriesCatalog: numericSeriesCatalogSnapshot(),
    generatedAt,
  }
}

function numericSeriesCatalogSnapshot(): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(macroNumericSeriesCatalog({ limit: 80 }))
    return Array.isArray(parsed?.rows) ? parsed.rows : []
  } catch {
    return []
  }
}

function extractWindCachedFactors(
  ds: DataStore,
  fetchedAt: string,
  config: AppConfig,
): { rows: FactorRow[]; source: MacroFactorSourceStatus } {
  const economic = ds.queryWindEconomicSeries(8)
  const documents = ds.queryWindDocuments(8)
  const rows: FactorRow[] = []
  for (const row of economic.slice(0, 3)) {
    const key = String(row.series_key ?? row.metric_code ?? row.metric_name ?? 'economic')
    rows.push({
      factor_id: `wind:cached:economic:${key}:${row.date ?? row.updated_at ?? fetchedAt}`,
      family: 'macro_series',
      title: String(row.metric_name ?? row.metric_query ?? 'Wind cached economic series'),
      summary: `Cached Wind economic series row: ${row.metric_name ?? row.metric_query ?? key}.`,
      source_name: 'Wind',
      source_url: null,
      source_type: 'cached_provider_row',
      source_published_at: row.date ?? null,
      fetched_at: fetchedAt,
      event_at: row.date ?? null,
      affected_assets: ['China equities', 'China rates', 'CNY', 'commodities'],
      affected_regions: ['China'],
      affected_sectors: [],
      transmission_channels: ['macro growth/liquidity evidence', 'policy expectation'],
      expected_direction: 'mixed',
      severity: 'medium',
      confidence: 'medium',
      status: 'active',
      evidence_items: [{ label: `${row.metric_name ?? key} ${row.date ?? '-'} = ${row.value_num ?? row.value_text ?? '-'}`, retrieved_at: fetchedAt }],
      macro_values: { actual: parseNumber(row.value_num), text: row.value_text ?? null, unit: row.unit ?? null, period: row.date ?? null },
      retrieval_test: retrieval('wind', 'wind.economic_series.cached_readback', 'ok', null),
      raw_json: row,
    })
  }
  for (const row of documents.slice(0, 2)) {
    const title = String(row.title ?? row.query ?? 'Wind cached document')
    rows.push({
      factor_id: `wind:cached:document:${stableId(title)}:${row.published_at ?? row.updated_at ?? fetchedAt}`,
      family: 'research_report',
      title,
      summary: String(row.summary ?? row.query ?? 'Cached Wind document/news evidence.'),
      source_name: 'Wind',
      source_url: row.url ?? null,
      source_type: 'cached_provider_row',
      source_published_at: row.published_at ?? null,
      fetched_at: fetchedAt,
      event_at: row.published_at ?? null,
      affected_assets: [],
      affected_regions: [],
      affected_sectors: [],
      transmission_channels: ['research/news narrative', 'positioning attention'],
      expected_direction: 'unknown',
      severity: 'medium',
      confidence: 'medium',
      status: 'watch',
      evidence_items: [{ label: title, source_url: row.url ?? null, retrieved_at: fetchedAt }],
      macro_values: {},
      retrieval_test: retrieval('wind', 'wind.document.cached_readback', 'ok', null),
      raw_json: row,
    })
  }
  if (rows.length > 0) {
    return {
      rows,
      source: { id: 'wind.cached', name: 'Wind cached macro/document rows', state: 'ok', detail: `${rows.length} cached Wind row(s) promoted as macro-factor evidence.` },
    }
  }
  const windConfigured = Boolean(configValue(config, 'WIND_API_KEY'))
  return {
    rows: [failureRow(
      'wind:macro:cached_readback:missing',
      'macro_series',
      windConfigured ? 'No reusable Wind macro rows found' : 'Wind API key missing',
      'Wind',
      windConfigured ? 'cache_miss' : 'credential_missing',
      fetchedAt,
      windConfigured
        ? 'Wind credential is configured, but no cached wind_economic_series or wind_document rows are available for macro radar readback.'
        : 'WIND_API_KEY is not configured; macro radar can still use public/manual sources.',
    )],
    source: {
      id: 'wind.cached',
      name: 'Wind cached macro/document rows',
      state: windConfigured ? 'fallback-only' : 'credential-gated',
      detail: windConfigured
        ? 'Configured, but no cached Wind macro/document evidence is currently reusable.'
        : 'WIND_API_KEY is required before Wind live refresh can populate reusable macro rows.',
    },
  }
}

function extractNewsCachedFactors(ds: DataStore, fetchedAt: string): { rows: FactorRow[]; source: MacroFactorSourceStatus } {
  const rows = ds.queryFinanceNews({ limit: 80 }) as unknown as Array<Record<string, unknown>>
  const selected = rows.slice(0, 5)
  if (selected.length === 0) {
    return {
      rows: [failureRow(
        'news:macro:cached_readback:missing',
        'narrative_attention',
        'No reusable cached finance news rows found',
        'finance_news',
        'cache_miss',
        fetchedAt,
        'No cached finance_news rows are available; refresh governed news first if narrative observations are needed.',
      )],
      source: { id: 'finance_news.cached', name: 'Cached finance news', state: 'fallback-only', detail: 'Uses persisted finance_news rows only; no broad live search is triggered by macro radar.' },
    }
  }
  return {
    rows: selected.map((row) => {
      const title = String(row.title ?? 'Macro news factor')
      return {
        factor_id: `news:cached:${stableId(title)}:${row.published_at ?? row.fetched_at ?? fetchedAt}`,
        family: 'narrative_attention',
        title,
        summary: String(row.summary ?? row.content ?? 'Cached finance news row promoted as macro narrative evidence.'),
        source_name: row.source ?? row.publisher ?? 'finance_news',
        source_url: row.url ?? null,
        source_type: 'cached_finance_news',
        evidence_tier: 'linked_news_evidence',
        limitations: [
          'Finance news is a current-event clue, not an official macro fact.',
          'Use official data or content-backed research before making a root-cause conclusion.',
        ],
        linked_macro_evidence_ids: [],
        source_published_at: row.published_at ?? null,
        fetched_at: fetchedAt,
        event_at: row.published_at ?? null,
        affected_assets: [],
        affected_regions: [],
        affected_sectors: [],
        transmission_channels: [],
        expected_direction: 'unknown',
        severity: 'medium',
        confidence: 'unassessed',
        status: 'watch',
        evidence_items: [{ label: title, source_url: row.url ?? null, retrieved_at: fetchedAt }],
        macro_values: {
          evidenceTier: 'linked_news_evidence',
          limitation: 'news_clue_not_official_fact',
          limitations: [
            'Finance news is a current-event clue, not an official macro fact.',
            'Use official data or content-backed research before making a root-cause conclusion.',
          ],
          publisher: row.publisher ?? row.source ?? null,
        },
        retrieval_test: retrieval('finance_news', 'finance_news.cached_macro_readback', 'ok', null),
        raw_json: row,
      }
    }),
    source: { id: 'finance_news.cached', name: 'Cached finance news', state: 'ok', detail: `${selected.length} cached finance_news row(s) promoted as macro narrative evidence.` },
  }
}

export function readMacroFactorRadar(ds: DataStore, basePath?: string): MacroFactorRadarResult {
  const generatedAt = new Date().toISOString()
  const macroEvidenceRows = extractSourceReaderMacroEvidence(basePath, generatedAt)
  if (macroEvidenceRows.rows.length > 0) {
    ds.saveMarketMovingFactors(macroEvidenceRows.rows)
  }
  const existing = ds.queryMarketMovingFactors({ limit: 80 })
  if (existing.length > 0) {
    return {
      rows: existing,
      sources: [...sourceRegistrySnapshot(), macroEvidenceRows.source],
      numericSeriesCatalog: numericSeriesCatalogSnapshot(),
      generatedAt,
    }
  }
  const seeds = seedFactorRows(generatedAt)
  ds.saveMarketMovingFactors(seeds)
  return {
    rows: ds.queryMarketMovingFactors({ limit: 80 }),
    sources: [...sourceRegistrySnapshot(), macroEvidenceRows.source],
    numericSeriesCatalog: numericSeriesCatalogSnapshot(),
    generatedAt,
  }
}

function extractSourceReaderMacroEvidence(
  basePath: string | undefined,
  fetchedAt: string,
): { rows: FactorRow[]; source: MacroFactorSourceStatus } {
  const dir = basePath ? join(basePath, 'memory', 'macro_evidence') : ''
  if (!dir || !existsSync(dir)) {
    return {
      rows: [],
      source: {
        id: 'source_reader.macro_evidence',
        name: 'SourceReader macro evidence artifacts',
        state: 'fallback-only',
        detail: 'No memory/macro_evidence directory is currently available.',
      },
    }
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 20)
  const rows: FactorRow[] = []
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const row = sourceReaderMacroRecordToFactorRow(record, file, fetchedAt)
      if (row) rows.push(row)
    } catch {
      // Skip unreadable evidence artifacts; malformed records are not reusable.
    }
  }
  return {
    rows,
    source: {
      id: 'source_reader.macro_evidence',
      name: 'SourceReader macro evidence artifacts',
      state: rows.length > 0 ? 'ok' : 'fallback-only',
      detail: rows.length > 0
        ? `${rows.length} durable macro evidence artifact(s) promoted into the macro research surface.`
        : 'No readable macro-evidence-record-v1 artifacts are currently available.',
    },
  }
}

function sourceReaderMacroRecordToFactorRow(
  record: Record<string, unknown>,
  filePath: string,
  fetchedAt: string,
): FactorRow | null {
  if (record.contract !== 'macro-evidence-record-v1') return null
  const numeric = isRecord(record.numericSeries) ? record.numericSeries : {}
  const sourceName = stringValue(record.source) || stringValue(record.provider) || 'SourceReader'
  const sourceDate = stringValue(record.sourceDate) || stringValue(numeric.sourceDataTime)
  const fetched = stringValue(record.fetchedAt) || stringValue(numeric.fetchedAt) || fetchedAt
  const title = stringValue(record.title) || `${sourceName} macro evidence`
  const affectedAssets = stringList(record.affectedAssets)
  const keyClaims = stringList(record.keyClaims)
  const missingEvidence = stringList(record.missingEvidence)
  const sourceUrl = stringValue(record.url) || null
  return {
    factor_id: `source_reader:${stableId(String(record.id ?? title))}`,
    family: stringValue(record.evidenceClass) || 'macro_evidence',
    title,
    summary: keyClaims.join(' ') || 'Durable SourceReader macro evidence artifact.',
    source_name: sourceName,
    source_url: sourceUrl,
    source_type: stringValue(record.evidenceClass) || 'source_reader_macro_evidence',
    evidence_tier: stringValue(record.evidenceClass) || 'governed_macro_evidence',
    source_published_at: sourceDate || null,
    fetched_at: fetched,
    event_at: sourceDate || null,
    affected_assets: affectedAssets,
    affected_regions: stringList(record.region),
    affected_sectors: [],
    transmission_channels: stringList(record.assetClass),
    expected_direction: 'mixed',
    severity: 'medium',
    confidence: confidenceFromRecord(record),
    access_status: sourceUrl ? 'public-or-recorded' : 'artifact-readback',
    freshness_status: stringValue(record.freshness) || 'unknown',
    confidence_effect: stringValue(record.confidenceEffect) || 'requires evidence review',
    missing_evidence: missingEvidence.join('; '),
    next_evidence_action: missingEvidence.length > 0 ? 'refresh or attach higher-tier evidence' : 'use artifact/readback',
    asset_impact: affectedAssets.length > 0 ? 'linked' : 'needs-linking',
    status: 'active',
    limitations: [
      ...missingEvidence,
      'Macro evidence is context, hypothesis, and invalidation input, not a direct buy/sell rule.',
    ],
    linked_macro_evidence_ids: [String(record.id ?? '')].filter(Boolean),
    evidence_items: [{
      label: keyClaims[0] ?? title,
      source_url: sourceUrl,
      retrieved_at: fetched,
    }],
    macro_values: {
      evidenceTier: stringValue(record.evidenceClass) || 'governed_macro_evidence',
      evidenceClass: record.evidenceClass ?? null,
      confidenceEffect: record.confidenceEffect ?? null,
      sourceRecordPath: record.sourceRecordPath ?? null,
      artifactPath: filePath,
      missingEvidence,
      limitations: [
        ...missingEvidence,
        'Macro evidence is context, hypothesis, and invalidation input, not a direct buy/sell rule.',
      ],
      linkedMacroEvidenceIds: [String(record.id ?? '')].filter(Boolean),
      assetImpact: affectedAssets.length > 0 ? 'linked' : 'needs-linking',
      numericSeries: numeric,
    },
    retrieval_test: retrieval('source_reader', 'source_reader.macro_evidence.readback', 'ok', null),
    raw_json: record,
  }
}

function seedFactorRows(fetchedAt: string): FactorRow[] {
  return [
    {
      factor_id: 'manual:index_classification:msci:indonesia-watch',
      family: 'index_classification',
      title: 'MSCI Indonesia market-classification watch',
      summary: 'Index-provider classification, investability, or accessibility reports can affect Indonesia equities through passive-flow and institutional-access channels.',
      source_name: 'MSCI',
      source_url: 'https://www.msci.com/market-classification',
      source_type: 'manual_seed',
      source_published_at: null,
      fetched_at: fetchedAt,
      event_at: null,
      next_catalyst_at: null,
      affected_assets: ['Indonesia equities', 'IDR', 'EIDO'],
      affected_regions: ['Indonesia'],
      affected_sectors: [],
      transmission_channels: ['passive benchmark flow', 'investability review', 'active de-risking'],
      expected_direction: 'mixed',
      severity: 'medium',
      confidence: 'medium',
      status: 'watch',
      failure_class: null,
      evidence_items: [
        {
          label: 'Manual seed from macro factor source-probe report; replace with configured public MSCI document when available.',
          source_url: 'https://www.msci.com/market-classification',
          retrieved_at: fetchedAt,
        },
      ],
      macro_values: {},
      retrieval_test: retrieval('manual', 'manual.msci', 'fallback-only', null),
    },
    {
      factor_id: 'manual:research_report:goldman:copper-pulse',
      family: 'research_report',
      title: 'Copper research-summary pulse',
      summary: 'Major public or licensed copper research summaries can affect copper and miner sentiment through supply-demand revisions, forecasts, positioning, and sector allocation.',
      source_name: 'Goldman Sachs / public summary',
      source_url: null,
      source_type: 'licensed_summary',
      source_published_at: null,
      fetched_at: fetchedAt,
      event_at: null,
      next_catalyst_at: null,
      affected_assets: ['Copper', 'global miners', 'commodity currencies'],
      affected_regions: ['Global'],
      affected_sectors: ['Metals', 'Mining'],
      transmission_channels: ['supply-demand revision', 'price forecast', 'sector allocation'],
      expected_direction: 'unknown',
      severity: 'medium',
      confidence: 'low',
      status: 'watch',
      failure_class: null,
      evidence_items: [
        {
          label: 'Fallback research-summary factor. Do not label as official unless a licensed/public source is supplied.',
          retrieved_at: fetchedAt,
        },
      ],
      macro_values: {},
      retrieval_test: retrieval('manual', 'manual.goldman-copper', 'fallback-only', null),
    },
  ]
}

async function fetchFredFactors(apiKey: string | null, fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  if (!apiKey) {
    return {
      rows: [failureRow('fred:macro_calendar:credential', 'macro_calendar', 'FRED API key missing', 'FRED', 'credential_missing', fetchedAt)],
      source: { id: 'fred', name: 'FRED API', state: 'credential-gated', detail: 'FRED_API_KEY is required for the normal API path.' },
    }
  }
  const url = new URL('https://api.stlouisfed.org/fred/series/observations')
  url.searchParams.set('series_id', 'DGS10')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('file_type', 'json')
  url.searchParams.set('sort_order', 'desc')
  url.searchParams.set('limit', '1')
  try {
    const json = await fetchJson(url.toString())
    const observation = Array.isArray(json.observations) ? json.observations[0] : null
    const value = observation?.value
    return {
      rows: [{
        factor_id: `fred:rates_liquidity:DGS10:${observation?.date ?? fetchedAt.slice(0, 10)}`,
        family: 'rates_liquidity',
        title: 'US 10Y Treasury yield',
        summary: 'Long-end Treasury yield is a rates/liquidity factor for equities, commodities, FX, and duration-sensitive assets.',
        source_name: 'FRED',
        source_url: 'https://fred.stlouisfed.org/series/DGS10',
        source_type: 'official_api',
        source_published_at: observation?.date ?? null,
        fetched_at: fetchedAt,
        event_at: observation?.date ?? null,
        affected_assets: ['global equities', 'USD', 'gold', 'copper', 'duration assets'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: [],
        transmission_channels: ['discount rate', 'liquidity conditions', 'USD pressure'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: `DGS10 ${observation?.date ?? '-'} = ${value ?? '-'}`, source_url: 'https://fred.stlouisfed.org/series/DGS10', retrieved_at: fetchedAt }],
        macro_values: { actual: value === '.' ? null : Number(value), unit: 'percent', period: observation?.date ?? null },
        retrieval_test: retrieval('fred', 'fred.series.observations', 'ok', null),
        raw_json: observation ?? {},
      }],
      source: { id: 'fred', name: 'FRED API', state: 'ok', detail: 'DGS10 latest observation retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('fred:rates_liquidity:DGS10:error', 'rates_liquidity', 'FRED DGS10 retrieval failed', 'FRED', 'unknown', fetchedAt, message)],
      source: { id: 'fred', name: 'FRED API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchBlsFactors(fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  const payload = { seriesid: ['CUUR0000SA0'], latest: true }
  try {
    const json = await fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const series = json?.Results?.series?.[0]
    const point = Array.isArray(series?.data) ? series.data[0] : null
    return {
      rows: [{
        factor_id: `bls:macro_calendar:CPI:${point?.year ?? fetchedAt.slice(0, 4)}-${point?.period ?? 'latest'}`,
        family: 'macro_calendar',
        title: 'US CPI latest BLS observation',
        summary: 'CPI is a macro-calendar inflation factor that can affect rates, dollar, equities, gold, copper, and global risk appetite.',
        source_name: 'BLS',
        source_url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0',
        source_type: 'official_api',
        source_published_at: point ? `${point.year}-${String(point.periodName ?? point.period).padStart(2, '0')}` : null,
        fetched_at: fetchedAt,
        event_at: point ? `${point.year}-${point.period}` : null,
        affected_assets: ['US equities', 'Treasury yields', 'USD', 'gold', 'copper'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: [],
        transmission_channels: ['inflation surprise', 'Fed policy path', 'real rates'],
        expected_direction: 'mixed',
        severity: 'high',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: `CUUR0000SA0 ${point?.year ?? '-'} ${point?.period ?? '-'} = ${point?.value ?? '-'}`, source_url: 'https://www.bls.gov/cpi/', retrieved_at: fetchedAt }],
        macro_values: { actual: point?.value == null ? null : Number(point.value), unit: 'index', period: point ? `${point.year}-${point.period}` : null },
        retrieval_test: retrieval('bls', 'bls.publicAPI.timeseries', 'ok', null),
        raw_json: point ?? {},
      }],
      source: { id: 'bls', name: 'BLS Public Data API', state: 'ok', detail: 'CPI latest observation retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('bls:macro_calendar:CPI:error', 'macro_calendar', 'BLS CPI retrieval failed', 'BLS', 'unknown', fetchedAt, message)],
      source: { id: 'bls', name: 'BLS Public Data API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchBeaFactors(apiKey: string | null, fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  if (!apiKey) {
    return {
      rows: [failureRow('bea:macro_calendar:credential', 'macro_calendar', 'BEA API key missing', 'BEA', 'credential_missing', fetchedAt)],
      source: { id: 'bea', name: 'BEA API', state: 'credential-gated', detail: 'BEA_API_KEY or local bea.txt is required.' },
    }
  }
  const url = new URL('https://apps.bea.gov/api/data/')
  url.searchParams.set('UserID', apiKey)
  url.searchParams.set('method', 'GETDATA')
  url.searchParams.set('datasetname', 'NIPA')
  url.searchParams.set('TableName', 'T10101')
  url.searchParams.set('Frequency', 'Q')
  url.searchParams.set('Year', 'X')
  url.searchParams.set('ResultFormat', 'JSON')
  try {
    const json = await fetchJson(url.toString())
    const rows = json?.BEAAPI?.Results?.Data
    const point = Array.isArray(rows) ? rows[0] : null
    return {
      rows: [{
        factor_id: `bea:macro_calendar:GDP:${point?.TimePeriod ?? fetchedAt.slice(0, 10)}`,
        family: 'macro_calendar',
        title: 'US GDP/NIPA latest BEA observation',
        summary: 'BEA national accounts are macro growth evidence for broad equity, rates, dollar, and commodity analysis.',
        source_name: 'BEA',
        source_url: 'https://apps.bea.gov/api/',
        source_type: 'official_api',
        source_published_at: point?.TimePeriod ?? null,
        fetched_at: fetchedAt,
        event_at: point?.TimePeriod ?? null,
        affected_assets: ['US equities', 'Treasury yields', 'USD', 'cyclical sectors', 'copper'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: ['Cyclicals', 'Materials'],
        transmission_channels: ['growth surprise', 'earnings expectations', 'policy path'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: `${point?.LineDescription ?? 'NIPA'} ${point?.TimePeriod ?? '-'} = ${point?.DataValue ?? '-'}`, source_url: 'https://apps.bea.gov/api/', retrieved_at: fetchedAt }],
        macro_values: { actual: parseNumber(point?.DataValue), unit: point?.CL_UNIT ?? null, period: point?.TimePeriod ?? null },
        retrieval_test: retrieval('bea', 'bea.NIPA.T10101', 'ok', null),
        raw_json: point ?? {},
      }],
      source: { id: 'bea', name: 'BEA API', state: 'ok', detail: 'NIPA/GDP latest row retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('bea:macro_calendar:GDP:error', 'macro_calendar', 'BEA NIPA retrieval failed', 'BEA', 'unknown', fetchedAt, message)],
      source: { id: 'bea', name: 'BEA API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchWorldBankFactors(fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  const url = new URL('https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD')
  url.searchParams.set('format', 'json')
  url.searchParams.set('per_page', '2')
  try {
    const json = await fetchJson(url.toString())
    const metadata = Array.isArray(json) ? json[0] : null
    const rows = Array.isArray(json) ? json[1] : null
    const point = Array.isArray(rows) ? rows.find((row) => row?.value != null) ?? rows[0] : null
    return {
      rows: [{
        factor_id: `world_bank:macro_series:NY.GDP.MKTP.CD:${point?.date ?? fetchedAt.slice(0, 10)}`,
        family: 'macro_series',
        title: 'US GDP current US$ World Bank observation',
        summary: 'World Bank GDP current US$ is official numeric growth evidence for cross-country macro and broad equity/rates analysis.',
        source_name: 'World Bank',
        source_url: 'https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD',
        source_type: 'official_api',
        source_published_at: metadata?.lastupdated ?? point?.date ?? null,
        fetched_at: fetchedAt,
        event_at: point?.date ?? null,
        affected_assets: ['US equities', 'global equities', 'Treasury yields', 'USD', 'cyclical sectors'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: ['Cyclicals'],
        transmission_channels: ['growth level', 'earnings expectations', 'cross-country macro comparison'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{
          label: `NY.GDP.MKTP.CD ${point?.date ?? '-'} = ${point?.value ?? '-'}`,
          source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=US',
          retrieved_at: fetchedAt,
        }],
        macro_values: {
          actual: parseNumber(point?.value),
          unit: 'current US$',
          period: point?.date ?? null,
          frequency: 'annual',
          lastUpdated: metadata?.lastupdated ?? null,
        },
        retrieval_test: retrieval('world_bank', 'world_bank.indicator.NY.GDP.MKTP.CD', 'ok', null),
        raw_json: point ?? {},
      }],
      source: { id: 'world_bank', name: 'World Bank API', state: 'ok', detail: 'US GDP current US$ latest row retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('world_bank:macro_series:NY.GDP.MKTP.CD:error', 'macro_series', 'World Bank GDP retrieval failed', 'World Bank', 'unknown', fetchedAt, message)],
      source: { id: 'world_bank', name: 'World Bank API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchImfFactors(fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  const url = 'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/USA'
  try {
    const json = await fetchJson(url)
    const values = json?.values?.NGDP_RPCH?.USA
    const point = latestNumericEntry(values)
    return {
      rows: [{
        factor_id: `imf:macro_series:NGDP_RPCH:USA:${point?.period ?? fetchedAt.slice(0, 10)}`,
        family: 'macro_series',
        title: 'US real GDP growth IMF DataMapper observation',
        summary: 'IMF real GDP growth is official numeric growth evidence for cross-country macro and broad asset-allocation analysis.',
        source_name: 'IMF',
        source_url: url,
        source_type: 'official_api',
        source_published_at: point?.period ?? null,
        fetched_at: fetchedAt,
        event_at: point?.period ?? null,
        affected_assets: ['US equities', 'global equities', 'Treasury yields', 'USD', 'cyclical sectors'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: ['Cyclicals'],
        transmission_channels: ['growth momentum', 'cross-country macro comparison', 'policy expectation'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{
          label: `NGDP_RPCH USA ${point?.period ?? '-'} = ${point?.value ?? '-'}`,
          source_url: 'https://www.imf.org/external/datamapper/NGDP_RPCH@WEO/USA',
          retrieved_at: fetchedAt,
        }],
        macro_values: {
          actual: point?.value ?? null,
          unit: 'percent change',
          period: point?.period ?? null,
          frequency: 'annual',
        },
        retrieval_test: retrieval('imf', 'imf.datamapper.NGDP_RPCH.USA', 'ok', null),
        raw_json: { indicator: 'NGDP_RPCH', country: 'USA', period: point?.period ?? null, value: point?.value ?? null },
      }],
      source: { id: 'imf', name: 'IMF DataMapper API', state: 'ok', detail: 'US real GDP growth latest row retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('imf:macro_series:NGDP_RPCH:USA:error', 'macro_series', 'IMF real GDP growth retrieval failed', 'IMF', 'unknown', fetchedAt, message)],
      source: { id: 'imf', name: 'IMF DataMapper API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchOecdFactors(fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  const url = new URL('https://sdmx.oecd.org/public/rest/v1/data/OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD')
  url.searchParams.set('startPeriod', '2024-Q1')
  url.searchParams.set('endPeriod', '2026-Q4')
  url.searchParams.set('firstNObservations', '20')
  try {
    const json = await fetchJson(url.toString(), {
      headers: {
        Accept: 'application/vnd.sdmx.data+json; version=2.0',
        'Accept-Language': 'en',
        'User-Agent': 'Mozilla/5.0',
      },
    })
    const point = extractOecdGrowthObservation(json)
    if (!point) throw new Error('OECD SDMX response did not include the governed B1GQ OECD growth series.')
    return {
      rows: [{
        factor_id: `oecd:macro_series:DF_QNA_EXPENDITURE_GROWTH_OECD:OECD:${point.period ?? fetchedAt.slice(0, 10)}`,
        family: 'macro_series',
        title: 'OECD quarterly real GDP growth observation',
        summary: 'OECD quarterly real GDP growth is official numeric growth evidence for cross-country macro, country-risk, rates, FX, and equity analysis.',
        source_name: 'OECD',
        source_url: url.toString(),
        source_type: 'official_api',
        source_published_at: point.period,
        fetched_at: fetchedAt,
        event_at: point.period,
        affected_assets: ['global equities', 'country risk', 'FX', 'rates'],
        affected_regions: ['OECD', 'Global'],
        affected_sectors: ['Cyclicals'],
        transmission_channels: ['growth momentum', 'cross-country macro comparison', 'risk appetite'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{
          label: `DF_QNA_EXPENDITURE_GROWTH_OECD B1GQ OECD ${point.period ?? '-'} = ${point.value ?? '-'}`,
          source_url: url.toString(),
          retrieved_at: fetchedAt,
        }],
        macro_values: {
          actual: point.value,
          unit: 'percent',
          period: point.period,
          frequency: 'quarterly',
          transformation: 'GCM',
          seriesId: 'DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM',
        },
        retrieval_test: retrieval('oecd', 'oecd.sdmx.DF_QNA_EXPENDITURE_GROWTH_OECD.B1GQ', 'ok', null),
        raw_json: point.raw,
      }],
      source: { id: 'oecd', name: 'OECD SDMX API', state: 'ok', detail: 'OECD quarterly real GDP growth latest row retrieved from official SDMX JSON.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('oecd:macro_series:DF_QNA_EXPENDITURE_GROWTH_OECD:error', 'macro_series', 'OECD quarterly real GDP growth retrieval failed', 'OECD', 'unknown', fetchedAt, message)],
      source: { id: 'oecd', name: 'OECD SDMX API', state: 'unsupported', detail: message },
    }
  }
}

async function fetchEiaFactors(apiKey: string | null, fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  if (!apiKey) {
    return {
      rows: [failureRow('eia:macro_series:WCESTUS1:credential', 'macro_series', 'EIA API key missing', 'EIA', 'credential_missing', fetchedAt, 'EIA_API_KEY is required for official EIA v2 data calls.')],
      source: { id: 'eia', name: 'EIA API', state: 'credential-gated', detail: 'EIA_API_KEY is required for official EIA v2 data calls.' },
    }
  }
  const url = new URL('https://api.eia.gov/v2/petroleum/stoc/wstk/data/')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('frequency', 'weekly')
  url.searchParams.set('data[0]', 'value')
  url.searchParams.set('facets[series][]', 'WCESTUS1')
  url.searchParams.set('sort[0][column]', 'period')
  url.searchParams.set('sort[0][direction]', 'desc')
  url.searchParams.set('offset', '0')
  url.searchParams.set('length', '1')
  try {
    const json = await fetchJson(url.toString())
    const point = Array.isArray(json?.response?.data) ? json.response.data[0] : null
    return {
      rows: [{
        factor_id: `eia:macro_series:WCESTUS1:${point?.period ?? fetchedAt.slice(0, 10)}`,
        family: 'macro_series',
        title: 'US commercial crude oil inventories EIA observation',
        summary: 'EIA weekly petroleum stocks are official numeric energy inventory evidence for oil, inflation, energy equities, and commodity-sensitive macro analysis.',
        source_name: 'EIA',
        source_url: 'https://api.eia.gov/v2/petroleum/stoc/wstk/data/',
        source_type: 'official_api',
        source_published_at: point?.period ?? null,
        fetched_at: fetchedAt,
        event_at: point?.period ?? null,
        affected_assets: ['oil', 'energy equities', 'inflation expectations', 'commodity currencies'],
        affected_regions: ['United States', 'Global'],
        affected_sectors: ['Energy'],
        transmission_channels: ['energy inventory', 'oil supply demand', 'inflation input'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{
          label: `WCESTUS1 ${point?.period ?? '-'} = ${point?.value ?? '-'}`,
          source_url: 'https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm',
          retrieved_at: fetchedAt,
        }],
        macro_values: {
          actual: parseNumber(point?.value),
          unit: point?.units ?? 'thousand barrels',
          period: point?.period ?? null,
          frequency: 'weekly',
        },
        retrieval_test: retrieval('eia', 'eia.petroleum.stoc.wstk.WCESTUS1', 'ok', null),
        raw_json: point ?? {},
      }],
      source: { id: 'eia', name: 'EIA API', state: 'ok', detail: 'US weekly crude inventory latest row retrieved.' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      rows: [failureRow('eia:macro_series:WCESTUS1:error', 'macro_series', 'EIA weekly crude inventory retrieval failed', 'EIA', 'unknown', fetchedAt, message)],
      source: { id: 'eia', name: 'EIA API', state: 'unsupported', detail: message },
    }
  }
}

function extractOecdGrowthObservation(json: any): { period: string | null; value: number | null; raw: Record<string, unknown> } | null {
  const data = json?.data ?? json
  const dataSet = Array.isArray(data?.dataSets) ? data.dataSets[0] : null
  const structure = Array.isArray(data?.structures) ? data.structures[0] : null
  const seriesDims = Array.isArray(structure?.dimensions?.series) ? structure.dimensions.series : []
  const observationDims = Array.isArray(structure?.dimensions?.observation) ? structure.dimensions.observation : []
  const timeValues = observationDims.find((dim: any) => dim?.id === 'TIME_PERIOD')?.values ?? observationDims[0]?.values ?? []
  const seriesRows = dataSet?.series && typeof dataSet.series === 'object' ? Object.entries(dataSet.series) : []
  for (const [key, series] of seriesRows) {
    const ids = key.split(':').map((part, index) => seriesDims[index]?.values?.[Number(part)]?.id)
    const byDim: Record<string, string | undefined> = {}
    for (let i = 0; i < seriesDims.length; i += 1) byDim[String(seriesDims[i]?.id ?? i)] = ids[i]
    if (
      byDim.FREQ !== 'Q' ||
      byDim.ADJUSTMENT !== 'Y' ||
      byDim.REF_AREA !== 'OECD' ||
      byDim.SECTOR !== 'S1' ||
      byDim.COUNTERPART_SECTOR !== 'S1' ||
      byDim.TRANSACTION !== 'B1GQ' ||
      byDim.UNIT_MEASURE !== 'PC' ||
      byDim.TRANSFORMATION !== 'GCM' ||
      byDim.TABLE_IDENTIFIER !== 'T0102'
    ) {
      continue
    }
    const observations = (series as any)?.observations
    if (!observations || typeof observations !== 'object') return null
    const points = Object.entries(observations)
      .map(([obsKey, value]) => {
        const firstIndex = Number(obsKey.split(':')[0])
        const period = timeValues[firstIndex]?.id ?? timeValues[firstIndex]?.name ?? null
        const rawValue = Array.isArray(value) ? value[0] : value
        return { period, value: parseNumber(rawValue), raw: { seriesKey: key, dimensions: byDim, observationKey: obsKey, value: rawValue } }
      })
      .filter((point) => point.period && point.value != null)
      .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    return points.at(-1) ?? null
  }
  return null
}

async function fetchNbsChinaFactors(fetchedAt: string): Promise<{ rows: FactorRow[]; source: MacroFactorSourceStatus }> {
  const message = 'NBS China official entry pages are validated, but current EasyQuery numeric API probes returned HTTP 403 UrlACL from this environment. Keep China official numeric series as browser/manual or future source-specific adapter evidence until a stable public table/API contract is verified.'
  return {
    rows: [failureRow(
      'nbs_china:macro_series:easyquery:security_control',
      'macro_series',
      'NBS China official numeric series access requires source-specific validation',
      'NBS China',
      'security_control',
      fetchedAt,
      message,
    )],
    source: { id: 'nbs_china', name: 'National Bureau of Statistics of China', state: 'security-control', detail: message },
  }
}

function latestNumericEntry(values: unknown): { period: string; value: number } | null {
  if (!values || typeof values !== 'object') return null
  const entries = Object.entries(values as Record<string, unknown>)
    .map(([period, value]) => ({ period, value: Number(value) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => Number(a.period) - Number(b.period))
  return entries.at(-1) ?? null
}

function failureRow(
  factorId: string,
  family: string,
  title: string,
  sourceName: string,
  failureClass: string,
  fetchedAt: string,
  error?: string,
): FactorRow {
  return {
    factor_id: factorId,
    family,
    title,
    summary: error ?? `${sourceName} is not currently available for live factor refresh.`,
    source_name: sourceName,
    source_type: 'provider',
    fetched_at: fetchedAt,
    affected_assets: [],
    affected_regions: [],
    affected_sectors: [],
    transmission_channels: [],
    expected_direction: 'unknown',
    severity: 'low',
    confidence: 'low',
    status: 'unsupported',
    failure_class: failureClass,
    evidence_items: [{ label: error ?? failureClass, retrieved_at: fetchedAt }],
    macro_values: {},
    retrieval_test: retrieval(sourceName.toLowerCase(), `${sourceName.toLowerCase()}.refresh`, failureClass, error ?? null),
  }
}

function retrieval(provider: string, capabilityId: string, status: string, error: string | null): Record<string, unknown> {
  return {
    provider,
    interface_id: 'macro.factor_radar',
    capability_id: capabilityId,
    candidate_schema: FACTOR_SCHEMA,
    status,
    error,
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function sourceRegistrySnapshot(): MacroFactorSourceStatus[] {
  return MACRO_RESEARCH_SOURCES.map((source) => ({
    id: source.id,
    name: source.providerName,
    state: sourceRegistryState(source),
    detail: [
      source.evidenceValue,
      source.accessClass,
      source.testedStatus,
      source.nextAction,
    ].filter(Boolean).join(' · '),
  }))
}

function sourceRegistryState(source: MacroResearchSource): SourceState {
  const access = source.accessClass
  const tested = source.testedStatus
  if (/security|blocked/i.test(access) || /security|blocked/i.test(tested)) return 'security-control'
  if (/anti-bot|manual/i.test(access)) return 'permission-blocked'
  if (/licensed/i.test(access) && !/public-summary/i.test(access)) return 'permission-blocked'
  if (/needs-live-validation/i.test(tested)) return 'fallback-only'
  if (/ok|readable/i.test(tested) || /official-api/i.test(access)) return 'ok'
  return 'fallback-only'
}

function configValue(config: AppConfig, key: string): string | null {
  const fromApiKeys = config.apiKeys?.[key]
  if (fromApiKeys && fromApiKeys.trim()) return fromApiKeys.trim()
  const fromEnv = process.env[key]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return null
}

function readBeaKeyFile(): string | null {
  const file = join(homedir(), '.fin_electron', 'bea.txt')
  if (!existsSync(file)) return null
  const value = readFileSync(file, 'utf8').trim()
  return value.length > 0 ? value : null
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim()
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean)
  const text = stringValue(value)
  return text ? text.split(/[;,，、]/).map((item) => item.trim()).filter(Boolean) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function confidenceFromRecord(record: Record<string, unknown>): string {
  const freshness = stringValue(record.freshness).toLowerCase()
  const evidenceClass = stringValue(record.evidenceClass).toLowerCase()
  if (evidenceClass.includes('official') && !freshness.includes('stale')) return 'high'
  if (freshness.includes('stale') || freshness.includes('missing')) return 'low'
  return 'medium'
}

function stableId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'row'
}

function parseNumber(value: unknown): number | null {
  const text = String(value ?? '').replace(/,/g, '').trim()
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}
