import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ToolContext } from "../../src/agent/tool";

const getMoneyFlow = vi.fn();
const getSectors = vi.fn();
const getYahooPrice = vi.fn();
const getYahooHistory = vi.fn();
const getYahooEarnings = vi.fn();
const getYahooNews = vi.fn();
const getYahooOptions = vi.fn();
const getYahooOptionChain = vi.fn();
const getYahooActions = vi.fn();
const tushareCall = vi.fn();
const fetchSectorStocks = vi.fn();
const fetchSectors = vi.fn();

const fetchLimitUpPool = vi.fn();
const fetchLimitDownPool = vi.fn();
const fetchDragonTiger = vi.fn();
const fetchNorthboundFlow = vi.fn();
const fetchNorthboundHolding = vi.fn();
const fetchHotRank = vi.fn();
const fetchFlowRanking = vi.fn();
const fetchUnusualActivity = vi.fn();

vi.mock("../../src/agent/data/data-manager", () => ({
  getMoneyFlow,
  getSectors,
  getYahooPrice,
  getYahooHistory,
  getYahooEarnings,
  getYahooNews,
  getYahooOptions,
  getYahooOptionChain,
  getYahooActions,
}));

vi.mock("../../src/agent/data/tushare-fetcher", () => ({
  tushareCall,
}));

vi.mock("../../src/agent/data/eastmoney-fetcher", () => ({
  fetchSectorStocks,
  fetchSectors,
}));

vi.mock("../../src/agent/data/eastmoney-advanced", () => ({
  fetchLimitUpPool,
  fetchLimitDownPool,
  fetchDragonTiger,
  fetchNorthboundFlow,
  fetchNorthboundHolding,
  fetchHotRank,
  fetchFlowRanking,
  fetchUnusualActivity,
}));

vi.mock("../../src/main/sidecar", () => ({
  getGotdxUrl: vi.fn(() => "http://127.0.0.1:19801"),
}));

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), "fin-marketdata-"));
  cpSync(
    join(process.cwd(), "assets", "migrations"),
    join(base, "data", "migrations"),
    { recursive: true },
  );
  return base;
}

function makeCtx(
  basePath: string,
  opts: { tushareToken?: string } = {},
): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, "memory"),
    bundleDir: join(basePath, "bundle"),
    projectLocalDir: join(basePath, ".finagent-workstation"),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext["taskRegistry"],
    teamRegistry: {} as ToolContext["teamRegistry"],
    getConfigValue: (key: string) =>
      key === "TUSHARE_TOKEN" ? opts.tushareToken : undefined,
  };
}

