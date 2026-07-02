import type { FundamentalRow } from '../store/data-store'
import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundamentalRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { DefaultEastmoneyMarketProvider } from '../../../domain/market/providers/eastmoney-market-provider'
import { DefaultTdxMarketProvider } from '../../../domain/market/providers/tdx-market-provider'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../provider-timeouts'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export async function fetchFundamental(
  code: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<FundamentalRow>> {
  const routed = await runDataApiInterfaceRoute(
    'stock.daily_valuation',
    (capability) => fundamentalSource(capability, code),
    {
      label: 'stock daily valuation',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundamentalRows(code, { minRows: 1, limit: 8 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'fundamental',
    canonicalTable: 'fundamental',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function fundamentalSource(
  capability: DataApiProviderCapability,
  code: string,
): DataApiInterfaceRoute<FetchResult<FundamentalRow>> | null {
  if (capability.provider === 'eastmoney') {
    return {
      capability,
      source: 'eastmoney',
      run: async () => requireFundamentalRows('eastmoney', await fetchFundamentalEastmoney(code)),
    }
  }
  if (capability.provider === 'tdx') {
    return {
      capability,
      source: 'tdx',
      run: async () => requireFundamentalRows('tdx', await fetchFundamentalTdx(code)),
    }
  }
  if (capability.provider !== 'akshare') return null
  return {
    capability,
    source: 'akshare',
    run: async () => requireFundamentalRows('akshare', await fetchFundamentalAkshare(code)),
  }
}

function requireFundamentalRows(
  provider: string,
  result: FetchResult<FundamentalRow>,
): FetchResult<FundamentalRow> {
  if (result.data.length === 0) {
    throw new Error(`${provider} fundamental returned no rows`)
  }
  return result
}

async function fetchFundamentalTdx(code: string): Promise<FetchResult<FundamentalRow>> {
  const payload = await new DefaultTdxMarketProvider().fetchDirectAction('tdx_finance', {}, code, 1)
  const now = new Date().toISOString()
  const data = normalizeTdxFinancePayload(payload, code, now)
  return { data: data ? [data] : [], source: 'tdx', fetchedAt: now }
}

function normalizeTdxFinancePayload(payload: unknown, code: string, updatedAt: string): FundamentalRow | null {
  const row = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null
  const reportDate = formatReportDate(String(row?.updatedDate ?? row?.UpdatedDate ?? row?.report_date ?? row?.reportDate ?? row?.date ?? row?.Date ?? ''))
  if (!row || !reportDate) return null
  const totalAssets = safeNum(row.totalAssets ?? row.TotalAssets)
  const currentLiabilities = safeNum(row.currentLiabilities ?? row.CurrentLiabilities)
  const longTermLiabilities = safeNum(row.longTermLiabilities ?? row.LongTermLiabilities)
  const totalLiabilities = currentLiabilities == null && longTermLiabilities == null
    ? null
    : (currentLiabilities ?? 0) + (longTermLiabilities ?? 0)
  return {
    code,
    report_date: reportDate,
    pe_ttm: null,
    pb: null,
    ps_ttm: null,
    roe: null,
    gross_margin: null,
    net_margin: null,
    revenue: safeNum(row.operatingRevenue ?? row.OperatingRevenue),
    revenue_yoy: null,
    net_profit: safeNum(row.netProfit ?? row.NetProfit),
    profit_yoy: null,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    debt_ratio: totalLiabilities != null && totalAssets != null && totalAssets !== 0 ? totalLiabilities / totalAssets * 100 : null,
    dividend_yield: null,
    market_cap: null,
    circ_cap: null,
    source: 'tdx',
    updated_at: updatedAt,
    raw_json: JSON.stringify(payload),
  }
}

async function fetchFundamentalAkshare(code: string): Promise<FetchResult<FundamentalRow>> {
  const url = `${SIDECAR_AKSHARE}/stock_financial_analysis_indicator?symbol=${code}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`AkShare fundamental failed: ${res.status}`)
  const json = await res.json() as any; const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const data: FundamentalRow[] = rows.slice(0, 8).map((r) => ({
    code,
    report_date: formatReportDate(String(r['日期'] ?? r['报告期'] ?? '')),
    pe_ttm: safeNum(r['市盈率']),
    pb: safeNum(r['市净率']),
    ps_ttm: null,
    roe: safeNum(r['净资产收益率']),
    gross_margin: safeNum(r['销售毛利率']),
    net_margin: safeNum(r['销售净利率']),
    revenue: safeNum(r['营业总收入']),
    revenue_yoy: safeNum(r['营业总收入同比增长率']),
    net_profit: safeNum(r['净利润']),
    profit_yoy: safeNum(r['净利润同比增长率']),
    total_assets: safeNum(r['总资产']),
    total_liabilities: safeNum(r['总负债']),
    debt_ratio: safeNum(r['资产负债率']),
    dividend_yield: null,
    market_cap: null,
    circ_cap: null,
    source: 'akshare',
    updated_at: now,
  })).filter((r) => r.report_date)

  return { data, source: 'akshare', fetchedAt: now }
}

async function fetchFundamentalEastmoney(code: string): Promise<FetchResult<FundamentalRow>> {
  const rows = await new DefaultEastmoneyMarketProvider().readEarnings(code)
  const now = new Date().toISOString()
  const valuation = await readEastmoneyValuation(code).catch(() => null)
  const data: FundamentalRow[] = rows.map((row) => ({
    code,
    report_date: String(row.REPORT_DATE ?? '').slice(0, 10),
    revenue: safeNum(row.TOTALOPERATEREVE),
    revenue_yoy: safeNum(row.TOTALOPERATEREVETZ),
    net_profit: safeNum(row.PARENTNETPROFIT),
    profit_yoy: safeNum(row.PARENTNETPROFITTZ),
    gross_margin: safeNum(row.XSMLL),
    net_margin: safeNum(row.XSJLL),
    roe: safeNum(row.ROEJQ),
    debt_ratio: safeNum(row.ZCFZL),
    pe_ttm: valuation?.peTtm ?? null,
    pb: valuation?.pb ?? null,
    ps_ttm: null,
    total_assets: null,
    total_liabilities: null,
    dividend_yield: null,
    market_cap: null,
    circ_cap: null,
    source: 'eastmoney:earnings',
    updated_at: now,
    raw_json: JSON.stringify(row),
  })).filter((row) => row.report_date)

  return { data, source: 'eastmoney', fetchedAt: now }
}

async function readEastmoneyValuation(code: string): Promise<{ peTtm: number | null; pb: number | null }> {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecId(code)}&fields=f9,f23,f115,f162,f167`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(EASTMONEY_RUNTIME_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`EastMoney valuation API returned HTTP ${res.status}`)
  const json = await res.json() as Record<string, any>
  const data = json?.data ?? {}
  return {
    peTtm: firstRatio(data.f9, data.f162, data.f115),
    pb: firstRatio(data.f23, data.f167),
  }
}

function eastmoneySecId(code: string): string {
  if (code.startsWith('6')) return `1.${code}`
  if (code.startsWith('9') || code.startsWith('4') || code.startsWith('8')) return `0.${code}`
  return `0.${code}`
}

function firstRatio(...values: unknown[]): number | null {
  for (const value of values) {
    const ratio = eastmoneyRatio(value)
    if (ratio != null) return ratio
  }
  return null
}

function eastmoneyRatio(value: unknown): number | null {
  const n = safeNum(value)
  if (n == null || n <= 0) return null
  return Math.abs(n) >= 100 ? Number((n / 100).toFixed(4)) : n
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--' || v === 'NaN') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function formatReportDate(d: string): string {
  if (!d) return ''
  if (d.includes('-') && d.length >= 10) return d.substring(0, 10)
  if (d.length === 8) return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`
  return d
}
