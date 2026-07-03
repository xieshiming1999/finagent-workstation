export const HELP_TEXT = `DataStore — Local Market Data + AkShare + Tushare + yfinance + TDX + Sina + Tencent + TA

Data sources:
  AkShare (sidecar)   — full A-share coverage: quotes, K-line, flow, sectors, fundamentals, funds, indices (1000+ functions)
  Tushare Pro         — explicit research data: A-share K-line, financials, flow, funds, trade calendar (token/points/rate limits)
  yfinance (sidecar)  — US/HK coverage: quotes, K-line, financials, analyst data, news, options (100+ actions)
  TDX (gotdx sidecar) — real-time tick, intraday, corporate action, financial, and board endpoints (35+ endpoints)
  Sina Finance        — governed A-share quote/K-line/news/market structure routes plus bounded output-only diagnostics
  Tencent Finance     — governed quote/K-line/listed fund/convertible bond routes plus bounded output-only diagnostics
  TA (pandas_ta)      — technical indicators: RSI/MACD/Bollinger/ATR/ADX (130+ indicators)

Query local data:
  query_kline, query_quote, query_index_quote, query_etf_quote, query_listed_fund_quote, query_bond_quote, query_bond_kline, query_stock_daily_valuation, query_fundamental, query_fund_financials, query_index_fundamentals, query_bond_issuer_financials, query_money_flow, query_sector, query_sector_ranking, query_board_ranking
  query_board_members, query_sector_constituents, query_industry_map, query_northbound, query_northbound_flow, query_northbound_holding, query_limit_pool, query_fund_nav, query_fund_money_yield, query_fund_dividend_factor, query_intraday_ohlcv_bars
  query_fund_list, query_fund_performance, query_index_constituents, query_trade_calendar, query_fund_holding, query_fund_manager
  query_tick_chart, query_transactions, query_volume_profile, query_xdxr
  query_auction, query_momentum, query_top_board, query_tdx_block_member
  query_stock_company_info, query_company_info, query_stock_risk_metrics, query_fund_company_info, query_fund_investor_holders, query_index_profile, query_bond_profile, query_bond_market_data, query_stock_shareholders, query_hot_rank, query_dragon_tiger, query_ex_categories
  query_tdx_count, query_tdx_sampling, query_ex_table, query_wind_document
  query_wind_economic, query_wind_analytics, query_finance_news, query_yfinance
  query_option_quote, query_option_daily_kline
  query_option_open_interest, query_option_volume, query_option_implied_volatility, query_option_moneyness
  query_option_bid_ask_spread, query_option_price_change, query_option_trade_recency
  query_market_screening, query_technical_indicator, query_alpha_factors, query_raw_payload, query_api_calls, query_stock_list, interfaces, interface_describe, interface_availability, coverage, reusable_summary, data_health, finance_doctor, data_feeds, runtime_probe, stock_list
  fund_list, search, stats

Fetch:
  fetch, fetch_status
  fetch type:"fundamental" requires a concrete code and is selected-code refresh only. It is not a full-market PE/PB/ROE screen. For valuation screens use query_stock_daily_valuation and screen_stock; if those return no-values or 0 coverage, disclose the valuation data gap instead of retrying broad fundamental fetch.

Output-only interfaces:
  provider_discovery   — discover provider functions/actions through a typed output-only interface. provider: akshare/yfinance/ta
  provider_diagnostic  — bounded provider diagnostic envelope. provider: akshare/yfinance/tdx/ta/tushare/sina/tencent
  provider_status      — Python sidecar, rate limiter, and gotdx status through a typed output-only interface
  provider_coverage    — local TDX coverage/count/sampling metadata through provider.coverage
  provider_table_metadata — local ExTDX category/table metadata through provider.table_metadata
  global_fundamental_output — Yahoo global fundamentals through governed global.financial_statements/global.corporate_actions interfaces. provider: yfinance
  sina_classification_members_batch — bounded direct Sina classification expansion with checkpoint and failed-page classification. provider: sina
  sina_esg_rating_collection — bounded direct Sina ESG rating collection with checkpoint and failed-page classification. provider: sina
  sina_fund_dividend_factor — bounded direct Sina ETF dividend/factor rows through governed fund.dividend_factor. Persists fund_dividend_factor unless persist:false.
  sina_intraday_ohlcv_bars — bounded direct Sina 5-minute intraday OHLCV bars through governed market.intraday_ohlcv_bars. Persists intraday_ohlcv_bars unless persist:false.

Compatibility/diagnostic provider aliases:
  akshare_search, yfinance_search, ta_search route through provider_discovery
  ta routes through technical_indicator
  sidecar_status routes through provider_status
  akshare, tushare, yfinance, tdx, sina, and tencent remain compatibility/provider validation paths; prefer requirement-level fetch/query actions or provider_diagnostic for debugging
  technical_indicator persists canonical technical.indicator_series rows by default; use query_technical_indicator for readback
  alpha_factors persists canonical stock.alpha_factors rows by default; use query_alpha_factors for readback
  finance_news routes through governed news.finance_feed and re-reads canonical finance_news rows after provider refresh
  backtest
  screen_stock, screen_fund, and TradingView scan persist canonical market.screening snapshots; use query_market_screening for governed readback across TradingView/AkShare/Wind-backed rows
  option_daily_kline routes through governed option.daily_kline and persists option-contract daily bars into kline_daily
  Sina batch/output-only actions are known-schema workflows. They do not persist canonical data; use checkpoint fields where present to resume broad collection safely.
  stock_risk_metrics, fund_company_info, fund_investor_holders, fund_financials, index_fundamentals, index_profile, bond_profile, bond_market_data, bond_issuer_financials route through governed Wind interfaces and then read back canonical persisted rows

Notes:
  - Progressive disclosure path: interfaces -> interface_describe -> interface_availability -> query/fetch.
  - Agents should call requirement-level interfaces first; provider names are constraints, not normal action names.
  - Known schemas persist by default for akshare/tdx/tushare/yfinance.
  - Unknown schemas are not supported normal workflow data. Use provider_diagnostic for bounded inspection.
  - Use persist:false for inspect-only calls.
  - Use data_health before provider retries when you need interface/provider/dataset health.
  - Use finance_doctor when the agent needs local runtime, session/history, DataStore, provider-route, feed, and service readiness before continuing a workflow.
  - Use data_feeds to inspect configured Data Manager feed status before running a prefetch; it is read-only and does not call providers.
  - Use query_stock_list with keyword/query and limit for structured stock identity readback before query_quote when a company name must be resolved to a code. It returns JSON data rows and does not require parsing the legacy search display.
  - Use fetch_status to inspect durable provider.fetch_task_queue evidence. It accepts status pending/running/completed/failed/cancelled/all, returns actionableFailures and nonActionableEvidence with nextAction guidance, and does not blindly retry non-actionable stale or missing-scope rows.
  - Use runtime_probe when you need the app to generate fresh governed live-provider evidence instead of only reading the last report snapshot. Start with probeAction:"status"; inspect recommendedTargets, blockedTargets, providerProbePacks, and guidance before running a bounded probe. Automatic failures/all runs are for retryable transport, timeout, provider-error, runtime-unavailable, or transport-unstable targets; credential/permission, quota/rate-limit, unsupported-route, runtime-blocked, schema-contract, schema-mismatch, and explicit do-not-retry rows stay blocked until their root cause changes or the user deliberately passes bounded probeIds.
  - Query local data before repeating external calls.`;
