---
name: wind-mcp-skill
description: >-
  Access Wind financial data covering A-share, Hong Kong, and US equities
  (latest price, K-line, minute data), financial fundamentals (reports, equity,
  events, technicals, risk), ETF and mutual-fund datasets (profile, financials,
  holdings, performance, holders, management company), index and sector data,
  bond data, company announcements, financial news, macro indicators, and
  industry statistics. Requires `WIND_API_KEY` from
  `aifinmarket.wind.com.cn/#/user/overview`. Not covered: European or Japanese
  equities, FX or futures order-book quotes, crypto, or non-financial data.
author: Wind
homepage: https://aifinmarket.wind.com.cn
auto_invoke: true
security:
  child_process: true
  eval: false
  filesystem_read: true
  filesystem_write: true
  network: true
examples:
  - "latest price of Kweichow Moutai today"
  - "latest price and volume for Tencent Holdings (00700.HK)"
  - "30-day K-line for Apple (AAPL.O)"
  - "30-day K-line for CATL"
  - "intraday minute trend for Kweichow Moutai today"
  - "latest premium or discount rate for STAR 50 ETF (588200.SH)"
  - "latest AUM and manager for E Fund Blue Chip Select (005827.OF)"
  - "1-month trend of CSI 300"
  - "historical PE/PB percentile for CSI 500"
  - "basic info and latest market data for Treasury 2601"
  - "CATL 2024 ROE and net-profit growth"
  - "2024 annual report content for Kweichow Moutai"
  - "latest news on the Fed's 2026 rate policy"
  - "China new-energy vehicle production and sales over the last 10 years"
  - "top 10 shareholders of Kweichow Moutai"
---

# Wind Financial Data via MCP

This reference explains how to access Wind financial data through the MCP-based
CLI. It covers equities, funds, indexes, bonds, announcements, financial news,
and macro or industry indicators.

---

## 1. Coverage

Each `server_type` exposes a specific capability family:

| `server_type` | Coverage | Tools |
| --- | --- | --- |
| `stock_data` | A-share market data plus company profile, fundamentals, equity structure, events, technicals, and risk | `get_stock_price_indicators`, `get_stock_kline`, `get_stock_quote`, `get_stock_basicinfo`, `get_stock_fundamentals`, `get_stock_equity_holders`, `get_stock_events`, `get_stock_technicals`, `get_risk_metrics` |
| `global_stock_data` | Hong Kong and US equity market data plus profile, fundamentals, equity structure, events, technicals, and risk | `get_global_stock_price_indicators`, `get_global_stock_kline`, `get_global_stock_quote`, `get_global_stock_basicinfo`, `get_global_stock_fundamentals`, `get_global_stock_equity_holders`, `get_global_stock_events`, `get_global_stock_technicals`, `get_global_stock_risk_metrics` |
| `fund_data` | ETF / LOF / mutual-fund market data plus profile, financials, holdings, performance, holders, and management-company info | `get_fund_price_indicators`, `get_fund_kline`, `get_fund_quote`, `get_fund_info`, `get_fund_financials`, `get_fund_holdings`, `get_fund_performance`, `get_fund_holders`, `get_fund_company_info` |
| `index_data` | Index and board market data plus profile, fundamentals, and technicals | `get_index_price_indicators`, `get_index_kline`, `get_index_quote`, `get_index_basicinfo`, `get_index_fundamentals`, `get_index_technicals` |
| `bond_data` | Bond basic info, issuer info, market and valuation data, issuer financials | `get_bond_basicinfo`, `get_bond_issuer_info`, `get_bond_market_data`, `get_bond_financial_data` |
| `financial_docs` | Company announcements and financial-news retrieval | `get_company_announcements`, `get_financial_news` |
| `economic_data` | Macro and industry economic indicators, including frequency, magnitude, currency, and search-mode controls | `get_economic_data` |
| `analytics_data` | Natural-language structured retrieval across the broader Wind data universe, including cross-domain, derivatives, or commodities | `get_financial_data` |

