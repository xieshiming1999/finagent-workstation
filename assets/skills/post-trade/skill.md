---
description: Post-trade automation for monitoring, validation, and review after entry
when_to_use: Use after the user buys or rebalances and needs follow-up monitoring, stop/target alerts, and later validation
---
# Post-Trade Automation

After a trade is executed, close the loop with three steps:

## Step 1: record the decision

```text
DataProcess(action: "ai_record",
  symbol: "<code>",
  direction: "<bullish/bearish/neutral>",
  priceAtAnalysis: <entry_or_analysis_price>,
  strategy: "<strategy_name>")
```

## Step 2: set monitoring

Pick a monitoring profile based on holding style:

| Style | Horizon | Target | Stop | Typical use |
|---|---|---|---|---|
| Short-term | 5 days | +5% | -3% | technical / event driven |
| Medium-term | 20 days | +10% | -7% | mixed fundamental + technical |
| Long-term | 60 days | +15% | -10% | value / trend follow |

### Example monitor

```text
MonitorCreate(
  name: "<stock> P&L monitor",
  schedule: "0 */1 * * *",
  source: { "type": "tool", "tool": "MarketData", "params": { "action": "quote", "symbols": ["<code>"] } },
  conditions: [
    { "field": "changePct", "op": ">", "value": <target_pct>, "message": "<stock> reached target" },
    { "field": "changePct", "op": "<", "value": <stop_pct_negative>, "message": "<stock> hit stop" }
  ],
  displayType: "value_card"
)
```

If Xueqiu paper trading is configured, position monitors can also query portfolio state directly.

## Step 3: delayed validation and reflection

Schedule a non-recurring validation task after the intended holding window:

```text
CronCreate(
  cron: "<future date/time>",
  prompt: "Run DataProcess(action:'ai_validate') and summarize what worked or failed.",
  recurring: false
)
```

## End-to-end example

1. run strategy / analysis
2. confirm user wants to trade
3. execute with `Portfolio` (and `XueqiuTrade` if configured)
4. move the symbol into entered state in `Watchlist`
5. record the decision with `ai_record`
6. create stop / target monitors
7. create a delayed `ai_validate` cron
8. tell the user exactly what is being watched

## Exit workflow

When the position is closed:

1. sell in `Portfolio`
2. sell in `XueqiuTrade` if relevant
3. mark exit in `Watchlist`
4. remove stale monitors
5. remove no-longer-needed delayed cron tasks

Do not leave dead monitors or validation cron jobs behind after exit.

## Output expectation

After post-trade automation, the user should know:
- what was recorded
- what stop / target monitors were created
- when the next validation will happen
- what needs manual confirmation later, if anything
