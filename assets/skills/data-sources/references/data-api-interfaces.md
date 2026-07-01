# Data API Interfaces

Generated from the code-owned finagent_workstation finance data API contract. Use this table to choose requirement-level workflows before raw provider diagnostics.

Contract version: 2026-06-17

| Interface | Canonical schema | Query/readback | Cache lookup | Supported providers | Blocked/output-only providers |
|---|---|---|---|---|---|
| `stock.quote` | `quote_snapshot` | `query_quote` | implemented<br>`readRecentQuoteSnapshot` | tdx:supported, eastmoney:supported, sina:supported, akshare:supported, tencent:supported, tencent:global-only, yahoo:global-only | wind:credential-gated, tushare:not-supported |
| `stock.daily_kline` | `kline_daily` | `query_kline` | implemented<br>`readKlineRows` | tdx:supported, eastmoney:supported, akshare:supported, sina:supported, tencent:supported, yahoo:global-only | tushare:credential-gated, wind:credential-gated |
| `market.intraday_ohlcv_bars` | `intraday_ohlcv_bars` | `query_intraday_ohlcv_bars` | implemented<br>`readIntradayOhlcvRows` | sina:supported | tdx:not-supported, eastmoney:not-supported, tencent:not-supported |
| `stock.identity_list` | `stock_list` | `stock_list` | implemented<br>`readStockIdentityList` | tdx:supported, sina:supported, eastmoney:supported, akshare:supported/origin:eastmoney, tencent:supported | tushare:credential-gated, wind:credential-gated |
| `index.quote` | `quote_snapshot` | `query_index_quote`, `query_quote` | implemented<br>`readRecentQuoteSnapshot` | tdx:supported, sina:supported, tencent:supported, akshare:supported, eastmoney:supported | wind:credential-gated |
| `index.daily_kline` | `kline_daily` | `query_kline` | implemented<br>`readKlineRows` | tdx:supported, eastmoney:supported, akshare:supported/origin:eastmoney, tencent:supported | tushare:credential-gated, wind:credential-gated |
| `index.constituents` | `index_constituent` | `query_index_constituents` | implemented<br>`readIndexConstituentRows` | akshare:supported/origin:sina | eastmoney:not-supported, tdx:not-supported, tushare:credential-gated, wind:not-supported |
| `stock.money_flow` | `money_flow` | `query_money_flow` | implemented<br>`readMoneyFlowRows` | eastmoney:supported, akshare:supported | tushare:disabled, tdx:not-supported, wind:credential-gated |
| `stock.daily_valuation` | `fundamental` | `query_stock_daily_valuation`, `query_fundamental` | implemented<br>`readFundamentalRows` | akshare:supported, eastmoney:supported, tdx:supported | tushare:credential-gated, wind:credential-gated |
| `stock.chip_distribution` | `chip_distribution` | `query_chip` | implemented<br>`readChipDistributionRows` | eastmoney:supported, akshare:supported | tdx:not-supported, tushare:not-supported, wind:not-supported |
| `fund.identity_list` | `fund_list` | `query_fund_list` | implemented<br>`readFundIdentityList` | eastmoney:supported, akshare:supported/origin:eastmoney | tushare:disabled, wind:credential-gated |
| `fund.nav_history` | `fund_nav` | `query_fund_nav` | implemented<br>`readFundNavRows` | eastmoney:supported, akshare:supported/origin:eastmoney | tushare:disabled, wind:credential-gated |
| `fund.money_yield_history` | `fund_money_yield` | `query_fund_money_yield` | implemented<br>`readFundMoneyYieldRows` | eastmoney:supported | akshare:not-supported/origin:eastmoney, tushare:disabled, wind:not-supported |
| `fund.dividend_factor` | `fund_dividend_factor` | `query_fund_dividend_factor` | implemented<br>`readFundDividendFactorRows` | sina:supported | eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `fund.performance_metrics` | `fund_performance_metrics` | `query_fund_performance` | implemented<br>`readFundPerformanceMetricRows` | eastmoney:supported, akshare:supported/origin:eastmoney | tushare:disabled, wind:credential-gated |
| `fund.holding` | `fund_holding` | `query_fund_holding` | implemented<br>`readFundHoldingRows` | eastmoney:supported, akshare:supported/origin:eastmoney | wind:credential-gated |
| `fund.company_info` | `stock_company_info` | `query_fund_company_info`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `fund.financials` | `fundamental` | `query_fund_financials`, `query_fundamental` | implemented<br>`readFundamentalRows` | - | wind:credential-gated |
| `fund.investor_holders` | `stock_company_info` | `query_fund_investor_holders`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `market.sector_ranking` | `sector_rank` | `query_sector_ranking`, `query_sector` | implemented<br>`readSectorRankingRows` | eastmoney:supported, akshare:supported/origin:eastmoney, tdx:supported, sina:supported | tushare:not-supported, wind:not-supported |
| `market.sector_constituents` | `industry_map` | `query_sector_constituents`, `query_industry_map`, `query_quote` | implemented<br>`readSectorConstituentRows` | eastmoney:supported, sina:supported | akshare:not-supported, tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.limit_pool` | `limit_pool` | `query_limit_pool` | implemented<br>`readLimitPoolRows` | eastmoney:supported, akshare:supported/origin:eastmoney | tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.board_ranking` | `sector_rank` | `query_board_ranking`, `query_sector` | implemented<br>`readSectorRankingRows` | eastmoney:supported, akshare:supported/origin:eastmoney, tdx:supported, sina:supported | wind:not-supported |
| `market.board_members` | `industry_map` | `query_board_members`, `query_industry_map`, `query_quote` | implemented<br>`readSectorConstituentRows` | eastmoney:supported, akshare:supported/origin:eastmoney, tdx:supported, sina:supported | wind:not-supported |
| `market.northbound_flow` | `northbound_flow` | `query_northbound_flow`, `query_northbound` | implemented<br>`readNorthboundFlowRows` | eastmoney:supported, akshare:supported/origin:eastmoney | tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.northbound_holding` | `northbound_holding` | `query_northbound_holding`, `query_northbound` | implemented<br>`readNorthboundHoldingRows` | eastmoney:supported | akshare:not-supported, tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.hot_rank` | `hot_rank` | `query_hot_rank` | implemented<br>`readHotRankRows` | eastmoney:supported, akshare:supported/origin:eastmoney | tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.dragon_tiger` | `dragon_tiger` | `query_dragon_tiger` | implemented<br>`readDragonTigerRows` | eastmoney:supported | akshare:not-supported, tdx:not-supported, tushare:not-supported, wind:not-supported |
| `market.unusual_activity` | `unusual_activity` | `query_unusual` | implemented<br>`readUnusualActivityRows` | eastmoney:supported, tdx:supported | akshare:not-supported, tushare:not-supported, wind:not-supported |
| `market.flow_rank` | `flow_rank` | `query_flow_rank` | implemented<br>`readFlowRankRows` | eastmoney:supported, akshare:supported | tdx:not-supported, tushare:not-supported, wind:not-supported |
| `fund.etf_quote` | `quote_snapshot` | `query_etf_quote`, `query_quote`, `stock_list` | implemented<br>`readEtfQuoteRows` | eastmoney:supported, akshare:supported/origin:eastmoney, sina:supported, tencent:supported | wind:credential-gated |
| `fund.listed_fund_quote` | `quote_snapshot` | `query_listed_fund_quote`, `query_quote`, `stock_list` | implemented<br>`readEtfQuoteRows` | tencent:supported | eastmoney:not-supported, akshare:not-supported, sina:not-supported, wind:not-supported |
| `fund.etf_daily_ohlcv_bars` | `kline_daily` | `query_kline` | implemented<br>`readKlineRows` | akshare:supported/origin:sina, tencent:supported | eastmoney:not-supported, sina:not-supported, wind:not-supported |
| `fund.etf_transactions` | `transactions` | `query_transactions` | implemented<br>`readTransactionRows` | tencent:supported | tdx:not-supported, sina:not-supported, eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `fund.manager` | `fund_manager` | `query_fund_manager` | implemented<br>`readFundManagerRows` | eastmoney:supported, akshare:supported/origin:eastmoney | wind:credential-gated |
| `calendar.trade_days` | `trade_calendar` | `query_trade_calendar` | implemented<br>`readTradeCalendarRows` | szse:supported, akshare:supported/origin:sina | tushare:credential-gated, tdx:not-supported, eastmoney:not-supported |
| `news.finance_feed` | `finance_news` | `query_finance_news` | implemented<br>`readFinanceNewsRows` | akshare:supported, sina:supported | wind:credential-gated, yahoo:not-supported |
| `wind.financial_document` | `wind_document` | `query_wind_document` | implemented<br>`readWindDocumentRows` | - | wind:credential-gated |
| `wind.economic_series` | `wind_economic_series` | `query_wind_economic` | implemented<br>`readWindEconomicSeriesRows` | - | wind:credential-gated |
| `wind.analytics_result` | `wind_analytics_result` | `query_wind_analytics` | implemented<br>`readWindAnalyticsRows` | - | wind:credential-gated |
| `stock.tick_chart_intraday` | `tick_chart_intraday` | `query_tick_chart` | implemented<br>`readTickChartRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `stock.transactions` | `transactions` | `query_transactions` | implemented<br>`readTransactionRows` | tdx:supported, sina:supported, tencent:supported | eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `stock.volume_profile` | `volume_profile` | `query_volume_profile` | implemented<br>`readVolumeProfileRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `stock.xdxr_events` | `xdxr_event` | `query_xdxr` | implemented<br>`readXdxrRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported, wind:credential-gated |
| `stock.auction_snapshot` | `auction_snapshot` | `query_auction` | implemented<br>`readAuctionRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported, wind:not-supported |
| `stock.company_info` | `stock_company_info` | `query_stock_company_info`, `query_company_info` | implemented<br>`readCompanyInfoRows` | tdx:supported | wind:credential-gated, eastmoney:not-supported, akshare:not-supported |
| `stock.risk_metrics` | `stock_company_info` | `query_stock_risk_metrics`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `stock.shareholders` | `stock_shareholder` | `query_stock_shareholders` | implemented<br>`readStockShareholderRows` | akshare:supported | wind:credential-gated, eastmoney:not-supported, tdx:not-supported |
| `provider.api_call_log` | `api_call_log` | `query_api_calls` | implemented<br>`queryApiCalls` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, yahoo:not-supported, wind:not-supported |
| `provider.fetch_task_queue` | `fetch_task_queue` | `fetch_status` | implemented<br>`fetchStatus` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, yahoo:not-supported, wind:not-supported |
| `provider.coverage` | `provider_coverage` | `query_tdx_count`, `query_tdx_sampling` | implemented<br>`readProviderCoverageRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported |
| `provider.table_metadata` | `provider_table_metadata` | `query_ex_categories`, `query_ex_table` | implemented<br>`readProviderTableMetadataRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported |
| `market.tdx_block_member` | `tdx_block_member` | `query_tdx_block_member` | implemented<br>`readTdxBlockMemberRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported |
| `market.tdx_top_board` | `tdx_top_board` | `query_top_board` | implemented<br>`readTdxTopBoardRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported |
| `index.momentum` | `tdx_index_momentum` | `query_momentum` | implemented<br>`readIndexMomentumRows` | tdx:supported | eastmoney:not-supported, akshare:not-supported, wind:credential-gated |
| `index.profile` | `stock_company_info` | `query_index_profile`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `index.fundamentals` | `fundamental` | `query_index_fundamentals`, `query_fundamental` | implemented<br>`readFundamentalRows` | - | wind:credential-gated |
| `global.company_profile` | `yfinance_profile_fields` | `query_global_company_profile`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.financial_statements` | `yfinance_statement_items` | `query_global_financial_statements`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.income_statement` | `yfinance_statement_items` | `query_global_income_statement`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.balance_sheet` | `yfinance_statement_items` | `query_global_balance_sheet`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.cash_flow` | `yfinance_statement_items` | `query_global_cash_flow`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.earnings_calendar` | `yfinance_statement_items` | `query_global_earnings_calendar`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.earnings_history` | `yfinance_statement_items` | `query_global_earnings_history`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.earnings_estimates` | `yfinance_statement_items` | `query_global_earnings_estimates`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.eps_revisions` | `yfinance_statement_items` | `query_global_eps_revisions`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.eps_trend` | `yfinance_statement_items` | `query_global_eps_trend`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.quarterly_financial_statements` | `yfinance_statement_items` | `query_global_quarterly_financial_statements`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.quarterly_income_statement` | `yfinance_statement_items` | `query_global_quarterly_income_statement`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.quarterly_balance_sheet` | `yfinance_statement_items` | `query_global_quarterly_balance_sheet`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.quarterly_cash_flow` | `yfinance_statement_items` | `query_global_quarterly_cash_flow`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.recommendations` | `yfinance_recommendations` | `query_global_recommendations`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.upgrade_downgrade_events` | `yfinance_recommendations` | `query_global_upgrade_downgrade_events`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.holders` | `yfinance_holders` | `query_global_holders`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.major_holders` | `yfinance_holders` | `query_global_major_holders`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.institutional_holders` | `yfinance_holders` | `query_global_institutional_holders`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.mutual_fund_holders` | `yfinance_holders` | `query_global_mutual_fund_holders`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `global.insider_transactions` | `yfinance_insider_transactions` | `query_global_insider_transactions`, `query_yfinance` | implemented<br>`readYfinanceResearchRows` | yahoo:global-only | wind:not-supported |
| `option.expiry_calendar` | `yfinance_option_expiries` | `query_option_expiry_calendar`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.contract_list` | `yfinance_option_contracts` | `query_option_contract_list`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.quote` | `yfinance_option_contracts` | `query_option_quote`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.daily_kline` | `kline_daily` | `query_option_daily_kline`, `query_kline` | implemented<br>`readKlineRows` | yahoo:global-only | wind:not-supported |
| `option.open_interest` | `yfinance_option_contracts` | `query_option_open_interest`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.volume` | `yfinance_option_contracts` | `query_option_volume`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.implied_volatility` | `yfinance_option_contracts` | `query_option_implied_volatility`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.moneyness` | `yfinance_option_contracts` | `query_option_moneyness`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.bid_ask_spread` | `yfinance_option_contracts` | `query_option_bid_ask_spread`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.price_change` | `yfinance_option_contracts` | `query_option_price_change`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.trade_recency` | `yfinance_option_contracts` | `query_option_trade_recency`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `option.chain_snapshot` | `yfinance_options` | `query_option_chain_snapshot`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `global.options_chain` | `yfinance_options` | `query_global_options_chain`, `query_yfinance` | implemented<br>`readYfinanceOptionRows` | yahoo:global-only | wind:not-supported |
| `global.corporate_actions` | `yfinance_corporate_actions` | `query_global_corporate_actions`, `query_yfinance` | implemented<br>`readYfinanceCorporateActionRows` | yahoo:global-only | wind:not-supported |
| `global.dividends` | `yfinance_corporate_actions` | `query_global_dividends`, `query_yfinance` | implemented<br>`readYfinanceCorporateActionRows` | yahoo:global-only | wind:not-supported |
| `global.capital_gains` | `yfinance_corporate_actions` | `query_global_capital_gains`, `query_yfinance` | implemented<br>`readYfinanceCorporateActionRows` | yahoo:global-only | wind:not-supported |
| `global.stock_splits` | `yfinance_corporate_actions` | `query_global_stock_splits`, `query_yfinance` | implemented<br>`readYfinanceCorporateActionRows` | yahoo:global-only | wind:not-supported |
| `global.finance_news` | `yfinance_news` | `query_global_finance_news`, `query_yfinance` | implemented<br>`readYfinanceNewsRows` | yahoo:global-only | wind:not-supported |
| `market.screening` | `screening_result` | `query_market_screening` | implemented<br>`readMarketScreeningSnapshots` | tradingview:supported, akshare:supported | wind:credential-gated, tushare:not-supported |
| `market.margin_trading` | `margin_trading` | `query_margin_trading` | implemented<br>`queryMarginTradingRows` | akshare:supported | - |
| `data.coverage` | `data_coverage` | `coverage`, `reusable_summary` | implemented<br>`getReusableDataSummary` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `data.store_stats` | `data_store_stats` | `stats` | implemented<br>`stats` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `provider.source_status` | `provider_source_status` | `sources` | implemented<br>`sources` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `data.health` | `data_health_report` | `data_health` | implemented<br>`buildDataInterfaceHealth` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `data.runtime_probe` | `runtime_probe_status` | `runtime_probe` | implemented<br>`runtimeProbe` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `data.feed_status` | `data_feed_config` | `data_feeds` | implemented<br>`dataFeeds` | local:supported | eastmoney:not-supported, akshare:not-supported, tdx:not-supported, tushare:not-supported, yahoo:not-supported, wind:not-supported |
| `bond.convertible_quote` | `quote_snapshot` | `query_bond_quote`, `query_quote` | implemented<br>`readRecentQuoteSnapshot` | tencent:supported | wind:not-supported, eastmoney:not-supported, akshare:not-supported, sina:not-supported |
| `bond.convertible_daily_kline` | `kline_daily` | `query_bond_kline`, `query_kline` | implemented<br>`readKlineRows` | tencent:supported | wind:not-supported, eastmoney:not-supported, akshare:not-supported, sina:not-supported |
| `bond.profile` | `stock_company_info` | `query_bond_profile`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `bond.market_data` | `stock_company_info` | `query_bond_market_data`, `query_company_info` | implemented<br>`readCompanyInfoRows` | - | wind:credential-gated |
| `bond.issuer_financials` | `fundamental` | `query_bond_issuer_financials`, `query_fundamental` | implemented<br>`readFundamentalRows` | - | wind:credential-gated |
| `technical.indicator_series` | `technical_indicator_series` | `query_technical_indicator` | implemented<br>`readTechnicalIndicatorSeries` | ta:supported | tradingview:not-supported, wind:credential-gated |
| `stock.alpha_factors` | `alpha_factor` | `query_alpha_factors` | implemented<br>`readAlphaFactorRows` | akshare:supported | ta:not-supported, wind:not-supported, tdx:not-supported, yahoo:not-supported |

Provider parameters are routing constraints for these interfaces. They are not permission to bypass local cache/readback, canonical normalizers, persistence, or API health policy.

Cache reuse rule: default `cache-first` reads canonical local rows before provider
routing and reuses them only when the interface-specific source data timestamp,
date window, or coverage rule satisfies the request. Local `fetched_at` records
ingest time and must not be used as market freshness. `live-only` bypasses
local rows, `cache-only` refuses provider calls after a miss, and
`providerMode: strict` requires any cache hit to carry matching provider/source
evidence before reuse; otherwise the cache is treated as a miss and only the
requested provider route is eligible. Use `live-only` when explicit provider
validation must force a live provider call.
