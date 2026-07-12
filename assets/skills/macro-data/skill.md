---
description: Global macro-data workflow for rates, inflation, GDP, FX, and treasury yields using free or low-friction data sources.
when_to_use: User asks about macroeconomics, rates, inflation, CPI, GDP, FX, the dollar, treasury yields, rate cuts or hikes, M2, policy, asset allocation, or broad macro regime.
---
# Macro Data

## Macro Watchlist Writes

If the user explicitly asks to write macro risk, policy, rate, liquidity,
commodity, or research conditions into a watchlist or observation list, this is
a state-changing watchlist workflow, not an explanation-only macro answer.

1. Read the governed macro evidence first with the relevant
   `query_macro_factors`, `query_macro_attribution`, and news/source readback.
2. Load `Skill(skill:"watchlist")`.
3. Call `Watchlist(action:"add", type:"macro-condition", name:"...",
   entryCondition:"...", source:"...")`.
4. Read back with `Watchlist(action:"list", type:"macro-condition",
   status:"watching")`.
5. In the final answer, state the created/read-back ids and that macro/news
   context is observation evidence, not an executable buy/sell trigger.

The `source` field should preserve evidence tier or source quality, refresh
policy, missing evidence, and data/source time when available.

## Source overview

| Source | Coverage | Auth | Notes |
|---|---|---|---|
| Econdb | Global macro indicators such as GDP, CPI, rates, employment, and trade | Availability varies | Use only as diagnostic/fallback; treat 401/403 as unavailable |
| Frankfurter | FX rates from ECB-backed data | None | Free |
| FRED | Federal Reserve data for rates, inflation, money supply, employment, and yield curves | API key | Highest-authority US macro source |
| Fed Treasury | US treasury yields and fiscal data | None | Official |

## 1. Econdb diagnostic fallback

Base: `https://www.econdb.com/api/series/`

Recent live workflow evidence shows this service can return `401` without
usable anonymous access. Do not treat it as a guaranteed free source. Use it
only after governed readback and preferred official/free sources are
insufficient, and stop after one `401`/`403` response.

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

`FRED_API_KEY` should be set in Settings. If the key is missing, unknown, or
not visible in the current tool result, skip FRED and use governed factor
readback, BEA/Fed Treasury/Frankfurter, or cached rows where possible. Never
call a FRED URL with an empty `api_key=` parameter; record FRED as unavailable
instead of spending a failing request. Do not assume Econdb anonymous access is
available.

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

### A0. Governed factor readback

Before broad market, stock, fund, or strategy-preparation analysis where macro
forces may matter, inspect the workflow contract first:

```text
Runbook(action: "get", workflow: "macro_factor_lookup")
```

Then read the governed factor layer:

```text
DataStore(action: "query_macro_factors", target: "Copper", limit: 10)
DataStore(action: "query_macro_factors", regions: "Indonesia", family: "index_classification", limit: 10)
DataStore(action: "query_macro_factors", assets: "bond funds", family: "rates_liquidity", limit: 10)
```

Use returned `market_moving_factor_v1` rows as cited context with source time,
fetched time, source, status, affected assets, and transmission channel. If the
result returns `status:"missing"`, state that the current factor layer has no
matching evidence instead of assuming macro factors are irrelevant.

Macro factors are context for analysis. They are not executable buy/sell
signals and should not be converted into StrategySpec conditions unless a later
strategy contract explicitly supports that factor type.

If the requested output is a reviewable macro report, dashboard, artifact, or
panel, first collect or read back at least one governed macro evidence source.
Then create typed workflow state, register the durable output, and run the
verifier before the final answer. `evidenceRefs` must be non-empty and should
name actual evidence/readback keys used in the turn:
Use `ArtifactRegistry` for this durable report/dashboard record. Do not use
`UIControl`, `WebView`, or raw `memory/pages/*.html` as a substitute unless the
user explicitly asks to open or render a visual page.

