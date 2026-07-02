---
name: tushare
description: Use app-supported Tushare Pro APIs explicitly for China-market stock list, K-line, daily valuation, trading calendar, and evidence-gated index constituent data through DataStore.
when_to_use: Use when the user asks for Tushare/Tushare Pro specifically and the requested API is one of the supported or credential-gated app surfaces: stock_basic, daily, weekly, monthly, index_daily, daily_basic, trade_cal, or index_weight after live capability evidence confirms permission.
---

# Tushare Pro

Tushare is an explicit research data source. Do not use it as a hidden fallback
for ordinary A-share quote or K-line paths. For live quote/K-line, check local
DataStore first, then use the code-owned provider priority.
If a governed interface already covers the task, prefer the interface/query
path first and use raw `DataStore(action:"tushare", ...)` only when the user
explicitly wants Tushare or when you are validating the Tushare provider path.

## Entry Point

Use the DataStore tool:

```
DataStore(action: "tushare", api_name: "daily", params: {"ts_code": "600519.SH", "start_date": "20260101", "end_date": "20260604"})
```

Requirements:

- `TUSHARE_TOKEN` must be configured.
- This app disables Tushare APIs that the configured permission set cannot
  access: `fina_indicator`, `income`, `balancesheet`, `cashflow`,
  `moneyflow`, `fund_basic`, and `fund_nav`.
- `index_weight` is credential/permission-gated in the current evidence set.
  Do not use it as a normal raw Tushare example. First check
  `DataStore(action:"interface_availability", interfaceId:"index.constituents",
  provider:"tushare", providerMode:"strict")`, then prefer cached
  `query_index_constituents` or another supported provider when Tushare is
  still gated.
- Put all Tushare API parameters under `params`.
- Use Tushare date format `YYYYMMDD` unless the specific endpoint documents a
  different format.
- Use `fields` only to narrow returned columns.

## Structured Persistence

Registered Tushare schemas persist by default:

| Tushare API | Local table |
|-------------|-------------|
| `stock_basic` | `stock_list` |
| `daily`, `weekly`, `monthly`, `index_daily` | `kline_daily` |
| `index_weight` | `index_constituent` when `tushare.index.constituents` is live-validated for the current token |
| `daily_basic` | `fundamental` |
| `trade_cal` | `trade_calendar` |

After fetching, reuse local data:

```
DataStore(action: "query_fundamental", code: "600519")
DataStore(action: "query_kline", code: "600519", start: "2026-01-01")
```

Use `persist:false` only for registered schemas when you deliberately do not
want any local write. Unknown Tushare schemas are not normal workflow output;
they must be rejected, routed through `DataStore(action:"provider_diagnostic",
provider:"tushare", ...)`, or promoted by adding a code-owned
interface/normalizer before the agent relies on the response.

## Common Workflows

Stock list:

```
DataStore(action: "tushare", api_name: "stock_basic", params: {"list_status": "L"})
```

Daily bars:

```
DataStore(action: "tushare", api_name: "daily", params: {"ts_code": "600519.SH", "start_date": "20260101", "end_date": "20260604"})
```

Valuation:

```
DataStore(action: "tushare", api_name: "daily_basic", params: {"ts_code": "600519.SH", "trade_date": "20260604"})
```

Trading calendar:

```
DataStore(action: "tushare", api_name: "trade_cal", params: {"exchange": "SSE", "start_date": "20260601", "end_date": "20260605"})
```

Index constituents:

```
DataStore(action: "interface_availability", interfaceId: "index.constituents", provider: "tushare", providerMode: "strict")
DataStore(action: "query_index_constituents", indexCode: "000300", limit: 50)
```

Only call the raw Tushare `index_weight` provider path after
`interface_availability` or API Health shows `tushare.index.constituents` is
supported/live for the configured token.

## Error Handling

Tushare has separate limits:

- Permission/points: endpoint or fields may be unavailable for the token.
- Frequency: endpoint-level per-token windows, for example `trade_cal` can be
  limited even when the token can access it.
- Daily or account-level quotas may also apply depending on account tier.

`TUSHARE_RATE_LIMIT` is a tool error, not normal data. Do not immediately retry
the same endpoint. Query local DataStore first, use a narrower already cached
range, or wait for the frequency window.

Do not hide Tushare failures by silently switching source when the user asked
for Tushare. Explain the source limitation and use another provider only if the
user asked for best-effort data rather than Tushare-specific data.

For financial statements, money flow, and fund list/NAV, use local reusable
rows first, then EastMoney/AkShare/Yahoo/Wind paths where available. Do not call
the disabled Tushare API names.
