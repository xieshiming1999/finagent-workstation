import type { DataStore, StockInfo } from './store/data-store'
import { fetchStockListA } from './fetchers/fetcher-stock-list'

const BOOTSTRAP_COOLDOWN_MS = 15 * 60_000

let bootstrapPromise: Promise<void> | null = null
let nextBootstrapAttemptAt = 0

export async function resolveStockNames(
  codes: string[],
  store?: DataStore | null,
  fallback?: (missingCodes: string[]) => Promise<Map<string, string>>,
): Promise<Map<string, string>> {
  const cleanCodes = uniqueCodes(codes)
  if (cleanCodes.length === 0) return new Map()

  const names = readStockNames(store, cleanCodes)
  const missing = cleanCodes.filter((code) => !names.has(code))

  if (missing.length > 0) {
    await maybeBootstrapAshareNames(store)
    for (const [code, name] of readStockNames(store, missing)) {
      names.set(code, name)
    }
  }

  const stillMissing = cleanCodes.filter((code) => !names.has(code))
  if (stillMissing.length > 0 && fallback) {
    for (const [code, name] of await fallback(stillMissing)) {
      names.set(code, name)
      saveStockNames(store, [{ code, name, market: marketForCode(code) }])
    }
  }

  return names
}

export function saveStockNames(
  store: DataStore | null | undefined,
  rows: Array<{ code: string; name: string; market?: string }>,
): void {
  if (!store?.isReady) return
  const now = new Date().toISOString()
  const stocks: StockInfo[] = rows
    .map((row) => ({
      code: cleanCode(row.code),
      name: row.name.trim(),
      market: row.market ?? marketForCode(row.code),
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'stock',
      updated_at: now,
    }))
    .filter((row) => row.code.length >= 6 && row.name && row.name !== row.code)
  if (stocks.length > 0) store.saveStockList(stocks)
}

function readStockNames(store: DataStore | null | undefined, codes: string[]): Map<string, string> {
  if (!store?.isReady || codes.length === 0) return new Map()
  const placeholders = codes.map(() => '?').join(',')
  const rows = store.query<{ code: string; name: string }>(
    `SELECT code,name FROM stock_list WHERE code IN (${placeholders}) AND name IS NOT NULL AND name != ''`,
    ...codes,
  )
  return new Map(rows
    .map((row) => [cleanCode(row.code), row.name] as const)
    .filter(([code, name]) => code && name && name !== code))
}

async function maybeBootstrapAshareNames(store: DataStore | null | undefined): Promise<void> {
  if (!store?.isReady) return
  if (Date.now() < nextBootstrapAttemptAt) return
  if (!bootstrapPromise) {
    bootstrapPromise = fetchStockListA()
      .then((result) => {
        store.saveStockList(result.data)
        nextBootstrapAttemptAt = Date.now() + 24 * 60 * 60_000
      })
      .catch(() => {
        nextBootstrapAttemptAt = Date.now() + BOOTSTRAP_COOLDOWN_MS
      })
      .finally(() => {
        bootstrapPromise = null
      })
  }
  await bootstrapPromise
}

function uniqueCodes(codes: string[]): string[] {
  return Array.from(new Set(codes.map(cleanCode).filter((code) => code.length >= 6)))
}

function cleanCode(code: string): string {
  return String(code ?? '').replace(/^S[HZ]/i, '').replace(/^\d\./, '').trim()
}

function marketForCode(code: string): string {
  const clean = cleanCode(code)
  if (clean.startsWith('6')) return 'SH'
  if (clean.startsWith('8') || clean.startsWith('4')) return 'BJ'
  return 'SZ'
}
