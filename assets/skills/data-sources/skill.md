---
description: Data-source guide for built-in finance providers and extension patterns
when_to_use: Use when you need to choose the right data source, understand provider differences, fetch deep market datasets, or extend the app with new external finance APIs
---

# Data Sources

`MarketData` and `DataStore` support multiple providers with code-owned routing and fallback. Use this skill to decide **which source should answer which question**.

For the current code-owned requirement surface, consult
`references/data-api-interfaces.md`. For useful non-persisted workflows and
diagnostics, consult `references/output-only-api-interfaces.md`. Use those
interface IDs as the normal workflow vocabulary. Provider parameters are
routing constraints for an interface; they are not raw endpoint shortcuts.

If a requirement-level interface already exists, use that interface and its
`query_*` / governed fetch path first. Do not switch to provider-direct calls
as the normal workflow when the runtime already has an interface, normalizer,
canonical table, and readback path.

## Local reusable data comes first

Before spending another provider call for quote, kline, screening, or deep market reads, discover the governed interface first, then check reusable local data:

```json
DataStore(action: "interfaces", category: "stock", limit: 20)
DataStore(action: "interface_describe", interfaceId: "stock.quote")
DataStore(action: "interface_availability", interfaceId: "stock.quote")
DataStore(action: "data_health")
DataStore(action: "finance_doctor")
DataStore(action: "runtime_probe", probeAction: "status")
MarketData(action: "coverage")
MarketData(action: "query_quote", symbols: ["600519"])
MarketData(action: "query_kline", symbols: ["600519"], startDate: "2024-01-01")
DataStore(action: "query_yfinance", dataset: "profile", symbol: "AAPL")
```

Treat `interfaces -> interface_describe -> interface_availability -> query/fetch`
as the normal progressive-disclosure path. Use `data_health` when you need the
broader backlog, credential state, failure queues, or dataset/provider health
view.
Use `finance_doctor` when the workflow may be blocked by local runtime,
session/history, DataStore, provider-route, Data Feed, sidecar, or service
readiness. It is a local diagnostic/readiness report under `data.health`, not a
provider refresh and not a replacement for `interface_availability`.
Use `runtime_probe` when the agent should refresh durable provider truth instead
of treating retries as implicit validation. Start with `probeAction:"status"`
and inspect `recommendedTargets`, `blockedTargets`, `providerProbePacks`, and
`guidance`. `probeMode:"failures"` and `probeMode:"all"` are for retryable
transport, timeout, provider-error, runtime-unavailable, or transport-unstable
targets. Credential/permission, quota/rate-limit, unsupported-route,
runtime-blocked, schema-contract, schema-mismatch, and explicit do-not-retry
rows stay in `blockedTargets` until the root cause changes or the user
deliberately passes bounded `probeIds`.

When the user asks how to recover from a行情, macro, data-source, or provider
failure, do not answer only from this static guidance. Inspect current runtime
evidence first:

```json
DataStore(action: "data_health", section: "failures", limit: 10)
DataStore(action: "query_api_calls", minutes: 120, limit: 10)
```

Then summarize the actual failure classes, missing evidence, cache/readback
fallback, and next bounded retry or no-retry decision. If there are no recent
failures, state that the recovery policy is being described from contract
evidence rather than a live failure row.
For provider failure recovery, answer from the health and API-call evidence
directly. Do not inspect or rewrite dashboard/page files unless the user asks
for a dashboard, report artifact, or file update.

For external web evidence, `Research` is the tool name, not the search engine.
Use `Research(action:"providers")` to inspect search engines/news sources, then
`Research(action:"search", provider:"brave|tavily")` only when governed
finance data and direct known URLs cannot answer.

Treat provider results as reusable only when code has a registered canonical schema and a working query path. Use `DataStore(action: "data_health")` to inspect interface, provider, dataset, live-probe, and provenance status before broad provider work. Use `DataStore(action: "data_health", section: "gaps")` for provider normalizer/readback backlog, `credentialActivationQueue` rows that still need action, `credentialValidatedQueue` rows that already have live valid-schema evidence, and `policyDisabledQueue` rows; use `section: "failures"` and `failureActionQueue` for classified recent/live failure actions. Use `DataStore(action: "finance_doctor")` when local runtime/session/DataStore/feed readiness could explain a workflow failure before attempting provider retries. Use `DataStore(action: "runtime_probe", probeAction: "run", probeMode: "credential|unstable|failures|all")` when the runtime should execute bounded governed probes and write fresh evidence under `data/runtime-probes`; automatic modes should follow `recommendedTargets`, while `blockedTargets` require a changed root cause or explicit bounded `probeIds`.

