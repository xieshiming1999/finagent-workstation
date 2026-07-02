import type { FetchResult } from './base-fetcher'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundIdentityList, readFundPerformanceMetricRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'
import { normalizeFundCategory, type FundCategory } from '../fund-category'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface FundInfo {
  code: string; name: string; fund_type: string | null; company: string | null
  fund_category?: FundCategory
  manager: string | null; setup_date: string | null; total_size: number | null
  nav: number | null; nav_date: string | null
  return_1y: number | null; return_3y: number | null; return_ytd: number | null
  updated_at: string
}

export interface FundPerformanceMetric {
  code: string
  metric_date: string
  provider: string
  capability_id: string
  source_action: string
  nav?: number | null
  return_ytd?: number | null
  return_1w?: number | null
  return_1m?: number | null
  return_3m?: number | null
  return_6m?: number | null
  return_1y?: number | null
  return_2y?: number | null
  return_3y?: number | null
  return_since_inception?: number | null
  fetched_at: string
  raw_json?: string | null
}

export async function fetchFundList(opts: DataApiFetchOptions = {}): Promise<FetchResult<FundInfo>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.identity_list',
    fundListSource,
    {
      label: 'fund list',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundIdentityList({ minRows: 20 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withFundListProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

export async function fetchFundPerformanceMetrics(opts: DataApiFetchOptions & { code?: string; limit?: number } = {}): Promise<FetchResult<FundPerformanceMetric>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.performance_metrics',
    fundPerformanceSource,
    {
      label: 'fund performance metrics',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundPerformanceMetricRows({
          code: opts.code,
          minRows: opts.code ? 1 : 20,
          limit: opts.limit ?? 100,
        })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withFundPerformanceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function fundListSource(
  capability: DataApiProviderCapability,
): DataApiInterfaceRoute<FetchResult<FundInfo>> | null {
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchFundListEastmoney(),
    }
  if (capability.provider === 'akshare')
    return {
      capability,
      run: () => fetchFundListSidecar(`${SIDECAR_AKSHARE}/fund_open_fund_rank_em?symbol=全部`, 'akshare'),
    }
  return null
}

function fundPerformanceSource(
  capability: DataApiProviderCapability,
): DataApiInterfaceRoute<FetchResult<FundPerformanceMetric>> | null {
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchFundPerformanceEastmoney(capability.id),
    }
  if (capability.provider === 'akshare')
    return {
      capability,
      run: () => fetchFundPerformanceSidecar(`${SIDECAR_AKSHARE}/fund_open_fund_rank_em?symbol=全部`, 'akshare', capability.id),
    }
  return null
}

async function fetchFundListSidecar(url: string, source: string): Promise<FetchResult<FundInfo>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`AkShare fund list failed: ${res.status}`)
  const rows = await readSidecarRows(res)

  const now = new Date().toISOString()
  const data: FundInfo[] = rows.map((r) => ({
    code: String(r['基金代码'] ?? ''),
    name: String(r['基金简称'] ?? ''),
    fund_type: null,
    company: null,
    manager: null,
    setup_date: null,
    total_size: null,
    nav: safeNum(r['单位净值']),
    nav_date: String(r['日期'] ?? ''),
    return_1y: safeNum(r['近1年']),
    return_3y: safeNum(r['近3年']),
    return_ytd: safeNum(r['今年来']),
    updated_at: now,
  })).filter((f) => f.code.length >= 6)

  return { data, source, fetchedAt: now }
}

