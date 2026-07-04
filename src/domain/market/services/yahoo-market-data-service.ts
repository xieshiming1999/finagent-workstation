import type { ToolContext } from "../../../agent/tool";
import {
  readYfinanceCorporateActionRows,
  readYfinanceNewsRows,
  readYfinanceOptionRows,
  readYfinanceResearchRows,
  type YfinanceResearchDataset,
} from "../../../agent/data/data-api-interface-cache";
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from "../../../agent/data/data-api-interface-router";
import type {
  DataApiProviderCapability,
  DataApiProviderMode,
} from "../../../agent/data/data-api-interface-contract";
import type { DataApiCacheMode } from "../../../agent/data/data-api-cache-policy";
import { fmtNum, fmtVol } from "../../../agent/tools/market-data-utils";
import {
  DefaultYahooMarketDataProvider,
  type YahooMarketDataProvider,
} from "../providers/yahoo-market-data-provider";
import { YahooMarketDataRepository } from "../repositories/yahoo-market-data-repository";
import { readYahooOptionDailyKline } from "./yahoo-option-daily-kline-service";

export interface YahooOptionsResult {
  expiries: string[];
  selectedExpiry: string | null;
  optionChain: Record<string, unknown> | null;
}

export interface YahooActionsResult {
  dividends: unknown[];
  splits: unknown[];
  capitalGains: unknown[];
}

interface YahooResearchBundle {
  profile: Array<Record<string, unknown>>;
  statements: Array<Record<string, unknown>>;
  earningsCalendar: Array<Record<string, unknown>>;
  earningsHistory: Array<Record<string, unknown>>;
  earningsEstimates: Array<Record<string, unknown>>;
  epsRevisions: Array<Record<string, unknown>>;
  epsTrend: Array<Record<string, unknown>>;
  quarterlyFinancialStatements: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  upgradeDowngradeEvents: Array<Record<string, unknown>>;
  holders: Array<Record<string, unknown>>;
  majorHolders: Array<Record<string, unknown>>;
  institutionalHolders: Array<Record<string, unknown>>;
  mutualFundHolders: Array<Record<string, unknown>>;
  insiders: Array<Record<string, unknown>>;
}

