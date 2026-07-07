---
description: Strategy System - governed StrategySpec creation, validation, backtest, save/rerun, ranking, watch, and monitor workflows.
when_to_use: Use when the user asks to design, create, validate, backtest, save, rerun, rank, watch, monitor, or reject a reusable strategy or StrategySpec; also use for strategy selection, strategy win rate, and custom rule validation.
---

# Strategy System

## Core Concept

Strategy is not the same thing as a user setting. It is an internal agent
capability. For buy-readiness and recommendation intents, select the
appropriate strategy automatically and return a full reasoning chain.

## Strategy Types

| Type | Meaning | Output |
|------|------|------|
| **stockPicking** | Stock selection | Candidate list + per-name score + reasoning |
| **stockTrading** | Trading decision | Buy / hold / avoid + full rationale |
| **fundPicking** | Fund selection | Candidate funds + evaluation |
| **fundTrading** | Fund trading | Subscribe / redeem advice + rationale |

## Tool Actions

```
DataProcess(action: "strategy_list")
→ List all available strategies and their win rates

DataProcess(action: "strategy_execute", symbol: "600519", strategyId: "preset_01")
→ Execute the strategy and return a full reasoning chain:
  1. ✅ Bullish MA alignment: MA5 > MA10 > MA20 confirmed
  2. ✅ Pullback support: only 1.5% above MA10
  3. ✅ Volume contraction confirmed: volume declined for 3 consecutive days
  4. ⚠️ Neutral RSI: RSI = 52
  Overall score: 82/100 | Decision: favorable entry setup

DataProcess(action: "strategy_backtest", symbol: "600519", strategyId: "preset_01", limit: 250)
→ Historical backtest for the strategy: signal count / win rate / average return / max drawdown
```

For technical-strategy backtest, comparison, or parameter optimization, use the
governed `MarketData` backtest path, not shell/log/file inspection:

```text
DataStore(action: "coverage", symbols: "600519")
DataStore(action: "query_kline", code: "600519", period: "daily", start: "2021-06-28", end: "2026-06-28", limit: 1300)
MarketData(action: "optimize_params", code: "600519", strategy: "rsi", period: "5y", paramGrid: {"period":[10,14,20], "oversold":[25,30,35], "overbought":[65,70,75]})
```

`strategy_execute` always needs a concrete `symbol` or bounded `symbols` list.
Do not call it with only `strategyId`. If the user asks a broad “which stock”
or “what should I buy/watch” question, discover candidates first through
governed `DataStore` / `MarketData` readbacks such as hot rank, sector rank,
flow rank, watchlist rows, or another explicit candidate source, then run
`strategy_execute` on that bounded set.

Single-name technical actions are not batch actions. For `DataProcess` actions
such as `indicators`, `support`, `volume`, `pattern`, `trend`, or `summary`,
call one concrete `symbol` at a time. Do not pass `symbols` unless the tool
help explicitly lists that action as batch-capable.

If local K-line rows already cover the requested period, do not spend extra
provider-status, fetch, Grep, Read, or log-inspection calls before running the
optimizer. Report requested window, actual data window, best parameters, and
`parameterStability` evidence, plus overfit/slippage/cost caveats.

## Agent-Created Strategies

When the user asks to invent, create, or save a new strategy, do not pass an
arbitrary strategy name into `backtest`, `backtest_batch`, or
`optimize_params`. Use the governed custom strategy path:

For a single custom strategy design/backtest request, keep the first pass
bounded to the custom strategy lifecycle: `custom_strategy_help` when discovery
is needed, exactly one `custom_strategy_validate`, then exactly one
`custom_strategy_backtest` if validation succeeds. Do not run broad
preset-strategy comparisons, multiple custom strategy variants, or multiple
`MarketData(backtest)` calls in the same turn unless the user explicitly asks
to compare against presets, optimize parameters, or rank alternatives.
`custom_strategy_backtest` already returns benchmark/data/risk evidence; use
that evidence before spending extra backtest calls.

