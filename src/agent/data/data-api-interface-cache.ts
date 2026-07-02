import { getDbSync } from "./store/db";
import type { KlineRow, QuoteSnapshotRow, StockInfo } from "./store/data-store";
import {
  shouldReuseKlineCache,
  shouldReuseQuoteCache,
  shouldReuseRowCountCache,
} from "./data-api-cache-policy";
import type { FundInfo } from "./fetchers/fetcher-fund-list";
import type { CalendarRow } from "./fetchers/fetcher-calendar";
import type { FundNavRow } from "./fetchers/fetcher-fund-nav";
import type { FundMoneyYieldRow } from "./fetchers/fetcher-fund-money-yield";
import type { FundHoldingRow } from "./fetchers/fetcher-fund-holding";
import type { FundManagerRow } from "./fetchers/fetcher-fund-manager";
import type { MoneyFlowRow } from "./fetchers/fetcher-money-flow";
import type { SectorRow } from "./fetchers/fetcher-sector";
import type { LimitItem } from "./fetchers/fetcher-limit-pool";
import type { NorthboundRow } from "./fetchers/fetcher-northbound";
import type {
  FinanceNewsRow,
  FundamentalRow,
  FundPerformanceMetricRow,
  IndexConstituentRow,
  MarketScreeningSnapshotRow,
  TechnicalIndicatorSeriesRow,
} from "./store/data-store";
import type { AlphaFactorRow } from "./store/data-store-types";
import type { EtfQuoteFetchResult } from "./fetchers/fetcher-etf";
import type { Quote } from "./data-manager-shared";
import type {
  DragonTigerItem,
  FlowRankItem,
  HotRankItem,
  NorthboundHoldingItem,
  UnusualActivityItem,
} from "./eastmoney-advanced";

type Row = Record<string, unknown>;

export function readRecentQuoteSnapshot(
  code: string,
  maxAgeMs: number,
  source?: string,
): QuoteSnapshotRow | null {
  // Freshness is based on provider/source quote timestamp, not local ingest time.
  const params: unknown[] = [code];
  let sql = "SELECT * FROM quote_snapshot WHERE code = ?";
  if (source) {
    sql += " AND source = ?";
    params.push(source);
  }
  const row = one(`${sql} ORDER BY timestamp DESC LIMIT 1`, params);
  if (!row) return null;
  const quote = mapQuote(row);
  return shouldReuseQuoteCache({ sourceTimestamp: quote.timestamp, maxAgeMs })
    .reusable
    ? quote
    : null;
}

export function readKlineRows(
  code: string,
  opts: {
    start?: string;
    end?: string;
    adjust?: string;
    source?: string;
    minRows?: number;
    limit?: number;
  } = {},
): KlineRow[] {
  const adjust = opts.adjust ?? "qfq";
  const params: unknown[] = [code, adjust];
  let sql = "SELECT * FROM kline_daily WHERE code = ? AND adjust = ?";
  if (opts.source) {
    sql += " AND source = ?";
    params.push(opts.source);
  }
  if (opts.start) {
    sql += " AND date >= ?";
    params.push(opts.start);
  }
  if (opts.end) {
    sql += " AND date <= ?";
    params.push(opts.end);
  }
  sql += " ORDER BY date ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params).map(mapKline);
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    earliestDate: rows[0]?.date,
    latestDate: rows[rows.length - 1]?.date,
    start: opts.start,
    end: opts.end,
  });
  if (!decision.reusable) return [];
  return rows;
}

export function readStockIdentityList(
  opts: { market?: string; minRows?: number; limit?: number } = {},
): StockInfo[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM stock_list WHERE delist_date IS NULL";
  if (opts.market) {
    sql += " AND market = ?";
    params.push(opts.market);
  }
  sql += " ORDER BY code";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params).map(mapStockInfo);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 100,
    label: "stock identity",
  });
  return decision.reusable ? rows : [];
}

export function readFundIdentityList(
  opts: { minRows?: number; limit?: number } = {},
): FundInfo[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM fund_list ORDER BY total_size DESC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params).map(mapFundInfo);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 20,
    label: "fund identity",
  });
  return decision.reusable ? rows : [];
}

export function readFundPerformanceMetricRows(
  opts: {
    code?: string;
    provider?: string;
    metricDate?: string;
    minRows?: number;
    limit?: number;
  } = {},
): FundPerformanceMetricRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM fund_performance_metrics WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.provider) {
    sql += " AND provider = ?";
    params.push(opts.provider);
  }
  if (opts.metricDate) {
    sql += " AND metric_date = ?";
    params.push(opts.metricDate);
  }
  sql += " ORDER BY metric_date DESC, fetched_at DESC, return_1y DESC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as FundPerformanceMetricRow[];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "fund performance metrics",
  });
  return decision.reusable ? rows : [];
}

export function readIndexConstituentRows(
  opts: {
    indexCode?: string;
    stockCode?: string;
    asOfDate?: string;
    provider?: string;
    minRows?: number;
    limit?: number;
  } = {},
): IndexConstituentRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM index_constituent WHERE 1=1";
  if (opts.indexCode) {
    sql += " AND index_code = ?";
    params.push(opts.indexCode);
  }
  if (opts.stockCode) {
    sql += " AND stock_code = ?";
    params.push(opts.stockCode);
  }
  if (opts.asOfDate) {
    sql += " AND as_of_date = ?";
    params.push(opts.asOfDate);
  }
  if (opts.provider) {
    sql += " AND provider = ?";
    params.push(opts.provider);
  }
  sql += " ORDER BY as_of_date DESC, weight DESC, stock_code";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as IndexConstituentRow[];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? (opts.indexCode ? 10 : 1),
    label: "index constituents",
  });
  return decision.reusable ? rows : [];
}

