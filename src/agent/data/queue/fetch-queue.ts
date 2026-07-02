import { DataStore, type FundPerformanceMetricRow } from '../store/data-store'
import { rateLimitedFetch } from './rate-limiter'
import { fetchKlineDaily } from '../fetchers/fetcher-kline-daily'
import { fetchQuote } from '../fetchers/fetcher-quote'
import { fetchStockListA, fetchStockListHK, fetchStockListUS } from '../fetchers/fetcher-stock-list'
import { fetchFundamental } from '../fetchers/fetcher-fundamental'
import { fetchMoneyFlow } from '../fetchers/fetcher-money-flow'
import { fetchSectorRanking } from '../fetchers/fetcher-sector'
import { fetchLimitUpPool, fetchLimitDownPool } from '../fetchers/fetcher-limit-pool'
import { fetchNorthbound } from '../fetchers/fetcher-northbound'
import { fetchFundHolding } from '../fetchers/fetcher-fund-holding'
import { fetchFundPerformanceMetrics } from '../fetchers/fetcher-fund-list'
import { fetchFundManagers } from '../fetchers/fetcher-fund-manager'
import { fetchIndexKline } from '../fetchers/fetcher-index-kline'
import { fetchTradeCalendar } from '../fetchers/fetcher-calendar'
import { fetchIndustryMap } from '../fetchers/fetcher-industry'
import { fetchIndexComponents } from '../fetchers/fetcher-index-components'
import { FundMarketDataFetchService } from '../../../domain/market/services/fund-market-data-fetch-service'
import { ingestEndpointResult } from '../ingestion/registry'
import { normalizeFinanceProviders, type FinanceProvider } from '../provider-policy'
import { normalizeFinanceNews } from '../../../domain/market/services/finance-news-data-api-service'

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'paused' | 'cancelled'

export interface FetchTask {
  id: number
  taskType: string
  code: string | null
  params: Record<string, unknown>
  status: TaskStatus
  priority: number
  progress: { fetched: number; total: number; lastDate?: string; message?: string; saved?: number; failed?: number; skipped?: number } | null
  createdAt: string
  error: string | null
}

type TaskListener = (task: FetchTask) => void

export class FetchQueue {
  private store: DataStore
  private running = false
  private paused = false
  private currentTaskId: number | null = null
  private listeners: TaskListener[] = []
  private readonly fundFetchService = new FundMarketDataFetchService()

  constructor(store: DataStore) {
    this.store = store
  }

  onProgress(listener: TaskListener): void {
    this.listeners.push(listener)
  }

  private emit(task: FetchTask): void {
    for (const fn of this.listeners) {
      try { fn(task) } catch {}
    }
  }

  enqueue(taskType: string, code: string | null, params: Record<string, unknown> = {}, priority = 5): number {
    const id = this.store.createTask(taskType, code, params, priority)
    if (!this.running && !this.paused) {
      setTimeout(() => this.start(), 100)
    }
    return id
  }

  enqueueBatch(taskType: string, codes: string[], params: Record<string, unknown> = {}, priority = 5): number[] {
    const ids = codes.map((code) => this.store.createTask(taskType, code, params, priority))
    if (!this.running && !this.paused) {
      setTimeout(() => this.start(), 100)
    }
    return ids
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    if (!this.running) this.processNext()
  }

  cancel(taskId: number): void {
    this.store.updateTaskStatus(taskId, 'cancelled')
    if (this.currentTaskId === taskId) this.currentTaskId = null
  }

  getStatus(): { running: boolean; paused: boolean; currentTaskId: number | null; pending: number } {
    const pending = this.store.getPendingTasks(1000).length
    return { running: this.running, paused: this.paused, currentTaskId: this.currentTaskId, pending }
  }