`custom_strategy_help` is progressive-disclosure by default. The normal
`MarketData(action:"custom_strategy_help")` response is a compact contract
summary with examples, categories, counts, preview indicator parameter schemas,
and input/output contracts. Use only the indicators and parameters shown in
the preview unless you explicitly request
`MarketData(action:"custom_strategy_help", detail:"catalog")` for a full
catalog. Only ask for the full catalog when a specific uncommon indicator is
needed. Do not use `Read` to inspect overflow help output for ordinary
strategy design.

Do not use `Read`, `LS`, `Grep`, `Glob`, or hand-authored file paths to inspect
strategy artifacts while designing or validating a strategy. Strategy lifecycle
state is exposed through `custom_strategy_help`, `custom_strategy_validate`,
`custom_strategy_backtest`, `custom_strategy_save`, `custom_strategy_list`,
`custom_strategy_read`, `custom_strategy_compare`, and `custom_strategy_run`.
Use `custom_strategy_read` for one saved strategy inspection; use
`custom_strategy_run` only when rerunning a saved runnable stock strategy. If
those actions do not return the needed structured state, report the missing
contract instead of guessing a file path.

```text
MarketData(action: "custom_strategy_help")
MarketData(action: "custom_strategy_validate", strategySpec: {...})
MarketData(action: "custom_strategy_backtest", code: "600519", strategySpec: {...}, outOfSampleRatio: 0.3, walkForwardFolds: 3)
MarketData(action: "custom_strategy_observe", strategySpec: {...}, fundRows: [...])
MarketData(action: "custom_strategy_fund_backtest", strategySpec: {...}, fundRows: [...])
MarketData(action: "custom_strategy_rank", symbols: ["600519","000858","300750"], strategySpec: {...}, topN: 2)
MarketData(action: "custom_strategy_save", strategySpec: {...}, evidence: <backtest result>)
MarketData(action: "custom_strategy_read", strategyId: "custom_rsi_volume_rebound_v1")
MarketData(action: "custom_strategy_compare", strategyIds: ["custom_rsi_volume_rebound_v1"])
MarketData(action: "custom_strategy_run", code: "600519", strategyId: "custom_rsi_volume_rebound_v1")
```

Before composing custom strategy calls, read
`custom_strategy_help.inputContracts` for the action being used. Treat
`requiredFields`, `symbolFields`, `optionalFields`, and `boundary` as the
code-owned call contract for validate, backtest, fund observe/backtest, rank,
save, and run. Do not infer missing inputs from previous prose or saved file
paths.

Saved strategy rule: list is for discovery, read is for one artifact, run is
for executable rerun. For “save, restart/readback, and rerun” workflows, use:

```text
MarketData(action: "custom_strategy_list")
MarketData(action: "custom_strategy_read", strategyId: "<id>")
MarketData(action: "custom_strategy_run", strategyId: "<id>")
```

Do not use `Read` on `custom-strategies.json`, `strategies/items/*.json`, or
`.tool_outputs/*` to inspect saved strategy state.

Lifecycle rule: `custom_strategy_backtest` with `status:"backtested"` and
`lifecycleAdvice.saveable:true` is valid evidence for
`custom_strategy_save`. If the user requested save/rerun verification, call
`custom_strategy_save` with that exact backtest evidence, then call
`custom_strategy_run` by returned `strategyId`. `metrics.tradeCount:0` is not a
validation failure; it is an evidence boundary to report. Do not redesign or
repeat strategy variants after a zero-trade backtest unless the user asks for
optimization or the structured validation/backtest status is rejected.

