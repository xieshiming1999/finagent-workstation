---
description: Trade execution framework for entry, sizing, stop, target, scaling, exit, and guarded app-supported order preparation.
when_to_use: Use when the user asks how to trade a selected stock, when to enter, how to size a position, wants a concrete trading plan after analysis, or expresses buy/sell/execution intent that needs order fields, risk checks, and confirmation before any write.
---
# Trade Execution

## Core idea

Stock-picking answers **what to buy**. Trade execution answers **how to buy it well**.
A good stock bought at the wrong time can still lose money.

The app-supported external execution route is Xueqiu MONI simulated trading.
Do not claim a separate real-broker route unless a real broker adapter is
explicitly configured and documented by the runtime.

## Boundary With Strategy Design

If the user asks to design, create, validate, backtest, save, rerun, or monitor
a reusable rule-based strategy, use `strategy-system` first. Trade execution
starts after there is a validated strategy, a concrete entry signal, or an
explicit request for position sizing/order preparation.

Do not replace StrategySpec validation with manual chart prose or a built-in
preset backtest. If a rule is unsupported, let the strategy validator reject or
classify that rule. Trade execution may then explain the risk plan for the
accepted strategy evidence, but it must not pretend unsupported strategy logic
was executed.

## Workflow

```text
Selected symbol
  -> Watchlist(action:"add", status:"watching", entryCondition:"...", targetEntryPrice, stopLoss, targetPrice)
  -> If the user asked to set monitoring, create MonitorCreate template alerts and verify with MonitorList
  -> Wait for entry signal (WatchlistRefresher checks automatically)
  -> Signal fires -> DataProcess(action:"strategy_execute")
  -> Compute position size / stop / target
  -> User confirms -> Portfolio(action:"preview_trade") and/or XueqiuTrade(action:"preview_order")
  -> User confirms final order fields -> Portfolio(action:"trade") + XueqiuTrade(action:"buy")
  -> Watchlist(action:"enter") + MonitorCreate(stop / take-profit)
  -> Manage position (trail / scale / reduce / exit)
  -> Exit -> Watchlist(action:"exit") + ai_record -> ai_validate -> review
```

## Confirmation checkpoint

When the next action depends on the user's approval, do not end with a plain
text question such as "是否确认买入". Call `AskUserQuestion` and wait. This is
mandatory for simulated buy/sell, transfer, final approval, order size, price
assumption, and portfolio choice. If the user has not answered through
`AskUserQuestion`, do not call `Portfolio(action:"trade")` or
`XueqiuTrade(action:"buy"|"sell"|"transfer_in"|"transfer_out")`.

For sizing-only requests such as "先计算" or "不要直接交易", return the position
size, cost, stop/target, and risk numbers, then explicitly state that no
`XueqiuTrade` buy/sell/transfer or `Portfolio` trade was executed in this turn.
Do not leave the execution boundary implicit.

When the runtime output includes `tradePrep:` with
`contract:"trade-prep-v1"`, treat that object as the authoritative execution
preparation boundary. It is not analysis evidence and not an executed trade.
Use its `prepKind`, `strategyId`, `signal`, `symbol`, `sizing`, `evidence`,
`previews`, `boundaries`, and `confirmation` fields instead of parsing prose.

For post-confirmation dry runs, use `Portfolio(action:"preview_trade")` for
local paper state and `XueqiuTrade(action:"preview_order")` for Xueqiu MONI
readback evidence. These preview actions are not execution and must not be
reported as a completed trade.

For final local paper execution after explicit confirmation,
`Portfolio(action:"trade")` must return `postTradeReadback` with same-runtime
cash, position, trade count, and last-trade evidence. Treat this as local paper
state only. It is not Xueqiu or broker execution. External Xueqiu buy/sell or
transfer still requires its own final confirmation. After a successful Xueqiu
write, inspect `postTradeReadback.readbackStatus`; `partial` means the write
response succeeded but external verification is incomplete.

## Entry rules