export class YahooMarketDataService {
  private readonly repository = new YahooMarketDataRepository();
  constructor(
    private readonly provider: YahooMarketDataProvider = new DefaultYahooMarketDataProvider(),
  ) {}

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    switch (action) {
      case "yahoo":
        return this.readQuote(ctx, code);
      case "yahoo_history":
        return this.readHistory(input, ctx, code, limit);
      case "option_daily_kline":
        return this.readOptionDailyKline(input, ctx, code, limit);
      case "yahoo_earnings":
        return this.readEarnings(input, ctx, code, limit);
      case "global_income_statement":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.income_statement",
          "income_statement",
          "query_global_income_statement",
        );
      case "global_balance_sheet":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.balance_sheet",
          "balance_sheet",
          "query_global_balance_sheet",
        );
      case "global_cash_flow":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.cash_flow",
          "cash_flow",
          "query_global_cash_flow",
        );
      case "global_quarterly_income_statement":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.quarterly_income_statement",
          "quarterly_income_statement",
          "query_global_quarterly_income_statement",
        );
      case "global_quarterly_balance_sheet":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.quarterly_balance_sheet",
          "quarterly_balance_sheet",
          "query_global_quarterly_balance_sheet",
        );
      case "global_quarterly_cash_flow":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.quarterly_cash_flow",
          "quarterly_cash_flow",
          "query_global_quarterly_cash_flow",
        );
      case "global_major_holders":
        return this.readEarningsSlice(
          input,
          ctx,
          code,
          limit,
          "global.major_holders",
          "major_holders",
          "query_global_major_holders",
        );
      case "yahoo_news":
        return this.readNews(input, ctx, code, limit);
      case "yahoo_options":
        return this.readOptions(input, ctx, code, limit);
      case "yahoo_actions":
        return this.readActions(input, ctx, code, limit);
      case "global_capital_gains":
        return this.readActionSlice(
          input,
          ctx,
          code,
          limit,
          "global.capital_gains",
          "capital_gains",
          "query_global_capital_gains",
        );
      default:
        throw new Error(`Unsupported Yahoo action: ${action}`);
    }
  }

  async fetchQuote(
    ctx: ToolContext,
    code: string,
  ): Promise<Record<string, unknown> | null> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action: "yahoo", code: "AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("quote", "Yahoo quote");
    if (openGate) {
      this.recordYahooFailure(ctx, "yahoo", "yahoo", startedAt, openGate);
      throw new Error(openGate);
    }
    try {
      const data = await this.provider.readPrice(code);
      if (!data) return null;
      clearYahooGate("quote");
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "fast_info",
        payload: { symbol: code, data },
        code,
        source: "yfinance",
      });
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("quote", "Yahoo quote", message);
      this.recordYahooFailure(ctx, "yahoo", "yahoo", startedAt, message);
      throw new Error(`Yahoo quote fetch failed: ${message}`);
    }
  }

  private async readQuote(ctx: ToolContext, code: string): Promise<string> {
    const data = await this.fetchQuote(ctx, code);
    if (!data) return `No Yahoo data for ${code}`;
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  async fetchHistory(
    ctx: ToolContext,
    code: string,
    range: string,
  ): Promise<Array<Record<string, unknown>>> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action: "yahoo", code: "AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("history", "Yahoo history");
    if (openGate) {
      this.recordYahooFailure(
        ctx,
        "yahoo_history",
        "yahoo_history",
        startedAt,
        openGate,
      );
      throw new Error(openGate);
    }
    try {
      const bars = await this.provider.readHistory(code, range);
      clearYahooGate("history");
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "history",
        payload: { symbol: code, data: bars },
        params: { period: range },
        code,
        source: "yfinance",
      });
      return bars;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("history", "Yahoo history", message);
      this.recordYahooFailure(
        ctx,
        "yahoo_history",
        "yahoo_history",
        startedAt,
        message,
      );
      throw new Error(`Yahoo history fetch failed: ${message}`);
    }
  }

  private async readHistory(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const range = String(input.range ?? "6mo");
    const bars = await this.fetchHistory(ctx, code, range);
    if (bars.length === 0) return `No Yahoo history for ${code}`;
    const header = `Yahoo ${code} (${range}, ${bars.length} bars)\nDate\tOpen\tClose\tHigh\tLow\tVolume`;
    const rows = bars
      .slice(-limit)
      .map(
        (bar) =>
          `${bar.date ?? String(bar._index ?? "").slice(0, 10)}\t${fmtNum(bar.open ?? bar.Open)}\t${fmtNum(bar.close ?? bar.Close)}\t${fmtNum(bar.high ?? bar.High)}\t${fmtNum(bar.low ?? bar.Low)}\t${fmtVol(Number(bar.volume ?? bar.Volume ?? 0))}`,
      );
    return `${header}\n${rows.join("\n")}`;
  }

  private async readOptionDailyKline(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    return readYahooOptionDailyKline(this, input, ctx, code, limit);
  }

  async fetchEarnings(
    ctx: ToolContext,
    code: string,
    capability?: DataApiProviderCapability,
    interfaceId = "global.company_profile",
  ): Promise<Record<string, unknown> | null> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action: "yahoo", code: "AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("earnings", "Yahoo earnings");
    if (openGate) {
      this.recordYahooFailure(
        ctx,
        "yahoo_earnings",
        "yahoo_earnings",
        startedAt,
        openGate,
        capability,
        interfaceId,
      );
      throw new Error(openGate);
    }
    try {
      const data = await this.provider.readEarnings(code);
      if (!data) return null;
      clearYahooGate("earnings");
      const content = data as Record<string, any>;
      const profileFields = {
        ...(content.info ?? {}),
        ...(content.defaultKeyStatistics ?? {}),
        ...(content.financialData ?? {}),
        ...(content.summaryProfile ?? {}),
        ...(content.assetProfile ?? {}),
      };
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "info",
        payload: { symbol: code, data: profileFields },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "financials",
        payload: {
          symbol: code,
          data: content.incomeStatementHistory?.incomeStatementHistory ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "balance_sheet",
        payload: {
          symbol: code,
          data: content.balanceSheetHistory?.balanceSheetStatements ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "cash_flow",
        payload: {
          symbol: code,
          data: content.cashflowStatementHistory?.cashflowStatements ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "recommendations",
        payload: {
          symbol: code,
          data: content.recommendationTrend?.trend ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "major_holders",
        payload: {
          symbol: code,
          data: content.majorHoldersBreakdown ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "institutional_holders",
        payload: {
          symbol: code,
          data: content.institutionOwnership?.ownershipList ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "mutualfund_holders",
        payload: {
          symbol: code,
          data: content.fundOwnership?.ownershipList ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "insider_transactions",
        payload: {
          symbol: code,
          data: content.insiderTransactions?.transactions ?? [],
        },
        code,
        source: "yfinance",
      });
      this.repository.recordApiCall(ctx, {
        source: "yfinance",
        provider: capability?.provider ?? "yahoo",
        interface_id: capability ? interfaceId : null,
        capability_id: capability?.id ?? null,
        tool: "MarketData",
        action: "yahoo_earnings",
        endpoint: "yahoo_earnings",
        status: 200,
        success: true,
        duration_ms: Date.now() - startedAt,
      });
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("earnings", "Yahoo earnings", message);
      this.recordYahooFailure(
        ctx,
        "yahoo_earnings",
        "yahoo_earnings",
        startedAt,
        message,
        capability,
        interfaceId,
      );
      throw new Error(`Yahoo earnings fetch failed: ${message}`);
    }
  }

  private async readEarnings(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const routed = await runDataApiInterfaceRoute<YahooResearchBundle>(
      "global.company_profile",
      (capability): DataApiInterfaceRoute<YahooResearchBundle> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: async () => {
            await this.fetchEarnings(
              ctx,
              code,
              capability,
              "global.company_profile",
            );
            return readYahooResearchBundle(code, limit);
          },
        };
      },
      {
        label: "global company research",
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const bundle = readYahooResearchBundle(code, limit);
          return isCompleteYahooResearchBundle(bundle) ? bundle : null;
        },
      },
    );
    const count = yahooResearchBundleCount(routed.data);
    if (count === 0) return `No reusable Yahoo research rows for ${code}`;
    return JSON.stringify(
      {
        action: "yahoo_earnings",
        symbol: code,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(routed.data),
        canonicalSchema: "yfinance_profile_fields",
        canonicalTable: "yfinance_profile_fields",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        relatedInterfaces: [
          relatedYahooResearchInterface(
            "global.company_profile",
            "yfinance_profile_fields",
            routed.data.profile,
          ),
          relatedYahooResearchInterface(
            "global.financial_statements",
            "yfinance_statement_items",
            routed.data.statements,
          ),
          relatedYahooResearchInterface(
            "global.earnings_calendar",
            "yfinance_statement_items",
            routed.data.earningsCalendar,
          ),
          relatedYahooResearchInterface(
            "global.earnings_history",
            "yfinance_statement_items",
            routed.data.earningsHistory,
          ),
          relatedYahooResearchInterface(
            "global.earnings_estimates",
            "yfinance_statement_items",
            routed.data.earningsEstimates,
          ),
          relatedYahooResearchInterface(
            "global.eps_revisions",
            "yfinance_statement_items",
            routed.data.epsRevisions,
          ),
          relatedYahooResearchInterface(
            "global.eps_trend",
            "yfinance_statement_items",
            routed.data.epsTrend,
          ),
          relatedYahooResearchInterface(
            "global.quarterly_financial_statements",
            "yfinance_statement_items",
            routed.data.quarterlyFinancialStatements,
          ),
          relatedYahooResearchInterface(
            "global.recommendations",
            "yfinance_recommendations",
            routed.data.recommendations,
          ),
          relatedYahooResearchInterface(
            "global.upgrade_downgrade_events",
            "yfinance_recommendations",
            routed.data.upgradeDowngradeEvents,
          ),
          relatedYahooResearchInterface(
            "global.holders",
            "yfinance_holders",
            routed.data.holders,
          ),
          relatedYahooResearchInterface(
            "global.major_holders",
            "yfinance_holders",
            routed.data.majorHolders,
          ),
          relatedYahooResearchInterface(
            "global.institutional_holders",
            "yfinance_holders",
            routed.data.institutionalHolders,
          ),
          relatedYahooResearchInterface(
            "global.mutual_fund_holders",
            "yfinance_holders",
            routed.data.mutualFundHolders,
          ),
          relatedYahooResearchInterface(
            "global.insider_transactions",
            "yfinance_insider_transactions",
            routed.data.insiders,
          ),
        ],
        data: routed.data,
      },
      null,
      2,
    );
  }

  private async readEarningsSlice(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
    interfaceId: string,
    dataset: YfinanceResearchDataset,
    readbackAction: string,
  ): Promise<string> {
    const routed = await runDataApiInterfaceRoute<
      Array<Record<string, unknown>>
    >(
      interfaceId,
      (
        capability,
      ): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: async () => {
            await this.fetchEarnings(ctx, code, capability, interfaceId);
            return readYfinanceResearchRows(code, dataset, { limit });
          },
        };
      },
      {
        label: `${interfaceId} yahoo statement slice`,
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const rows = readYfinanceResearchRows(code, dataset, { limit });
          return rows.length > 0 ? rows : null;
        },
      },
    );
    if (!Array.isArray(routed.data) || routed.data.length === 0) {
      return `No reusable Yahoo statement rows for ${code} (${dataset})`;
    }
    return JSON.stringify(
      {
        action: readbackAction.replace(/^query_/, ""),
        symbol: code,
        count: routed.data.length,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(routed.data),
        canonicalSchema: "yfinance_statement_items",
        canonicalTable: "yfinance_statement_items",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        data: routed.data,
      },
      null,
      2,
    );
  }

  async fetchNews(
    ctx: ToolContext,
    code: string,
    capability?: DataApiProviderCapability,
  ): Promise<Array<Record<string, unknown>>> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action:"yahoo_news", code:"AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("news", "Yahoo news");
    if (openGate) {
      this.recordYahooFailure(
        ctx,
        "yahoo_news",
        "yahoo_news",
        startedAt,
        openGate,
        capability,
        "global.finance_news",
      );
      throw new Error(openGate);
    }
    try {
      const items = await this.provider.readNews(code);
      clearYahooGate("news");
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "news",
        payload: { symbol: code, data: items },
        code,
        source: "yfinance",
      });
      this.repository.recordApiCall(ctx, {
        source: "yfinance",
        provider: capability?.provider ?? "yahoo",
        interface_id: capability ? "global.finance_news" : null,
        capability_id: capability?.id ?? null,
        tool: "MarketData",
        action: "yahoo_news",
        endpoint: "yahoo_news",
        status: 200,
        success: true,
        duration_ms: Date.now() - startedAt,
      });
      return items;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("news", "Yahoo news", message);
      this.recordYahooFailure(
        ctx,
        "yahoo_news",
        "yahoo_news",
        startedAt,
        message,
        capability,
        "global.finance_news",
      );
      throw new Error(`Yahoo news fetch failed: ${message}`);
    }
  }

  private async readNews(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const routed = await runDataApiInterfaceRoute<
      Array<Record<string, unknown>>
    >(
      "global.finance_news",
      (
        capability,
      ): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: async () => {
            const items = await this.fetchNews(ctx, code, capability);
            const rows = readYfinanceNewsRows(code, {
              limit,
              maxAgeMs: Number.MAX_SAFE_INTEGER,
            });
            return rows.length > 0 ? rows : items.slice(0, limit);
          },
        };
      },
      {
        label: "global finance news",
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const rows = readYfinanceNewsRows(code, { limit });
          return rows.length > 0 ? rows : null;
        },
      },
    );
    if (!Array.isArray(routed.data) || routed.data.length === 0)
      return `No Yahoo news for ${code}`;
    return JSON.stringify(
      {
        action: "yahoo_news",
        symbol: code,
        count: routed.data.length,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(routed.data),
        canonicalSchema: "yfinance_news",
        canonicalTable: "yfinance_news",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        data: routed.data.slice(0, limit),
      },
      null,
      2,
    );
  }

  async fetchOptions(
    ctx: ToolContext,
    code: string,
    selectedExpiryInput?: string,
    capability?: DataApiProviderCapability,
    interfaceId = "option.chain_snapshot",
  ): Promise<YahooOptionsResult> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action:"yahoo_options", code:"AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("options", "Yahoo options");
    if (openGate) {
      this.recordYahooFailure(
        ctx,
        "yahoo_options",
        "yahoo_options",
        startedAt,
        openGate,
        capability,
        interfaceId,
      );
      throw new Error(openGate);
    }
    try {
      const expiries = await this.provider.readOptionExpiries(code);
      let selectedExpiry = selectedExpiryInput?.trim() ?? "";
      if (!selectedExpiry && expiries.length > 0)
        selectedExpiry = String(expiries[0]);
      let optionChain: Record<string, unknown> | null = null;
      this.repository.ingest(ctx, {
        provider: "yfinance",
        endpoint: "options",
        payload: { symbol: code, data: expiries },
        code,
        source: "yfinance",
      });
      if (selectedExpiry) {
        optionChain = await this.provider.readOptionChain(code, selectedExpiry);
        if (optionChain) {
          this.repository.ingest(ctx, {
            provider: "yfinance",
            endpoint: "option_chain",
            payload: { symbol: code, ...optionChain },
            params: { date: selectedExpiry },
            code,
            source: "yfinance",
          });
        }
      }
      clearYahooGate("options");
      return {
        expiries,
        selectedExpiry: selectedExpiry || null,
        optionChain,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("options", "Yahoo options", message);
      this.recordYahooFailure(
        ctx,
        "yahoo_options",
        "yahoo_options",
        startedAt,
        message,
        capability,
        interfaceId,
      );
      throw new Error(`Yahoo options fetch failed: ${message}`);
    }
  }

  private async readOptions(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const requestedExpiry =
      typeof input.expiry === "string" ? input.expiry : undefined;
    const routed = await runDataApiInterfaceRoute<YahooOptionsResult>(
      "option.chain_snapshot",
      (capability): DataApiInterfaceRoute<YahooOptionsResult> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: async () =>
            this.fetchOptions(
              ctx,
              code,
              requestedExpiry,
              capability,
              "option.chain_snapshot",
            ),
        };
      },
      {
        label: "option chain snapshot",
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const cached = readYfinanceOptionRows(code, {
            expiry: requestedExpiry,
            limit,
          });
          if (!cached) return null;
          const calls = cached.contracts.filter(
            (row) => row.option_type === "call",
          );
          const puts = cached.contracts.filter(
            (row) => row.option_type === "put",
          );
          return {
            expiries: cached.expiries,
            selectedExpiry: cached.selectedExpiry,
            optionChain: { calls, puts },
          };
        },
      },
    );
    const result = routed.data;
    if (result.expiries.length === 0 && !result.optionChain)
      return `No Yahoo option data for ${code}`;
    return JSON.stringify(
      {
        action: "yahoo_options",
        symbol: code,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(result),
        canonicalSchema: "yfinance_options",
        canonicalTable: "yfinance_option_contracts",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        expiryCount: result.expiries.length,
        expiries: result.expiries,
        selectedExpiry: result.selectedExpiry,
        calls: Array.isArray(result.optionChain?.calls)
          ? (result.optionChain.calls as Array<unknown>).slice(0, limit)
          : [],
        puts: Array.isArray(result.optionChain?.puts)
          ? (result.optionChain.puts as Array<unknown>).slice(0, limit)
          : [],
      },
      null,
      2,
    );
  }

  async fetchActions(
    ctx: ToolContext,
    code: string,
    capability?: DataApiProviderCapability,
  ): Promise<YahooActionsResult> {
    if (!code)
      throw new Error(
        'code/symbol required. Example: MarketData(action:"yahoo_actions", code:"AAPL")',
      );
    assertYahooGlobalSymbol(code);
    const startedAt = Date.now();
    const openGate = yahooGateMessage("actions", "Yahoo corporate actions");
    if (openGate) {
      this.recordYahooFailure(
        ctx,
        "yahoo_actions",
        "yahoo_actions",
        startedAt,
        openGate,
        capability,
        "global.corporate_actions",
      );
      throw new Error(openGate);
    }
    try {
      const actions = await this.provider.readActions(code);
      if (actions?.dividends) {
        this.repository.ingest(ctx, {
          provider: "yfinance",
          endpoint: "dividends",
          payload: { symbol: code, data: actions.dividends },
          code,
          source: "yfinance",
        });
      }
      if (actions?.splits) {
        this.repository.ingest(ctx, {
          provider: "yfinance",
          endpoint: "splits",
          payload: { symbol: code, data: actions.splits },
          code,
          source: "yfinance",
        });
      }
      if (actions?.capitalGains) {
        this.repository.ingest(ctx, {
          provider: "yfinance",
          endpoint: "capital_gains",
          payload: { symbol: code, data: actions.capitalGains },
          code,
          source: "yfinance",
        });
      }
      clearYahooGate("actions");
      return {
        dividends: Array.isArray(actions?.dividends) ? actions.dividends : [],
        splits: Array.isArray(actions?.splits) ? actions.splits : [],
        capitalGains: Array.isArray(actions?.capitalGains)
          ? actions.capitalGains
          : [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordYahooGate("actions", "Yahoo corporate actions", message);
      this.recordYahooFailure(
        ctx,
        "yahoo_actions",
        "yahoo_actions",
        startedAt,
        message,
        capability,
        "global.corporate_actions",
      );
      throw new Error(`Yahoo corporate actions fetch failed: ${message}`);
    }
  }

  private async readActions(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const routed = await runDataApiInterfaceRoute<YahooActionsResult>(
      "global.corporate_actions",
      (capability): DataApiInterfaceRoute<YahooActionsResult> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: () => this.fetchActions(ctx, code, capability),
        };
      },
      {
        label: "global corporate actions",
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const rows = readYfinanceCorporateActionRows(code, { limit });
          if (rows.length === 0) return null;
          return {
            dividends: rows.filter((row) =>
              String(row.action_type ?? "").includes("dividend"),
            ),
            capitalGains: rows.filter(
              (row) => String(row.action_type ?? "") === "capital_gains",
            ),
            splits: rows.filter((row) =>
              String(row.action_type ?? "").includes("split"),
            ),
          };
        },
      },
    );
    const actions = routed.data;
    if (
      actions.dividends.length === 0 &&
      actions.splits.length === 0 &&
      actions.capitalGains.length === 0
    ) {
      return `No Yahoo corporate actions for ${code}`;
    }
    return JSON.stringify(
      {
        action: "yahoo_actions",
        symbol: code,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(actions),
        canonicalSchema: "yfinance_corporate_actions",
        canonicalTable: "yfinance_corporate_actions",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        count:
          actions.dividends.length +
          actions.splits.length +
          actions.capitalGains.length,
        dividends: actions.dividends.slice(0, limit),
        capitalGains: actions.capitalGains.slice(0, limit),
        splits: actions.splits.slice(0, limit),
      },
      null,
      2,
    );
  }

  private async readActionSlice(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
    interfaceId: string,
    dataset: "capital_gains",
    readbackAction: string,
  ): Promise<string> {
    const routed = await runDataApiInterfaceRoute<
      Array<Record<string, unknown>>
    >(
      interfaceId,
      (
        capability,
      ): DataApiInterfaceRoute<Array<Record<string, unknown>>> | null => {
        if (capability.provider !== "yahoo") return null;
        return {
          capability,
          source: "yfinance",
          run: async () => {
            await this.fetchActions(ctx, code, capability);
            return readYfinanceCorporateActionRows(code, {
              limit,
              actionType: dataset,
            });
          },
        };
      },
      {
        label: `${interfaceId} yahoo action slice`,
        provider: yahooProviderConstraint(input),
        providerMode:
          typeof input.providerMode === "string"
            ? (input.providerMode as DataApiProviderMode)
            : undefined,
        cacheMode:
          typeof input.cacheMode === "string"
            ? (input.cacheMode as DataApiCacheMode)
            : undefined,
        readCache: () => {
          const rows = readYfinanceCorporateActionRows(code, {
            limit,
            actionType: dataset,
          });
          return rows.length > 0 ? rows : null;
        },
      },
    );
    if (!Array.isArray(routed.data) || routed.data.length === 0) {
      return `No reusable Yahoo action rows for ${code} (${dataset})`;
    }
    return JSON.stringify(
      {
        action: readbackAction.replace(/^query_/, ""),
        symbol: code,
        count: routed.data.length,
        source: routed.source,
        interfaceId: routed.interfaceId,
        capabilityId: routed.capabilityId,
        provider: routed.provider,
        providerId: "yahoo",
        ...yahooGlobalProvenance(routed.data),
        canonicalSchema: "yfinance_corporate_actions",
        canonicalTable: "yfinance_corporate_actions",
        cacheStatus: routed.cacheStatus,
        cacheMode: routed.cacheMode,
        cacheDecision: routed.cacheDecision,
        readbackAction,
        data: routed.data,
      },
      null,
      2,
    );
  }

  private recordYahooFailure(
    ctx: ToolContext,
    action: string,
    endpoint: string,
    startedAt: number,
    error: string,
    capability?: DataApiProviderCapability,
    interfaceId?: string,
  ): void {
    this.repository.recordApiCall(ctx, {
      source: "yfinance",
      provider: capability?.provider ?? "yahoo",
      interface_id: capability ? (interfaceId ?? null) : null,
      capability_id: capability?.id ?? null,
      tool: "MarketData",
      action,
      endpoint,
      status: 0,
      success: false,
      duration_ms: Date.now() - startedAt,
      error,
    });
  }
}