Use `references/tool-manifest.json` as the source of truth for valid
`server_type + tool_name` combinations. The CLI rejects invalid combinations
before the backend call and reports the available tools.

Not covered:
- European or Japanese equities
- FX or futures order-book quotes
- crypto
- non-financial data

Freshness expectations:
- quote snapshots and minute data are near real-time for the current day
- K-line data is historical close-based series
- financials and profiles are tied to the latest available reporting period
- `WIND_API_KEY` usage is subject to daily quota

---

## 2. How To Call It

### Command Form

Paths in this document such as `scripts/cli.mjs` or
`references/indicators.md` are relative to this skill directory, not the shell
working directory.

Prefer either:
- the absolute `<skill_dir>/scripts/cli.mjs` path, or
- `cd <skill_dir>` before running examples

```bash
node scripts/cli.mjs call <server_type> <tool_name> '<params_json>'
```

### CLI Output Contract

`cli.mjs` uses exit code to distinguish success from failure. Do not parse
stderr for business results; stderr is for internal notices only.
`scripts/update-check.mjs` is an internal background helper, not the agent
entry point.

Success path (`exit code 0`):
- stdout is raw data only, with no envelope
- `call` returns the MCP `result` object unchanged
- business payload usually lives in `result.content[0].text`
- `open-portal` and `setup-key` return structured JSON on stdout
- running the CLI without arguments returns plain-text usage

Failure path (`exit code != 0`):
- stdout returns an envelope with only two top-level keys: `ok` and `error`

```json
{
  "ok": false,
  "error": {
    "code": "KEY_MISSING",
    "agent_action": "[backend diagnostic] WIND_API_KEY is not configured. Run ..."
  }
}
```

`error.code` is the stable classifier for integration logic.
`error.agent_action` is the natural-language corrective instruction for the
agent.

All update-check signals stay on stderr and never appear in the stdout
envelope. See section 8.

The full error-code list is in `references/error-codes.json`.

### Mandatory Error Actions

- `KEY_MISSING`:
  - immediately run `node <skill_dir>/scripts/cli.mjs open-portal`
  - do not merely print the command or URL to the user
  - if `open-portal` succeeds, read its stdout JSON and relay the `url` or
    `flow_note`, then wait for the user to provide the key
- `OPEN_PORTAL_FAILED`:
  - if the `open-portal` command itself fails, send the embedded URL from
    `agent_action` so the user can open it manually
- after the user provides a key:
  - ask for the desired storage scope if needed
  - run `node <skill_dir>/scripts/cli.mjs setup-key <KEY> --scope <global|skill>`
  - retry the original request

### Shell Escaping Rules

`INVALID_PARAMS_JSON` is most often caused by shell-escaping mistakes. The JSON
third argument must match the current shell's quoting rules.

| Shell | Pattern | Example |
| --- | --- | --- |
| Bash / Git Bash / WSL | Wrap the whole JSON in single quotes; keep internal double quotes unescaped | `node scripts/cli.mjs call stock_data get_stock_quote '{"windcode":"600519.SH"}'` |
| Windows PowerShell 5.x | Wrap the JSON in single quotes and escape each internal double quote as `\"` | `node scripts/cli.mjs call stock_data get_stock_quote '{\"windcode\":\"600519.SH\"}'` |
| PowerShell with `--%` | After `--%`, do not add another outer quote layer; internal double quotes still use `\"` | `node scripts/cli.mjs call stock_data get_stock_quote --% {\"windcode\":\"600519.SH\"}` |
| `cmd.exe` | Wrap the JSON in double quotes and escape inner quotes | `node scripts/cli.mjs call stock_data get_stock_quote "{\"windcode\":\"600519.SH\"}"` |

Do not mix shell styles. If you are unsure, echo what Node actually receives:

