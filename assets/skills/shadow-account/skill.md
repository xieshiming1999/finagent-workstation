description: Shadow Account - extract profitable trading patterns from a user's history, quantify behavioral bias, and improve trading discipline
when_to_use: User asks "what is wrong with my trading", "analyze my trade history", or "what is my profitable pattern"
---

# Shadow Account

Extract profitable patterns from the user's trade history, quantify behavioral bias, and generate concrete improvement suggestions.

## Data Sources

```
# Get trade history from Xueqiu
XueqiuTrade(action: "history")
# Or from local paper-trading history
Portfolio(action: "history")
```

## Analysis Flow

### Step 1: Pair trades into round trips

Pair buy -> sell actions into complete round trips:
- Matching rule: a buy and the later sell of the same stock
- Record per round trip: entry time/price, exit time/price, holding days, P&L %

### Step 2: Split winners and losers

Split into two groups:
- **Winning trades**: sell price > buy price
- **Losing trades**: sell price < buy price

### Step 3: Extract patterns

Analyze winning trades:
- Average holding period: how long do winners usually run?
- Average profit: how much do they usually make before exit?
- Entry timing preference: when does the user tend to buy?
- Type preference: what kind of names work best?

Analyze losing trades:
- Average holding period: how long does the user hold before accepting a loss?
- Average loss magnitude: how large are losses at exit?
- Is there a "buy more as it drops" averaging-down habit?

### Step 4: Quantify behavioral bias

| Bias | Detection rule | Meaning |
|------|---------|------|
| **Disposition effect** | Average hold time for winners < losers | Take gains too fast, hold losses too long |
| **Overtrading** | Average holding period < 5 days | Too much churn, fees erode returns |
| **Chasing strength** | Buy price deviates > 5% above MA5 | Often buying too high |
| **No stop discipline** | More than 50% of losing trades lose over 10% | Stops are not enforced |
| **Concentration risk** | Single-name exposure > 30% | Too much capital in one basket |

### Step 5: Generate actionable advice

Based on the analysis, produce concrete suggestions:

```
## Your Trading Profile

📊 25 trades total, win rate 52%
✅ Winning trades: average +8.3%, average hold 12 days
❌ Losing trades: average -11.2%, average hold 28 days

## Detected Pattern

🎯 Profitable pattern: entries on pullbacks with shrinking volume show the highest win rate (73%)
⚠️ Problem: clear disposition effect (winners held 12 days vs losers held 28 days)

## Recommendations

1. Add a stop: losing trades average -11.2%, so consider a fixed 8% stop
2. Let winners run longer: do not exit profitable trades too early; try a trailing stop
3. Pullback on shrinking volume is a real edge; lean on that entry pattern more often
4. Reduce chasing: win rate drops to 30% when entries are more than 5% above MA5
```

## Integration with Strategy Workflows

Shadow Account analysis should be recorded into memory:
```
DataProcess(action: "ai_record",
  symbol: "portfolio",
  direction: "neutral",
  strategy: "shadow_account",
  priceAtAnalysis: 0)
```

Future trade decisions should reuse these findings:
- "The user performs well on pullbacks with shrinking volume" -> recommend that setup
- "The user tends to chase strength" -> remind them not to buy too far above MA5
