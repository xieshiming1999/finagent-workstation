import { executableIndicators } from "../../domain/market/strategy-spec/strategy-spec-registry"

const customStrategyIndicatorSummary = [...executableIndicators].sort().join("/")

export const MARKET_DATA_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "quote",
        "kline",
        "flow",
        "sector",
        "chip",
        "etf",
        "earnings",
        "yahoo",
        "yahoo_history",
        "yahoo_earnings",
        "global_income_statement",
        "global_balance_sheet",
        "global_cash_flow",
        "global_quarterly_income_statement",
        "global_quarterly_balance_sheet",
        "global_quarterly_cash_flow",
        "global_major_holders",
        "yahoo_news",
        "yahoo_options",
        "yahoo_actions",
        "global_capital_gains",
        "scan",
        "tushare",
        "limit_up",
        "limit_down",
        "dragon_tiger",
        "northbound",
        "hot_rank",
        "flow_rank",
        "unusual",
        "transactions",
        "backtest",
        "backtest_enhanced",
        "backtest_composite",
        "backtest_batch",
        "optimize_params",
        "custom_strategy_help",
        "custom_strategy_validate",
        "custom_strategy_backtest",
        "custom_strategy_observe",
        "custom_strategy_fund_backtest",
        "custom_strategy_rank",
        "custom_strategy_save",
        "custom_strategy_list",
        "custom_strategy_read",
        "custom_strategy_compare",
        "custom_strategy_run",
        "tdx_tick_chart",
        "tdx_transactions",
        "tdx_finance",
        "tdx_company_info",
        "tdx_xdxr",
        "tdx_unusual",
        "tdx_index_info",
        "tdx_count",
        "tdx_sampling",
        "tdx_stock_list",
        "tdx_block",
        "ex_categories",
        "ex_count",
        "ex_sampling",
        "ex_table",
        "ex_kline",
        "ex_quote",
        "ex_list",
        "sources",
        "help",
      ],
      description:
        'Market data action. Use action="help" for full documentation.',
    },
    code: {
      type: "string",
      description:
        'Stock code: A-share 6-digit, or symbol like AAPL, BTC-USD, BINANCE:BTCUSDT. For action="flow", omit code only for broad market money-flow ranking; specific stock flow requires code.',
    },
    period: {
      type: "string",
      description: 'K-line period. FinAgent Workstation governed MarketData(action:"kline") currently supports daily only; use provider diagnostics or dedicated interfaces for other periods.',
    },
    adjust: {
      type: "string",
      description: "Price adjust: qfq (default), hfq, none",
    },
    limit: { type: "number", description: "Max rows (default: 60)" },
    type: { type: "string", description: "Sector type: industry/concept/area" },
    sectorCode: {
      type: "string",
      description:
        'EastMoney sector code, e.g. BK0475. When provided for action="sector", return constituent stocks and persist industry_map + quote_snapshot + stock_list.',
    },
    sectorName: {
      type: "string",
      description:
        "Optional sector/industry label paired with sectorCode for constituent persistence.",
    },
    range: {
      type: "string",
      description: "Yahoo history range: 1mo,3mo,6mo,1y,2y",
    },
    indicators: {
      type: "array",
      items: { type: "string" },
      description: "TradingView indicator names",
    },
    timeframe: {
      type: "string",
      description: "TradingView timeframe: 5m,15m,1h,4h,1d,1w",
    },
    api_name: {
      type: "string",
      description: "Tushare API name (e.g., daily, stock_basic)",
    },
    params: { type: "object", description: "Tushare API params" },
    fields: { type: "string", description: "Tushare fields (comma-separated)" },
    strategy: {
      type: "string",
      description:
        "(backtest) Strategy name: rsi, macd, boll/bollinger, ema_cross, supertrend, donchian, kdj, ma_golden_cross, volume_breakout, dual_thrust, adx_emerging, mean_reversion, turtle_breakout, or compare",
    },
    strategies: {
      type: "array",
      items: { type: "string" },
      description: "(backtest_composite) Multiple strategy names",
    },
    symbols: {
      type: "array",
      items: { type: "string" },
      description: "(backtest_batch) Multiple stock codes",
    },
    stopLoss: {
      type: "number",
      description: "(backtest_enhanced) Stop loss % (e.g. 8)",
    },
    takeProfit: {
      type: "number",
      description: "(backtest_enhanced) Take profit %",
    },
    positionSizing: {
      type: "string",
      description: "(backtest_enhanced) fullCapital/fixedFraction/kelly",
    },
    paramGrid: {
      type: "object",
      description:
        '(optimize_params) Parameter ranges, e.g. {"period":[10,14,20], "oversold":[30,40]}. Returns best params plus parameterStability evidence over top grid results.',
    },
    strategySpec: {
      type: "object",
      description:
        `(custom_strategy_*) Structured StrategySpec. Use custom_strategy_help as the code-owned discovery surface for the current executable indicator catalog (${customStrategyIndicatorSummary}), dataRequirements, lifecycle fields, and output contracts. custom_strategy_backtest returns lifecycleAdvice; lifecycleAdvice.saveable=true means status:"backtested" can be saved/rerun even when metrics.tradeCount is 0. Fund specs must set assetClass:"fund" or market:"fund" and use fund-only observation indicators with custom_strategy_observe/custom_strategy_fund_backtest plus fundRows. Use custom_strategy_rank with symbols[] for stock portfolio ranking evidence. Unsupported source signals must stay as unsupported indicator types during validation; do not replace them with supported proxy indicators unless proxyFor, unsupportedOriginalSignals, and proxyApproval:{approved:true} are present. Arbitrary code is rejected.`,
    },
    outOfSampleRatio: {
      type: "number",
      description:
        "(custom_strategy_backtest) Optional chronological holdout ratio such as 0.3. Returns outOfSample train/test evidence when enough bars exist.",
    },
    walkForwardFolds: {
      type: "number",
      description:
        "(custom_strategy_backtest) Optional chronological walk-forward fold count, such as 3. Returns fold metrics and stability evidence when each fold has enough bars.",
    },
    fundRows: {
      type: "array",
      description:
        "(custom_strategy_observe/custom_strategy_fund_backtest) Structured fund NAV/yield rows from query_fund_nav or query_fund_money_yield. Fields may include code, name, date, nav, moneyYield, sevenDayYield. Multiple code groups return comparisonEvidence or fund period evidence.",
    },
    topN: {
      type: "number",
      description: "(custom_strategy_rank) Number of ranked symbols to include in the rebalance draft.",
    },
    rankingMetric: {
      type: "string",
      description:
        "(custom_strategy_rank) score, total_return_pct, sharpe_ratio, max_drawdown_pct, trade_count, relative_strength_pct, or rps.",
    },
    rebalanceInterval: {
      type: "string",
      description:
        "(custom_strategy_rank) Evidence-only rebalance cadence: weekly, monthly, or quarterly.",
    },
    maxPositionWeight: {
      type: "number",
      description:
        "(custom_strategy_rank) Evidence-only max per-symbol target weight, clamped to 0.01..1.0.",
    },
    minScore: {
      type: "number",
      description:
        "(custom_strategy_rank) Optional minimum rank score required before a candidate can enter the rebalance draft. Ranked rows below the threshold remain visible with selectionEvidence exclusionReason.",
    },
    strategyId: {
      type: "string",
      description: "(custom_strategy_run) Saved custom StrategySpec id",
    },
    strategyIds: {
      type: "array",
      items: { type: "string" },
      description:
        "(custom_strategy_compare) Optional saved StrategySpec ids to compare; omit to compare all saved artifacts.",
    },
    evidence: {
      type: "object",
      description: "(custom_strategy_save) Optional latest validation/backtest evidence",
    },
    mode: {
      type: "string",
      description:
        "(backtest_composite) Combining mode: all_agree/any_trigger/majority",
    },
    category: {
      type: "string",
      description: "(ex_categories/ex_list) Market category",
    },
    market: {
      type: "string",
      description: "(ex_kline/ex_quote) Market: sh/sz/bj",
    },
    date: {
      type: "string",
      description: "Date string (YYYYMMDD or YYYY-MM-DD)",
    },
    cacheMode: {
      type: "string",
      enum: ["cache-first", "live-only", "cache-only"],
      description:
        "Cache policy for requirement-level quote/kline reads. cache-first is default; live-only bypasses local reusable rows; cache-only refuses provider fetches.",
    },
  },
  required: ["action"],
} as const;

export function validateMarketDataInput(
  input: Record<string, unknown>,
): string | null {
  if (!input.action) {
    return "action is required. Available: quote, kline, flow, sector, earnings, yahoo, yahoo_history, yahoo_earnings, scan, tushare, limit_up, dragon_tiger, northbound, hot_rank, flow_rank, backtest";
  }
  return null;
}