function assertYahooGlobalSymbol(code: string): void {
  const symbol = String(code ?? "").trim();
  if (/^\d{6}$/.test(symbol)) {
    throw new Error(
      `Yahoo/yfinance is global-only and must not be used for A-share 6-digit symbol ${symbol}; use stock.quote/stock.daily_kline with A-share providers or EastMoney/TDX interfaces instead.`,
    );
  }
}

function yahooProviderConstraint(
  input: Record<string, unknown>,
): string | undefined {
  if (typeof input.provider !== "string") return undefined;
  const provider = input.provider.trim().toLowerCase();
  if (!provider) return undefined;
  return provider === "yfinance" ? "yahoo" : provider;
}

interface YahooProviderGate {
  gateType: "credential-gated" | "quota-gated";
  error: string;
  until: number;
}

const yahooProviderGates = new Map<string, YahooProviderGate>();

function yahooGateMessage(key: string, label: string): string | null {
  const gate = yahooProviderGates.get(key);
  if (!gate) return null;
  if (gate.until <= Date.now()) {
    yahooProviderGates.delete(key);
    return null;
  }
  return `${label} provider gate open until ${new Date(gate.until).toISOString()} (${gate.gateType}). ${gate.error}`;
}

function recordYahooGate(key: string, label: string, error: string): void {
  const gateType = yahooGateType(error);
  if (!gateType) return;
  const cooldownMs = gateType === "quota-gated" ? 10 * 60_000 : 30 * 60_000;
  yahooProviderGates.set(key, {
    gateType,
    error: yahooProviderGateError(label, error, gateType),
    until: Date.now() + cooldownMs,
  });
}

