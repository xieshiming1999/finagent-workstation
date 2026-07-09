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
  query_market_screening, query_macro_factors, query_macro_attribution, macro_numeric_series_catalog, query_macro_numeric_series, macro_research_sources, macro_research_provenance, macro_research_extract, macro_research_extraction_status, query_macro_research_content, query_macro_research_evidence, query_technical_indicator, query_alpha_factors, query_raw_payload, query_api_calls, query_stock_list, interfaces, interface_describe, interface_availability, coverage, reusable_summary, data_health, finance_doctor, data_feeds, runtime_probe, stock_list
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
  - Use query_macro_factors before market, stock, fund, or strategy-preparation analysis when outside macro forces may matter. Pass structured filters such as target, assets, regions, sectors, family, or status. It reads market_moving_factor_v1 rows with source time/fetched time/provenance and returns an explicit missingReason when no factor row matches.
  - Use query_macro_attribution after macro factor/evidence readback when the answer needs root-cause attribution. Pass structured filters such as target, assets, regions, sectors, family, or status. It returns macro_attribution_v1 candidates with category, evidence, confidence, missing evidence, invalidation condition, and next update action. Use it as analysis/strategy context, not as a direct buy/sell signal.
  - Use macro_numeric_series_catalog before live numeric refresh or after a missing numeric readback. It returns official series availability, provider, seriesId, metricName, credentialKey, status, sourceUrl, nextAction, and provenance for BEA/FRED/BLS/EIA/OECD/IMF/World Bank/NBS/Wind-style series.
  - Use query_macro_numeric_series only when the user asks for an official numeric value or the answer requires a current number. It reads only numeric official-series rows and returns seriesId, metricName, value, unit, frequency, sourceDataTime, releaseDate, fetchedAt, provider, status, and provenance. Use it for BEA/FRED/BLS/EIA/OECD/IMF/World Bank/Wind-style facts; do not use research article text as numeric observations. For a forward-looking first pass that asks what to watch, do not loop through numeric series candidates; list missing numeric evidence as a gap instead.
  - Use macro_research_sources before retrieving macro research/event pages. Pass provider/category/access/priority filters to inspect source-specific categories, retrievalMethods, accessClass, automationPolicy, testedStatus, limitations, and nextAction. It is a catalog/readback action and does not scrape pages.
  - Use macro_research_provenance to normalize the source catalog into governed macro research evidence rows. It persists stable public/API/index/commodity metadata into market_moving_factor_v1 and records anti-bot/manual/licensed/do-not-scrape sources as retrieval evidence rather than reusable content.
  - Use macro_research_extraction_status to inspect which macro research providers currently support content extraction, PDF text extraction, key-claim extraction, and hash/readback.
  - Use macro_research_extract only for allowed public/API/browser-compatible sources. provider/source/url/content/contentType/limit/persist optional. It fetches or consumes supplied article/PDF/API text, extracts title/date/body/key claims, writes a bounded content artifact when possible, hashes the content, and persists market_moving_factor_v1 rows. Blocked/manual/licensed/do-not-scrape sources become retrieval evidence only. For first-pass macro answers, use at most one blocked official-source attempt plus one missing-content extraction, then call query_macro_research_content and answer instead of crawling multiple providers.
  - Use query_macro_research_content to read extracted content-backed rows before making claims like "this report says...". Use its contentEvidence array for title/date/source/key claims/body preview in first-pass answers. artifactPath is diagnostic/source-maintenance only; do not use Glob/Read to inspect macro content files during normal first-pass macro analysis.
  - Use query_macro_research_evidence before repeating external retrieval. It reads macro_research_document, macro_index_event, macro_official_series, macro_commodity_event, and macro_source_retrieval_evidence rows with provenance.
  - Prefer category/family filters over provider-by-provider loops. Use category:"commodity_research" plus family:"commodity_research" for copper/commodity first-pass work, and category:"index" plus family:"index_classification" for index/passive-flow first-pass work. Choose one follow-up extraction only if content readback is missing for the most relevant source. If evidence/content readback returns rows for the requested family, answer from those rows; missing numeric evidence belongs in the answer's gap section rather than triggering numeric-series or adjacent-target loops.
  - When macro_research_sources, macro_research_provenance, query_macro_research_evidence, and query_macro_research_content already identify the relevant provider/source, answer from those rows. Do not use Research(search) to look for one more date or confirmation in a first-pass governed macro answer; if exact timing is absent from content rows, state it as missing or uncertain evidence.
  - Use fetch_status to inspect durable provider.fetch_task_queue evidence. It accepts status pending/running/completed/failed/cancelled/all, returns actionableFailures and nonActionableEvidence with nextAction guidance, and does not blindly retry non-actionable stale or missing-scope rows.
  - Use runtime_probe when you need the app to generate fresh governed live-provider evidence instead of only reading the last report snapshot. Start with probeAction:"status"; inspect recommendedTargets, blockedTargets, providerProbePacks, and guidance before running a bounded probe. Automatic failures/all runs are for retryable transport, timeout, provider-error, runtime-unavailable, or transport-unstable targets; credential/permission, quota/rate-limit, unsupported-route, runtime-blocked, schema-contract, schema-mismatch, and explicit do-not-retry rows stay blocked until their root cause changes or the user deliberately passes bounded probeIds.
  - Query local data before repeating external calls.`;
