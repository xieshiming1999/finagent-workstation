import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundMoneyYieldRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

export interface FundMoneyYieldRow {
  code: string
  date: string
  million_copies_income: number | null
  seven_day_annualized_yield: number | null
  source: string
  fetched_at?: string
  raw_json?: string | null
}

export async function fetchFundMoneyYield(
  code: string,
  startDate?: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<FundMoneyYieldRow>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.money_yield_history',
    (capability) => fundMoneyYieldSource(capability, code, startDate),
    {
      label: `money fund yield for ${code}`,
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundMoneyYieldRows(code, { start: startDate, minRows: 1 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )

  return {
    ...routed.data,
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.data.source,
      canonicalSchema: 'fund_money_yield',
      canonicalTable: 'fund_money_yield',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      fetchedAt: routed.data.fetchedAt,
    },
  }
}

function fundMoneyYieldSource(
  capability: DataApiProviderCapability,
  code: string,
  startDate?: string,
): DataApiInterfaceRoute<FetchResult<FundMoneyYieldRow>> | null {
  if (capability.provider !== 'eastmoney') return null
  return {
    capability,
    source: 'eastmoney',
    run: () => fetchFundMoneyYieldEastmoney(code, startDate),
  }
}

async function fetchFundMoneyYieldEastmoney(
  code: string,
  startDate: string | undefined,
): Promise<FetchResult<FundMoneyYieldRow>> {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://fund.eastmoney.com/${encodeURIComponent(code)}.html`,
    },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney money fund yield failed: ${res.status}`)
  const text = await res.text()
  const income = parsePointSeries(text, 'Data_millionCopiesIncome')
  const annualized = parsePointSeries(text, 'Data_sevenDaysYearIncome')
  if (income.length === 0 && annualized.length === 0) {
    throw new Error('EastMoney money fund yield returned no yield series')
  }

  const now = new Date().toISOString()
  const byDate = new Map<string, FundMoneyYieldRow>()
  for (const point of income) {
    if (startDate && point.date <= startDate) continue
    byDate.set(point.date, {
      code,
      date: point.date,
      million_copies_income: point.value,
      seven_day_annualized_yield: null,
      source: 'eastmoney',
      fetched_at: now,
      raw_json: JSON.stringify({ million_copies_income: point.raw }),
    })
  }
  for (const point of annualized) {
    if (startDate && point.date <= startDate) continue
    const existing = byDate.get(point.date)
    if (existing) {
      existing.seven_day_annualized_yield = point.value
      existing.raw_json = JSON.stringify({
        million_copies_income: existing.million_copies_income,
        seven_day_annualized_yield: point.raw,
      })
    } else {
      byDate.set(point.date, {
        code,
        date: point.date,
        million_copies_income: null,
        seven_day_annualized_yield: point.value,
        source: 'eastmoney',
        fetched_at: now,
        raw_json: JSON.stringify({ seven_day_annualized_yield: point.raw }),
      })
    }
  }

  const data = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  if (data.length === 0) throw new Error('EastMoney money fund yield contained no new rows')
  return { data, source: 'eastmoney', fetchedAt: now }
}

function parsePointSeries(text: string, variableName: string): Array<{ date: string; value: number | null; raw: unknown }> {
  const match = text.match(new RegExp(`var\\s+${variableName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`))
  if (!match) return []
  const parsed = JSON.parse(match[1]) as unknown
  if (!Array.isArray(parsed)) return []
  const rows: Array<{ date: string; value: number | null; raw: unknown }> = []
  for (const row of parsed) {
      if (!Array.isArray(row) || row.length < 2) continue
      const date = dateFromEpochMs(row[0])
      if (!date) continue
      rows.push({ date, value: safeNum(row[1]), raw: row })
  }
  return rows
}

function safeNum(value: unknown): number | null {
  if (value == null || value === '' || value === '--') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dateFromEpochMs(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return new Date(n).toISOString().slice(0, 10)
}