```text
FinanceWorkflowState(action: "save", workflowKind: "macro_factor_lookup",
  assetClass: "mixed", intentMode: "analysis", executionMode: "none",
  confirmationState: "none",
  safetyBoundary: "macro evidence is context and invalidation input, not a direct buy/sell rule",
  evidenceRefs: ["query_macro_factors", "query_macro_attribution", "query_macro_research_evidence"],
  requiredArtifacts: [{"kindAnyOf":["report","dashboard"],
    "requiredFields":["topic","sourceDataTime","fetchedAt","missingEvidence","confidenceEffect","affectedAssets"]}],
  requiredVerifier: {"tool":"WorkflowVerifier","action":"check","workflow":"macro_factor_lookup"})
```

```text
ArtifactRegistry(action: "register", kind: "report", title: "...", source: "macro workflow", metadata: {...}, provenance: {...}, freshness: {...})
```

Run `WorkflowVerifier(action:"check", workflow:"macro_factor_lookup")` after
the report/dashboard artifact is registered, not before.

The artifact metadata/provenance/freshness must include the structured macro
evidence that affects the conclusion: topic, source time, fetched-at time,
freshness or missing-evidence status, affected assets/sectors, confidence
effect, and failure class when present. Do not rely on chat text alone for a
requested reviewable macro report or dashboard.

### A0.1 Root-cause attribution

When the user asks why a market, stock, fund, or strategy result may be moving,
build attribution from governed evidence instead of prompt text:

```text
DataStore(action: "query_macro_attribution", target: "Copper", limit: 10)
DataStore(action: "query_macro_attribution", regions: "Indonesia", family: "index_classification", limit: 10)
DataStore(action: "query_macro_attribution", assets: "bond funds", family: "rates_liquidity", limit: 10)
```

Use the returned category, evidence, confidence, missingEvidence,
invalidationCondition, and nextUpdateAction. Treat attribution as hypothesis
and workflow context. It can define strategy assumptions or watch conditions,
but it is not a direct trading signal.

For a stock, fund, ETF, watchlist, or strategy question, macro attribution is
not a substitute for the base asset evidence. First read the governed asset
layer that matches the subject, then read macro factors and attribution, then
answer with the two layers separated:

```text
DataStore(action: "query_quote", code: "<stock code>", limit: 5)
DataStore(action: "query_kline", code: "<stock code>", limit: 60)
DataStore(action: "query_fundamental", code: "<stock code>", limit: 10)
DataStore(action: "query_macro_factors", target: "<asset or theme>", assets: "<asset class>", limit: 10)
DataStore(action: "query_macro_attribution", target: "<asset or theme>", assets: "<asset class>", limit: 10)
```

Do not call `interface_describe` with invented macro ids such as
`market.macro_factors`. Macro evidence is exposed through the concrete actions
above plus `macro_research_sources`, `query_macro_research_evidence`, and
`query_macro_research_content`.

If the user gives a stock name but not a code, resolve the symbol through the
governed local stock list/search path before the macro answer, then read
`query_quote`. Do not answer a named-stock macro/news question from macro rows
alone.

For funds, use the fund readbacks instead of stock quote/fundamental readbacks,
for example `query_fund_nav`, `query_fund_money_yield`,
`query_fund_performance`, `query_fund_holding`, and
`query_fund_company_info`. If any base asset layer is missing, state that as an
asset-data gap; do not let a macro-only answer appear complete.

### A0.2 Official numeric series readback

When the answer needs an official number, use the numeric-series readback
instead of extracting numbers from research prose. If the available provider
or credential status is unclear, inspect the catalog first:

```text
DataStore(action: "macro_numeric_series_catalog", provider: "bea", limit: 10)
DataStore(action: "macro_numeric_series_catalog", status: "credential-gated", limit: 20)
DataStore(action: "macro_numeric_series_catalog", seriesId: "DGS10", limit: 5)
```

The catalog returns supported, credential-gated, cache-readback, and
security-controlled series with provider, seriesId, metricName, credentialKey,
sourceUrl, nextAction, and the `macro.official_series` provenance contract.
Use it to explain why a numeric source can be refreshed, must use cache, needs
configuration, or requires browser/manual validation.

