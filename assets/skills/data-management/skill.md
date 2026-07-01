---
name: data-management
description: Guide for using local DataStore — query cached data, trigger downloads, check coverage
when_to_use: Use when you need to inspect governed finance interfaces, local reusable data, fetch queue state, or canonical readback before broad provider work
---

# Data Management

Use the **DataStore** tool to work with locally cached market data. Local data is faster and avoids API rate limits.

## Core Workflow

0. **Inspect governed interfaces**: `DataStore(action: "interfaces", category: "stock")`
1. **Describe the target interface**: `DataStore(action: "interface_describe", interfaceId: "stock.quote")`
2. **Check current availability**: `DataStore(action: "interface_availability", interfaceId: "stock.quote")`
3. **Inspect data health**: `DataStore(action: "data_health")`
4. **Inspect reusable data**: `DataStore(action: "reusable_summary")`
5. **Check coverage**: `DataStore(action: "coverage", code: "600519")`
6. **Query local**: `DataStore(action: "query_kline", code: "600519", start: "2023-01-01")`
7. **If missing**: `DataStore(action: "fetch", type: "kline", code: "600519", start: "2020-01-01")`
8. **Re-query local data** after fetch completes.

Reusable finance surfaces follow the code contract:

```text
local cache/query -> provider route -> code normalizer -> canonical persist -> same-runtime readback
```

Cache reuse is requirement-specific and based on source data time, not merely
when the API call was ingested. Quote reuse checks the provider/source quote
timestamp in `quote_snapshot.timestamp`; `fetched_at` is provenance only.
Daily K-line reuse checks `kline_daily.date` coverage for the requested
date window and minimum row count.

Use `cacheMode` when you need explicit behavior:

- `cache-first` (default): reuse canonical rows if source data time/coverage is
  acceptable, otherwise call an eligible provider.
- `live-only`: bypass reusable rows and call the provider route.
- `cache-only`: return local rows only; fail instead of calling a provider.

Provider constraints do not automatically bypass cache. Use `cacheMode:
"cache-first"` to reuse valid local rows when freshness rules pass, `cacheMode:
"live-only"` to validate a specific provider or force fresh upstream data, and
`cacheMode: "cache-only"` to avoid external calls. A strict provider constraint
requires matching provider/source cache evidence before local reuse; mismatched
local rows become a cache miss, and only the requested provider route is eligible
if a provider call is needed.

Provider adapters are not cache policy. They fetch provider data only. Treat a
surface as reusable only when it has a registered normalizer, canonical table,
query/readback action, and failure logging that does not write failed responses
into reusable tables.

`DataStore(action: "fetch")` blocks by default until the requested durable fetch task completes, fails, or times out. Success and failure output both carry the governed `provider.fetch_task_queue` provenance envelope: interface `provider.fetch_task_queue`, provider `local`, capability `local.provider.fetch_task_queue`, canonical schema/table `fetch_task_queue` / `fetch_tasks`, cache status, and readback action `fetch_status`. Use `block:false` only when intentionally queueing background fetch work; then use `DataStore(action: "fetch_status", status: "all")` to inspect progress through the same governed readback. `fetch_status` only reports the current local fetch queue. It does not fetch data and it is not a live market quote endpoint. Failed fetch tasks are split into `actionableFailures` and `nonActionableEvidence` with `nextAction` guidance; stale recovered rows or missing-scope rows should not be blindly retried. Failed fetch tasks stay in task/API-health logs, not reusable data tables; inspect `fetch_status`, `data_health`, and `query_api_calls` to decide whether the fix is provider, category, credential, runtime, or code.

Use `DataStore(action: "runtime_probe", probeAction: "status")` when provider
truth needs fresh runtime evidence. Inspect `recommendedTargets`,
`blockedTargets`, `providerProbePacks`, and `guidance` before running probes.
`probeMode:"failures"` and `probeMode:"all"` only auto-run retryable transport,
timeout, provider-error, runtime-unavailable, or transport-unstable targets.
Credential/permission, quota/rate-limit, unsupported-route, runtime-blocked,
schema-contract, schema-mismatch, and explicit do-not-retry rows stay in
`blockedTargets` until the root cause changes or the user deliberately passes
bounded `probeIds`.

