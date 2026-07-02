---
description: Earnings-review workflow for listed companies that pulls financial data, judges beat versus miss, and produces a structured HTML report in the dashboard.
when_to_use: User asks for an earnings review, financial-report analysis, quarterly or annual earnings commentary, or an earnings beat/miss read.
---

# Stock Earnings Review

## Data retrieval

```text
# 1. Financial metrics for the latest four periods
MarketData(action: "earnings", code: "601012")

# 2. Live market snapshot
MarketData(action: "quote", code: "601012")

# 3. Optional technical snapshot
DataProcess(action: "summary", code: "601012")
```

## Beat / miss judgment

The core job is to judge whether earnings came in above, in line with, or below expectation. Do not reduce the task to pure year-over-year growth commentary.

### Logic

```text
MarketData(action: "earnings", code: "<code>")
-> gather at least the latest four reporting periods

Research(action: "search", query: "<company> earnings guidance consensus estimate")
```

### Surprise factor

- If a consensus estimate exists:
  - `Surprise = (actual - expected) / |expected| * 100%`
- If no consensus estimate exists:
  - compare current growth against the recent trend
  - example: prior three periods of 10%, 12%, 15% imply a trend expectation around 17%
  - actual 25% -> Beat
  - actual 8% -> Miss

### Judgment thresholds

| Surprise | Judgment | Label |
|---|---|---|
| above +10% | strong upside surprise | Strong Beat |
| +3% to +10% | modest upside surprise | Beat |
| -3% to +3% | roughly in line | In-line |
| -10% to -3% | modest downside surprise | Miss |
| below -10% | major downside surprise | Strong Miss |

### Variance table

Always produce a variance table comparing the current period, the prior period, and the same period last year.

Example:

| Item | Current | Prior period | YoY comparable | QoQ change | YoY change | Verdict |
|---|---|---|---|---|---|---|
| Revenue | 22.8B | 21.0B | 20.0B | +8.6% | +14% | Beat |
| Net profit | 8.0B | 5.2B | 4.4B | +54% | +82% | Strong Beat |
| Gross margin | 81.4% | 80.9% | 80.5% | +0.5pp | +0.9pp | Beat |
| Operating cash flow | -2.5B | 4.0B | 3.0B | - | - | Miss |

## Earnings-quality check

A beat is not automatically good quality. Check:

- revenue beat but cash-flow miss
- profit beat but revenue miss
- profit beat but gross margin deterioration
- broad beat with weakening advance receipts or other forward indicators

## Analysis dimensions

After retrieving the data, review:

1. beat or miss judgment
2. revenue trend and drivers
3. profit trend and margin trend
4. quality of earnings
5. operating efficiency
6. financial safety
7. 3 to 5 highlights plus 2 to 3 risk points
8. valuation implications, with reference to the `valuation` skill

## Report generation

### Steps

```text
Dashboard(template: "report")

# Build CONFIG

FileWrite(file_path: "{{DATA_DIR}}/memory/pages/reports/earnings_<code>_<date>.html", content: ...)

UIControl(action: "addPage", params: {
  "title": "<company><period> earnings review",
  "file": "{{DATA_DIR}}/memory/pages/reports/earnings_<code>_<date>.html",
  "tag": "report"
})
```

### CONFIG shape

Use sections such as:
- KPI cards for beat/miss summary
- KPI cards for core metrics
- variance table
- efficiency and safety KPI block
- recent-period summary table
- highlight section
- risk section
- recommendation text
- final verdict block

## Section types

| type | Purpose | Required fields |
|---|---|---|
| `kpi` | metric-card grid | `items`, `cols` |
| `table` | structured table | `headers`, `rows` |
| `highlight` | highlight or risk list | `items`, `icon`, optional `risk` |
| `text` | narrative block | `content` |
| `verdict` | final rating | `value`, `color`, `label`, `sub` |
