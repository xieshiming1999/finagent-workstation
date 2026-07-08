import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { DataStore } from '../agent/data/store/data-store'
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
  generatedAt: string
  error?: string
}

const FACTOR_SCHEMA = 'market_moving_factor_v1'

export async function refreshMacroFactorRadar(
  ds: DataStore,
  config: AppConfig,
): Promise<MacroFactorRadarResult> {
  const generatedAt = new Date().toISOString()
  const rows: FactorRow[] = [...seedFactorRows(generatedAt)]
  const sources: MacroFactorSourceStatus[] = [
    { id: 'manual.msci', name: 'MSCI official/manual seed', state: 'fallback-only', detail: 'Seeded index-classification evidence until a specific public document URL is configured.' },
    { id: 'manual.goldman-copper', name: 'Goldman/public research summary', state: 'fallback-only', detail: 'Seeded research-summary evidence; licensed reports must be supplied explicitly.' },
  ]

  const fredKey = configValue(config, 'FRED_API_KEY')
  const fredRows = await fetchFredFactors(fredKey, generatedAt)
  rows.push(...fredRows.rows)
  sources.push(fredRows.source)

  const blsRows = await fetchBlsFactors(generatedAt)
  rows.push(...blsRows.rows)
  sources.push(blsRows.source)

  const beaKey = configValue(config, 'BEA_API_KEY') || readBeaKeyFile()
  const beaRows = await fetchBeaFactors(beaKey, generatedAt)
  rows.push(...beaRows.rows)
  sources.push(beaRows.source)

  const windRows = extractWindCachedFactors(ds, generatedAt, config)
  rows.push(...windRows.rows)
  sources.push(windRows.source)

  const newsRows = extractNewsCachedFactors(ds, generatedAt)
  rows.push(...newsRows.rows)
  sources.push(newsRows.source)

  ds.saveMarketMovingFactors(rows)
  return {
    rows: ds.queryMarketMovingFactors({ limit: 80 }),
    sources,
    generatedAt,
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
        macro_values: {},
        retrieval_test: retrieval('finance_news', 'finance_news.cached_macro_readback', 'ok', null),
        raw_json: row,
      }
    }),
    source: { id: 'finance_news.cached', name: 'Cached finance news', state: 'ok', detail: `${selected.length} cached finance_news row(s) promoted as macro narrative evidence.` },
  }
}

export function readMacroFactorRadar(ds: DataStore): MacroFactorRadarResult {
  const generatedAt = new Date().toISOString()
  const existing = ds.queryMarketMovingFactors({ limit: 80 })
  if (existing.length > 0) {
    return { rows: existing, sources: sourceRegistrySnapshot(), generatedAt }
  }
  const seeds = seedFactorRows(generatedAt)
  ds.saveMarketMovingFactors(seeds)
  return {
    rows: ds.queryMarketMovingFactors({ limit: 80 }),
    sources: sourceRegistrySnapshot(),
    generatedAt,
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
  return [
    { id: 'fred', name: 'FRED API', state: 'credential-gated', detail: 'Uses FRED_API_KEY when configured.' },
    { id: 'bls', name: 'BLS Public Data API', state: 'ok', detail: 'Public CPI/labor/price series path.' },
    { id: 'bea', name: 'BEA API', state: 'credential-gated', detail: 'Uses BEA_API_KEY or local bea.txt fallback.' },
    { id: 'manual.msci', name: 'MSCI official/manual seed', state: 'fallback-only', detail: 'Use configured official URL or manual seed before broad search.' },
    { id: 'manual.goldman-copper', name: 'Goldman/public research summary', state: 'fallback-only', detail: 'Public/licensed summaries only.' },
  ]
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