## Available Query Actions

| Action                     | Params                                                                    | Returns                                                                                      |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `query_kline`              | code, start?, end?, limit?                                                | Daily K-line bars                                                                            |
| `query_fundamental`        | code, limit?                                                              | PE/PB/ROE/growth by quarter                                                                  |
| `query_money_flow`         | code, limit?                                                              | Daily capital flow                                                                           |
| `query_sector`             | type?(industry/concept), limit?                                           | Sector rankings                                                                              |
| `query_industry_map`       | code?, industry?, limit?                                                  | Industry/board constituent map                                                               |
| `query_northbound`         | limit?                                                                    | Northbound capital flow                                                                      |
| `query_limit_pool`         | date?, type?(up/down)                                                     | Limit-up/down pool                                                                           |
| `query_fund_nav`           | code, start?, limit?                                                      | Fund NAV history                                                                             |
| `query_quote`              | code, limit?                                                              | Persisted realtime quote snapshots                                                           |
| `query_index_constituents` | indexCode/code, stockCode?, asOfDate?, provider?, limit?                  | Persisted index constituent membership and weights                                           |
| `query_tick_chart`         | code, date?, limit?                                                       | Persisted TDX intraday minute/tick chart                                                     |
| `query_transactions`       | code, date?, limit?                                                       | Persisted canonical stock transactions from supported providers such as TDX or Sina          |
| `query_volume_profile`     | code, date?, limit?                                                       | Persisted TDX volume profile                                                                 |
| `query_tdx_block_member`   | code?, block_code?, limit?                                                | Persisted TDX block members                                                                  |
| `query_company_info`       | code, type?, limit?                                                       | Persisted TDX company/F10/finance text                                                       |
| `query_hot_rank`           | code?, date?, limit?                                                      | Persisted hot-rank rows                                                                      |
| `query_dragon_tiger`       | code?, date?, limit?                                                      | Persisted dragon-tiger rows                                                                  |
| `query_raw_payload`        | source?, endpoint?, limit?                                                | Local `provider.raw_payload_audit` diagnostic readback only; `normalWorkflowAllowed:false`    |
| `query_api_calls`          | source?, endpoint?, failures?, minutes?, since?, limit?                   | Governed `provider.api_call_log` readback over recent API call/error log, default 30 minutes |
| `interfaces`               | category?, provider?, health?, limit?                                     | Governed Data API interface catalog                                                          |
| `interface_describe`       | interfaceId                                                               | One interface contract: schema, params, query actions, capability statuses                   |
| `interface_availability`   | interfaceId, provider?, providerMode?                                     | Whether the interface is reusable now or needs provider refresh                              |
| `coverage`                 | code?                                                                     | Data coverage info                                                                           |
| `reusable_summary`         | —                                                                         | Local reusable data inventory                                                                |
| `data_health`              | section?(summary/interfaces/providers/datasets/gaps/failures/all), limit? | Interface/provider/dataset/gap/failure health with provenance and live-probe evidence        |
| `stock_list`               | market?, industry?                                                        | Stock list                                                                                   |
| `fund_list`                | type?, limit?                                                             | Fund list                                                                                    |
| `search`                   | query                                                                     | Search stocks by code/name                                                                   |
| `stats`                    | —                                                                         | Database statistics                                                                          |

## Provider Diagnostics And Constrained Ingestion

If a governed interface already exists, use the interface path first and
provider-direct compatibility calls second.

Normal workflows should use requirement-level query/fetch actions first:
`query_*`, `fetch`, `coverage`, `reusable_summary`, `MarketData(action:
"quote")`, or `MarketData(action: "kline")`. Provider-direct calls such as
`DataStore(action: "akshare"|"tdx"|"tushare"|"yfinance", ...)` are compatibility
and explicit provider-constrained validation paths. They may persist registered
schemas by default, but only when the provider capability maps to a known
surface with a normalizer and canonical table. Unknown schemas are not normal
workflow output; use `DataStore(action: "provider_diagnostic", provider: "...",
...)` for bounded inspection or add a code-owned interface/normalizer before
relying on the response. Use `persist:false` only when deliberately avoiding
persistence for a registered schema.