function clearYahooGate(key: string): void {
  yahooProviderGates.delete(key);
}

function yahooGateType(error: string): YahooProviderGate["gateType"] | null {
  const value = error.toLowerCase();
  if (
    /\b(401|403)\b/.test(value) ||
    value.includes("unauthorized") ||
    value.includes("forbidden")
  )
    return "credential-gated";
  if (
    /\b429\b/.test(value) ||
    value.includes("too many requests") ||
    value.includes("rate limit") ||
    value.includes("quota")
  )
    return "quota-gated";
  return null;
}

function yahooProviderGateError(
  label: string,
  error: string,
  gateType: YahooProviderGate["gateType"],
): string {
  return `${label} failed (${gateType}): ${error}. Reuse query_yfinance cache when available, or retry later through the governed yfinance provider path.`;
}

function readYahooResearchBundle(
  symbol: string,
  limit: number,
): YahooResearchBundle {
  const read = (dataset: YfinanceResearchDataset) =>
    readYfinanceResearchRows(symbol, dataset, { limit });
  return {
    profile: read("profile"),
    statements: read("statements"),
    earningsCalendar: read("earnings_calendar"),
    earningsHistory: read("earnings_history"),
    earningsEstimates: read("earnings_estimates"),
    epsRevisions: read("eps_revisions"),
    epsTrend: read("eps_trend"),
    quarterlyFinancialStatements: read("quarterly_financial_statements"),
    recommendations: read("recommendations"),
    upgradeDowngradeEvents: read("upgrade_downgrade_events"),
    holders: read("holders"),
    majorHolders: read("major_holders"),
    institutionalHolders: read("institutional_holders"),
    mutualFundHolders: read("mutual_fund_holders"),
    insiders: read("insiders"),
  };
}