```bash
node -e "console.log(process.argv.slice(1))" <params_json>
```

PowerShell natural-language example:

```bash
node scripts/cli.mjs call stock_data get_stock_basicinfo '{\"question\":\"海光信息688041公司基本资料、所属行业\",\"lang\":\"中文\"}'
```

In that mode, the `question` or `query` field must not contain spaces; use
punctuation or direct concatenation.

### Codex Network Requirement

When `scripts/cli.mjs call ...` needs network access to Wind in Codex, run it
with `sandbox_permissions: "require_escalated"` in the Codex tool invocation.
That is a Codex tool parameter, not a shell flag.

Recommended Codex `prefix_rule`:

```json
["node", "scripts/cli.mjs", "call"]
```

### API Key

`WIND_API_KEY` is required. Fetch it from:
`https://aifinmarket.wind.com.cn/#/user/overview`

### The Input Signature Depends On The Tool

Do not guess input fields. Always match the exact schema of the chosen tool.
There are three broad patterns:

1. Structured market-data parameters such as `windcode`, `indexes`,
   `begin_date`, `end_date`, or `period`
2. Natural-language `question` inputs for profile, fundamentals, technicals,
   risk, bond, or analytics tools
3. `query` or `metricIdsStr` for documents or economic data

---

## Intent Routing Order (Mandatory)

For every request, determine intent first, then choose `server_type` and
`tool_name`. Follow this fixed order. Do not skip steps or route in parallel.

1. **Documents first (`financial_docs`)**
   - news, media, breaking updates, commentary: use
     `financial_docs.get_financial_news`
   - announcements, annual reports, interim reports, prospectuses, or
     regulatory disclosures: use
     `financial_docs.get_company_announcements`

2. **Macro indicators (`economic_data`)**
   - GDP, CPI, PPI, PMI, credit, rates, unemployment, imports/exports, or
     similar macro indicators: use `economic_data.get_economic_data`

3. **Market time series (`stock_data` / `global_stock_data` / `fund_data` /
   `index_data`)**
   - latest price, price change, turnover, K-line, minute line, or intraday
     trend:
   - determine security type and market first
   - then choose the specialized market-data tool

4. **Deep domain natural-language tools**
   - fundamentals, equity structure, holders, events, technicals, risk,
     holdings, performance, issuer financials, and similar deeper tasks should
     use the corresponding specialized NL tool

5. **Fallback only (`analytics_data`)**
   - only use `analytics_data.get_financial_data` when steps 1 to 4 do not fit

Hard constraints:
- `analytics_data` must not preempt a clearly specialized intent
- one main route per user question
- routing must happen before parameter construction or execution

## 3. Tool Reference

### Market-data tools shared by `stock_data`, `global_stock_data`, `fund_data`, and `index_data`

Wind resolves `windcode` from Chinese names, short names, or codes, for
example:
- `贵州茅台` -> `600519.SH`
- `小米集团` -> `01810.HK`
- `苹果公司` -> `AAPL.O`
- `易方达蓝筹精选` -> `005827.OF`
- `沪深300` -> `000300.SH`

Typical code formats:
- A-share: `600519.SH`, `8XXXXX.BJ`
- Hong Kong: `00700.HK`
- US: `AAPL.O`, `MSFT.O`
- OTC fund: `005827.OF`
- ETF / LOF: `588200.SH`, `159915.SZ`
- index: `000300.SH`, `000905.SH`, `HSI.HI`

If the user uses an ambiguous short name such as `茅台`, ask a clarification
question. The backend may auto-select one candidate and can choose the wrong
one.

#### Snapshot tools

Tools:
- `get_stock_price_indicators`
- `get_global_stock_price_indicators`
- `get_fund_price_indicators`
- `get_index_price_indicators`

Use these for latest-value snapshot fields rather than time series.

| Field | Required | Notes |
| --- | --- | --- |
| `windcode` | yes | target security |
| `indexes` | yes | comma-separated Chinese field names only; check every field against `references/indicators.md` before calling |

