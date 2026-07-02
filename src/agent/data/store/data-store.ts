import type { Database } from 'sql.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { getDb, getDbSync, scheduleSave } from './db'
import { initSchema } from './schema'
import { setMigrationsPath } from './migrator'
import type {
  ApiCallLogRow,
  ApiResultCacheRow,
  AlphaFactorRow,
  AuctionSnapshotRow,
  DataCoverage,
  ExCategoryRow,
  ExTableEntryRow,
  FeedConfig,
  FundPerformanceMetricRow,
  FundamentalRow,
  FinanceNewsRow,
  IndexConstituentRow,
  IndexMomentumRow,
  KlineRow,
  MarketScreeningSnapshotRow,
  MarginTradingRow,
  QuoteSnapshotRow,
  RawApiPayloadRow,
  StockShareholderRow,
  StockInfo,
  TechnicalIndicatorSeriesRow,
  TdxChartSamplingRow,
  TdxSecurityCountRow,
  TopBoardRow,
  WindAnalyticsResultRow,
  WindDocumentRow,
  WindEconomicSeriesRow,
  XdxrEventRow,
} from './data-store-types'
import * as equityStore from './data-store-equity'
import * as maintenanceStore from './data-store-maintenance'
import * as marketStore from './data-store-market'
import * as reuseStore from './data-store-reuse'

export type {
  ApiCallLogRow,
  ApiResultCacheRow,
  AuctionSnapshotRow,
  DataCoverage,
  ExCategoryRow,
  ExTableEntryRow,
  FeedConfig,
  FundPerformanceMetricRow,
  FundamentalRow,
  FinanceNewsRow,
  IndexConstituentRow,
  IndexMomentumRow,
  KlineRow,
  MarketScreeningSnapshotRow,
  MarginTradingRow,
  QuoteSnapshotRow,
  RawApiPayloadRow,
  StockShareholderRow,
  StockInfo,
  TechnicalIndicatorSeriesRow,
  TdxChartSamplingRow,
  TdxSecurityCountRow,
  TopBoardRow,
  WindAnalyticsResultRow,
  WindDocumentRow,
  WindEconomicSeriesRow,
  XdxrEventRow,
} from './data-store-types'

export class DataStore {
  private db: Database | null = null
  private basePath: string
  private initialized = false

  constructor(basePath: string) {
    this.basePath = basePath
  }

  async init(): Promise<void> {
    if (this.initialized && this.db != null && getDbSync() === this.db) return
    this.db = await getDb(this.basePath)
    setMigrationsPath(resolveMigrationsPath(this.basePath))
    initSchema(this.db)
    maintenanceStore.failStaleActiveTasks(this.reuseStore(), 6 * 60 * 60 * 1000)
    maintenanceStore.reconcileDanglingRunningFeeds(this.reuseStore())
    this.initialized = true
  }

  private d(): Database {
    const db = this.db ?? getDbSync()
    if (!db) throw new Error('DataStore not initialized')
    return db
  }

  get isReady(): boolean {
    return this.initialized && (this.db != null || getDbSync() != null)
  }

  get projectBasePath(): string {
    return this.basePath
  }

