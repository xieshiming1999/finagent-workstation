import type { FetchResult } from './base-fetcher'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readIndexConstituentRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface IndexComponent {
  index_code: string
  stock_code: string
  stock_name: string
  weight: number | null
  as_of_date: string
  provider: string
  capability_id: string
  source_action: string
  fetched_at: string
  raw_json: string | null
}

const INDEX_NAMES: Record<string, string> = {
  '000300': '沪深300',
  '000905': '中证500',
  '000852': '中证1000',
  '000016': '上证50',
  '399006': '创业板指',
}

export function getSupportedIndices(): Array<{ code: string; name: string }> {
  return Object.entries(INDEX_NAMES).map(([code, name]) => ({ code, name }))
}

export async function fetchIndexComponents(indexCode: string, opts: DataApiFetchOptions & { asOfDate?: string; limit?: number } = {}): Promise<FetchResult<IndexComponent>> {
  const indexName = INDEX_NAMES[indexCode]
  if (!indexName) {
    throw new Error(`Unsupported index: ${indexCode}. Supported: ${Object.keys(INDEX_NAMES).join(', ')}`)
  }

  const routed = await runDataApiInterfaceRoute(
    'index.constituents',
    (capability) => indexConstituentSource(capability, indexCode),
    {
      label: 'index constituents',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readIndexConstituentRows({
          indexCode,
          asOfDate: opts.asOfDate,
          minRows: 10,
          limit: opts.limit ?? 500,
        })
        return rows.length > 0
          ? { data: rows as IndexComponent[], source: 'local', fetchedAt: new Date().toISOString() }
          : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withIndexConstituentProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function indexConstituentSource(
  capability: DataApiProviderCapability,
  indexCode: string,
): DataApiInterfaceRoute<FetchResult<IndexComponent>> | null {
  if (capability.provider === 'akshare')
    return {
      capability,
      run: () => fetchIndexComponentsSidecar(indexCode, capability),
    }
  return null
}

async function fetchIndexComponentsSidecar(
  indexCode: string,
  capability: DataApiProviderCapability,
): Promise<FetchResult<IndexComponent>> {
  const url = `${SIDECAR_AKSHARE}/index_stock_cons?symbol=${indexCode}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`AkShare index components failed: ${res.status}`)
  const json = await res.json() as any; const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const asOfDate = now.slice(0, 10)
  const data: IndexComponent[] = rows.map((r) => ({
    index_code: indexCode,
    stock_code: String(r['品种代码'] ?? r['code'] ?? ''),
    stock_name: String(r['品种名称'] ?? r['name'] ?? ''),
    weight: safeNum(r['权重'] ?? r['weight']),
    as_of_date: String(r['纳入日期'] ?? r['date'] ?? r['as_of_date'] ?? asOfDate),
    provider: capability.provider,
    capability_id: capability.id,
    source_action: 'index_stock_cons',
    fetched_at: now,
    raw_json: JSON.stringify(r),
  })).filter((c) => c.stock_code.length >= 6)

  return { data, source: 'akshare', fetchedAt: now }
}

export async function getIndexComponentCodes(indexCode: string, opts: DataApiFetchOptions = {}): Promise<string[]> {
  const result = await fetchIndexComponents(indexCode, opts)
  return result.data.map((c) => c.stock_code)
}

function withIndexConstituentProvenance(
  result: FetchResult<IndexComponent>,
  provenance: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision: string
  },
): FetchResult<IndexComponent> {
  const asOf = result.data.map((row) => row.as_of_date).sort().at(-1)
  return {
    ...result,
    provenance: {
      ...provenance,
      source: result.source,
      endpoint: 'index_stock_cons',
      canonicalSchema: 'index_constituent',
      canonicalTable: 'index_constituent',
      asOf,
      fetchedAt: result.fetchedAt,
    },
  }
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