Diagnostic/provider-constrained examples:

```
DataStore(action: "provider_discovery", provider: "akshare", query: "limit pool")
DataStore(action: "provider_diagnostic", provider: "akshare", func: "stock_zt_pool_em", params: {"date": "20260604"})
DataStore(action: "tdx", tdx_action: "tick_chart", code: "600519")
DataStore(action: "tushare", api_name: "daily_basic", params: {"ts_code": "600519.SH", "trade_date": "20260604"})
DataStore(action: "tdx", tdx_action: "finance", code: "600519", persist: false)
DataStore(action: "query_tick_chart", code: "600519")
DataStore(action: "query_hot_rank", limit: 20)
```

Known schemas are normalized into structured tables:
`quote_snapshot`, `kline_daily`, `sector_ranking`, `industry_map`,
`limit_pool`, `tick_chart_intraday`, `transactions`, `volume_profile`,
`tdx_block_member`, `stock_company_info`, `hot_rank`, `dragon_tiger`,
`stock_list`, `fund_list`, `fundamental`, `money_flow`, `fund_nav`, and
`trade_calendar`, and `index_constituent`.

For Tushare, always pass API parameters under `params`, not as unrelated
top-level helper fields. Tushare errors such as `TUSHARE_RATE_LIMIT`, permission
or points failures are tool errors. Do not retry immediately; query local
coverage/query actions first or wait for the endpoint frequency window.

Do not use unregistered provider output as structured scoring input. Add or
request a code normalizer first.

## Available Fetch Types

| Type               | Description                                              | Needs Code?                           |
| ------------------ | -------------------------------------------------------- | ------------------------------------- |
| `kline`            | Daily K-line (5-year history)                            | Yes (single or comma-separated codes) |
| `fundamental`      | Quarterly financials (PE/PB/ROE)                         | Yes                                   |
| `money_flow`       | Capital flow data                                        | Yes                                   |
| `fund_nav`         | Fund NAV history                                         | Yes                                   |
| `fund_holding`     | Fund quarterly holdings                                  | Yes                                   |
| `stock_list`       | A-share stock list (~5000)                               | No                                    |
| `fund_list`        | Mutual fund list (~10000)                                | No                                    |
| `sector`           | Industry/concept rankings                                | No                                    |
| `limit_pool`       | Limit-up/down pool                                       | No                                    |
| `northbound`       | Northbound capital flow                                  | No                                    |
| `calendar`         | Trading calendar                                         | No                                    |
| `industry`         | Industry classification                                  | No                                    |
| `fund_manager`     | Fund manager profiles                                    | No                                    |
| `index_kline`      | Index K-line                                             | Yes (e.g. 000300)                     |
| `index_components` | Index constituents plus optional downstream K-line queue | Yes (e.g. 000300)                     |

## Batch Operations

```
# Fetch multiple stocks at once
DataStore(action: "fetch", type: "kline", codes: "600519,000001,601318,000858", start: "2020-01-01")

# This blocks by default until durable fetch tasks complete/fail/timeout.
# For intentional background work, add block:false and later inspect fetch_status.
```

## Priority Rules

