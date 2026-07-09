---
description: Desktop single-stock or fixed-stock analysis workflow for A-shares, HK stocks, and US stocks
when_to_use: Use when the user asks about a specified stock quote, technical analysis, K-line review, financial data, fixed-stock comparison, or wants a dashboard / technical panel / board view in FinAgent Workstation. For stock ideas, shortlist generation, breakout candidates, broad selection, or market-wide discovery, use stock-picking instead.
---
# Stock Analysis (FinAgent Workstation)

If the user asks for stock ideas, broad selection, breakout candidates, or a
shortlist rather than analysis of specified stock code(s), load and follow the
`stock-picking` skill. Do not use this single-stock workflow to inspect every
candidate one by one.

## Tool priority

1. Use local reusable data first.
2. Use Wind for professional data only after local readbacks show a concrete
   missing/stale evidence gap and after loading `Skill(skill: "wind-aifinmarket")`.
3. Use desktop `MarketData`, `DataStore`, and TradingView-related skills with their actual supported parameter shapes.

## Reusable data first

Check what already exists before fetching again:

```text
DataStore(action: "reusable_summary")
DataStore(action: "coverage", symbols: ["600519"])
DataStore(action: "query_quote", code: "600519")
DataStore(action: "query_kline", code: "600519", limit: 120)
DataStore(action: "query_fundamental", code: "600519", limit: 8)
DataStore(action: "query_macro_factors", target: "<identified sector, commodity, country, rate, or theme>", limit: 10)
DataStore(action: "query_macro_attribution", target: "<identified sector, commodity, country, rate, or theme>", limit: 10)
```

For A-share real-time quote, use:

```text
MarketData(action: "quote", code: "600519")
```

Do not use mobile-style `symbols` arguments on desktop `MarketData` quote paths.

## Source guidance

### Wind
Use first for:
- professional quote / kline
- fundamentals
- filings / macro / high-confidence financial facts

For normal single-stock dashboard workflows, do not start with Wind. First use
local `DataStore` readbacks and `MarketData` quote/K-line paths. If valuation,
fundamental, or professional facts are still missing and the call budget allows,
load `Skill(skill: "wind-aifinmarket")` and use only the documented `WindMcp`
call shapes from that skill. Do not invent Wind tool names or parameter names.
In particular, `get_stock_fundamentals` requires a natural-language `question`,
while price indicators require `windcode` plus documented `indexes`.

### MarketData / DataStore
Use for:
- A-share quote / kline / flow / sector / hot rank / northbound
- local reusable query paths
- batch data preparation and persistence-aware fetches

### TradingView Scanner
Use for:
- live technical indicators
- ratings
- quick multi-symbol technical snapshots

### TradingView visualization
Before building TradingView-specific dashboards or live quote cards, load:

```text
Skill(skill: "tradingview")
```

TradingView is for live display. Scoring, sorting, persistence, alerts, and
reusable data should still come from `MarketData`, `DataStore`, Wind, or
code-owned analytics. If the user only asks for an analysis dashboard or report
dashboard, use the app `Dashboard(template:"report")` path first and do not load
TradingView unless a TradingView chart/widget is explicitly needed.

## Analysis workflow

For broad stock-picking or breakout shortlist intents, follow the
`stock-picking` skill and keep the workflow bounded. Do not apply the deep
single-stock workflow to every candidate. If money-flow, company-info,
fundamental, or valuation evidence is not already available for the shortlist,
state it as a coverage gap in the answer instead of calling per-stock readbacks
for each candidate.

### Single-stock analysis
1. local reusable checks first
1. when the stock has clear exposure to rates, liquidity, currency, commodity,
   policy, country/index, or sector-level macro pressure, call
   `DataStore(action:"query_macro_factors", ...)` with structured target,
   assets, regions, sectors, or family filters and cite returned provenance.
   For root-cause, attribution, or judgment-risk analysis, follow with
   `DataStore(action:"query_macro_attribution", ...)` using the same filters
   and use its confidence, missing evidence, contradictions, and invalidation
   conditions as the macro attribution contract
