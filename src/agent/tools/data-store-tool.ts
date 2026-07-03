import type { Tool, ToolContext } from "../tool";
import { toolError } from "../tool";
import { DataStore } from "../data/store/data-store";
import type { FetchQueue } from "../data/queue/fetch-queue";
import { fetchDataStore, fetchStatus } from "./data-store-tool-fetch";
import { dataFeeds } from "./data-store-tool-feeds";
import { dataHealth } from "./data-store-tool-health";
import {
  interfaceAvailability,
  interfaceCatalog,
  interfaceDescribe,
} from "./data-store-tool-interface-discovery";
import { HELP_TEXT } from "./data-store-tool-help";
import {
  coverage,
  queryAlphaFactors,
  fundList,
  queryAuction,
  queryApiCalls,
  queryBoardMembers,
  queryBoardRanking,
  queryChip,
  queryCompanyInfo,
  queryDragonTiger,
  queryExCategories,
  queryExTable,
  queryFlowRank,
  queryFundCompanyInfo,
  queryFundDividendFactor,
  queryIntradayOhlcvBars,
  queryFundFinancials,
  queryFundHolding,
  queryFundList,
  queryFundManager,
  queryFundMoneyYield,
  queryFundNav,
  queryFundPerformance,
  queryBondIssuerFinancials,
  queryBondMarketData,
  queryBondProfile,
  queryFundInvestorHolders,
  queryFundamental,
  queryFinanceNews,
  queryGlobalCompanyProfile,
  queryGlobalIncomeStatement,
  queryGlobalBalanceSheet,
  queryGlobalCashFlow,
  queryGlobalEarningsCalendar,
  queryGlobalEarningsEstimates,
  queryGlobalEarningsHistory,
  queryGlobalEpsRevisions,
  queryGlobalEpsTrend,
  queryGlobalFinancialStatements,
  queryGlobalCorporateActions,
  queryGlobalDividends,
  queryGlobalFinanceNews,
  queryGlobalHolders,
  queryGlobalMajorHolders,
  queryGlobalInsiderTransactions,
  queryGlobalInstitutionalHolders,
  queryGlobalMutualFundHolders,
  queryGlobalOptionsChain,
  queryGlobalQuarterlyBalanceSheet,
  queryGlobalQuarterlyCashFlow,
  queryGlobalQuarterlyFinancialStatements,
  queryGlobalQuarterlyIncomeStatement,
  queryGlobalRecommendations,
  queryGlobalCapitalGains,
  queryGlobalStockSplits,
  queryGlobalUpgradeDowngradeEvents,
  queryHotRank,
  queryIndexConstituents,
  queryIndexFundamentals,
  queryIndexProfile,
  queryIndustryMap,
  queryKline,
  queryLimitPool,
  queryMarginTrading,
  queryMarketScreening,
  queryMomentum,
  queryMoneyFlow,
  queryNorthbound,
  queryQuote,
  queryIndexQuote,
  queryEtfQuote,
  queryListedFundQuote,
  queryBondQuote,
  querySectorConstituents,
  queryStockCompanyInfo,
  queryStockRiskMetrics,
  queryStockDailyValuation,
  queryRawPayload,
  querySector,
  queryStockShareholders,
  queryStockList,
  queryTdxBlockMember,
  queryTdxCount,
  queryTdxSampling,
  queryTechnicalIndicator,
  queryTickChart,
  queryTopBoard,
  queryTradeCalendar,
  queryTransactions,
  queryUnusual,
  queryOptionBidAskSpread,
  queryOptionChainSnapshot,
  queryOptionContractList,
  queryOptionExpiryCalendar,
  queryOptionImpliedVolatility,
  queryOptionMoneyness,
  queryOptionOpenInterest,
  queryOptionPriceChange,
  queryOptionQuote,
  queryOptionTradeRecency,
  queryOptionVolume,
  queryVolumeProfile,
  queryWindAnalytics,
  queryWindDocument,
  queryWindEconomic,
  queryXdxr,
  queryYfinance,
  reusableSummary,
  search,
  stats,
  stockList,
} from "./data-store-tool-queries";
import { queryOptionDailyKline } from "./data-store-tool-query-option-daily-kline";
import { runtimeProbe } from "./data-store-tool-runtime-probe";
import { buildFinanceDoctorReport } from "../../main/finance-doctor";
import {
  callAkshare,
  alphaFactors,
  callTA,
  callTdx,
  callTushare,
  callYfinance,
  financeNews,
  globalFundamentalOutput,
  marginTrading,
  providerDiagnostic,
  providerCoverage,
  providerDiscovery,
  providerStatus,
  providerTableMetadata,
  runBacktest,
  screenFund,
  screenStock,
  searchAkshare,
  searchTA,
  searchYfinance,
  sidecarStatus,
  technicalIndicator,
} from "./data-store-tool-remote";
import { optionDailyKline } from "./data-store-tool-remote-option-daily-kline";
import {
  invalidSinaBatchProvider,
  sinaClassificationMembersBatch,
  sinaEsgRatingCollection,
  sinaFundDividendFactor,
  sinaIntradayOhlcvBars,
} from "./data-store-tool-remote-sina-batch";
import { windStructuredAction } from "./data-store-tool-remote-wind-structured";
import { getStore } from "./data-store-tool-utils";
import { YahooMarketDataService } from "../../domain/market/services/yahoo-market-data-service";

