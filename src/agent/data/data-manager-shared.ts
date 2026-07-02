import { globalApiStats } from './resilience'
import { fetchSidecarJson, isSidecarStartupError } from './sidecar-http'
import { DEFAULT_PROVIDER_TIMEOUT_MS, timeoutForEastmoneyBackedUrl } from './provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'

export interface Quote {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  amount: number
  pe: number | null
  pb: number | null
  marketCap: number | null
  turnoverRate: number | null
  source?: string | null
  timestamp?: string | null
  fetchedAt?: string | null
}

export interface KlineBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  changePct: number | null
  turnoverRate: number | null
}

export interface MoneyFlow {
  date: string
  mainNetInflow: number
  smallNetInflow: number
  mediumNetInflow: number
  largeNetInflow: number
  superLargeNetInflow: number
  closePrice: number | null
  changePct: number | null
}

export interface SectorItem {
  code: string
  name: string
  changePct: number
  turnoverRate: number | null
  upCount: number
  downCount: number
  leadingStock: string | null
  leadingChangePct: number | null
}

interface CacheEntry<T> {
  data: T
  expiry: number
}

const cache = new Map<string, CacheEntry<unknown>>()

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (entry && Date.now() < entry.expiry) return Promise.resolve(entry.data)
  return fn().then((data) => {
    cache.set(key, { data, expiry: Date.now() + ttlMs })
    return data
  })
}

export async function sidecarGet(path: string, timeout = timeoutForEastmoneyBackedUrl(path, DEFAULT_PROVIDER_TIMEOUT_MS)): Promise<any> {
  const start = Date.now()
  let recorded = false
  try {
    const res = await fetchSidecarJson(path, { timeoutMs: timeout })
    globalApiStats.record({
      source: detectSidecarSource(path),
      url: path.split('?')[0],
      status: res.status,
      durationMs: Date.now() - start,
      success: res.ok,
      timestamp: new Date().toISOString(),
      tool: 'MarketData',
      action: path.split('?')[0],
    })
    recorded = true
    if (!res.ok) throw new Error(`sidecar ${path}: ${res.status}`)
    return res.json()
  } catch (err) {
    if (!recorded && !isSidecarStartupError(err)) {
      globalApiStats.record({
        source: detectSidecarSource(path),
        url: path.split('?')[0],
        status: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
        tool: 'MarketData',
        action: path.split('?')[0],
      })
    }
    throw err
  }
}

function detectSidecarSource(path: string): string {
  if (path.startsWith('/yfinance')) return 'yfinance'
  if (path.startsWith('/akshare')) return 'akshare'
  return 'sidecar'
}

export function d(v: unknown): number {
  if (typeof v === 'number') return v
  return parseFloat(String(v)) || 0
}

export function dn(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export function clearCache() {
  cache.clear()
}

export { SIDECAR }