Executable v1 accepts structured `StrategySpec` rules over governed technical
components: `sma`, `ema`, `rsi`, `stochastic_rsi`, `macd` histogram, `ppo`, `bollinger` z-score, `atr`,
`highest`, `lowest`, `volume_sma`, `price_change_pct` / ROC, and
`momentum_rank`, `momentum_acceleration_pct`, `rolling_volatility`, `downside_volatility_pct`,
`volatility_percentile`,
`sortino_ratio`, `sharpe_ratio`, `calmar_ratio`, `ulcer_index`,
`positive_period_ratio`, `negative_period_ratio`,
`max_consecutive_down_bars`, `max_consecutive_up_bars`,
`return_skewness`, `return_kurtosis`,
`efficiency_ratio`, `volatility_regime`, `ema_slope`, `moving_average_regime`,
`kama_distance_pct`, `kama_slope_pct`, `linear_regression_slope_pct`, `linear_regression_r2`,
`aroon_oscillator`, `aroon_up`, `aroon_down`, `dmi_plus`, `dmi_minus`, `dmi_spread`,
`donchian_width_pct`, `range_compression_ratio`, `donchian_position_pct`, `keltner_width_pct`, `supertrend_direction`,
`supertrend_distance_pct`, `chandelier_stop_distance_pct`, `bollinger_bandwidth`,
`bollinger_percent_b`, `bollinger_band_distance_pct`, `kdj`, `stochastic_d`, `stochastic_j`, `adx`,
`turnover_rate`, `liquidity_ratio`,
`volume_zscore`, `volume_breakout`, `volume_percentile`, `money_flow_index`, `on_balance_volume`,
`accumulation_distribution_line`, `chaikin_money_flow`,
`force_index`, `ease_of_movement`,
`commodity_channel_index`, `williams_r`, `chande_momentum_oscillator`, `trix`,
`true_strength_index`,
`drawdown_pct`, `rolling_max_drawdown_pct`, `drawdown_duration_bars`, `distance_to_high_pct`,
`distance_to_low_pct`, `breakout_pct`, `breakdown_pct`, `ma_distance_pct`,
`price_zscore`, `atr_pct`, `intraday_range_pct`, `gap_pct`, and
`close_location_pct`, `body_return_pct`, `upper_shadow_pct`,
`lower_shadow_pct`, `shadow_balance_pct`, and `body_to_range_pct`.
It supports comparison/cross operators, `stop_loss_pct`,
`take_profit_pct`, `trailing_stop_pct`, `max_drawdown_stop_pct`,
`atr_stop_loss`, `time_stop_bars`, and bounded
`full_capital`, `fixed_fraction`, `risk_per_trade`, or `kelly_fraction`
position sizing. `kelly_fraction` must stay capped: provide
`initialFraction`, `minTrades`, `kellyScale`, and `maxPositionPct` when the
user wants Kelly-style sizing. The runtime computes it only from prior
completed backtest trades and falls back to the bounded initial fraction
before enough completed trades exist. If a rule needs news sentiment, intraday
tape interpretation, options legs, custom code, or broker execution, state
that it is not executable in the current custom backtest engine and keep it as
a non-runnable research note until a validator/compiler path exists.

Use the canonical stock `StrategySpec` shape. Do not invent fields such as
`entryRules.conditions` or `exitRules.stop_loss_pct`; the validator expects
declared indicators plus `entry` / `exit` rule groups:

```json
{
  "name": "low_risk_pullback",
  "market": "cn",
  "universe": {"type": "single", "symbols": ["600519"]},
  "dataRequirements": {
    "minBars": 120,
    "adjust": "none",
    "requiredFields": ["open", "high", "low", "close", "volume"]
  },
  "indicators": [
    {"id": "ema20", "type": "ema", "source": "close", "params": {"period": 20}},
    {"id": "ema60", "type": "ema", "source": "close", "params": {"period": 60}},
    {"id": "rsi14", "type": "rsi", "source": "close", "params": {"period": 14}},
    {"id": "atrPct14", "type": "atr_pct", "source": "close", "params": {"period": 14}}
  ],
  "entry": {
    "all": [
      {"left": "ema20", "op": ">", "right": {"mul": ["ema60", 1]}},
      {"left": "rsi14", "op": "<=", "right": 60},
      {"left": "atrPct14", "op": "<=", "right": 3}
    ]
  },
  "exit": {
    "any": [
      {"type": "stop_loss_pct", "value": 6},
      {"type": "take_profit_pct", "value": 12},
      {"type": "atr_stop_loss", "value": 2, "period": 14},
      {"type": "trailing_stop_pct", "value": 8}
    ]
  },
  "positionSizing": {"type": "fixed_fraction", "value": 0.2}
}
```