  getTasks(status?: string): FetchTask[] {
    const sql = status
      ? 'SELECT * FROM fetch_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC LIMIT 100'
      : 'SELECT * FROM fetch_tasks ORDER BY created_at DESC LIMIT 100'
    const rows = status ? this.store.query(sql, status) : this.store.query(sql)
    return (rows as any[]).map(parseTask)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    await this.processNext()
  }

  stop(): void {
    this.running = false
    this.paused = false
  }

  private async processNext(): Promise<void> {
    if (!this.running || this.paused) return

    const pending = this.store.getPendingTasks(1)
    if (pending.length === 0) {
      this.running = false
      return
    }

    const raw = pending[0]
    const task = parseTask(raw)
    this.currentTaskId = task.id
    this.store.updateTaskStatus(task.id, 'running')
    const startedAt = Date.now()

    try {
      await this.executeTask(task)
      this.store.updateTaskStatus(task.id, 'done', task.progress ?? undefined)
      task.status = 'done'
      this.emit(task)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      const retryCount = (task.params._retryCount as number) ?? 0
      console.error(`[FetchQueue] Task #${task.id} ${task.taskType} failed: ${error}`)
      this.recordTaskFailure(task, error, Date.now() - startedAt)
      if (retryCount < 2) {
        this.store.updateTaskStatus(task.id, 'failed', task.progress ?? undefined, `${error} (will retry ${retryCount + 1}/2)`)
        // Delay retry by creating task with higher priority number (lower priority)
        const newParams = { ...task.params, _retryCount: retryCount + 1 }
        this.store.createTask(task.taskType, task.code, newParams, task.priority + 2)
      } else {
        this.store.updateTaskStatus(task.id, 'failed', task.progress ?? undefined, error)
      }
      task.status = 'failed'
      task.error = error
      this.emit(task)
    }

    this.currentTaskId = null

    // Process next after a small delay
    if (this.running && !this.paused) {
      setTimeout(() => this.processNext(), 100)
    }
  }

  private async executeTask(task: FetchTask): Promise<void> {
    switch (task.taskType) {
      case 'stock_list': return this.execStockList(task)
      case 'quote': return this.execQuote(task)
      case 'kline_daily': return this.execKlineDaily(task)
      case 'kline_batch': return this.execKlineBatch(task)
      case 'fundamental': return this.execFundamental(task)
      case 'money_flow': return this.execMoneyFlow(task)
      case 'stock_company_info': return this.execStockCompanyInfo(task)
      case 'finance_news': return this.execFinanceNews(task)
      case 'sector': return this.execSector(task)
      case 'limit_pool': return this.execLimitPool(task)
      case 'northbound': return this.execNorthbound(task)
      case 'fund_list': return this.execFundList(task)
      case 'fund_performance': return this.execFundPerformance(task)
      case 'fund_nav': return this.execFundNav(task)
      case 'fund_money_yield': return this.execFundMoneyYield(task)
      case 'fund_holding': return this.execFundHolding(task)
      case 'fund_manager': return this.execFundManager(task)
      case 'etf_quotes': return this.execEtfQuotes(task)
      case 'index_kline': return this.execIndexKline(task)
      case 'calendar': return this.execCalendar(task)
      case 'industry': return this.execIndustry(task)
      case 'index_components': return this.execIndexComponents(task)
      default: throw new Error(`Unknown task type: ${task.taskType}`)
    }
  }