After catalog/readback selection, use:

```text
DataStore(action: "query_macro_numeric_series", provider: "fred", target: "DGS10", limit: 5)
DataStore(action: "query_macro_numeric_series", provider: "bea", target: "GDP", limit: 5)
DataStore(action: "query_macro_numeric_series", provider: "bls", target: "CPI", limit: 5)
DataStore(action: "query_macro_numeric_series", provider: "world_bank", target: "NY.GDP.MKTP.CD", limit: 5)
DataStore(action: "query_macro_numeric_series", provider: "imf", target: "NGDP_RPCH", limit: 5)
DataStore(action: "query_macro_numeric_series", provider: "eia", target: "WCESTUS1", limit: 5)
```

`query_macro_numeric_series` returns seriesId, metricName, value, unit,
sourceDataTime, releaseDate, fetchedAt, provider, status, and provenance. Use
it for BEA/FRED/BLS/EIA/OECD/IMF/World Bank/Wind-style facts. If it returns
`status:"missing"`, state that official numeric evidence is missing or stale
and then inspect source/config status; do not infer a number from a research
article or API documentation page.

Do not loop through numeric-series candidates in a first-pass forward-looking
answer that asks what to watch rather than asking for current numeric values.
Name missing numeric evidence as a gap and answer from source/evidence rows.

EIA v2 calls require `EIA_API_KEY`. If the key is missing, treat EIA as
credential-gated and cite the gap; do not retry anonymous EIA URLs.

### A1. Governed research and report extraction

When the user asks what public research, index-provider documents, commodity
reports, or official source pages say about a macro driver, use the governed
macro research contract before direct browsing:

```text
DataStore(action: "macro_research_sources", provider: "goldman_sachs", limit: 5)
DataStore(action: "macro_research_extraction_status", provider: "goldman_sachs")
DataStore(action: "macro_research_extract", provider: "goldman_sachs", limit: 1)
DataStore(action: "query_macro_research_content", provider: "goldman_sachs", limit: 5)
DataStore(action: "query_macro_research_evidence", provider: "goldman_sachs", limit: 5)
```

### A1.1 News refresh and readback

When the user explicitly asks to refresh an allowed macro source or news
source, perform one governed refresh and then read back persisted/classified
rows before answering. For a news refresh, the bounded path is:

```text
DataStore(action: "finance_news", query: "宏观 政策 市场", limit: 20)
DataStore(action: "query_finance_news", query: "宏观 政策 市场", limit: 10)
DataStore(action: "query_macro_factors", target: "A-shares", limit: 10)
DataStore(action: "query_macro_attribution", target: "A-shares", limit: 10)
```

The final answer must say which source was refreshed, what was read back, the
source/provider, source time, fetched time, evidence tier, and any failure
classification. News remains a current-event clue unless linked to official
data or content-backed research evidence.

For copper and commodity questions, start with sources already represented in
the macro research catalog, such as Goldman Sachs, JPMorgan, BlackRock, PIMCO,
EIA, and LME. For index/passive-flow questions, start with MSCI and
FTSE Russell/LSEG.

Use the macro research catalog as a subject router, not as a generic news list:

| User intent | Governed evidence family | Preferred first step |
|---|---|---|
| commodity, energy, oil, metals, inventory shock | `macro_commodity_event` or `macro_research_document` | `macro_research_sources` by category, then extraction status/content readback |
| rates, liquidity, inflation, credit, bond funds | `macro_official_series` or `macro_research_document` | `query_macro_factors`, then official series/source evidence |
| GDP, employment, consumption, country risk | `macro_official_series` | official numeric readback first; research articles only explain expectations |
| FX, dollar liquidity, cross-border capital flow | `macro_official_series` or `macro_policy_event` | factor readback plus official source evidence |
| index classification, rebalancing, passive flow | `macro_index_event` | source/evidence readback for MSCI, FTSE/LSEG, S&P DJI, STOXX, Nasdaq |
| China policy, liquidity, regulation, exchange rules | `macro_policy_event` | source/evidence/content readback for PBOC, NBS, CSRC, SAFE, exchanges |
| asset allocation regime or strategy invalidation | `macro_research_document` plus numeric facts | content readback, then separate assumptions from executable strategy rules |