Cache reuse is an explicit interface/service rule. Default `cache-first` reads
canonical local rows before provider routing and reuses them only when the
interface freshness rule passes. Quotes check `quote_snapshot.timestamp`
(provider/as-of quote time), not `fetched_at`. Daily K-line checks
`kline_daily.date` coverage for the requested window. Use `cacheMode:
"live-only"` for explicit live/provider fetch, and `cacheMode: "cache-only"`
when the task must not spend provider quota. `providerMode: strict` still
uses cache-first rules, but a cache hit must carry matching provider/source
evidence for the requested provider; mismatched local rows are treated as a
cache miss and the route can call only the requested provider capability. Combine
strict mode with `cacheMode: "live-only"` when explicit provider validation must
force an upstream provider call.

For readback actions, `cacheStatus:local-hit` means canonical local rows were
reused; `cacheStatus:local-miss` means the cache was checked and no reusable row
matched the request. A miss is a routing signal, not proof that the instrument
or dataset does not exist.

`DataStore(action:"query_raw_payload")` is diagnostic-only readback for
`provider.raw_payload_audit`. It is useful when auditing legacy or bounded
provider discovery evidence, but it is not a normal workflow data source. Treat
that surface as `normalWorkflowAllowed:false`; do not promote raw payload rows
into analysis, strategy, or reusable dashboards without a registered interface,
normalizer, canonical table, and query/readback contract.

Runtime panels are part of the same provenance workflow. Data Manager feed runs
and Fund Pulse refreshes should be understood as queue-backed governed fetches:
they prepare local canonical rows, then prove reuse through table/readback
coverage. Fund Pulse manual refresh currently covers fund list, ETF quotes,
fund performance, and stale ordinary fund NAV seeds; ordinary NAV and money-fund
yield are separate interfaces and should not be mixed.

The News panel reads `news.finance_feed` through a governed route. Its rows
should retain route provenance: interface id, provider, capability id, cache
status, canonical `finance_news` schema/table, news data time, and fetched-at
time. If the feed is empty or stale, inspect `query_finance_news`,
`interface_availability`, `data_health`, and then use a bounded provider refresh
or runtime probe rather than guessing a raw news endpoint.

The finance surface contract is:

```text
local cache/query -> provider route -> code normalizer -> canonical persist -> same-runtime readback
```

Keep these responsibilities separate. A provider adapter should not decide
whether local cache is fresh enough, and a raw provider response should not be
used as reusable structured data until the code registers normalization,
persistence, query/readback, and failure/no-persist behavior.

## Source priority

Default priority is code-owned. Do not rewrite fallback order in prose unless the user explicitly forces a source. Provider policy can also filter routes that current API Health or runtime-probe evidence marks temporarily blocked, so preferred provider order is a constraint after health gates, not a bypass.

### A-share quote / kline

1. local SQLite reusable data
2. TDX / gotdx
3. EastMoney
4. Sina direct capability when `stock.quote`, `index.quote`, `stock.identity_list`, unadjusted `stock.daily_kline`, `stock.transactions`, `fund.etf_quote`, `market.sector_ranking`, `market.sector_constituents`, `market.board_ranking`, `market.board_members`, or `news.finance_feed` explicitly routes to `provider:"sina"`
5. Tencent direct capability when `stock.quote`, `index.quote`, `stock.identity_list`, `stock.daily_kline`, `index.daily_kline`, `stock.transactions`, or bounded `fund.etf_quote` explicitly routes to `provider:"tencent"`
6. AkShare compatibility where the provider path supports it

