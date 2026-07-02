import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { KlineBar } from './data-manager'
import { runBacktest, BUILTIN_STRATEGIES, type BacktestResult } from './backtest'

export interface Challenge {
  id: string
  name: string
  code: string
  startDate: string
  endDate: string
  strategies: string[]
  status: 'active' | 'settled'
  results?: ChallengeResult[]
  createdAt: string
  settledAt?: string
}

export interface ChallengeResult {
  strategy: string
  totalReturn: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  score: number
  rank: number
}

let challenges: Challenge[] = []
let loaded = false

function load(basePath: string) {
  if (loaded) return
  const fp = join(basePath, 'challenges.json')
  if (existsSync(fp)) {
    try { challenges = JSON.parse(readFileSync(fp, 'utf-8')) } catch { /* ignore */ }
  }
  loaded = true
}

function save(basePath: string) {
  mkdirSync(basePath, { recursive: true })
  writeFileSync(join(basePath, 'challenges.json'), JSON.stringify(challenges, null, 2), 'utf-8')
}

export function createChallenge(
  basePath: string,
  name: string,
  code: string,
  strategies?: string[],
): Challenge {
  load(basePath)
  const challenge: Challenge = {
    id: `ch-${Date.now()}`,
    name,
    code,
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    strategies: strategies ?? Object.keys(BUILTIN_STRATEGIES),
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  challenges.unshift(challenge)
  save(basePath)
  return challenge
}

export function settleChallenge(basePath: string, id: string, bars: KlineBar[]): Challenge | null {
  load(basePath)
  const challenge = challenges.find((c) => c.id === id)
  if (!challenge || challenge.status === 'settled') return null

  const results: ChallengeResult[] = []
  for (const stratName of challenge.strategies) {
    const fn = BUILTIN_STRATEGIES[stratName]
    if (!fn) continue
    const bt = runBacktest(bars, fn, stratName)
    const score = computeScore(bt)
    results.push({
      strategy: stratName,
      totalReturn: bt.totalReturn * 100,
      sharpeRatio: bt.sharpeRatio,
      maxDrawdown: bt.maxDrawdown * 100,
      winRate: bt.winRate * 100,
      score,
      rank: 0,
    })
  }

  results.sort((a, b) => b.score - a.score)
  results.forEach((r, i) => (r.rank = i + 1))

  challenge.results = results
  challenge.status = 'settled'
  challenge.endDate = bars[bars.length - 1]?.date ?? new Date().toISOString().split('T')[0]
  challenge.settledAt = new Date().toISOString()
  save(basePath)
  return challenge
}

function computeScore(bt: BacktestResult): number {
  const returnScore = Math.min(bt.totalReturn * 100, 50)
  const sharpeScore = Math.min(bt.sharpeRatio * 10, 25)
  const drawdownPenalty = bt.maxDrawdown * 50
  const winBonus = bt.winRate * 10
  return Math.max(0, returnScore + sharpeScore - drawdownPenalty + winBonus)
}

export function getChallenges(basePath: string): Challenge[] {
  load(basePath)
  return challenges
}

export function formatChallengeResult(c: Challenge): string {
  if (!c.results) return `Challenge "${c.name}" — not settled yet`
  const lines = [
    `Challenge: ${c.name} (${c.code})`,
    `Period: ${c.startDate} ~ ${c.endDate}`,
    `Status: ${c.status}`,
    '',
    'Leaderboard:',
    ...c.results.map((r) =>
      `  #${r.rank} ${r.strategy}: score=${r.score.toFixed(1)} return=${r.totalReturn.toFixed(1)}% sharpe=${r.sharpeRatio.toFixed(2)} DD=${r.maxDrawdown.toFixed(1)}% WR=${r.winRate.toFixed(0)}%`
    ),
  ]
  return lines.join('\n')
}