Prefer category/family filters over provider-by-provider loops. For example,
commodity or copper first pass should start with one ranked source query:

```text
DataStore(action: "macro_research_sources", category: "commodity_research", priority: 1, limit: 5)
DataStore(action: "query_macro_research_evidence", family: "commodity_research", target: "Copper", limit: 10)
DataStore(action: "query_macro_research_content", family: "commodity_research", target: "Copper", limit: 5)
```

Index/passive-flow first pass should do the same with
`category:"index"` / `family:"index_classification"` instead of querying MSCI,
FTSE, S&P DJI, STOXX, and Nasdaq one by one. Choose one follow-up extraction
only if the readback shows content is missing for the most relevant source.

If `query_macro_research_content` or `query_macro_research_evidence` returns
rows for the requested commodity/index family, answer from those rows. Do not
call extraction status, repeat extraction, numeric series, or adjacent target
queries in the same first pass unless the user explicitly asks for current
numbers or article-level extraction. Missing copper price, inventory, PMI, or
policy rows should be listed under "证据缺口" instead of triggering another
tool loop.

Direct `WebFetch`, `WebView`, or `Research` is not the normal first path for
these sources. Use it only when the catalog or extraction status says a
browser/API handoff is the allowed path, or when the user explicitly asks for
manual browsing. If a source is anti-bot, manual-browser-only, licensed-needed,
or do-not-scrape, report that limitation and use `query_macro_research_evidence`
instead of retrying the blocked page.

If source catalog, provenance, evidence, and content readback already identify
the relevant provider/source, answer from those rows. Do not use
`Research(search)` to find one more date or confirmation in a first-pass
governed macro answer. If exact timing is absent from governed rows, state it
as missing or uncertain evidence.

`query_macro_research_content` returns a `contentEvidence` array for normal
answers: title, source, source date, fetched time, key claims, body preview,
content hash, affected assets/regions/sectors, and limitation. Use that field
instead of opening `artifactPath`. `artifactPath` is diagnostic and
source-maintenance evidence only; do not use `Glob`, `Read`, `LS`, local file
inspection, or `.tool_outputs` to inspect macro content files in a first-pass
analysis/risk-appetite/root-cause/fund/stock/strategy-context answer.

### A2. Controlled direct-source fallback

The agent should know the basic macro source map even when the code-backed
provider route is incomplete or temporarily failing. This is not a replacement
for provenance. It is a fallback decision layer for explicit source-update
workflows. A first-pass analysis, risk-appetite, root-cause, fund, stock, or
strategy-context answer should normally report the missing source/update action
and stop; missing governed rows alone are not permission to browse.

If the governed macro API path fails, returns `status:"missing"`, or has no
content-backed row for a source that the catalog marks as publicly retrievable,
the agent may make one bounded direct retrieval attempt using the source's
official URL from `macro_research_sources` only when the user explicitly asks
to refresh, validate, broaden live sources, or inspect a source page.

Use this fallback only after checking:

```text
DataStore(action: "macro_research_sources", provider: "<provider>", limit: 5)
DataStore(action: "macro_research_extraction_status", provider: "<provider>")
DataStore(action: "query_macro_research_evidence", provider: "<provider>", limit: 5)
DataStore(action: "query_macro_research_content", provider: "<provider>", limit: 5)
```

Fallback rule by access class:

| Catalog access class / status | Allowed fallback | Stop condition |
|---|---|---|
| `public-html`, `public-html-and-pdf`, `official-public-source` | `Research(fetch)` or `WebFetch` on the official URL; then cite title/date/url/hash when available | Stop after one failed HTTP/provider attempt |
| `official-api`, `official-api-and-public-report` | Use the official API route if configured; otherwise report missing key/config | Stop on missing credential or first API error |
| `browser-public`, `browser-or-official-api`, `browser-ua-http-readable` | Use WebView/browser path when available; otherwise explain browser requirement | Stop if browser path is unavailable |
| `anti-bot-manual-browser`, `manual-browser-only` | Do not automate repeated fetches; ask for user-provided/manual evidence or use existing evidence rows | Stop immediately |
| `licensed-needed`, `security-blocked`, `do-not-scrape` | Do not fetch directly; report the limitation and use existing evidence only | Stop immediately |