2. fetch missing quote / kline / fundamental / money-flow data when the user
   asked for deep analysis and the readback result explicitly says reusable
   rows are missing
3. use `DataProcess(summary/signals/support_summary/score_technical)` for synthesis
4. use TradingView Scanner when you need live technical overlays
5. answer normal analysis requests in Markdown/text, not fenced or inline HTML.
   If the user asks for a rendered card, dashboard, panel, or page, create/open
   it through the Dashboard/UIControl/WebView path and then summarize the
   rendered result in chat.

For a commodity-exposure stock question such as copper, oil, gold, coal, or
lithium:

1. Choose or ask for a stock first, then keep stock-specific evidence on that
   stock: `query_quote`, `query_kline`, and one stock `DataProcess` synthesis if
   local K-line is available.
2. Add one macro/factor readback for the commodity or sector exposure:
   `DataStore(action:"query_macro_factors", target:"Copper", limit:10)` or the
   equivalent structured target. If the user asks what drives the stock or how
   macro changes affect the judgment, also read
   `DataStore(action:"query_macro_attribution", ...)` for that exposure.
3. Do not call A-share quote/K-line/DataProcess actions for global futures, FX,
   or commodity symbols such as `HG=F`, `DXY=F`, `CL=F`, `GC=F`, or `BTC-USD`.
   Those are context symbols, not the stock being analyzed.
4. If a supported global price/history path is unavailable or unnecessary,
   state the commodity-price evidence gap instead of retrying through A-share
   provider formats, broad search, or `Script`.
5. Answer whether macro context or K-line evidence is more important as a
   conditional judgment. Do not convert commodity macro context into a direct
   buy/sell instruction.

When `DataProcess(action:"summary")`, `DataProcess(action:"support_summary")`,
or `DataProcess(action:"volume")` returns `analysisEvidence`, use that
`analysis-evidence-v1` object as the stock-analysis contract. Report
`observedFacts`, `interpretations`, `missingEvidence`, `confidence`, and
`sourceCoverage`. Do not treat `strategyReadiness:"analysis_only"` as a
validated StrategySpec, backtest, monitor, watchlist rule, or trade plan.

Keep macro/factor evidence in its own section. It can explain possible outside
pressure or confirmation, but it is not a direct buy/sell signal and should not
override missing stock-specific evidence.

When a bounded stock-candidate workflow returns
`analysisEvidence.kind:"candidate_research"` with
`strategyReadiness:"candidate"`, treat it as an observation shortlist only.
Use the listed candidates, missing evidence, and source coverage directly; do
not present it as a buy recommendation, validated StrategySpec, monitor rule,
watchlist mutation, or trade action until the user selects a candidate and a
separate contract validates the next step.

For strategy-selection, strategy-candidate scoring, or “which watchlist symbol
fits this strategy” intents, use the `strategy-system` skill and the governed
`MarketData(custom_strategy_rank)` / backtest actions instead of
`DataProcess(score_technical)`. `score_technical` is a single-stock diagnostic,
not the evidence source for strategy ranking or portfolio drafts.

For a normal "analyze this stock and create a dashboard" request, keep the
first pass bounded:

```text
DataStore(action: "query_quote", code: "600519")
DataStore(action: "query_kline", code: "600519", limit: 120)
DataStore(action: "query_fundamental", code: "600519", limit: 8)
DataStore(action: "query_money_flow", code: "600519", limit: 20)
DataProcess(action: "summary", code: "600519", limit: 120)
Dashboard(template: "report", id: "...", title: "...", config: "{...}")
WebView(action: "get_info", id: "...")
```

This normal stock-analysis dashboard route is closed after the app dashboard
tool reports an observed panel/render and the chat answer summarizes the
evidence. Do not switch to `Skill(skill:"dashboard")`, `Skill(skill:"html-artifact")`,
`Skill(skill:"tradingview")`, `Write`, `Edit`, or custom
`memory/pages/*.html` generation for this route unless the user explicitly asks
for custom HTML, a TradingView widget, or a hand-built page. Do not keep
iterating visual polish after the dashboard is already inspectable; state the
dashboard path/panel, data source time, fetched time, cache/provider status, and
any missing evidence boundary in the final answer.