### Three default rules
1. **Do not chase**: avoid buying when price is more than 5% above MA5.
2. **Trade with trend**: prefer MA5 > MA10 > MA20 for long entries.
3. **Prefer volume contraction pullbacks**: the safest entries are pullbacks into support on lighter volume.

### Common entry patterns

#### 1. Volume-contraction pullback
- Uptrend intact
- Price pulls back near MA5 / MA10
- Volume contracts for several days
- RSI stays around 40-55

Useful checks:
```json
DataProcess(action: "indicators", symbol: "<code>")
DataProcess(action: "volume", symbol: "<code>")
DataProcess(action: "support", symbol: "<code>")
```

#### 2. Breakout entry
- Breaks a 20-day high
- Volume expands materially
- Closes strong
- MACD stays above the zero line

#### 3. Signal-confluence entry
- MACD bullish cross
- KDJ bullish cross
- Volume confirms

#### 4. Valuation-assisted entry
- Valuation below a reasonable historical median
- Positive catalyst such as earnings or policy support
- Technical structure not broken

#### 5. Panic-mispricing entry
- Primary trend is still up
- Sharp one-day selloff
- Panic volume
- No real fundamental damage after checking news

## Position sizing

### Risk-based sizing

```text
Max loss per trade = total assets x risk budget
Risk per share = entry price - stop price
Shares = max loss per trade / risk per share
Position weight = shares x entry price / total assets
```

Default risk budget: around **2% of account equity** per trade.

### Typical sizing bands

| Signal quality | Score | Position weight |
|---|---:|---:|
| Strong multi-factor setup | >= 80 | 15-20% |
| Medium setup | 60-79 | 10-15% |
| Weak setup | 50-59 | 5-10% |
| Exploratory | < 50 | 3-5% |

### Adjustments
- **Low volatility**: can size slightly higher
- **High volatility**: reduce size
- **High correlation**: cap total exposure to one sector or theme

## Stop and target management

### Stop logic
- **Fixed stop**: usually 7-8% below entry if no better structure exists
- **ATR stop**: stop = entry - 2 x ATR
- **Time stop**: if a trade does not work after a defined holding window, reduce or exit

### Target logic
- **Valuation target**: for example reaching sector median valuation
- **Technical target**: prior highs, Fibonacci levels, or measured-move objectives
- **Scale-out plan**: trim partial size at predefined profit levels and trail the remainder

### Trailing logic
- Activate a tighter trailing stop after meaningful profit
- Trail against MA10 / structure / ATR rather than arbitrary emotions

## Add / reduce rules

- Add only if the trade is already working and trend remains intact
- Each add should usually be smaller than the initial entry
- Recalculate blended stop and total account risk after every add
- Reduce on bearish signal clusters, failed breakout behavior, or target completion

## Monitoring setup

For pre-trade observation, if the user explicitly asks to set up monitoring,
create observation monitors after selecting the symbol. This is app-internal
observation state, not broker execution, so do not stop with a generic
confirmation question unless required fields are genuinely missing.

Use `Watchlist(add)` for the selected symbol first, then create one or more
template monitors:

```text
MonitorCreate(template:"price_alert", params:{ts_code:"600584.SH", name:"长电科技", lower:95, upper:110}, interval:"5m")
MonitorCreate(template:"change_alert", params:{ts_code:"600584.SH", name:"长电科技", threshold:7}, interval:"5m")
MonitorList()
```

For post-entry risk management, create explicit monitoring:

```text
MonitorCreate for stop-loss
MonitorCreate for target
MonitorCreate for trend deterioration / bearish signal flips
```

Prefer concrete threshold alerts over vague “watch closely” language.

## Exit and review

Typical flow:
1. `Portfolio(action:"trade", side:"sell", ...)`
2. `Watchlist(action:"exit", ...)`
3. remove now-stale monitors
4. `DataProcess(action:"ai_record", ...)`
5. later `ai_validate` to measure outcome quality

## Output expectation

When giving a trade plan, provide:
- entry logic
- invalidation / stop
- target or scale-out plan
- position size or weight
- what would make you wait instead of buy now

Avoid generic “looks good” / “can buy a little” advice without explicit numbers or conditions.