- **Always check DataStore first** before calling MarketData for kline/flow/sector data
- Before broad work, call `DataStore(action: "interfaces")`, `interface_describe`, and `interface_availability` for the target surface, then `data_health`, `reusable_summary`, or `coverage` to see what the local store already has. Use `DataStore(action: "data_health", section: "gaps")` to inspect provider normalizer/readback backlog, credential activation rows that still need action, credential-validated rows that already have live valid-schema evidence, and policy-disabled rows; use `section: "failures"` to inspect classified failure actions.
- Data Manager feed settings can define `source_priority` for queue-backed fetches such as stock list, fund list, K-line, fund NAV, ETF quotes, and index K-line. This priority is applied after local cache checks on stale/missing/manual refresh paths, but code-owned provider policy still gates disabled, unavailable, quota-limited, runtime/API-health temporarily blocked, or unsupported providers. For A-share K-line/index K-line, `eastmoney` maps to the executable `eastmoneyDirect` route and remains distinct from generic AkShare compatibility.
- Manual Data Manager **Run** and scheduled Data Feed execution use the same configured-feed enqueue path. Scope resolution, prerequisites, no-code configuration states, fund NAV versus money-yield splitting, feed-run IDs, provenance params, and `last_run_at` are shared, so a manual run and an automatic run should be debugged through the same `fetch_status`, `data_health`, and API Health evidence.
- If a provider failed recently, inspect `DataStore(action: "query_api_calls", failures: true, minutes: 30)` before retrying. Prefer a different route, local rows, or a narrower serial request for timeout/socket/proxy failures; allow longer provider-specific timeout windows for EastMoney list/ranking endpoints when recent evidence shows slow but otherwise valid responses. Stop immediate retries for invalid parameters, quota, permission, or provider-contract errors.
- For **realtime quotes** (live price), use `MarketData(action: "quote", code: "600519")` or `MarketData(action: "quote", code: "600519,000001")`; the tool can reuse fresh `quote_snapshot` rows and persists fresh quotes for later inspection.
- To force a provider validation instead of cache reuse, use the requirement
  path with `cacheMode: "live-only"` or a strict provider constraint where
  supported by the caller. Do not switch to raw provider endpoints unless this
  is explicitly a diagnostic task.
- Prefer `code` for `MarketData`; `codes` may be accepted for compatibility, but `code` is the canonical parameter.
- After `MarketData(action: "quote")`, fresh quote data is persisted as `quote_snapshot` and can be inspected with `DataStore(action: "query_quote", code: "600519")`.
- For **K-line analysis/backtesting**, always prefer DataStore(action: "query_kline")
- When data is missing, fetch it first, then re-query
- Live/broad market actions such as `MarketData(action: "limit_up")` can time out. If that happens, check `DataStore(action: "provider_status")`, fall back to cached DataStore data or Wind, and avoid repeatedly calling the same timed-out action.

## Data Freshness

- K-line: auto-updated daily after market close for stocks already in the store
- Stock/fund list: refresh daily or when the cache is missing/stale; use manual fetch tasks for immediate repair.
- Sector/limit-pool/northbound: fetch on demand
- Fundamental: fetch on demand

## Notes

- After a stock split (除权), historical QFQ data changes. Re-fetch full history if prices look wrong.
- The Data Manager panel (⌘K → "Data Manager") shows data coverage and fetch queue status.
- Most external data flows through Python sidecar (AkShare/yfinance), Go sidecar (TDX), or code-owned provider adapters behind data API interfaces. Agents should use `DataStore`, `MarketData`, and `/api/finance/...` requirement routes rather than inventing raw URLs.
- Sector rankings and industry constituent maps use the `market.sector_ranking` and `market.sector_constituents` interfaces. For industry constituents, let the code-owned route resolve the `BK` board code and use the board-code adapter; do not make dashboard scripts rely on the AkShare name parser as the automatic path.
- Index membership uses `index.constituents`: query local rows with `DataStore(action: "query_index_constituents", indexCode: "000300")`, and backfill with `DataStore(action: "fetch", type: "index_components", code: "000300")` only when cache coverage is missing or stale. Do not call AkShare `index_stock_cons` directly in normal workflows.
- Use `DataStore(action: "provider_status")` to check sidecar health and rate limiter state.
- For US/HK stocks, prefer the normal quote/K-line/query path first. Use
  `DataStore(action: "provider_diagnostic", provider: "yfinance", func:
"history", symbol: "AAPL")` only for explicit Yahoo/yfinance provider
  validation. Use registered `DataStore(action:"yfinance", ...)` compatibility
  calls only when you intentionally need the persistable schema path.
- Do not use yfinance for China A-shares. For A-shares, keep the source explicit: local DataStore first, then TDX/gotdx, EastMoney direct, AkShare compatibility, Wind, or another China-market endpoint.
- If gotdx is unavailable, build `sidecar/gotdx/gotdx-server` with `finagent_workstation/scripts/build_gotdx.sh` and restart FinAgent Workstation.
- To discover available APIs: `DataStore(action: "provider_discovery", provider: "akshare", query: "fund")` or `DataStore(action: "provider_discovery", provider: "yfinance", query: "earnings")`.
