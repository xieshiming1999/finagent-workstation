---
description: RPS relative-strength ranking - approximate RPS by combining full-market DataTask screening with performance ranking, then find the strongest stocks
when_to_use: User asks for "the strongest stocks", "momentum ranking", "RPS stock picking", or "relative strength"
---

# RPS Relative Strength Ranking

## Concept

RPS (Relative Price Strength) is the percentile rank of a stock's price
performance versus the full market.

RPS >= 90 means the stock has outperformed 90% of stocks.

## Implementation

Approximate RPS using full-market screening plus ranking by performance:

```text
# Step 1: Submit a full-market screening task sorted by performance.
# By default it blocks until completion, failure, or timeout.
DataTask(action: "submit", type: "screen_advanced",
  conditions: [
    {"field": "CHANGE_RATE_120", "op": ">", "value": 0}
  ])

# Step 2: If the previous call returned a taskId because of timeout or block:false, read the result.
DataTask(action: "result", taskId: "<id>")

# Step 3: Take the top 10% as the RPS >= 90 candidate set.
-> Total count N, top N*10% names = RPS 90+
```

## Simplified version without DataTask

Use sector ranking directly to find strong names:

```text
MarketData(action: "sector", boardType: "industry")
-> take the top 5 sectors by performance
-> take the top 3 names from each sector
-> those are the approximate "strongest" stocks
```

## Combine with stock selection

RPS >= 90 plus price near new highs is usually the best momentum setup:

```text
# After screening, do one more check.
DataProcess(action: "indicators", symbol: "<code>")
-> Is price above 90% of the 120-day high?
-> If yes, add it to Watchlist for further observation
```
