---
description: Fund NAV, ranking, holdings analysis, and dashboard workflows
when_to_use: Use when the user asks about fund NAV, ranking, holdings, performance comparison, or wants a fund dashboard / NAV comparison / holdings view
---
# Fund Analysis Skill

## Data Sources

Use the app-level data interfaces first. They check reusable local rows, route
through registered provider capabilities, persist only known schemas, and return
source/provenance metadata.

```json
DataStore(action: "query_fund_list", limit: 50)
DataStore(action: "query_fund_performance", limit: 50)
DataStore(action: "query_fund_nav", code: "110011", limit: 60)
DataStore(action: "query_fund_money_yield", code: "000009", limit: 60)
DataStore(action: "query_macro_factors", assets: "bond funds", family: "rates_liquidity", limit: 10)
DataStore(action: "query_macro_attribution", assets: "bond funds", family: "rates_liquidity", limit: 10)
DataStore(action: "fetch", type: "fund_list")
DataStore(action: "fetch", type: "fund_performance")
DataStore(action: "fetch", type: "fund_nav", code: "110011")
DataStore(action: "fetch", type: "fund_money_yield", code: "000009")
```

Provider-specific endpoints such as `fund_open_fund_rank_em` and
`fund_open_fund_info_em` are adapter details behind `fund.identity_list` and
`fund.performance_metrics` / `fund.nav_history` /
`fund.money_yield_history`. Use raw sidecar/provider
endpoints only for explicit API diagnostics or provider validation, not for
normal fund analysis.

For ordinary fund selection, comparison,定投观察, or watchlist creation, the
bounded path is local `DataStore` readback plus targeted EastMoney/AkShare
backfill when coverage is missing. Do not call `WindMcp` merely to enrich this
workflow. Use Wind only when the user explicitly asks for Wind/professional fund
data or when local governed fund evidence is insufficient and the Wind request
can be made with a valid Wind code such as `001480.OF`. If Wind returns a
parameter, quote, credential, quota, or application error, stop Wind for the
turn, keep the error visible, and continue only from local/governed fund
evidence.

The Fund Pulse panel and Data Manager feed workflow use the same governed data
chain. Manual Fund Pulse refresh queues `fund_list`, `etf_quotes`,
`fund_performance`, and stale ordinary `fund_nav` seeds; money funds should use
`fund_money_yield` rather than ordinary NAV. Manual Data Manager runs and
scheduled Data Feed runs share the same configured-feed enqueue path, so
ordinary NAV versus money-yield splitting, prerequisites, feed-run IDs, and
provenance params should match. Treat the panel cache summary as provenance: it
should show whether fund list, performance, NAV, ETF list, and ETF quote rows
exist locally before spending another provider call. If a feed fails, inspect
`fetch_status`, `data_health`, and API Health before retrying; failed fetch
tasks are evidence for provider/category/runtime fixes, not reusable fund data.

## Analysis Workflow

Fund Pulse and fund readback workflows are analysis surfaces. When the prompt
or tool output refers to `analysis-evidence-v1`, preserve that boundary:
report observed facts, interpretation, missing evidence, confidence, and source
coverage. Do not present fund analysis as a validated strategy, monitor rule,
定投 rule, or trade plan until a StrategySpec/watchlist/monitor contract is
created separately.

For fund categories exposed to rates, liquidity, currency, country, commodity,
sector, or index/passive-flow effects, read the governed macro factor layer
with `DataStore(action:"query_macro_factors", ...)`. Keep that evidence in a
separate macro-context section with source time and fetched time. It should not
be presented as a direct subscribe/redeem signal.
For fund root-cause, fund-observation, rates/liquidity attribution, or strategy
assumption discussion, follow the factor readback with
`DataStore(action:"query_macro_attribution", ...)` using the same structured
filters. Use its confidence, missing evidence, contradictions, invalidation
condition, and next update action as fund context, not as an automatic
subscribe/redeem trigger.
When the prompt asks how rates or liquidity changes affect fund observation,
also read macro source/evidence rows before the final answer:
`DataStore(action:"macro_research_sources", category:"rates_liquidity", priority:1, limit:5)`
and
`DataStore(action:"query_macro_research_evidence", family:"rates_liquidity", limit:5)`.
Use numeric-series readback only for specific current values; do not loop
through rate series when the user only asks for observation conditions.

