---
description: Desktop stock-picking workflow for candidate discovery, valuation/ROE screening, technical breakout selection, validation, ranking, and watchlist-ready output
when_to_use: Use when the user asks for stock ideas, shortlist generation, candidate ranking, low-valuation/high-ROE candidates, PE/PB/ROE screens, sector rotation opportunities, or a buy/watchlist recommendation set in FinAgent Workstation
---
# Stock Picking (FinAgent Workstation)

Use the desktop workflow with real currently supported tools.
Load `analysis-standards` before producing a shortlist. Its Finance Output Standard governs the final answer: separate facts, calculations, inferences, recommendations, assumptions, and unverified items, and retain source/as-of time, fetch/ingest time, fields used, method/tool action, quality/confidence note, and readback status.

## Core flow

1. candidate discovery
2. data validation
3. technical / money-flow / fundamental review
4. backtest or historical behavior check if relevant
5. output a shortlist and optionally add it to `Watchlist`

Do not use outdated examples such as `DataProcess(action:"screen", conditions: ...)` if desktop does not support that path.
For broad shortlist prompts, do not start with `DataProcess`; it is
code-specific technical analysis and requires known candidate code(s). Start
with `DataStore` discovery/readback actions, then use `DataProcess` only for
selected candidates when the user asks for technical validation.
If another loaded skill describes deep single-stock analysis, do not apply that
pattern to every shortlist candidate. Broad stock selection must remain bounded
and end with a shortlist answer.

When the user asks to make an observation dashboard, treat `Dashboard` as the
output surface and put candidate reasons, source time, retrieved time,
observation conditions, risks, and data gaps into the dashboard config.
Do not mutate `Watchlist` in the same turn unless the user explicitly asks to
add the candidates to a watchlist, observation pool, or self-selected list.

## Provenance gate

Before live discovery or validation, check the governed interface and local
readback state for the data family you plan to use. Normal stock-picking
workflow is:

```text
DataStore(action: "interfaces", category: "stock")
DataStore(action: "interface_describe", interfaceId: "market.hot_rank")
DataStore(action: "interface_availability", interfaceId: "market.hot_rank")
DataStore(action: "query_hot_rank", limit: 20)
DataStore(action: "query_quote", code: "600519")
DataStore(action: "query_kline", code: "600519", limit: 120)
DataStore(action: "data_health", section: "failures", limit: 5)
```

Use live `MarketData` / fetch actions only when the relevant interface is
missing, stale, or explicitly requested. If `data_health` or
`interface_availability` says a provider is gated, disabled, unsupported, or
temporarily blocked, do not route around it with a provider-direct example.

## Candidate discovery

Pick 1-3 sources based on the user’s question.

### Sector / hot flow discovery
Read local reusable rows first when available; then refresh through governed
actions only if the interface is stale or incomplete.

```text
DataStore(action: "query_sector_ranking", limit: 20)
DataStore(action: "query_hot_rank", limit: 20)
DataStore(action: "query_flow_rank", limit: 20)
DataStore(action: "query_index_quote", code: "000001")
DataStore(action: "query_quote", codes: "000725,300059,600584", limit: 3)
MarketData(action: "sector", type: "industry", limit: 20)
MarketData(action: "hot_rank", limit: 20)
MarketData(action: "flow_rank", limit: 20)
```

For broad market context, use `query_index_quote` with explicit index codes
such as `000001`, `399001`, `399006`, or `000300`. Do not call
`DataStore(action:"fetch", type:"index")` without a code; that path is invalid
and should be replaced with local index quote readback or an explicit
index-specific refresh.

If `query_sector_ranking` or `query_board_ranking` says cached rows look like
non-sector instruments, treat sector/board evidence as unavailable for the
answer. Do not reuse option, IPO, bond, or single-stock rows as sector
rotation evidence.

### Broad market coarse screen
```text
DataStore(
  action: "screen_stock",
  universe: {"exclude_st": true},
  limit: 20
)
```

For valuation/fundamental screens, do not probe `interface_availability` with
`stock.screen`; that is not a governed interface id. Use
`DataStore(action: "query_stock_daily_valuation", ...)` as the first local
governed readback. Common filter aliases are accepted, for example:

```text
DataStore(action: "query_stock_daily_valuation", params: {"pe_max": 20, "roe_min": 15}, limit: 50)
```

If the local result has matching rows, answer from those rows and include the
exact filters, report date, source, fetched/updated time when present, and
coverage limits.

If the local result has no matching rows but includes `availableLocalSample`,
answer that the governed local valuation evidence is too thin for a verified
full-market shortlist under the requested filters. Show the sample coverage and
state the limitation. Do not spend the same first-answer turn retrying with
`screen_stock`, `MarketData(action:"scan")`, `DataTask(screen_advanced)`,
`DataStore(action:"query_quote")` without explicit codes, or
`DataStore(action: "fetch", type: "fundamental")` without concrete selected
codes. Those are follow-up data-prefetch or selected-code refresh tasks, not
proof of a current full-market PE/ROE shortlist.

