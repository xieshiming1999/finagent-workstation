---
name: watchlist
description: Use when a FinAgent Workstation workflow needs to add, list, update, enter, exit, or verify stock/fund observation items with the Watchlist tool.
when_to_use: User asks to add candidates to an observation pool, watchlist, self-selected list, daily watch, trigger list, or to verify/read back watched items.
---

# Watchlist

Use the `Watchlist` tool for observation state. Do not write watchlist files
directly and do not claim a watch item was created until the tool returns an id.

## Core Flow

1. Select or validate the candidate with data evidence first.
2. Add the item only when the user explicitly asks to observe, watch, save, or
   monitor it.
3. Use numeric fields for executable triggers: `targetEntryPrice`, `stopLoss`,
   `targetPrice`, or structured `conditions` when the tool/runtime supports it.
   `entryCondition` is explanatory text and must not be treated as an
   executable monitor rule by itself.
   Macro/factor evidence may be included as rationale or invalidation context,
   but it is not an executable watchlist trigger unless the tool exposes a
   supported structured condition for that factor type.
4. Read back with `Watchlist(action:"list", ...)` when the workflow requires
   verification or when multiple items were added.
5. If the user asks for alerts, create a monitor with `MonitorCreate` after the
   watch item exists.

## Strategy-Derived Items

When a watch item comes from a validated or backtested strategy, carry the
strategy contract into the watchlist state:

- pass `strategyId` when the strategy has a stable id;
- pass structured `strategyRules` for the executable entry, exit,
  invalidation, stop, target, and sizing rules;
- when the source is `custom_strategy_rank`, pass `portfolioEvidence` and
  `rebalanceDraft` as structured fields instead of copying them into prose;
- keep `entryCondition` as readable explanation, not as the only executable
  state;
- verify readback with
  `Watchlist(action:"list", symbol:"...", strategyId:"...", status:"watching")`
  when a stable strategy id exists, then check that `strategyId`,
  `strategyRules`, and any portfolio/rebalance evidence survived. Do not rely
  on a broad symbol-only list when duplicate watch items may exist.

If the strategy rule cannot be represented by supported watchlist fields, keep
the unsupported part visible and do not pretend the watch item will execute it.
If macro research or policy evidence explains why the item is being watched,
preserve it as provenance or final-answer context; keep executable watch rules
limited to supported numeric or structured fields.

## Examples

```text
Watchlist(action:"add", symbol:"300088", name:"长信科技", status:"watching",
  groupId:"default", entryCondition:"回踩 10.4-10.8 或放量突破 12.15",
  targetEntryPrice:10.8, stopLoss:9.9, targetPrice:12.15)
```

```text
Watchlist(action:"list", status:"watching", groupId:"default")
```

```text
Watchlist(action:"list", symbol:"600519", strategyId:"custom_20_v1", status:"watching")
```

```text
Watchlist(action:"add", type:"macro-condition", name:"流动性风险观察",
  status:"watching",
  entryCondition:"如果政策利率、资金利率或期限利差与当前假设相反，则重新评估股票/基金/策略结论。",
  source:"evidenceTier=...; refreshPolicy=...; missingEvidence=...; macro/news context is not a buy/sell trigger")
```

## Boundaries

- Do not use `Write`, `FileWrite`, or manual JSON editing for normal watchlist
  operations.
- Do not pass unsupported fields such as `exitCondition` to `Watchlist(add)`.
  If an exit rule matters, encode the executable part as `stopLoss`,
  `targetPrice`, or a supported structured condition, and keep the prose in
  `entryCondition` or the final answer as explanation.
- For fund watchlists, preserve the fund code/type and do not mix ordinary NAV
  signals with money-fund yield signals.
- For macro-condition watch rows, do not provide a stock/fund symbol unless the
  condition is explicitly attached to that asset. Keep the row as observation
  context, not an executable trade trigger.
- For trade workflows, watchlist state is not an executed order. Use
  `XueqiuTrade` or paper/simulation tools only when the user explicitly asks for
  a trading action and the required approval/credentials are available.
