import { FetchQueue } from './fetch-queue'
import type { DataStore } from '../store/data-store'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { enqueueConfiguredDataFeed, feedTaskType } from './data-feed-enqueue'
import type { FeedConfig } from '../store/data-store-types'
import { supportsOrdinaryFundNav } from '../fund-category'

export class FetchScheduler {
  private queue: FetchQueue
  private store: DataStore
  private basePath: string
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private running = false

  constructor(store: DataStore, queue: FetchQueue, basePath?: string) {
    this.store = store
    this.queue = queue
    this.basePath = basePath ?? ''
  }

  setBasePath(path: string): void {
    this.basePath = path
  }

  start(): void {
    if (this.running) return
    this.running = true

    // Register periodic checks — but do NOT run immediately on startup.
    // Data fetch is triggered by: user action (Data Manager), agent tool call, or periodic timer.
    // This prevents burning API quota on startup before user even starts chatting.

    // P0 watchlist: check every 5 minutes
    this.schedule('watchlist-update', 5 * 60 * 1000, () => this.checkWatchlistUpdate())

    // P1 daily update (all tracked stocks): check every 10 minutes
    this.schedule('daily-update', 10 * 60 * 1000, () => this.checkDailyUpdate())

    // Stock list: daily symbol-name cache refresh.
    this.schedule('stock-list', 24 * 60 * 60 * 1000, () => this.checkStockListUpdate())
    setTimeout(() => this.checkStockListUpdate(), 30_000)

    // Fund Pulse bootstrap: cache-first UI backed by a lightweight daily data seed.
    this.schedule('fund-pulse-bootstrap', 6 * 60 * 60 * 1000, () => this.checkFundPulseBootstrap())
    setTimeout(() => this.checkFundPulseBootstrap(), 45_000)

    // Configured Data Manager feeds: respect enabled/frequency/scope settings.
    this.schedule('configured-data-feeds', 15 * 60 * 1000, () => this.triggerDueConfiguredFeeds())
    setTimeout(() => this.triggerDueConfiguredFeeds(), 90_000)

    // Split detection: check daily
    this.schedule('split-check', 24 * 60 * 60 * 1000, () => this.checkSplitInvalidation())

    // Start the queue processor (handles manually enqueued tasks)
    this.queue.start()
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    this.queue.stop()
  }

  triggerStockListUpdate(market: string = 'A'): void {
    this.queue.enqueue('stock_list', null, { market }, 0)
  }

  triggerKlineUpdate(code: string, opts: { start?: string; market?: string } = {}): void {
    this.queue.enqueue('kline_daily', code, opts, 1)
  }

  triggerBatchKline(codes: string[], opts: { start?: string; market?: string } = {}, priority = 3): void {
    this.queue.enqueue('kline_batch', null, { codes, ...opts }, priority)
  }

  triggerDueConfiguredFeeds(now = new Date()): number[] {
    const ids: number[] = []
    for (const feed of this.store.getFeedConfigs()) {
      if (!feed.enabled || feed.update_frequency === 'manual') continue
      if (!isFeedDue(feed, now)) continue
      if (this.hasActiveConfiguredFeedTarget(feed)) continue
      ids.push(...this.enqueueConfiguredFeed(feed, { source: 'configured-feed-scheduler' }))
    }
    return ids
  }

  private schedule(name: string, intervalMs: number, fn: () => void): void {
    if (this.timers.has(name)) clearInterval(this.timers.get(name)!)
    this.timers.set(name, setInterval(fn, intervalMs))
  }

  private enqueueConfiguredFeed(feed: FeedConfig, extraParams: Record<string, unknown> = {}): number[] {
    return enqueueConfiguredDataFeed(this.store, this.queue, feed, {
      basePath: this.basePath,
      extraParams,
      taskPriority: 4,
      prerequisitePriority: 3,
      skipActivePrerequisite: (taskType, code) => this.hasActiveTask(taskType, code ?? undefined),
    }).taskIds
  }

  // --- P0: Watchlist stocks (highest priority) ---