export function readStockShareholderRows(
  opts: {
    code?: string;
    holderName?: string;
    reportDate?: string;
    source?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM stock_shareholder WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.holderName) {
    sql += " AND holder_name LIKE ?";
    params.push(`%${opts.holderName}%`);
  }
  if (opts.reportDate) {
    sql += " AND report_date = ?";
    params.push(opts.reportDate);
  }
  if (opts.source) {
    sql += " AND source = ?";
    params.push(opts.source);
  }
  sql +=
    " ORDER BY report_date DESC, rank IS NULL, rank ASC, hold_pct DESC LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "stock shareholders",
  });
  return decision.reusable ? rows : [];
}

export function readTradeCalendarRows(
  year: number,
  market = "CN",
): CalendarRow[] {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const rows = query(
    "SELECT * FROM trade_calendar WHERE market = ? AND date >= ? AND date <= ? ORDER BY date ASC",
    [market.toUpperCase(), start, end],
  ).map(mapCalendar);
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: 250,
    earliestDate: rows[0]?.date,
    latestDate: rows[rows.length - 1]?.date,
    start,
    end,
  });
  return decision.reusable ? rows : [];
}

export function readMarketScreeningSnapshots(
  opts: {
    provider?: string;
    symbol?: string;
    sourceAction?: string;
    since?: string;
    minRows?: number;
    limit?: number;
  } = {},
): MarketScreeningSnapshotRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM market_screening_snapshot WHERE 1=1";
  if (opts.provider) {
    sql += " AND provider = ?";
    params.push(opts.provider);
  }
  if (opts.symbol) {
    sql += " AND symbol = ?";
    params.push(opts.symbol);
  }
  if (opts.sourceAction) {
    sql += " AND source_action = ?";
    params.push(opts.sourceAction);
  }
  if (opts.since) {
    sql += " AND screened_at >= ?";
    params.push(opts.since);
  }
  sql += " ORDER BY screened_at DESC, rank IS NULL, rank ASC, score DESC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as MarketScreeningSnapshotRow[];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "market screening",
  });
  return decision.reusable ? rows : [];
}

export function readTechnicalIndicatorSeries(
  opts: {
    symbol?: string;
    indicator?: string;
    fieldName?: string;
    since?: string;
    minRows?: number;
    limit?: number;
  } = {},
): TechnicalIndicatorSeriesRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM technical_indicator_series WHERE 1=1";
  if (opts.symbol) {
    sql += " AND symbol = ?";
    params.push(opts.symbol);
  }
  if (opts.indicator) {
    sql += " AND indicator = ?";
    params.push(opts.indicator);
  }
  if (opts.fieldName) {
    sql += " AND field_name = ?";
    params.push(opts.fieldName);
  }
  if (opts.since) {
    sql += " AND source_date >= ?";
    params.push(opts.since);
  }
  sql += " ORDER BY source_date DESC, fetched_at DESC, field_name";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as TechnicalIndicatorSeriesRow[];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "technical indicator series",
  });
  return decision.reusable ? rows : [];
}

export function readAlphaFactorRows(
  opts: {
    symbol?: string;
    factorName?: string;
    since?: string;
    provider?: string;
    minRows?: number;
    limit?: number;
  } = {},
): AlphaFactorRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM alpha_factor WHERE 1=1";
  if (opts.symbol) {
    sql += " AND symbol = ?";
    params.push(opts.symbol);
  }
  if (opts.factorName) {
    sql += " AND factor_name = ?";
    params.push(opts.factorName);
  }
  if (opts.since) {
    sql += " AND source_date >= ?";
    params.push(opts.since);
  }
  if (opts.provider) {
    sql += " AND provider = ?";
    params.push(opts.provider);
  }
  sql += " ORDER BY source_date DESC, fetched_at DESC, factor_name";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as AlphaFactorRow[];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "alpha factor rows",
  });
  return decision.reusable ? rows : [];
}

export function readFundNavRows(
  code: string,
  opts: { start?: string; end?: string; minRows?: number; limit?: number } = {},
): FundNavRow[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM fund_nav WHERE code = ?";
  if (opts.start) {
    sql += " AND date >= ?";
    params.push(opts.start);
  }
  if (opts.end) {
    sql += " AND date <= ?";
    params.push(opts.end);
  }
  sql += " ORDER BY date ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params).map(mapFundNav);
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    earliestDate: rows[0]?.date,
    latestDate: rows[rows.length - 1]?.date,
    start: opts.start,
    end: opts.end,
  });
  return decision.reusable ? rows : [];
}

export function readFundMoneyYieldRows(
  code: string,
  opts: { start?: string; end?: string; minRows?: number; limit?: number } = {},
): FundMoneyYieldRow[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM fund_money_yield WHERE code = ?";
  if (opts.start) {
    sql += " AND date >= ?";
    params.push(opts.start);
  }
  if (opts.end) {
    sql += " AND date <= ?";
    params.push(opts.end);
  }
  sql += " ORDER BY date ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params) as unknown as FundMoneyYieldRow[];
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    earliestDate: rows[0]?.date,
    latestDate: rows[rows.length - 1]?.date,
    start: opts.start,
    end: opts.end,
  });
  return decision.reusable ? rows : [];
}

export function readFundDividendFactorRows(
  code: string,
  opts: { start?: string; end?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM fund_dividend_factor WHERE code = ?";
  if (opts.start) {
    sql += " AND event_date >= ?";
    params.push(opts.start);
  }
  if (opts.end) {
    sql += " AND event_date <= ?";
    params.push(opts.end);
  }
  sql += " ORDER BY event_date ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params);
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    earliestDate: rows[0]?.event_date == null ? undefined : String(rows[0].event_date),
    latestDate: rows[rows.length - 1]?.event_date == null ? undefined : String(rows[rows.length - 1].event_date),
    start: opts.start,
    end: opts.end,
  });
  return decision.reusable ? rows : [];
}