Use `query_stock_daily_valuation`, `northbound`, sector constituents, Wind, or
TradingView only when the current answer needs that specific evidence and the
bounded local pass did not already satisfy the user request. Do not repeat
quote/coverage/readback calls after equivalent local evidence has already
returned in the same turn.

For support/resistance intents, keep the first pass daily and local-first:

```text
DataStore(action: "query_kline", code: "600519", period: "daily", limit: 240)
DataProcess(action: "support_summary", code: "600519", period: "daily", limit: 120)
DataStore(action: "query_quote", code: "600519")
```

If local daily K-line rows are usable, answer from those rows and do not trigger
`DataStore(action:"fetch", type:"kline")`, non-daily periods, or broad market
discovery unless the user asks for more detail or the local readback is empty.

For parameter optimization requests, keep the route short and explicit:

```text
DataStore(action: "coverage", symbols: "600519")
DataStore(action: "query_kline", code: "600519", period: "daily", start: "2021-06-28", end: "2026-06-28", limit: 1300)
MarketData(action: "optimize_params", code: "600519", strategy: "rsi", period: "5y", paramGrid: {"period":[10,14,20], "oversold":[25,30,35], "overbought":[65,70,75]})
```

If the local K-line readback already covers the requested window, do not spend
extra `DataStore(action:"fetch", type:"kline")` calls before optimization.
Report both requested window and actual data window in the final answer.

For deep single-stock analysis, do not equate an empty local readback with
provider unavailability. If `query_fundamental` or `query_money_flow` returns
no rows and the user asked for fundamentals or flow evidence, spend a bounded
fetch call when the call budget allows:

```text
DataStore(action: "fetch", type: "fundamental", code: "000858")
DataStore(action: "fetch", type: "money_flow", code: "000858")
```

When the local row exists but a required field is stale or missing, use the
same governed fetch with `forceLive: true`, then read it back:

```text
DataStore(action: "fetch", type: "fundamental", code: "000858", forceLive: true)
DataStore(action: "query_fundamental", code: "000858")
```

Only say the evidence is missing after the fetch/readback path is attempted or
after explicitly stating that the call budget prevented live fetch.

For valuation evidence, distinguish available metrics from missing metrics in
the final answer:

- If PE/PB are present, show them with source and data/retrieval time when the
  tool result provides it.
- If PE/PB are absent or shown as `-`, explicitly state a valuation-data gap:
  name the missing fields, the interface/readback where the gap appeared, and
  avoid presenting a precise valuation range from unavailable PE/PB data.
  Use this exact sentence when the basic-fundamental interface shows PE/PB as
  missing: `估值数据缺失：基本面接口中 PE、PB 字段显示为 “-”，本次未获取到有效估值指标。`
  If the gap is from a local readback, also state:
  `本地基本面读回中 PE、PB 字段为空，无法给出精确估值区间。`
  Do not replace that sentence with weaker wording.
- Do not replace a missing PE/PB fact with a generic "basic fundamentals
  missing" statement when revenue, profit, ROE, or other fundamental rows exist.
- In stock dashboards and dashboard refresh summaries, always state the
  valuation status explicitly: either report PE/PB with source/time, or state
  the PE/PB gap with source/time and consequence.

### Sector / board analysis
1. get sector or hot-rank candidates
2. validate leaders with real desktop actions
3. summarize technical / money-flow / fundamental signals

### Market-wide money-flow routing

When the intent is market-wide capital flow rather than analysis of one
specified stock, use the `market-overview` skill. Prefer a compact
local-readback pass:

```text
DataStore(action: "query_flow_rank", limit: 20)
DataStore(action: "query_sector_ranking", type: "industry", limit: 20)
DataStore(action: "query_northbound_flow", limit: 10)
```

Stop after those local readbacks and answer with source/provider, as-of time,
fetched-at time when present, and coverage gaps. Do not add hot rank, limit
pool, market screening, dragon tiger, or per-stock `query_money_flow` unless the
user asks for deeper follow-up or the core readbacks are empty.

