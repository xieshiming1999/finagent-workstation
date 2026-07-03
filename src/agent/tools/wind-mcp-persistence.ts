import type { ToolContext } from "../tool";
import { DataStore, type StockInfo } from "../data/store/data-store";
import {
  parseWindPayload,
  windAnalyticsRows,
  windCompanyInfoRows,
  windCorporateActionRows,
  windDocumentRows,
  windEconomicSeriesRows,
  windFinanceNewsRows,
  windFundHoldingRows,
  windFundManagerRows,
  windFundPerformanceRows,
  windGlobalHolderRows,
  windGlobalNewsRows,
  windGlobalProfileRows,
  windGlobalRecommendationRows,
  windGlobalStatementRows,
  windIndexMomentumRows,
  windKlineRows,
  windMoneyFlowRows,
  windScreeningRows,
  windStockShareholderRows,
  windStockFundamentals,
  windStockQuoteSnapshots,
  windTechnicalIndicatorRows,
  windXdxrEventRows,
} from "../data/normalizers/wind-normalizer";
import { normalizeScreeningSnapshot } from "../data/normalizers/screening-normalizer";

export function persistWindResult(
  store: DataStore,
  _ctx: ToolContext,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  result: string,
): void {
  const parsed = parseWindPayload(result);
  if (!parsed) return;
  try {
    if (server === "financial_docs") {
      const rows = windDocumentRows(parsed, tool, String(args.query ?? ""));
      if (rows.length > 0) store.saveWindDocuments(rows);
      if (tool === "get_financial_news") {
        const financeNewsRows = windFinanceNewsRows(parsed, String(args.query ?? ""));
        if (financeNewsRows.length > 0) store.saveFinanceNews(financeNewsRows);
        const newsRows = windGlobalNewsRows(parsed, String(args.windcode ?? ""));
        if (newsRows.length > 0) store.saveYfinanceNews(newsRows);
      }
      return;
    }
    if (server === "economic_data") {
      const rows = windEconomicSeriesRows(parsed, String(args.metricIdsStr ?? ""));
      if (rows.length > 0) store.saveWindEconomicSeries(rows);
      return;
    }
    if (server === "analytics_data") {
      const rows = windAnalyticsRows(parsed, String(args.question ?? ""));
      if (rows.length > 0) store.saveWindAnalyticsResults(rows);
      return;
    }
    if (server === "stock_data" && tool === "search_stocks") {
      persistWindScreening(store, parsed, args, "search_stocks", "stock");
      return;
    }
    if (server === "fund_data" && tool === "search_funds") {
      persistWindScreening(store, parsed, args, "search_funds", "fund");
      return;
    }
    if (!isPersistableWindMarketServer(server)) return;
    if (isWindKlineTool(tool) && isDailyWindKlineArgs(args)) {
      const rows = windKlineRows(parsed, String(args.windcode ?? ""), windAdjust(args));
      if (rows.length > 0) store.saveKline(rows);
      return;
    }
    if (isWindQuoteTool(tool)) {
      const snapshots = windStockQuoteSnapshots(parsed, String(args.windcode ?? ""));
      if (snapshots.length > 0) {
        store.saveQuoteSnapshots(snapshots);
        const stockRows = snapshots
          .map((row) => windStockListRow(server, String(args.windcode ?? ""), row))
          .filter((row): row is StockInfo => !!row);
        if (stockRows.length > 0) store.saveStockList(stockRows);
      }
      return;
    }
    if (isWindFundamentalTool(tool)) {
      const rows = windStockFundamentals(parsed);
      if (rows.length > 0) store.saveFundamental(rows);
      if (tool === "get_global_stock_fundamentals") {
        const statementRows = windGlobalStatementRows(parsed, String(args.windcode ?? ""));
        if (statementRows.length > 0) store.saveYfinanceStatementItems(statementRows);
        const recommendationRows = windGlobalRecommendationRows(parsed, String(args.windcode ?? ""));
        if (recommendationRows.length > 0) store.saveYfinanceRecommendations(recommendationRows);
      }
      return;
    }
    if (tool === "get_global_stock_equity_holders") {
      const rows = windGlobalHolderRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveYfinanceHolders(rows);
      return;
    }
    if (tool === "get_stock_equity_holders") {
      const rows = windStockShareholderRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveStockShareholders(rows as any);
      return;
    }
    if (tool === "get_global_stock_basicinfo") {
      const rows = windGlobalProfileRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveYfinanceProfileFields(rows);
    }
    if (tool === "get_stock_technicals") {
      const rows = windMoneyFlowRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveMoneyFlow(rows as unknown as Array<Record<string, unknown>>);
      const indicatorRows = windTechnicalIndicatorRows(parsed, String(args.windcode ?? ""), "get_stock_technicals");
      if (indicatorRows.length > 0) store.saveTechnicalIndicatorSeries(indicatorRows);
    }
    if (tool === "get_stock_events") {
      const rows = windXdxrEventRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveXdxrEvents(rows);
    }
    if (tool === "get_global_stock_events") {
      const rows = windCorporateActionRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveYfinanceCorporateActions(rows);
    }
    if (tool === "get_index_technicals") {
      const rows = windIndexMomentumRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveIndexMomentumRows(rows);
      const indicatorRows = windTechnicalIndicatorRows(parsed, String(args.windcode ?? ""), "get_index_technicals");
      if (indicatorRows.length > 0) store.saveTechnicalIndicatorSeries(indicatorRows);
      return;
    }
    if (tool === "get_fund_holdings") {
      const rows = windFundHoldingRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveFundHolding(rows);
      return;
    }
    if (tool === "get_fund_performance") {
      const rows = windFundPerformanceRows(parsed, String(args.windcode ?? ""));
      if (rows.length > 0) store.saveFundPerformanceMetrics(rows as any);
      return;
    }
    if (tool === "get_fund_info" || tool === "get_fund_company_info") {
      const rows = windFundManagerRows(parsed, String(args.windcode ?? ""), tool);
      if (rows.length > 0) store.saveFundManagers(rows);
    }
    if (!isWindCompanyInfoTool(tool)) return;
    const rows = windCompanyInfoRows(parsed, String(args.windcode ?? ""), tool);
    if (rows.length > 0) {
      store.saveStockCompanyInfo(rows);
      if (isWindIdentityInfoTool(tool)) {
        const stockRows = rows
          .map((row) => windCompanyStockListRow(server, String(args.windcode ?? row.code), row))
          .filter((row): row is StockInfo => !!row);
        if (stockRows.length > 0) store.saveStockList(stockRows);
      }
    }
  } catch {}
}