  private async execStockList(task: FetchTask): Promise<void> {
    const market = (task.params.market as string) ?? 'A'
    const providers = taskProviders(task)
    const fetcher = market === 'HK' ? fetchStockListHK : market === 'US' ? fetchStockListUS : fetchStockListA
    const result = await rateLimitedFetch('akshare', () => fetcher({ providers }))
    this.store.saveStockList(result.data)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} stocks saved` }
  }

  private async execQuote(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required for quote')
    const result = await rateLimitedFetch('market-data', () =>
      fetchQuote(task.code!, { providers: taskProviders(task), forceLive: Boolean(task.params.forceLive) })
    )
    const rows = result.data.map((quote) => ({
      code: quote.code,
      timestamp: result.fetchedAt,
      fetched_at: result.fetchedAt,
      source: result.source,
      name: quote.name,
      price: quote.price,
      change: quote.change,
      change_pct: quote.changePct,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      prev_close: quote.prevClose,
      volume: quote.volume,
      amount: quote.amount,
      pe: quote.pe,
      pb: quote.pb,
      market_cap: quote.marketCap,
      turnover_rate: quote.turnoverRate,
      raw_json: JSON.stringify({ provenance: result.provenance }),
    }))
    this.store.saveQuoteSnapshots(rows)
    task.progress = {
      fetched: result.data.length,
      total: result.data.length,
      saved: result.data.length,
      message: `${result.data.length} quote snapshots saved (${result.source})`,
    }
  }

  private async execKlineDaily(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required for kline_daily')
    const start = (task.params.start as string) ?? fiveYearsAgo()
    const end = (task.params.end as string) ?? today()
    const adjust = (task.params.adjust as string) ?? 'qfq'
    const market = (task.params.market as string) ?? undefined
    const providers = taskProviders(task)

    // Check existing coverage (skip if _fullRefetch requested, e.g. after split)
    const fullRefetch = Boolean(task.params._fullRefetch)
    const coverage = fullRefetch ? null : this.store.getCoverage(task.code, 'kline_daily')
    const effectiveStart = coverage?.latest_date && coverage.latest_date >= start
      ? nextDay(coverage.latest_date)
      : start

    if (effectiveStart > end) {
      task.progress = { fetched: 0, total: 0, message: 'Already up to date' }
      return
    }

    const limiterSource = market === 'US' || market === 'HK' ? 'yahoo' : 'eastmoney'
    const result = await rateLimitedFetch(limiterSource, () =>
      fetchKlineDaily(task.code!, { start: effectiveStart, end, adjust, market, providers, skipCache: fullRefetch })
    )

    if (result.data.length > 0) {
      this.store.saveKline(result.data)
    }
    task.progress = {
      fetched: result.data.length,
      total: result.data.length,
      lastDate: result.data[result.data.length - 1]?.date,
      message: `${result.data.length} bars saved (${result.source})`,
    }
  }

  private async execStockCompanyInfo(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required for stock_company_info')
    const startedAt = Date.now()
    const params = task.params ?? {}
    const endpoint = String(params.tdx_action ?? params.endpoint ?? 'company_info')
    if (!['company_info', 'company_categories', 'company_content', 'finance'].includes(endpoint)) {
      throw new Error(`unsupported stock_company_info endpoint: ${endpoint}`)
    }
    const gotdxUrl = await resolveGotdxUrl()
    if (!gotdxUrl) throw new Error('gotdx sidecar unavailable for stock_company_info')

    const qs = new URLSearchParams()
    qs.set('code', task.code)
    for (const [key, value] of Object.entries(params)) {
      if (value == null || key === 'tdx_action' || key === 'endpoint') continue
      qs.set(key, String(value))
    }
    const url = `${gotdxUrl}/${endpoint}?${qs}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const body = await res.text()
      this.store.saveApiCall?.({
        source: 'tdx',
        tool: 'FetchQueue',
        action: 'stock_company_info',
        endpoint,
        status: res.status,
        success: false,
        duration_ms: Date.now() - startedAt,
        error: body.slice(0, 500),
      })
      throw new Error(`TDX ${endpoint} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
    }

    const payload = await res.json()
    const ingestion = ingestEndpointResult(this.store, {
      provider: 'tdx',
      endpoint,
      payload,
      params,
      code: task.code,
      source: 'tdx',
      request: { action: 'fetch', type: 'stock_company_info', code: task.code, params },
    })
    const saved = ingestion?.count ?? 0
    task.progress = {
      fetched: 1,
      total: 1,
      saved,
      message: `${saved} stock_company_info rows saved (${endpoint})`,
    }
    this.store.saveApiCall?.({
      source: 'tdx',
      tool: 'FetchQueue',
      action: 'stock_company_info',
      endpoint,
      status: res.status,
      success: true,
      duration_ms: Date.now() - startedAt,
    })
  }

  private async execKlineBatch(task: FetchTask): Promise<void> {
    const codes = (task.params.codes as string[]) ?? []
    if (codes.length === 0) throw new Error('codes required for kline_batch')
    const start = (task.params.start as string) ?? fiveYearsAgo()
    const end = (task.params.end as string) ?? today()
    const adjust = (task.params.adjust as string) ?? 'qfq'
    const market = (task.params.market as string) ?? undefined
    const providers = taskProviders(task)

    let saved = 0
    let failed = 0
    let skipped = 0
    const failures: string[] = []

    task.progress = { fetched: 0, total: codes.length, saved, failed, skipped }
    this.emit(task)

    for (let i = 0; i < codes.length; i++) {
      if (this.paused || !this.running) {
        task.progress = { ...task.progress!, message: `Paused at ${i}/${codes.length}` }
        this.store.updateTaskStatus(task.id, 'paused', task.progress)
        return
      }

      const code = codes[i]
      const coverage = this.store.getCoverage(code, 'kline_daily')
      const effectiveStart = coverage?.latest_date && coverage.latest_date >= start
        ? nextDay(coverage.latest_date)
        : start

      if (effectiveStart <= end) {
        try {
          const limiterSource = market === 'US' || market === 'HK' ? 'yahoo' : 'eastmoney'
          const result = await rateLimitedFetch(limiterSource, () =>
            fetchKlineDaily(code, { start: effectiveStart, end, adjust, market, providers })
          )
          if (result.data.length > 0) {
            this.store.saveKline(result.data)
            saved += result.data.length
          } else {
            failed += 1
            failures.push(`${code}: empty kline response`)
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          failed += 1
          failures.push(`${code}: ${error}`)
          console.error(`[FetchQueue] kline ${code} failed:`, e)
          this.recordTaskFailure({ ...task, code }, error, null)
        }
      } else {
        skipped += 1
      }

      task.progress = {
        fetched: i + 1,
        total: codes.length,
        lastDate: end,
        saved,
        failed,
        skipped,
        message: `${i + 1}/${codes.length} (${code}) saved ${saved}, failed ${failed}, up-to-date ${skipped}`,
      }
      this.store.updateTaskStatus(task.id, 'running', task.progress)
      this.emit(task)
    }

    if (failed > 0 && saved === 0 && skipped === 0) {
      throw new Error(`kline_batch failed for all ${failed}/${codes.length}: ${failures.slice(0, 3).join('; ')}`)
    }

    if (failed > 0) {
      task.progress = {
        fetched: codes.length,
        total: codes.length,
        lastDate: end,
        saved,
        failed,
        skipped,
        message: `Partial kline batch: saved ${saved}, failed ${failed}, up-to-date ${skipped}`,
      }
    }
  }

  private async execFundamental(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const forceLive = Boolean(task.params.forceLive)
    const result = await rateLimitedFetch('akshare', () => fetchFundamental(task.code!, {
      providers: taskProviders(task),
      cacheMode: forceLive ? 'live-only' : undefined,
    }))
    if (result.data.length > 0) this.store.saveFundamental(result.data)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} periods saved` }
  }

  private async execMoneyFlow(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const days = Number(task.params.days ?? 30)
    const result = await rateLimitedFetch('eastmoney', () => fetchMoneyFlow(task.code!, days, { providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveMoneyFlow(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} days saved` }
  }

  private async execFinanceNews(task: FetchTask): Promise<void> {
    const startedAt = Date.now()
    const limit = Math.max(1, Math.min(Number(task.params.limit ?? task.params.max_enrich ?? 50), 100))
    const keyword = String(task.params.keyword ?? task.params.query ?? task.code ?? 'A股 财经 市场')
    const provider = taskSource(task, 'akshare')
    const payload = provider === 'sina'
      ? await fetchSinaFinanceNews(keyword, limit)
      : await fetchSidecarFinanceNews(keyword, limit)
    const rows = normalizeFinanceNews(payload, limit)
    if (rows.length > 0) this.store.saveFinanceNews(rows)
    task.progress = {
      fetched: rows.length,
      total: rows.length,
      saved: rows.length,
      message: `${rows.length} finance_news rows saved (${provider})`,
    }
    this.store.saveApiCall?.({
      source: provider,
      provider,
      interface_id: 'news.finance_feed',
      capability_id: `${provider}.news.finance_feed`,
      tool: 'FetchQueue',
      action: 'finance_news',
      endpoint: provider === 'sina' ? 'feed.mix.sina.com.cn/api/roll/get' : '/news',
      status: 200,
      success: true,
      duration_ms: Date.now() - startedAt,
    })
  }

  private async execSector(task: FetchTask): Promise<void> {
    const type = (task.params.type as 'industry' | 'concept') ?? 'industry'
    const result = await rateLimitedFetch('eastmoney', () => fetchSectorRanking(type, {
      providers: taskProviders(task),
      skipCache: true,
    }))
    if (result.data.length > 0) {
      const date = result.data[0].date
      this.store.saveSectorRanking(date, type, result.data as any)
    }
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} sectors saved` }
  }

  private async execLimitPool(task: FetchTask): Promise<void> {
    const date = task.params.date ? String(task.params.date) : undefined
    const providers = taskProviders(task)
    const upResult = await rateLimitedFetch('eastmoney', () => fetchLimitUpPool(date, { providers }))
    const downResult = await rateLimitedFetch('eastmoney', () => fetchLimitDownPool(date, { providers }))
    const all = [...upResult.data, ...downResult.data]
    if (all.length > 0) this.store.saveLimitPool(all as any)
    task.progress = { fetched: all.length, total: all.length, message: `${upResult.data.length} up + ${downResult.data.length} down` }
  }

  private async execNorthbound(task: FetchTask): Promise<void> {
    const days = Number(task.params.days ?? 30)
    const result = await rateLimitedFetch('eastmoney', () => fetchNorthbound(days, { providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveNorthboundFlow(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} days saved` }
  }

  private async execFundList(task: FetchTask): Promise<void> {
    const forceLive = Boolean(task.params.forceLive)
    const result = await this.fundFetchService.readFundList(taskProviders(task), { skipCache: forceLive })
    if (result.data.length > 0) this.store.saveFundList(result.data as any)
    const performance = fundPerformanceRowsFromFundList(result)
    if (performance.length > 0) this.store.saveFundPerformanceMetrics(performance)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} funds saved; ${performance.length} performance rows saved` }
  }

  private async execFundPerformance(task: FetchTask): Promise<void> {
    const forceLive = Boolean(task.params.forceLive)
    const result = await rateLimitedFetch('akshare', () => fetchFundPerformanceMetrics({
      providers: taskProviders(task),
      code: task.code ?? undefined,
      limit: Number(task.params.limit ?? 100),
      skipCache: forceLive,
    }))
    if (result.data.length > 0) this.store.saveFundPerformanceMetrics(result.data)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} fund performance rows saved` }
  }

  private async execFundNav(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const coverage = this.store.getCoverage(task.code, 'fund_nav')
    const startDate = coverage?.latest_date ?? undefined
    const forceLive = Boolean(task.params.forceLive)
    const result = await this.fundFetchService.readFundNav(task.code, startDate, taskProviders(task), { skipCache: forceLive })
    if (result.data.length > 0) this.store.saveFundNav(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} nav points saved` }
  }

  private async execFundMoneyYield(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const coverage = this.store.getCoverage(task.code, 'fund_money_yield')
    const startDate = coverage?.latest_date ?? undefined
    const forceLive = Boolean(task.params.forceLive)
    const result = await this.fundFetchService.readFundMoneyYield(task.code, startDate, taskProviders(task), { skipCache: forceLive })
    if (result.data.length > 0) this.store.saveFundMoneyYield(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} money-fund yield points saved` }
  }

  private async execFundHolding(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const result = await rateLimitedFetch('akshare', () => fetchFundHolding(task.code!, { providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveFundHolding(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} holdings saved` }
  }

  private async execFundManager(task: FetchTask): Promise<void> {
    const result = await rateLimitedFetch('akshare', () => fetchFundManagers({ providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveFundManagers(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} managers saved` }
  }

  private async execEtfQuotes(task: FetchTask): Promise<void> {
    const limit = Number(task.params.limit ?? 80)
    const forceLive = Boolean(task.params.forceLive)
    const result = await this.fundFetchService.readEtfQuotes(limit, taskProviders(task), { skipCache: forceLive })
    if (result.stocks.length > 0) this.store.saveStockList(result.stocks)
    if (result.quotes.length > 0) this.store.saveQuoteSnapshots(result.quotes)
    task.progress = {
      fetched: result.quotes.length,
      total: result.quotes.length,
      message: `${result.quotes.length} ETF quotes saved`,
    }
  }

  private async execIndexKline(task: FetchTask): Promise<void> {
    if (!task.code) throw new Error('code required')
    const start = (task.params.start as string) ?? fiveYearsAgo()
    const result = await rateLimitedFetch('eastmoney', () => fetchIndexKline(task.code!, { start, providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveKline(result.data)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} index bars saved` }
  }

  private async execCalendar(task: FetchTask): Promise<void> {
    const year = Number(task.params.year ?? new Date().getFullYear())
    const result = await rateLimitedFetch('akshare', () => fetchTradeCalendar(year, 'CN', { providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveCalendar(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} calendar days saved` }
  }

  private async execIndustry(task: FetchTask): Promise<void> {
    const maxBoards = Number(task.params.max_boards ?? task.params.industry_max_boards ?? 50)
    const result = await rateLimitedFetch('eastmoney', () => fetchIndustryMap({
      maxBoards,
      onProgress: (progress) => {
        task.progress = {
          fetched: progress.rows,
          total: progress.total,
          failed: progress.failed,
          message: `Industry board ${progress.index}/${progress.total}: ${progress.board}`,
        }
        this.emit(task)
      },
    }))
    if (result.data.length > 0) this.store.saveIndustryMap(result.data as any)
    task.progress = { fetched: result.data.length, total: result.data.length, message: `${result.data.length} stock-industry mappings saved` }
  }

  private async execIndexComponents(task: FetchTask): Promise<void> {
    const indexCode = task.code ?? (task.params.index as string)
    if (!indexCode) throw new Error('index code required (e.g. 000300 for CSI300)')
    const result = await rateLimitedFetch('akshare', () => fetchIndexComponents(indexCode, { providers: taskProviders(task) }))
    if (result.data.length > 0) this.store.saveIndexConstituents(result.data)
    const codes = result.data.map((item) => item.stock_code)
    // After getting the component list, enqueue a batch kline fetch for all of them
    const start = (task.params.start as string) ?? fiveYearsAgo()
    this.store.createTask('kline_batch', null, { codes, start }, (task.priority ?? 3) + 1)
    task.progress = { fetched: codes.length, total: codes.length, message: `${codes.length} components saved, kline batch queued` }
  }

  private recordTaskFailure(task: FetchTask, error: string, durationMs: number | null): void {
    const { source, endpoint, provider, interface_id, capability_id } = apiFailureTarget(task)
    this.store.saveApiCall({
      source,
      provider,
      interface_id,
      capability_id,
      tool: 'FetchQueue',
      action: task.taskType,
      endpoint,
      status: 0,
      success: false,
      duration_ms: durationMs,
      error: task.code ? `${task.code}: ${error}` : error,
    })
  }
}

function fundPerformanceRowsFromFundList(result: {
  data: Array<{ code: string; nav_date: string | null; nav: number | null; return_ytd: number | null; return_1y: number | null; return_3y: number | null }>
  source?: string
  fetchedAt?: string
  provenance?: { provider?: string; capabilityId?: string }
}): FundPerformanceMetricRow[] {
  const fetchedAt = result.fetchedAt ?? new Date().toISOString()
  const provider = String(result.provenance?.provider ?? result.source ?? 'fund-data')
  const capabilityId = String(result.provenance?.capabilityId ?? `${provider}.fund.performance_metrics`)
  const rows: FundPerformanceMetricRow[] = []
  for (const row of result.data) {
    const code = String(row.code ?? '').trim()
    if (!code) continue
    rows.push({
      code,
      metric_date: String(row.nav_date ?? fetchedAt.slice(0, 10)),
      provider,
      capability_id: capabilityId.replace('identity_list', 'performance_metrics'),
      source_action: 'fund_open_fund_rank_em',
      nav: row.nav ?? null,
      return_ytd: row.return_ytd ?? null,
      return_1w: null,
      return_1m: null,
      return_3m: null,
      return_6m: null,
      return_1y: row.return_1y ?? null,
      return_2y: null,
      return_3y: row.return_3y ?? null,
      return_since_inception: null,
      fetched_at: fetchedAt,
      raw_json: JSON.stringify(row),
    })
  }
  return rows
}

function taskProviders(task: FetchTask): FinanceProvider[] {
  return normalizeFinanceProviders(task.params.source_priority)
}

function apiFailureTarget(task: FetchTask): {
  source: string
  endpoint: string
  provider?: string
  interface_id?: string
  capability_id?: string
} {
  const market = task.params.market as string | undefined
  switch (task.taskType) {
    case 'stock_list': return interfaceFailureTarget(task, 'stock.identity_list', `stock_list:${task.params.market ?? 'A'}`, 'stock-list')
    case 'fundamental': return interfaceFailureTarget(task, 'stock.daily_valuation', 'fundamental', 'akshare')
    case 'stock_company_info': return interfaceFailureTarget(task, 'stock.company_info', 'company_info', 'tdx')
    case 'finance_news': return interfaceFailureTarget(task, 'news.finance_feed', 'finance_news', 'akshare')
    case 'calendar': return interfaceFailureTarget(task, 'calendar.trade_days', 'trade_calendar', 'szse')
    case 'fund_list': return interfaceFailureTarget(task, 'fund.identity_list', 'fund_list', 'fund-data')
    case 'fund_performance': return interfaceFailureTarget(task, 'fund.performance_metrics', 'fund_performance', 'fund-data')
    case 'fund_nav': return interfaceFailureTarget(task, 'fund.nav_history', 'fund_nav', 'fund-data')
    case 'fund_money_yield': return interfaceFailureTarget(task, 'fund.money_yield_history', 'fund_money_yield', 'eastmoney')
    case 'fund_holding': return interfaceFailureTarget(task, 'fund.holding', 'fund_holding', 'akshare')
    case 'fund_manager': return interfaceFailureTarget(task, 'fund.manager', 'fund_manager', 'akshare')
    case 'index_components': return interfaceFailureTarget(task, 'index.constituents', 'index_components', 'akshare')
    case 'kline_daily':
    case 'kline_batch': return interfaceFailureTarget(task, market === 'US' || market === 'HK' ? 'stock.daily_kline' : 'stock.daily_kline', task.taskType, market === 'US' || market === 'HK' ? 'yahoo' : 'market-data')
    case 'money_flow': return interfaceFailureTarget(task, 'stock.money_flow', 'money_flow', 'eastmoney')
    case 'sector': return interfaceFailureTarget(task, 'market.sector_ranking', 'sector', 'eastmoney')
    case 'limit_pool': return interfaceFailureTarget(task, 'market.limit_pool', 'limit_pool', 'eastmoney')
    case 'northbound': return interfaceFailureTarget(task, 'market.northbound_flow', 'northbound', 'eastmoney')
    case 'industry': return { source: 'eastmoney', endpoint: 'industry' }
    case 'etf_quotes': return { source: taskSource(task, 'eastmoney'), endpoint: 'etf_quotes' }
    case 'index_kline': return interfaceFailureTarget(task, 'index.daily_kline', 'index_kline', 'market-data')
    default: return { source: 'fetch_queue', endpoint: task.taskType }
  }
}

function interfaceFailureTarget(
  task: FetchTask,
  interfaceId: string,
  endpoint: string,
  fallbackSource: string,
): { source: string; endpoint: string; provider?: string; interface_id: string; capability_id?: string } {
  const source = taskSource(task, fallbackSource)
  const provider = knownDataApiProvider(source) ? source : undefined
  return {
    source,
    provider,
    endpoint,
    interface_id: interfaceId,
    capability_id: provider ? `${provider}.${interfaceId}` : undefined,
  }
}

function knownDataApiProvider(source: string): boolean {
  return ['eastmoney', 'akshare', 'tdx', 'tushare', 'wind', 'yahoo', 'sina', 'tencent', 'szse'].includes(source)
}

function taskSource(task: FetchTask, fallback: string): string {
  const providers = taskProviders(task)
  if (providers.length !== 1) return fallback
  return providerSourceName(providers[0])
}

function providerSourceName(provider: FinanceProvider): string {
  return provider === 'eastmoneyDirect' ? 'eastmoney' : provider
}

async function resolveGotdxUrl(): Promise<string> {
  try {
    const { getGotdxUrl } = await import('../../../main/sidecar')
    return getGotdxUrl() ?? ''
  } catch {
    return ''
  }
}

async function resolveSidecarUrl(): Promise<string> {
  try {
    const { getSidecarUrl } = await import('../../../main/sidecar')
    return getSidecarUrl() ?? ''
  } catch {
    return ''
  }
}

async function fetchSidecarFinanceNews(keyword: string, limit: number): Promise<unknown> {
  const sidecarUrl = await resolveSidecarUrl()
  if (!sidecarUrl) throw new Error('Python sidecar unavailable for finance_news')
  const qs = new URLSearchParams({
    query: keyword,
    keyword,
    limit: String(limit),
  })
  const res = await fetch(`${sidecarUrl}/news?${qs}`, { signal: AbortSignal.timeout(20_000) })
  const body = await res.text()
  if (!res.ok) throw new Error(`finance_news sidecar failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  const payload = body ? JSON.parse(body) : null
  const error = payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : null
  if (error != null && error !== '') throw new Error(String(error))
  return payload
}

async function fetchSinaFinanceNews(keyword: string, limit: number): Promise<unknown> {
  const params = new URLSearchParams({
    pageid: '153',
    lid: '2516',
    k: keyword,
    num: String(Math.max(1, Math.min(limit, 50))),
    page: '1',
  })
  const res = await fetch(`https://feed.mix.sina.com.cn/api/roll/get?${params}`, {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Sina finance news HTTP ${res.status} ${body.slice(0, 200)}`)
  return body ? JSON.parse(body) : null
}

function parseTask(raw: any): FetchTask {
  return {
    id: raw.id,
    taskType: raw.task_type,
    code: raw.code,
    params: raw.params ? JSON.parse(raw.params) : {},
    status: raw.status,
    priority: raw.priority ?? 5,
    progress: raw.progress ? JSON.parse(raw.progress) : null,
    createdAt: raw.created_at,
    error: raw.error,
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function fiveYearsAgo(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 5)
  return d.toISOString().split('T')[0]
}

function nextDay(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
