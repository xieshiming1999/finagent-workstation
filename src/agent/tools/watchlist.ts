import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

interface WatchItem {
  id: string
  groupId: string
  symbol: string
  name: string
  type: string
  status: string
  source: string
  tags: string[]
  priceAtAdd: number
  currentPrice?: number
  changePct?: number
  score?: number
  rating?: string
  entryCondition?: string
  strategyId?: string
  strategyRules?: Record<string, unknown>
  targetEntryPrice?: number
  stopLoss?: number
  targetPrice?: number
  suggestedWeight?: number
  actualEntryPrice?: number
  exitPrice?: number
  profitPct?: number
  addedAt: string
  enteredAt?: string
  exitedAt?: string
}

interface WatchGroup {
  id: string
  name: string
  type?: string
}

interface WatchlistData {
  groups: WatchGroup[]
  items: WatchItem[]
}

function genId(): string { return `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

function loadData(basePath: string): WatchlistData {
  const fp = join(basePath, 'watchlists.json')
  const empty: WatchlistData = { groups: [{ id: 'default', name: 'Default', type: 'stock' }], items: [] }
  if (!existsSync(fp)) return empty
  try {
    const raw = JSON.parse(readFileSync(fp, 'utf-8'))
    // Migrate old format (array of groups with items)
    if (Array.isArray(raw)) {
      const data: WatchlistData = { groups: [], items: [] }
      for (const g of raw) {
        data.groups.push({ id: g.id, name: g.name, type: g.type })
        if (Array.isArray(g.items)) {
          for (const item of g.items) {
            data.items.push({
              id: item.id ?? genId(), groupId: g.id, symbol: item.code ?? item.symbol ?? '',
              name: item.name ?? '', type: 'stock', status: item.status ?? 'watching',
              source: 'migrated', tags: item.tags ?? [], priceAtAdd: 0, addedAt: item.addedAt ?? new Date().toISOString(),
            })
          }
        }
      }
      return data
    }
    return { ...empty, ...raw }
  } catch { return empty }
}

function saveData(basePath: string, data: WatchlistData) {
  mkdirSync(basePath, { recursive: true })
  writeFileSync(join(basePath, 'watchlists.json'), JSON.stringify(data, null, 2), 'utf-8')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStrategyRules(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const rules: Record<string, unknown> = isPlainRecord(input.strategyRules)
    ? { ...input.strategyRules }
    : {}
  if (isPlainRecord(input.portfolioEvidence)) {
    rules.portfolioEvidence = { ...input.portfolioEvidence }
  }
  if (isPlainRecord(input.rebalanceDraft)) {
    rules.rebalanceDraft = { ...input.rebalanceDraft }
  }
  return Object.keys(rules).length > 0 ? rules : undefined
}

function normalizeWatchItemType(value: unknown): string {
  const type = String(value ?? 'stock').trim().toLowerCase()
  if (type === 'macro_condition' || type === 'macro' || type === 'macro-risk') return 'macro-condition'
  return type || 'stock'
}

function macroConditionSymbol(input: Record<string, unknown>): string {
  const explicit = String(input.symbol ?? input.conditionId ?? '').trim()
  if (explicit) return explicit
  const basis = String(input.name ?? input.entryCondition ?? input.source ?? 'macro-condition').trim() || 'macro-condition'
  const slug = basis
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `macro:${slug || 'condition'}`
}

function monitorSuggestionFor(item: WatchItem): Record<string, unknown> | undefined {
  if (!item.strategyId && !item.strategyRules) return undefined
  if (item.type.toLowerCase() === 'fund' || item.type.toLowerCase() === 'etf') {
    return {
      tool: 'MonitorCreate',
      template: 'fund_rule_monitor',
      readbackTool: 'MonitorList',
      params: {
        code: item.symbol,
        name: item.name || item.symbol,
        strategyId: item.strategyId,
        strategyRules: item.strategyRules,
      },
      boundary: 'Signal/observation monitor only; no Portfolio, XueqiuTrade, broker, buy, sell, transfer, or order side effect is authorized.',
    }
  }
  return {
    tool: 'MonitorCreate',
    template: 'strategy_signal',
    readbackTool: 'MonitorList',
    params: {
      code: item.symbol,
      name: item.name || item.symbol,
      strategyId: item.strategyId,
      strategyRules: item.strategyRules,
    },
    boundary: 'Signal monitor only; no Portfolio, XueqiuTrade, broker, buy, sell, transfer, or order side effect is authorized.',
  }
}

export class WatchlistTool implements Tool {
  name = 'Watchlist'
  description = 'Manage watchlists: create groups, add/remove symbols, track entry/exit lifecycle, query by type/status/tag, update attributes. Use action="help".'
  isReadOnly = false
  private readonly onChanged?: (basePath: string) => void

  constructor(options: { onChanged?: (basePath: string) => void } = {}) {
    this.onChanged = options.onChanged
  }

  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create_group', 'list_groups', 'delete_group', 'add', 'remove', 'update', 'list', 'enter', 'exit', 'summary', 'help'] },
      name: { type: 'string' },
      type: { type: 'string', description: 'stock/fund/etf/index/macro-condition' },
      groupId: { type: 'string' },
      symbol: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      tag: { type: 'string' },
      itemId: { type: 'string' },
      entryCondition: { type: 'string' },
      strategyId: { type: 'string' },
      strategyRules: {
        type: 'object',
        description: 'Structured strategy-derived rules used for watchlist/monitor provenance.',
      },
      portfolioEvidence: {
        type: 'object',
        description: 'Structured portfolio ranking evidence returned by custom_strategy_rank.',
      },
      rebalanceDraft: {
        type: 'object',
        description: 'Bounded rebalance draft returned by custom_strategy_rank. Evidence only; does not place orders.',
      },
      targetEntryPrice: { type: 'number' },
      stopLoss: { type: 'number' },
      targetPrice: { type: 'number' },
      suggestedWeight: { type: 'number' },
      actualEntryPrice: { type: 'number' },
      exitPrice: { type: 'number' },
      score: { type: 'number' },
      rating: { type: 'string' },
      source: { type: 'string' },
    },
    required: ['action'],
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    const action = String(input.action ?? 'help')
    return ['add', 'remove', 'enter', 'exit', 'delete_group'].includes(action)
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) return 'action is required. Use action="help".'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const data = loadData(ctx.basePath)
    const action = String(input.action ?? 'help')

    switch (action) {
      case 'help': return HELP_TEXT

      case 'create_group': {
        const name = input.name as string | undefined
        if (!name) return toolError('name required')
        const group: WatchGroup = { id: genId(), name, type: input.type as string ?? 'stock' }
        data.groups.push(group)
        this.save(ctx.basePath, data)
        return `Created group "${name}" (id: ${group.id}). Total groups: ${data.groups.length}`
      }

      case 'list_groups': {
        const list = data.groups.map((g) => {
          const items = data.items.filter((i) => i.groupId === g.id)
          return {
            id: g.id, name: g.name,
            itemCount: items.length,
            watching: items.filter((i) => i.status === 'watching').length,
            entered: items.filter((i) => i.status === 'entered').length,
          }
        })
        return JSON.stringify({ groups: list }, null, 2)
      }

      case 'delete_group': {
        const groupId = input.groupId as string | undefined
        if (!groupId) return toolError('groupId required')
        data.groups = data.groups.filter((g) => g.id !== groupId)
        data.items = data.items.filter((i) => i.groupId !== groupId)
        this.save(ctx.basePath, data)
        return `Deleted group ${groupId}. ${data.groups.length} group(s) remaining.`
      }

      case 'add': {
        const itemType = normalizeWatchItemType(input.type)
        const symbol = itemType === 'macro-condition'
          ? macroConditionSymbol(input)
          : input.symbol as string | undefined
        if (!symbol) return toolError('symbol required')
        const groupId = (input.groupId as string) ?? data.groups.find((g) => g.type === itemType)?.id ?? data.groups[0]?.id ?? 'default'
        const tag = typeof input.tag === 'string' ? input.tag.trim() : ''
        const tags = Array.isArray(input.tags) ? input.tags.map((value) => String(value)) : []
        if (tag && !tags.includes(tag)) tags.push(tag)
        const inferredName = String(input.name ?? '').trim()
        if (['fund', 'etf'].includes(itemType.toLowerCase()) && !inferredName) {
          return toolError('name required for fund/etf watchlist items; tag is classification metadata, not display name')
        }
        if (itemType === 'macro-condition' && !inferredName && !input.entryCondition) {
          return toolError('name or entryCondition required for macro-condition watchlist items; macro conditions are observation context, not tradable instruments')
        }
        const item: WatchItem = {
          id: genId(),
          groupId,
          symbol,
          name: inferredName || String(input.entryCondition ?? 'Macro condition'),
          type: itemType,
          status: 'watching',
          source: String(input.source ?? 'agent'),
          tags,
          priceAtAdd: Number(input.targetEntryPrice ?? 0),
          score: input.score != null ? Number(input.score) : undefined,
          rating: input.rating as string | undefined,
          entryCondition: input.entryCondition as string | undefined,
          strategyId: input.strategyId as string | undefined,
          strategyRules: normalizeStrategyRules(input),
          targetEntryPrice: input.targetEntryPrice != null ? Number(input.targetEntryPrice) : undefined,
          stopLoss: input.stopLoss != null ? Number(input.stopLoss) : undefined,
          targetPrice: input.targetPrice != null ? Number(input.targetPrice) : undefined,
          suggestedWeight: input.suggestedWeight != null ? Number(input.suggestedWeight) : undefined,
          addedAt: new Date().toISOString(),
        }
        data.items.push(item)
        this.save(ctx.basePath, data)
        const groupItems = data.items.filter((i) => i.groupId === groupId)
        const monitorSuggestion = monitorSuggestionFor(item)
        if (monitorSuggestion) {
          return JSON.stringify({
            action: 'add',
            status: 'added',
            item,
            groupId,
            groupItemCount: groupItems.length,
            next: monitorSuggestion,
          }, null, 2)
        }
        return `Added ${item.name || symbol} to watchlist (id: ${item.id}, group: ${groupId}, ${groupItems.length} items in group)`
      }

      case 'remove': {
        const itemId = input.itemId as string | undefined
        if (!itemId) return toolError('itemId required')
        data.items = data.items.filter((i) => i.id !== itemId)
        this.save(ctx.basePath, data)
        return `Removed ${itemId} from watchlist. ${data.items.length} total items remaining.`
      }

      case 'update': {
        const itemId = input.itemId as string | undefined
        if (!itemId) return toolError('itemId required')
        const item = data.items.find((i) => i.id === itemId)
        if (!item) return toolError(`item ${itemId} not found`)
        if (input.tags != null) item.tags = input.tags as string[]
        if (input.entryCondition !== undefined) item.entryCondition = input.entryCondition as string
        if (input.strategyId !== undefined) item.strategyId = input.strategyId as string
        if (
          input.strategyRules !== undefined ||
          input.portfolioEvidence !== undefined ||
          input.rebalanceDraft !== undefined
        ) {
          item.strategyRules = normalizeStrategyRules(input)
        }
        if (input.targetEntryPrice != null) item.targetEntryPrice = Number(input.targetEntryPrice)
        if (input.stopLoss != null) item.stopLoss = Number(input.stopLoss)
        if (input.targetPrice != null) item.targetPrice = Number(input.targetPrice)
        if (input.suggestedWeight != null) item.suggestedWeight = Number(input.suggestedWeight)
        if (input.score != null) item.score = Number(input.score)
        if (input.rating !== undefined) item.rating = input.rating as string
        if (input.status !== undefined) item.status = input.status as string
        this.save(ctx.basePath, data)
        return `Updated ${itemId}`
      }

      case 'list': {
        let results = [...data.items]
        if (input.groupId) results = results.filter((i) => i.groupId === input.groupId)
        if (input.symbol) results = results.filter((i) => i.symbol === input.symbol)
        if (input.status) results = results.filter((i) => i.status === input.status)
        if (input.type) results = results.filter((i) => i.type === input.type)
        if (input.tag) results = results.filter((i) => i.tags.includes(input.tag as string))
        if (input.strategyId) results = results.filter((i) => i.strategyId === input.strategyId)
        results = results
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const timeOrder = String(b.item.addedAt ?? '').localeCompare(String(a.item.addedAt ?? ''))
            return timeOrder !== 0 ? timeOrder : b.index - a.index
          })
          .map(({ item }) => item)

        const list = results.map((i) => ({
          id: i.id, symbol: i.symbol, name: i.name, type: i.type,
          status: i.status, source: i.source, tags: i.tags,
          addedAt: i.addedAt,
          priceAtAdd: i.priceAtAdd,
          currentPrice: i.currentPrice,
          changePct: i.changePct != null ? `${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}%` : null,
          score: i.score, rating: i.rating,
          entryCondition: i.entryCondition,
          strategyId: i.strategyId,
          strategyRules: i.strategyRules,
          ...(i.strategyRules?.portfolioEvidence ? { portfolioEvidence: i.strategyRules.portfolioEvidence } : {}),
          ...(i.strategyRules?.rebalanceDraft ? { rebalanceDraft: i.strategyRules.rebalanceDraft } : {}),
          ...(i.status === 'entered' ? {
            actualEntryPrice: i.actualEntryPrice,
            stopLoss: i.stopLoss,
            targetPrice: i.targetPrice,
            pnl: i.actualEntryPrice && i.currentPrice
              ? `${((i.currentPrice - i.actualEntryPrice) / i.actualEntryPrice * 100).toFixed(1)}%`
              : null,
          } : {}),
        }))

        const stockSymbols = results
          .filter((item) => item.status === 'watching' && (item.type || 'stock').toLowerCase() === 'stock')
          .map((item) => item.symbol)
          .filter(Boolean)
        const uniqueStockSymbols = Array.from(new Set(stockSymbols)).slice(0, 12)
        const payload: Record<string, unknown> = { count: list.length, items: list }
        if (uniqueStockSymbols.length >= 2) {
          payload.nextAction = {
            tool: 'MarketData',
            action: 'custom_strategy_help',
            strategy: 'custom_strategy_rank',
            symbols: uniqueStockSymbols,
            topN: Math.min(3, uniqueStockSymbols.length),
            maxPositionWeight: 0.35,
            rebalanceInterval: 'monthly',
            requiresStrategySpec: true,
            afterStrategySpec: {
              tool: 'MarketData',
              action: 'custom_strategy_rank',
              symbols: uniqueStockSymbols,
              topN: Math.min(3, uniqueStockSymbols.length),
              maxPositionWeight: 0.35,
              rebalanceInterval: 'monthly',
            },
            boundary: 'Evidence-only portfolio observation. Use portfolioEvidence, concentrationEvidence, drawdown-budget evidence, candidateFailureEvidence, and rebalanceDraft. Do not create watchlist entries, Portfolio orders, XueqiuTrade actions, broker orders, or automatic rebalances unless a separate user confirmation authorizes that side effect.',
            reason: 'Multiple watched stock symbols are available. For portfolio observation, inspect the governed custom_strategy_rank contract, construct a StrategySpec, then call custom_strategy_rank with that StrategySpec instead of manually ranking quotes or K-line summaries.',
          }
        }

        return JSON.stringify(payload, null, 2)
      }

      case 'enter': {
        const itemId = input.itemId as string | undefined
        const price = input.actualEntryPrice != null ? Number(input.actualEntryPrice) : undefined
        if (!itemId || price == null) return toolError('itemId and actualEntryPrice required')
        const item = data.items.find((i) => i.id === itemId)
        if (!item) return toolError(`item ${itemId} not found`)
        item.status = 'entered'
        item.actualEntryPrice = price
        item.enteredAt = new Date().toISOString()
        this.save(ctx.basePath, data)
        return `Marked ${itemId} as entered @ ${price}`
      }

      case 'exit': {
        const itemId = input.itemId as string | undefined
        const price = input.exitPrice != null ? Number(input.exitPrice) : undefined
        if (!itemId || price == null) return toolError('itemId and exitPrice required')
        const item = data.items.find((i) => i.id === itemId)
        if (!item) return toolError(`item ${itemId} not found`)
        item.status = 'exited'
        item.exitPrice = price
        item.exitedAt = new Date().toISOString()
        if (item.actualEntryPrice && item.actualEntryPrice > 0) {
          item.profitPct = (price - item.actualEntryPrice) / item.actualEntryPrice * 100
        }
        this.save(ctx.basePath, data)
        const pnl = item.profitPct != null ? ` (${item.profitPct >= 0 ? '+' : ''}${item.profitPct.toFixed(1)}%)` : ''
        return `Marked ${itemId} as exited @ ${price}${pnl}`
      }

      case 'summary': {
        const watching = data.items.filter((i) => i.status === 'watching').length
        const entered = data.items.filter((i) => i.status === 'entered').length
        const exited = data.items.filter((i) => i.status === 'exited').length
        const groupSummary = data.groups.map((g) => {
          const items = data.items.filter((i) => i.groupId === g.id)
          return {
            name: g.name, total: items.length,
            watching: items.filter((i) => i.status === 'watching').length,
            entered: items.filter((i) => i.status === 'entered').length,
          }
        })
        return JSON.stringify({ total: data.items.length, watching, entered, exited, groups: groupSummary }, null, 2)
      }

      default:
        return toolError(`Unknown action "${action}". Use action="help".`)
    }
  }

  private save(basePath: string, data: WatchlistData): void {
    saveData(basePath, data)
    this.onChanged?.(basePath)
  }
}

const HELP_TEXT = `Watchlist actions:

GROUPS:
  create_group — Create a watchlist group. name, type(stock/fund/etf)
  list_groups  — List all groups with item counts
  delete_group — Delete a group. groupId

ITEMS:
  add    — Add to watchlist. symbol, name, groupId, type, tags, entryCondition, strategyId, strategyRules, portfolioEvidence, rebalanceDraft, targetEntryPrice, stopLoss, targetPrice, suggestedWeight, score, rating, source
  remove — Remove item. itemId
  update — Update item fields. itemId + fields to update
  list   — Query items. groupId, symbol, status(watching/entered/exited), type, tag, strategyId

LIFECYCLE:
  enter  — Mark as entered (bought). itemId, actualEntryPrice
  exit   — Mark as exited (sold). itemId, exitPrice

OVERVIEW:
  summary — Stats overview (counts by status per group)
  help    — This help text`
