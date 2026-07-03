import { executableIndicators } from "../../domain/market/strategy-spec/strategy-spec-registry"

const customStrategyIndicatorSummary = [...executableIndicators].sort().join("/")

export const MARKET_DATA_HELP_TEXT = `MarketData actions:

A-SHARE DATA:
  quote         — Real-time quotes. code: "600519" or "600519,000001"
  kline         — Governed daily K-line history. code, period(daily only), adjust(qfq/hfq/none), limit
  flow          — Per-stock money flow. code, limit. If code is omitted, routes to the broad flow_rank workflow.
  sector        — Sector rankings. type(industry/concept/area), limit
  chip          — Chip distribution via stock.chip_distribution. code; provider is a routing constraint
  etf           — ETF quotes overview
  earnings      — A-share daily valuation/fundamental summary via stock.daily_valuation. code; provider is a routing constraint
  limit_up      — Limit-up stock pool
  limit_down    — Limit-down stock pool. date(optional)
  dragon_tiger  — Dragon tiger list. limit
  northbound    — Northbound capital. code optional for holdings; omit for flow history. limit
  hot_rank      — Hot stock ranking. limit
  flow_rank     — Broad market money-flow ranking. limit
  unusual       — Unusual market activity
  transactions  — Stock transaction ticks via stock.transactions. code, date(optional), provider(optional: tdx/sina), limit

GLOBAL DATA:
  yahoo         — Yahoo Finance real-time. code(symbol, e.g. AAPL)
  yahoo_history — Yahoo historical data. code, range(1mo/3mo/6mo/1y/2y)
  yahoo_earnings— Yahoo earnings data. code
  yahoo_news    — Yahoo Finance news. code
  yahoo_options — Yahoo options chain. code, expiry(optional)
  yahoo_actions — Yahoo dividends/splits. code

TECHNICAL:
  scan          — TradingView scanner. code(tickers), indicators, timeframe

BACKTEST:
  backtest          — Single strategy. code, strategy(rsi/macd/boll or bollinger/ema_cross)
  backtest_enhanced — With stop-loss/take-profit. code, strategy, stopLoss, takeProfit, positionSizing
  backtest_composite— Multi-strategy combination. code, strategies[], mode(all_agree/any_trigger/majority)
  backtest_batch    — Multi-stock comparison. symbols[], strategy
  optimize_params   — Parameter grid search. code, strategy, paramGrid. Returns parameterStability over top grid results
  custom_strategy_help     — Discovery for governed custom StrategySpec actions
  custom_strategy_validate — Validate structured strategySpec; call custom_strategy_help for the code-owned executable indicator catalog (${customStrategyIndicatorSummary}), dataRequirements, lifecycle fields, and output contracts; fund observation specs must set assetClass:"fund" or market:"fund" and may use nav_trend/rolling_return/fund_drawdown/fund_volatility/fund_momentum_acceleration/money_yield/seven_day_yield/dca_interval. If the requested strategy depends on unsupported source signals, preserve them as unsupported indicator types in the StrategySpec and validate only; do not replace them with supported proxy indicators unless a separate proxy redesign has explicit structured approval.
  custom_strategy_observe  — Evaluate a validated fund StrategySpec with structured fundRows from query_fund_nav/query_fund_money_yield. Multiple fund code groups return comparisonEvidence. This is fund observation evidence, not stock backtest. Required fund boundary: assetClass:"fund" or market:"fund".
  custom_strategy_fund_backtest — Evaluate fund NAV/yield period evidence from validated fund StrategySpec + fundRows. This is not stock K-line backtest and does not place orders.
  custom_strategy_backtest — Validate and run a sandboxed custom strategy. code, strategySpec, optional outOfSampleRatio for chronological holdout evidence, optional walkForwardFolds for stability evidence. Returns structured dataCoverage and lifecycleAdvice; prefer those over prose for source/cache/window sufficiency and save/rerun decisions. lifecycleAdvice.saveable=true means status:"backtested" is valid evidence for custom_strategy_save even when metrics.tradeCount is 0.
  custom_strategy_rank     — Validate a stock StrategySpec across symbols[], rank candidates, and return top-N rebalance evidence plus portfolioBacktestEvidence and portfolioScoringEvidence. This is the governed strategy-candidate scoring surface; do not add legacy DataProcess technical scoring after using it. rankingMetric may be score, total_return_pct, sharpe_ratio, max_drawdown_pct, trade_count, relative_strength_pct, or rps. Optional rebalanceInterval, maxPositionWeight, and minScore are evidence-only draft assumptions; minScore excludes weak ranked rows from the rebalance draft but keeps them visible with selectionEvidence. This is not a trade/order action.
  custom_strategy_save     — Save a validated/backtested custom strategy. strategySpec, evidence(optional)
  custom_strategy_list     — List saved custom strategies
  custom_strategy_compare  — Compare saved custom strategies by lifecycle, metric, portfolio, and data coverage evidence. strategyIds optional. Does not rerun or fetch data.
  custom_strategy_run      — Run a saved custom strategy. code, strategyId. Non-runnable saved artifacts return readback_only with lifecycleIssue and validationIssues.

TDX DIRECT (requires gotdx sidecar):
  tdx_tick_chart    — Tick chart data. code
  tdx_transactions  — TDX compatibility path for transaction details. Prefer transactions with provider routing.
  tdx_finance       — Financial data. code
  tdx_xdxr          — Ex-dividend/rights data. code
  tdx_unusual       — Unusual activity (TDX source)
  tdx_index_info    — Guarded diagnostic index quote. Validates code/price before output; prefer /api/finance/index/quotes for UI/status quotes
  tdx_count         — Security count. market(optional)
  tdx_sampling      — Chart sampling. code
  tdx_stock_list    — Stock list

EXQUOTE (requires gotdx sidecar):
  ex_categories     — ExQuote market categories
  ex_count          — ExQuote security count
  ex_sampling       — ExQuote chart sampling. code, category(optional)
  ex_table          — ExQuote protocol table. detail(optional)
  ex_kline          — ExQuote K-line. code, market
  ex_quote          — ExQuote real-time. code, market
  ex_list           — ExQuote stock list. category

RAW:
  tushare       — Raw Tushare API. api_name, params, fields
  sources       — Data source health status
  help          — This help text`