export class DataStoreTool implements Tool {
  name = "DataStore";
  description =
    "Query and manage local reusable market data. For PE/PB/ROE or valuation screens, use query_stock_daily_valuation first and answer from local evidence or its coverage gap. fetch blocks by default until requested data is persisted, fails, or times out; DataStore(fetch,type:'fundamental') requires a concrete code and is not a full-market valuation screener.";
  isReadOnly = true;
  canParallel = false;
  inputSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "query_quote",
          "query_index_quote",
          "query_etf_quote",
          "query_listed_fund_quote",
          "query_bond_quote",
          "query_kline",
          "query_bond_kline",
          "query_stock_daily_valuation",
          "query_stock_list",
          "query_fundamental",
          "query_fund_financials",
          "query_index_fundamentals",
          "query_bond_issuer_financials",
          "query_money_flow",
          "query_sector",
          "query_sector_ranking",
          "query_board_ranking",
          "query_board_members",
          "query_sector_constituents",
          "query_industry_map",
          "query_northbound",
          "query_northbound_flow",
          "query_northbound_holding",
          "query_limit_pool",
          "query_unusual",
          "query_flow_rank",
          "query_chip",
          "query_fund_nav",
          "query_fund_money_yield",
          "query_fund_dividend_factor",
          "query_intraday_ohlcv_bars",
          "query_fund_list",
          "query_fund_performance",
          "query_index_constituents",
          "query_trade_calendar",
          "query_fund_holding",
          "query_fund_manager",
          "query_finance_news",
          "query_market_screening",
          "query_margin_trading",
          "query_technical_indicator",
          "query_alpha_factors",
          "query_tick_chart",
          "query_transactions",
          "query_volume_profile",
          "query_xdxr",
          "query_auction",
          "query_momentum",
          "query_top_board",
          "query_tdx_block_member",
          "query_stock_company_info",
          "query_company_info",
          "query_stock_risk_metrics",
          "query_fund_company_info",
          "query_fund_investor_holders",
          "query_index_profile",
          "query_bond_profile",
          "query_bond_market_data",
          "query_stock_shareholders",
          "query_hot_rank",
          "query_dragon_tiger",
          "query_ex_categories",
          "query_tdx_count",
          "query_tdx_sampling",
          "query_ex_table",
          "query_wind_document",
          "query_wind_economic",
          "query_wind_analytics",
          "query_yfinance",
          "query_global_company_profile",
          "query_global_financial_statements",
          "query_global_income_statement",
          "query_global_balance_sheet",
          "query_global_cash_flow",
          "query_global_earnings_calendar",
          "query_global_earnings_history",
          "query_global_earnings_estimates",
          "query_global_eps_revisions",
          "query_global_eps_trend",
          "query_global_quarterly_financial_statements",
          "query_global_quarterly_income_statement",
          "query_global_quarterly_balance_sheet",
          "query_global_quarterly_cash_flow",
          "query_global_recommendations",
          "query_global_upgrade_downgrade_events",
          "query_global_holders",
          "query_global_major_holders",
          "query_global_institutional_holders",
          "query_global_mutual_fund_holders",
          "query_global_insider_transactions",
          "query_global_finance_news",
          "query_global_corporate_actions",
          "query_global_dividends",
          "query_global_capital_gains",
          "query_global_stock_splits",
          "query_option_expiry_calendar",
          "query_option_contract_list",
          "query_option_quote",
          "query_option_daily_kline",
          "query_option_open_interest",
          "query_option_volume",
          "query_option_implied_volatility",
          "query_option_moneyness",
          "query_option_bid_ask_spread",
          "query_option_price_change",
          "query_option_trade_recency",
          "query_option_chain_snapshot",
          "query_global_options_chain",
          "query_raw_payload",
          "query_api_calls",
          "coverage",
          "reusable_summary",
          "data_health",
          "finance_doctor",
          "data_feeds",
          "fetch",
          "fetch_status",
          "stock_list",
          "fund_list",
          "search",
          "stats",
          "provider_discovery",
          "provider_diagnostic",
          "provider_status",
          "provider_coverage",
          "provider_table_metadata",
          "technical_indicator",
          "alpha_factors",
          "global_fundamental_output",
          "sina_classification_members_batch",
          "sina_esg_rating_collection",
          "sina_fund_dividend_factor",
          "sina_intraday_ohlcv_bars",
          "margin_trading",
          "finance_news",
          "option_daily_kline",
          "stock_risk_metrics",
          "fund_company_info",
          "fund_investor_holders",
          "fund_financials",
          "index_fundamentals",
          "index_profile",
          "bond_profile",
          "bond_market_data",
          "bond_issuer_financials",
          "global_income_statement",
          "global_balance_sheet",
          "global_cash_flow",
          "global_quarterly_income_statement",
          "global_quarterly_balance_sheet",
          "global_quarterly_cash_flow",
          "global_major_holders",
          "global_capital_gains",
          "akshare",
          "akshare_search",
          "tushare",
          "yfinance",
          "yfinance_search",
          "ta",
          "ta_search",
          "tdx",
          "backtest",
          "screen_stock",
          "screen_fund",
          "sidecar_status",
          "help",
          "interfaces",
          "interface_describe",
          "interface_availability",
          "runtime_probe",
        ],
        description: "Action to perform",
      },
      code: { type: "string", description: "Stock/fund code" },
      start: { type: "string", description: "Start date (YYYY-MM-DD)" },
      end: { type: "string", description: "End date (YYYY-MM-DD)" },
      date: {
        type: "string",
        description:
          "Source/trade/metric date filter (YYYY-MM-DD) for query actions that support a single date",
      },
      indexCode: {
        type: "string",
        description: "Index code for query_index_constituents, e.g. 000300",
      },
      stockCode: {
        type: "string",
        description:
          "Constituent stock code filter for query_index_constituents or query_fund_holding",
      },
      asOfDate: {
        type: "string",
        description: "Source snapshot date filter for query_index_constituents",
      },
      metricDate: {
        type: "string",
        description: "Metric date filter for query_fund_performance",
      },
      adjust: {
        type: "string",
        description: "Adjustment for kline queries (qfq/hfq/none)",
      },
      limit: { type: "number", description: "Max rows to return" },
      status: {
        type: "string",
        description:
          "For fetch_status: pending/running/completed/failed/cancelled/all. done is accepted as a compatibility alias. Defaults to pending.",
      },
      type: {
        type: "string",
        description:
          "Data type for fetch (kline/fundamental/stock_list/fund_list/fund_performance/index). fundamental is selected-code refresh only; for full-market PE/PB/ROE screens use query_stock_daily_valuation and disclose its coverage gap if no local rows match.",
      },
      market: { type: "string", description: "Market filter (SH/SZ/HK/US)" },
      industry: { type: "string", description: "Industry filter" },
      query: {
        type: "string",
        description:
          "Search query, or Wind financial_docs query filter for query_wind_document",
      },
      codes: {
        type: "string",
        description: "Comma-separated codes for batch operations",
      },
      priority: {
        type: "number",
        description: "Fetch priority (0=highest, 5=default)",
      },
      forceLive: {
        type: "boolean",
        description:
          "For DataStore(action:'fetch'): bypass reusable local cache and refresh from the governed provider path when validating stale or missing fields.",
      },
      provider: {
        type: "string",
        description:
          "Provider routing constraint for interfaces/interface_availability, provider_discovery/provider_diagnostic/provider_coverage/provider_table_metadata/technical_indicator/global_fundamental_output, and governed provider-specific refreshes",
      },
      providerMode: {
        type: "string",
        description:
          "For interface_availability and governed fetch workflows: auto/preferred/strict. Defaults to auto.",
      },
      interfaceId: {
        type: "string",
        description:
          "For interface_describe/interface_availability: governed Data API interface id such as stock.quote or market.hot_rank.",
      },
      category: {
        type: "string",
        description:
          "For interfaces: optional category filter such as stock/index/market/fund_etf/news/technical/provider_diagnostic.",
      },
      health: {
        type: "string",
        description:
          "For interfaces: optional health filter ready/attention/gap.",
      },
      func: {
        type: "string",
        description:
          "Provider function/action/indicator name for diagnostic or compatibility calls",
      },
      indicator: {
        type: "string",
        description:
          "Indicator name for query_technical_indicator; func is also accepted.",
      },
      api_name: {
        type: "string",
        description:
          "Tushare API name, e.g. stock_basic, daily, weekly, monthly, index_daily, index_weight, daily_basic, trade_cal. Statement, moneyflow, fund_basic, and fund_nav Tushare APIs are disabled in this app.",
      },
      fields: { type: "string", description: "Optional Tushare fields string" },
      symbol: {
        type: "string",
        description: "Symbol for yfinance (e.g. AAPL, 0700.HK)",
      },
      params: {
        type: "object",
        description: "Parameters for akshare/tdx/yfinance/tushare call",
      },
      tdx_action: {
        type: "string",
        description:
          "TDX action such as tick_chart, transactions, finance, xdxr, stock_list, index_info, index_bars, index_momentum, or ex/kline",
      },
      dataset: {
        type: "string",
        description:
          "For query_yfinance: profile/statements/income_statement/balance_sheet/cash_flow/earnings_calendar/earnings_history/earnings_estimates/eps_revisions/eps_trend/quarterly_financial_statements/quarterly_income_statement/quarterly_balance_sheet/quarterly_cash_flow/recommendations/upgrade_downgrade_events/news/options/option_expiries(or expiries)/option_open_interest/open_interest/option_volume/volume/option_implied_volatility/implied_volatility/option_moneyness/moneyness/in_the_money/option_bid_ask_spread/bid_ask_spread/option_price_change/price_change/option_trade_recency/trade_recency/actions/dividends/splits(or stock_splits)/holders/institutional_holders/mutual_fund_holders/insiders",
      },
      source: {
        type: "string",
        description:
          "For query_api_calls/query_raw_payload: source filter such as eastmoney, akshare:eastmoney, tdx, tushare, yfinance",
      },
      endpoint: {
        type: "string",
        description:
          "For query_api_calls/query_raw_payload: endpoint URL/path substring filter",
      },
      failures: {
        type: "boolean",
        description:
          "For query_api_calls: default true. Set false to include successful calls.",
      },
      minutes: {
        type: "number",
        description:
          "For query_api_calls: recent lookback window in minutes. Default 30.",
      },
      since: {
        type: "string",
        description:
          "For query_api_calls: ISO timestamp lower bound, overrides minutes.",
      },
      actionName: {
        type: "string",
        description:
          "For query_api_calls: API action filter when action is not the DataStore action.",
      },
      section: {
        type: "string",
        description:
          "For data_health: summary/interfaces/providers/datasets/gaps/failures/all. Default summary.",
      },
      probeAction: {
        type: "string",
        description: "For runtime_probe: status|run. Defaults to status.",
      },
      probeMode: {
        type: "string",
        description:
          "For runtime_probe when probeAction=run: credential|unstable|failures|all. Defaults to all.",
      },
      sourceAction: {
        type: "string",
        description:
          "For query_market_screening: source action filter such as scan, screen_stock, or screen_fund.",
      },
      feedId: {
        type: "string",
        description:
          "For data_feeds: optional configured Data Manager feed id such as fund_nav, stock_list, or kline_daily.",
      },
      fieldName: {
        type: "string",
        description:
          "For query_technical_indicator: indicator output field such as RSI_14, MACD_12_26_9, or value.",
      },
      factorName: {
        type: "string",
        description:
          "For query_alpha_factors: alpha factor name such as momentum_5d or kmid.",
      },
      tool: {
        type: "string",
        description:
          "Optional Wind financial_docs tool filter for query_wind_document",
      },
      metricQuery: {
        type: "string",
        description: "Optional filter for query_wind_economic",
      },
      question: {
        type: "string",
        description: "Optional filter for query_wind_analytics",
      },
      block: {
        type: "boolean",
        description:
          "For fetch: wait for task completion by default. Set false to queue in background.",
      },
      timeout: {
        type: "number",
        description:
          "For blocking fetch: maximum wait in ms (default 60000, max 300000).",
      },
      maxNodes: {
        type: "number",
        description:
          "For sina_classification_members_batch: maximum classification nodes to expand in one bounded run.",
      },
      pageSize: {
        type: "number",
        description:
          "For Sina batch actions: bounded provider page size. Hard-capped by the action.",
      },
      maxPages: {
        type: "number",
        description:
          "For sina_esg_rating_collection: maximum ESG pages to fetch in one bounded run.",
      },
      maxPagesPerNode: {
        type: "number",
        description:
          "For sina_classification_members_batch: maximum pages per classification node.",
      },
      startNodeIndex: {
        type: "number",
        description:
          "For sina_classification_members_batch resume: node index from checkpoint.nextNodeIndex.",
      },
      startPage: {
        type: "number",
        description: "For Sina batch resume: page from checkpoint.nextPage.",
      },
      persist: {
        type: "boolean",
        description:
          "For generic akshare/tdx/yfinance/tushare compatibility calls: default persists known schemas. Unknown schemas fail normal workflows; use provider_diagnostic for bounded inspection, including Sina/Tencent diagnostics. Set false only for registered-schema inspect-only calls.",
      },
    },
    required: ["action"],
  };

  private boundStore: DataStore | null = null;

  constructor(private fetchQueue: FetchQueue | null = null) {}

  setFetchQueue(fetchQueue: FetchQueue): void {
    this.fetchQueue = fetchQueue;
  }

  setDataStore(dataStore: DataStore): void {
    this.boundStore = dataStore;
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    return (
      input.action === "fetch" ||
      ((input.action === "akshare" ||
        input.action === "tdx" ||
        input.action === "yfinance" ||
        input.action === "tushare" ||
        input.action === "margin_trading" ||
        input.action === "alpha_factors" ||
        input.action === "finance_news") &&
        input.persist !== false)
    );
  }

  async call(
    _id: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const ds = this.boundStore ?? getStore(ctx);
    if (!ds.isReady && typeof ds.init === "function") await ds.init();
    const action = String(input.action ?? "");

    switch (action) {
      case "query_kline":
        return queryKline(ds, input);
      case "query_bond_kline":
        return queryKline(ds, input, "query_bond_kline");
      case "query_stock_daily_valuation":
        return queryStockDailyValuation(ds, input);
      case "query_fundamental":
        return queryFundamental(ds, input);
      case "query_fund_financials":
        return queryFundFinancials(ds, input);
      case "query_index_fundamentals":
        return queryIndexFundamentals(ds, input);
      case "query_bond_issuer_financials":
        return queryBondIssuerFinancials(ds, input);
      case "query_money_flow":
        if (!String(input.code ?? "").trim()) {
          return queryFlowRank(ds, input);
        }
        return queryMoneyFlow(ds, input);
      case "query_sector":
        return querySector(ds, input, "query_sector");
      case "query_sector_ranking":
        return querySector(ds, input, "query_sector_ranking");
      case "query_board_ranking":
        return queryBoardRanking(ds, input);
      case "query_board_members":
        return queryBoardMembers(ds, input);
      case "query_sector_constituents":
        return querySectorConstituents(ds, input);
      case "query_industry_map":
        return queryIndustryMap(ds, input);
      case "query_northbound":
        return queryNorthbound(ds, input);
      case "query_northbound_flow":
        return queryNorthbound(ds, { ...input, kind: "flow" });
      case "query_northbound_holding":
        return queryNorthbound(ds, { ...input, kind: "holding" });
      case "query_limit_pool":
        return queryLimitPool(ds, input);
      case "query_unusual":
        return queryUnusual(ds, input);
      case "query_flow_rank":
        return queryFlowRank(ds, input);
      case "query_chip":
        return queryChip(ds, input);
      case "query_fund_nav":
        return queryFundNav(ds, input);
      case "query_fund_money_yield":
        return queryFundMoneyYield(ds, input);
      case "query_fund_dividend_factor":
        return queryFundDividendFactor(ds, input);
      case "query_intraday_ohlcv_bars":
        return queryIntradayOhlcvBars(ds, input);
      case "query_fund_list":
        return queryFundList(ds, input);
      case "query_fund_performance":
        return queryFundPerformance(ds, input);
      case "query_index_constituents":
        return queryIndexConstituents(ds, input);
      case "query_trade_calendar":
        return queryTradeCalendar(ds, input);
      case "query_fund_holding":
        return queryFundHolding(ds, input);
      case "query_fund_manager":
        return queryFundManager(ds, input);
      case "query_finance_news":
        return queryFinanceNews(ds, input);
      case "query_market_screening":
        return queryMarketScreening(ds, input);
      case "query_margin_trading":
        return queryMarginTrading(ds, input);
      case "query_technical_indicator":
        return queryTechnicalIndicator(ds, input);
      case "query_alpha_factors":
        return queryAlphaFactors(ds, input);
      case "query_quote":
        return queryQuote(ds, input);
      case "query_index_quote":
        return queryIndexQuote(ds, input);
      case "query_etf_quote":
        return queryEtfQuote(ds, input);
      case "query_listed_fund_quote":
        return queryListedFundQuote(ds, input);
      case "query_bond_quote":
        return queryBondQuote(ds, input);
      case "query_tick_chart":
        return queryTickChart(ds, input);
      case "query_transactions":
        return queryTransactions(ds, input);
      case "query_volume_profile":
        return queryVolumeProfile(ds, input);
      case "query_xdxr":
        return queryXdxr(ds, input);
      case "query_auction":
        return queryAuction(ds, input);
      case "query_momentum":
        return queryMomentum(ds, input);
      case "query_top_board":
        return queryTopBoard(ds, input);
      case "query_tdx_block_member":
        return queryTdxBlockMember(ds, input);
      case "query_stock_company_info":
        return queryStockCompanyInfo(ds, input);
      case "query_company_info":
        return queryCompanyInfo(ds, input);
      case "query_stock_risk_metrics":
        return queryStockRiskMetrics(ds, input);
      case "query_fund_company_info":
        return queryFundCompanyInfo(ds, input);
      case "query_fund_investor_holders":
        return queryFundInvestorHolders(ds, input);
      case "query_index_profile":
        return queryIndexProfile(ds, input);
      case "query_bond_profile":
        return queryBondProfile(ds, input);
      case "query_bond_market_data":
        return queryBondMarketData(ds, input);
      case "query_stock_shareholders":
        return queryStockShareholders(ds, input);
      case "query_hot_rank":
        return queryHotRank(ds, input);
      case "query_dragon_tiger":
        return queryDragonTiger(ds, input);
      case "query_ex_categories":
        return queryExCategories(ds, input);
      case "query_tdx_count":
        return queryTdxCount(ds, input);
      case "query_tdx_sampling":
        return queryTdxSampling(ds, input);
      case "query_ex_table":
        return queryExTable(ds, input);
      case "query_wind_document":
        return queryWindDocument(ds, input);
      case "query_wind_economic":
        return queryWindEconomic(ds, input);
      case "query_wind_analytics":
        return queryWindAnalytics(ds, input);
      case "query_yfinance":
        return queryYfinance(ds, input);
      case "query_global_company_profile":
        return queryGlobalCompanyProfile(ds, input);
      case "query_global_financial_statements":
        return queryGlobalFinancialStatements(ds, input);
      case "query_global_income_statement":
        return queryGlobalIncomeStatement(ds, input);
      case "query_global_balance_sheet":
        return queryGlobalBalanceSheet(ds, input);
      case "query_global_cash_flow":
        return queryGlobalCashFlow(ds, input);
      case "query_global_earnings_calendar":
        return queryGlobalEarningsCalendar(ds, input);
      case "query_global_earnings_history":
        return queryGlobalEarningsHistory(ds, input);
      case "query_global_earnings_estimates":
        return queryGlobalEarningsEstimates(ds, input);
      case "query_global_eps_revisions":
        return queryGlobalEpsRevisions(ds, input);
      case "query_global_eps_trend":
        return queryGlobalEpsTrend(ds, input);
      case "query_global_quarterly_financial_statements":
        return queryGlobalQuarterlyFinancialStatements(ds, input);
      case "query_global_quarterly_income_statement":
        return queryGlobalQuarterlyIncomeStatement(ds, input);
      case "query_global_quarterly_balance_sheet":
        return queryGlobalQuarterlyBalanceSheet(ds, input);
      case "query_global_quarterly_cash_flow":
        return queryGlobalQuarterlyCashFlow(ds, input);
      case "query_global_recommendations":
        return queryGlobalRecommendations(ds, input);
      case "query_global_upgrade_downgrade_events":
        return queryGlobalUpgradeDowngradeEvents(ds, input);
      case "query_global_holders":
        return queryGlobalHolders(ds, input);
      case "query_global_major_holders":
        return queryGlobalMajorHolders(ds, input);
      case "query_global_institutional_holders":
        return queryGlobalInstitutionalHolders(ds, input);
      case "query_global_mutual_fund_holders":
        return queryGlobalMutualFundHolders(ds, input);
      case "query_global_insider_transactions":
        return queryGlobalInsiderTransactions(ds, input);
      case "query_global_finance_news":
        return queryGlobalFinanceNews(ds, input);
      case "query_global_corporate_actions":
        return queryGlobalCorporateActions(ds, input);
      case "query_global_dividends":
        return queryGlobalDividends(ds, input);
      case "query_global_capital_gains":
        return queryGlobalCapitalGains(ds, input);
      case "query_global_stock_splits":
        return queryGlobalStockSplits(ds, input);
      case "query_option_expiry_calendar":
        return queryOptionExpiryCalendar(ds, input);
      case "query_option_contract_list":
        return queryOptionContractList(ds, input);
      case "query_option_quote":
        return queryOptionQuote(ds, input);
      case "query_option_daily_kline":
        return queryOptionDailyKline(ds, input);
      case "query_option_open_interest":
        return queryOptionOpenInterest(ds, input);
      case "query_option_volume":
        return queryOptionVolume(ds, input);
      case "query_option_implied_volatility":
        return queryOptionImpliedVolatility(ds, input);
      case "query_option_moneyness":
        return queryOptionMoneyness(ds, input);
      case "query_option_bid_ask_spread":
        return queryOptionBidAskSpread(ds, input);
      case "query_option_price_change":
        return queryOptionPriceChange(ds, input);
      case "query_option_trade_recency":
        return queryOptionTradeRecency(ds, input);
      case "query_option_chain_snapshot":
        return queryOptionChainSnapshot(ds, input);
      case "query_global_options_chain":
        return queryGlobalOptionsChain(ds, input);
      case "query_raw_payload":
        return queryRawPayload(ds, input);
      case "query_api_calls":
        return queryApiCalls(ds, input);
      case "coverage":
        return coverage(ds, input);
      case "reusable_summary":
        return reusableSummary(ds);
      case "interfaces":
        return interfaceCatalog(ds, input, ctx.basePath);
      case "interface_describe":
        return interfaceDescribe(ds, input, ctx.basePath);
      case "interface_availability":
        return interfaceAvailability(ds, input, ctx.basePath);
      case "data_health":
        return dataHealth(ds, input, ctx.basePath);
      case "finance_doctor":
        return JSON.stringify(
          {
            action: "finance_doctor",
            provenance: {
              interfaceId: "data.health",
              providerId: "local",
              provider: "local",
              capabilityId: "local.finance_doctor",
              providerMode: "local-evidence",
              cacheStatus: "local-evidence",
              cacheDecision:
                "finance_doctor reads local runtime, session, DataStore, provider-route, and data-feed evidence to explain remediation; it does not refresh provider data",
              canonicalSchema: "finance_doctor_report",
              canonicalTable: "finance_doctor_report",
              readbackAction: "finance_doctor",
              failureClass: null,
              source:
                "FinAgent Workstation local runtime, session, DataStore, provider-route, and data-feed checks",
              fetchedAt: new Date().toISOString(),
            },
            report: buildFinanceDoctorReport({
              dataStore: ds,
              basePath: ctx.basePath,
            }),
          },
          null,
          2,
        );
      case "data_feeds":
        return dataFeeds(ds, input, ctx.basePath);
      case "runtime_probe":
        return await runtimeProbe(ds, input, ctx.basePath);
      case "fetch":
        return await fetchDataStore(ds, this.fetchQueue, input);
      case "fetch_status":
        return fetchStatus(ds, input);
      case "stock_list":
        return stockList(ds, input);
      case "query_stock_list":
        return queryStockList(ds, input);
      case "fund_list":
        return fundList(ds, input);
      case "search":
        return search(ds, input);
      case "stats":
        return stats(ds);
      case "provider_discovery":
        return providerDiscovery(input);
      case "provider_diagnostic":
        return providerDiagnostic(ds, input, ctx);
      case "provider_status":
        return providerStatus();
      case "provider_coverage":
        return providerCoverage(ds, input);
      case "provider_table_metadata":
        return providerTableMetadata(ds, input);
      case "technical_indicator":
        return technicalIndicator(ds, input);
      case "alpha_factors":
        return alphaFactors(ds, input);
      case "global_fundamental_output":
        return globalFundamentalOutput(ds, input);
      case "sina_classification_members_batch": {
        const providerError = invalidSinaBatchProvider(input);
        if (providerError) return providerError;
        return await sinaClassificationMembersBatch(input);
      }
      case "sina_esg_rating_collection": {
        const providerError = invalidSinaBatchProvider(input);
        if (providerError) return providerError;
        return await sinaEsgRatingCollection(input);
      }
      case "sina_fund_dividend_factor": {
        const providerError = invalidSinaBatchProvider(input);
        if (providerError) return providerError;
        return await sinaFundDividendFactor(input, ds);
      }
      case "sina_intraday_ohlcv_bars": {
        const providerError = invalidSinaBatchProvider(input);
        if (providerError) return providerError;
        return await sinaIntradayOhlcvBars(input, ds);
      }
      case "margin_trading":
        return marginTrading(ds, input);
      case "finance_news":
        return await financeNews(input, ctx);
      case "option_daily_kline":
        return await optionDailyKline(ds, input, ctx);
      case "global_income_statement":
      case "global_balance_sheet":
      case "global_cash_flow":
      case "global_quarterly_income_statement":
      case "global_quarterly_balance_sheet":
      case "global_quarterly_cash_flow":
      case "global_major_holders":
      case "global_capital_gains": {
        const code = String(input.code ?? input.symbol ?? "");
        if (!code) return toolError(`code/symbol required for ${action}`);
        const service = new YahooMarketDataService();
        return await service.readAction(
          action,
          input,
          ctx,
          code,
          Math.max(1, Math.min(Number(input.limit ?? 20), 200)),
        );
      }
      case "stock_risk_metrics":
        return windStructuredAction(ds, input, ctx, "stock_risk_metrics");
      case "fund_company_info":
        return windStructuredAction(ds, input, ctx, "fund_company_info");
      case "fund_investor_holders":
        return windStructuredAction(ds, input, ctx, "fund_investor_holders");
      case "fund_financials":
        return windStructuredAction(ds, input, ctx, "fund_financials");
      case "index_fundamentals":
        return windStructuredAction(ds, input, ctx, "index_fundamentals");
      case "index_profile":
        return windStructuredAction(ds, input, ctx, "index_profile");
      case "bond_profile":
        return windStructuredAction(ds, input, ctx, "bond_profile");
      case "bond_market_data":
        return windStructuredAction(ds, input, ctx, "bond_market_data");
      case "bond_issuer_financials":
        return windStructuredAction(ds, input, ctx, "bond_issuer_financials");
      case "akshare":
        return callAkshare(ds, input);
      case "akshare_search":
        return searchAkshare(input);
      case "tushare":
        return callTushare(ds, input, ctx);
      case "yfinance":
        return callYfinance(ds, input);
      case "yfinance_search":
        return searchYfinance(input);
      case "ta":
        return callTA(ds, input);
      case "ta_search":
        return searchTA(input);
      case "tdx":
        return callTdx(ds, input);
      case "backtest":
        return runBacktest(input);
      case "screen_stock":
        return screenStock(ds, input);
      case "screen_fund":
        return screenFund(ds, input);
      case "sidecar_status":
        return sidecarStatus();
      case "help":
        return HELP_TEXT;
      default:
        return toolError(
          `Unknown action: ${action}. Use action="help" for available actions.`,
        );
    }
  }
}