Common candidates still need verification against `references/indicators.md`:
- generic: `中文简称`, `最新成交价`, `前收盘价`, `今日开盘价`, `今日最高价`, `今日最低价`, `成交量`, `成交额`, `涨跌`, `涨跌幅`
- stock-specific: `换手率`, `量比`, `委比`, `涨停价`, `跌停价`, `52周最高`, `52周最低`, `总市值1`, `流通市值`, `市盈率(TTM)`, `市净率`, `股息率`
- fund-specific: `IOPV`, `贴水率`, `基金最新份额`, `基金规模`, `最新净值`, `累计净值`, `七日年化收益率`
- index-specific: `成分股贡献点数`, `上涨家数`, `下跌家数`, `平盘家数`

Do not invent, translate, or paraphrase field names.

#### K-line tools

Tools:
- `get_stock_kline`
- `get_global_stock_kline`
- `get_fund_kline`
- `get_index_kline`

These return historical bar series. Default `period=10` is daily K-line.

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `windcode` | yes |  | target security |
| `begin_date` | yes |  | `yyyyMMdd`, for example `20260401` |
| `end_date` | yes |  | `yyyyMMdd`, for example `20260430` |
| `count` | no |  | positive means N rows forward from `begin_date`; negative means N rows backward from `end_date` |
| `period` | no | `"10"` | `1`=1m, `3`=5m, `4`=10m, `5`=15m, `6`=30m, `7`=60m, `8`=120m, `9`=240m, `10`=daily, `11`=weekly, `12`=monthly, `13`=yearly, `14`=quarterly, `15`=semiannual |
| `aftype` | no | `"0"` | `0`=forward-adjusted, `1`=backward-adjusted |
| `issusp` | no | `"1"` | `0`=exclude suspended, `1`=include suspended |
| `afdate` | no |  | adjustment base date, usually not needed |

#### Minute-quote tools

Tools:
- `get_stock_quote`
- `get_global_stock_quote`
- `get_fund_quote`
- `get_index_quote`

These return minute-level intraday data.

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `windcode` | yes |  | target security |
| `begin` | no | `LAST` | `yyyyMMdd` or `LAST` |
| `end` | no | `LAST` | `yyyyMMdd` or `LAST` |

Example calls:

```bash
# A-share
node scripts/cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅,成交量"}'
node scripts/cli.mjs call stock_data get_stock_kline '{"windcode":"600519.SH","begin_date":"20260401","end_date":"20260430"}'
node scripts/cli.mjs call stock_data get_stock_quote '{"windcode":"600519.SH"}'

# Hong Kong / US
node scripts/cli.mjs call global_stock_data get_global_stock_price_indicators '{"windcode":"AAPL.O","indexes":"中文简称,最新成交价,涨跌幅,52周最高"}'
node scripts/cli.mjs call global_stock_data get_global_stock_kline '{"windcode":"00700.HK","begin_date":"20260401","end_date":"20260430"}'

# ETF
node scripts/cli.mjs call fund_data get_fund_price_indicators '{"windcode":"588200.SH","indexes":"中文简称,最新成交价,IOPV,贴水率"}'

# Index
node scripts/cli.mjs call index_data get_index_price_indicators '{"windcode":"000300.SH","indexes":"最新成交价,涨跌幅,成交量,成交额"}'
node scripts/cli.mjs call index_data get_index_kline '{"windcode":"000300.SH","begin_date":"20260401","end_date":"20260430"}'
```

### Natural-language tools by `server_type`

#### `stock_data` NL (A-shares only)

Input signature: `{question: string, lang?}`

`question` should combine the A-share security and the business intent.
`lang` is optional and defaults to `"中文"`.

