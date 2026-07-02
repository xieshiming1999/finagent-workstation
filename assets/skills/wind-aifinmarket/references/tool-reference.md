# Wind Tool Reference

This is the native-call summary of the official Wind `wind-mcp-skill` tool table. The full upstream snapshot is in `official-wind-mcp-skill.md`.

## Shared Market Data Tools

These four server types share quote/K-line/minute signatures:

- `stock_data`: A-share stocks.
- `global_stock_data`: HK and US stocks.
- `fund_data`: ETFs, LOFs, and mutual funds.
- `index_data`: indexes and sectors.

### Price Indicator Tools

Tools:

- `stock_data.get_stock_price_indicators`
- `global_stock_data.get_global_stock_price_indicators`
- `fund_data.get_fund_price_indicators`
- `index_data.get_index_price_indicators`

Arguments:

- `windcode` required. Code or security name. Examples: `600519.SH`, `00700.HK`, `AAPL.O`, `005827.OF`, `000300.SH`.
- `indexes` required. Comma-separated Chinese field names. Must be verified in `indicators.md`.

Example:

```json
{"action":"call","server":"stock_data","tool":"get_stock_price_indicators","arguments":{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅,成交量"}}
```

### K-Line Tools

Tools:

- `stock_data.get_stock_kline`
- `global_stock_data.get_global_stock_kline`
- `fund_data.get_fund_kline`
- `index_data.get_index_kline`

Arguments:

- `windcode` required.
- `begin_date` required, `yyyyMMdd`.
- `end_date` required, `yyyyMMdd`.
- `count` optional. Positive means from `begin_date` forward; negative means from `end_date` backward.
- `period` optional, default `"10"`: `1` 1m, `3` 5m, `4` 10m, `5` 15m, `6` 30m, `7` 60m, `8` 120m, `9` 240m, `10` daily, `11` weekly, `12` monthly, `13` yearly, `14` quarterly, `15` half-year.
- `aftype` optional, default `"0"`: `0` forward-adjusted, `1` backward-adjusted.
- `issusp` optional, default `"1"`: `0` exclude suspended, `1` include.
- `afdate` optional adjustment base date, `yyyyMMdd`.

Example:

```json
{"action":"call","server":"index_data","tool":"get_index_kline","arguments":{"windcode":"000300.SH","begin_date":"20260401","end_date":"20260430"}}
```

### Minute Quote Tools

Tools:

- `stock_data.get_stock_quote`
- `global_stock_data.get_global_stock_quote`
- `fund_data.get_fund_quote`
- `index_data.get_index_quote`

Arguments:

- `windcode` required.
- `begin` optional, default `LAST`, `yyyyMMdd` or `LAST`.
- `end` optional, default `LAST`, `yyyyMMdd` or `LAST`.

Example:

```json
{"action":"call","server":"stock_data","tool":"get_stock_quote","arguments":{"windcode":"600519.SH"}}
```

## NL Tools

All NL tools use:

- `question` required.
- `lang` optional, `"中文"` or `"English"`, default `"中文"`.

### `stock_data` NL, A-share only

- `get_stock_basicinfo`: company profile, business, industry, IPO/listing board.
- `get_stock_fundamentals`: financial statements, profitability, balance sheet, cash flow, growth, bank-specific metrics.
- `get_stock_equity_holders`: equity capital, float, top holders, controller, restricted shares.
- `get_stock_events`: IPO, refinancing, allotment, M&A, ST, dividends.
- `get_stock_technicals`: MACD, KDJ, RSI, BOLL, margin financing, dragon-tiger list.
- `get_risk_metrics`: beta, Jensen alpha, volatility, Sharpe, VaR.

### `global_stock_data` NL, HK/US stocks

- `get_global_stock_basicinfo`
- `get_global_stock_fundamentals`
- `get_global_stock_equity_holders`
- `get_global_stock_events`
- `get_global_stock_technicals`
- `get_global_stock_risk_metrics`

### `fund_data` NL

- `get_fund_info`: profile, manager, company, investment style.
- `get_fund_financials`: NAV, scale, fees, income, balance-sheet-like fund data.
- `get_fund_holdings`: holdings and allocation.
- `get_fund_performance`: performance, ranking, drawdown, risk-return.
- `get_fund_holders`: holders and structure.
- `get_fund_company_info`: fund management company.

### `index_data` NL

- `get_index_basicinfo`: index profile and methodology.
- `get_index_fundamentals`: weighted PE/PB/PS and constituent fundamentals.
- `get_index_technicals`: index technical indicators.

### `bond_data` NL

- `get_bond_basicinfo`: bond terms and basic profile.
- `get_bond_issuer_info`: issuer/company profile.
- `get_bond_market_data`: price, yield, duration, convexity, spread.
- `get_bond_financial_data`: issuer financials.

## Document RAG

### `financial_docs.get_company_announcements`

Arguments:

- `query` required.
- `top_k` optional.

Use for announcements, annual reports, filings, prospectuses, and regulatory disclosures.

### `financial_docs.get_financial_news`

Arguments:

- `query` required.
- `top_k` optional.

Use for news, media, flash, report, and commentary intent.

## Economic Data

### `economic_data.get_economic_data`

Primary argument:

- `metricIdsStr` required.

Optional fields may include date range, `freq`, `magnitude`, `currency`, and `searchType`. Use the user's requested indicator wording directly when unsure.

## General Analytics

### `analytics_data.get_financial_data`

Arguments:

- `question` required.
- `lang` optional.

Use only as fallback when specific routes do not match.