When a bounded fund-candidate workflow returns
`analysisEvidence.kind:"candidate_research"` with
`strategyReadiness:"candidate"`, treat it as an observation shortlist only.
Use the listed funds, missing evidence, and source coverage directly; do not
present it as a buy/定投 recommendation, validated StrategySpec, monitor rule,
watchlist mutation, or trade action until the user selects a fund and a
separate contract validates the next step.

### Fund screening
1. Check `query_fund_list` first.
2. Check `query_fund_performance` for reusable YTD / 1Y / 3Y performance.
3. If rows are missing/stale, backfill with `DataStore(action: "fetch", type: "fund_list")` or `DataStore(action: "fetch", type: "fund_performance")`, or use the Data Manager/Fund Pulse refresh path when the user wants panel data prepared.
4. Sort by 1-year / 3-year return.
5. Filter for scale > 100M and age > 3 years.

### Fund comparison
1. Resolve requested fund codes with `query_fund_list`.
   If the user asks to compare one equity/ordinary fund with one money fund
   but gives no exact codes, do not stop with a clarification-only answer.
   Start with `query_fund_list`; choose one representative ordinary/equity-like
   local fund and one representative money fund from the returned rows. If the
   local list is too sparse, use the bounded built-in samples only after
   identity readback: ordinary fund `000001` and money fund `000009`. State that
   they are representative evidence examples, not user-selected holdings.
2. Read `query_fund_performance` for the requested code list, then read
   `query_fund_nav` for each ordinary open fund.
3. For money funds, use `query_fund_money_yield`; they expose per-10k income
   and seven-day annualized yield, not ordinary NAV trend.
4. Use `query_fund_holding` with `code` / `fundCode` for each fund when
   holdings are needed. `stockCode` means a constituent stock filter.
5. Backfill only evidence that is actually missing or stale. If local NAV or
   performance rows already provide source time and fetched time for the
   requested funds, do not refetch them just to confirm the same data.
6. Once the requested funds have enough local evidence to compare category,
   NAV trend, performance, and available holdings, answer directly and state
   the missing coverage instead of spending more calls on optional data.
7. Normalize and plot NAV curves only when the user asks for a chart or
   dashboard; otherwise summarize annualized return, max drawdown, style, risk,
   source time, fetched time, and coverage limits in text.
8. For fund watchlist writes or 定投观察 setup, keep the evidence bounded to
   fund identity, performance, and NAV or money-yield history unless the user
   asks for holdings, manager research, or an ETF/listed-fund workflow. Do not
   call `query_fund_holding`, `query_fund_manager`, `MarketData(action:"etf")`,
   or broad provider refreshes just to choose one fund and write an observation
   condition.
9. Use `Watchlist(add)` only after selecting the fund from bounded fund
   evidence. Always pass the selected fund's real `name` from `query_fund_list`;
   use `tag` / `tags` only for labels such as 定投观察. Then verify the same
   symbol/id with `Watchlist(list)` before claiming the write succeeded.
10. For fund watchlist signal checks, do not run `Script` and do not interpret
    free-text `entryCondition` yourself. Use:
    `Watchlist(action:"list", type:"fund", status:"watching")`, then
    `DataProcess(action:"watch_signal_check", type:"fund", status:"watching")`.
    Answer from the returned JSON `results`: `triggered`, `status`, `checks`,
    `unsupportedRules`, and `provenance`.
    Do not call `DataProcess(action:"signals"|"score_technical"|"summary"|
    "support"|"indicators"|"ai_record")` for fund or ETF codes; those are
    stock/K-line technical analysis or stock prediction-log actions and should
    return a tool error for known fund codes.
    If the user only asked to check fund observation signals, stop at signal
    status and missing evidence. Do not offer `Portfolio` paper-trade or
    `XueqiuTrade` execution as the immediate next step unless the user
    explicitly asks to prepare or execute a trade.

### ETF / listed-fund rotation
1. Treat ETF/listed-fund rotation as a listed-market workflow, not an ordinary
   open-end fund workflow. Listed quote/K-line evidence is the execution and
   ranking basis when those are the only rows retrieved.
