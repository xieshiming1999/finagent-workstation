import type { FetchResult } from './base-fetcher'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundNavRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface FundNavRow {
  code: string; date: string; nav: number; acc_nav: number | null
  daily_return: number | null; source: string
}

export async function fetchFundNav(
  code: string,
  startDate?: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<FundNavRow>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.nav_history',
    (capability) => fundNavSource(capability, code, startDate),
    {
      label: `fund nav for ${code}`,
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundNavRows(code, { start: startDate, minRows: 1 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withFundNavProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function fundNavSource(
  capability: DataApiProviderCapability,
  code: string,
  startDate?: string,
): DataApiInterfaceRoute<FetchResult<FundNavRow>> | null {
  const symbol = encodeURIComponent(code)
  const indicator = encodeURIComponent('单位净值走势')
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchFundNavEastmoney(code, startDate),
    }
  if (capability.provider === 'akshare')
    return {
      capability,
      run: () => fetchFundNavSidecar(
        `${SIDECAR_AKSHARE}/fund_open_fund_info_em?symbol=${symbol}&indicator=${indicator}`,
        code,
        startDate,
        'akshare',
      ),
    }
  return null
}

async function fetchFundNavSidecar(
  url: string,
  code: string,
  startDate: string | undefined,
  source: string,
): Promise<FetchResult<FundNavRow>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare fund nav failed: ${res.status}`)
  const json = await res.json() as any; const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const data: FundNavRow[] = rows
    .map((r) => ({
      code,
      date: String(r['净值日期'] ?? r['日期'] ?? '').substring(0, 10),
      nav: Number(r['单位净值'] ?? r['net_value'] ?? 0),
      acc_nav: safeNum(r['累计净值']),
      daily_return: safeNum(r['日增长率']),
      source,
    }))
    .filter((r) => r.date && r.nav > 0)
    .filter((r) => !startDate || r.date > startDate)

  return { data, source, fetchedAt: now }
}

async function fetchFundNavEastmoney(
  code: string,
  startDate: string | undefined,
): Promise<FetchResult<FundNavRow>> {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://fund.eastmoney.com/${encodeURIComponent(code)}.html`,
    },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney fund NAV failed: ${res.status}`)
  const rows = parseEastmoneyFundNavRows(await res.text())
  if (rows.length === 0) throw new Error('EastMoney fund NAV returned no rows')

  const now = new Date().toISOString()
  const data: FundNavRow[] = rows
    .map((row) => ({
      code,
      date: dateFromEpochMs(row.x),
      nav: safeNum(row.y) ?? 0,
      acc_nav: null,
      daily_return: safeNum(row.equityReturn),
      source: 'eastmoney',
    }))
    .filter((row) => row.date && row.nav > 0)
    .filter((row) => !startDate || row.date > startDate)

  if (data.length === 0) throw new Error('EastMoney fund NAV contained no valid rows')
  return { data, source: 'eastmoney', fetchedAt: now }
}

function withFundNavProvenance(
  result: FetchResult<FundNavRow>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  },
): FetchResult<FundNavRow> {
  return {
    ...result,
    provenance: {
      interfaceId: meta.interfaceId,
      capabilityId: meta.capabilityId,
      provider: meta.provider,
      source: result.source,
      canonicalSchema: 'fund_nav',
      canonicalTable: 'fund_nav',
      cacheStatus: meta.cacheStatus,
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function parseEastmoneyFundNavRows(text: string): Array<{ x: unknown; y: unknown; equityReturn?: unknown }> {
  const match = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!match) return []
  const parsed = JSON.parse(match[1]) as unknown
  return Array.isArray(parsed)
    ? parsed.filter((row): row is { x: unknown; y: unknown; equityReturn?: unknown } => row != null && typeof row === 'object' && !Array.isArray(row))
    : []
}

function dateFromEpochMs(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return new Date(n).toISOString().slice(0, 10)
}
