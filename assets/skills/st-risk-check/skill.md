---
description: ST risk warning workflow for checking whether an A-share company faces ST, *ST, or delisting risk.
when_to_use: User asks whether a stock is risky, whether it may become ST, or whether there is delisting risk.
---

# ST Risk Check

Check whether an A-share company faces ST / *ST treatment or delisting risk.

## Detection dimensions

### Quantitative checks (R1-R4)

```text
MarketData(action: "earnings", code: "<code>")
```

| Dimension | What to inspect | Risk trigger |
|---|---|---|
| **R1 Revenue + profit** | recent revenue and net income | revenue below 100 million RMB and net income below 0 |
| **R2 Net assets** | latest net assets per share | net assets per share below 0 |
| **R3 Consecutive losses** | recent annual profitability | net income negative for the last two annual reports |
| **R4 Revenue threshold** | annual revenue trend | revenue below 100 million RMB for two consecutive annual reports |

### Qualitative evidence (E1-E3)

```text
Research(action: "news", query: "<company> audit penalty delisting")
MarketData(action: "quote", code: "<code>")
```

| Dimension | What to inspect | Risk signal |
|---|---|---|
| **E1 Audit opinion** | financial-statement audit opinion | qualified, adverse, or disclaimer opinion |
| **E2 Regulatory action** | CSRC / exchange penalties | recent major enforcement or penalty |
| **E3 Price / market cap** | face-value delisting risk | share price below 1 RMB or persistently near that level |

## Risk levels

| Level | Condition | Guidance |
|---|---|---|
| **Very high** | R3 plus R1 | avoid immediately; strong *ST risk |
| **High** | R1 or R2 plus E1/E2 evidence | strong avoidance case |
| **Medium** | R1 close to the threshold or E3 signal | stay cautious and monitor closely |
| **Low** | all dimensions normal | no immediate ST warning |

## Recommended usage

Run ST risk checks automatically for A-share analysis with a bounded first
pass. Do not spend calls on interface catalogs, data-health summaries,
environment/config inspection, or provider-discovery routes unless the user
explicitly asks for provider diagnostics.

```text
DataStore(action: "query_quote", code: "<code>")
DataStore(action: "query_fundamental", code: "<code>")
DataStore(action: "query_stock_company_info", code: "<code>")
```

If local fundamentals are missing, make one focused `MarketData(action:
"earnings", code: "<code>")` or equivalent governed fetch for the same code,
then answer from the returned financial evidence. If company/risk profile rows
are missing, state that the qualitative evidence is unavailable instead of
probing Wind/Tushare credentials or broad provider capability tables. Use
`Research(action:"news", ...)` only when the user asks for regulatory/news
verification or when the quantitative result is not enough to classify the
risk.

Inspect the last four periods for persistent losses, weak revenue, or negative
net assets. Combine with quote data to see whether price is approaching
face-value delisting risk.

Expected output shape:

```text
ST risk level: low / medium / high / very high
Triggered items: ...
```

## Strategy integration

- **Stock picking**: exclude names with ST risk at `high` or above
- **Portfolio review**: re-check ST risk on held names periodically
- **Watchlists**: label monitored names with the current ST risk level

## Special cases

- Beijing Exchange ST rules differ; this workflow does not cover them fully
- ChiNext (`300`) and STAR (`688`) boards have board-specific revenue-rule details
- The value of this check is early warning before an ST label is formally applied