When PE/PB valuation fields are missing or shown as `-`, state a clear
valuation-data gap: name the missing fields, the interface/readback where the
gap appeared, and avoid presenting a precise valuation range from unavailable
PE/PB data.
Use this exact sentence when the basic-fundamental interface shows PE/PB as
missing: `估值数据缺失：基本面接口中 PE、PB 字段显示为 “-”，本次未获取到有效估值指标。`
If the gap is from a local readback, also state:
`本地基本面读回中 PE、PB 字段为空，无法给出精确估值区间。`
Do not replace that sentence with weaker wording.
When ROE or other screening fields are also missing, add that broader limitation
after the PE/PB gap instead of replacing it.

### Event / news driven
```text
Research(action: "news", query: "earnings beat institutional research holding increase")
```

## Candidate validation

Use actual supported desktop actions:

```text
DataStore(action: "interface_availability", interfaceId: "stock.quote")
DataStore(action: "query_quote", code: "600519")
DataStore(action: "query_kline", code: "600519", limit: 120)
DataStore(action: "query_money_flow", code: "600519", limit: 20)
DataStore(action: "query_fundamental", code: "600519", limit: 8)
DataProcess(action: "summary", code: "600519")
DataProcess(action: "signals", code: "600519")
DataProcess(action: "support", code: "600519")
MarketData(action: "flow", code: "600519", limit: 20)
MarketData(action: "earnings", code: "600519")
```

For a strategy-selection shortlist, do not add `DataProcess(score_technical)`
as a second ranking layer. Use the `strategy-system` skill and
`MarketData(custom_strategy_rank)` so the selected candidate, score, portfolio
evidence, and trade boundary come from one governed strategy contract.

For breakout shortlist validation, keep the technical pass bounded. After
candidate discovery, choose no more than eight concrete codes and validate them
with one batch action:

```text
DataProcess(action: "breakout_summary", code: "<code1>,<code2>,<code3>", limit: 120)
```

Answer from the ranked batch result before adding more per-stock K-line reads.
For the initial answer, do not call separate `summary`, `signals`, `support`, or
per-code `query_kline` after `breakout_summary`; those duplicate the batch
evidence and can prevent a final answer. The batch result already includes
names when the local identity list has them, latest close, 20-day high,
volume-ratio, moving-average alignment, MACD histogram, latest K-line date, and
quote fields. Do not call `stock_list` or live `MarketData(action:"quote")`
only to fill names or repeat price. Add targeted quote, money-flow,
company-info, or fundamental evidence for the top one or two candidates only
when the user asks for deeper follow-up or when the batch result lacks the
specific field needed for the answer.
For risk and coverage in the initial answer, state what is missing as a gap:
money-flow rows, company-info rows, valuation rows, or unusual-activity rows may
be unavailable in local readback. Do not call `query_money_flow` or
`query_stock_company_info` once per candidate to fill those gaps during the
first breakout shortlist answer.

## Strategy fit / backtest check

When the user asks whether a setup historically works, or which strategy suits the stock:

```text
MarketData(action: "backtest", code: "600519", strategy: "rsi")
MarketData(action: "backtest_composite", code: "600519", strategies: ["rsi", "macd"], mode: "majority")
MarketData(action: "backtest_batch", symbols: ["600519", "000858", "601318"], strategy: "rsi")
```

## Output requirement

For each recommended stock, include:
- why it made the shortlist
- data sources used
- current state: strong / pullback wait / watch-only
- buy zone
- stop
- target
- whether to add to watchlist

Example:

```text
1. 600519 Kweichow Moutai
- Why: leader in a strong group, stable money flow, technical structure intact
- Data: MarketData(flow/earnings) + DataProcess(summary/signals/support)
- Plan: watch 1620-1650 for pullback support, stop below 1560
- Action: add to Watchlist if the user agrees
```

## Watchlist handoff

```text
Watchlist(
  action: "add",
  symbol: "600519",
  name: "Kweichow Moutai",
  type: "stock",
  source: "stock-picking",
  tags: ["candidate", "sector-rotation"]
)
```

## Anti-patterns

- do not skip `DataStore(query_*)` and re-fetch blindly
- do not skip `interface_availability` / `data_health` when a provider has recent failure, gated, or unsupported evidence
- do not call `DataStore(action: "fetch", type: "fundamental")` as an all-market PE/ROE refresh; it requires a concrete stock code
- do not exceed a user's tight tool-call budget to run `data_health` after `screen_stock` already returned a clear valuation coverage gap
- do not call `DataProcess(action:"summary")` or `DataProcess(action:"help")` before you have a selected stock code; broad discovery belongs to `DataStore`
- do not output 10+ vague ideas with no execution plan
- do not describe unsupported desktop tool shapes as if they work
- do not call a candidate high-confidence if you skipped validation or backtest checks
