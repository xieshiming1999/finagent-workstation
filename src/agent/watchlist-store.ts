import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { watchlistCopy } from './runtime-copy'

export interface WatchCondition {
  field: string    // price / changePct / volume
  op: string       // > / < / >= / <= / ==
  value: number
  action: string   // ui_alert / notify_chat / notify_event
  message?: string
  triggered: boolean
}

export interface WatchlistGroup {
  id: string
  name: string
  type: string
  createdAt: string
  refreshIntervalSec: number
}

export interface WatchlistItem {
  id: string
  groupId: string
  symbol: string
  name: string
  type: string
  status: string   // watching / entered / exited
  source: string
  tags: string[]
  addedAt: string
  priceAtAdd: number
  score?: number
  rating?: string
  entryCondition?: string
  targetEntryPrice?: number
  stopLoss?: number
  targetPrice?: number
  suggestedWeight?: number
  actualEntryPrice?: number
  enteredAt?: string
  exitPrice?: number
  exitedAt?: string
  profitPct?: number
  analysisResult?: string
  analysisAt?: string
  conditions: WatchCondition[]
  // Runtime only (not persisted)
  currentPrice?: number
  changePct?: number
  volume?: number
}

function genId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function evaluateCondition(condition: WatchCondition, actual: number): boolean {
  switch (condition.op) {
    case '>': return actual > condition.value
    case '<': return actual < condition.value
    case '>=': return actual >= condition.value
    case '<=': return actual <= condition.value
    case '==': return Math.abs(actual - condition.value) < 0.001
    default: return false
  }
}

export class WatchlistStore {
  groups: WatchlistGroup[] = []
  items: WatchlistItem[] = []
  private filePath = ''
  onChanged: (() => void) | null = null

  load(basePath: string): void {
    this.filePath = join(basePath, 'memory', 'watchlist.json')
    const candidates = [
      join(basePath, 'watchlists.json'),
      this.filePath,
      join(basePath, 'memory', 'watchlists.json'),
    ]
    for (const file of candidates) {
      if (!existsSync(file)) continue
      try {
        this.loadJson(JSON.parse(readFileSync(file, 'utf-8')))
        if (this.groups.length === 0) this.addDefaultGroups()
        return
      } catch {
        continue
      }
    }
    this.groups = []
    this.items = []
    this.addDefaultGroups()
  }

  save(): void {
    if (!this.filePath) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({
      groups: this.groups,
      items: this.items.map((i) => {
        const { currentPrice, changePct, volume, ...persisted } = i
        return persisted
      }),
    }, null, 2), 'utf-8')
  }

  private notify(): void { this.save(); this.onChanged?.() }

  addGroup(g: WatchlistGroup): void { this.groups.push(g); this.notify() }
  removeGroup(groupId: string): void {
    this.groups = this.groups.filter((g) => g.id !== groupId)
    this.items = this.items.filter((i) => i.groupId !== groupId)
    this.notify()
  }

  addItem(item: WatchlistItem): void {
    // Remove existing watching item with same symbol in same group
    this.items = this.items.filter((i) => !(i.groupId === item.groupId && i.symbol === item.symbol && i.status === 'watching'))
    this.items.push(item)
    this.notify()
  }

  removeItem(itemId: string): void { this.items = this.items.filter((i) => i.id !== itemId); this.notify() }

  updateItem(itemId: string, updater: (item: WatchlistItem) => void): void {
    const item = this.items.find((i) => i.id === itemId)
    if (item) { updater(item); this.notify() }
  }

  getByGroup(groupId: string): WatchlistItem[] { return this.items.filter((i) => i.groupId === groupId) }
  getByStatus(status: string): WatchlistItem[] { return this.items.filter((i) => i.status === status) }

  query(opts: { groupId?: string; status?: string; type?: string; tag?: string }): WatchlistItem[] {
    return this.items.filter((i) => {
      if (opts.groupId && i.groupId !== opts.groupId) return false
      if (opts.status && i.status !== opts.status) return false
      if (opts.type && i.type !== opts.type) return false
      if (opts.tag && !i.tags.includes(opts.tag)) return false
      return true
    })
  }

  get defaultGroup(): WatchlistGroup { return this.groups[0] }
  groupForType(type: string): WatchlistGroup | undefined { return this.groups.find((g) => g.type === type) }

  private loadJson(json: any): void {
    const source = Array.isArray(json)
      ? {
          groups: json.map((g: any) => ({
            id: g.id,
            name: g.name,
            type: g.type,
            createdAt: g.createdAt,
            refreshIntervalSec: g.refreshIntervalSec,
          })),
          items: json.flatMap((g: any) =>
            Array.isArray(g.items)
              ? g.items.map((i: any) => ({
                  ...i,
                  groupId: i.groupId ?? g.id,
                  type: i.type ?? g.type,
                  symbol: i.symbol ?? i.code,
                }))
              : []
          ),
        }
      : json
    this.groups = (source.groups ?? []).map((g: any) => ({
      id: g.id ?? genId(), name: g.name ?? '', type: g.type ?? 'stock',
      createdAt: g.createdAt ?? new Date().toISOString(),
      refreshIntervalSec: g.refreshIntervalSec ?? 300,
    }))
    this.items = (source.items ?? []).map((i: any) => ({
      id: i.id ?? genId(), groupId: i.groupId ?? '', symbol: i.symbol ?? '',
      name: i.name ?? '', type: i.type ?? 'stock', status: i.status ?? 'watching',
      source: i.source ?? 'user', tags: i.tags ?? [], addedAt: i.addedAt ?? new Date().toISOString(),
      priceAtAdd: i.priceAtAdd ?? 0, score: i.score, rating: i.rating,
      entryCondition: i.entryCondition, targetEntryPrice: i.targetEntryPrice,
      stopLoss: i.stopLoss, targetPrice: i.targetPrice, suggestedWeight: i.suggestedWeight,
      actualEntryPrice: i.actualEntryPrice, enteredAt: i.enteredAt,
      exitPrice: i.exitPrice, exitedAt: i.exitedAt, profitPct: i.profitPct,
      analysisResult: i.analysisResult, analysisAt: i.analysisAt,
      conditions: (i.conditions ?? []).map((c: any) => ({
        field: c.field ?? 'price', op: c.op ?? '>', value: c.value ?? 0,
        action: c.action ?? 'ui_alert', message: c.message, triggered: c.triggered ?? false,
      })),
    }))
  }

  private addDefaultGroups(): void {
    this.groups.push({
      id: genId(),
      name: watchlistCopy.defaultStockGroup(),
      type: 'stock',
      createdAt: new Date().toISOString(),
      refreshIntervalSec: 300,
    })
    this.groups.push({
      id: genId(),
      name: watchlistCopy.defaultFundGroup(),
      type: 'fund',
      createdAt: new Date().toISOString(),
      refreshIntervalSec: 300,
    })
  }
}