For Kelly-style risk sizing, keep it explicit and bounded:

```json
"positionSizing": {
  "type": "kelly_fraction",
  "initialFraction": 0.1,
  "minTrades": 5,
  "kellyScale": 0.5,
  "maxPositionPct": 0.25
}
```

Do not calculate Kelly sizing yourself from final prose. Use the validated
StrategySpec and read the resulting `assumptions.positionSizing`,
`riskRewardEvidence`, and `metrics` fields from `custom_strategy_backtest`.
For tail-loss risk rules, use code-owned StrategySpec indicators from
`custom_strategy_help`, such as `value_at_risk_pct` and
`conditional_value_at_risk_pct`; set `period` and `confidence` in
`params` instead of describing VaR / CVaR only in prose.
For volume confirmation, use code-owned StrategySpec indicators from
`custom_strategy_help`, such as `volume_breakout`, `money_flow_index`,
`volume_oscillator_pct`, `volume_rate_of_change_pct`, `on_balance_volume`,
`volume_price_trend`, `positive_volume_index`, `negative_volume_index`,
`chaikin_money_flow`, `force_index`, `ease_of_movement`, or
`rolling_vwap` / `vwap_distance_pct`.
For volatility-state checks, use code-owned StrategySpec indicators from
`custom_strategy_help`, such as `rolling_volatility`, `volatility_regime`,
and `volatility_percentile`.
For ATR-based risk sizing or stop-distance checks, use
`atr_stop_distance_pct` and `risk_reward_ratio` as structured risk evidence
instead of calculating stop distance or reward/risk in prose.

If the user's core strategy signal is unsupported, do not silently design,
validate, backtest, or save a proxy strategy that replaces it with supported
signals such as volume, RSI, or moving averages. A proxy version is a separate
strategy and requires an explicit user request.

For a request that asks whether unsupported source signals can be directly
backtested, preserve the requested source signals in `StrategySpec` as
unsupported indicator types and call `custom_strategy_validate` only. Do not
encode the unsupported idea as a supported proxy description, `entryRules`, or
`exitRules`. Example unsupported indicator types include
`news_sentiment`, `main_fund_flow`, `order_book_tape`, and
`market_sentiment`. If the user later approves a proxy redesign, that second
StrategySpec must include `proxyFor`, `unsupportedOriginalSignals`, and
`proxyApproval: {"approved": true}`.