export function readIntradayOhlcvRows(
  code: string,
  opts: { start?: string; end?: string; intervalMinutes?: number; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM intraday_ohlcv_bars WHERE code = ?";
  if (opts.start) {
    sql += " AND bar_time >= ?";
    params.push(opts.start);
  }
  if (opts.end) {
    sql += " AND bar_time <= ?";
    params.push(opts.end);
  }
  if (opts.intervalMinutes) {
    sql += " AND interval_minutes = ?";
    params.push(opts.intervalMinutes);
  }
  sql += " ORDER BY bar_time ASC";
  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }
  const rows = query(sql, params);
  const decision = shouldReuseKlineCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    earliestDate: rows[0]?.bar_time == null ? undefined : String(rows[0].bar_time),
    latestDate: rows[rows.length - 1]?.bar_time == null ? undefined : String(rows[rows.length - 1].bar_time),
    start: opts.start,
    end: opts.end,
  });
  return decision.reusable ? rows : [];
}

export function readFundHoldingRows(
  fundCode: string,
  opts: { reportDate?: string; minRows?: number; limit?: number } = {},
): FundHoldingRow[] {
  const params: unknown[] = [fundCode];
  let sql = "SELECT * FROM fund_holding WHERE fund_code = ?";
  if (opts.reportDate) {
    sql += " AND report_date = ?";
    params.push(opts.reportDate);
  }
  sql += " ORDER BY report_date DESC, rank ASC LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params).map(mapFundHolding);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "fund holding",
  });
  return decision.reusable ? rows : [];
}

export function readFundManagerRows(
  opts: { minRows?: number; limit?: number } = {},
): FundManagerRow[] {
  const rows = query(
    "SELECT * FROM fund_manager ORDER BY total_size DESC, updated_at DESC LIMIT ?",
    [opts.limit ?? 100],
  ).map(mapFundManager);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 20,
    label: "fund manager",
  });
  return decision.reusable ? rows : [];
}

export function readMoneyFlowRows(
  code: string,
  opts: { minRows?: number; limit?: number } = {},
): MoneyFlowRow[] {
  const rows = query(
    "SELECT * FROM money_flow WHERE code = ? ORDER BY date DESC LIMIT ?",
    [code, opts.limit ?? 30],
  ).map(mapMoneyFlow);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "money flow",
  });
  return decision.reusable ? rows : [];
}

export function readSectorRankingRows(
  type = "industry",
  opts: { date?: string; minRows?: number; limit?: number } = {},
): SectorRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM sector_ranking WHERE sector_type = ?";
  params.push(type);
  if (opts.date) {
    sql += " AND date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY date DESC, rank ASC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapSector);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 10,
    label: "sector ranking",
  });
  return decision.reusable ? rows : [];
}

export function readSectorConstituentRows(
  sectorName: string,
  opts: { minRows?: number; limit?: number } = {},
): Quote[] {
  const name = sectorName.trim();
  if (!name) return [];
  const mappings = query(
    `SELECT * FROM industry_map
      WHERE industry_l1 = ? OR industry_l2 = ? OR industry_l3 = ?
      ORDER BY updated_at DESC, code LIMIT ?`,
    [name, name, name, opts.limit ?? 100],
  );
  const quotes: Quote[] = [];
  for (const mapping of mappings) {
    const quote = one(
      "SELECT * FROM quote_snapshot WHERE code = ? ORDER BY timestamp DESC, fetched_at DESC LIMIT 1",
      [String(mapping.code ?? "")],
    );
    if (!quote) continue;
    quotes.push(mapQuoteToProviderQuote(mapQuote(quote)));
  }
  const decision = shouldReuseRowCountCache({
    rowCount: quotes.length,
    minRows: opts.minRows ?? 1,
    label: "sector constituents",
  });
  return decision.reusable ? quotes : [];
}

export function readLimitPoolRows(
  type: "up" | "down",
  opts: { date?: string; minRows?: number } = {},
): LimitItem[] {
  const params: unknown[] = [type];
  let sql = "SELECT * FROM limit_pool WHERE limit_type = ?";
  if (opts.date) {
    sql += " AND date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY date DESC, fetched_at DESC, change_pct DESC LIMIT 100";
  const rows = query(sql, params).map(mapLimitPool);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: `limit-${type} pool`,
  });
  return decision.reusable ? rows : [];
}

export function readNorthboundFlowRows(
  opts: { date?: string; minRows?: number; limit?: number } = {},
): NorthboundRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM northbound_flow WHERE 1=1";
  if (opts.date) {
    sql += " AND trade_date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY trade_date DESC LIMIT ?";
  params.push(opts.limit ?? 30);
  const rows = query(sql, params).map(mapNorthboundFlow);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "northbound flow",
  });
  return decision.reusable ? rows : [];
}

export function readNorthboundHoldingRows(
  opts: { code?: string; date?: string; minRows?: number; limit?: number } = {},
): NorthboundHoldingItem[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM northbound_holding WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.date) {
    sql += " AND trade_date = ?";
    params.push(opts.date);
  }
  sql +=
    " ORDER BY trade_date DESC, fetched_at DESC, hold_market_cap DESC LIMIT ?";
  params.push(opts.limit ?? 30);
  const rows = query(sql, params).map(mapNorthboundHolding);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "northbound holding",
  });
  return decision.reusable ? rows : [];
}

export function readHotRankRows(
  opts: { code?: string; date?: string; minRows?: number; limit?: number } = {},
): HotRankItem[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM hot_rank WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.date) {
    sql += " AND date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY date DESC, rank ASC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapHotRank);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "hot rank",
  });
  return decision.reusable ? rows : [];
}

export function readDragonTigerRows(
  opts: { code?: string; date?: string; minRows?: number; limit?: number } = {},
): DragonTigerItem[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM dragon_tiger WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.date) {
    sql += " AND date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY date DESC, code LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapDragonTiger);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "dragon tiger",
  });
  return decision.reusable ? rows : [];
}

export function readUnusualActivityRows(
  opts: { code?: string; date?: string; minRows?: number; limit?: number } = {},
): UnusualActivityItem[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM unusual_activity WHERE 1=1";
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.date) {
    sql += " AND event_date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY event_date DESC, fetched_at DESC, event_time DESC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapUnusualActivity);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "unusual activity",
  });
  return decision.reusable ? rows : [];
}

