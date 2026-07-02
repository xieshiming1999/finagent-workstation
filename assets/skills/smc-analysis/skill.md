---
description: Smart Money Concepts workflow for detecting institutional behavior through ChoCH, BOS, FVG, and related structure signals.
when_to_use: User asks what institutions are doing, wants Smart Money Concepts analysis, or asks for market-structure change detection.
---

# Smart Money Concepts

Use market-structure signals to infer institutional behavior and likely intent.

## Core concepts

| Signal | Meaning | Priority |
|---|---|---|
| **ChoCH** (Change of Character) | structure reversal; trend direction changes | highest |
| **BOS** (Break of Structure) | structure continuation; trend confirmation | medium |
| **FVG** (Fair Value Gap) | imbalance zone that price may revisit | direction filter |
| **Order Block** | institutional accumulation/distribution zone | entry zone |
| **Liquidity Sweep** | stop-hunt followed by reversal | reversal signal |

## Detection workflow

Use the existing tools in combination:

```text
# 1. get K-line data
MarketData(action: "kline", symbols: ["600519"], period: "daily", startDate: "2025-01-01")

# 2. get supporting structure and trend signals
DataProcess(action: "trend", symbol: "600519")
DataProcess(action: "support", symbol: "600519")
DataProcess(action: "pattern", symbol: "600519")
DataProcess(action: "volume", symbol: "600519")
```

## SMC logic

### ChoCH detection

**Bullish ChoCH**: in a downtrend, price breaks the prior rebound high and indicates a structural reversal.
- condition: MA20 still reflects a downtrend
- signal: latest close > previous rebound high
- confirmation: volume expansion, for example relative volume > 1.5

**Bearish ChoCH**: in an uptrend, price breaks the prior pullback low and indicates a structural reversal.
- condition: MA20 still reflects an uptrend
- signal: latest close < previous pullback low
- confirmation: expanding downside volume

### BOS detection

**Bullish BOS**: in an uptrend, price makes a new structural high.
- close > previous swing high
- moving-average alignment still confirms the uptrend

**Bearish BOS**: in a downtrend, price makes a new structural low.

### FVG detection

- three-candle rule: candle 1 high < candle 3 low indicates a bullish FVG
- when price revisits the FVG zone, treat it as a possible entry area

### Order Block detection

- identify the high-volume candle zone near the start of a directional move
- a pullback into that zone can mark institutional support or resistance

## Trading interpretation

| Setup | Signal | Action |
|---|---|---|
| Bullish ChoCH + bullish FVG | strong buy setup | wait for a pullback into the FVG zone |
| Bullish BOS without ChoCH | medium-strength buy | treat as trend continuation and scale in with the trend |
| Bearish ChoCH | sell / hedge / short bias | treat as reversal risk and reduce exposure |
| No ChoCH and no BOS | wait | structure is still unclear |

## How to use SMC with stock picking

SMC is not a stock-selection framework. Use it for **timing**:

1. use `stock-picking` to choose candidates
2. run SMC analysis on the candidates
3. if ChoCH or BOS aligns with FVG and volume, propose concrete entry levels