  private checkWatchlistUpdate(): void {
    if (!isAfterMarketClose()) return

    const watchlistCodes = this.getWatchlistCodes()
    if (watchlistCodes.length === 0) return

    const today = todayStr()
    const needUpdate: string[] = []

    for (const code of watchlistCodes) {
      const cov = this.store.getCoverage(code, 'kline_daily')
      if (!cov || !cov.latest_date || cov.latest_date < today) {
        needUpdate.push(code)
      }
    }

    if (needUpdate.length > 0) {
      this.queue.enqueue('kline_batch', null, { codes: needUpdate }, 0) // P0
    }
  }

  private getWatchlistCodes(): string[] {
    if (!this.basePath) return []
    const watchlistFile = firstExistingPath([
      join(this.basePath, 'watchlists.json'),
      join(this.basePath, 'memory', 'watchlists.json'),
      join(this.basePath, 'memory', 'watchlist.json'),
    ])
    if (!watchlistFile) return []
    try {
      const data = JSON.parse(readFileSync(watchlistFile, 'utf-8'))
      const items = data.items as Array<{ symbol?: string; code?: string; status?: string; type?: string }> | undefined
      if (!items) return []
      return items
        .filter((it) => it.status !== 'exited' && !isFundLikeWatchType(it.type))
        .map((it) => it.symbol ?? it.code ?? '')
        .filter(Boolean)
    } catch { return [] }
  }

  // --- P1: All tracked stocks (daily incremental) ---

  private checkDailyUpdate(): void {
    if (!isAfterMarketClose()) return

    const today = todayStr()
    const allCoverage = this.store.getAllCoverage('kline_daily')
    const watchlistCodes = new Set(this.getWatchlistCodes())
    const needUpdate: string[] = []

    for (const cov of allCoverage) {
      if (watchlistCodes.has(cov.code)) continue // P0 already handles these
      if (!cov.latest_date || cov.latest_date < today) {
        needUpdate.push(cov.code)
      }
    }

    if (needUpdate.length > 0) {
      this.queue.enqueue('kline_batch', null, { codes: needUpdate }, 3) // P1
    }
  }

  private checkStockListUpdate(): void {
    const existing = this.store.queryStockList()
    if (existing.length === 0) {
      this.queue.enqueue('stock_list', null, { market: 'A' }, 0)
      return
    }

    const latestUpdate = existing.reduce((max, s) => s.updated_at > max ? s.updated_at : max, '')
    const daysSinceUpdate = (Date.now() - new Date(latestUpdate).getTime()) / 86400000
    if (daysSinceUpdate >= 1) {
      this.queue.enqueue('stock_list', null, { market: 'A' }, 4) // P2
    }
  }

  private checkFundPulseBootstrap(): void {
    const fundList = this.store.query<{ count: number; latest: string | null }>(
      'SELECT COUNT(*) as count, MAX(updated_at) as latest FROM fund_list',
    )[0]
    if (isMissingOrStale(fundList?.count, fundList?.latest, 1) && !this.hasActiveTask('fund_list')) {
      this.queue.enqueue('fund_list', null, { source: 'fund-pulse-bootstrap', forceLive: true }, 2)
      setTimeout(() => {
        if (this.running) this.checkFundPulseBootstrap()
      }, 5 * 60 * 1000)
    }

    const fundPerformance = this.store.query<{ count: number; latest: string | null }>(
      'SELECT COUNT(*) as count, MAX(fetched_at) as latest FROM fund_performance_metrics',
    )[0]
    if (isMissingOrStale(fundPerformance?.count, fundPerformance?.latest, 1) && !this.hasActiveTask('fund_performance')) {
      this.queue.enqueue('fund_performance', null, { source: 'fund-pulse-bootstrap', forceLive: true }, 3)
    }

    const etfList = this.store.query<{ count: number; latest: string | null }>(
      "SELECT COUNT(*) as count, MAX(updated_at) as latest FROM stock_list WHERE stock_type = 'etf'",
    )[0]
    const etfQuotes = this.store.query<{ count: number; latest: string | null }>(
      "SELECT COUNT(*) as count, MAX(fetched_at) as latest FROM quote_snapshot WHERE code IN (SELECT code FROM stock_list WHERE stock_type = 'etf')",
    )[0]
    if (
      (isMissingOrStale(etfList?.count, etfList?.latest, 1) || isMissingOrStale(etfQuotes?.count, etfQuotes?.latest, 1)) &&
      !this.hasActiveTask('etf_quotes')
    ) {
      this.queue.enqueue('etf_quotes', null, { source: 'fund-pulse-bootstrap', limit: 80, forceLive: true }, 2)
    }

    const fundNav = this.store.query<{ count: number; latest: string | null }>(
      'SELECT COUNT(*) as count, MAX(last_updated) as latest FROM data_coverage WHERE data_type = ?',
      'fund_nav',
    )[0]
    if (isMissingOrStale(fundNav?.count, fundNav?.latest, 1)) {
      for (const code of this.getFundNavSeedCodes()) {
        if (!this.hasActiveTask('fund_nav', code)) {
          this.queue.enqueue('fund_nav', code, { source: 'fund-pulse-bootstrap', forceLive: true }, 4)
        }
      }
    }
  }