Basic source knowledge for fallback:

| Subject | Preferred sources to inspect first |
|---|---|
| China monetary policy/liquidity | PBOC, then SAFE for FX/cross-border context |
| China statistics/growth/prices | NBS China, then World Bank/IMF/OECD for cross-country context |
| China capital-market rules | CSRC, SSE, SZSE, HKEX |
| Index/passive-flow events | MSCI, FTSE Russell/LSEG, S&P DJI, STOXX, Nasdaq |
| Rates/credit/allocation regime | PIMCO, BlackRock, Vanguard, State Street, FRED/BLS/BEA |
| Commodities/energy | EIA, LME, IEA, OPEC, CME, Goldman Sachs, JPMorgan |
| FX/dollar/cross-border flow | FRED, IMF, OECD, SAFE, JPMorgan, Goldman Sachs |
| Global growth/country risk | IMF, World Bank, OECD, BEA, regional central banks, public bank outlooks |
| Inflation/labor shocks | BLS, BEA, FRED, central-bank reports, public bank outlooks |
| Credit/liquidity stress | FRED, central banks, PIMCO, BlackRock, JPMorgan, State Street |
| Asset-allocation regime | BlackRock, PIMCO, Vanguard, State Street, major public bank outlooks |
| Supply-chain/geopolitical shocks | Official agencies first, then public research from index providers or banks |

Source-specific fallback playbook:

| Provider | Direct source knowledge | Retrieval boundary |
|---|---|---|
| Goldman Sachs | Public Insights pages are useful for macro outlook, commodities, labor, inflation, and rates context. Start from catalog URLs or official topic pages, not generic search. | Public HTML can be inspected once; full institutional research may be licensed. |
| MSCI | Market classification pages, press releases, and official PDFs are high-value index/passive-flow evidence. | Prefer official PDFs when the HTML page is browser-heavy or challenge-gated. |
| JPMorgan | Public Insights pages can provide outlook and commodity context. | Treat as public insight, not full client research. |
| BlackRock / PIMCO | Public outlook pages are useful for allocation regime, rates, credit, and liquidity assumptions. | Regional pages may vary; cite exact URL and retrieved time. |
| EIA | Official API documentation and v2 endpoints are the normal energy numeric path. Current governed series includes `WCESTUS1` for US commercial crude inventories. | Requires `EIA_API_KEY` for live API calls; without key, record credential-gated status. |
| OECD | A narrow official SDMX path is governed for quarterly OECD real GDP growth; broader datasets still require dataset/key discovery before use. | Use the governed readback for `DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM`; do not guess other SDMX keys. |
| IEA / OPEC | Monthly oil reports and energy outlook pages are source-worthy. | May require browser anti-bot input; do not loop automated fetches. |
| LME / CME | Useful for commodity price/inventory/futures context. | LME may be browser-readable; CME can be manual-browser or official-data-delivery only when automation is blocked. |
| PBOC / SAFE / NBS / CSRC / exchanges | Official China policy, FX, statistics, securities regulation, and exchange rule pages are primary evidence. | Prefer official pages and date-bearing notices; promote only after parser/date mapping is known. |
| NBS data releases | Official China growth, price, PMI, industrial, retail, property, and production-material release pages. | The release list can expose dated same-origin detail links; use list-to-detail extraction, but keep repeated numeric table values out of reusable numeric series until a table/API normalizer exists. |
| HKEX news releases | Official Hong Kong exchange listing-rule and market-structure events. | Current simple HTTP path can return Akamai 503; use WebView/manual evidence or an official feed/detail path when validated, not repeated direct HTTP retries. |