async function fetchFundListEastmoney(): Promise<FetchResult<FundInfo>> {
  const url = 'https://fund.eastmoney.com/js/fundcode_search.js'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney fund list failed: ${res.status}`)
  const rows = parseEastmoneyFundCodeSearch(await res.text())
  if (rows.length === 0) throw new Error('EastMoney fund list returned no rows')

  const now = new Date().toISOString()
  const data: FundInfo[] = rows.map((row) => ({
    code: String(row[0] ?? ''),
    name: String(row[2] ?? ''),
    fund_type: nullableText(row[3]),
    fund_category: normalizeFundCategory({ fund_type: row[3], name: row[2] }),
    company: null,
    manager: null,
    setup_date: null,
    total_size: null,
    nav: null,
    nav_date: null,
    return_1y: null,
    return_3y: null,
    return_ytd: null,
    updated_at: now,
  })).filter((fund) => fund.code.length >= 6 && fund.name)

  if (data.length === 0) throw new Error('EastMoney fund list contained no valid code/name rows')
  return { data, source: 'eastmoney', fetchedAt: now }
}

async function fetchFundPerformanceSidecar(url: string, source: string, capabilityId: string): Promise<FetchResult<FundPerformanceMetric>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`AkShare fund performance failed: ${res.status}`)
  const rows = await readSidecarRows(res)
  const fetchedAt = new Date().toISOString()
  const data = rows.map((r) => normalizeFundPerformanceMetric(r, source, capabilityId, fetchedAt))
    .filter((row): row is FundPerformanceMetric => !!row)
  return { data, source, fetchedAt }
}

async function fetchFundPerformanceEastmoney(capabilityId: string): Promise<FetchResult<FundPerformanceMetric>> {
  const params = new URLSearchParams({
    op: 'ph',
    dt: 'kf',
    ft: 'all',
    rs: '',
    gs: '0',
    sc: 'zzf',
    st: 'desc',
    sd: '2000-01-01',
    ed: new Date().toISOString().slice(0, 10),
    qdii: '',
    tabSubtype: ',,,,,',
    pi: '1',
    pn: '500',
    dx: '1',
    v: String(Date.now()),
  })
  const url = `https://fund.eastmoney.com/data/rankhandler.aspx?${params}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://fund.eastmoney.com/data/fundranking.html',
    },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney fund performance failed: ${res.status}`)
  const rows = parseEastmoneyFundRankRows(await res.text())
  if (rows.length === 0) throw new Error('EastMoney fund performance returned no rows')
  const fetchedAt = new Date().toISOString()
  const data = rows.map((r) => normalizeFundPerformanceMetric(r, 'eastmoney', capabilityId, fetchedAt))
    .filter((row): row is FundPerformanceMetric => !!row)
  if (data.length === 0) throw new Error('EastMoney fund performance contained no canonical rows')
  return { data, source: 'eastmoney', fetchedAt }
}

function withFundListProvenance(
  result: FetchResult<FundInfo>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  },
): FetchResult<FundInfo> {
  return {
    ...result,
    provenance: {
      interfaceId: meta.interfaceId,
      capabilityId: meta.capabilityId,
      provider: meta.provider,
      source: result.source,
      canonicalSchema: 'fund_list',
      canonicalTable: 'fund_list',
      cacheStatus: meta.cacheStatus,
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}

function withFundPerformanceProvenance(
  result: FetchResult<FundPerformanceMetric>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  },
): FetchResult<FundPerformanceMetric> {
  return {
    ...result,
    provenance: {
      interfaceId: meta.interfaceId,
      capabilityId: meta.capabilityId,
      provider: meta.provider,
      source: result.source,
      canonicalSchema: 'fund_performance_metrics',
      canonicalTable: 'fund_performance_metrics',
      cacheStatus: meta.cacheStatus,
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
      asOf: result.data[0]?.metric_date,
    },
  }
}

async function readSidecarRows(res: Response): Promise<Array<Record<string, unknown>>> {
  const json = await res.json() as any
  const rows = (json.data ?? json) as Array<Record<string, unknown>>
  return Array.isArray(rows) ? rows : []
}

function normalizeFundPerformanceMetric(
  row: Record<string, unknown>,
  provider: string,
  capabilityId: string,
  fetchedAt: string,
): FundPerformanceMetric | null {
  const code = String(row['基金代码'] ?? row['code'] ?? row['symbol'] ?? '').trim()
  if (!code) return null
  const metricDate = normalizeDate(String(row['日期'] ?? row['净值日期'] ?? row['date'] ?? '').trim()) ?? fetchedAt.slice(0, 10)
  return {
    code,
    metric_date: metricDate,
    provider,
    capability_id: capabilityId,
    source_action: provider === 'eastmoney' ? 'rankhandler.aspx' : 'fund_open_fund_rank_em',
    nav: safeNum(row['单位净值'] ?? row['nav']),
    return_ytd: safeNum(row['今年来'] ?? row['return_ytd']),
    return_1w: safeNum(row['近1周'] ?? row['return_1w']),
    return_1m: safeNum(row['近1月'] ?? row['return_1m']),
    return_3m: safeNum(row['近3月'] ?? row['return_3m']),
    return_6m: safeNum(row['近6月'] ?? row['return_6m']),
    return_1y: safeNum(row['近1年'] ?? row['return_1y']),
    return_2y: safeNum(row['近2年'] ?? row['return_2y']),
    return_3y: safeNum(row['近3年'] ?? row['return_3y']),
    return_since_inception: safeNum(row['成立来'] ?? row['return_since_inception']),
    fetched_at: fetchedAt,
    raw_json: JSON.stringify(row),
  }
}

function normalizeDate(value: string): string | null {
  if (!value) return null
  const compact = /^(\d{4})(\d{2})(\d{2})/.exec(value)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  return null
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(String(v).replace(/[%，,]/g, '').trim())
  return isNaN(n) ? null : n
}

function nullableText(value: unknown): string | null {
  if (value == null || value === '') return null
  return String(value)
}

function parseEastmoneyFundCodeSearch(text: string): unknown[][] {
  const match = text.match(/var\s+r\s*=\s*(\[[\s\S]*\])\s*;?/)
  if (!match) return []
  const parsed = JSON.parse(match[1]) as unknown
  return Array.isArray(parsed) ? parsed.filter(Array.isArray) as unknown[][] : []
}

function parseEastmoneyFundRankRows(text: string): Array<Record<string, unknown>> {
  const match = text.match(/datas\s*:\s*(\[[\s\S]*?\])\s*,\s*allRecords/)
  if (!match) return []
  const parsed = JSON.parse(match[1]) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((line) => eastmoneyFundRankLineToRow(String(line ?? '')))
    .filter((row): row is Record<string, unknown> => !!row)
}

function eastmoneyFundRankLineToRow(line: string): Record<string, unknown> | null {
  const parts = line.split(',')
  const code = parts[0]?.trim()
  if (!code) return null
  return {
    基金代码: code,
    基金简称: parts[1]?.trim() ?? '',
    日期: parts[3]?.trim() ?? '',
    单位净值: parts[4]?.trim() ?? '',
    近1周: parts[6]?.trim() ?? '',
    近1月: parts[7]?.trim() ?? '',
    近3月: parts[8]?.trim() ?? '',
    近6月: parts[9]?.trim() ?? '',
    近1年: parts[10]?.trim() ?? '',
    近2年: parts[11]?.trim() ?? '',
    近3年: parts[12]?.trim() ?? '',
    今年来: parts[14]?.trim() ?? '',
    成立来: parts[15]?.trim() ?? '',
    成立日期: parts[16]?.trim() ?? '',
  }
}
