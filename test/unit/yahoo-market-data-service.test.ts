import { beforeEach, describe, expect, it, vi } from "vitest";

describe("YahooMarketDataService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("persists yahoo quote/history/news through the repository boundary", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooPrice: vi.fn(async () => ({ symbol: "AAPL", price: 213.4 })),
      getYahooHistory: vi.fn(async () => [
        {
          date: "2026-06-01",
          open: 210,
          close: 213.4,
          high: 214,
          low: 209,
          volume: 1000,
        },
      ]),
      getYahooNews: vi.fn(async () => [{ title: "Apple update" }]),
      getYahooEarnings: vi.fn(async () => null),
      getYahooOptions: vi.fn(async () => []),
      getYahooOptionChain: vi.fn(async () => null),
      getYahooActions: vi.fn(async () => null),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();
    const ctx = { basePath: "/tmp" } as any;

    await expect(
      service.readAction("yahoo", {}, ctx, "AAPL", 5),
    ).resolves.toContain("price: 213.4");
    await expect(
      service.readAction("yahoo_history", { range: "5d" }, ctx, "AAPL", 5),
    ).resolves.toContain("Yahoo AAPL (5d, 1 bars)");
    const news = await service.readAction("yahoo_news", {}, ctx, "AAPL", 5);
    expect(news).toContain('"interfaceId": "global.finance_news"');
    expect(news).toContain('"providerId": "yahoo"');
    expect(news).toContain('"providerStatus": "global-only"');
    expect(news).toContain('"globalOnly": true');

    expect(ingest).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        provider: "yfinance",
        endpoint: "fast_info",
        code: "AAPL",
      }),
    );
    expect(ingest).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        provider: "yfinance",
        endpoint: "history",
        code: "AAPL",
      }),
    );
    expect(ingest).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        provider: "yfinance",
        endpoint: "news",
        code: "AAPL",
      }),
    );
    expect(recordApiCall).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        source: "yfinance",
        provider: "yahoo",
        interface_id: "global.finance_news",
        capability_id: "yahoo.global.finance_news",
        action: "yahoo_news",
        success: true,
      }),
    );
  });

  it("rejects A-share 6-digit symbols before Yahoo provider calls", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    const getYahooPrice = vi.fn(async () => ({ symbol: "600519", price: 1 }));
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooPrice,
      getYahooHistory: vi.fn(),
      getYahooNews: vi.fn(),
      getYahooEarnings: vi.fn(),
      getYahooOptions: vi.fn(),
      getYahooOptionChain: vi.fn(),
      getYahooActions: vi.fn(),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();

    await expect(
      service.readAction("yahoo", {}, { basePath: "/tmp" } as any, "600519", 5),
    ).rejects.toThrow(/global-only.*A-share 6-digit symbol 600519/);
    expect(getYahooPrice).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
    expect(recordApiCall).not.toHaveBeenCalled();
  });

  it("routes yahoo earnings through global research interfaces with provenance", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock(
      "../../src/agent/data/data-api-interface-cache",
      async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("../../src/agent/data/data-api-interface-cache")
          >();
        return {
          ...actual,
          readYfinanceResearchRows: vi.fn((symbol: string, dataset: string) => {
            if (symbol !== "AAPL") return [];
            if (dataset === "profile")
              return [
                {
                  symbol: "AAPL",
                  field_key: "longName",
                  field_value: "Apple Inc.",
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "statements")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "financials",
                  period: "2025-12-31",
                  item: "Revenue",
                  value: 100,
                },
              ];
            if (dataset === "earnings_calendar")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_dates",
                  period: "2026Q1",
                  item: "reportDate",
                  value: "2026-07-20",
                },
              ];
            if (dataset === "earnings_history")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_history",
                  period: "2026Q1",
                  item: "epsActual",
                  value: 1.52,
                },
              ];
            if (dataset === "earnings_estimates")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_estimate",
                  period: "2026Q2",
                  item: "epsAvg",
                  value: 1.64,
                },
              ];
            if (dataset === "eps_revisions")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "eps_revisions",
                  period: "2026Q2",
                  item: "upLast7days",
                  value: 3,
                },
              ];
            if (dataset === "eps_trend")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "eps_trend",
                  period: "2026Q2",
                  item: "current",
                  value: 1.66,
                },
              ];
            if (dataset === "quarterly_financial_statements")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "quarterly_cash_flow",
                  period: "2026Q1",
                  item: "freeCashFlow",
                  value: 24_000_000_000,
                },
              ];
            if (dataset === "recommendations")
              return [
                {
                  symbol: "AAPL",
                  period: "0m",
                  buy: 10,
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "upgrade_downgrade_events")
              return [
                {
                  symbol: "AAPL",
                  period: "0m",
                  buy: 10,
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "institutional_holders",
                  holder_name: "Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "major_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "major_holders",
                  holder_name: "Major Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "institutional_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "institutional_holders",
                  holder_name: "Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "mutual_fund_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "mutualfund_holders",
                  holder_name: "Fund Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "insiders")
              return [
                {
                  symbol: "AAPL",
                  transaction_id: "t1",
                  insider: "Insider",
                  start_date: "2026-01-02",
                },
              ];
            return [];
          }),
        };
      },
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooEarnings: vi.fn(async () => ({
        info: { longName: "Apple Inc." },
        incomeStatementHistory: {
          incomeStatementHistory: [{ _index: "Revenue", "2025-12-31": 100 }],
        },
        balanceSheetHistory: { balanceSheetStatements: [] },
        cashflowStatementHistory: { cashflowStatements: [] },
        recommendationTrend: { trend: [{ period: "0m", buy: 10 }] },
        institutionOwnership: { ownershipList: [{ holder: "Holder" }] },
        fundOwnership: { ownershipList: [] },
        insiderTransactions: { transactions: [{ insider: "Insider" }] },
      })),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();
    const result = await service.readAction(
      "yahoo_earnings",
      { cacheMode: "live-only" },
      { basePath: "/tmp" } as any,
      "AAPL",
      5,
    );

    expect(result).toContain('"interfaceId": "global.company_profile"');
    expect(result).toContain('"capabilityId": "yahoo.global.company_profile"');
    expect(result).toContain('"providerId": "yahoo"');
    expect(result).toContain('"providerStatus": "global-only"');
    expect(result).toContain('"asOf": "2026Q2"');
    expect(result).toContain('"cacheStatus": "provider-hit"');
    expect(result).toContain('"interfaceId": "global.financial_statements"');
    expect(result).toContain('"earningsCalendar"');
    expect(result).toContain('"interfaceId": "global.eps_trend"');
    expect(result).toContain('"interfaceId": "global.institutional_holders"');
    expect(result).toContain('"interfaceId": "global.mutual_fund_holders"');
    expect(result).toContain('"interfaceId": "global.insider_transactions"');
    expect(ingest).toHaveBeenCalledWith(
      { basePath: "/tmp" },
      expect.objectContaining({
        provider: "yfinance",
        endpoint: "info",
        code: "AAPL",
      }),
    );
    expect(recordApiCall).toHaveBeenCalledWith(
      { basePath: "/tmp" },
      expect.objectContaining({
        source: "yfinance",
        provider: "yahoo",
        interface_id: "global.company_profile",
        capability_id: "yahoo.global.company_profile",
        action: "yahoo_earnings",
        success: true,
      }),
    );
  });

  it("reuses cached yahoo research rows before provider routing", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock(
      "../../src/agent/data/data-api-interface-cache",
      async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("../../src/agent/data/data-api-interface-cache")
          >();
        return {
          ...actual,
          readYfinanceResearchRows: vi.fn((symbol: string, dataset: string) => {
            if (symbol !== "AAPL") return [];
            if (dataset === "profile")
              return [
                {
                  symbol: "AAPL",
                  field_key: "longName",
                  field_value: "Apple Inc.",
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "statements")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "financials",
                  period: "2025-12-31",
                  item: "Revenue",
                  value: 100,
                },
              ];
            if (dataset === "earnings_calendar")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_dates",
                  period: "2026Q1",
                  item: "reportDate",
                  value: "2026-07-20",
                },
              ];
            if (dataset === "earnings_history")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_history",
                  period: "2026Q1",
                  item: "epsActual",
                  value: 1.52,
                },
              ];
            if (dataset === "earnings_estimates")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "earnings_estimate",
                  period: "2026Q2",
                  item: "epsAvg",
                  value: 1.64,
                },
              ];
            if (dataset === "eps_revisions")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "eps_revisions",
                  period: "2026Q2",
                  item: "upLast7days",
                  value: 3,
                },
              ];
            if (dataset === "eps_trend")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "eps_trend",
                  period: "2026Q2",
                  item: "current",
                  value: 1.66,
                },
              ];
            if (dataset === "quarterly_financial_statements")
              return [
                {
                  symbol: "AAPL",
                  statement_type: "quarterly_cash_flow",
                  period: "2026Q1",
                  item: "freeCashFlow",
                  value: 24_000_000_000,
                },
              ];
            if (dataset === "recommendations")
              return [
                {
                  symbol: "AAPL",
                  period: "0m",
                  buy: 10,
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "upgrade_downgrade_events")
              return [
                {
                  symbol: "AAPL",
                  period: "0m",
                  buy: 10,
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            if (dataset === "holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "institutional_holders",
                  holder_name: "Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "major_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "major_holders",
                  holder_name: "Major Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "institutional_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "institutional_holders",
                  holder_name: "Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "mutual_fund_holders")
              return [
                {
                  symbol: "AAPL",
                  holder_type: "mutualfund_holders",
                  holder_name: "Fund Holder",
                  reported_date: "2026-03-31",
                },
              ];
            if (dataset === "insiders")
              return [
                {
                  symbol: "AAPL",
                  transaction_id: "t1",
                  insider: "Insider",
                  start_date: "2026-01-02",
                },
              ];
            return [];
          }),
        };
      },
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooEarnings: vi.fn(async () => {
        throw new Error("should not call provider");
      }),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();
    const result = await service.readAction(
      "yahoo_earnings",
      {},
      { basePath: "/tmp" } as any,
      "AAPL",
      5,
    );

    expect(result).toContain('"cacheStatus": "cache-hit"');
    expect(result).toContain('"capabilityId": "local.cache"');
    expect(result).toContain('"provider": "local"');
    expect(result).toContain('"providerId": "yahoo"');
    expect(result).toContain('"providerStatus": "global-only"');
    expect(result).toContain('"asOf": "2026Q2"');
    expect(ingest).not.toHaveBeenCalled();
    expect(recordApiCall).not.toHaveBeenCalled();
  });

  it("routes governed yahoo statement slices through explicit interfaces", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock(
      "../../src/agent/data/data-api-interface-cache",
      async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("../../src/agent/data/data-api-interface-cache")
          >();
        return {
          ...actual,
          readYfinanceResearchRows: vi.fn((symbol: string, dataset: string) => {
            if (symbol !== "AAPL") return [];
            if (dataset === "income_statement") {
              return [
                {
                  symbol: "AAPL",
                  statement_type: "income",
                  period: "2025-12-31",
                  item: "Revenue",
                  value: 100,
                  updated_at: "2026-06-18T01:00:00Z",
                },
              ];
            }
            return [];
          }),
        };
      },
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooEarnings: vi.fn(async () => ({
        info: { longName: "Apple Inc." },
        incomeStatementHistory: {
          incomeStatementHistory: [{ _index: "Revenue", "2025-12-31": 100 }],
        },
        balanceSheetHistory: { balanceSheetStatements: [] },
        cashflowStatementHistory: { cashflowStatements: [] },
        recommendationTrend: { trend: [] },
        institutionOwnership: { ownershipList: [] },
        fundOwnership: { ownershipList: [] },
        insiderTransactions: { transactions: [] },
      })),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();
    const result = await service.readAction(
      "global_income_statement",
      { cacheMode: "live-only" },
      { basePath: "/tmp" } as any,
      "AAPL",
      5,
    );

    expect(result).toContain('"interfaceId": "global.income_statement"');
    expect(result).toContain('"capabilityId": "yahoo.global.income_statement"');
    expect(result).toContain('"providerId": "yahoo"');
    expect(result).toContain('"canonicalTable": "yfinance_statement_items"');
    expect(result).toContain('"cacheStatus": "provider-hit"');
    expect(ingest).toHaveBeenCalledWith(
      { basePath: "/tmp" },
      expect.objectContaining({
        provider: "yfinance",
        endpoint: "financials",
        code: "AAPL",
      }),
    );
    expect(recordApiCall).toHaveBeenCalledWith(
      { basePath: "/tmp" },
      expect.objectContaining({
        source: "yfinance",
        provider: "yahoo",
        interface_id: "global.income_statement",
        capability_id: "yahoo.global.income_statement",
        action: "yahoo_earnings",
        success: true,
      }),
    );
  });

  it("gates repeated yahoo earnings failures after cache misses", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    const readEarnings = vi.fn(async () => {
      throw new Error("Yahoo upstream returned 429 Too Many Requests");
    });
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock(
      "../../src/agent/data/data-api-interface-cache",
      async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("../../src/agent/data/data-api-interface-cache")
          >();
        return {
          ...actual,
          readYfinanceResearchRows: vi.fn(() => []),
        };
      },
    );

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService({
      readPrice: vi.fn(),
      readHistory: vi.fn(),
      readEarnings,
      readNews: vi.fn(),
      readOptionExpiries: vi.fn(),
      readOptionChain: vi.fn(),
      readActions: vi.fn(),
    } as any);
    const ctx = { basePath: "/tmp" } as any;

    await expect(
      service.readAction("yahoo_earnings", {}, ctx, "AAPL", 5),
    ).rejects.toThrow(
      /Yahoo earnings fetch failed: Yahoo upstream returned 429 Too Many Requests/,
    );
    await expect(
      service.readAction("yahoo_earnings", {}, ctx, "AAPL", 5),
    ).rejects.toThrow(/provider gate open.*quota-gated/);

    expect(readEarnings).toHaveBeenCalledTimes(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(recordApiCall).toHaveBeenCalledTimes(2);
    expect(recordApiCall).toHaveBeenNthCalledWith(
      1,
      ctx,
      expect.objectContaining({
        source: "yfinance",
        provider: "yahoo",
        interface_id: "global.company_profile",
        capability_id: "yahoo.global.company_profile",
        action: "yahoo_earnings",
        success: false,
        error: "Yahoo upstream returned 429 Too Many Requests",
      }),
    );
    expect(recordApiCall).toHaveBeenNthCalledWith(
      2,
      ctx,
      expect.objectContaining({
        source: "yfinance",
        provider: "yahoo",
        interface_id: "global.company_profile",
        capability_id: "yahoo.global.company_profile",
        action: "yahoo_earnings",
        success: false,
        error: expect.stringContaining("provider gate open"),
      }),
    );
  });

  it("records yahoo failures through the repository boundary", async () => {
    const ingest = vi.fn();
    const recordApiCall = vi.fn();
    vi.doMock(
      "../../src/domain/market/repositories/yahoo-market-data-repository",
      () => ({
        YahooMarketDataRepository: class {
          ingest = ingest;
          recordApiCall = recordApiCall;
        },
      }),
    );
    vi.doMock("../../src/agent/data/data-manager", () => ({
      getYahooPrice: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    }));

    const { YahooMarketDataService } =
      await import("../../src/domain/market/services/yahoo-market-data-service");
    const service = new YahooMarketDataService();

    await expect(
      service.readAction("yahoo", {}, { basePath: "/tmp" } as any, "AAPL", 5),
    ).rejects.toThrow(/Yahoo quote fetch failed: socket hang up/);
    expect(ingest).not.toHaveBeenCalled();
    expect(recordApiCall).toHaveBeenCalledWith(
      { basePath: "/tmp" },
      expect.objectContaining({
        source: "yfinance",
        tool: "MarketData",
        action: "yahoo",
        endpoint: "yahoo",
        success: false,
      }),
    );
  });
});
