import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface TradeSignal {
  id: string
  type: 'operation' | 'strategy' | 'discussion'
  code: string
  name: string
  direction: 'buy' | 'sell' | 'hold'
  entryPrice?: number
  targetPrice?: number
  stopLoss?: number
  reasoning: string
  confidence: number
  source: string
  createdAt: string
  resolvedAt?: string
  resolvedPrice?: number
  pnlPct?: number
  outcome?: 'win' | 'loss' | 'pending'
}

let signals: TradeSignal[] = []
let loaded = false

function loadSignals(basePath: string) {
  if (loaded) return
  const filePath = join(basePath, 'signals.json')
  if (existsSync(filePath)) {
    try { signals = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { /* ignore */ }
  }
  loaded = true
}

function saveSignals(basePath: string) {
  mkdirSync(basePath, { recursive: true })
  writeFileSync(join(basePath, 'signals.json'), JSON.stringify(signals, null, 2), 'utf-8')
}

export function publishSignal(basePath: string, signal: Omit<TradeSignal, 'id' | 'createdAt' | 'outcome'>): TradeSignal {
  loadSignals(basePath)
  const entry: TradeSignal = {
    ...signal,
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    outcome: 'pending',
  }
  signals.unshift(entry)
  saveSignals(basePath)
  return entry
}

export function resolveSignal(basePath: string, id: string, resolvedPrice: number): TradeSignal | null {
  loadSignals(basePath)
  const signal = signals.find((s) => s.id === id)
  if (!signal || signal.outcome !== 'pending') return null

  signal.resolvedAt = new Date().toISOString()
  signal.resolvedPrice = resolvedPrice
  if (signal.entryPrice) {
    signal.pnlPct = signal.direction === 'buy'
      ? ((resolvedPrice - signal.entryPrice) / signal.entryPrice) * 100
      : ((signal.entryPrice - resolvedPrice) / signal.entryPrice) * 100
    signal.outcome = signal.pnlPct > 0 ? 'win' : 'loss'
  }
  saveSignals(basePath)
  return signal
}

export function getSignals(basePath: string, filter?: { type?: string; code?: string; outcome?: string }): TradeSignal[] {
  loadSignals(basePath)
  let result = signals
  if (filter?.type) result = result.filter((s) => s.type === filter.type)
  if (filter?.code) result = result.filter((s) => s.code === filter.code)
  if (filter?.outcome) result = result.filter((s) => s.outcome === filter.outcome)
  return result
}

export function getSignalStats(basePath: string): { total: number; wins: number; losses: number; pending: number; winRate: number; avgPnl: number } {
  loadSignals(basePath)
  const resolved = signals.filter((s) => s.outcome !== 'pending')
  const wins = resolved.filter((s) => s.outcome === 'win').length
  const losses = resolved.filter((s) => s.outcome === 'loss').length
  const pnls = resolved.filter((s) => s.pnlPct != null).map((s) => s.pnlPct!)
  return {
    total: signals.length,
    wins,
    losses,
    pending: signals.filter((s) => s.outcome === 'pending').length,
    winRate: resolved.length > 0 ? (wins / resolved.length) * 100 : 0,
    avgPnl: pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
  }
}

export function formatSignalStats(stats: ReturnType<typeof getSignalStats>): string {
  return [
    `Signal Journal: ${stats.total} signals`,
    `Win/Loss: ${stats.wins}/${stats.losses} (${stats.winRate.toFixed(1)}% win rate)`,
    `Pending: ${stats.pending}`,
    `Avg P&L: ${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(2)}%`,
  ].join('\n')
}
