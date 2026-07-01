---
name: api-diagnostics
description: Use when diagnosing API Health errors, provider failures, EastMoney/AkShare fetch failed rows, socket/timeout/proxy failures, or when the user asks to scan recent API errors across sessions.
---

# API Diagnostics

Use this skill before retrying external finance APIs after a recent error appears in API Health. This is for live debugging, not historical reporting. Assume most APIs are generally workable unless recent logs show repeated failures.

## First Step: Read Recent Errors

API calls are timestamped in the local SQLite `api_call_log` table when the data store is ready. `query_api_calls` is the governed `provider.api_call_log` readback; query recent rows first:

```json
DataStore(action: "data_health")
DataStore(action: "query_api_calls", failures: true, minutes: 30, limit: 50)
```

For EastMoney/AkShare issues, stay recent unless the user asks for a wider window:

```json
DataStore(action: "query_api_calls", source: "eastmoney", failures: true, minutes: 30, limit: 50)
DataStore(action: "query_api_calls", source: "akshare:eastmoney", failures: true, minutes: 30, limit: 50)
```

If the user gives a visible timestamp or says "since this happened", use an explicit lower bound:

```json
DataStore(action: "query_api_calls", source: "eastmoney", failures: true, since: "2026-06-09T21:28:00+08:00", limit: 100)
```

Rows persist across chat sessions for the same FinAgent Workstation project data directory, but ignore older rows by default. Use `minutes: 5`, `minutes: 30`, or an explicit `since` timestamp to match the user's visible error time.

## Triage Rules

- `fetch failed`, `UND_ERR_SOCKET`, `ECONNRESET`, `socket hang up`, `RemoteDisconnected`, and `Empty reply from server` are transport/proxy/network symptoms. Do not assume bad parameters.
- `404`, `400`, empty structured payloads, or schema mismatches may indicate endpoint/parameter/schema drift. Inspect the endpoint and request parameters before changing fallback order.
- Repeated EastMoney failures on `/api/qt/clist/get` usually affect list/ranking/sector-style reads. Prefer local reusable data or TDX for quote/K-line paths while diagnosing.
- Some EastMoney list/ranking endpoints can need longer timeouts. When the error class is timeout/transport and parameters/schema are already known, retry only one narrow serial probe with a provider-specific longer timeout before broad collection.
- If a source has repeated failures in the last few minutes, stop broad retries. Use local data, TDX/gotdx, Wind if configured, or another source appropriate to the task.
- If only one recent request failed and nearby requests work, treat it as transient unless the same endpoint fails again.
- Failed calls belong in API health/stat logs, not reusable market data tables.

## Fix Workflow

1. Inspect `data_health`, then query recent failures with `query_api_calls`.
2. Group by source and endpoint. Note the first/last recent failure time, status, duration, and error string.
3. Classify as transport/proxy, timeout, rate/quota, parameter/schema, sidecar unavailable, or unknown.
4. For transport/proxy failures, test one narrow request only before broader retries.
5. For schema drift, inspect the parser/normalizer and add a focused regression test.
6. Report provenance and fallback: what failed, what data source was used instead, and whether the data is fresh or local.
