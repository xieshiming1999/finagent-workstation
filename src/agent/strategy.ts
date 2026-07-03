import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface Strategy {
  id: string
  name: string
  description: string
  type: 'stockPicking' | 'stockTrading' | 'fundPicking' | 'fundTrading'
  source: string
  createdAt: string
  updatedAt?: string
  steps: Array<{ name: string; type: string; params: Record<string, unknown> }>
  timesUsed: number
  timesCorrect: number
  recentExecutions: Array<{ date: string; symbol: string; result: string; correct?: boolean }>
}

export class StrategyStore {
  strategies: Strategy[] = []
  private filePath = ''

  load(basePath: string): void {
    this.filePath = join(basePath, 'strategies.json')
    if (!existsSync(this.filePath)) return
    try {
      this.strategies = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch { /* */ }
  }

  save(): void {
    if (!this.filePath) return
    mkdirSync(join(this.filePath, '..'), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.strategies, null, 2), 'utf-8')
  }

  get(id: string): Strategy | undefined { return this.strategies.find((s) => s.id === id) }

  add(strategy: Strategy): void {
    this.strategies.push(strategy)
    this.save()
  }

  update(id: string, updater: (s: Strategy) => void): void {
    const s = this.strategies.find((x) => x.id === id)
    if (s) { updater(s); this.save() }
  }

  remove(id: string): void {
    this.strategies = this.strategies.filter((s) => s.id !== id)
    this.save()
  }

  recordExecution(id: string, execution: { date: string; symbol: string; result: string; correct?: boolean }): void {
    const s = this.strategies.find((x) => x.id === id)
    if (!s) return
    s.timesUsed++
    if (execution.correct) s.timesCorrect++
    s.recentExecutions.push(execution)
    if (s.recentExecutions.length > 20) s.recentExecutions.shift()
    this.save()
  }
}