export function readFlowRankRows(
  opts: {
    period?: string;
    code?: string;
    date?: string;
    minRows?: number;
    limit?: number;
  } = {},
): FlowRankItem[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM flow_rank WHERE 1=1";
  if (opts.period) {
    sql += " AND period = ?";
    params.push(opts.period);
  }
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.date) {
    sql += " AND trade_date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY trade_date DESC, fetched_at DESC, main_net DESC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapFlowRank);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "flow rank",
  });
  return decision.reusable ? rows : [];
}

export function readFundamentalRows(
  code: string,
  opts: { minRows?: number; limit?: number } = {},
): FundamentalRow[] {
  const rows = query(
    "SELECT * FROM fundamental WHERE code = ? ORDER BY report_date DESC LIMIT ?",
    [code, opts.limit ?? 8],
  ).map(mapFundamental);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "daily valuation",
  });
  return decision.reusable ? rows : [];
}

export function readChipDistributionRows(
  code: string,
  opts: { date?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM chip_distribution WHERE code = ?";
  if (opts.date) {
    sql += " AND trade_date = ?";
    params.push(opts.date);
  }
  sql += " ORDER BY trade_date DESC, fetched_at DESC LIMIT ?";
  params.push(opts.limit ?? 20);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "chip distribution",
  });
  return decision.reusable ? rows : [];
}

export function readTickChartRows(
  code: string,
  opts: { tradeDate?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM tick_chart_intraday WHERE code = ?";
  if (opts.tradeDate) {
    sql += " AND trade_date = ?";
    params.push(opts.tradeDate);
  }
  sql += " ORDER BY trade_date DESC, time ASC LIMIT ?";
  params.push(opts.limit ?? 240);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "tick chart intraday",
  });
  return decision.reusable ? rows : [];
}

export function readTransactionRows(
  code: string,
  opts: { tradeDate?: string; minRows?: number; limit?: number; source?: string } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM transactions WHERE code = ?";
  if (opts.tradeDate) {
    sql += " AND trade_date = ?";
    params.push(opts.tradeDate);
  }
  if (opts.source) {
    sql += " AND source = ?";
    params.push(opts.source);
  }
  sql += " ORDER BY trade_date DESC, time ASC LIMIT ?";
  params.push(opts.limit ?? 500);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "transactions",
  });
  return decision.reusable ? rows : [];
}

export function readVolumeProfileRows(
  code: string,
  opts: { tradeDate?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM volume_profile WHERE code = ?";
  if (opts.tradeDate) {
    sql += " AND trade_date = ?";
    params.push(opts.tradeDate);
  }
  sql += " ORDER BY trade_date DESC, price ASC LIMIT ?";
  params.push(opts.limit ?? 200);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "volume profile",
  });
  return decision.reusable ? rows : [];
}

export function readXdxrRows(
  code: string,
  opts: { eventDate?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM xdxr_event WHERE code = ?";
  if (opts.eventDate) {
    sql += " AND event_date = ?";
    params.push(opts.eventDate);
  }
  sql += " ORDER BY event_date DESC, category LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "xdxr events",
  });
  return decision.reusable ? rows : [];
}

export function readAuctionRows(
  code: string,
  opts: { tradeDate?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM auction_snapshot WHERE code = ?";
  if (opts.tradeDate) {
    sql += " AND trade_date = ?";
    params.push(opts.tradeDate);
  }
  sql += " ORDER BY trade_date DESC, sequence ASC LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "auction snapshot",
  });
  return decision.reusable ? rows : [];
}

export function readCompanyInfoRows(
  code: string,
  opts: { infoType?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM stock_company_info WHERE code = ?";
  if (opts.infoType) {
    sql += " AND info_type = ?";
    params.push(opts.infoType);
  }
  sql += " ORDER BY updated_at DESC, info_type, title LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "company info",
  });
  return decision.reusable ? rows : [];
}

export function readTdxBlockMemberRows(
  opts: {
    blockCode?: string;
    code?: string;
    blockType?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM tdx_block_member WHERE 1=1";
  if (opts.blockCode) {
    sql += " AND block_code = ?";
    params.push(opts.blockCode);
  }
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  if (opts.blockType) {
    sql += " AND block_type = ?";
    params.push(opts.blockType);
  }
  sql += " ORDER BY updated_at DESC, block_code, code LIMIT ?";
  params.push(opts.limit ?? 500);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "TDX block member",
  });
  return decision.reusable ? rows : [];
}

export function readProviderCoverageRows(
  opts: {
    scope?: string;
    code?: string;
    market?: string;
    category?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const limit = opts.limit ?? 100;
  const countParams: unknown[] = [];
  let countSql = "SELECT * FROM tdx_security_count WHERE 1=1";
  if (opts.scope) {
    countSql += " AND scope = ?";
    countParams.push(opts.scope);
  }
  if (opts.market) {
    countSql += " AND market = ?";
    countParams.push(opts.market);
  }
  countSql += " ORDER BY fetched_at DESC LIMIT ?";
  countParams.push(limit);

  const samplingParams: unknown[] = [];
  let samplingSql = "SELECT * FROM tdx_chart_sampling WHERE 1=1";
  if (opts.scope) {
    samplingSql += " AND scope = ?";
    samplingParams.push(opts.scope);
  }
  if (opts.code) {
    samplingSql += " AND code = ?";
    samplingParams.push(opts.code);
  }
  if (opts.market) {
    samplingSql += " AND market = ?";
    samplingParams.push(opts.market);
  }
  if (opts.category) {
    samplingSql += " AND category = ?";
    samplingParams.push(opts.category);
  }
  samplingSql += " ORDER BY fetched_at DESC, sequence ASC LIMIT ?";
  samplingParams.push(limit);

  const rows = [
    ...query(countSql, countParams).map((row) => ({
      ...row,
      metadata_type: "security_count",
    })),
    ...query(samplingSql, samplingParams).map((row) => ({
      ...row,
      metadata_type: "chart_sampling",
    })),
  ];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "provider coverage",
  });
  return decision.reusable ? rows : [];
}

