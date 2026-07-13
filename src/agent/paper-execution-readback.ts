import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readPaperExecutionState(basePath: string, market = 'cn'): Record<string, unknown> {
  const normalized = normalizeMarket(market)
  const defaults = normalized === 'us'
    ? { cash: 100_000, currency: 'USD' }
    : normalized === 'hk'
      ? { cash: 500_000, currency: 'HKD' }
      : { cash: 1_000_000, currency: 'CNY' }
  const data = load(basePath, normalized)
  const positions = object(data.positions)
  const trades = Array.isArray(data.trades) ? data.trades : []
  const receipts = object(data.executionReceipts)
  return {
    contract: 'finagent.paper-execution-state.v1',
    market: normalized,
    currency: defaults.currency,
    cash: typeof data.cash === 'number' ? data.cash : defaults.cash,
    initialCash: typeof data.initialCash === 'number' ? data.initialCash : defaults.cash,
    positions,
    positionCount: Object.keys(positions).length,
    tradeCount: trades.length,
    receiptCount: Object.keys(receipts).length,
    lastTrade: trades.at(-1) ?? null,
    fetchedAt: new Date().toISOString(),
    sideEffectBoundary: 'local_paper_portfolio_only',
  }
}

export function readPaperExecutionReceipt(
  basePath: string,
  idempotencyKey: string,
  market = 'cn',
): Record<string, unknown> {
  const normalized = normalizeMarket(market)
  const receipts = object(load(basePath, normalized).executionReceipts)
  const receipt = receipts[idempotencyKey]
  return {
    contract: 'finagent.execution-receipt-readback.v1',
    market: normalized,
    idempotencyKey,
    found: Boolean(receipt && typeof receipt === 'object'),
    receipt: receipt && typeof receipt === 'object' ? receipt : null,
  }
}

function load(basePath: string, market: string): Record<string, unknown> {
  const path = join(basePath, 'memory', `.portfolio_${market}.json`)
  if (!existsSync(path)) return {}
  try {
    const decoded: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return object(decoded)
  } catch {
    return {}
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeMarket(market: string): string {
  const normalized = market.trim().toLowerCase()
  if (normalized === 'cn' || normalized === 'us' || normalized === 'hk') return normalized
  throw new Error('market must be cn, us, or hk')
}