function yahooResearchBundleCount(bundle: YahooResearchBundle): number {
  return (
    bundle.profile.length +
    bundle.statements.length +
    bundle.earningsCalendar.length +
    bundle.earningsHistory.length +
    bundle.earningsEstimates.length +
    bundle.epsRevisions.length +
    bundle.epsTrend.length +
    bundle.quarterlyFinancialStatements.length +
    bundle.recommendations.length +
    bundle.upgradeDowngradeEvents.length +
    bundle.holders.length +
    bundle.majorHolders.length +
    bundle.institutionalHolders.length +
    bundle.mutualFundHolders.length +
    bundle.insiders.length
  );
}

function isCompleteYahooResearchBundle(bundle: YahooResearchBundle): boolean {
  return Object.values(bundle).every(
    (rows) => Array.isArray(rows) && rows.length > 0,
  );
}

function yahooGlobalProvenance(value: unknown): Record<string, unknown> {
  return {
    providerStatus: "global-only",
    marketScope: ["US", "HK", "global"],
    globalOnly: true,
    asOf: latestYahooTimestamp(value, [
      "timestamp",
      "as_of",
      "asOf",
      "published_at",
      "action_date",
      "last_trade_date",
      "period",
      "reported_date",
      "start_date",
    ]),
    fetchedAt: latestYahooTimestamp(value, [
      "fetched_at",
      "fetchedAt",
      "updated_at",
    ]),
  };
}

function relatedYahooResearchInterface(
  interfaceId: string,
  canonicalTable: string,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    interfaceId,
    provider: "yahoo",
    source: "yfinance",
    canonicalTable,
    rowCount: rows.length,
    latestSourceTime: latestYahooResearchTime(rows),
  };
}

function latestYahooTimestamp(value: unknown, keys: string[]): string | null {
  let latest: string | null = null;
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node == null) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const row = node as Record<string, unknown>;
    for (const key of keys) {
      const raw = row[key];
      if (raw == null) continue;
      const text = String(raw);
      if (!text) continue;
      if (!latest || text > latest) latest = text;
    }
    for (const child of Object.values(row)) visit(child);
  };
  visit(value);
  return latest;
}

function latestYahooResearchTime(
  rows: Array<Record<string, unknown>>,
): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const value = String(
      row.updated_at ?? row.period ?? row.reported_date ?? row.start_date ?? "",
    );
    if (!value) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}
