# Wind Intent Routing

Follow this order before constructing parameters. Do not skip steps and do not let `analytics_data` preempt a specific match.

## 1. Financial Documents

Use `financial_docs` first for document/news intent.

- News, media report, flash, commentary, latest report: `financial_docs.get_financial_news`
- Announcement, annual report, interim report, quarterly report, prospectus, regulatory filing: `financial_docs.get_company_announcements`

## 2. Macro And Industry Indicators

Use `economic_data.get_economic_data` for GDP, CPI, PPI, PMI, social financing, interest rates, unemployment, import/export, production/sales, and other macro or industry EDB indicators.

## 3. Market Quotes And Time Series

When the user asks for latest price, change, volume, K-line, minute line, intraday move, or historical price series:

- A-share stock: `stock_data`
- HK/US stock: `global_stock_data`
- ETF/LOF/mutual fund: `fund_data`
- Index/sector: `index_data`

Then choose:

- Current snapshot or single-point indicators: `*_price_indicators`
- Multi-day or historical bars: `*_kline`
- Intraday/minute data: `*_quote`

## 4. Deep Domain NL Tools

For fundamentals, company profile, equity holders, events, technical indicators, risk metrics, fund holdings/performance/manager/company, index fundamentals, bond issuer/valuation/financials, use the matching NL tool under the specific server.

## 5. General Fallback

Use `analytics_data.get_financial_data` only when steps 1-4 do not match or a specific structured route cannot express the user's request.

## Hard Constraints

- One user question should have one primary route unless the user explicitly asks for comparison or multiple datasets.
- Do not answer financial facts from general knowledge when a Wind route applies.
- Do not use `analytics_data` to bypass missing parameters for a specific tool; first ask a short clarification or correct the parameters.
- For ambiguous short company names, ask which security the user means before calling Wind.