2. Before giving a concrete rotation design, make one bounded evidence read for
   listed ETF prices or K-line rows. Prefer the governed ETF/listed-price path
   such as `MarketData(action: "etf")`, `MarketData(action: "quote")` for a
   small ETF basket, or local `DataStore(query_quote/query_kline)` when rows are
   already available. Do not answer as if ETF evidence was observed when the
   only tool used was `Skill`.
3. Always disclose pricing-basis status in the final answer:
   - observed: listed market price / quote / K-line when `MarketData(quote)`,
     `DataStore(query_quote)`, ETF quote rows, or ETF K-line rows were used;
   - missing or not retrieved: NAV / IOPV when no fund NAV, ETF NAV, IOPV, or
     Wind ETF price-indicator row was read;
   - missing or not retrieved: underlying index evidence when no index quote or
     index K-line row was read.
4. Use NAV / IOPV for premium-discount checks and use underlying index data for
   tracking-error or trend-confirmation checks. Do not present those checks as
   verified unless the supporting rows were actually retrieved.
5. For a design-only answer, one bounded listed-price read is acceptable, but
   the answer must label what was observed and what still needs NAV/IOPV or
   index confirmation before execution.
6. Do not trigger subscription, redemption, simulated trade, or Xueqiu actions
   unless the user explicitly asks for trade preparation and confirms the side
   effect.

For a text fund comparison, the normal bounded path is Skill plus local
DataStore readbacks. Tool results are already in the conversation context; do
not inspect `memory/.tool_outputs` or use `LS`, `Read`, `Grep`, `Glob`, `Bash`,
`Script`, raw provider diagnostics, stock/K-line tools, or broad extra fetches
to recompute metrics unless the user explicitly asks for a generated artifact
or local fund readbacks are insufficient. If NAV history is already returned
with daily returns, use the returned summary fields or estimate return/drawdown
from the visible rows; otherwise state that exact deeper statistics were not
computed.

## Dashboard Creation

Use the app-level `Dashboard` tool for generated fund dashboards. Do not read
bundled template files, write dashboard HTML manually, or open panels with
`UIControl` unless the user explicitly asks for custom HTML. Template mode and
custom HTML mode are separate: when using `template: "report"`, pass structured
JSON in `config` and do not pass `html`.

For a fund comparison dashboard:

```json
Dashboard(
  template: "report",
  id: "fund-compare-000009-000001",
  title: "基金对比看板",
  config: "{\"title\":\"基金对比看板\",\"funds\":[...],\"comparisonTable\":{\"headers\":[...],\"rows\":[...]},\"dataNote\":\"...\",\"riskWarning\":\"...\"}"
)
```

For money funds such as `000009`, use `query_fund_money_yield` and label the
metric as per-10k income / 7-day annualized yield. Do not fetch or retry
ordinary `fund_nav` after the fund identity shows it is a money fund.

After `Dashboard` succeeds, verify once with
`WebView(action: "get_info", id: "fund-compare-000009-000001")` or the
observed `dash-...` panel id. If live renderer verification times out but the
tool returns `fallback:"static-dashboard-file"`, disclose that the dashboard
artifact exists and live DOM evidence should be retried later if visual proof is
required.

When continuing or refreshing an existing report dashboard, reuse the same
dashboard `id` with `Dashboard(template: "report", config: "...")`, then verify
with WebView. Do not recommend `UIControl.pushData` for report-template
refreshes; it is for runtime-only panel updates, not the normal persisted
dashboard artifact path.

### Dashboard types
- **NAV comparison**: chart template with multiple line series, normalized to 1.0
- **Holdings analysis**: chart template + ECharts pie/sunburst (sector -> stock)
- **Manager scorecard**: KPI template (Sharpe, drawdown, ranking, scale, tenure)

### Dashboard data rule

Dashboards should consume prepared local data or `/api/finance/...` bridge
routes. Do not embed public provider URLs in dashboard HTML.

## Notes
- Fund codes are 6 digits, for example `110011`
- ETF codes are 6 digits, for example `510300`
- Use dark theme `#131722` for consistency
