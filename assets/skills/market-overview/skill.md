---
description: Market overview workflow for major indices, sector heatmaps, capital-flow questions, unusual-stock questions, technical sentiment, and global market snapshots in FinAgent Workstation.
when_to_use: User asks for the overall market picture, index direction, sector strength, market breadth, broad market money flow, unusual-stock discovery, or a global market check in FinAgent Workstation.
---
# Market Overview

## Data sources

### FinAgent Workstation local finance routes
In WebView pages use `Bridge.fetch('/api/finance/...', params)`. In monitor/script contexts use `callService('/api/finance/...', params)`. Do not call public provider URLs directly from desktop workflows.

| Route | Purpose |
|---|---|
| `/api/finance/index/quotes` | Real-time major index quotes, TDX-first |
| `/api/finance/sector` with `{type:"industry"}` | Industry board list through the `market.sector_ranking` interface |
| `/api/finance/sector` with `{type:"concept"}` | Concept board list through the `market.sector_ranking` interface |
| `/api/finance/quote` with `{code:"600519,000858"}` | Real-time stock quotes through the local quote route |

For board constituents and industry classification, use the `market.sector_constituents` interface in FinAgent Workstation. The code-owned route resolves the `BK` board code and uses the board-code adapter; do not make dashboard scripts repeatedly call AkShare `stock_board_industry_cons_em` by board name.

For broad market capital-flow evidence, use `DataStore(action: "query_flow_rank")`
or `MarketData(action: "flow_rank", limit: 20)`. Do not call
`MarketData(action: "flow")` unless the user is asking about a specific stock
and a `code` such as `600519` is provided.

For index membership or rebalance context, use the `index.constituents`
interface: read persisted rows with `DataStore(action: "query_index_constituents",
indexCode: "000300")`, and backfill through `DataStore(action: "fetch",
type: "index_components", code: "000300")` only when local coverage is missing.
Do not call AkShare `index_stock_cons` directly from dashboards or reports.

### TradingView Scanner for technical sentiment
Use the dedicated `tradingview-scanner` skill for bulk technical ratings:
- Index sentiment from `Recommend.All` in the `-1` to `+1` range
- Market breadth from full-market RSI distribution
- Sector technical strength from board-level average `Recommend.All`

### Yahoo Finance for the global market snapshot
Use the Yahoo section of the `tradingview-scanner` skill:
- Global indices: `^GSPC`, `^DJI`, `^IXIC`, `^VIX`
- Crypto: `BTC-USD`, `ETH-USD`
- FX: `EURUSD=X`, `GBPUSD=X`
- ETFs: `SPY`, `QQQ`, `GLD`

### TradingView charts
TradingView widgets, heatmaps, ticker tape, scanners, and fallback rules are maintained in the separate `tradingview` skill. Load `Skill(skill: "tradingview")` before building a market-overview dashboard. Global symbols commonly used here are `SSE:000001`, `SZSE:399001`, `HSI:HSI`, `NASDAQ:IXIC`, and `SP:SPX`.

### Macro/factor context

For market regime, market-cause, cross-asset, commodity, rates, country, or
index/passive-flow questions, read the governed factor layer before concluding:

```text
DataStore(action: "query_macro_factors", target: "A-shares", limit: 10)
DataStore(action: "query_macro_factors", family: "rates_liquidity", limit: 10)
DataStore(action: "query_macro_factors", regions: "Indonesia", family: "index_classification", limit: 10)
DataStore(action: "query_macro_attribution", target: "A-shares", limit: 10)
```