Fund StrategySpec is a separate observation contract. For fund strategies, set
`assetClass:"fund"` or `market:"fund"` and use fund-specific indicators such as
`nav_trend`, `rolling_return`, `fund_drawdown`, `fund_rolling_max_drawdown`, `fund_average_drawdown`, `fund_volatility`,
`fund_downside_volatility`,
`fund_ulcer_index`, `fund_drawdown_duration_bars`, `fund_sharpe`, `fund_sortino`, `fund_calmar`, `fund_recovery_ratio`, `fund_gain_to_pain`,
`fund_momentum_acceleration`, `fund_omega`, `fund_tail_ratio`, `fund_positive_period_ratio`,
`fund_negative_period_ratio`, `fund_max_consecutive_down_periods`,
`fund_max_consecutive_up_periods`, `fund_return_skewness`,
`fund_return_kurtosis`, `fund_value_at_risk`,
`fund_conditional_value_at_risk`, `money_yield`,
`seven_day_yield`, or `dca_interval`. A validated fund
StrategySpec is not stock-backtestable in the current runtime. Do not call
`custom_strategy_backtest` for it; gather evidence through `query_fund_nav`,
`query_fund_money_yield`, `query_fund_performance`, or `query_fund_holding`.
Use `MarketData(action:"custom_strategy_help")` as the code-owned discovery
surface for the current fund `indicatorCatalog`, `indicatorCategories`, source,
required fields, and parameter schema. Do not maintain a separate fund-method
list from prose when drafting a fund StrategySpec.
Money funds require `money_yield` or `seven_day_yield`; do not force them into
ordinary NAV rules.
`custom_strategy_observe` returns current fund observation evidence, including
`dcaObservation`, `monitorDraft`, and, when `fundRows` contains multiple
fund code groups, `comparisonEvidence`. `custom_strategy_fund_backtest`
returns fund-specific NAV/yield period evidence such as period return,
drawdown, volatility, Sharpe / Sortino / Calmar-style NAV evidence,
gain-to-pain / Omega / tail-ratio NAV return-quality evidence, positive
period ratio NAV return-consistency evidence,
money-yield totals, and average seven-day yield. These are structured
observation/research inputs, not subscription, redemption,
simulated-trade, or stock-backtest results. For fund comparison or fund-period
validation prompts, report from `comparisonEvidence` or
`custom_strategy_fund_backtest` instead of using stock ranking or stock K-line
signals.
Both fund actions include `fundCategoryEvidence`. Use it to disclose whether
the evidence is ordinary fund NAV, money-fund yield, or ETF/listed-fund
evidence. Money funds should report `pricingBasis:"money_yield"` and ETF /
ETF-link rows must state whether the evidence uses NAV, listed market price,
or still requires an explicit pricing basis.

Saved strategy artifacts expose a code-owned `strategyType`. Use it when
choosing lifecycle actions instead of reclassifying from prompt wording:
`stock_strategy` uses stock signal backtest/monitor paths, `fund_strategy`
uses fund observation and NAV/yield paths, `portfolio_strategy` uses ranked
portfolio evidence and review-only rebalance monitoring, `etf_market_strategy`
uses listed-fund/ETF evidence with explicit pricing basis, and
`unknown_strategy` should be read back before action. If the field is missing,
the runtime infers it from status, asset class, evidence action, portfolio
evidence, fund evidence, and pricing basis.

Saved strategy storage is a code-owned artifact contract, not an agent-authored
JSON convention. Use `custom_strategy_save`, `custom_strategy_list`,
`custom_strategy_compare`, and strategy library actions to read the contract.
The runtime writes the canonical library under `strategies/custom-strategies.json`
and per-strategy artifacts under `strategies/items/<strategyId>.json`, with
legacy `data/custom-strategies.json` as readback compatibility. Do not hand-edit
or parse those files when structured tool fields such as `artifactContract`,
`paths`, `itemPath`, `lifecycle`, `dataAndAssumptionSummary`,
`validationIssues`, `bestBy`, and `comparisonNotes` are available.

