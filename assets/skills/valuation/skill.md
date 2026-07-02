---
description: Valuation workflow using DCF, comparable-company multiples, and football-field range summaries in FinAgent Workstation.
when_to_use: User asks for valuation, whether a stock looks expensive, target-price estimation, DCF, or comparable-company analysis in FinAgent Workstation.
---

# Valuation

## Core principle

Valuation is not about claiming one exact number. The goal is to establish a defensible range. Always cross-check with multiple methods because every single method carries structural bias.

## Method 1: Simplified DCF

Best for companies with stable earnings and reasonably predictable cash flow, such as consumer, healthcare, and utilities names.

### Inputs

```text
MarketData(action: "earnings", code: "<code>")
-> revenue, net profit, revenue growth, net margin

MarketData(action: "quote", code: "<code>")
-> share count, market cap
```

### Steps

1. Estimate free cash flow
- Simple shortcut: `FCF ~= net profit * 0.7`
- Better version: `FCF = operating cash flow - capex`

2. Estimate discount rate
- Risk-free rate from the 10-year China government bond
- Equity risk premium around 6%
- Beta from sector averages
- Typical A-share WACC range: 7% to 12%

3. Use a three-stage growth assumption

| Stage | Years | Growth source |
|---|---|---|
| High-growth | 1 to 3 | Broker consensus or 70% of trailing 3Y CAGR |
| Transition | 4 to 7 | Linear fade toward terminal growth |
| Terminal | 8+ | 2% to 3%, not above long-run GDP logic |

4. Compute terminal value
- `TV = FCF_n * (1 + g) / (WACC - g)`
- If terminal value dominates more than 80%, the near-term forecast is probably too conservative

5. Derive fair value
- Enterprise value from discounted cash flows plus discounted terminal value
- Fair price from fair equity value divided by share count

6. Always add sensitivity analysis

| WACC \\ Terminal growth | 2% | 2.5% | 3% |
|---|---|---|---|
| 8% | CNY XX | CNY XX | CNY XX |
| 9% | CNY XX | CNY XX | CNY XX |
| 10% | CNY XX | CNY XX | CNY XX |

### When DCF is a bad fit

- Loss-making companies
- Highly cyclical businesses
- High-growth names without earnings visibility

## Method 2: Comparable-company multiples

Best when there are listed peers in the same sector and growth stage.

### Workflow

```text
MarketData(action: "sector", code: "<code>")
-> peer candidates

MarketData(action: "quote", code: "comp1")
MarketData(action: "quote", code: "comp2")
MarketData(action: "quote", code: "comp3")
-> PE, PB, market cap for each peer

MarketData(action: "earnings", code: "comp1")
MarketData(action: "earnings", code: "comp2")
MarketData(action: "earnings", code: "comp3")
-> ROE, revenue growth, margin for each peer
```

### Choosing the multiple

| Sector type | Primary | Secondary | Notes |
|---|---|---|---|
| Consumer / healthcare | PE | PEG | Earnings are usually the cleanest anchor |
| Banks / property | PB | Dividend yield | Book value matters more |
| Tech / growth | PS or EV/Revenue | Forward PE | Revenue multiples help before earnings mature |
| Manufacturing / cyclicals | PB + normalized PE | EV/EBITDA | Bottom-cycle PE can be misleading |
| Utilities | Dividend yield | PE | Income stability matters |

### Calculation

```text
Target PE = peer median PE after removing outliers
Fair price = target EPS * target PE

Range:
- Bear case = P25 peer multiple * EPS
- Base case = median peer multiple * EPS
- Bull case = P75 peer multiple * EPS
```

### Peer-selection rules

- Same sub-sector
- Similar market-cap band, roughly 0.3x to 3x
- Similar growth stage
- Prefer 3 to 8 peers
- Remove ST names, loss-makers, and obvious outliers

## Method 3: Supporting checks

### PEG for growth stocks
- `PEG = PE / earnings-growth-rate`
- Less than 1 often suggests undervaluation

### Dividend-yield method
- `Fair price = annual DPS / target dividend yield`

### EV/EBITDA
- Useful for asset-heavy or debt-heavy businesses

## Summary range: football-field view

Use multiple methods to form a range, not a single answer.

```text
Method         | Bear --- Base --- Bull |
----------------------------------------
DCF            | 45 --- [52] --- 63     |
PE comparable  | 48 --- [55] --- 60     |
PB comparable  | 40 --- [47] --- 53     |
Dividend yield | 42 --- [46] --- 50     |
----------------------------------------
Composite      | 44 --- [50] --- 57     |
Current price  |       49 <-            |
```

### Decision rule

- Below the composite bear case: likely undervalued
- Inside the composite range: roughly fair
- Above the composite bull case: likely expensive

## Dashboard output

After completing the valuation, use the football-field dashboard template:

```text
Dashboard(template: "valuation")
-> fill CONFIG:
{
  "company": "Kweichow Moutai",
  "code": "600519",
  "currentPrice": 1680,
  "methods": [
    {"name": "DCF", "low": 1500, "mid": 1750, "high": 2100},
    {"name": "PE comparable", "low": 1600, "mid": 1800, "high": 1950},
    {"name": "PEG", "low": 1550, "mid": 1700, "high": 1900}
  ]
}
-> FileWrite {{DATA_DIR}}/memory/pages/valuation_<code>.html
-> UIControl(action: "addPage", params: {path: "{{DATA_DIR}}/memory/pages/valuation_<code>.html", title: "..."})
```

## Output format

```text
## Valuation: Kweichow Moutai (600519)

### DCF
- Assumptions: FCF CNY 65B, WACC 9%, terminal growth 2.5%, high-growth stage 12%
- Fair value: around CNY 1,750
- Sensitivity: CNY 1,500 to CNY 2,100

### Comparable PE
- Peers: Wuliangye, Luzhou Laojiao, Shanxi Fenjiu
- Median PE: 32x
- Target EPS CNY 56 * 32 = CNY 1,792
- Range: CNY 1,600 to CNY 1,950

### Composite view
| Method | Bear | Base | Bull |
|---|---|---|---|
| DCF | 1,500 | 1,750 | 2,100 |
| PE comparable | 1,600 | 1,792 | 1,950 |
| PEG | 1,550 | 1,700 | 1,900 |
| Composite | 1,550 | 1,747 | 1,983 |

Current price CNY 1,680 -> low end of the fair range -> rating: Accumulate

Disclaimer: model-driven valuation based on public data and assumptions only; not investment advice.
```
