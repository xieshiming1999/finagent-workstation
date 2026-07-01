---
description: Global macro-data workflow for rates, inflation, GDP, FX, and treasury yields using free or low-friction data sources.
when_to_use: User asks about macroeconomics, rates, inflation, CPI, GDP, FX, the dollar, treasury yields, rate cuts or hikes, M2, policy, asset allocation, or broad macro regime.
---
# Macro Data

## Source overview

| Source | Coverage | Auth | Notes |
|---|---|---|---|
| Econdb | Global macro indicators such as GDP, CPI, rates, employment, and trade | None | Free |
| Frankfurter | FX rates from ECB-backed data | None | Free |
| FRED | Federal Reserve data for rates, inflation, money supply, employment, and yield curves | API key | Highest-authority US macro source |
| Fed Treasury | US treasury yields and fiscal data | None | Official |

## 1. Econdb

Base: `https://www.econdb.com/api/series/`

| Metric | Series code | Notes |
|---|---|---|
| China GDP | `RGDPCN` | Real quarterly GDP |
| China CPI | `CPICN` | Consumer inflation |
| China PPI | `PPICN` | Producer inflation |
| China PMI | `PMICN` | Manufacturing PMI |
| China M2 | `M2CN` | Broad money |
| US GDP | `RGDPUS` | Real GDP |
| US CPI | `CPIUS` | Consumer inflation |
| US unemployment | `URATEUS` | Labor market |
| Euro Area GDP | `RGDPEA` | Real GDP |

Example:

```text
Research(action: "fetch", params: {url: "https://www.econdb.com/api/series/CPICN/?format=json"})
```

Search example:

```text
Research(action: "fetch", params: {url: "https://www.econdb.com/api/series/?search=china+interest+rate&format=json"})
```

## 2. Frankfurter FX

Base: `https://api.frankfurter.app`

Examples:

```text
Research(action: "fetch", params: {url: "https://api.frankfurter.app/latest?from=USD&to=CNY,HKD,EUR,JPY"})
Research(action: "fetch", params: {url: "https://api.frankfurter.app/2024-01-01?from=USD&to=CNY"})
Research(action: "fetch", params: {url: "https://api.frankfurter.app/2024-01-01..2024-12-31?from=USD&to=CNY"})
Research(action: "fetch", params: {url: "https://api.frankfurter.app/currencies"})
```

Typical use:
- Hong Kong market context through USD/HKD
- Northbound or foreign-flow context through USD/CNY
- Exporter analysis through RMB sensitivity

## 3. FRED

Base: `https://api.stlouisfed.org/fred/series/observations`

`FRED_API_KEY` should be set in Settings. If it is missing, skip FRED and use Econdb where possible.

| Metric | Series ID | Notes |
|---|---|---|
| Fed funds rate | `FEDFUNDS` | US policy rate |
| 10Y Treasury | `DGS10` | Risk-free anchor |
| 2Y Treasury | `DGS2` | Short-end rates |
| 2s10s spread | `T10Y2Y` | Inversion is recession-relevant |
| CPI | `CPIAUCSL` | Inflation |
| Core PCE | `PCEPILFE` | Fed-preferred inflation gauge |
| M2 | `M2SL` | Liquidity |
| Unemployment | `UNRATE` | Labor market |
| VIX | `VIXCLS` | Risk appetite |

Example:

```text
Research(action: "fetch", params: {url: "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&file_type=json&sort_order=desc&limit=30"})
```

## 4. Fed Treasury

Base: `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/`

Examples:

```text
Research(action: "fetch", params: {url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=10"})
Research(action: "fetch", params: {url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?sort=-issue_date&page[size]=10"})
```

## Analysis patterns

### A. Current Macro Regime

1. Econdb for China GDP, CPI, and PMI
2. Frankfurter for recent USD/CNY trend
3. FRED, if configured, for Fed funds, 10Y yields, and the 2s10s spread
4. Classify the environment as recovery, overheating, stagflation, or slowdown

### B. Macro links inside single-stock analysis

- exporters: FX trend
- leveraged property or capital-intensive names: rates
- cyclicals: GDP and PPI trend
- US or HK equities: DGS10 and VIX

### C. Asset-allocation context

1. 10Y Treasury trend for bond attractiveness
2. VIX and 2s10s for recession and risk appetite
3. USD/CNY and broad dollar direction for EM flow context
4. CPI trend for inflation and policy-turn expectations

## Guardrails

- Econdb and Frankfurter are usually delayed, not real-time
- FRED follows its release schedule, not daily updates
- Macro data is context, not the whole investment conclusion
- If no FRED key is configured, Econdb still covers a large part of normal use