| Tool | Coverage | Example |
| --- | --- | --- |
| `get_stock_basicinfo` | company profile, main business, industry, listing board | `"600519.SH公司基本档案"` |
| `get_stock_fundamentals` | profitability, balance sheet, income statement, cash flow, growth, banking-specific metrics | `"贵州茅台2024年ROE和净利润增速"` |
| `get_stock_equity_holders` | share capital, float, top holders, controller, lock-up | `"贵州茅台前十大股东"` |
| `get_stock_events` | IPO, placements, rights issues, M&A, ST, dividends | `"宁德时代2024年增发和并购事件"` |
| `get_stock_technicals` | MACD, KDJ, RSI, BOLL, margin trading, Dragon Tiger list, and other technical series | `"贵州茅台近60日MACD走势"` |
| `get_risk_metrics` | beta, Jensen alpha, volatility, Sharpe, VaR | `"贵州茅台过去1年Beta和波动率"` |

#### `global_stock_data` NL (Hong Kong and US equities)

Input signature: `{question: string, lang?}`

| Tool | Coverage | Example |
| --- | --- | --- |
| `get_global_stock_basicinfo` | company profile, listing venue, industry, index membership | `"AAPL.O公司基本档案"` |
| `get_global_stock_fundamentals` | ROE, revenue, profitability, PE/PB/PS, historical percentile | `"腾讯(00700.HK)2024年ROE和营收"` |
| `get_global_stock_equity_holders` | share capital, major holders, institutional ownership | `"腾讯(00700.HK)前十大股东"` |
| `get_global_stock_events` | dividends, placements, acquisitions, compliance events | `"腾讯(00700.HK)分红历史"` |
| `get_global_stock_technicals` | MACD, RSI, BOLL, relative performance, financing indicators | `"AAPL.O的MACD和RSI"` |
| `get_global_stock_risk_metrics` | beta, alpha, volatility, Sharpe, max drawdown, VaR | `"AAPL.O过去1年Beta和波动率"` |

#### `fund_data` NL

Input signature: `{question: string, lang?}`

| Tool | Coverage | Example |
| --- | --- | --- |
| `get_fund_info` | profile, style, benchmark, fees, manager | `"易方达蓝筹精选(005827.OF)基金档案"` |
| `get_fund_financials` | profit, NAV, income, expenses, dividends | `"005827.OF2024年净利润和分红"` |
| `get_fund_holdings` | top holdings, asset allocation, Shenwan / Wind / CITIC industry splits | `"005827.OF最新一期重仓股"` |
| `get_fund_performance` | performance, ranking, ETF secondary-market metrics | `"005827.OF近1年业绩排名"` |
| `get_fund_holders` | retail vs institutional holders, subscriptions, redemptions, size changes | `"005827.OF持有人结构"` |
| `get_fund_company_info` | fund-company profile and manager team | `"易方达基金管理公司档案"` |

#### `index_data` NL

Input signature: `{question: string, lang?}`

| Tool | Coverage | Example |
| --- | --- | --- |
| `get_index_basicinfo` | publisher, base date, base point, methodology, constituent count | `"沪深300指数档案"` |
| `get_index_fundamentals` | weighted PE, PB, PS, revenue, profit, cash flow, historical percentile | `"沪深300PE/PB历史分位"` |
| `get_index_technicals` | multi-period returns, trend, oscillators, volume-price, volatility | `"中证500的MACD和RSI"` |

#### `bond_data` NL

Input signature: `{question: string, lang?}`

There are no separate bond snapshot tools. Bond quote or valuation style requests
still go through the NL bond tools.

| Tool | Coverage | Example |
| --- | --- | --- |
| `get_bond_basicinfo` | exchange, classification, issue date, size, coupon, tenor, repayment | `"国债2601基本信息"` |
| `get_bond_issuer_info` | issuer profile, registered region, industry, ownership | `"国债2601发债主体"` |
| `get_bond_market_data` | quotes, valuation, premium, duration, convexity, spread | `"国债2601久期和凸性"` |
| `get_bond_financial_data` | issuer revenue, profit, assets, liabilities | `"国债2601主体2024年营收"` |

