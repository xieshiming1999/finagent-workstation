import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readLimitPoolRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'
const BACKGROUND_TIMEOUT_MS = EASTMONEY_RUNTIME_TIMEOUT_MS

export interface LimitItem {
  date: string; code: string; name: string; limit_type: 'up' | 'down'
  change_pct: number; first_limit_time: string | null; last_limit_time: string | null
  open_count: number; limit_reason: string | null; continuous_days: number; source: string
}

export async function fetchLimitUpPool(
  date?: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<LimitItem>> {
  const routed = await runDataApiInterfaceRoute(
    'market.limit_pool',
    (capability) => limitPoolSource(capability, 'up', date),
    {
      label: 'limit-up pool',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readLimitPoolRows('up', { date, minRows: 1 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'limit_pool',
    canonicalTable: 'limit_pool',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

export async function fetchLimitDownPool(
  date?: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<LimitItem>> {
  const routed = await runDataApiInterfaceRoute(
    'market.limit_pool',
    (capability) => limitPoolSource(capability, 'down', date),
    {
      label: 'limit-down pool',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readLimitPoolRows('down', { date, minRows: 1 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'limit_pool',
    canonicalTable: 'limit_pool',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function limitPoolSource(
  capability: DataApiProviderCapability,
  side: 'up' | 'down',
  date?: string,
): DataApiInterfaceRoute<FetchResult<LimitItem>> | null {
  if (capability.provider !== 'eastmoney' && capability.provider !== 'akshare') return null
  const source = capability.provider
  return {
    capability,
    source,
    run: () => side === 'up'
      ? fetchLimitUpPoolSidecar(date, source)
      : fetchLimitDownPoolSidecar(date, source),
  }
}

async function fetchLimitUpPoolSidecar(
  date: string | undefined,
  source: 'eastmoney' | 'akshare',
): Promise<FetchResult<LimitItem>> {
  const tradeDate = date ?? today()
  const providerParam = source === 'eastmoney' ? '&_provider=eastmoney' : ''
  const url = `${SIDECAR}/akshare/stock_zt_pool_em?date=${akshareDate(tradeDate)}&_priority=background${providerParam}`
  const res = await fetch(url, { signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AkShare limit-up failed: ${res.status}`)
  const json = await res.json() as any
  const items = json.data as any[]
  if (!items?.length) return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  const data: LimitItem[] = items.map((d) => ({
    date: tradeDate,
    code: String(d['代码'] ?? d.code ?? ''),
    name: String(d['名称'] ?? d.name ?? ''),
    limit_type: 'up' as const,
    change_pct: Number(d['涨跌幅'] ?? 0),
    first_limit_time: d['首次封板时间'] ? String(d['首次封板时间']) : null,
    last_limit_time: d['最后封板时间'] ? String(d['最后封板时间']) : null,
    open_count: Number(d['炸板次数'] ?? d['开板次数'] ?? 0),
    limit_reason: d['所属行业'] ? String(d['所属行业']) : null,
    continuous_days: Number(d['连板数'] ?? 1),
    source,
  }))

  return { data, source, fetchedAt: new Date().toISOString() }
}

async function fetchLimitDownPoolSidecar(
  date: string | undefined,
  source: 'eastmoney' | 'akshare',
): Promise<FetchResult<LimitItem>> {
  const tradeDate = date ?? today()
  const providerParam = source === 'eastmoney' ? '&_provider=eastmoney' : ''
  const url = `${SIDECAR}/akshare/stock_zt_pool_dtgc_em?date=${akshareDate(tradeDate)}&_priority=background${providerParam}`
  const res = await fetch(url, { signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AkShare limit-down failed: ${res.status}`)
  const json = await res.json() as any
  const items = json.data as any[]
  if (!items?.length) return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  const data: LimitItem[] = items.map((d) => ({
    date: tradeDate,
    code: String(d['代码'] ?? d.code ?? ''),
    name: String(d['名称'] ?? d.name ?? ''),
    limit_type: 'down' as const,
    change_pct: Number(d['涨跌幅'] ?? 0),
    first_limit_time: null,
    last_limit_time: null,
    open_count: 0,
    limit_reason: null,
    continuous_days: 1,
    source,
  }))

  return { data, source, fetchedAt: new Date().toISOString() }
}

function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function akshareDate(date: string): string {
  return date.replaceAll('-', '')
}