export function readProviderTableMetadataRows(
  opts: {
    code?: string;
    category?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const limit = opts.limit ?? 100;
  const categoryRows = query(
    "SELECT * FROM ex_category ORDER BY category LIMIT ?",
    [limit],
  ).map((row) => ({ ...row, metadata_type: "ex_category" }));
  const entryParams: unknown[] = [];
  let entrySql = "SELECT * FROM ex_table_entry WHERE 1=1";
  if (opts.code) {
    entrySql += " AND code = ?";
    entryParams.push(opts.code);
  }
  if (opts.category) {
    entrySql += " AND category = ?";
    entryParams.push(opts.category);
  }
  entrySql += " ORDER BY updated_at DESC, category, code LIMIT ?";
  entryParams.push(limit);
  const entryRows = query(entrySql, entryParams).map((row) => ({
    ...row,
    metadata_type: "ex_table_entry",
  }));
  const rows = [...categoryRows, ...entryRows];
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "provider table metadata",
  });
  return decision.reusable ? rows : [];
}

export function readTdxTopBoardRows(
  opts: {
    boardDate?: string;
    category?: string;
    side?: string;
    code?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM tdx_top_board WHERE 1=1";
  if (opts.boardDate) {
    sql += " AND board_date = ?";
    params.push(opts.boardDate);
  }
  if (opts.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.side) {
    sql += " AND side = ?";
    params.push(opts.side);
  }
  if (opts.code) {
    sql += " AND code = ?";
    params.push(opts.code);
  }
  sql += " ORDER BY board_date DESC, category, side, rank LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "TDX top board",
  });
  return decision.reusable ? rows : [];
}

export function readIndexMomentumRows(
  code: string,
  opts: { tradeDate?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [code];
  let sql = "SELECT * FROM tdx_index_momentum WHERE code = ?";
  if (opts.tradeDate) {
    sql += " AND trade_date = ?";
    params.push(opts.tradeDate);
  }
  sql += " ORDER BY trade_date DESC, sequence ASC LIMIT ?";
  params.push(opts.limit ?? 200);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "index momentum",
  });
  return decision.reusable ? rows : [];
}

export function readEtfQuoteRows(
  opts: { minRows?: number; limit?: number; maxAgeMs?: number; stockType?: string; label?: string } = {},
): EtfQuoteFetchResult | null {
  const limit = opts.limit ?? 80;
  const stockType = opts.stockType ?? "etf";
  const label = opts.label ?? (stockType === "etf" ? "ETF" : stockType);
  const stocks = query(
    "SELECT * FROM stock_list WHERE stock_type = ? AND delist_date IS NULL ORDER BY code LIMIT ?",
    [stockType, limit],
  ).map(mapStockInfo);
  if (
    !shouldReuseRowCountCache({
      rowCount: stocks.length,
      minRows: opts.minRows ?? 1,
      label: `${label} identity`,
    }).reusable
  ) {
    return null;
  }

  const quotes: QuoteSnapshotRow[] = [];
  const usableStocks: StockInfo[] = [];
  for (const stock of stocks) {
    const quote = readRecentQuoteSnapshot(stock.code, opts.maxAgeMs ?? 30_000);
    if (!quote) continue;
    quotes.push(quote);
    usableStocks.push(stock);
  }
  if (
    !shouldReuseRowCountCache({
      rowCount: quotes.length,
      minRows: opts.minRows ?? 1,
      label: `${label} quote`,
    }).reusable
  ) {
    return null;
  }
  return { stocks: usableStocks, quotes };
}

export function readWindEconomicSeriesRows(
  opts: { metricQuery?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM wind_economic_series WHERE 1=1";
  if (opts.metricQuery) {
    sql += " AND metric_query = ?";
    params.push(opts.metricQuery);
  }
  sql += " ORDER BY date DESC, metric_name LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "Wind economic series",
  });
  return decision.reusable ? rows : [];
}

export function readWindDocumentRows(
  opts: {
    query?: string;
    tool?: string;
    code?: string;
    minRows?: number;
    limit?: number;
  } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM wind_document WHERE 1=1";
  if (opts.query) {
    sql += " AND query = ?";
    params.push(opts.query);
  }
  if (opts.tool) {
    sql += " AND tool = ?";
    params.push(opts.tool);
  }
  if (opts.code) {
    sql += " AND entity_code = ?";
    params.push(opts.code);
  }
  sql += " ORDER BY published_at DESC, updated_at DESC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "Wind financial documents",
  });
  return decision.reusable ? rows : [];
}

export function readWindAnalyticsRows(
  opts: { question?: string; minRows?: number; limit?: number } = {},
): Row[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM wind_analytics_result WHERE 1=1";
  if (opts.question) {
    sql += " AND question = ?";
    params.push(opts.question);
  }
  sql += " ORDER BY value_date DESC, updated_at DESC LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "Wind analytics result",
  });
  return decision.reusable ? rows : [];
}

export function readFinanceNewsRows(
  opts: {
    keyword?: string;
    source?: string;
    minRows?: number;
    limit?: number;
    maxAgeMs?: number;
    nowMs?: number;
  } = {},
): FinanceNewsRow[] {
  const params: unknown[] = [];
  let sql = "SELECT * FROM finance_news WHERE published_at IS NOT NULL";
  if (opts.source) {
    sql += " AND source = ?";
    params.push(opts.source);
  }
  if (opts.keyword) {
    sql += " AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)";
    const pattern = `%${opts.keyword}%`;
    params.push(pattern, pattern, pattern);
  }
  sql += " ORDER BY published_at DESC, fetched_at DESC LIMIT ?";
  params.push(opts.limit ?? 50);
  const rows = query(sql, params).map(mapFinanceNews);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "finance news",
  });
  if (!decision.reusable) return [];
  const newest = rows[0]?.published_at;
  if (!newest) return [];
  const sourceMs = Date.parse(newest);
  if (!Number.isFinite(sourceMs)) return [];
  const nowMs = opts.nowMs ?? Date.now();
  if (sourceMs > nowMs + 60_000) return [];
  if (nowMs - sourceMs > (opts.maxAgeMs ?? 30 * 60_000)) return [];
  return rows;
}