Some official sites expose list/detail content through JSON APIs rather than
static article HTML. If the catalog or source inspection returns an official
API payload with fields such as title, publish date/time, source, summary, or
content/body text, pass the bounded payload through
`macro_research_extract` with `contentType:"api_payload"` instead of treating
the JavaScript shell as failed evidence. This is allowed only for official or
public payloads discovered from the source contract. Preserve the API URL,
title/date fields, retrieved time, and access limitation, and stop if the
payload is a login/challenge page, licensed data, or an undocumented endpoint
with unclear reuse rights.

When fallback succeeds, do not present it as governed cached data unless it has
been normalized by `macro_research_extract` or read back through
`query_macro_research_content` / `query_macro_research_evidence`. Direct
retrieval evidence should be labeled as live source inspection with its URL,
retrieved time, limitation, and whether it was persisted.

Before writing "this report says..." in the final answer, cite content-backed
fields from `query_macro_research_content`: title, source URL, retrieved time,
source date when available, content hash, and key claims. Official API
documentation pages are source evidence, not economic observations; do not
infer a numeric macro value from documentation text.

For the first forward-looking macro answer, keep the workflow bounded. After
factor readback, source catalog/status, one or two allowed content extraction
attempts, and content/evidence readback, answer with:

- factor drivers to watch;
- evidence already available;
- missing or blocked evidence;
- invalidation conditions;
- what would justify a follow-up retrieval.

Do not continue expanding into generic search, additional providers, or
unrelated macro APIs merely to make the answer feel more complete. Direct
source tools are allowed only under the controlled fallback above or when the
user explicitly asks for manual browsing.

Keep the provider path short in the first answer: one catalog read, provenance
or evidence readback, evidence for one or two providers, at most one blocked
official-source attempt plus one extraction when content is missing, then
`query_macro_research_content` and answer. Do not walk through a long provider
list before content readback.

For first-pass macro workflows, do not use WebView, ReportDownload, Bash,
Script, or Research to chase source pages after sufficient governed
factor/content/evidence readback is available. If governed readback is missing
and the catalog marks the source as public or browser-assisted, use the
controlled fallback once. If the source needs manual download, credential,
licensed access, anti-bot input, or do-not-scrape handling, report that boundary
and answer from `query_macro_research_evidence` plus available content readback.

If the request combines macro factors with stock, fund, watchlist, or strategy
work, finish the macro evidence phase first. Then use a narrow candidate pass
and attach macro invalidation conditions to the candidate or strategy
assumption. Do not use broad selection, local artifact reads, or direct web
retrieval as a substitute for `query_macro_research_evidence`.

If the user explicitly asks to write macro risk conditions into a watchlist or
observation list, store them as non-trading observation rows after the governed
macro evidence phase. Use `Watchlist(action:"add", type:"macro-condition",
name:"...", entryCondition:"...", source:"...")`, then read back the macro
condition rows. The stored condition must include evidence tier or source
quality, refresh policy, missing evidence, and the statement that macro/news
context is not an executable buy/sell trigger.

### A. Current Macro Regime

1. Governed factor readback for existing `market_moving_factor_v1` context
2. Governed macro research content/evidence when the question asks about
   research reports, index events, commodity reports, or forward risk factors
3. Frankfurter for recent USD/CNY trend
4. FRED, if configured, for Fed funds, 10Y yields, and the 2s10s spread
5. BEA/Fed Treasury where the requested macro variable matches their coverage
6. Econdb only as a bounded diagnostic fallback
7. Classify the environment as recovery, overheating, stagflation, or slowdown

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

- Econdb may require credentials or reject anonymous requests; treat 401/403 as
  unavailable and use official/cached alternatives
- Frankfurter is usually delayed, not real-time
- FRED follows its release schedule, not daily updates
- Macro data is context, not the whole investment conclusion
- If no FRED key is configured, do not retry FRED or Econdb broadly; use
  governed factor readback, Fed Treasury, BEA when configured, Frankfurter, or
  explicitly disclose the macro evidence gap