#### `financial_docs` announcement and news tools

`get_company_announcements` returns official announcements and regulatory
filings from listed companies, bond issuers, and other financial-instrument
issuers.

`get_financial_news` returns third-party financial news and media coverage.

Shared parameters:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `query` | yes | string | natural language, for example `"贵州茅台2024年报"` or `"美联储利率政策"` |
| `top_k` | no | int | number of documents to return |

```bash
node scripts/cli.mjs call financial_docs get_financial_news '{"query":"美联储利率政策","top_k":5}'
```

#### `economic_data`

`get_economic_data` returns macro or industry indicators and supports explicit
frequency, magnitude, currency, and search-type control.

| Field | Required | Notes |
| --- | --- | --- |
| `metricIdsStr` | yes | a natural-language metric request, not a metric ID, for example `"中国GDP"` or `"美国CPI同比"` |
| `beginDate` / `endDate` | no | `yyyyMMdd` |
| `freq` | no | Chinese labels or codes such as `日`=`1`, `周`=`3`, `月`=`4`, `季`=`5`, `年`=`7` |
| `magnitude` | no | unit scaling, for example `个`, `千`, `万`, `亿`, `万亿` |
| `currency` | no | `USD`, `CNY`, `EUR`, `JPY`, `AUD`, `GBP`, `CHF`, `CAD`, `SGD`, `HKD`, `MYR`, `BYR` |
| `searchType` | no | `深度`=`0`, `精确`=`1` |
| `ifUnion` | no | `开启`=`1`, `不开启`=`2` for mixed search |

```bash
node scripts/cli.mjs call economic_data get_economic_data '{"metricIdsStr":"中国CPI同比","freq":"月","beginDate":"20240101","endDate":"20261231"}'
```

#### `analytics_data`

`get_financial_data` is the generic structured NL retrieval tool. The backend
parses the natural-language `question` and chooses a matching data query. Use
it mainly for cross-domain coverage, derivatives, commodities, or structured
data that the specialized servers do not cover.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `question` | yes | string | concise natural-language data request |
| `lang` | no | enum | `CNS` for Chinese (default), `ENS` for English |

Field-name constraint:
- `analytics_data.get_financial_data` accepts `question`
- do not send `query` to `analytics_data`
- `query` is only for `financial_docs`
- `metricIdsStr` is only for `economic_data`

Usage rules:
- the first attempt must pass the user's original question with spaces removed
  but meaning unchanged
- do not summarize, expand, reinterpret, or add filters on the first attempt
- only rewrite after a failed first attempt, and keep the rewritten question
  faithful to the original intent
- keep each `question` to one clear retrieval action
- for complex analysis, split into multiple simple retrieval calls, then
  synthesize
- if a workflow requires first discovering a universe and then querying each
  member, do it step by step; if the universe cannot be obtained reliably,
  stop and explain the limitation

```bash
node scripts/cli.mjs call analytics_data get_financial_data '{"question":"查询螺纹钢主力合约最近一周的日收盘价和涨跌幅"}'
```

---

## 4. Pre-call Validation (Mandatory)

Before every call, validate each field against the matching tool definition in
section 3:
- field names
- required fields
- types
- date format
- enum values

If any field is wrong, fix it or ask the user to clarify before calling. Do not
knowingly use an invalid schema and "see what happens."

For the four snapshot tools, also do special `indexes` validation:
- open `references/indicators.md` before the call
- split `indexes` by English comma
- verify every field name exactly against the reference table
- this exact match includes parentheses, full-width characters, and numeric
  suffixes
- if any field is missing from the reference, do not call the snapshot tool
- instead, switch to the corresponding NL tool or explain that the snapshot
  field is unavailable

For natural-language fields such as `question`, `query`, and `metricIdsStr`,
do not include spaces. Replace spaces with punctuation or remove them.