For multi-symbol stock strategy comparison, use `custom_strategy_rank` after
validation. It runs the same StrategySpec across a bounded candidate list,
returns ranked metrics, data evidence, portfolio aggregate evidence,
`portfolioBacktestEvidence`, `portfolioScoringEvidence`,
`portfolioDrawdownBudgetEvidence`, `portfolioReturnQualityEvidence`, and an
equal-weight top-N rebalance draft. Treat that draft as evidence only; it is
not a watchlist mutation, simulated order, or real trade.
Read `custom_strategy_help.inputContracts.custom_strategy_rank` before setting
portfolio controls. That contract owns the supported fields, defaults, bounds,
and evidence fields for ranking and rebalance draft shaping.
For strategy-selection or strategy-candidate scoring, `custom_strategy_rank`
is the governed scoring surface. Do not add legacy `DataProcess` technical
scoring after `custom_strategy_rank`, `backtest_batch`, or
`backtest_enhanced` has already produced strategy evidence; if the ranked
result is insufficient, explain the missing evidence or run another governed
`MarketData` strategy action.
The returned `portfolioEvidence` includes portfolio-level return/drawdown
evidence derived from selected symbols, plus correlation evidence,
`concentrationEvidence`, `portfolioReturnQualityEvidence`, and
`portfolioScoringEvidence`, `portfolioDrawdownBudgetEvidence`, and
`portfolioBacktestEvidence`. Use those fields
when discussing portfolio risk, risk-adjusted score, return quality, or
watchlist portfolio backtest evidence instead of
substituting a single symbol's drawdown or Sharpe ratio for the whole
portfolio.
When a ranked portfolio artifact is saved, `custom_strategy_save`,
`custom_strategy_list`, `custom_strategy_compare`, and readback-only
`custom_strategy_run` preserve `concentrationEvidence` and
`portfolioScoringEvidence` / `portfolioDrawdownBudgetEvidence` /
`portfolioReturnQualityEvidence` through
`dataAndAssumptionSummary`; use those structured fields by strategy ID instead
of recalculating from prose.
For relative-strength / RPS-style questions, set
`rankingMetric:"relative_strength_pct"` or `rankingMetric:"rps"`; this ranks
symbols against the bounded candidate set and returns each row's
`relativeStrength` evidence.
If the user asks for rebalancing cadence or position concentration control,
pass `rebalanceInterval` (`weekly`, `monthly`, or `quarterly`) and
`maxPositionWeight` as bounded draft assumptions. If the user asks to exclude
weak candidates, pass `minScore`; below-threshold rows remain visible with
`selectionEvidence.exclusionReason` but cannot enter the rebalance draft. If
the user asks for diversification or low-correlation portfolio selection, pass
`maxPairwiseCorrelation` as a bounded absolute close-return correlation cap;
correlation-skipped rows remain visible with `selectionEvidence` and
`correlationConstraintEvidence`.
These fields still produce evidence only; they do not place trades or mutate
holdings.

For these custom-strategy creation intents, do not start with
`DataProcess(strategy_list)`, `DataProcess(strategy_execute)`, or
`DataProcess(strategy_backtest)`. Those actions are for preset strategies, not
for compiling a user-authored rule. A valid first pass is `MarketData` help,
then `custom_strategy_validate`. Do not call `interface_availability` for
`custom_strategy_*`; these are strategy-tool actions, not Data API interfaces.
`custom_strategy_help` is also the discovery surface for structured output
contracts; read its `outputContracts` / contract text before inferring fields
such as `dataCoverage`, `repairPlan`, `validationIssues`, `unsupportedDetails`,
`lifecycleIssue`, fund evidence, or portfolio evidence from prose.
If the user asks to validate only or says not to save, stop after
`custom_strategy_validate` and answer from the validation result; do not run
`custom_strategy_backtest` or `custom_strategy_save` unless the user asks for
backtest/save.

Custom-strategy workflow is contract-driven:

- Treat `custom_strategy_validate` as the source of truth for accepted,
  rejected, warning, and unsupported rule parts. Read the structured
  `validationSummary`, `repairPlan`, `validationIssues`, `unsupportedDetails`, and
  `unsupported` fields for next action, schema/rule-shape repair, invalid
  parameters, data-window gaps, sizing/risk/exit-value bounds, non-executable
  indicators, operators, sources, or fund/stock boundary violations instead of
  scraping prose from `errors` or `workflowAdvice`.
  Use `repairPlan[*].target` and `repairPlan[*].patchHint` to revise the
  StrategySpec shape; do not infer a patch from natural-language error text.
  For unsupported stock or fund indicators, prefer
  `repairPlan[*].patchHint.candidateTypes` and
  `repairPlan[*].patchHint.candidateCatalog` as bounded replacement options.
  Choose one deliberately in a revised StrategySpec; do not let the runtime
  silently replace unsupported signals.
  If `dataRequirements.minBars` is too short, use
  `repairPlan[*].patchHint.operation: "set_min_bars"` plus `targetValue` or
  `requiredMinBars` to revise the StrategySpec data window. Do not infer the
  required window from natural-language validation text.
