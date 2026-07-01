---
description: Advanced condition scanner that combines multiple filters with AND/OR logic to build composite stock-selection rules.
when_to_use: User asks for complex screening, multi-indicator filters, or composite technical/fundamental conditions.
---

# Advanced Scanner

Use this when a simple `screen` pass is not enough. The goal is to combine screening logic with indicator follow-up checks.

## Preset strategy templates

### 1. Oversold rebound

```text
DataProcess(action: "screen", conditions: [
  {"field": "changePct", "op": "<", "value": -3},
  {"field": "pe", "op": ">", "value": 0},
  {"field": "pe", "op": "<", "value": 30}
], sortBy: "changePct", limit: 20)
```

Then inspect candidates one by one:
- `RSI < 30`
- `MA20` is still rising
- volume is shrinking rather than collapsing on panic

### 2. Price-volume breakout

Conditions:
- daily gain greater than 3%
- volume ratio greater than 2
- breakout above the 20-day high
- `MACD` above the zero line

For a bounded breakout shortlist, use the stock-picking candidate sources and
then validate the selected codes with one `DataProcess(action:"breakout_summary")`
call. Do not inspect every candidate one by one with separate indicator,
money-flow, company-info, or support calls before producing the first answer.

### 3. Value plus momentum

AND conditions:
- `PE < 20` and `PE > 0`
- `ROE > 15%`
- positive 20-day return
- 5-day volume ratio above 1

### 4. High-dividend, low-volatility

Conditions:
- dividend yield above 3%
- `PE < 15`
- annualized volatility below 30%
- continuous dividends for more than 3 years

### 5. Dual golden cross: MACD plus KDJ

```text
DataProcess(action: "indicators", symbol: "<code>")
-> macd_cross == "golden_cross" AND kdj_j < 80
-> volume ratio also above 1
```

## Building composite logic

The agent should translate the user request into explicit conditions.

```text
Interpretation pattern:
  AND:
    - RSI(14) < 30
    - MA20 > MA60
    - not currently limit-down

Execution:
  1. Coarse screen first, for example PE > 0 and turnover > 100M
  2. Run indicator checks on the shortlist
  3. Rank and explain the output
```

## Relationship to stock-picking

`advanced-scanner` is a tool-level enhancement for the candidate-discovery stage:
- `stock-picking` decides where candidates come from
- `advanced-scanner` decides how to filter them
- `analysis-standards` decides how to score and judge them