Keep this evidence separate from index, sector, flow, and technical evidence.
Use the row source time, fetched time, affected assets, status, and
transmission channel. If the readback returns `status:"missing"`, state that
the current factor layer has no matching macro evidence instead of assuming no
macro driver exists.
For root-cause, market-cause, attribution, or "why did it move" analysis, read
`query_macro_attribution` after the factor readback with the same structured
filters. Use its category, evidence, confidence, missing evidence,
contradictions, invalidation condition, and next update action. Do not make a
macro root-cause claim from factor rows alone when the attribution readback is
available; if attribution rows are missing, state that as an evidence gap.
In a first-pass market overview, do not continue into
`macro_research_extract`, broad `Research`, `WebFetch`, or provider-page
browsing just because macro evidence is missing. Report the update action from
`query_macro_attribution` and ask for or wait for an explicit refresh/source
validation workflow before spending extraction/browser calls.

## Workflow

For every market overview answer that cites market, sector, flow, macro, or
news evidence, include a compact source coverage block. For each cited evidence
family, state provider/source, source data time (`sourceDataTime`, `timestamp`,
`asOf`, or provider date), fetched/retrieved time (`fetchedAt` or equivalent),
cache status when available, and missing evidence. Do not cite a data time
without the fetched/retrieved time when the tool result exposes both. Finish
the answer with a `来源覆盖` section containing one bullet per evidence family,
for example `指数：provider/source；数据时间 ...；获取时间 ...；cache ...` and
`宏观：status ...；缺失证据 ...`. When a tool result provides
`sourceCoverageBrief`, reuse that field for the corresponding bullet.

For market-wide money-flow intent, keep the first answer bounded:

1. Use `DataStore(action: "query_flow_rank", limit: 20)`.
2. Add at most one rotation check with `DataStore(action: "query_sector_ranking", type: "industry", limit: 20)`.
3. Add northbound context only if it is already local with `DataStore(action: "query_northbound_flow", limit: 10)`.
4. Do not expand into hot rank, limit pool, screening, dragon tiger, or per-stock
   `query_money_flow` unless the user asks for more detail or the first two
   readbacks are empty.
5. Answer immediately after these readbacks. State source/provider, as-of time,
   fetched-at time when present, and coverage gaps.

For market-wide unusual-activity discovery intent, keep the first answer bounded:

1. Use `DataStore(action: "query_unusual", limit: 20)`.
2. If that readback is empty, use `DataStore(action: "query_limit_pool", limit: 30)`.
3. Add at most one corroborating list with `DataStore(action: "query_hot_rank", limit: 20)` or `DataStore(action: "query_flow_rank", limit: 20)`.
4. Do not call broad `DataStore(action: "query_quote")`; quote readback requires
   explicit codes. Do not continue into market screening, dragon tiger, or live
   provider fetches after limit-pool / hot-rank / flow-rank evidence is enough
   for a bounded answer.
5. Answer immediately with the evidence found. If `query_unusual` is empty,
   say the dedicated unusual-activity table is empty and use limit-pool or
   hot-rank as proxy evidence rather than hiding the gap.

1. Use local finance routes or explicit-code readbacks for A-share index
   evidence. For DataStore, call `DataStore(action: "query_index_quote",
   code: "000001,399001,399006,000688,000300,000905")`; do not call
   `query_index_quote` or `query_quote` without `code`/`symbol`.
2. Use `DataStore(action: "query_sector_ranking")` or the code-owned sector
   route for board data. If the readback says rows look like non-sector
   instruments, treat sector evidence as unavailable instead of reusing those
   rows.
3. Use `query_flow_rank` / `flow_rank` for broad capital-flow ranking. Use
   single-stock `flow` only with an explicit stock code.
4. Use `DataStore(action:"query_macro_factors", ...)` when macro/rates/country/
   commodity/index/passive-flow context may explain the move. For root-cause
   analysis, follow it with `DataStore(action:"query_macro_attribution", ...)`
   using the same structured filters.
5. Do not call `macro_research_extract`, broad `Research`, `WebFetch`, or
   provider-page browsing in the first market overview pass unless the user
   explicitly asks to refresh or validate macro sources. Use the attribution
   readback's missing/update fields as the data-quality section.
6. Use Yahoo Finance for global-market context when needed.
7. Use TradingView Scanner for technical sentiment and breadth when needed.
8. Present the result with a dashboard or `showTable`.