  private getFundNavSeedCodes(): string[] {
    const watchlistCodes = this.filterFundNavSupportedCodes(this.getFundWatchlistCodes())
    if (watchlistCodes.length > 0) return watchlistCodes.slice(0, 12)
    return this.store.query<{ code: string }>(
      `SELECT code FROM fund_list
        WHERE code IS NOT NULL AND code != ''
          AND fund_category NOT IN ('money', 'backend', 'unknown')
        ORDER BY COALESCE(total_size, 0) DESC, COALESCE(return_ytd, return_1y, 0) DESC
        LIMIT 8`,
    ).map((row) => row.code).filter(Boolean)
  }

  private filterFundNavSupportedCodes(codes: string[]): string[] {
    if (codes.length === 0) return []
    const placeholders = codes.map(() => '?').join(',')
    const rows = this.store.query<{ code: string; fund_category?: string | null }>(
      `SELECT code,fund_category FROM fund_list WHERE code IN (${placeholders})`,
      ...codes,
    )
    if (rows.length === 0) return codes
    const supported = new Set(rows
      .filter((row) => {
        return supportsOrdinaryFundNav(row.fund_category)
      })
      .map((row) => String(row.code)))
    const known = new Set(rows.map((row) => String(row.code)))
    return codes.filter((code) => !known.has(code) || supported.has(code))
  }

  private getFundWatchlistCodes(): string[] {
    if (!this.basePath) return []
    const unifiedFile = firstExistingPath([
      join(this.basePath, 'watchlists.json'),
      join(this.basePath, 'memory', 'watchlists.json'),
      join(this.basePath, 'memory', 'watchlist.json'),
    ])
    if (unifiedFile) {
      try {
        const data = JSON.parse(readFileSync(unifiedFile, 'utf-8'))
        const items = data.items as Array<{ symbol?: string; code?: string; status?: string; type?: string }> | undefined
        const codes = Array.from(new Set((items ?? [])
          .filter((it) => it.status !== 'exited' && isFundLikeWatchType(it.type))
          .map((it) => String(it.symbol ?? it.code ?? '').trim())
          .filter(Boolean)))
        if (codes.length > 0) return codes
      } catch {}
    }

    const watchlistFile = firstExistingPath([
      join(this.basePath, 'fund_watchlists.json'),
      join(this.basePath, 'memory', 'fund_watchlists.json'),
    ])
    if (!watchlistFile) return []
    try {
      const data = JSON.parse(readFileSync(watchlistFile, 'utf-8'))
      const items = data.items as Array<{ code?: string }> | undefined
      if (!items) return []
      return Array.from(new Set(items.map((it) => String(it.code ?? '').trim()).filter(Boolean)))
    } catch { return [] }
  }

  private hasActiveTask(taskType: string, code?: string): boolean {
    const rows = code
      ? this.store.query<{ id: number }>(
        'SELECT id FROM fetch_tasks WHERE task_type = ? AND code = ? AND status IN (?,?) LIMIT 1',
        taskType,
        code,
        'pending',
        'running',
      )
      : this.store.query<{ id: number }>(
        'SELECT id FROM fetch_tasks WHERE task_type = ? AND status IN (?,?) LIMIT 1',
        taskType,
        'pending',
        'running',
      )
    return rows.length > 0
  }

  private hasActiveConfiguredFeedTarget(feed: FeedConfig): boolean {
    return activeTaskTypesForFeed(feed.feed_type).some((taskType) => this.hasActiveTask(taskType))
  }

  // --- Split/QFQ invalidation detection ---

