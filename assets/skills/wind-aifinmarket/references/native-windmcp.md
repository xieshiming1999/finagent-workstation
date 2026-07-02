# Native WindMcp Guide

This app does not run the official `scripts/cli.mjs`. Use the native `WindMcp` tool, which calls Wind MCP HTTPS JSON-RPC endpoints directly.

## Configuration

- Required key: `WIND_API_KEY` in Settings > Finance.
- Internal quota-day offset: `WIND_DAILY_RESET_UTC_OFFSET`. Default `+08:00`. The official skill says daily quota refreshes at next-day 00:00 but does not specify a time zone, so the native tool uses China time by default. This is not shown in normal settings.
- Local usage file: `memory/wind_usage.json`. It records app call count, `resetUtcOffset`, plus same-quota-day Wind limitation fields (`exhausted`, `exhaustedCode`, `exhaustedMessage`, `exhaustedAt`); it is not official Wind credit accounting.
- System prompt status: when `memory/wind_usage.json` contains an active same-quota-day limitation, the agent prompt includes a "Wind AIFinMarket Quota Status" section. The agent should avoid `WindMcp` until the next quota day starts, or until the user updates the key/account.
- API stats source: `wind`.

## Actions

Check local same-day status before broad collection:

```json
{"action":"usage"}
```

Discover server groups and tool names:

```json
{"action":"help"}
```

Call Wind:

```json
{
  "action": "call",
  "server": "<server_type>",
  "tool": "<tool_name>",
  "arguments": {}
}
```

## Reuse Before Calling

- Check `DataStore(action: "reusable_summary")` before broad Wind work.
- For stock quotes, check `DataStore(action: "query_quote", code: "...")` if recent snapshots may be enough.
- For valuation/fundamentals, check `DataStore(action: "query_fundamental", code: "...")` before repeating a Wind fundamentals question.
- Identical non-expired Wind requests may return a `WindMcp cache hit` response from local `api_result_cache`.

## Server Types

- `stock_data`: A-share stock data.
- `global_stock_data`: HK and US stock data.
- `fund_data`: ETF, LOF, and mutual fund data.
- `index_data`: index and sector data.
- `bond_data`: bond and issuer data.
- `financial_docs`: company announcements and financial news.
- `economic_data`: macro and industry economic indicators.
- `analytics_data`: general natural-language Wind data fallback.

## Error Handling

- `KEY_MISSING`: ask the user to configure `WIND_API_KEY`; do not retry until configured.
- `KEY_INVALID`: ask the user to verify or regenerate the key.
- `KEY_FORBIDDEN_SERVER`: the key may not have access to this server group; try the correct server only if routing was wrong.
- `RATE_LIMIT_DAILY` or `BALANCE_INSUFFICIENT`: stop Wind calls for the current quota date. The tool stores the code/message in `memory/wind_usage.json` so later same-day calls remind the agent that Wind is daily-limited. It is appropriate to try Wind again after the next quota day starts according to `resetUtcOffset`, or after the user updates the Wind account/key.
- `RATE_LIMIT_QPS`: retry once after waiting 3-5 seconds; do not launch broad parallel calls.
- `MCP_PROTOCOL_ERROR` or `WIND_TOOL_ERROR`: inspect server/tool/arguments against local references before one corrected retry.
- `NETWORK_ERROR` or `SERVER_5XX`: retry once only if transient; otherwise fall back.

Errors returned by `WindMcp` are real tool errors. Do not summarize an error payload as if it were market data.

## Parameter Discipline

- `windcode` is used by quote, K-line, and price-indicator tools. It may be code or name, but ask a clarification for ambiguous short names such as "茅台".
- `indexes` must be Chinese field names from `indicators.md`; do not translate English names.
- NL tools use `question` and optional `lang`.
- `get_stock_fundamentals`, `get_stock_technicals`, and similar natural-language tools do not accept `indexes` as the main request. Put the security, metric, period, and desired answer into `question`.
- If `get_stock_price_indicators` rejects an `indexes` value, remove only the unsupported fields copied from outside `indicators.md`; for fundamentals such as PE/PB/ROE, switch to `get_stock_fundamentals` with `question`.
- Document RAG tools use `query` and optional `top_k`.
- `economic_data.get_economic_data` uses `metricIdsStr` and optional date/frequency fields.