Sina is a governed provider for A-share stock/index quote snapshots, A-share
identity lists, unadjusted daily K-line, stock transactions through
`stock.transactions`, ETF quote/list rows through `fund.etf_quote`, sector
ranking through `market.sector_ranking`, concept board ranking through
`market.board_ranking`, sector constituents through
`market.sector_constituents`, concept-board members through
`market.board_members`, and broad finance-news feed rows. For
explicit Sina validation or refresh, use the matching interface path with
`provider:"sina"` and, when a live provider call is required,
`cacheMode:"live-only"` / strict provider routing. Sina daily K-line is
unadjusted only; request `adjust:"none"` or use another provider for qfq/hfq
bars. The result should carry `interfaceId`, `capabilityId` such as
`sina.stock.quote`, `sina.index.quote`, `sina.stock.identity_list`,
`sina.stock.daily_kline`, `sina.stock.transactions`, `sina.fund.etf_quote`,
`sina.market.sector_ranking`, `sina.market.sector_constituents`,
`sina.market.board_ranking`, `sina.market.board_members`, or
`sina.news.finance_feed`, `provider:"sina"`,
canonical schema/table, cache status, and source/fetched time provenance. Do
not guess other Sina endpoints unless they are first added as governed
interfaces, typed output-only surfaces, or diagnostic contracts with probe
evidence.

Sina `fund.dividend_factor` is a typed output-only surface, not a reusable
fund table. Use `DataStore(action:"sina_fund_dividend_factor", symbol:"510050")`
only for bounded ETF dividend/factor evidence. The result must stay in the
`fund_dividend_factor_result` envelope with `persistencePolicy:"output-only"`
and `cacheStatus:"not-cacheable"`; do not treat it as `fund_nav`,
`fund_holding`, or canonical corporate-action readback until a dedicated fund
corporate-action interface/table is implemented.

Tencent is a governed FinAgent Workstation provider for A-share quote snapshots,
index quote snapshots, identity lists, qfq/hfq/none stock daily K-line, index
daily K-line, stock transactions, bounded ETF quote/list rows, ETF daily OHLCV
bars, ETF transaction ticks, listed-fund / exchange money-market quotes,
convertible-bond quotes, and unadjusted convertible-bond daily K-line bars. Use
it through the same interface-first paths with `provider:"tencent"` only when
strict Tencent validation or fallback is useful. The result should carry
capability IDs such as `tencent.stock.quote`, `tencent.index.quote`,
`tencent.stock.identity_list`, `tencent.stock.daily_kline`,
`tencent.index.daily_kline`, `tencent.stock.transactions`,
`tencent.fund.etf_quote`, `tencent.fund.etf_daily_ohlcv_bars`,
`tencent.fund.etf_transactions`, `tencent.fund.listed_fund_quote`,
`tencent.bond.convertible_quote`, `tencent.bond.convertible_daily_kline`, or
the global-only `tencent.global.stock_quote` capability under `stock.quote` for
HK/US quote symbols. Tencent HK K-line, A+H rows, provider metadata,
exchange-bond route guesses, and convertible-bond transactions remain
reference/deferred or tested unsupported until a runtime interface, normalizer,
readback, and product need are explicit.

For runtime evidence refresh, use `DataStore(action:"runtime_probe",
probeAction:"run", probeIds:[...])` when a bounded provider-specific probe is
needed. Prefer `recommendedTargets` from status for automatic retry, and keep
`blockedTargets` blocked until credentials, quota, unsupported route, runtime,
schema contract, or do-not-retry root cause changes. Tencent's direct probe IDs are `tencent.direct.stock_quote`,
`tencent.direct.index_quote`, `tencent.direct.stock_rank_list`,
`tencent.direct.fund_etf_quote`, `tencent.direct.stock_daily_kline`,
`tencent.direct.stock_daily_kline_none`,
`tencent.direct.stock_daily_kline_hfq`, `tencent.direct.index_daily_kline`,
`tencent.direct.stock_transactions`, `tencent.quote.listed_fund_batch`,
`tencent.kline.etf_sh510300_none`, `tencent.kline.etf_sh510300_qfq`,
`tencent.kline.etf_sh510300_hfq`, `tencent.transactions.etf_page_0`,
`tencent.bond.convertible_quote_batch`, and
`tencent.bond.convertible_daily_kline_none`.

For Data Manager queue-backed K-line feeds, `source_priority` may use
`eastmoney`; the provider policy normalizes that to the executable
`eastmoneyDirect` route. This is separate from generic AkShare compatibility and
still runs after local cache checks.

### REST-only market lists

Registered EastMoney capabilities cover:

- sector ranking and constituents
- hot rank
- limit pools
- northbound flow / holdings
- dragon-tiger
- money flow ranking

