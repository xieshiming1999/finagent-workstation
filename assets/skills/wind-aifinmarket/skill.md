---
description: Wind AIFinMarket data access for A-share, HK/US stock, fund, index, bond, announcement, news, macro, and general Wind analytics queries. Uses desktop native WindMcp over HTTPS.
when_to_use: Use when the user asks for Wind data, Wind-only datasets, high quality financial facts, market quotes, K-line/minute data, fundamentals, filings/news, macro indicators, or Wind AIFinMarket access.
---

# Wind AIFinMarket

This skill is the native FinAgent Workstation adaptation of the official Wind `wind-mcp-skill`.
It keeps the official routing and parameter rules in local reference files, but executes through the desktop agent native `WindMcp` tool instead of `node scripts/cli.mjs`.

## Required First Step

Read `$SKILL_DIR/references/native-windmcp.md` before the first Wind call in a task.

Before broad Wind collection, inspect local reusable data with `DataStore(action: "reusable_summary")` and task-specific local queries such as `query_quote`, `query_kline`, or `query_fundamental`. Use Wind for missing, stale, or Wind-only data.

For complete routing and parameters, read only the needed reference file:

- `$SKILL_DIR/references/routing.md` - mandatory intent routing order.
- `$SKILL_DIR/references/tool-manifest.json` - authoritative server/tool combinations.
- `$SKILL_DIR/references/tool-reference.md` - tool signatures and examples.
- `$SKILL_DIR/references/indicators.md` - authoritative `indexes` names for price indicator tools.
- `$SKILL_DIR/references/error-codes.json` - official error classes and required recovery actions.
- `$SKILL_DIR/references/official-wind-mcp-skill.md` - full upstream skill snapshot for resolving ambiguity.

## Native Call Shape

Use `WindMcp`, not Bash and not ServiceCall.

```json
{"action":"usage"}
```

```json
{
  "action": "call",
  "server": "stock_data",
  "tool": "get_stock_price_indicators",
  "arguments": {
    "windcode": "600519.SH",
    "indexes": "中文简称,最新成交价,涨跌幅"
  }
}
```

## Hard Rules

- Do not invent parameter names. Use `tool-reference.md`.
- For price indicator tools, read `indicators.md` and use only listed Chinese field names in `indexes`.
- Do not put fundamentals such as PE, PB, ROE, growth, balance sheet, profit, or cash-flow fields into price-indicator `indexes` unless the exact field exists in `indicators.md`. Prefer the matching natural-language fundamentals tool.
- `get_stock_fundamentals` requires `question`; do not call it with `windcode`, `indexes`, `code`, or `symbol`.
- Use `analytics_data.get_financial_data` only as fallback after the specific routing paths do not match.
- If `WindMcp` returns `KEY_MISSING`, tell the user to set `WIND_API_KEY` in Settings > Finance before retrying.
- If no active Wind quota limitation is injected in the system prompt, prefer Wind for Wind-covered data before spending monthly web-search quota.
- If `RATE_LIMIT_DAILY` appears, stop Wind calls for the current quota date and try again after the next quota day starts. If `BALANCE_INSUFFICIENT` appears, wait for account top-up or a new key. Until then, fall back to cache, AkShare, EastMoney, TDX, Yahoo, or DataStore.
- Treat `WindMcp` errors as tool failures, not as data responses.
- If a Wind call returns an invalid parameter name/value, do not repeat the same call shape. Re-read the referenced parameter file once, then make one corrected call or switch tools.
- Identical Wind calls may be served from local `api_result_cache`; treat a cache hit as valid data and mention that it is cached.
- Successful Wind price/fundamental calls are persisted into local reusable tables where possible. For later turns, prefer `DataStore(query_quote/query_fundamental)` before repeating Wind.

## Common Safe Patterns

Latest quote fields:

```json
{"action":"call","server":"stock_data","tool":"get_stock_price_indicators","arguments":{"windcode":"600519.SH","indexes":"最新成交价,涨跌幅,成交量,成交额,换手率"}}
```

Fundamental valuation:

```json
{"action":"call","server":"stock_data","tool":"get_stock_fundamentals","arguments":{"question":"<ask for the target instrument's PE, PB, ROE, and related valuation facts>"}}
```
