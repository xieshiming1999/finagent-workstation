---
description: Proactively use for Yahoo/yfinance data in FinAgent Workstation: US/HK/global quotes, history, fundamentals, news, options, ETFs, indices, FX, and crypto. Do not use for China A-share symbols.
when_to_use: Load when the user asks for US stocks, HK stocks, global indices, ETFs, crypto, FX, Yahoo Finance, yfinance, non-A-share quote/history/fundamentals/news/options, or global-market fallback data in FinAgent Workstation.
---
# yfinance / Yahoo Finance

Use this skill for structured global-market data in FinAgent Workstation. yfinance is
best for US/HK/global quotes, daily history, lightweight fundamentals, news,
holders, dividends/splits, and option chains.

## Core Rules

- Use yfinance for non-A-share instruments only: US stocks, HK stocks, ETFs,
  global indices, FX, and crypto pairs.
- Do not use yfinance for China A-share symbols such as `600519`, `000001`,
  `600519.SH`, or `000001.SZ`. For A-shares use local SQLite, TDX/gotdx,
  EastMoney/AkShare, Wind, or another China-market source.
- In FinAgent Workstation, prefer the requirement-level MarketData/DataStore path.
  Do not call Yahoo public URLs directly for normal workflows; use them only
  for explicit WebFetch diagnostics or one-off source investigation.
- If a governed interface already covers the task, prefer `query_*`,
  `DataStore(action:"fetch", ...)`, or requirement-level MarketData routes
  first. Treat compatibility `DataStore(action:"yfinance", ...)` calls as
  provider validation or explicit provider-specific paths.
- Always disclose source and freshness/delay when using Yahoo/yfinance in
  analysis or dashboard fallback text.
- Keep yfinance as structured fallback data for dashboards; use TradingView
  widgets for visual live cards/charts when visualization is the main goal.

## Preferred Calls

Use cache/readback routes before spending another Yahoo call:

```text
DataStore(action: "data_health")
DataStore(action: "coverage", code: "AAPL")
DataStore(action: "query_quote", code: "AAPL")
DataStore(action: "query_kline", code: "AAPL", adjust: "none")
DataStore(action: "query_yfinance", dataset: "profile", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "statements", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "earnings_calendar", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "earnings_history", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "earnings_estimates", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "eps_revisions", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "eps_trend", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "quarterly_financial_statements", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "recommendations", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "upgrade_downgrade_events", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "news", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_expiries", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "options", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_open_interest", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_volume", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_implied_volatility", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_moneyness", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_bid_ask_spread", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_price_change", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_trade_recency", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "actions", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "dividends", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "splits", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "institutional_holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "mutual_fund_holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "insiders", symbol: "AAPL")
```

Then use requirement-level fetch routes when readback returns
`cacheStatus:local-miss` or coverage is stale for the task:

```text
MarketData(action: "yahoo", code: "AAPL")
MarketData(action: "yahoo_history", code: "AAPL", range: "6mo")
MarketData(action: "yahoo_earnings", code: "AAPL")
```

Use output-only discovery and diagnostics only when validating provider
behavior:

```text
DataStore(action: "provider_discovery", provider: "yfinance", query: "earnings")
DataStore(action: "provider_diagnostic", provider: "yfinance", func: "history", symbol: "AAPL")
```

Compatibility `DataStore(action:"yfinance", ...)` calls are provider validation
paths. They may persist only when the runtime has a registered schema:

- `fast_info` -> canonical `quote_snapshot`
- `history` -> canonical `kline_daily`
- `info`, statements, recommendations, news, options, corporate actions,
  holders, and insider transactions -> typed `yfinance_*` SQLite tables

Use `persist:false` only for inspection of a registered schema when you
deliberately do not want any local write. Unknown actions are not normal
workflow data; use `provider_diagnostic` for bounded inspection or add a
normalizer/interface before relying on the response. Query persisted typed
yfinance rows with:

```text
DataStore(action: "query_yfinance", dataset: "profile", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "statements", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "recommendations", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "news", symbol: "TSLA")
DataStore(action: "query_yfinance", dataset: "options", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_open_interest", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_volume", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_implied_volatility", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_moneyness", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_bid_ask_spread", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_price_change", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "option_trade_recency", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "actions", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "dividends", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "splits", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "institutional_holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "mutual_fund_holders", symbol: "AAPL")
DataStore(action: "query_yfinance", dataset: "insiders", symbol: "AAPL")
```

Readback output is provenance-bearing. `cacheStatus:local-hit` means canonical
rows were reused; `cacheStatus:local-miss` means no reusable local rows were
found and a governed Yahoo fetch route may be needed. Do not interpret
`local-miss` as "the company has no data" without checking provider health or
running the appropriate fetch.

For simple global price/history via app routes:

```text
MarketData(action: "yahoo", code: "AAPL")
MarketData(action: "yahoo_history", code: "AAPL", range: "6mo")
MarketData(action: "yahoo_earnings", code: "AAPL")
```

In WebView dashboards, use `Bridge.fetch('/api/finance/yahoo/price')` only if
that route exists in the current runtime. Otherwise ask the agent to fetch via
`DataStore`/`MarketData` and render local fallback data into the page.

## Symbol Formats

| Market | Format | Examples |
|--------|--------|----------|
| US stock / ETF | plain ticker | `AAPL`, `MSFT`, `SPY`, `QQQ` |
| Hong Kong | 4 digits + `.HK` | `0700.HK`, `9988.HK` |
| Global index | `^` prefix | `^GSPC`, `^IXIC`, `^VIX` |
| Crypto | `XXX-USD` | `BTC-USD`, `ETH-USD` |
| FX | `XXXYYY=X` | `EURUSD=X`, `USDJPY=X` |

## Common Actions

| yfinance action | Use |
|-----------------|-----|
| `fast_info` | fast quote-like fields |
| `history` | OHLCV bars; pass `period`, `interval`, optional `start`/`end` |
| `info` | company profile and broad metadata |
| `financials` | income statement style table |
| `balance_sheet` | balance sheet |
| `cash_flow` | cash flow |
| `earnings_dates` / `earnings_history` / `earnings_estimate` | earnings date/history/estimate tables; use search first because installed yfinance versions differ |
| `news` | Yahoo news list |
| `recommendations` | analyst recommendations |
| `options` | available option expiry dates |
| `option_chain` | calls/puts for an expiry; optional `date` |
| `dividends` / `splits` | corporate action history |
| `institutional_holders` / `insider_transactions` | ownership/insider data |

Use `DataStore(action:"provider_discovery", provider:"yfinance", query:"...")`
when unsure of the exact action name.

## URL Families

These are reference URLs. Prefer the local sidecar unless direct WebFetch is
explicitly needed.

| Purpose | URL family |
|---------|------------|
| Sidecar proxy | `http://127.0.0.1:19800/yfinance/{action}?symbol=AAPL` |
| Sidecar action search | Internal sidecar route surfaced through `DataStore(action:"provider_discovery", provider:"yfinance", query:"earnings")` |
| Chart quote/history | `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=2d` |
| CSV history download | `https://query1.finance.yahoo.com/v7/finance/download/{symbol}?period1=...&period2=...&interval=1d&events=history` |
| Multi-symbol quote | `https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT` |
| Quote summary | `https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules=...` |
| Search | `https://query1.finance.yahoo.com/v1/finance/search?q=AAPL` |
| Options | `https://query1.finance.yahoo.com/v7/finance/options/{symbol}` |
| Trending | `https://query1.finance.yahoo.com/v1/finance/trending/{region}` |
| News RSS | `https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US` |

`query2.finance.yahoo.com` often mirrors the same endpoint families.

## Failure Handling

- If the Python sidecar is starting, wait briefly or use
  `DataStore(action:"provider_status")` before retrying.
- If an action returns unknown, use `provider_discovery` and
  `provider_diagnostic`; do not treat unknown output as structured data.
- If Yahoo/yfinance is slow or rate-limited, reduce symbol count and avoid broad
  polling; do not retry in a tight loop.
- If the request is for A-shares, stop and switch to China-market providers
  instead of forcing a Yahoo symbol mapping.