  private all(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
    const stmt = this.d().prepare(sql)
    if (params.length > 0) stmt.bind(params)
    const rows: Array<Record<string, unknown>> = []
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>)
    stmt.free()
    return rows
  }

  private one(sql: string, params: unknown[] = []): Record<string, unknown> | null {
    const rows = this.all(sql, params)
    return rows[0] ?? null
  }

  private run(sql: string, params: unknown[] = []): void {
    this.d().run(sql, params)
    scheduleSave()
  }

  private reuseStore() {
    return {
      exec: this.exec.bind(this),
      query: this.query.bind(this),
      one: this.one.bind(this),
    }
  }

  // --- Kline ---

  queryKline(code: string, opts: { start?: string; end?: string; adjust?: string; limit?: number; source?: string } = {}): KlineRow[] {
    return equityStore.queryKline(this, code, opts)
  }

  saveKline(rows: KlineRow[]): void {
    equityStore.saveKline(this, rows)
  }

  // --- Stock List ---

  queryStockList(filter?: { market?: string; industry?: string; type?: string }): StockInfo[] {
    return equityStore.queryStockList(this, filter)
  }

  queryStockIdentity(code: string): StockInfo | null {
    return equityStore.queryStockIdentity(this, code)
  }

  saveStockList(stocks: StockInfo[]): void {
    equityStore.saveStockList(this, stocks)
  }

  saveExCategories(rows: ExCategoryRow[]): void {
    equityStore.saveExCategories(this, rows)
  }

  queryExCategories(limit = 100): ExCategoryRow[] {
    return equityStore.queryExCategories(this, limit)
  }

  saveXdxrEvents(rows: XdxrEventRow[]): void {
    equityStore.saveXdxrEvents(this, rows)
  }

  queryXdxrEvents(code: string, limit = 50): XdxrEventRow[] {
    return equityStore.queryXdxrEvents(this, code, limit)
  }

  saveAuctionSnapshots(rows: AuctionSnapshotRow[]): void {
    equityStore.saveAuctionSnapshots(this, rows)
  }

  queryAuctionSnapshots(code: string, date?: string, limit = 100): AuctionSnapshotRow[] {
    return equityStore.queryAuctionSnapshots(this, code, date, limit)
  }

  saveIndexMomentumRows(rows: IndexMomentumRow[]): void {
    equityStore.saveIndexMomentumRows(this, rows)
  }

  queryIndexMomentum(code: string, date?: string, limit = 200): IndexMomentumRow[] {
    return equityStore.queryIndexMomentum(this, code, date, limit)
  }

  saveTopBoardRows(rows: TopBoardRow[]): void {
    equityStore.saveTopBoardRows(this, rows)
  }

  queryTopBoard(opts: { code?: string; category?: string; side?: string; boardDate?: string; limit?: number } = {}): TopBoardRow[] {
    return equityStore.queryTopBoard(this, opts)
  }

  saveTdxSecurityCounts(rows: TdxSecurityCountRow[]): void {
    equityStore.saveTdxSecurityCounts(this, rows)
  }

  queryTdxSecurityCounts(opts: { scope?: string; market?: string; limit?: number } = {}): TdxSecurityCountRow[] {
    return equityStore.queryTdxSecurityCounts(this, opts)
  }

  saveTdxChartSampling(rows: TdxChartSamplingRow[]): void {
    equityStore.saveTdxChartSampling(this, rows)
  }

  queryTdxChartSampling(opts: { scope?: string; code?: string; market?: string; category?: string; limit?: number } = {}): TdxChartSamplingRow[] {
    return equityStore.queryTdxChartSampling(this, opts)
  }

  saveExTableEntries(rows: ExTableEntryRow[]): void {
    equityStore.saveExTableEntries(this, rows)
  }

  queryExTableEntries(opts: { code?: string; category?: string; limit?: number } = {}): ExTableEntryRow[] {
    return equityStore.queryExTableEntries(this, opts)
  }

  searchStock(query: string): StockInfo[] {
    return equityStore.searchStock(this, query)
  }

  // --- Fundamental ---

  queryFundamental(code: string, limit = 8): FundamentalRow[] {
    return equityStore.queryFundamental(this, code, limit)
  }

  queryFundamentalSample(opts: { limit?: number; peLte?: number; peGte?: number; roeGte?: number; latestOnly?: boolean } = {}): FundamentalRow[] {
    return equityStore.queryFundamentalSample(this, opts)
  }

  saveFundamental(rows: FundamentalRow[]): void {
    equityStore.saveFundamental(this, rows)
  }

  saveApiCall(row: ApiCallLogRow): void {
    reuseStore.saveApiCall(this.reuseStore(), row)
  }

  getApiCallSummary(minutes = 24 * 60): Record<string, { total: number; success: number; failRate: number; avgLatency: number }> {
    return reuseStore.getApiCallSummary(this.reuseStore(), minutes)
  }

  getRecentApiCalls(minutes = 30, limit = 100): Array<Record<string, unknown>> {
    return reuseStore.getRecentApiCalls(this.reuseStore(), minutes, limit)
  }

  saveApiResultCache(row: ApiResultCacheRow): void {
    reuseStore.saveApiResultCache(this.reuseStore(), row)
  }

  saveRawApiPayload(row: RawApiPayloadRow): void {
    reuseStore.saveRawApiPayload(this.reuseStore(), row)
  }

  getApiResultCache(source: string, tool: string, action: string, requestHash: string): ApiResultCacheRow | null {
    return reuseStore.getApiResultCache(this.reuseStore(), source, tool, action, requestHash)
  }

  saveQuoteSnapshots(rows: QuoteSnapshotRow[]): void {
    reuseStore.saveQuoteSnapshots(this.reuseStore(), rows)
  }

  saveYfinanceProfileFields(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceProfileFields(this.reuseStore(), rows)
  }

  saveYfinanceStatementItems(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceStatementItems(this.reuseStore(), rows)
  }

  saveYfinanceRecommendations(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceRecommendations(this.reuseStore(), rows)
  }

  saveYfinanceNews(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceNews(this.reuseStore(), rows)
  }

  saveYfinanceOptionExpiries(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceOptionExpiries(this.reuseStore(), rows)
  }

  saveYfinanceOptionContracts(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceOptionContracts(this.reuseStore(), rows)
  }

  saveYfinanceCorporateActions(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceCorporateActions(this.reuseStore(), rows)
  }

  saveYfinanceHolders(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceHolders(this.reuseStore(), rows)
  }

  saveYfinanceInsiderTransactions(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveYfinanceInsiderTransactions(this.reuseStore(), rows)
  }

  saveWindDocuments(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveWindDocuments(this.reuseStore(), rows)
  }

  saveWindEconomicSeries(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveWindEconomicSeries(this.reuseStore(), rows)
  }

  saveWindAnalyticsResults(rows: Array<Record<string, unknown>>): void {
    reuseStore.saveWindAnalyticsResults(this.reuseStore(), rows)
  }

  getRecentQuoteSnapshot(code: string, maxAgeMs: number, source?: string): QuoteSnapshotRow | null {
    return reuseStore.getRecentQuoteSnapshot(this.reuseStore(), code, maxAgeMs, source)
  }

  queryQuoteSnapshots(code: string, limit = 20, source?: string): QuoteSnapshotRow[] {
    return reuseStore.queryQuoteSnapshots(this.reuseStore(), code, limit, source)
  }

  getReusableDataSummary(): reuseStore.ReusableDataSummaryRow[] {
    return reuseStore.getReusableDataSummary(this.reuseStore())
  }

  cleanupApiReuseData(opts: { quoteRetentionDays?: number; apiLogRetentionDays?: number }): void {
    reuseStore.cleanupApiReuseData(this.reuseStore(), opts)
  }

  // --- Coverage ---

  getCoverage(code: string, dataType: string): DataCoverage | null {
    return maintenanceStore.getCoverage(this.reuseStore(), code, dataType)
  }

  getAllCoverage(dataType?: string): DataCoverage[] {
    return maintenanceStore.getAllCoverage(this.reuseStore(), dataType)
  }

  updateCoverage(code: string, dataType: string): void {
    maintenanceStore.updateCoverage(this.reuseStore(), code, dataType)
  }

  // --- Money Flow ---
  saveMoneyFlow(rows: Array<Record<string, unknown>>): void {
    marketStore.saveMoneyFlow(this, rows)
  }
  queryMoneyFlow(code: string, limit = 30): Array<Record<string, unknown>> {
    return marketStore.queryMoneyFlow(this, code, limit)
  }

  // --- Sector ---
  saveSectorRanking(date: string, sectorType: string, rows: Array<Record<string, unknown>>): void {
    marketStore.saveSectorRanking(this, date, sectorType, rows)
  }
  querySectorRanking(date?: string, type = 'industry', limit = 50): Array<Record<string, unknown>> {
    return marketStore.querySectorRanking(this, date, type, limit)
  }

  // --- Limit Pool ---
  saveLimitPool(rows: Array<Record<string, unknown>>): void {
    marketStore.saveLimitPool(this, rows)
  }
  queryLimitPool(date?: string, type?: string): Array<Record<string, unknown>> {
    return marketStore.queryLimitPool(this, date, type)
  }

  // --- Northbound ---
  saveNorthboundFlow(rows: Array<Record<string, unknown>>): void {
    marketStore.saveNorthboundFlow(this, rows)
  }
  queryNorthboundFlow(date?: string, limit = 30): Array<Record<string, unknown>> {
    return marketStore.queryNorthboundFlow(this, date, limit)
  }
  saveNorthbound(rows: Array<Record<string, unknown>>): void {
    marketStore.saveNorthbound(this, rows)
  }
  queryNorthbound(limit = 30): Array<Record<string, unknown>> {
    return marketStore.queryNorthbound(this, limit)
  }

  saveNorthboundHolding(rows: Array<Record<string, unknown>>): void {
    marketStore.saveNorthboundHolding(this, rows)
  }
  queryNorthboundHolding(code?: string, date?: string, limit = 30): Array<Record<string, unknown>> {
    return marketStore.queryNorthboundHolding(this, code, date, limit)
  }

  // --- Fund Nav ---
  saveFundNav(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundNav(this, rows)
  }
  queryFundNav(code: string, opts: { start?: string; end?: string; limit?: number; order?: 'asc' | 'desc' } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundNav(this, code, opts)
  }
  saveFundMoneyYield(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundMoneyYield(this, rows)
  }
  queryFundMoneyYield(code: string, opts: { start?: string; end?: string; limit?: number; order?: 'asc' | 'desc' } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundMoneyYield(this, code, opts)
  }
  saveFundDividendFactors(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundDividendFactors(this, rows)
  }
  queryFundDividendFactors(code: string, opts: { start?: string; end?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundDividendFactors(this, code, opts)
  }
  saveIntradayOhlcvBars(rows: Array<Record<string, unknown>>): void {
    marketStore.saveIntradayOhlcvBars(this, rows)
  }
  queryIntradayOhlcvBars(code: string, opts: { start?: string; end?: string; intervalMinutes?: number; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryIntradayOhlcvBars(this, code, opts)
  }

  // --- Fund Holding / List / Manager ---
  saveFundHolding(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundHolding(this, rows)
  }
  queryFundHolding(opts: { fundCode?: string; stockCode?: string; reportDate?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundHolding(this, opts)
  }
  saveFundList(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundList(this, rows)
  }
  queryFundList(opts: { type?: string; code?: string; codes?: string[]; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundList(this, opts)
  }
  saveFundPerformanceMetrics(rows: FundPerformanceMetricRow[]): void {
    marketStore.saveFundPerformanceMetrics(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryFundPerformanceMetrics(opts: { code?: string; provider?: string; metricDate?: string; limit?: number } = {}): FundPerformanceMetricRow[] {
    return marketStore.queryFundPerformanceMetrics(this, opts) as unknown as FundPerformanceMetricRow[]
  }
  saveIndexConstituents(rows: IndexConstituentRow[]): void {
    marketStore.saveIndexConstituents(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryIndexConstituents(opts: { indexCode?: string; stockCode?: string; asOfDate?: string; provider?: string; limit?: number } = {}): IndexConstituentRow[] {
    return marketStore.queryIndexConstituents(this, opts) as unknown as IndexConstituentRow[]
  }
  saveStockShareholders(rows: StockShareholderRow[]): void {
    marketStore.saveStockShareholders(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryStockShareholders(opts: { code?: string; holderName?: string; reportDate?: string; source?: string; limit?: number } = {}): StockShareholderRow[] {
    return marketStore.queryStockShareholders(this, opts) as unknown as StockShareholderRow[]
  }
  saveFundManagers(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFundManagers(this, rows)
  }
  queryFundManagers(opts: { company?: string; name?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryFundManagers(this, opts)
  }

  // --- Calendar / Industry ---
  saveCalendar(rows: Array<Record<string, unknown>>): void {
    marketStore.saveCalendar(this, rows)
  }
  queryCalendar(opts: { market?: string; start?: string; end?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    return marketStore.queryCalendar(this, opts)
  }
  saveFinanceNews(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFinanceNews(this, rows)
  }
  queryFinanceNews(opts: { keyword?: string; source?: string; limit?: number } = {}): FinanceNewsRow[] {
    return marketStore.queryFinanceNews(this, opts) as unknown as FinanceNewsRow[]
  }
  saveMarketScreeningSnapshots(rows: MarketScreeningSnapshotRow[]): void {
    marketStore.saveMarketScreeningSnapshots(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryMarketScreeningSnapshots(opts: { provider?: string; symbol?: string; sourceAction?: string; since?: string; limit?: number } = {}): MarketScreeningSnapshotRow[] {
    return marketStore.queryMarketScreeningSnapshots(this, opts) as unknown as MarketScreeningSnapshotRow[]
  }
  saveMarginTradingRows(rows: MarginTradingRow[]): void {
    marketStore.saveMarginTradingRows(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryMarginTradingRows(opts: { code?: string; tradeDate?: string; provider?: string; limit?: number } = {}): MarginTradingRow[] {
    return marketStore.queryMarginTradingRows(this, opts) as unknown as MarginTradingRow[]
  }
  saveTechnicalIndicatorSeries(rows: TechnicalIndicatorSeriesRow[]): void {
    marketStore.saveTechnicalIndicatorSeries(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryTechnicalIndicatorSeries(opts: { symbol?: string; indicator?: string; fieldName?: string; since?: string; limit?: number } = {}): TechnicalIndicatorSeriesRow[] {
    return marketStore.queryTechnicalIndicatorSeries(this, opts) as unknown as TechnicalIndicatorSeriesRow[]
  }
  saveAlphaFactorRows(rows: AlphaFactorRow[]): void {
    marketStore.saveAlphaFactorRows(this, rows as unknown as Array<Record<string, unknown>>)
  }
  queryAlphaFactorRows(opts: { symbol?: string; factorName?: string; since?: string; provider?: string; limit?: number } = {}): AlphaFactorRow[] {
    return marketStore.queryAlphaFactorRows(this, opts) as unknown as AlphaFactorRow[]
  }
  saveIndustryMap(rows: Array<Record<string, unknown>>): void {
    marketStore.saveIndustryMap(this, rows)
  }

  // --- Structured endpoint ingestion ---
  saveTickChartIntraday(rows: Array<Record<string, unknown>>): void {
    marketStore.saveTickChartIntraday(this, rows)
  }
  saveTransactions(rows: Array<Record<string, unknown>>): void {
    marketStore.saveTransactions(this, rows)
  }
  saveVolumeProfile(rows: Array<Record<string, unknown>>): void {
    marketStore.saveVolumeProfile(this, rows)
  }
  saveTdxBlockMembers(rows: Array<Record<string, unknown>>): void {
    marketStore.saveTdxBlockMembers(this, rows)
  }
  saveStockCompanyInfo(rows: Array<Record<string, unknown>>): void {
    marketStore.saveStockCompanyInfo(this, rows)
  }
  saveHotRank(rows: Array<Record<string, unknown>>): void {
    marketStore.saveHotRank(this, rows)
  }
  saveDragonTiger(rows: Array<Record<string, unknown>>): void {
    marketStore.saveDragonTiger(this, rows)
  }

  saveUnusualActivity(rows: Array<Record<string, unknown>>): void {
    marketStore.saveUnusualActivity(this, rows)
  }
  queryUnusualActivity(code?: string, date?: string, limit = 50): Array<Record<string, unknown>> {
    return marketStore.queryUnusualActivity(this, code, date, limit)
  }

  saveFlowRank(rows: Array<Record<string, unknown>>): void {
    marketStore.saveFlowRank(this, rows)
  }
  queryFlowRank(period?: string, code?: string, date?: string, limit = 50): Array<Record<string, unknown>> {
    return marketStore.queryFlowRank(this, period, code, date, limit)
  }

  saveChipDistribution(rows: Array<Record<string, unknown>>): void {
    marketStore.saveChipDistribution(this, rows)
  }
  queryChipDistribution(code: string, date?: string, limit = 20): Array<Record<string, unknown>> {
    return marketStore.queryChipDistribution(this, code, date, limit)
  }

  // --- Tasks ---
  createTask(type: string, code: string | null, params: Record<string, unknown>, priority = 5): number {
    return maintenanceStore.createTask(this.reuseStore(), type, code, params, priority)
  }
  getPendingTasks(limit = 10): Array<Record<string, unknown>> {
    return maintenanceStore.getPendingTasks(this.reuseStore(), limit)
  }
  updateTaskStatus(id: number, status: string, progress?: Record<string, unknown>, error?: string): void {
    maintenanceStore.updateTaskStatus(this.reuseStore(), id, status, progress, error)
  }
  failStaleActiveTasks(maxAgeMs: number, reason?: string): number {
    return maintenanceStore.failStaleActiveTasks(this.reuseStore(), maxAgeMs, reason)
  }
  reconcileDanglingRunningFeeds(): number {
    return maintenanceStore.reconcileDanglingRunningFeeds(this.reuseStore())
  }

  // --- Feed Config ---
  getFeedConfigs(): FeedConfig[] {
    return maintenanceStore.getFeedConfigs(this.reuseStore())
  }
  getFeedConfig(feedId: string): FeedConfig | null {
    return maintenanceStore.getFeedConfig(this.reuseStore(), feedId)
  }
  updateFeedConfig(feedId: string, updates: Partial<FeedConfig>): void {
    maintenanceStore.updateFeedConfig(this.reuseStore(), feedId, updates)
  }

  // --- Generic ---
  query<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.all(sql, params) as unknown as T[]
  }
  exec(sql: string, ...params: unknown[]): void { this.run(sql, params) }

  getStats(): { tables: Array<{ name: string; count: number }>; sizeBytes: number } {
    return maintenanceStore.getStats(this.reuseStore())
  }
}

function resolveMigrationsPath(basePath: string): string {
  const runtimePath = join(basePath, 'data', 'migrations')
  if (existsSync(runtimePath)) return runtimePath
  const bundledPath = join(process.cwd(), 'assets', 'migrations')
  if (existsSync(bundledPath)) return bundledPath
  const repoBundledPath = join(process.cwd(), 'finagent_workstation', 'assets', 'migrations')
  if (existsSync(repoBundledPath)) return repoBundledPath
  const sourcePath = join(process.cwd(), 'src', 'agent', 'data', 'migrations')
  if (existsSync(sourcePath)) return sourcePath
  return runtimePath
}