export function readYfinanceNewsRows(
  symbol: string,
  opts: {
    minRows?: number;
    limit?: number;
    maxAgeMs?: number;
    nowMs?: number;
  } = {},
): Row[] {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const rows = query(
    `SELECT * FROM yfinance_news
      WHERE symbol = ? AND published_at IS NOT NULL
      ORDER BY published_at DESC, updated_at DESC LIMIT ?`,
    [normalized, opts.limit ?? 50],
  );
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "Yahoo finance news",
  });
  if (!decision.reusable) return [];
  const newest = String(rows[0]?.published_at ?? "");
  const sourceMs = Date.parse(newest);
  if (!Number.isFinite(sourceMs)) return [];
  const nowMs = opts.nowMs ?? Date.now();
  if (sourceMs > nowMs + 60_000) return [];
  if (nowMs - sourceMs > (opts.maxAgeMs ?? 12 * 60 * 60_000)) return [];
  return rows;
}

export function readYfinanceOptionRows(
  symbol: string,
  opts: { expiry?: string; minRows?: number; limit?: number } = {},
): {
  expiries: string[];
  selectedExpiry: string | null;
  contracts: Row[];
} | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  const expiries = query(
    "SELECT * FROM yfinance_option_expiries WHERE symbol = ? ORDER BY expiry_date DESC LIMIT ?",
    [normalized, opts.limit ?? 50],
  );
  const selectedExpiry = opts.expiry ?? String(expiries[0]?.expiry_date ?? "");
  const params: unknown[] = [normalized];
  let sql = "SELECT * FROM yfinance_option_contracts WHERE symbol = ?";
  if (selectedExpiry) {
    sql += " AND expiry_date = ?";
    params.push(selectedExpiry);
  }
  sql += " ORDER BY expiry_date DESC, option_type, strike LIMIT ?";
  params.push(opts.limit ?? 100);
  const contracts = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: expiries.length + contracts.length,
    minRows: opts.minRows ?? 1,
    label: "Yahoo options",
  });
  return decision.reusable
    ? {
        expiries: expiries.map((row) => String(row.expiry_date)),
        selectedExpiry: selectedExpiry || null,
        contracts,
      }
    : null;
}

export function readYfinanceCorporateActionRows(
  symbol: string,
  opts: { minRows?: number; limit?: number; actionType?: string } = {},
): Row[] {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const params: unknown[] = [normalized];
  let where = "WHERE symbol = ?";
  if (opts.actionType) {
    where += " AND action_type = ?";
    params.push(opts.actionType);
  }
  const rows = query(
    `SELECT * FROM yfinance_corporate_actions
      ${where}
      ORDER BY action_date DESC, action_type LIMIT ?`,
    [...params, opts.limit ?? 100],
  );
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: "Yahoo corporate actions",
  });
  return decision.reusable ? rows : [];
}

export type YfinanceResearchDataset =
  | "profile"
  | "statements"
  | "income_statement"
  | "balance_sheet"
  | "cash_flow"
  | "earnings_calendar"
  | "earnings_history"
  | "earnings_estimates"
  | "eps_revisions"
  | "eps_trend"
  | "quarterly_financial_statements"
  | "quarterly_income_statement"
  | "quarterly_balance_sheet"
  | "quarterly_cash_flow"
  | "recommendations"
  | "upgrade_downgrade_events"
  | "holders"
  | "major_holders"
  | "institutional_holders"
  | "mutualfund_holders"
  | "mutual_fund_holders"
  | "insiders";

export function readYfinanceResearchRows(
  symbol: string,
  dataset: YfinanceResearchDataset,
  opts: { minRows?: number; limit?: number; statementType?: string } = {},
): Row[] {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const limit = opts.limit ?? 100;
  const params: unknown[] = [normalized];
  const specs: Record<
    YfinanceResearchDataset,
    { table: string; order: string; label: string; extraWhere?: string }
  > = {
    profile: {
      table: "yfinance_profile_fields",
      order: "updated_at DESC, field_key",
      label: "Yahoo profile",
    },
    statements: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      label: "Yahoo statements",
      extraWhere: opts.statementType ? " AND statement_type = ?" : undefined,
    },
    income_statement: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo income statement",
      extraWhere: " AND statement_type = 'income'",
    },
    balance_sheet: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo balance sheet",
      extraWhere: " AND statement_type = 'balance_sheet'",
    },
    cash_flow: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo cash flow",
      extraWhere: " AND statement_type = 'cash_flow'",
    },
    earnings_calendar: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      label: "Yahoo earnings calendar",
      extraWhere:
        " AND statement_type IN ('earnings_dates', 'earnings_history')",
    },
    earnings_history: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo earnings history",
      extraWhere: " AND statement_type = 'earnings_history'",
    },
    earnings_estimates: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo earnings estimates",
      extraWhere: " AND statement_type = 'earnings_estimate'",
    },
    eps_revisions: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo EPS revisions",
      extraWhere: " AND statement_type = 'eps_revisions'",
    },
    eps_trend: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo EPS trend",
      extraWhere: " AND statement_type = 'eps_trend'",
    },
    quarterly_financial_statements: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      label: "Yahoo quarterly statements",
      extraWhere:
        " AND statement_type IN ('quarterly_financials', 'quarterly_income_stmt', 'quarterly_balance_sheet', 'quarterly_balancesheet', 'quarterly_cash_flow', 'quarterly_cashflow')",
    },
    quarterly_income_statement: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo quarterly income statement",
      extraWhere: " AND statement_type = 'quarterly_income_stmt'",
    },
    quarterly_balance_sheet: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo quarterly balance sheet",
      extraWhere:
        " AND statement_type IN ('quarterly_balance_sheet', 'quarterly_balancesheet')",
    },
    quarterly_cash_flow: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      label: "Yahoo quarterly cash flow",
      extraWhere:
        " AND statement_type IN ('quarterly_cash_flow', 'quarterly_cashflow')",
    },
    recommendations: {
      table: "yfinance_recommendations",
      order: "updated_at DESC, period",
      label: "Yahoo recommendations",
    },
    upgrade_downgrade_events: {
      table: "yfinance_recommendations",
      order: "updated_at DESC, period",
      label: "Yahoo upgrade/downgrade events",
    },
    holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_type, holder_name",
      label: "Yahoo holders",
    },
    major_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      label: "Yahoo major holders",
      extraWhere: " AND holder_type = 'major_holders'",
    },
    institutional_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      label: "Yahoo institutional holders",
      extraWhere:
        " AND holder_type IN ('institutional_holders', 'institutional')",
    },
    mutualfund_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      label: "Yahoo mutual fund holders",
      extraWhere: " AND holder_type IN ('mutualfund_holders', 'fund')",
    },
    mutual_fund_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      label: "Yahoo mutual fund holders",
      extraWhere: " AND holder_type IN ('mutualfund_holders', 'fund')",
    },
    insiders: {
      table: "yfinance_insider_transactions",
      order: "start_date DESC, insider",
      label: "Yahoo insider transactions",
    },
  };
  const spec = specs[dataset];
  let sql = `SELECT * FROM ${spec.table} WHERE symbol = ?`;
  if (spec.extraWhere) {
    sql += spec.extraWhere;
    if (dataset === "statements" && opts.statementType)
      params.push(opts.statementType);
  }
  sql += ` ORDER BY ${spec.order} LIMIT ?`;
  params.push(limit);
  const rows = query(sql, params);
  const decision = shouldReuseRowCountCache({
    rowCount: rows.length,
    minRows: opts.minRows ?? 1,
    label: spec.label,
  });
  return decision.reusable ? rows : [];
}

