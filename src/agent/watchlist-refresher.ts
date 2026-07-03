import { WatchlistStore, evaluateCondition, type WatchlistItem } from './watchlist-store'
import type { NotificationQueue } from './notification-queue'
import type { ToolContext } from './tool'
import { MarketDataResolveService } from '../domain/market/services/market-data-resolve-service'
import { watchlistCopy } from './runtime-copy'

/**
 * WatchlistRefresher: 60s auto-refresh of watchlist items with condition-based alerts.
 * Matches finagent's watchlist_refresher.dart.
 */
export class WatchlistRefresher {
  private store: WatchlistStore
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly readService = new MarketDataResolveService()
  chatQueue: NotificationQueue | null = null
  eventQueue: NotificationQueue | null = null
  toolContext: ToolContext | null = null

  constructor(store: WatchlistStore) {
    this.store = store
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => this.refresh(), 60_000)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async refresh(): Promise<void> {
    const activeItems = this.store.items.filter((i) => i.status === 'watching' || i.status === 'entered')
    if (activeItems.length === 0) return

    if (!anyMarketOpen(activeItems)) return

    const symbols = [...new Set(activeItems.map((i) => i.symbol))]
    if (!this.toolContext) return
    try {
      const quotes = (await this.readService.readQuotes(this.toolContext, symbols)).quotes
      const quoteMap = new Map(quotes.map((q) => [q.code, q]))

      for (const item of activeItems) {
        const q = quoteMap.get(item.symbol)
        if (!q) continue

        item.currentPrice = q.price
        item.changePct = q.changePct
        item.volume = q.volume

        this.evaluateConditions(item)

        if (item.status === 'watching') {
          this.checkEntryCondition(item)
        } else if (item.status === 'entered') {
          this.checkExitCondition(item)
        }
      }

      this.store.onChanged?.()
    } catch (e) {
      console.error('[WatchlistRefresher] Refresh error:', e)
    }
  }

  private checkEntryCondition(item: WatchlistItem): void {
    if (item.targetEntryPrice == null || item.currentPrice == null) return
    if (item.currentPrice <= item.targetEntryPrice) {
      this.chatQueue?.enqueue('watchlist',
        watchlistCopy.entryPrompt({
          name: item.name,
          symbol: item.symbol,
          targetEntryPrice: item.targetEntryPrice,
          currentPrice: item.currentPrice,
          entryCondition: item.entryCondition,
          suggestedWeight: item.suggestedWeight,
          stopLoss: item.stopLoss,
          targetPrice: item.targetPrice,
        }),
        'now'
      )
    }
  }

  private checkExitCondition(item: WatchlistItem): void {
    if (item.currentPrice == null || item.actualEntryPrice == null) return
    const pnl = (item.currentPrice - item.actualEntryPrice) / item.actualEntryPrice * 100

    if (item.stopLoss != null && item.currentPrice <= item.stopLoss) {
      this.eventQueue?.enqueue('watchlist',
        watchlistCopy.stopLoss({
          name: item.name,
          symbol: item.symbol,
          stopLoss: item.stopLoss,
          currentPrice: item.currentPrice,
        }, pnl),
        'now'
      )
    }

    if (item.targetPrice != null && item.currentPrice >= item.targetPrice) {
      this.eventQueue?.enqueue('watchlist',
        watchlistCopy.targetPrice({
          name: item.name,
          symbol: item.symbol,
          targetPrice: item.targetPrice,
          currentPrice: item.currentPrice,
        }, pnl),
        'now'
      )
    }
  }

  private evaluateConditions(item: WatchlistItem): void {
    for (const cond of item.conditions) {
      if (cond.triggered) continue
      let actual: number | undefined
      switch (cond.field) {
        case 'price': actual = item.currentPrice; break
        case 'changePct': actual = item.changePct; break
        case 'volume': actual = item.volume; break
      }
      if (actual == null) continue
      if (!evaluateCondition(cond, actual)) continue

      cond.triggered = true
      const msg =
        cond.message ??
        watchlistCopy.triggeredCondition(item, cond)

      switch (cond.action) {
        case 'notify_chat':
          this.chatQueue?.enqueue('watchlist', `📊 ${msg}`, 'now')
          break
        case 'notify_event':
          this.eventQueue?.enqueue('watchlist', `📊 ${msg}`, 'now')
          break
        default:
          this.store.onChanged?.()
      }
    }
  }
}

function anyMarketOpen(items: WatchlistItem[]): boolean {
  const now = new Date()
  // Beijing time
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = bj.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()

  for (const item of items) {
    const market = detectMarket(item.symbol)
    switch (market) {
      case 'cn_stock':
        if (minutes >= 9 * 60 + 25 && minutes <= 15 * 60 + 5) return true
        break
      case 'hk':
        if (minutes >= 9 * 60 + 30 && minutes <= 16 * 60 + 10) return true
        break
      case 'us':
        if (minutes >= 21 * 60 + 30 || minutes <= 4 * 60) return true
        break
      default:
        if (minutes >= 9 * 60 + 25 && minutes <= 15 * 60 + 5) return true
    }
  }
  return false
}

function detectMarket(symbol: string): string {
  const code = symbol.replace(/\.\w+$/, '')
  if (/^\d{6}$/.test(code)) return 'cn_stock'
  if (/^[A-Z]{1,3}\d{3,4}$/.test(code)) return 'cn_futures'
  if (/^\d{5}$/.test(code)) return 'hk'
  if (/^[A-Z]{1,5}$/.test(code)) return 'us'
  return 'cn_stock'
}
