import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readTradeCalendarRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'

export interface CalendarRow {
  date: string; market: string; is_trading_day: number; year: number; month: number
}

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export async function fetchTradeCalendar(
  year: number,
  market = 'CN',
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<CalendarRow>> {
  if (market !== 'CN') return { data: [], source: 'none', fetchedAt: new Date().toISOString() }
  const routed = await runDataApiInterfaceRoute(
    'calendar.trade_days',
    (capability) => tradeCalendarSource(capability, year),
    {
      label: 'trade calendar',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readTradeCalendarRows(year, market)
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'trade_calendar',
    canonicalTable: 'trade_calendar',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function tradeCalendarSource(
  capability: DataApiProviderCapability,
  year: number,
): DataApiInterfaceRoute<FetchResult<CalendarRow>> | null {
  if (capability.id === 'akshare.calendar.trade_days') {
    return {
      capability,
      source: 'akshare',
      run: () => fetchCalendarAkshareSina(year),
    }
  }
  if (capability.provider !== 'szse') return null
  return {
    capability,
    source: 'szse',
    run: () => fetchCalendarCN(year),
  }
}

async function fetchCalendarCN(year: number): Promise<FetchResult<CalendarRow>> {
  const days: Array<{ jyrq: string; jybz: string }> = []
  for (let month = 1; month <= 12; month++) {
    const monthText = `${year}-${String(month).padStart(2, '0')}`
    const url = `http://www.szse.cn/api/report/exchange/onepersistenthour/monthList?month=${monthText}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`SZSE calendar ${monthText} failed: ${res.status}`)
    const json = await res.json() as { data?: Array<{ jyrq: string; jybz: string }> }
    if (Array.isArray(json.data)) days.push(...json.data)
  }
  if (days.length === 0) throw new Error(`SZSE calendar returned no rows for ${year}`)

  const data: CalendarRow[] = days.map((d) => {
    const date = d.jyrq.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
    return {
      date,
      market: 'CN',
      is_trading_day: d.jybz === '1' ? 1 : 0,
      year: parseInt(date.substring(0, 4)),
      month: parseInt(date.substring(5, 7)),
    }
  })

  return { data, source: 'szse', fetchedAt: new Date().toISOString() }
}

async function fetchCalendarAkshareSina(year: number): Promise<FetchResult<CalendarRow>> {
  const res = await fetch(`${SIDECAR_AKSHARE}/tool_trade_date_hist_sina?_priority=background`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`AkShare/Sina trade calendar failed: ${res.status}`)
  const json = await res.json() as { data?: Array<Record<string, unknown>>; error?: string }
  if (json.error) throw new Error(`AkShare/Sina trade calendar failed: ${json.error}`)
  const rows = Array.isArray(json.data) ? json.data : []
  const data = rows
    .map((row) => normalizeAkshareSinaCalendarRow(row))
    .filter((row): row is CalendarRow => row != null && row.year === year)
  if (data.length === 0) throw new Error(`AkShare/Sina trade calendar returned no rows for ${year}`)
  return { data, source: 'akshare', fetchedAt: new Date().toISOString() }
}

function normalizeAkshareSinaCalendarRow(row: Record<string, unknown>): CalendarRow | null {
  const raw = String(row.trade_date ?? row.date ?? '').trim()
  const date = raw.includes('-')
    ? raw.slice(0, 10)
    : raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    date,
    market: 'CN',
    is_trading_day: 1,
    year: parseInt(date.substring(0, 4)),
    month: parseInt(date.substring(5, 7)),
  }
}