  private checkSplitInvalidation(): void {
    const allCoverage = this.store.getAllCoverage('kline_daily')

    for (const cov of allCoverage) {
      if (!cov.latest_date || cov.row_count < 30) continue

      // Check: does the latest bar's close match what we'd expect?
      // Simple heuristic: if the last 2 bars have a >45% jump, likely a split occurred
      // and all historical QFQ prices are now stale
      const recentBars = this.store.queryKline(cov.code, { limit: 5 })
      if (recentBars.length < 2) continue

      for (let i = 1; i < recentBars.length; i++) {
        const prev = recentBars[i - 1].close
        const curr = recentBars[i].close
        if (prev > 0 && Math.abs((curr - prev) / prev) > 0.45) {
          // Possible split — re-fetch full history with QFQ
          console.log(`[Scheduler] Possible split detected for ${cov.code}: ${prev} → ${curr}. Re-fetching QFQ history.`)
          this.queue.enqueue('kline_daily', cov.code, {
            start: cov.earliest_date,
            _fullRefetch: true,
          }, 1)
          break
        }
      }
    }
  }
}

function isAfterMarketClose(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  // Skip weekends (Saturday=6, Sunday=0 in UTC; adjust for Beijing time)
  const bjDay = ((day + (now.getUTCHours() >= 16 ? 1 : 0)) % 7)
  if (bjDay === 0 || bjDay === 6) return false
  const bjHour = (now.getUTCHours() + 8) % 24
  return bjHour >= 15 && bjHour < 24
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function firstExistingPath(paths: string[]): string | null {
  for (const path of paths) {
    if (existsSync(path)) return path
  }
  return null
}

function isMissingOrStale(count: number | undefined, latest: string | null | undefined, maxAgeDays: number): boolean {
  if (!count || count <= 0) return true
  if (!latest) return true
  const timestamp = new Date(latest).getTime()
  if (!Number.isFinite(timestamp)) return true
  return (Date.now() - timestamp) / 86400000 >= maxAgeDays
}

function isFundLikeWatchType(type: string | undefined): boolean {
  return type === 'fund' || type === 'etf'
}


function isFeedDue(feed: FeedConfig, now: Date): boolean {
  const lastRunAt = feed.last_run_at ? new Date(feed.last_run_at).getTime() : 0
  if (!Number.isFinite(lastRunAt) || lastRunAt <= 0) return true
  const elapsedMs = now.getTime() - lastRunAt
  if (elapsedMs < 0) return false
  switch (feed.update_frequency) {
    case '5min': return elapsedMs >= 5 * 60 * 1000
    case '30min': return elapsedMs >= 30 * 60 * 1000
    case 'hourly': return elapsedMs >= 60 * 60 * 1000 && isPastTriggerMinute(feed, now)
    case 'daily':
    case 'daily_close':
      return elapsedMs >= 20 * 60 * 60 * 1000 && isPastTriggerTime(feed, now)
    case 'weekly': return elapsedMs >= 6.5 * 24 * 60 * 60 * 1000 && isPastTriggerTime(feed, now)
    case 'monthly': return elapsedMs >= 27 * 24 * 60 * 60 * 1000 && isPastTriggerTime(feed, now)
    case 'quarterly': return elapsedMs >= 85 * 24 * 60 * 60 * 1000 && isPastTriggerTime(feed, now)
    case 'yearly': return elapsedMs >= 350 * 24 * 60 * 60 * 1000 && isPastTriggerTime(feed, now)
    default: return false
  }
}

function activeTaskTypesForFeed(feedType: string): string[] {
  const taskType = feedTaskType(feedType)
  if (taskType === 'fund_nav') return ['fund_nav', 'fund_money_yield']
  return [taskType]
}

function isPastTriggerMinute(feed: FeedConfig, now: Date): boolean {
  const { minute } = parseTriggerTime(feed.trigger_time)
  return now.getMinutes() >= minute
}

function isPastTriggerTime(feed: FeedConfig, now: Date): boolean {
  const { hour, minute } = parseTriggerTime(feed.trigger_time)
  const bjHour = (now.getUTCHours() + 8) % 24
  const bjMinute = now.getUTCMinutes()
  return bjHour > hour || (bjHour === hour && bjMinute >= minute)
}

function parseTriggerTime(value: string | null | undefined): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '15:30'))
  if (!match) return { hour: 15, minute: 30 }
  const hour = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  return { hour, minute }
}