---

## 5. Hard Rules

| Rule | Why it matters |
| --- | --- |
| Do not fall back to Web Search for this workflow | Stay on the compliant Wind path: fix parameters, switch tool, switch server, split the query, or upgrade the skill instead |
| Run commands from this skill directory | `cli.mjs` depends on relative resource paths |
| K-line always requires both `begin_date` and `end_date` | the schema enforces both |
| Quote tools use `begin` / `end`, not `begin_date` / `end_date` | wrong field names fail parsing |
| K-line and EDB dates use `yyyyMMdd` | other formats fail validation |
| Snapshot `indexes` accepts Chinese field names only, copied from `references/indicators.md` | invented or English field names fail |
| `aftype` only accepts `"0"` or `"1"` | other values fail |
| A-shares must use `stock_data`; Hong Kong and US names must use `global_stock_data` | mixing them often fails |
| `server_type + tool_name` must exist in `references/tool-manifest.json` | the CLI rejects unknown pairs before backend execution |
| One call supports one target only | comma-separated symbols silently ignore later entries |
| Codex network access to Wind must use `require_escalated` | otherwise the sandbox can fail to fetch |
| The final answer must state `Data source: Wind financial data service` | compliance requirement |
| If the user does not specify an industry-classification system, default to Wind industry classification | it matches the backend semantics |

---

## 6. Practical Tips

These are helpers, not replacements for section-4 validation.

| Scenario | Preferred approach |
| --- | --- |
| Latest single-point values with known field names | use the snapshot tools with validated Chinese `indexes` |
| Historical price series | use K-line or minute tools |
| Fundamentals, profiles, holdings, events, risk, or technical analysis | use the matching NL tool |
| Multi-symbol comparison | one tool call per symbol, then compare in the agent |
| Cross-market comparison such as Apple vs Tencent | run separate `global_stock_data` calls |
| Index market data vs index fundamentals | quotes and K-line through index market-data tools; PE/PB historical percentile through `get_index_fundamentals` |
| Bond "snapshot" style questions | use `get_bond_market_data` with a natural-language description of the needed fields |
| `question` / `query` writing | no spaces; use punctuation or direct concatenation |

---

## 7. Error Handling

When `cli.mjs` fails (`exit code != 0`), stdout returns:

```json
{ "ok": false, "error": { "code": "...", "agent_action": "..." } }
```

Parse stdout only for business failure. Do not use stderr to decide whether the
main call succeeded.

### Mandatory handling policy

Default behavior:
- follow the instruction in `error.agent_action`

Routing by `error.code`:

| `code` | Required strategy |
| --- | --- |
| `KEY_MISSING`, `KEY_INVALID`, `KEY_FORBIDDEN_SERVER` | fix the key or permissions; do not bypass by switching tool or server |
| `RATE_LIMIT_DAILY`, `BALANCE_INSUFFICIENT` | wait for quota reset or switch to a valid key; do not route around the limit |
| `RATE_LIMIT_QPS`, `NETWORK_ERROR`, `SERVER_5XX` | wait 3 to 5 seconds and retry the same request once |
| `INVALID_PARAMS_JSON` | fix JSON or shell escaping only; retry the same `server_type + tool_name` |
| `UNKNOWN_TOOL_NAME`, `UNKNOWN_SERVER_TYPE` | check `references/tool-manifest.json` and choose a valid tool; do not immediately jump to `analytics_data` |
| `PARAM_VALIDATION_ERROR` | fix fields using section 3 and `references/indicators.md`; only if repeated fixes fail and the task is still structured retrieval may you fall back to `analytics_data` |
| `NO_RESULTS` | retry with a better query; if the specialized tool still cannot cover it, `analytics_data` may be allowed |
| `RESPONSE_PARSE_ERROR`, `MCP_PROTOCOL_ERROR`, `TOOL_RUNTIME_ERROR`, `UNKNOWN` | preserve the original message, fix obvious local issues if possible, retry once, then stop and report clearly |