- Treat saved/listed/readback strategy artifacts as lifecycle evidence. The
  same `repairPlan` field is preserved by `custom_strategy_save`,
  `custom_strategy_list`, and non-runnable `custom_strategy_run` readback, so use
  that structured field before reopening nested validation prose.
- Treat `custom_strategy_backtest` `signals` as the source of truth for entry
  count, exit count, stop exits, completed trades, open position, and
  `noSignalReason`; do not infer those from prose.
- Treat `custom_strategy_backtest` `riskRewardEvidence` as the source of truth
  for completed-trade payoff, profit factor, expectancy, and best/worst trade.
  It is backtest evidence only, not a buy/sell guarantee or permission to
  place an order.
- Treat `custom_strategy_backtest` and runnable `custom_strategy_run`
  `dataCoverage` as the source of truth for K-line coverage. Report
  `rows`, `requiredBars`, `sufficient`, date window, source, and cache status
  from that field instead of reconstructing coverage from raw `dataEvidence`.
- When the user asks for robustness, holdout, walk-forward, stability, or
  overfit checks, pass `outOfSampleRatio` and/or `walkForwardFolds` to
  `custom_strategy_backtest` and report the structured `outOfSample` and
  `walkForward` blocks. If either block is skipped for insufficient bars,
  disclose that limitation instead of presenting a single-window backtest as
  stable evidence.
- Save only strategies that have backtest evidence. A validation-only strategy
  is not runnable by id until it has been backtested and saved with backtest
  evidence. Fund observation evidence saves as `observed`, and portfolio rank
  evidence saves as `ranked`; those records are reusable evidence artifacts,
  not runnable single-symbol backtests.
- When deriving a watchlist item or monitor from a strategy, preserve the
  `strategyId` and structured `strategyRules` in the target tool call. Do not
  convert the rule into only a human sentence.
- After adding a strategy-derived watchlist item, read it back with
  `Watchlist(action:"list", symbol:"...", strategyId:"...", status:"watching")`
  so duplicate symbols do not cause the final answer to cite an older item.
- When deriving a watchlist item from `custom_strategy_rank`, pass
  `portfolioEvidence` and `rebalanceDraft` as structured `Watchlist` fields.
  They remain evidence/provenance for observation; they are not a simulated
  order, broker order, or automatic portfolio rebalance.
- For fund observation monitors, use `MonitorCreate(template:"fund_rule_monitor")`
  and pass `monitorDraft` and `dcaObservation` from `custom_strategy_observe`
  as structured fields when available; the monitor contract folds them into
  strategy provenance and remains observation-only.
- For portfolio ranking monitors, use
  `MonitorCreate(template:"portfolio_rebalance_monitor")` and pass
  `portfolioEvidence` / `rebalanceDraft` from `custom_strategy_rank`; the
  monitor remains review-only and must not rebalance or place orders.
- When review output contains `strategyReview:` with
  `contract:"strategy-review-v1"`, consume that structured review boundary
  instead of treating the monitor result as analysis evidence or execution.
- If a workflow fails, fix or report the owning contract category: strategy
  schema, validator, data coverage, persistence/readback, monitor semantics, or
  confirmation boundary. Do not add exact user-prompt wording as the fix.

## Preset Strategies