function query(sql: string, params: unknown[]): Row[] {
  const db = getDbSync();
  if (!db) return [];
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Row[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as Row);
  } finally {
    stmt.free();
  }
  return rows;
}

function one(sql: string, params: unknown[]): Row | null {
  return query(sql, params)[0] ?? null;
}

function mapFinanceNews(row: Row): FinanceNewsRow {
  return {
    news_id: String(row.news_id),
    title: row.title == null ? null : String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    content: row.content == null ? null : String(row.content),
    publisher: row.publisher == null ? null : String(row.publisher),
    published_at: row.published_at == null ? null : String(row.published_at),
    url: row.url == null ? null : String(row.url),
    source: String(row.source ?? "local"),
    fetched_at: String(row.fetched_at ?? ""),
    raw_json: row.raw_json == null ? null : String(row.raw_json),
  };
}

function mapQuote(row: Row): QuoteSnapshotRow {
  return {
    code: String(row.code),
    timestamp: row.timestamp == null ? undefined : String(row.timestamp),
    fetched_at: row.fetched_at == null ? null : String(row.fetched_at),
    source: String(row.source),
    name: row.name == null ? null : String(row.name),
    price: numOrNull(row.price),
    change: numOrNull(row.change),
    change_pct: numOrNull(row.change_pct),
    open: numOrNull(row.open),
    high: numOrNull(row.high),
    low: numOrNull(row.low),
    prev_close: numOrNull(row.prev_close),
    volume: numOrNull(row.volume),
    amount: numOrNull(row.amount),
    pe: numOrNull(row.pe),
    pb: numOrNull(row.pb),
    market_cap: numOrNull(row.market_cap),
    turnover_rate: numOrNull(row.turnover_rate),
    raw_json: row.raw_json == null ? null : String(row.raw_json),
  };
}

function mapQuoteToProviderQuote(row: QuoteSnapshotRow): Quote {
  return {
    code: row.code,
    name: row.name ?? row.code,
    price: row.price ?? 0,
    change: row.change ?? 0,
    changePct: row.change_pct ?? 0,
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    prevClose: row.prev_close ?? 0,
    volume: row.volume ?? 0,
    amount: row.amount ?? 0,
    pe: row.pe ?? null,
    pb: row.pb ?? null,
    marketCap: row.market_cap ?? null,
    turnoverRate: row.turnover_rate ?? null,
    source: row.source,
    timestamp: row.timestamp ?? null,
    fetchedAt: row.fetched_at,
  };
}

function mapKline(row: Row): KlineRow {
  return {
    code: String(row.code),
    date: String(row.date),
    open: Number(row.open ?? 0),
    high: Number(row.high ?? 0),
    low: Number(row.low ?? 0),
    close: Number(row.close ?? 0),
    volume: numOrNull(row.volume),
    amount: numOrNull(row.amount),
    change_pct: numOrNull(row.change_pct),
    turnover_rate: numOrNull(row.turnover_rate),
    adjust: String(row.adjust ?? "qfq"),
    source: row.source == null ? null : String(row.source),
  };
}

function mapStockInfo(row: Row): StockInfo {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    market: row.market == null ? "" : String(row.market),
    industry: row.industry == null ? null : String(row.industry),
    list_date: row.list_date == null ? null : String(row.list_date),
    delist_date: row.delist_date == null ? null : String(row.delist_date),
    stock_type: row.stock_type == null ? "stock" : String(row.stock_type),
    updated_at: row.updated_at == null ? "" : String(row.updated_at),
  };
}

function mapFundInfo(row: Row): FundInfo {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    fund_type: row.fund_type == null ? null : String(row.fund_type),
    company: row.company == null ? null : String(row.company),
    manager: row.manager == null ? null : String(row.manager),
    setup_date: row.setup_date == null ? null : String(row.setup_date),
    total_size: numOrNull(row.total_size),
    nav: numOrNull(row.nav),
    nav_date: row.nav_date == null ? null : String(row.nav_date),
    return_1y: numOrNull(row.return_1y),
    return_3y: numOrNull(row.return_3y),
    return_ytd: numOrNull(row.return_ytd),
    updated_at: row.updated_at == null ? "" : String(row.updated_at),
  };
}

