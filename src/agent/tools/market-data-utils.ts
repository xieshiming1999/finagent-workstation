import type { ToolContext } from '../tool'
import * as dm from '../data/data-manager'
import { DataStore } from '../data/store/data-store'
import { quoteToSnapshot, snapshotToQuote } from '../data/normalizers/quote-normalizer'
import { fetchQuote as fetchPreferredQuote } from '../data/fetchers/fetcher-quote'
import type { FetchProvenance } from '../data/fetchers/base-fetcher'

let localStore: DataStore | null = null
let localStoreBasePath: string | null = null

export function getLocalStore(ctx: ToolContext): DataStore {
  if (!localStore || localStoreBasePath !== ctx.basePath) {
    localStore = new DataStore(ctx.basePath)
    localStoreBasePath = ctx.basePath
  }
  return localStore
}

export function formatQuote(q: dm.Quote): string {
  const dir = q.changePct >= 0 ? '▲' : '▼'
  const ohlc = formatOhlc(q)
  return [
    `${q.name} (${q.code})`,
    `Price: ${q.price}  ${dir} ${q.changePct.toFixed(2)}% (${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)})`,
    ohlc,
    `Volume: ${fmtVol(q.volume)}  Amount: ${fmtAmt(q.amount)}`,
    q.pe != null ? `PE: ${q.pe.toFixed(1)}  PB: ${q.pb?.toFixed(2) ?? '-'}  MCap: ${fmtAmt(q.marketCap ?? 0)}  Turnover: ${q.turnoverRate?.toFixed(2) ?? '-'}%` : '',
  ].filter(Boolean).join('\n')
}

function formatOhlc(q: dm.Quote): string {
  const entries = [
    ['Open', q.open],
    ['High', q.high],
    ['Low', q.low],
    ['PrevClose', q.prevClose],
  ] as const
  const hasAnyRealValue = entries.some(([, value]) => isMeaningfulMarketNumber(value))
  if (!hasAnyRealValue) return ''
  return entries
    .map(([label, value]) => `${label}: ${isMeaningfulMarketNumber(value) ? value : '-'}`)
    .join('  ')
}

function isMeaningfulMarketNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0
}

export async function getPreferredQuotes(codes: string[]): Promise<Array<{ quotes: dm.Quote[]; source: string; provenance?: FetchProvenance }>> {
  const results: Array<{ quotes: dm.Quote[]; source: string; provenance?: FetchProvenance }> = []
  for (const code of codes) {
    try {
      const result = await fetchPreferredQuote(code)
      results.push({ quotes: result.data, source: result.source, provenance: result.provenance })
    } catch {}
  }
  return results
}

export function getRecentQuoteSnapshots(ctx: ToolContext, codes: string[], maxAgeMs: number): Map<string, dm.Quote> {
  const result = new Map<string, dm.Quote>()
  try {
    const store = getLocalStore(ctx)
    for (const code of codes) {
      const snapshot = store.getRecentQuoteSnapshot(code, maxAgeMs)
      if (!snapshot) continue
      const quote = snapshotToQuote(snapshot)
      if (quote) result.set(code, quote)
    }
  } catch {}
  return result
}

export function saveQuoteSnapshots(ctx: ToolContext, quotes: dm.Quote[], source: string): void {
  if (quotes.length === 0) return
  try {
    const store = getLocalStore(ctx)
    store.saveQuoteSnapshots(quotes.map((q) => quoteToSnapshot(q, source)))
  } catch {}
}

export function normalizeCnMarket(code: string): string {
  const clean = code.trim()
  if (clean.startsWith('6')) return 'SH'
  if (clean.startsWith('4') || clean.startsWith('8') || clean.startsWith('9')) return 'BJ'
  return 'SZ'
}

export function recordDirectApiFailure(
  ctx: ToolContext,
  input: {
    source: string
    action: string
    endpoint: string
    startedAt: number
    status?: number
    failureClass?: string
    error: unknown
  },
): void {
  try {
    const structured = structuredApiFailure(input.error)
    const status = input.status ?? structured.status
    getLocalStore(ctx).saveApiCall({
      source: input.source,
      tool: 'MarketData',
      action: input.action,
      endpoint: input.endpoint,
      status: Number.isFinite(status) ? Number(status) : 0,
      success: false,
      failure_class: input.failureClass ?? structured.failureClass ?? failureClassForStatus(status),
      duration_ms: Date.now() - input.startedAt,
      error: input.error instanceof Error ? input.error.message : String(input.error),
    })
  } catch {}
}

function structuredApiFailure(error: unknown): { status?: number; failureClass?: string } {
  if (typeof error !== 'object' || error == null) return {}
  const record = error as Record<string, unknown>
  const failures = Array.isArray(record.failures) ? record.failures : []
  const first = failures.find((value) => typeof value === 'object' && value != null) as Record<string, unknown> | undefined
  const statusValue = Number(record.status ?? first?.status)
  const failureClassValue = record.failureClass ?? first?.failureClass
  return {
    status: Number.isFinite(statusValue) ? statusValue : undefined,
    failureClass: typeof failureClassValue === 'string' && failureClassValue.trim()
      ? failureClassValue.trim()
      : undefined,
  }
}

function failureClassForStatus(status: number | undefined): string {
  if (status === 401 || status === 403) return 'auth_permission'
  if (status === 429) return 'quota_rate_limit'
  if (status === 400 || status === 422) return 'invalid_parameters'
  if (status != null && status >= 500) return 'provider_outage'
  return 'unknown'
}

export function getConfiguredToken(ctx: ToolContext, key: string): string {
  const value = ctx.getConfigValue?.(key)
  return typeof value === 'string' ? value.trim() : ''
}

export function tushareParams(input: Record<string, unknown>): Record<string, unknown> {
  if (input.params && typeof input.params === 'object' && !Array.isArray(input.params)) {
    return input.params as Record<string, unknown>
  }
  const ignored = new Set(['action', 'api_name', 'apiName', 'fields'])
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!ignored.has(key) && value != null) result[key] = value
  }
  return result
}

export function fmtVol(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}M lots`
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}K lots`
  return String(v)
}

export function fmtNum(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(2)
}

export function fmtAmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-'
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}B`
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}W`
  return v.toFixed(0)
}

export function toNumOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function cartesian(arrays: number[][]): number[][] {
  if (arrays.length === 0) return [[]]
  const [first, ...rest] = arrays
  const restCombos = cartesian(rest)
  const result: number[][] = []
  for (const item of first) {
    for (const combo of restCombos) {
      result.push([item, ...combo])
    }
  }
  return result
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function flowRankPeriod(days: number): string {
  if (days >= 10) return '10day'
  if (days >= 5) return '5day'
  if (days >= 3) return '3day'
  return 'today'
}