| ID | Name | Type | Logic |
|---|---|---|---|
| preset_01 | Pullback on shrinking volume | stockTrading | Bullish MA stack -> support -> volume contraction -> RSI |
| preset_02 | Value growth | stockPicking | PE/PB -> ROE -> money flow -> technical score |
| preset_03 | Breakout with volume | stockTrading | New high -> volume expansion -> trend -> MACD |
| preset_04 | Undervalued DCA | fundPicking | PE percentile -> scale -> drawdown -> ranking |

## Agent Rules

1. **For buy-readiness or recommendation intents**: use `strategy_list` first to pick the right strategy. If the user did not provide a symbol, discover a bounded candidate set before `strategy_execute`. Then run `strategy_execute` with `symbol` or `symbols` and return the reasoning chain.
2. **Recommendations must be explainable**: do not say only "buy". Include the decision steps.
3. **New analysis must be recorded**: after `strategy_execute`, call `ai_record` to persist the prediction.
4. **Validate regularly**: `ai_validate` should update strategy win rates over time.
5. **Prefer proven strategies**: favor strategies with higher win rate once `timesUsed >= 3` and `winRate > 50%`.

## Reasoning Chain Format

```markdown
## Wuliangye (000858) - Pullback on Shrinking Volume

1. ✅ Bullish MA alignment: MA5(165.2) > MA10(162.8) > MA20(158.5) -> uptrend intact
2. ✅ Pullback support: current price is only 1.5% above MA10 -> attractive entry zone
3. ✅ Volume contraction: the last 3 volume ratios declined (1.2 -> 0.9 -> 0.7) -> not a panic selloff
4. ⚠️ Neutral RSI: RSI = 52 -> no extra confirmation

Overall score: 82/100 | Decision: favorable entry | Historical win rate: 70%
```

## Integration with Other Systems

```
strategy_execute -> decision output -> ai_record persists the prediction
ai_validate -> validation -> update strategy winRate -> write to knowledge/findings or failures
strategy_backtest -> historical validation -> support decision quality
MarketData backtest -> scoring + signal detection -> closed-loop execution suggestions
Watchlist.add -> watch pool -> wait for entry conditions
XueqiuTrade -> paper execution -> closed-loop validation
```

## Extended ai_record Format

When recording a prediction, use a fully structured payload so later validation can compare outcomes precisely:

```
DataProcess(action: "ai_record",
  symbol: "600519",
  direction: "bullish",
  priceAtAnalysis: 1680,
  strategy: "ema_cross",
  backtestScore: 82,
  entryCondition: "EMA20 crossed above EMA50, RSI=45, pullback on shrinking volume",
  expectedReturn: 15,
  expectedTimeframe: 30,
  stopLoss: 1520,
  confidence: "high",
  reasoning: "Bullish moving-average structure plus pullback to MA10 on shrinking volume, backtest grade A (score 82), EMA golden cross already confirmed"
)
```

**Field Notes**

| Field | Type | Meaning |
|------|------|------|
| symbol | string | Instrument code |
| direction | string | bullish/bearish/neutral |
| priceAtAnalysis | number | Price at the time of analysis |
| strategy | string | Strategy ID or strategy name |
| backtestScore | number | Backtest score (0-100) |
| entryCondition | string | Entry-condition description |
| expectedReturn | number | Expected return percent |
| expectedTimeframe | number | Expected holding period in days |
| stopLoss | number | Stop-loss price |
| confidence | string | high/medium/low |
| reasoning | string | Reasoning summary |

## ai_validate Comparison Rules

Validate by comparing the prediction against realized outcomes:

```
DataProcess(action: "ai_validate")
→ For each ai_record:
  - Actual return vs expectedReturn -> was the direction correct?
  - Actual holding time vs expectedTimeframe -> was the timing accurate?
  - Whether stopLoss was triggered
  - Whether the strategy score matched the realized result
→ Update winRate
→ 3 consecutive successful validations -> write to {{DATA_DIR}}/memory/knowledge/findings/
→ 3 consecutive failed validations -> write to {{DATA_DIR}}/memory/knowledge/failures/
```