function mapCalendar(row: Row): CalendarRow {
  return {
    date: String(row.date),
    market: String(row.market ?? "CN"),
    is_trading_day: Number(row.is_trading_day ?? 0),
    year: Number(row.year ?? String(row.date).substring(0, 4)),
    month: Number(row.month ?? String(row.date).substring(5, 7)),
  };
}

function mapFundNav(row: Row): FundNavRow {
  return {
    code: String(row.code),
    date: String(row.date),
    nav: Number(row.nav ?? 0),
    acc_nav: numOrNull(row.acc_nav),
    daily_return: numOrNull(row.daily_return),
    source: String(row.source ?? "local"),
  };
}

function mapFundHolding(row: Row): FundHoldingRow {
  return {
    fund_code: String(row.fund_code),
    report_date: String(row.report_date),
    stock_code: String(row.stock_code),
    stock_name: String(row.stock_name ?? ""),
    hold_shares: numOrNull(row.hold_shares),
    hold_value: numOrNull(row.hold_value),
    hold_pct: numOrNull(row.hold_pct),
    rank: Number(row.rank ?? 0),
    source: String(row.source ?? "local"),
  };
}

function mapFundManager(row: Row): FundManagerRow {
  return {
    manager_id: String(row.manager_id),
    name: String(row.name ?? ""),
    company: row.company == null ? null : String(row.company),
    start_date: row.start_date == null ? null : String(row.start_date),
    total_size: numOrNull(row.total_size),
    fund_count: numOrNull(row.fund_count),
    best_return: numOrNull(row.best_return),
    experience_years: numOrNull(row.experience_years),
    updated_at: row.updated_at == null ? "" : String(row.updated_at),
    source: String(row.source ?? "local"),
  };
}

function mapMoneyFlow(row: Row): MoneyFlowRow {
  return {
    code: String(row.code),
    date: String(row.date),
    main_net: Number(row.main_net ?? 0),
    small_net: Number(row.small_net ?? 0),
    medium_net: Number(row.medium_net ?? 0),
    large_net: Number(row.large_net ?? 0),
    super_large_net: Number(row.super_large_net ?? 0),
    close_price: numOrNull(row.close_price),
    change_pct: numOrNull(row.change_pct),
    source: String(row.source ?? "local"),
  };
}

function mapSector(row: Row): SectorRow {
  return {
    date: String(row.date),
    sector_type: String(row.sector_type),
    code: String(row.code),
    name: String(row.name ?? ""),
    change_pct: Number(row.change_pct ?? 0),
    turnover_rate: numOrNull(row.turnover_rate),
    up_count: Number(row.up_count ?? 0),
    down_count: Number(row.down_count ?? 0),
    leading_stock: row.leading_stock == null ? null : String(row.leading_stock),
    leading_pct: numOrNull(row.leading_pct),
    rank: Number(row.rank ?? 0),
    source: String(row.source ?? "local"),
  };
}

function mapLimitPool(row: Row): LimitItem {
  return {
    date: String(row.date),
    code: String(row.code),
    name: String(row.name ?? ""),
    limit_type: String(row.limit_type) === "down" ? "down" : "up",
    change_pct: Number(row.change_pct ?? 0),
    first_limit_time:
      row.first_limit_time == null ? null : String(row.first_limit_time),
    last_limit_time:
      row.last_limit_time == null ? null : String(row.last_limit_time),
    open_count: Number(row.open_count ?? 0),
    limit_reason: row.limit_reason == null ? null : String(row.limit_reason),
    continuous_days: Number(row.continuous_days ?? 0),
    source: String(row.source ?? "local"),
  };
}

function mapNorthboundFlow(row: Row): NorthboundRow {
  return {
    trade_date: String(row.trade_date),
    mutual_type: String(row.mutual_type ?? "northbound"),
    buy_amount: numOrNull(row.buy_amount),
    sell_amount: numOrNull(row.sell_amount),
    net_buy: numOrNull(row.net_buy),
    hold_market_cap: numOrNull(row.hold_market_cap),
    source: String(row.source ?? "local"),
  };
}

function mapNorthboundHolding(row: Row): NorthboundHoldingItem {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    tradeDate: String(row.trade_date),
    holdMarketCap: Number(row.hold_market_cap ?? 0),
    holdRatio: Number(row.hold_ratio ?? 0),
  };
}

function mapHotRank(row: Row): HotRankItem {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    rank: Number(row.rank ?? 0),
    rankChange: numOrNull(row.rank_change),
    hotValue: numOrNull(row.heat),
  };
}

function mapDragonTiger(row: Row): DragonTigerItem {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    tradeDate: String(row.date ?? ""),
    accumAmount: Number(row.accum_amount ?? 0),
    buyAmt: Number(row.buy_amt ?? 0),
    sellAmt: Number(row.sell_amt ?? 0),
    netAmt: Number(row.net_amt ?? 0),
    reason: String(row.reason ?? ""),
  };
}

function mapUnusualActivity(row: Row): UnusualActivityItem {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    price: 0,
    changePct: 0,
    type: String(row.event_type ?? ""),
    time: String(row.event_time ?? ""),
    description: row.info == null ? undefined : String(row.info),
  };
}

function mapFlowRank(row: Row): FlowRankItem {
  return {
    code: String(row.code),
    name: String(row.name ?? ""),
    mainNetInflow: Number(row.main_net ?? 0),
    changePct: Number(row.main_pct ?? 0),
  };
}

function mapFundamental(row: Row): FundamentalRow {
  return {
    ...row,
    code: String(row.code),
    report_date: String(row.report_date),
    pe_ttm: numOrNull(row.pe_ttm),
    pb: numOrNull(row.pb),
    roe: numOrNull(row.roe),
    revenue_yoy: numOrNull(row.revenue_yoy),
    profit_yoy: numOrNull(row.profit_yoy),
    market_cap: numOrNull(row.market_cap),
  };
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