Hard no-cross-boundary fallback rule:
- key, permission, rate-limit, balance, network, and 5xx failures must not be
  bypassed by switching server, switching to `analytics_data`, switching to
  `wind-alice`, or using Web Search

`analytics_data` fallback is allowed only for:
- parameter or validation mismatch
- data-coverage mismatch
- no-results situations

When using that fallback:
- simplify the question
- keep the user's original intent intact
- do not add new filters or assumptions

### Final fallback: `wind-alice`

Only after all `wind-mcp-skill` routes, including allowed `analytics_data`
fallback, have failed due to coverage or field mismatches, you may recommend
the `wind-alice` skill through `AskUserQuestion`.

Do not recommend `wind-alice` for:
- missing or invalid key
- permission failure
- rate limits
- balance exhaustion
- network failure
- backend 5xx
- `INVALID_PARAMS_JSON`
- unknown server or tool names

Those root causes must be fixed directly first.

Mandatory guidance:

1. Recommend `wind-alice` only after the specialized routes are exhausted.
2. Check whether `wind-alice` is actually installed in the current
   environment. The presence of source code in the repo is not enough.
3. If installed, ask the user whether to switch. Do not auto-switch.
4. If not installed, tell the user installation is required first and provide:

```bash
# GitHub
npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-alice -g -y

# Gitee mirror
npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-alice -g -y
```

5. If the user refuses, stop fallback and summarize the attempted routes and
   error codes.

Common issue guide:

| Problem | Fix |
| --- | --- |
| `indexes` field not recognized | copy exact field names from `references/indicators.md`; otherwise switch to the corresponding NL tool |
| unknown tool, unknown server, or schema mismatch | inspect `references/tool-manifest.json` or `error.context.available_tools`, then retry with a valid pair |
| empty or failed result when using `stock_data` for Hong Kong or US equities | switch to the same-named tool under `global_stock_data` |
| command appears to do nothing | confirm you ran it from this skill directory |

---

## 8. Staying Current

All update-check signals go through stderr only. The stdout failure envelope
never includes upgrade notices. There are two independent stderr sentinels.

### 8.1 stderr `检测到新版可用`

When the main call succeeds but the local version is behind the remote one,
stderr may show:

```text
[wind-skills] 检测到新版可用:
  wind-mcp-skill: 439c482 → 586226e
  升级命令: npx skills update wind-mcp-skill -g -y
```

Do not rewrite the upgrade command. Pass it through exactly as emitted.

The command shape depends on the lock source:
- global install (`~/.agents/.skill-lock.json` or
  `$XDG_STATE_HOME/skills/.skill-lock.json`) -> includes `-g`
- project install (`<project>/skills-lock.json`) -> no `-g`
- Gitee source -> may switch to `npx skills add <gitee-url> --skill <name> [-g] -y`

### 8.2 stderr `更新检测失败`

If the background update probe fails due to network, rate limit, missing lock,
timeout, or similar issues, stderr may show:

```text
[wind-skills] 更新检测失败 (reason=network), 不影响本次调用。
```

Possible reasons include `network`, `rate_limit`, `lock_missing`,
`no_source_url`, or `timeout`.

### 8.3 Unified handling rules for both stderr notices

1. Briefly relay the notice once if it appears.
   - upgrade available -> pass through the emitted upgrade command
   - update check failed -> tell the user the background update check failed but
     the current call is still valid
2. These notices never determine call success or failure.
3. Do not deduplicate manually. The script already handles one-time emission.
4. Stdout never carries these notices. Only stderr can.

If a version-related problem looks like `tool not found` or `field mismatch`,
re-check section 3 and `references/tool-manifest.json` first. Only if the
problem still persists should you recommend a skill upgrade, using the exact
`升级命令:` line emitted on stderr.