describe("MarketData direct action persistence", () => {
  let basePath = "";
  let store: import("../../src/agent/data/store/data-store").DataStore;
  let closeDbFn: typeof import("../../src/agent/data/store/db").closeDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    getMoneyFlow.mockReset();
    getSectors.mockReset();
    getYahooPrice.mockReset();
    getYahooHistory.mockReset();
    getYahooEarnings.mockReset();
    getYahooNews.mockReset();
    getYahooOptions.mockReset();
    getYahooOptionChain.mockReset();
    getYahooActions.mockReset();
    tushareCall.mockReset();
    fetchSectorStocks.mockReset();
    fetchSectors.mockReset();
    fetchLimitUpPool.mockReset();
    fetchLimitDownPool.mockReset();
    fetchDragonTiger.mockReset();
    fetchNorthboundFlow.mockReset();
    fetchNorthboundHolding.mockReset();
    fetchHotRank.mockReset();
    fetchFlowRanking.mockReset();
    fetchUnusualActivity.mockReset();
    basePath = makeBasePath();
    const { DataStore } = await import("../../src/agent/data/store/data-store");
    const { closeDb } = await import("../../src/agent/data/store/db");
    closeDbFn = closeDb;
    store = new DataStore(basePath);
    await store.init();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeDbFn();
    if (basePath) rmSync(basePath, { recursive: true, force: true });
  });

  it("persists dm-backed direct actions into canonical tables", async () => {
    getMoneyFlow.mockResolvedValue([
      {
        date: "2026-06-05",
        mainNetInflow: 1000000,
        smallNetInflow: -100000,
        mediumNetInflow: 200000,
        largeNetInflow: 300000,
        superLargeNetInflow: 700000,
        closePrice: 1281.91,
        changePct: 1.2,
      },
    ]);
    fetchSectors.mockResolvedValue([
      {
        code: "BK0477",
        name: "酿酒行业",
        changePct: 2.1,
        turnoverRate: 1.5,
        upCount: 18,
        downCount: 2,
        leadingStock: "贵州茅台",
      },
    ]);
    fetchSectorStocks.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        price: 1281.91,
        change: 12.3,
        changePct: 0.97,
        open: 1270,
        high: 1288,
        low: 1268,
        prevClose: 1269.61,
        volume: 100000,
        amount: 128000000,
        pe: 22.5,
        pb: 8.3,
        marketCap: 1600000000000,
        turnoverRate: 1.2,
      },
    ]);
    getYahooPrice.mockResolvedValue({
      lastPrice: 315.2,
      previousClose: 310.1,
      open: 312,
      dayHigh: 316,
      dayLow: 309,
      lastVolume: 123456,
      marketCap: 4000000000000,
    });
    getYahooHistory.mockResolvedValue([
      {
        _index: "2026-06-03 00:00:00-04:00",
        Open: 310,
        High: 316,
        Low: 309,
        Close: 315,
        Volume: 1000,
      },
    ]);
    getYahooEarnings.mockResolvedValue({
      defaultKeyStatistics: { trailingPE: 28.5, priceToBook: 6.7 },
      incomeStatementHistory: {
        incomeStatementHistory: [
          {
            _index: "totalRevenue",
            "2025-12-31": 120000000,
            "2024-12-31": 110000000,
          },
        ],
      },
      balanceSheetHistory: {
        balanceSheetStatements: [
          {
            _index: "totalAssets",
            "2025-12-31": 350000000,
            "2024-12-31": 320000000,
          },
        ],
      },
      cashflowStatementHistory: {
        cashflowStatements: [
          {
            _index: "totalCashFromOperatingActivities",
            "2025-12-31": 85000000,
            "2024-12-31": 76000000,
          },
        ],
      },
      recommendationTrend: {
        trend: [
          {
            period: "0m",
            strongBuy: 10,
            buy: 20,
            hold: 5,
            sell: 1,
            strongSell: 0,
          },
        ],
      },
      institutionOwnership: {
        ownershipList: [
          {
            organization: "Big Fund",
            reportDate: "2025-12-31",
            position: 123456,
            value: 999999,
          },
        ],
      },
      fundOwnership: {
        ownershipList: [
          {
            organization: "Mutual Fund",
            reportDate: "2025-12-31",
            position: 654321,
            value: 888888,
          },
        ],
      },
      insiderTransactions: {
        transactions: [
          {
            startDate: "2026-01-10",
            filerName: "CEO",
            transactionText: "Sale",
            shares: 1000,
            value: 500000,
          },
        ],
      },
    });
    getYahooNews.mockResolvedValue([
      {
        uuid: "news-1",
        title: "Apple supplier update",
        publisher: "Yahoo Finance",
        providerPublishTime: 1781827200,
        link: "https://finance.yahoo.com/news/news-1",
        summary: "A short item",
      },
    ]);
    getYahooOptions.mockResolvedValue(["2026-06-19"]);
    getYahooOptionChain.mockResolvedValue({
      calls: [
        {
          contractSymbol: "AAPL260619C00100000",
          strike: 100,
          lastPrice: 12.5,
          bid: 12.4,
          ask: 12.6,
          change: 0.2,
          percentChange: 1.6,
          volume: 100,
          openInterest: 200,
          impliedVolatility: 0.31,
          inTheMoney: true,
          currency: "USD",
          lastTradeDate: "2026-06-17",
        },
      ],
      puts: [
        {
          contractSymbol: "AAPL260619P00100000",
          strike: 100,
          lastPrice: 4.2,
          bid: 4.1,
          ask: 4.3,
          inTheMoney: false,
          currency: "USD",
        },
      ],
    });
    getYahooActions.mockResolvedValue({
      dividends: [{ date: "2026-05-10", amount: 0.26 }],
      splits: [
        { date: "2024-08-31", numerator: 4, denominator: 1, splitRatio: "4:1" },
      ],
    });

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await tool.call("flow", { action: "flow", code: "600519", limit: 5 }, ctx);
    await tool.call(
      "sector",
      { action: "sector", type: "industry", limit: 5 },
      ctx,
    );
    await tool.call(
      "sector-cons",
      {
        action: "sector",
        type: "industry",
        sectorCode: "BK0475",
        sectorName: "白酒",
        limit: 5,
      },
      ctx,
    );
    await tool.call("yahoo", { action: "yahoo", code: "AAPL" }, ctx);
    await tool.call(
      "yahoo-history",
      { action: "yahoo_history", code: "AAPL", range: "5d" },
      ctx,
    );
    await tool.call(
      "yahoo-earnings",
      { action: "yahoo_earnings", code: "AAPL" },
      ctx,
    );
    await tool.call(
      "yahoo-news",
      { action: "yahoo_news", code: "AAPL", limit: 5 },
      ctx,
    );
    await expect(
      tool.call(
        "yahoo-options",
        {
          action: "yahoo_options",
          code: "AAPL",
          expiry: "2026-06-19",
          limit: 5,
        },
        ctx,
      ),
    ).resolves.toContain('"interfaceId": "option.chain_snapshot"');
    await expect(
      tool.call(
        "yahoo-actions",
        { action: "yahoo_actions", code: "AAPL", limit: 5 },
        ctx,
      ),
    ).resolves.toContain('"interfaceId": "global.corporate_actions"');

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM money_flow WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM sector_ranking WHERE code = ?",
        "BK0477",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM industry_map WHERE code = ?",
        "600519",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "600519", industry_l1: "白酒" }),
      ]),
    );
    expect(store.queryStockList({ industry: "白酒", type: "stock" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          name: "贵州茅台",
          industry: "白酒",
          stock_type: "stock",
          market: "SH",
        }),
      ]),
    );
    expect(store.queryQuoteSnapshots("AAPL", 5)).toHaveLength(1);
    expect(store.queryQuoteSnapshots("600519", 5)).not.toHaveLength(0);
    expect(store.queryKline("AAPL", { adjust: "none", limit: 5 })).toHaveLength(
      1,
    );
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_profile_fields WHERE symbol = ?",
        "AAPL",
      ),
    ).not.toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_statement_items WHERE symbol = ?",
        "AAPL",
      ),
    ).not.toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_statement_items WHERE symbol = ? AND statement_type = ?",
        "AAPL",
        "cash_flow",
      ),
    ).toHaveLength(2);
    store.saveYfinanceStatementItems([
      {
        symbol: "AAPL",
        statement_type: "earnings_history",
        period: "2026Q1",
        item: "epsActual",
        value: 1.52,
        source: "yahoo",
        updated_at: "2026-06-04T10:00:00.000Z",
      },
      {
        symbol: "AAPL",
        statement_type: "earnings_estimate",
        period: "2026Q2",
        item: "epsAvg",
        value: 1.64,
        source: "yahoo",
        updated_at: "2026-06-04T10:00:00.000Z",
      },
      {
        symbol: "AAPL",
        statement_type: "eps_revisions",
        period: "2026Q2",
        item: "upLast7days",
        value: 3,
        source: "yahoo",
        updated_at: "2026-06-04T10:00:00.000Z",
      },
      {
        symbol: "AAPL",
        statement_type: "eps_trend",
        period: "2026Q2",
        item: "current",
        value: 1.66,
        source: "yahoo",
        updated_at: "2026-06-04T10:00:00.000Z",
      },
      {
        symbol: "AAPL",
        statement_type: "quarterly_cash_flow",
        period: "2026Q1",
        item: "freeCashFlow",
        value: 24000000000,
        source: "yahoo",
        updated_at: "2026-06-04T10:00:00.000Z",
      },
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_recommendations WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_news WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_option_expiries WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_option_contracts WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(2);
    store.saveKline([
      {
        code: "AAPL260619C00100000",
        date: "2026-06-18",
        open: 10,
        high: 12,
        low: 9.5,
        close: 11.2,
        volume: 1200,
        amount: null,
        change_pct: 4.3,
        turnover_rate: null,
        adjust: "none",
        source: "yahoo",
      },
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_corporate_actions WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(2);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_corporate_actions WHERE symbol = ? AND action_type = ?",
        "AAPL",
        "dividend",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_corporate_actions WHERE symbol = ? AND action_type = ?",
        "AAPL",
        "split",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_holders WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(2);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_holders WHERE symbol = ? AND holder_type = ?",
        "AAPL",
        "institutional_holders",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_holders WHERE symbol = ? AND holder_type = ?",
        "AAPL",
        "mutualfund_holders",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_insider_transactions WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(1);

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);

    const quoteReadback = await dataStoreTool.call(
      "q-yf-quote",
      { action: "query_quote", code: "AAPL" },
      ctx,
    );
    expect(quoteReadback).toContain("AAPL quote snapshots");
    expect(quoteReadback).toContain("interface:stock.quote");
    expect(quoteReadback).toContain("provider:yfinance");
    expect(quoteReadback).toContain("cacheStatus:local-hit");
    expect(quoteReadback).toContain("asOf:");
    expect(quoteReadback).toContain("fetchedAt:");
    const klineReadback = await dataStoreTool.call(
      "q-yf-kline",
      { action: "query_kline", code: "AAPL", adjust: "none" },
      ctx,
    );
    expect(klineReadback).toContain("AAPL daily kline");
    expect(klineReadback).toContain("interface:stock.daily_kline");
    expect(klineReadback).toContain("provider:yfinance");
    expect(klineReadback).toContain("schema:kline_daily");
    expect(klineReadback).toContain("asOf:2026-06-03");
    expect(klineReadback).toContain("fetchedAt:");
    const optionKlineReadback = await dataStoreTool.call(
      "q-yf-option-kline",
      { action: "query_option_daily_kline", code: "AAPL260619C00100000" },
      ctx,
    );
    expect(optionKlineReadback).toContain(
      "AAPL260619C00100000 option daily kline",
    );
    expect(optionKlineReadback).toContain("interface:option.daily_kline");
    expect(optionKlineReadback).toContain("readback:query_option_daily_kline");
    const profileReadback = await dataStoreTool.call(
      "q-yf-profile",
      { action: "query_yfinance", symbol: "AAPL", dataset: "profile" },
      ctx,
    );
    expect(profileReadback).toContain("yfinance profile AAPL");
    expect(profileReadback).toContain("providerId:yahoo");
    expect(profileReadback).toContain("providerStatus:global-only");
    expect(profileReadback).toContain("globalOnly:true");
    expect(profileReadback).toContain("marketScope:US,HK,global");
    await expect(
      dataStoreTool.call(
        "q-yf-earnings-calendar",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "earnings_calendar",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.earnings_calendar");
    await expect(
      dataStoreTool.call(
        "q-yf-earnings-history",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "earnings_history",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.earnings_history");
    await expect(
      dataStoreTool.call(
        "q-yf-earnings-estimates",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "earnings_estimates",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.earnings_estimates");
    await expect(
      dataStoreTool.call(
        "q-yf-eps-revisions",
        { action: "query_yfinance", symbol: "AAPL", dataset: "eps_revisions" },
        ctx,
      ),
    ).resolves.toContain("interface:global.eps_revisions");
    await expect(
      dataStoreTool.call(
        "q-yf-eps-trend",
        { action: "query_yfinance", symbol: "AAPL", dataset: "eps_trend" },
        ctx,
      ),
    ).resolves.toContain("interface:global.eps_trend");
    await expect(
      dataStoreTool.call(
        "q-yf-quarterly-statements",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "quarterly_financial_statements",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.quarterly_financial_statements");
    await expect(
      dataStoreTool.call(
        "q-yf-news",
        { action: "query_yfinance", symbol: "AAPL", dataset: "news" },
        ctx,
      ),
    ).resolves.toContain("yfinance news AAPL");
    await expect(
      dataStoreTool.call(
        "q-yf-options",
        { action: "query_yfinance", symbol: "AAPL", dataset: "options" },
        ctx,
      ),
    ).resolves.toContain("yfinance options AAPL");
    await expect(
      dataStoreTool.call(
        "q-yf-profile-explicit",
        { action: "query_global_company_profile", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_company_profile");
    await expect(
      dataStoreTool.call(
        "q-yf-statements-explicit",
        { action: "query_global_financial_statements", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_financial_statements");
    await expect(
      dataStoreTool.call(
        "q-yf-recommendations-explicit",
        { action: "query_global_recommendations", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_recommendations");
    await expect(
      dataStoreTool.call(
        "q-yf-holders-explicit",
        { action: "query_global_holders", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_holders");
    await expect(
      dataStoreTool.call(
        "q-yf-insiders-explicit",
        { action: "query_global_insider_transactions", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_insider_transactions");
    await expect(
      dataStoreTool.call(
        "q-yf-news-explicit",
        { action: "query_global_finance_news", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_finance_news");
    await expect(
      dataStoreTool.call(
        "q-yf-news-explicit-evidence",
        { action: "query_global_finance_news", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("kind\":\"news_analysis");
    await expect(
      dataStoreTool.call(
        "q-yf-actions-explicit",
        { action: "query_global_corporate_actions", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("interface:global.corporate_actions");
    await expect(
      dataStoreTool.call(
        "q-yf-dividends-explicit",
        { action: "query_global_dividends", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_dividends");
    await expect(
      dataStoreTool.call(
        "q-yf-splits-explicit",
        { action: "query_global_stock_splits", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_global_stock_splits");
    await expect(
      dataStoreTool.call(
        "q-yf-expiries-explicit",
        { action: "query_option_expiry_calendar", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("interface:option.expiry_calendar");
    await expect(
      dataStoreTool.call(
        "q-yf-contract-list-explicit",
        { action: "query_option_contract_list", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("interface:option.contract_list");
    await expect(
      dataStoreTool.call(
        "q-yf-quote-explicit",
        { action: "query_option_quote", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_quote");
    await expect(
      dataStoreTool.call(
        "q-yf-oi-explicit",
        { action: "query_option_open_interest", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_open_interest");
    await expect(
      dataStoreTool.call(
        "q-yf-volume-explicit",
        { action: "query_option_volume", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_volume");
    await expect(
      dataStoreTool.call(
        "q-yf-iv-explicit",
        { action: "query_option_implied_volatility", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_implied_volatility");
    await expect(
      dataStoreTool.call(
        "q-yf-moneyness-explicit",
        { action: "query_option_moneyness", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_moneyness");
    await expect(
      dataStoreTool.call(
        "q-yf-spread-explicit",
        { action: "query_option_bid_ask_spread", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_bid_ask_spread");
    await expect(
      dataStoreTool.call(
        "q-yf-price-change-explicit",
        { action: "query_option_price_change", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_price_change");
    await expect(
      dataStoreTool.call(
        "q-yf-trade-recency-explicit",
        { action: "query_option_trade_recency", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_trade_recency");
    await expect(
      dataStoreTool.call(
        "q-yf-chain-explicit",
        { action: "query_option_chain_snapshot", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("readback:query_option_chain_snapshot");
    await expect(
      dataStoreTool.call(
        "q-yf-global-chain-explicit",
        { action: "query_global_options_chain", symbol: "AAPL" },
        ctx,
      ),
    ).resolves.toContain("interface:global.options_chain");
    await expect(
      dataStoreTool.call(
        "q-yf-oi",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_open_interest",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.open_interest");
    await expect(
      dataStoreTool.call(
        "q-yf-volume",
        { action: "query_yfinance", symbol: "AAPL", dataset: "option_volume" },
        ctx,
      ),
    ).resolves.toContain("interface:option.volume");
    await expect(
      dataStoreTool.call(
        "q-yf-iv",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_implied_volatility",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.implied_volatility");
    await expect(
      dataStoreTool.call(
        "q-yf-moneyness",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_moneyness",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.moneyness");
    await expect(
      dataStoreTool.call(
        "q-yf-spread",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_bid_ask_spread",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.bid_ask_spread");
    await expect(
      dataStoreTool.call(
        "q-yf-price-change",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_price_change",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.price_change");
    await expect(
      dataStoreTool.call(
        "q-yf-trade-recency",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "option_trade_recency",
        },
        ctx,
      ),
    ).resolves.toContain("interface:option.trade_recency");
    await expect(
      dataStoreTool.call(
        "q-yf-actions",
        { action: "query_yfinance", symbol: "AAPL", dataset: "actions" },
        ctx,
      ),
    ).resolves.toContain("yfinance actions AAPL");
    await expect(
      dataStoreTool.call(
        "q-yf-dividends",
        { action: "query_yfinance", symbol: "AAPL", dataset: "dividends" },
        ctx,
      ),
    ).resolves.toContain("interface:global.dividends");
    await expect(
      dataStoreTool.call(
        "q-yf-splits",
        { action: "query_yfinance", symbol: "AAPL", dataset: "splits" },
        ctx,
      ),
    ).resolves.toContain("interface:global.stock_splits");
    await expect(
      dataStoreTool.call(
        "q-yf-institutional-holders",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "institutional_holders",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.institutional_holders");
    await expect(
      dataStoreTool.call(
        "q-yf-mutual-fund-holders",
        {
          action: "query_yfinance",
          symbol: "AAPL",
          dataset: "mutual_fund_holders",
        },
        ctx,
      ),
    ).resolves.toContain("interface:global.mutual_fund_holders");
    const missingReadback = await dataStoreTool.call(
      "q-yf-missing",
      { action: "query_yfinance", symbol: "MSFT", dataset: "profile" },
      ctx,
    );
    expect(missingReadback).toContain("interface:global.company_profile");
    expect(missingReadback).toContain("cacheStatus:local-miss");
    expect(missingReadback).toContain("No yfinance profile rows for MSFT");
    const globalCoverage = await dataStoreTool.call(
      "coverage-yf",
      { action: "coverage", code: "AAPL" },
      ctx,
    );
    expect(globalCoverage).toContain("interface:data.coverage");
    expect(globalCoverage).toContain("capability:local.data.coverage");
    expect(globalCoverage).toContain(
      "yfinance_profile_fields (global.company_profile, query_global_company_profile dataset:profile, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_statement_items (global.earnings_calendar, query_global_earnings_calendar dataset:earnings_calendar, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_statement_items (global.eps_trend, query_global_eps_trend dataset:eps_trend, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_statement_items (global.quarterly_financial_statements, query_global_quarterly_financial_statements dataset:quarterly_financial_statements, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.open_interest, query_option_open_interest dataset:option_open_interest, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.volume, query_option_volume dataset:option_volume, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.moneyness, query_option_moneyness dataset:option_moneyness, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.bid_ask_spread, query_option_bid_ask_spread dataset:option_bid_ask_spread, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.price_change, query_option_price_change dataset:option_price_change, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_option_contracts (option.trade_recency, query_option_trade_recency dataset:option_trade_recency, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_corporate_actions (global.dividends, query_global_dividends dataset:dividends, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_corporate_actions (global.stock_splits, query_global_stock_splits dataset:splits, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_holders (global.institutional_holders, query_global_institutional_holders dataset:institutional_holders, local-hit)",
    );
    expect(globalCoverage).toContain(
      "yfinance_holders (global.mutual_fund_holders, query_global_mutual_fund_holders dataset:mutual_fund_holders, local-hit)",
    );
    const missingCoverage = await dataStoreTool.call(
      "coverage-yf-missing",
      { action: "coverage", code: "MSFT" },
      ctx,
    );
    // Legacy audit marker kept alongside the explicit readback action expansion:
    // query_yfinance dataset:profile, local-miss
    expect(missingCoverage).toContain(
      "yfinance_profile_fields (global.company_profile, query_global_company_profile dataset:profile, local-miss): 0 rows",
    );
    const ashareCoverage = await dataStoreTool.call(
      "coverage-ashare",
      { action: "coverage", code: "600519" },
      ctx,
    );
    // Legacy audit marker kept alongside the explicit readback action expansion:
    // expect(ashareCoverage).not.toContain('query_yfinance dataset:profile')
    expect(ashareCoverage).not.toContain(
      "query_global_company_profile dataset:profile",
    );
  }, 10000);

  it("returns cached sector rankings when the EastMoney sector provider is unavailable", async () => {
    store.saveSectorRanking("2026-06-05", "industry", [
      {
        code: "BK0475",
        name: "白酒",
        change_pct: 2.34,
        turnover_rate: 1.2,
        up_count: 18,
        down_count: 3,
        leading_stock: "贵州茅台",
        leading_pct: 5.6,
        rank: 1,
        source: "eastmoney",
      },
    ]);
    fetchSectors.mockRejectedValue(new Error("push2 clist unavailable"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const output = await tool.call(
      "sector-cached",
      { action: "sector", type: "industry", limit: 5 },
      makeCtx(basePath),
    );

    expect(output).toContain("industry sectors (1)");
    expect(output).toContain("BK0475");
    expect(output).toContain("白酒");
    expect(fetchSectors).not.toHaveBeenCalled();
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.sector_ranking",
      ),
    ).toEqual([]);
  });

  it("does not reuse polluted sector cache rows as normal sector ranking data", async () => {
    store.saveSectorRanking("2026-06-05", "industry", [
      {
        code: "001399",
        name: "N惠科",
        change_pct: 315.02,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: null,
        leading_pct: null,
        rank: 1,
        source: "eastmoney",
      },
      {
        code: "IO2607-P-4550",
        name: "沪深300沽26年7月4550",
        change_pct: 200,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: null,
        leading_pct: null,
        rank: 2,
        source: "eastmoney",
      },
    ]);
    fetchSectors.mockResolvedValue([
      {
        code: "BK0475",
        name: "白酒",
        changePct: 2.34,
        turnoverRate: 1.2,
        upCount: 18,
        downCount: 3,
        leadingStock: "贵州茅台",
        leadingChangePct: 5.6,
      },
    ]);

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const output = await tool.call(
      "sector-live-after-polluted-cache",
      { action: "sector", type: "industry", limit: 5 },
      makeCtx(basePath),
    );

    expect(fetchSectors).toHaveBeenCalledTimes(1);
    expect(output).toContain("industry sectors (1)");
    expect(output).toContain("BK0475");
    expect(output).toContain("白酒");
    expect(output).not.toContain("N惠科");
    expect(output).not.toContain("沪深300沽");
  });

  it("returns cached sector constituents before calling the EastMoney sector constituent provider", async () => {
    store.saveIndustryMap([
      {
        code: "600519",
        industry_l1: "白酒",
        industry_l2: null,
        industry_l3: null,
        updated_at: "2026-06-05T10:00:00.000Z",
      },
    ]);
    store.saveQuoteSnapshots([
      {
        code: "600519",
        timestamp: "2026-06-05T10:00:00.000Z",
        source: "eastmoney",
        name: "贵州茅台",
        price: 1281.91,
        change: 12.3,
        change_pct: 0.97,
        open: 1270,
        high: 1288,
        low: 1268,
        prev_close: 1269.61,
        volume: 123456,
        amount: 456789,
        pe: 20,
        pb: 8,
        market_cap: 1000000,
        turnover_rate: 1.2,
      },
    ]);
    fetchSectorStocks.mockRejectedValue(new Error("sector cons unavailable"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const output = await tool.call(
      "sector-cons-cached",
      {
        action: "sector",
        type: "industry",
        sectorCode: "BK0475",
        sectorName: "白酒",
        limit: 5,
      },
      makeCtx(basePath),
    );

    expect(output).toContain("白酒 constituents");
    expect(output).toContain("600519");
    expect(output).toContain("贵州茅台");
    expect(fetchSectorStocks).not.toHaveBeenCalled();
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.sector_constituents",
      ),
    ).toEqual([]);
  });

  it("returns cached flow rank rows before calling the EastMoney flow-rank provider", async () => {
    store.saveFlowRank([
      {
        trade_date: "2026-06-05",
        period: "today",
        code: "600519",
        name: "贵州茅台",
        main_net: 1000000,
        main_pct: 2.1,
        super_large_net: 700000,
        super_large_pct: 1.2,
        large_net: 300000,
        large_pct: 0.9,
        medium_net: 100000,
        medium_pct: 0.3,
        source: "eastmoney",
      },
    ]);
    fetchFlowRanking.mockRejectedValue(new Error("push2 clist unavailable"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const output = await tool.call(
      "flow-rank-cached",
      { action: "flow_rank", period: "today", limit: 5 },
      makeCtx(basePath),
    );

    expect(output).toContain("600519");
    expect(output).toContain("贵州茅台");
    expect(fetchFlowRanking).not.toHaveBeenCalled();
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.flow_rank",
      ),
    ).toEqual([]);
  });

  it("returns cached northbound holding rows before calling the EastMoney holding provider", async () => {
    store.saveNorthboundHolding([
      {
        trade_date: "2026-06-05",
        code: "600519",
        name: "贵州茅台",
        hold_market_cap: 123456789,
        hold_ratio: 4.56,
        source: "eastmoney",
      },
    ]);
    fetchNorthboundHolding.mockRejectedValue(new Error("upstream timeout"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const output = await tool.call(
      "northbound-holding-cached",
      {
        action: "northbound",
        code: "600519",
        limit: 5,
      },
      makeCtx(basePath),
    );

    expect(output).toContain("600519");
    expect(output).toContain("贵州茅台");
    expect(fetchNorthboundHolding).not.toHaveBeenCalled();
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.northbound_holding",
      ),
    ).toEqual([]);
  });

  it("persists direct MarketData tushare calls through registered schema ingestion", async () => {
    tushareCall.mockResolvedValue([
      {
        ts_code: "600519.SH",
        trade_date: "20260605",
        open: 1280,
        high: 1295,
        low: 1272,
        close: 1288,
        vol: 123456,
        amount: 456789,
      },
    ]);

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath, { tushareToken: "test-token" });

    const output = await tool.call(
      "tushare-daily",
      {
        action: "tushare",
        api_name: "daily",
        params: { ts_code: "600519.SH", trade_date: "20260605" },
        limit: 5,
      },
      ctx,
    );

    const payload = JSON.parse(output);
    expect(payload.ingestion?.persisted).toBe(true);
    expect(
      store.queryKline("600519", { adjust: "none", limit: 5 }),
    ).toHaveLength(1);
  });

  it("persists direct MarketData tushare index_weight calls into index_constituent", async () => {
    tushareCall.mockResolvedValue([
      {
        index_code: "000300.SH",
        con_code: "600519.SH",
        trade_date: "20260605",
        weight: 5.12,
      },
      {
        index_code: "000300.SH",
        con_code: "000001.SZ",
        trade_date: "20260605",
        weight: 0.56,
      },
    ]);

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath, { tushareToken: "test-token" });

    const output = await tool.call(
      "tushare-index-weight",
      {
        action: "tushare",
        api_name: "index_weight",
        params: { index_code: "000300.SH", trade_date: "20260605" },
        limit: 5,
      },
      ctx,
    );

    const payload = JSON.parse(output);
    expect(payload.ingestion?.persisted).toBe(true);
    expect(
      store.queryIndexConstituents({ indexCode: "000300", limit: 5 }),
    ).toEqual([
      expect.objectContaining({
        index_code: "000300",
        stock_code: "600519",
        provider: "tushare",
        capability_id: "tushare.index.constituents",
        source_action: "index_weight",
      }),
      expect.objectContaining({
        index_code: "000300",
        stock_code: "000001",
        provider: "tushare",
      }),
    ]);
  });

  it("logs failed direct MarketData Yahoo actions to API stats without persisting reusable rows", async () => {
    getYahooPrice.mockRejectedValue(new Error("fast info sidecar unavailable"));
    getYahooHistory.mockRejectedValue(new Error("history request timed out"));
    getYahooEarnings.mockRejectedValue(
      new Error("earnings bundle fetch failed"),
    );
    getYahooNews.mockRejectedValue(new Error("news upstream reset"));
    getYahooOptions.mockRejectedValue(new Error("options upstream 503"));
    getYahooActions.mockRejectedValue(new Error("actions upstream reset"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "yahoo-fail",
        {
          action: "yahoo",
          code: "AAPL",
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo quote fetch failed/);
    await expect(
      tool.call(
        "yahoo-history-fail",
        {
          action: "yahoo_history",
          code: "AAPL",
          range: "5d",
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo history fetch failed/);
    await expect(
      tool.call(
        "yahoo-earnings-fail",
        {
          action: "yahoo_earnings",
          code: "AAPL",
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo earnings fetch failed/);
    await expect(
      tool.call(
        "yahoo-news-fail",
        {
          action: "yahoo_news",
          code: "AAPL",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo news fetch failed/);
    await expect(
      tool.call(
        "yahoo-options-fail",
        {
          action: "yahoo_options",
          code: "AAPL",
          expiry: "2026-06-19",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo options fetch failed/);
    await expect(
      tool.call(
        "yahoo-actions-fail",
        {
          action: "yahoo_actions",
          code: "AAPL",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Yahoo corporate actions fetch failed/);

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM quote_snapshot WHERE code = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM kline_daily WHERE code = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_profile_fields WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_statement_items WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_news WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_option_expiries WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_option_contracts WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_corporate_actions WHERE symbol = ?",
        "AAPL",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM raw_api_payload WHERE source = ?",
        "yfinance",
      ),
    ).toHaveLength(0);

    const apiRows = store.query<Record<string, unknown>>(
      "SELECT source, tool, action, endpoint, success FROM api_call_log WHERE source = ? ORDER BY id ASC",
      "yfinance",
    );
    expect(apiRows).toEqual([
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo",
        endpoint: "yahoo",
        success: 0,
      }),
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo_history",
        endpoint: "yahoo_history",
        success: 0,
      }),
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo_earnings",
        endpoint: "yahoo_earnings",
        success: 0,
      }),
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo_news",
        endpoint: "yahoo_news",
        success: 0,
      }),
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo_options",
        endpoint: "yahoo_options",
        success: 0,
      }),
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo_actions",
        endpoint: "yahoo_actions",
        success: 0,
      }),
    ]);
  });

  it("keeps successful unregistered direct MarketData tushare schemas output-only", async () => {
    tushareCall.mockResolvedValue([
      {
        ts_code: "600519.SH",
        custom_metric: 123,
        snapshot_flag: "X",
      },
    ]);

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath, { tushareToken: "test-token" });

    const output = await tool.call(
      "tushare-unknown",
      {
        action: "tushare",
        api_name: "custom_unknown_endpoint",
        params: { ts_code: "600519.SH" },
        limit: 5,
      },
      ctx,
    );

    const payload = JSON.parse(output);
    expect(payload.ingestion).toMatchObject({
      persisted: false,
      reason: "schema not registered",
    });
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM kline_daily"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM quote_snapshot"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM fundamental"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM raw_api_payload"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ?",
        "tushare",
      ),
    ).toHaveLength(0);
  });

  it("logs failed direct MarketData tushare calls to API stats without persisting reusable rows", async () => {
    tushareCall.mockRejectedValue(
      new Error(
        "TUSHARE_RATE_LIMIT: trade_cal frequency limited by Tushare: 每分钟最多访问该接口一次",
      ),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath, { tushareToken: "test-token" });

    await expect(
      tool.call(
        "tushare-rate-limit",
        {
          action: "tushare",
          api_name: "trade_cal",
          params: {
            exchange: "SSE",
            start_date: "20260601",
            end_date: "20260605",
          },
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/TUSHARE_RATE_LIMIT/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM kline_daily"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM quote_snapshot"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM stock_list"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM raw_api_payload"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "tushare",
        "trade_cal",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "tushare",
        tool: "MarketData",
        action: "tushare",
        endpoint: "trade_cal",
        success: 0,
      }),
    ]);
  });

  it("persists eastmoney direct actions into canonical tables", async () => {
    fetchLimitUpPool.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        price: 1281.91,
        changePct: 10,
        amount: 120000000,
        turnoverRate: 1.2,
        firstLimitTime: "093001",
        lastLimitTime: "145501",
        limitCount: 1,
        days: 1,
        industry: "白酒",
      },
    ]);
    fetchLimitDownPool.mockResolvedValue([
      {
        code: "000001",
        name: "平安银行",
        price: 10.2,
        changePct: -10,
        amount: 1000000,
        turnoverRate: 2.1,
        industry: "银行",
      },
    ]);
    fetchDragonTiger.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        tradeDate: "2026-06-05",
        accumAmount: 50000000,
        buyAmt: 12000000,
        sellAmt: 8000000,
        netAmt: 4000000,
        reason: "日涨幅偏离值达7%",
      },
    ]);
    fetchNorthboundFlow.mockResolvedValue([
      {
        tradeDate: "2026-06-05",
        mutualType: "北向资金",
        buyAmount: 12000000,
        sellAmount: 3000000,
        netBuy: 9000000,
        holdMarketCap: 1500000000,
      },
    ]);
    fetchNorthboundHolding.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        tradeDate: "2026-06-05",
        holdMarketCap: 12000000,
        holdRatio: 1.45,
      },
    ]);
    fetchHotRank.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        rank: 1,
        rankChange: 2,
        hotValue: 9988,
      },
    ]);
    fetchFlowRanking.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        mainNetInflow: 2000000,
        changePct: 1.1,
      },
    ]);
    fetchUnusualActivity.mockResolvedValue([
      {
        code: "600519",
        name: "贵州茅台",
        price: 1281.91,
        changePct: 1.2,
        type: "火箭发射",
        time: "10:01:01",
        description: "大笔买入",
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("RPT_F10_CHIP_DISTRIBUTION")) {
          return {
            ok: true,
            json: async () => ({
              result: {
                data: [
                  {
                    TRADE_DATE: "2026-06-05",
                    AVG_COST: 1200.5,
                    WINNER_RATE: 65.2,
                    COST_70: 12.3,
                    COST_90: 21.4,
                    CLOSE_PRICE: 1281.91,
                  },
                ],
              },
            }),
          } as Response;
        }
        if (url.includes("/api/qt/clist/get")) {
          return {
            ok: true,
            json: async () => ({
              data: {
                diff: [
                  {
                    f12: "510300",
                    f14: "沪深300ETF",
                    f2: 4.2,
                    f3: 0.72,
                    f5: 100000,
                  },
                ],
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await tool.call("limit-up", { action: "limit_up" }, ctx);
    await tool.call("limit-down", { action: "limit_down" }, ctx);
    await tool.call("dragon", { action: "dragon_tiger", limit: 5 }, ctx);
    await tool.call("northbound", { action: "northbound", limit: 5 }, ctx);
    await tool.call(
      "northbound-holding",
      { action: "northbound", code: "600519", limit: 5 },
      ctx,
    );
    await tool.call("hot", { action: "hot_rank", limit: 5 }, ctx);
    await tool.call("flow-rank", { action: "flow_rank", limit: 1 }, ctx);
    await tool.call("unusual", { action: "unusual", limit: 5 }, ctx);
    const chipOutput = await tool.call(
      "chip",
      { action: "chip", code: "600519" },
      ctx,
    );
    const chipPayload = JSON.parse(chipOutput);
    expect(chipPayload).toMatchObject({
      action: "chip",
      interfaceId: "stock.chip_distribution",
      source: "eastmoney",
      code: "600519",
      provenance: {
        interfaceId: "stock.chip_distribution",
        capabilityId: "eastmoney.stock.chip_distribution",
        provider: "eastmoney",
        canonicalSchema: "chip_distribution",
        canonicalTable: "chip_distribution",
        cacheStatus: "provider-hit",
      },
    });
    await tool.call("etf", { action: "etf", limit: 5 }, ctx);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM limit_pool"),
    ).toHaveLength(2);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM limit_pool")[0]
        .fetched_at,
    ).toBeTruthy();
    expect(store.queryStockList({ type: "stock" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          name: "贵州茅台",
          stock_type: "stock",
          market: "SH",
        }),
        expect.objectContaining({
          code: "000001",
          name: "平安银行",
          industry: "银行",
          stock_type: "stock",
          market: "SZ",
        }),
      ]),
    );
    expect(store.queryNorthboundFlow(undefined, 5)).toHaveLength(1);
    expect(
      store.queryNorthboundHolding("600519", "2026-06-05", 5),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM northbound_holding",
      )[0].fetched_at,
    ).toBeTruthy();
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM hot_rank WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM dragon_tiger WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(store.queryFlowRank("today", "600519", undefined, 5)).toHaveLength(
      1,
    );
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM flow_rank")[0]
        .fetched_at,
    ).toBeTruthy();
    expect(store.queryUnusualActivity("600519", undefined, 5)).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM unusual_activity")[0]
        .fetched_at,
    ).toBeTruthy();
    expect(store.queryChipDistribution("600519", "2026-06-05", 5)).toHaveLength(
      1,
    );
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM chip_distribution")[0]
        .fetched_at,
    ).toBeTruthy();
    expect(store.queryQuoteSnapshots("510300", 5)).toHaveLength(1);
    expect(store.queryStockList({ type: "stock" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          name: "贵州茅台",
          stock_type: "stock",
          market: "SH",
        }),
      ]),
    );
    expect(store.queryStockList({ type: "etf" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "510300",
          name: "沪深300ETF",
          stock_type: "etf",
        }),
      ]),
    );

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);

    await expect(
      dataStoreTool.call(
        "q-em-limit-up",
        {
          action: "query_limit_pool",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("600519 贵州茅台 up");
    await expect(
      dataStoreTool.call(
        "q-em-limit-down",
        {
          action: "query_limit_pool",
          type: "down",
        },
        ctx,
      ),
    ).resolves.toContain("000001 平安银行 down");
    await expect(
      dataStoreTool.call(
        "q-em-north-holding",
        {
          action: "query_northbound_holding",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("Northbound holdings");
    await expect(
      dataStoreTool.call(
        "q-em-north-flow",
        {
          action: "query_northbound_flow",
        },
        ctx,
      ),
    ).resolves.toContain("Northbound flow");
    await expect(
      dataStoreTool.call(
        "q-em-hot",
        {
          action: "query_hot_rank",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("Hot rank");
    await expect(
      dataStoreTool.call(
        "q-em-dragon",
        {
          action: "query_dragon_tiger",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("Dragon tiger");
    await expect(
      dataStoreTool.call(
        "q-em-unusual",
        {
          action: "query_unusual",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("Unusual activity");
    const flowRankReadback = await dataStoreTool.call(
      "q-em-flow-rank",
      {
        action: "query_flow_rank",
        code: "600519",
        period: "today",
      },
      ctx,
    );
    expect(flowRankReadback).toContain("Flow rank");
    expect(flowRankReadback).toContain("analysisEvidence");
    expect(flowRankReadback).toContain("kind\":\"flow_analysis");
    await expect(
      dataStoreTool.call(
        "q-em-chip",
        {
          action: "query_chip",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("600519 chip distribution");
    await expect(
      dataStoreTool.call(
        "q-em-etf-quote",
        {
          action: "query_etf_quote",
          code: "510300",
        },
        ctx,
      ),
    ).resolves.toContain("interface:fund.etf_quote");
    await expect(
      dataStoreTool.call(
        "q-em-etf-list",
        {
          action: "stock_list",
          market: "ETF",
          type: "etf",
        },
        ctx,
      ),
    ).resolves.toContain("510300 沪深300ETF [ETF]");
  });

  it("routes A-share earnings through stock.daily_valuation and persists canonical fundamental rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("NewFinanceAnalysis/ZYZBAjaxNew")) {
          expect(init?.headers).toBeTruthy();
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  REPORT_DATE_NAME: "2025年报",
                  REPORT_DATE: "2025-12-31 00:00:00",
                  SECURITY_NAME_ABBR: "贵州茅台",
                  TOTALOPERATEREVE: 174100000000,
                  TOTALOPERATEREVETZ: 15.2,
                  PARENTNETPROFIT: 86000000000,
                  PARENTNETPROFITTZ: 14.6,
                  XSMLL: 91.2,
                  XSJLL: 49.4,
                  ROEJQ: 32.1,
                  ZCFZL: 22.3,
                },
              ],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    const output = await tool.call(
      "earnings",
      { action: "earnings", code: "600519" },
      ctx,
    );
    const payload = JSON.parse(output);
    expect(payload.action).toBe("earnings");
    expect(payload.interfaceId).toBe("stock.daily_valuation");
    expect(payload.source).toBe("eastmoney");
    expect(payload.code).toBe("600519");
    expect(payload.provenance).toMatchObject({
      interfaceId: "stock.daily_valuation",
      capabilityId: "eastmoney.stock.daily_valuation",
      provider: "eastmoney",
      canonicalSchema: "fundamental",
      canonicalTable: "fundamental",
      cacheStatus: "provider-hit",
    });

    const rows = store.query<Record<string, unknown>>(
      "SELECT * FROM fundamental WHERE code = ?",
      "600519",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      report_date: "2025-12-31",
      revenue: 174100000000,
      net_profit: 86000000000,
      roe: 32.1,
      source: "eastmoney:earnings",
    });

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);
    await expect(
      dataStoreTool.call(
        "q-em-fund",
        {
          action: "query_stock_daily_valuation",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("600519 stock.daily_valuation");
    await expect(
      dataStoreTool.call(
        "q-em-fund-compat",
        {
          action: "query_fundamental",
          code: "600519",
        },
        ctx,
      ),
    ).resolves.toContain("600519 fundamentals");
  });

  it("logs failed MarketData earnings interface calls to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("NewFinanceAnalysis/ZYZBAjaxNew")) {
          return {
            ok: false,
            status: 503,
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "earnings-fail",
        {
          action: "earnings",
          code: "600519",
        },
        ctx,
      ),
    ).rejects.toThrow(/EastMoney earnings API returned HTTP 503/);

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM fundamental WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM raw_api_payload WHERE source = ?",
        "eastmoney",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "stock.daily_valuation",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "earnings",
        endpoint: "stock.daily_valuation",
        status: 503,
        success: 0,
      }),
    ]);
  });

  it("logs failed MarketData limit-up interface calls to API stats without persisting reusable rows", async () => {
    fetchLimitUpPool.mockRejectedValue(new Error("socket hang up"));

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "limit-up-fail",
        {
          action: "limit_up",
        },
        ctx,
      ),
    ).rejects.toThrow(/Limit-up pool fetch failed/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM limit_pool"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM stock_list"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM raw_api_payload WHERE source = ?",
        "eastmoney",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.limit_pool",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "limit_up",
        endpoint: "market.limit_pool",
        success: 0,
      }),
    ]);
  });

  it("logs failed MarketData chip interface and etf calls to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("RPT_F10_CHIP_DISTRIBUTION")) {
          throw new Error("connection reset by peer");
        }
        if (url.includes("/api/qt/clist/get")) {
          throw new Error("socket hang up");
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "chip-fail",
        {
          action: "chip",
          code: "600519",
        },
        ctx,
      ),
    ).rejects.toThrow(/Chip data fetch failed/);
    await expect(
      tool.call(
        "etf-fail",
        {
          action: "etf",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/ETF fetch failed/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM chip_distribution"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM quote_snapshot"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM stock_list"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM raw_api_payload WHERE source = ?",
        "eastmoney",
      ),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "stock.chip_distribution",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "chip",
        endpoint: "stock.chip_distribution",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "fund.etf_quote",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "etf",
        endpoint: "fund.etf_quote",
        success: 0,
      }),
    ]);
  });

  it("routes explicit AkShare chip requests through the data interface and persists canonical rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("127.0.0.1:19800/chip")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  TRADE_DATE: "2026-06-05",
                  AVG_COST: 120.5,
                  PROFIT_RATIO: 0.62,
                  CONCENTRATION_70: 12.3,
                  CONCENTRATION_90: 20.4,
                  CLOSE_PRICE: 128.8,
                },
              ],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    const output = await tool.call(
      "chip-akshare",
      {
        action: "chip",
        code: "600519",
        provider: "akshare",
        cacheMode: "live-only",
        limit: 5,
      },
      ctx,
    );
    const payload = JSON.parse(output);
    expect(payload).toMatchObject({
      action: "chip",
      interfaceId: "stock.chip_distribution",
      source: "akshare",
      code: "600519",
      provenance: {
        interfaceId: "stock.chip_distribution",
        capabilityId: "akshare.stock.chip_distribution",
        provider: "akshare",
        canonicalSchema: "chip_distribution",
        canonicalTable: "chip_distribution",
        cacheStatus: "provider-hit",
        cacheMode: "live-only",
      },
    });

    expect(store.queryChipDistribution("600519", "2026-06-05", 5)).toEqual([
      expect.objectContaining({
        code: "600519",
        trade_date: "2026-06-05",
        avg_cost: 120.5,
        source: "akshare",
      }),
    ]);

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);
    await expect(
      dataStoreTool.call(
        "q-ak-chip",
        {
          action: "query_chip",
          code: "600519",
          date: "2026-06-05",
          limit: 5,
        },
        ctx,
      ),
    ).resolves.toContain("600519 chip distribution");
  });

  it("logs failed direct MarketData EastMoney advanced actions to API stats without persisting reusable rows", async () => {
    fetchDragonTiger.mockRejectedValue(new Error("socket hang up"));
    fetchNorthboundFlow.mockRejectedValue(new Error("upstream timeout"));
    fetchNorthboundHolding.mockRejectedValue(
      new Error("connection reset by peer"),
    );
    fetchHotRank.mockRejectedValue(new Error("socket hang up"));
    fetchFlowRanking.mockRejectedValue(new Error("request aborted"));
    fetchLimitDownPool.mockRejectedValue(new Error("503 Service Unavailable"));
    fetchUnusualActivity.mockRejectedValue(
      new Error("Empty reply from server"),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "dragon-fail",
        {
          action: "dragon_tiger",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Dragon tiger fetch failed/);
    await expect(
      tool.call(
        "northbound-flow-fail",
        {
          action: "northbound",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Northbound flow fetch failed/);
    await expect(
      tool.call(
        "northbound-holding-fail",
        {
          action: "northbound",
          code: "600519",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Northbound holding fetch failed/);
    await expect(
      tool.call(
        "hot-rank-fail",
        {
          action: "hot_rank",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Hot rank fetch failed/);
    await expect(
      tool.call(
        "flow-rank-fail",
        {
          action: "flow_rank",
          limit: 1,
        },
        ctx,
      ),
    ).rejects.toThrow(/Flow rank fetch failed/);
    await expect(
      tool.call(
        "limit-down-fail",
        {
          action: "limit_down",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Limit-down pool fetch failed/);
    await expect(
      tool.call(
        "unusual-fail",
        {
          action: "unusual",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/Unusual activity fetch failed/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM dragon_tiger"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM northbound_flow"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM northbound_holding"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM hot_rank"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM flow_rank"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM limit_pool"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM unusual_activity"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM stock_list"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM raw_api_payload WHERE source = ?",
        "eastmoney",
      ),
    ).toHaveLength(0);

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.dragon_tiger",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "dragon_tiger",
        endpoint: "market.dragon_tiger",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.northbound_flow",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "northbound_flow",
        endpoint: "market.northbound_flow",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.northbound_holding",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "northbound_holding",
        endpoint: "market.northbound_holding",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.hot_rank",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "hot_rank",
        endpoint: "market.hot_rank",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.flow_rank",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "flow_rank",
        endpoint: "market.flow_rank",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.limit_pool",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "limit_down",
        endpoint: "market.limit_pool",
        success: 0,
      }),
    ]);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "eastmoney",
        "market.unusual_activity",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "eastmoney",
        tool: "MarketData",
        action: "unusual",
        endpoint: "market.unusual_activity",
        success: 0,
      }),
    ]);
  });

  it("persists direct MarketData tdx block calls into canonical block-member rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/block")) {
          expect(url).toContain("filename=block_gn.dat");
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  BlockName: "白酒",
                  BlockType: 2,
                  Code: "600519",
                  Name: "贵州茅台",
                },
                {
                  BlockName: "白酒",
                  BlockType: 2,
                  Code: "000858",
                  Name: "五粮液",
                },
              ],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    const output = await tool.call(
      "tdx-block",
      {
        action: "tdx_block",
        code: "600519",
        filename: "block_gn.dat",
        blockName: "白酒",
        limit: 5,
      },
      ctx,
    );

    expect(JSON.parse(output).List).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tdx_block_member WHERE code = ?",
        "600519",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_code: "block_gn.dat:白酒",
          block_name: "白酒",
          code: "600519",
          source: "tdx",
        }),
      ]),
    );

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);
    await expect(
      dataStoreTool.call(
        "q-tdx-block",
        {
          action: "query_tdx_block_member",
          block_code: "block_gn.dat:白酒",
        },
        ctx,
      ),
    ).resolves.toContain("block_gn.dat:白酒");
  });

  it("persists direct MarketData tdx company info calls into canonical company-info rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/company_categories")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  Title: "所属行业",
                  Filename: "industry.txt",
                },
                {
                  Title: "地区",
                  Filename: "region.txt",
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/company_content")) {
          if (url.includes("filename=industry.txt")) {
            return {
              ok: true,
              text: async () => "白酒行业龙头，公司治理稳健。",
            } as Response;
          }
          if (url.includes("filename=region.txt")) {
            return {
              ok: true,
              text: async () => "注册地位于贵州省遵义市仁怀市。",
            } as Response;
          }
          return {
            ok: false,
            status: 404,
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    const output = await tool.call(
      "tdx-company-info",
      {
        action: "tdx_company_info",
        code: "600519",
      },
      ctx,
    );
    const payload = JSON.parse(output);
    expect(payload.action).toBe("tdx_company_info");
    expect(payload.categories).toHaveLength(2);
    expect(payload.first_content).toContain("白酒行业龙头");

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ? ORDER BY info_type, title",
        "600519",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          info_type: "company_categories",
          title: "所属行业",
          source: "tdx",
        }),
        expect.objectContaining({
          code: "600519",
          info_type: "company_categories",
          title: "地区",
          source: "tdx",
        }),
        expect.objectContaining({
          code: "600519",
          info_type: "company_content:所属行业",
          title: "所属行业",
          source: "tdx",
        }),
        expect.objectContaining({
          code: "600519",
          info_type: "company_content:地区",
          title: "地区",
          source: "tdx",
        }),
      ]),
    );
  });

  it("logs failed direct MarketData TDX calls to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "tdx-fail",
        {
          action: "tdx_tick_chart",
          code: "600519",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/TDX request failed/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM tick_chart_intraday"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM raw_api_payload"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "tdx",
        "tick_chart",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "tdx",
        tool: "MarketData",
        action: "tdx",
        endpoint: "tick_chart",
        success: 0,
      }),
    ]);
  });

  it("logs failed direct MarketData TDX action family to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    for (const call of [
      { action: "tdx_tick_chart", code: "600519", limit: 5 },
      { action: "tdx_transactions", code: "600519", limit: 5 },
      { action: "tdx_finance", code: "600519", limit: 5 },
      { action: "tdx_xdxr", code: "600519", limit: 5 },
      { action: "tdx_unusual", limit: 5 },
      { action: "tdx_index_info", code: "000001", limit: 5 },
      { action: "tdx_count", market: "1", limit: 5 },
      { action: "tdx_sampling", code: "000001", limit: 5 },
      { action: "tdx_stock_list", limit: 5 },
      {
        action: "tdx_block",
        code: "600519",
        filename: "block_gn.dat",
        blockName: "白酒",
        limit: 5,
      },
      { action: "tdx_company_info", code: "600519", limit: 5 },
    ] as Array<Record<string, unknown>>) {
      await expect(
        tool.call(`tdx-family-${call.action}`, call, ctx),
      ).rejects.toThrow();
    }

    for (const table of [
      "tick_chart_intraday",
      "transactions",
      "stock_company_info",
      "fundamental",
      "xdxr_event",
      "unusual_activity",
      "quote_snapshot",
      "stock_list",
      "tdx_security_count",
      "tdx_chart_sampling",
      "tdx_block_member",
      "raw_api_payload",
    ]) {
      expect(
        store.query<Record<string, unknown>>(`SELECT * FROM ${table}`),
      ).toHaveLength(0);
    }

    const logRows = store.query<Record<string, unknown>>(
      "SELECT source, tool, action, endpoint, success FROM api_call_log WHERE source = ? ORDER BY id ASC",
      "tdx",
    );
    expect(logRows).toHaveLength(11);
    expect(logRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "tick_chart",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "transactions",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "finance",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "xdxr",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "unusual",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "index_info",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "count",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "chart_sampling",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "stock_list",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "block",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx",
          tool: "MarketData",
          action: "tdx",
          endpoint: "company_info",
          success: 0,
        }),
      ]),
    );
  });

  it("logs failed direct MarketData ExQuote calls to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset by peer");
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await expect(
      tool.call(
        "ex-fail",
        {
          action: "ex_quote",
          code: "RBL8",
          category: "30",
          limit: 5,
        },
        ctx,
      ),
    ).rejects.toThrow(/ExQuote request failed/);

    expect(
      store.query<Record<string, unknown>>("SELECT * FROM quote_snapshot"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM raw_api_payload"),
    ).toHaveLength(0);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM api_call_log WHERE source = ? AND endpoint = ?",
        "tdx:ex",
        "quote",
      ),
    ).toEqual([
      expect.objectContaining({
        source: "tdx:ex",
        tool: "MarketData",
        action: "ex",
        endpoint: "quote",
        success: 0,
      }),
    ]);
  });

  it("logs failed direct MarketData ExTDX action family to API stats without persisting reusable rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset by peer");
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    for (const call of [
      { action: "ex_categories", limit: 5 },
      { action: "ex_count", limit: 5 },
      { action: "ex_sampling", code: "RBL8", category: "30", limit: 5 },
      { action: "ex_table", limit: 5 },
      { action: "ex_quote", code: "RBL8", category: "30", limit: 5 },
      { action: "ex_kline", code: "RBL8", category: "30", limit: 5 },
      { action: "ex_list", category: "30", limit: 5 },
    ] as Array<Record<string, unknown>>) {
      await expect(
        tool.call(`ex-family-${call.action}`, call, ctx),
      ).rejects.toThrow();
    }

    for (const table of [
      "ex_category",
      "tdx_security_count",
      "tdx_chart_sampling",
      "ex_table_entry",
      "quote_snapshot",
      "kline_daily",
      "stock_list",
      "raw_api_payload",
    ]) {
      expect(
        store.query<Record<string, unknown>>(`SELECT * FROM ${table}`),
      ).toHaveLength(0);
    }

    const logRows = store.query<Record<string, unknown>>(
      "SELECT source, tool, action, endpoint, success FROM api_call_log WHERE source = ? ORDER BY id ASC",
      "tdx:ex",
    );
    expect(logRows).toHaveLength(7);
    expect(logRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "categories",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "count",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "chart_sampling",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "table",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "quote",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "kline",
          success: 0,
        }),
        expect.objectContaining({
          source: "tdx:ex",
          tool: "MarketData",
          action: "ex",
          endpoint: "list",
          success: 0,
        }),
      ]),
    );
  });

  it("persists gotdx direct TDX and ExQuote actions into canonical tables", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tick_chart")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  Code: "600519",
                  DateTime: "2026-06-05 09:31:00",
                  Price: 1280,
                  AvgPrice: 1280.5,
                  Vol: 20,
                  Amount: 25600,
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/transactions")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  Code: "600519",
                  DateTime: "2026-06-05 09:32:00",
                  Price: 1281,
                  Vol: 3,
                  Direction: "B",
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/finance")) {
          return {
            ok: true,
            json: async () => ({
              CompanyName: "贵州茅台酒股份有限公司",
              UpdatedDate: 20260605,
              EPS: 68.9,
              TotalAssets: 280000000000,
              CurrentLiabilities: 35000000000,
              LongTermLiabilities: 15000000000,
              OperatingRevenue: 174100000000,
              NetProfit: 86000000000,
            }),
          } as Response;
        }
        if (url.includes("/api/xdxr")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  date: "2026-06-05",
                  category: 1,
                  categoryName: "除权除息",
                  a: 10,
                  b: 1.2,
                  c: 0,
                  d: 0.5,
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/unusual")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  Code: "600519",
                  Name: "贵州茅台",
                  Market: 1,
                  Time: "09:30:15",
                  Desc: "加速拉升",
                  UnusualType: 4,
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/count")) {
          return {
            ok: true,
            json: async () => ({
              Count: 5321,
            }),
          } as Response;
        }
        if (url.includes("/api/chart_sampling")) {
          return {
            ok: true,
            json: async () => ({
              PreClose: 10,
              Prices: [10.1, 10.2, 9.9],
            }),
          } as Response;
        }
        if (url.includes("/api/stock_list")) {
          return {
            ok: true,
            json: async () => ({
              List: [{ Code: "000001", Name: "平安银行" }],
            }),
          } as Response;
        }
        if (url.includes("/api/ex/quote")) {
          return {
            ok: true,
            json: async () => ({
              Code: "RBL8",
              Close: 3635,
              Open: 3610,
              High: 3650,
              Low: 3580,
              Vol: 10000,
              Amount: 1200000,
            }),
          } as Response;
        }
        if (url.includes("/api/ex/kline")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                {
                  DateTime: "2026-06-05 15:00:00",
                  Open: 3600,
                  High: 3650,
                  Low: 3580,
                  Close: 3635,
                  Vol: 10000,
                  Amount: 1200000,
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/ex/list")) {
          return {
            ok: true,
            json: async () => ({
              List: [
                { Market: 31, Category: 30, Code: "RBL8", Name: "螺纹连续" },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/ex/categories")) {
          return {
            ok: true,
            json: async () => ({
              List: [{ Category: 30, Name: "国内期货", Abbr: "FUT" }],
            }),
          } as Response;
        }
        if (url.includes("/api/ex/count")) {
          return {
            ok: true,
            json: async () => ({
              Count: 8842,
            }),
          } as Response;
        }
        if (url.includes("/api/ex/chart_sampling")) {
          return {
            ok: true,
            json: async () => ({
              Prices: [3620.0, 3632.5],
            }),
          } as Response;
        }
        if (url.includes("/api/ex/table")) {
          return {
            ok: true,
            json: async () => ({
              data: "30#RBL8|螺纹连续,31#IFL8|沪深主连,",
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { MarketDataTool } =
      await import("../../src/agent/tools/market-data");
    const tool = new MarketDataTool();
    const ctx = makeCtx(basePath);

    await tool.call(
      "tdx-tick",
      { action: "tdx_tick_chart", code: "600519", limit: 5 },
      ctx,
    );
    await tool.call(
      "tdx-trans",
      { action: "tdx_transactions", code: "600519", limit: 5 },
      ctx,
    );
    await tool.call(
      "tdx-fin",
      { action: "tdx_finance", code: "600519", limit: 5 },
      ctx,
    );
    await tool.call(
      "tdx-xdxr",
      { action: "tdx_xdxr", code: "600519", limit: 5 },
      ctx,
    );
    await tool.call("tdx-unusual", { action: "tdx_unusual", limit: 5 }, ctx);
    await tool.call(
      "tdx-count",
      { action: "tdx_count", market: "1", limit: 5 },
      ctx,
    );
    await tool.call(
      "tdx-sampling",
      { action: "tdx_sampling", code: "000001", limit: 5 },
      ctx,
    );
    await tool.call("tdx-list", { action: "tdx_stock_list", limit: 5 }, ctx);
    await tool.call(
      "ex-categories",
      { action: "ex_categories", limit: 5 },
      ctx,
    );
    await tool.call("ex-count", { action: "ex_count", limit: 5 }, ctx);
    await tool.call(
      "ex-sampling",
      { action: "ex_sampling", code: "RBL8", category: "30", limit: 5 },
      ctx,
    );
    await tool.call("ex-table", { action: "ex_table", limit: 5 }, ctx);
    await tool.call(
      "ex-quote",
      { action: "ex_quote", code: "RBL8", category: "30", limit: 5 },
      ctx,
    );
    await tool.call(
      "ex-kline",
      { action: "ex_kline", code: "RBL8", category: "30", limit: 5 },
      ctx,
    );
    await tool.call(
      "ex-list",
      { action: "ex_list", category: "30", limit: 5 },
      ctx,
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tick_chart_intraday WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM transactions WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM fundamental WHERE code = ?",
        "600519",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          report_date: "2026-06-05",
          revenue: 174100000000,
          net_profit: 86000000000,
          total_liabilities: 50000000000,
          source: "tdx",
        }),
      ]),
    );
    expect(store.queryStockList({ type: "stock" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          name: "贵州茅台",
          market: "SH",
          stock_type: "stock",
        }),
      ]),
    );
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM xdxr_event WHERE code = ?",
        "600519",
      ),
    ).toHaveLength(1);
    expect(store.queryUnusualActivity("600519", undefined, 5)).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tdx_security_count WHERE scope = ?",
        "main",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tdx_chart_sampling WHERE scope = ? AND code = ?",
        "main",
        "000001",
      ),
    ).toHaveLength(3);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_list WHERE code = ?",
        "000001",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>("SELECT * FROM ex_category"),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tdx_security_count WHERE scope = ?",
        "ex",
      ),
    ).toHaveLength(1);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM tdx_chart_sampling WHERE scope = ? AND code = ?",
        "ex",
        "RBL8",
      ),
    ).toHaveLength(2);
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM ex_table_entry WHERE code = ?",
        "RBL8",
      ),
    ).toHaveLength(1);
    expect(store.queryQuoteSnapshots("RBL8", 5)).toHaveLength(1);
    expect(store.queryKline("RBL8", { adjust: "none", limit: 5 })).toHaveLength(
      1,
    );
    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_list WHERE code = ?",
        "RBL8",
      ),
    ).toHaveLength(1);
    store.saveSectorRanking("2026-06-19", "industry", [
      {
        code: "BK0477",
        name: "酿酒行业",
        change_pct: 2.34,
        turnover_rate: null,
        up_count: 9,
        down_count: 1,
        leading_stock: null,
        leading_pct: null,
        rank: 1,
        source: "eastmoney",
      },
    ]);
    store.saveIndustryMap([
      {
        code: "600519",
        industry_l1: "酿酒行业",
        industry_l2: null,
        industry_l3: null,
        updated_at: "2026-06-19T10:00:00.000Z",
      },
    ]);

    const { DataStoreTool } =
      await import("../../src/agent/tools/data-store-tool");
    const dataStoreTool = new DataStoreTool();
    dataStoreTool.setDataStore(store);

    await expect(
      dataStoreTool.call(
        "q-tdx-tick",
        { action: "query_tick_chart", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 tick chart");
    await expect(
      dataStoreTool.call(
        "q-tdx-trans",
        { action: "query_transactions", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 transactions");
    await expect(
      dataStoreTool.call(
        "q-tdx-fund",
        { action: "query_stock_daily_valuation", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 stock.daily_valuation");
    await expect(
      dataStoreTool.call(
        "q-tdx-fund-evidence",
        { action: "query_stock_daily_valuation", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("kind\":\"valuation_analysis");
    await expect(
      dataStoreTool.call(
        "q-tdx-fund-compat",
        { action: "query_fundamental", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 fundamentals");
    const sectorReadback = await dataStoreTool.call(
      "q-sector-ranking",
      { action: "query_sector_ranking", type: "industry" },
      ctx,
    );
    expect(sectorReadback).toContain("interface:market.sector_ranking");
    expect(sectorReadback).toContain("analysisEvidence");
    expect(sectorReadback).toContain("kind\":\"sector_analysis");
    await expect(
      dataStoreTool.call(
        "q-sector-board",
        { action: "query_board_ranking", boardType: "industry" },
        ctx,
      ),
    ).resolves.toContain("interface:market.board_ranking");
    store.saveSectorRanking("2026-06-20", "concept", [
      {
        code: "10009888",
        name: "上证50沽26年7月2550",
        change_pct: 18.2,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: null,
        leading_pct: null,
        rank: 1,
        source: "cache",
      },
      {
        code: "688411",
        name: "N惠科",
        change_pct: 240.1,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: null,
        leading_pct: null,
        rank: 2,
        source: "cache",
      },
    ]);
    await expect(
      dataStoreTool.call(
        "q-sector-ranking-filtered",
        { action: "query_sector_ranking", type: "concept" },
        ctx,
      ),
    ).resolves.toContain("No reliable sector ranking rows");
    await expect(
      dataStoreTool.call(
        "q-board-ranking-filters-unreliable",
        { action: "query_board_ranking", boardType: "concept" },
        ctx,
      ),
    ).resolves.toContain("No reliable board ranking rows");
    await expect(
      dataStoreTool.call(
        "q-board-members",
        { action: "query_board_members", boardName: "酿酒" },
        ctx,
      ),
    ).resolves.toContain("interface:market.board_members");
    await expect(
      dataStoreTool.call(
        "q-sector-constituents",
        { action: "query_sector_constituents", sectorName: "酿酒" },
        ctx,
      ),
    ).resolves.toContain("interface:market.sector_constituents");
    await expect(
      dataStoreTool.call(
        "q-tdx-company",
        { action: "query_stock_company_info", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 stock.company_info");
    await expect(
      dataStoreTool.call(
        "q-tdx-company-compat",
        { action: "query_company_info", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 company info");
    await expect(
      dataStoreTool.call(
        "q-tdx-xdxr",
        { action: "query_xdxr", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("600519 XDXR events");
    await expect(
      dataStoreTool.call(
        "q-tdx-unusual",
        { action: "query_unusual", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("Unusual activity");
    await expect(
      dataStoreTool.call(
        "q-tdx-count",
        { action: "query_tdx_count", scope: "main" },
        ctx,
      ),
    ).resolves.toContain("TDX security counts");
    await expect(
      dataStoreTool.call(
        "q-tdx-sampling",
        { action: "query_tdx_sampling", code: "000001" },
        ctx,
      ),
    ).resolves.toContain("TDX chart sampling");
    const stockListReadback = await dataStoreTool.call(
      "q-tdx-list",
      { action: "stock_list", market: "SZ", type: "stock" },
      ctx,
    );
    expect(stockListReadback).toContain("000001 平安银行 [SZ]");
    expect(stockListReadback).toContain("interface:stock.identity_list");
    expect(stockListReadback).toContain("schema:stock_list");
    await expect(
      dataStoreTool.call(
        "q-ex-categories",
        { action: "query_ex_categories" },
        ctx,
      ),
    ).resolves.toContain("ExTDX categories");
    await expect(
      dataStoreTool.call(
        "q-ex-count",
        { action: "query_tdx_count", scope: "ex" },
        ctx,
      ),
    ).resolves.toContain("TDX security counts");
    await expect(
      dataStoreTool.call(
        "q-ex-sampling",
        { action: "query_tdx_sampling", code: "RBL8", scope: "ex" },
        ctx,
      ),
    ).resolves.toContain("TDX chart sampling");
    await expect(
      dataStoreTool.call(
        "q-ex-table",
        { action: "query_ex_table", code: "RBL8" },
        ctx,
      ),
    ).resolves.toContain("ExTDX table");
    await expect(
      dataStoreTool.call(
        "q-ex-quote",
        { action: "query_quote", code: "RBL8" },
        ctx,
      ),
    ).resolves.toContain("RBL8 quote snapshots");
    await expect(
      dataStoreTool.call(
        "q-ex-kline",
        { action: "query_kline", code: "RBL8", adjust: "none" },
        ctx,
      ),
    ).resolves.toContain("RBL8 daily kline");
    const exListReadback = await dataStoreTool.call(
      "q-ex-list",
      { action: "stock_list", market: "EXT:30", type: "extended" },
      ctx,
    );
    expect(exListReadback).toContain("RBL8 螺纹连续 [EXT:30]");
    expect(exListReadback).toContain("interface:stock.identity_list");
  });
});