Index membership uses `index.constituents`. Query local rows first with
`DataStore(action: "query_index_constituents", indexCode: "000300")`; backfill
through `DataStore(action: "fetch", type: "index_components", code: "000300")`
only when coverage is missing. Do not call AkShare `index_stock_cons` directly
in normal workflows.

### Research / normalized datasets

Use Tushare only when:

- the user explicitly wants Tushare
- or a standardized research dataset is a better fit than quote fallback

Tushare is not part of normal quote / kline fallback.

## Provider strengths

### TDX / gotdx

Best for A-share market structure and deep exchange-style data:

- quote / kline
- intraday tick chart
- transactions; Sina and Tencent are also available for `stock.transactions` when strict provider validation or fallback is useful
- auction
- unusual activity
- volume profile
- company / finance / xdxr
- index info / stock lists / ranking-type data

### EastMoney

Best for free REST market lists and board data:

- sector / concept / area ranking
- hot rank
- northbound
- limit-up / limit-down pools
- dragon-tiger
- money flow / flow rank
- chip / board views
- ETF quotes through the `fund.etf_quote` interface-backed `MarketData(action: "etf")` path

### Yahoo / yfinance

Use for non-A-share global assets:

- US stocks / ETFs
- HK stocks
- global indices
- crypto / FX

Do not use Yahoo for China A-shares.

### Wind

Use first for professional data when configured and quota is available:

- quote / kline
- fundamentals
- company info
- macro
- documents / analytics

### Tushare

Use only for currently registered structured research datasets:

- stock list
- daily / weekly / monthly / index daily K-line
- daily valuation / `daily_basic`
- trade calendar

Do not call Tushare `moneyflow`, `fund_basic`, `fund_nav`,
`fina_indicator`, `income`, `balancesheet`, or `cashflow`; those interfaces are
disabled under the current app/provider contract and should not be advertised as
normal workflows.

## Common Provider-Constrained Actions

Use these only when the user asks for a specific provider or when validating a
provider surface. Normal workflows should call requirement-level query/fetch
actions first.

### TDX-specific

- `tdx_tick_chart`
- `tdx_transactions`
- `tdx_finance`
- `tdx_xdxr`
- `tdx_unusual`
- `tdx_stock_list`
- `tdx_volume_profile`
- `tdx_company_info`

Use gotdx index endpoints (`tdx_index_info`, `index_bars`, `index_momentum`) only through the guarded provider route after checking the response source and validation status. Ordinary UI/status index quotes should still use `/api/finance/index/quotes`. Index history uses code-owned routing: local rows first, then validated gotdx index bars, then the explicit EastMoney index K-line route, then AkShare compatibility if configured.

### EastMoney-specific

- `flow`
- `flow_rank`
- `sector`
- `chip`
- `hot_rank`
- `dragon_tiger`
- `northbound`
- `unusual`
- `limit_up`
- `limit_down`

### Yahoo / yfinance

- `DataStore(action:"yfinance", ...)`
- `DataStore(action:"query_yfinance", ...)`
- typed profile / history / statements / news / options / actions datasets

### Tushare

Use nested `params`:

```json
DataStore(action:"tushare", api_name:"daily_basic", params:{ ts_code:"600519.SH" }, fields:"ts_code,trade_date,pe,pb")
```

## When to use which source

| Need                                   | Best source  | Why                                             |
| -------------------------------------- | ------------ | ----------------------------------------------- |
| A-share real-time quote                | local -> TDX | fastest and most aligned with local persistence |
| A-share daily kline                    | local -> TDX | canonical read path first                       |
| intraday chart                         | TDX          | unique deep-market coverage                     |
| transactions                           | TDX / Sina / Tencent | governed `stock.transactions` interface         |
| sector / hot / northbound / limit pool | EastMoney    | REST-only datasets                              |
| US / HK / global assets                | Yahoo        | typed global path already exists                |
| professional fundamentals / macro      | Wind         | best covered professional dataset               |
| normalized research tables             | Tushare      | structured research interfaces                  |

## Extension guidance

If the user wants a new external finance API:

1. first see whether an existing provider already covers it
2. if not, document the endpoint in a skill
3. test it with the correct tool path
4. only treat it as reusable structured data after parser/normalizer, canonical persistence, same-runtime query/readback, and failure logging exist in code

Do not pretend a raw one-off HTTP response is part of the reusable local market-data layer.