### Market-wide unusual-activity routing

When the intent is market-wide unusual-activity discovery rather than analysis
of one specified stock, use the `market-overview` skill. Prefer a compact
local-readback pass:

```text
DataStore(action: "query_unusual", limit: 20)
DataStore(action: "query_limit_pool", limit: 30)
DataStore(action: "query_hot_rank", limit: 20)
```

Use `DataStore(action: "query_flow_rank", limit: 20)` only as one additional
corroborating list. Do not call `DataStore(action: "query_quote")` without
explicit codes. Stop after the above readbacks and answer with source/provider,
as-of time, fetched-at time when present, and coverage gaps.

## Dashboard workflow

Use the app-level `Dashboard` tool for normal stock analysis dashboards. Do not
use `Write`, `FileWrite`, or custom HTML for a normal "analysis dashboard" or
"report dashboard" request. Custom HTML under `{{DATA_DIR}}/memory/pages/` is
reserved for explicit custom-page requests that cannot be represented by a
Dashboard template.

| Template | Best for |
|---|---|
| chart | K-line, MA, MACD, technical charts |
| table | watchlists, ranking views |
| kpi | overview cards |
| monitor | alert and threshold panels |

### Dashboard creation flow
1. Prefer `Dashboard(template: ...)` for common KPI/chart/table/report layouts.
   For stock research reports, use `Dashboard(template: "report")` first.
   Use custom HTML only when the user explicitly asks for a custom page or when
   a required interactive view cannot be represented by the template.
2. For `Dashboard(template: ...)`, pass `template`, `id`, `title`, and a compact
   JSON `config` directly to the Dashboard tool. Do not use `Read`, `Glob`,
   `Grep`, `Bash`, or source-path inspection to locate template files such as
   `bundle/dashboards/report/template.html` or `finagent_workstation/dashboards/report.html`.
3. After a successful `Dashboard(template: ...)` call, do not use `Read` to
   inspect the generated dashboard HTML. Verify rendering with
   `WebView(action:"get_info")` or one `WebView(action:"screenshot")`, then
   summarize the visible result in chat, including the explicit PE/PB valuation
   status when valuation evidence is part of the dashboard.
4. Never use `Write`/`FileWrite` as a shortcut for normal dashboard creation.
   If template mode cannot satisfy the user request, explain the limitation or
   ask before switching to custom HTML.
5. For custom HTML only, save under `{{DATA_DIR}}/memory/pages/` and open with
   `UIControl openPage`.
6. if the file changes later, use `WebView(action:"refresh")`
7. for runtime data patches, prefer `UIControl(action:"pushData")` plus `Bridge.onPush(...)`

### Dashboard fetch example
```js
const quote = await Bridge.fetch('/api/finance/quote', { code: '600519' }, 'GET')
const indexQuotes = await Bridge.fetch('/api/finance/index/quotes', {}, 'GET')
const technical = await Bridge.fetch('/api/finance/technical', { code: '600519', limit: 120 }, 'GET')
```

Supported normal dashboard Bridge routes include `/api/finance/quote`,
`/api/finance/index/quotes`, `/api/finance/kline`, `/api/finance/technical`,
`/api/finance/news`, and the explicitly documented fund routes. Do not invent
routes in generated pages.

Keep first-pass stock dashboards compact. A normal dashboard should fit in one
screen plus one scroll, and custom HTML should usually stay under about 12k
characters. Avoid giant inline CSS/JS pages when a Dashboard template or a small
page with Bridge fallback is enough.

## Presentation rules

- Do not put raw `<div>`, `<table>`, or fenced ```html blocks in a normal chat
  answer. Chat Markdown is not the rendering surface for app dashboards.
- Rendered HTML belongs in `{{DATA_DIR}}/memory/pages/` and must be opened via
  `UIControl openPage` or the supported Dashboard/WebView flow.
- default dark theme: `#131722`
- China market color convention: up `#ef5350`, down `#26a69a`
- write pages into `{{DATA_DIR}}/memory/pages/`
- A-share codes are 6 digits, for example `000001`, `600519`
- HK stock codes are 5 digits, for example `00700`
