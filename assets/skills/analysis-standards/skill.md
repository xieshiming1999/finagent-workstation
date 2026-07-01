---
description: Shared investment-analysis output standards covering ratings, report structure, data sourcing, and risk guardrails.
when_to_use: Reference automatically for any stock analysis, investment recommendation, debate, or decision memo.
---

# Investment Analysis Standards

## Data sourcing and guardrails

### Source labeling is mandatory

Every material data point must include a source. Do not invent numbers.
For analysis, reports, dashboards, watchlist items, and shortlist recommendations, preserve the shared Finance Output Standard:
- separate **Fact**, **Calculation**, **Inference**, **Recommendation**, **Assumption**, and **Unverified item**
- retain provider/file source, source/as-of time, fetch/ingest time, fields used, method/tool action, quality or confidence note, and same-runtime readback status when reusable data is persisted
- if a metadata field is unavailable, mark it as unavailable instead of filling it from guesswork

If a tool returns a JSON payload with a `source` field, cite that field directly:

```text
OK  PE 15.3 (source: EastMoney)
OK  revenue growth 23% (source: EastMoney)
OK  RSI 42.5 (source: TDX)
OK  K-line data (source: EastMoney, 120 bars)
OK  sentiment indicator (source: EastMoney Guba)

NOT OK  PE is around 15
NOT OK  industry average PE is roughly 20
```

Typical source mappings:
- `MarketData`: EastMoney / TDX / Tushare / TradingView / Yahoo Finance / ExTDX
- `Research` (tool name): Brave / Tavily / Baidu / Sina Finance
- `XueqiuTrade`: Xueqiu

### Analysis evidence contract

When a tool or panel returns `analysisEvidence` with
`contract: "analysis-evidence-v1"`, treat that object as the authoritative
analysis layer. Use its structured fields directly:

- `observedFacts`: factual evidence already gathered.
- `interpretations`: analysis and risk/signal interpretation.
- `missingEvidence`: coverage gaps that must be stated, not hidden.
- `confidence`: quality level of the current analysis.
- `sourceCoverage`: source, source data time, fetched time, cache/coverage
  status when available.
- `strategyReadiness`: whether the result is still `analysis_only`, a
  candidate, or strategy-ready.

Do not present `analysis_only` output as a validated strategy, backtest, monitor
rule, or trade plan. If the user asks to turn analysis into a reusable rule,
create or validate a StrategySpec through the strategy-system workflow.

Market snapshot outputs with `kind:"market_analysis"` are market-regime
evidence only. Use them for observed breadth, sector, limit-pool, hot-rank, and
failure-gap reporting; do not convert them into monitor or trade rules without
a separate validated contract.

Sector and flow readbacks with `kind:"sector_analysis"` or
`kind:"flow_analysis"` are rotation and capital-flow evidence only. Use them to
explain market structure, leadership, and liquidity context; do not convert
them into monitor rules, StrategySpec conditions, or trade actions without a
separate validated contract.

News readbacks with `kind:"news_analysis"` are context evidence only. Use
`observedFacts`, `missingEvidence`, and `sourceCoverage` to explain what news is
available and what still needs confirmation; do not treat news rows as sentiment
scores, validated fundamentals, strategy rules, or trade triggers unless a
separate validated contract supplies those fields.

Valuation readbacks with `kind:"valuation_analysis"` are valuation-context
evidence only. Use PE/PB/ROE and source coverage as facts to explain valuation
availability and gaps; do not convert them into a buy/sell rule, screen result,
or position-size decision without a validated strategy or risk contract.

Risk readbacks with `kind:"risk_analysis"` are risk-context evidence only. Use
beta, volatility, Sharpe, VaR, liquidity, and source coverage as facts to
explain risk availability and gaps; do not convert them into a stop-loss,
position-size decision, StrategySpec rule, monitor trigger, or trade action
without a validated strategy or risk contract.

If the toolset cannot verify the number, mark it clearly as `[unverified]`:
- `industry average gross margin is about 35% [unverified, user should confirm]`
- `management is reportedly planning capacity expansion [unverified, source: news summary]`

### Required disclaimer

Any recommendation that implies buying or selling must end with a disclaimer such as:

```text
Disclaimer: the analysis above is based on public data and technical indicators for reference only. It is not investment advice.
Markets carry risk. Invest carefully. Historical performance does not guarantee future results.
```

### Decision checkpoints

Stop and state the risk clearly before continuing when any of these apply:
- recommending a stock purchase without a stop-loss and maximum loss amount
- suggesting a position size above 20% without concentration-risk warning
- recommending ST names or structurally loss-making names without delisting-risk warning
- making cross-market recommendations without FX and market-hours warning
- reaching a conclusion from only one indicator without cross-checking at least two dimensions

## Five-level rating system

Every conclusion should use one of these ratings:

| Rating | Meaning | Typical use |
|---|---|---|
| **buy** | strong positive view; open or add aggressively | most dimensions are favorable |
| **accumulate** | constructive view; add gradually | broad direction is favorable but uncertainty remains |
| **hold** | evidence is genuinely balanced | only use when the evidence is truly even |
| **reduce** | cautious view; lower exposure gradually | risk is rising but not fully bearish yet |
| **sell** | strong negative view; exit or avoid | fundamentals, structure, or news flow are decisively negative |

Rule: if one side of the evidence is materially stronger, give a directional rating instead of hiding behind `hold`.

## Report structure

1. End the report with a Markdown summary table:

```text
| Dimension | Conclusion | Evidence |
|---|---|---|
| Technical | constructive | MACD golden cross + above 20-day MA |
| Fundamental | neutral | revenue is growing but margin is compressing |
| Flow | cautious | net main-force outflow for 3 straight days |
| Overall rating | accumulate | technical trend leads while fundamentals need confirmation |
```

2. Anchor every tool call to the exact security code. Do not drift to another code or informal shorthand midway through the analysis.

## Tool-call discipline

Fetch data first, then analyze it:

```text
# correct order
MarketData(action:"kline", ...)
DataProcess(action:"indicators", ...)

# incorrect order
DataProcess(action:"indicators", ...)
```

Do not fetch the same data repeatedly once it is already available in the current workflow.

## Indicator selection

Prefer at most eight complementary indicators.

| Category | Preferred indicators | Use | Note |
|---|---|---|---|
| Trend | MA20 / MA60 / MA200 | trend direction and support | avoid stacking too many moving averages |
| Momentum | RSI, MACD | overbought/oversold and momentum change | these pair well together |
| Volatility | BOLL, ATR | range and stop setting | usually choose one |
| Volume-price | OBV, MFI | volume confirmation | usually choose one |
| Advanced | Ichimoku, RSRS | composite trend judgement | RSRS is often useful in A-shares |
| Regime / pattern | Hurst | trend vs range judgement | use it to choose strategy style |

Anti-redundancy rule:
- RSI and KDJ overlap heavily; usually pick one
- BOLL and ATR overlap heavily; usually pick one

## Common mistakes

| Mistake | Better approach |
|---|---|
| Calling `buy` only because MACD crossed up | also confirm trend direction and volume/price behavior |
| Ending with `worth watching` | give a real rating and a concrete action plan |
| Assuming low PE means undervaluation | check whether earnings quality and growth are deteriorating |
| Listing indicator values without a judgment | convert the indicators into a conclusion |
| Hiding behind vague language like `maybe` or `perhaps` | give a probability range or a conditional trigger |
| Ignoring counter-evidence | show both sides, then explain the weighting |