function persistWindScreening(
  store: DataStore,
  parsed: Record<string, unknown>,
  args: Record<string, unknown>,
  sourceAction: "search_stocks" | "search_funds",
  market: "stock" | "fund",
): void {
  const rows = windScreeningRows(parsed, market);
  const normalized = normalizeScreeningSnapshot({
    provider: "wind",
    capabilityId: "wind.market.screening",
    sourceAction,
    universe: [market],
    filters: {
      question: args.question ?? null,
      lang: args.lang ?? null,
      version: args.version ?? null,
    },
    rows,
  });
  if (normalized.persistenceRows.length > 0) {
    store.saveMarketScreeningSnapshots(normalized.persistenceRows);
  }
}

function isDailyWindKlineArgs(args: Record<string, unknown>): boolean {
  const period = args.period == null ? "" : String(args.period).trim();
  return period === "" || period === "10";
}

function isPersistableWindMarketServer(server: string): boolean {
  return ["stock_data", "global_stock_data", "fund_data", "index_data", "bond_data"].includes(server);
}

function isWindQuoteTool(tool: string): boolean {
  return tool.endsWith("_quote") || tool.endsWith("_price_indicators");
}

function isWindKlineTool(tool: string): boolean {
  return tool.endsWith("_kline");
}

function isWindFundamentalTool(tool: string): boolean {
  return tool.endsWith("_fundamentals") || tool === "get_fund_financials" || tool === "get_bond_financial_data";
}

function isWindCompanyInfoTool(tool: string): boolean {
  return new Set([
    "get_stock_basicinfo",
    "get_stock_equity_holders",
    "get_stock_events",
    "get_stock_technicals",
    "get_risk_metrics",
    "get_global_stock_basicinfo",
    "get_global_stock_equity_holders",
    "get_global_stock_events",
    "get_global_stock_technicals",
    "get_global_stock_risk_metrics",
    "get_fund_info",
    "get_fund_holdings",
    "get_fund_performance",
    "get_fund_holders",
    "get_fund_company_info",
    "get_index_basicinfo",
    "get_index_technicals",
    "get_bond_basicinfo",
    "get_bond_issuer_info",
    "get_bond_market_data",
  ]).has(tool);
}

function isWindIdentityInfoTool(tool: string): boolean {
  return new Set([
    "get_stock_basicinfo",
    "get_global_stock_basicinfo",
    "get_fund_info",
    "get_fund_company_info",
    "get_index_basicinfo",
    "get_bond_basicinfo",
    "get_bond_issuer_info",
  ]).has(tool);
}

function windAdjust(args: Record<string, unknown>): string {
  return String(args.aftype ?? "").trim() === "1" ? "hfq" : "qfq";
}

function windStockListRow(
  server: string,
  windcode: string,
  snapshot: { code: string; name?: string | null },
): StockInfo | null {
  const market = windMarketFromCode(windcode || snapshot.code, server);
  if (!market || !snapshot.name) return null;
  return {
    code: snapshot.code,
    name: snapshot.name,
    market,
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: windStockType(server),
    updated_at: new Date().toISOString(),
  };
}

function windCompanyStockListRow(
  server: string,
  windcode: string,
  row: Record<string, unknown>,
): StockInfo | null {
  const code = typeof row.code === "string" ? row.code : "";
  const title = typeof row.title === "string" ? row.title : null;
  const market = windMarketFromCode(windcode || code, server);
  const name = title?.trim();
  if (!market || !name) return null;
  return {
    code,
    name,
    market,
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: windStockType(server),
    updated_at: new Date().toISOString(),
  };
}

function windStockType(server: string): string {
  switch (server) {
    case "fund_data":
      return "fund";
    case "index_data":
      return "index";
    case "bond_data":
      return "bond";
    default:
      return "stock";
  }
}

function windMarketFromCode(windcode: string, server: string): string | null {
  const raw = windcode.trim();
  if (!raw.includes(".")) {
    if (server === "bond_data") return "IB";
    if (server === "fund_data") return "OF";
    if (server === "index_data") return "SH";
    return null;
  }
  const suffix = raw.split(".").pop()?.trim().toUpperCase() ?? "";
  if (!suffix) return null;
  switch (suffix) {
    case "O":
    case "N":
    case "KQ":
      return "US";
    default:
      return suffix;
  }
}
