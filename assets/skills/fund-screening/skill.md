---
description: Desktop fund screening workflow in FinAgent Workstation for 4433-style ranking, manager screening, and shortlist generation.
when_to_use: User asks for fund selection, fund ranking, manager screening, NAV comparison, or building a fund watchlist in FinAgent Workstation.
---

# Fund Screening

In FinAgent Workstation, the primary path is not mobile Tushare. Use this order instead:
Load `analysis-standards` before producing the shortlist. Its Finance Output Standard governs the final answer: separate facts, calculations, inferences, recommendations, assumptions, and unverified items, and retain source/as-of time, fetch/ingest time, fields used, method/tool action, quality/confidence note, and readback status.

1. Check the local `DataStore`
2. Use `DataStore(action:"screen_fund")`
3. Backfill `fund_list` or targeted `fund_nav` / `fund_money_yield` only when
   the selected evidence class is missing
4. Produce the shortlist and answer directly. Write to `Watchlist` only when
   the user explicitly asks to save, observe, monitor, or add the funds.

## Primary path

### 1. Reuse local fund data first

```text
DataStore(action: "query_fund_list", type: "mixed", limit: 20)
DataStore(action: "query_fund_performance", limit: 50)
DataStore(action: "query_fund_nav", code: "110011", limit: 60)
DataStore(action: "query_fund_manager", limit: 20)
DataStore(action: "query_fund_holding", fundCode: "110011", limit: 20)
```

If local data is already sufficient, reuse it before making another external request.
Do not call `DataProcess(action:"stats"|"summary"|"signals"|"support")` on a
fund code such as `000001`; those actions are stock/K-line analysis and can
collide with A-share stock symbols. Use the fund readback actions above, and if
the fund is a money fund, use `query_fund_money_yield` rather than ordinary NAV.
For long-horizon suitability, prefer bounded readbacks such as
`query_fund_nav(code, limit: 120)`, `query_fund_performance(code)`,
`query_fund_holding(fundCode, limit: 20)`, and `query_fund_manager(limit: 20)`.
Do not use `Script` to parse large saved NAV tool outputs unless the user
explicitly asks for custom calculations that the fund readbacks cannot support;
if the bounded rows are insufficient, disclose the data gap instead of looping.

For research-only prompts such as choosing, ranking, or recommending funds for
long-term observation, do not call `Watchlist`, monitor tools, or
`MarketData(action:"custom_strategy_observe")`. In fund-selection language,
"长期观察" means an analysis shortlist unless the user also asks to save,
monitor, set trigger conditions, create a定投 plan, or write to an observation
pool. For prompts that explicitly ask to design a定投/观察 condition and write a
watchlist item, do not broaden the workflow into custom statistics, holdings,
manager research, or script-based NAV calculations. Use only fund identity,
performance, and NAV/money-yield readbacks, then `Watchlist(add)` with the
selected fund's real `name` from `query_fund_list` and `Watchlist(list)`
readback.

For broad "choose 3 funds" research prompts, keep the first pass bounded:
`query_fund_list`, `query_fund_performance`, one or two `screen_fund` calls,
one selected money-fund `query_fund_money_yield`, and targeted
`query_fund_nav` / `query_fund_holding` readbacks for at most two ordinary
funds. Query at most one or two money-fund codes; if a broad
`query_fund_money_yield` result already contains enough candidates, do not
query those same codes again. Do not repeat the same code/interface query in
the same turn. Do not call `query_fund_manager`, `custom_strategy_observe`, or
live `fetch fund_holding` unless the user explicitly asks for manager due
diligence, a validated observation strategy, or the final answer cannot
honestly disclose the holding/manager gap.

### 2. Use the desktop fund screener

4433-style return screening:

```text
DataStore(action: "screen_fund", mode: "4433", limit: 20)
```

Manager-based screening:

```text
DataStore(action: "screen_fund", mode: "manager", min_experience: 3, limit: 20)
```

With additional thresholds:

```text
DataStore(
  action: "screen_fund",
  mode: "4433",
  fund_type: "mixed",
  min_aum: 2,
  limit: 20
)
```

## Backfill strategy when local coverage is weak

Check coverage first:

```text
DataStore(action: "coverage", code: "110011")
DataStore(action: "reusable_summary")
```

If a backfill is required, use the fund data queue or an AkShare/EastMoney
bridge path. Do not use Tushare `fund_basic` or `fund_nav`; those API names are
blocked by the runtime for this app.

```text
DataStore(action: "fetch", type: "fund_list")
DataStore(action: "fetch", type: "fund_performance")
DataStore(action: "fetch", type: "fund_nav", code: "110011")
```

Then read it back immediately:

```text
DataStore(action: "query_fund_list", type: "mixed", limit: 20)
DataStore(action: "query_fund_performance", limit: 50)
DataStore(action: "query_fund_nav", code: "110011", limit: 60)
```

## Recommended output

Always include:

- the shortlist
- the screening rule
- data sources
- local versus external coverage
- risk notes

Example:

```text
Fund screening result (4433, mixed funds, 5 returned)

1. 110011 E Fund Small Cap
   - 1Y: 18.2%
   - 3Y: 42.5%
   - Source: local DataStore + AkShare/EastMoney fund NAV
   - Note: historical volatility remains high

2. ...
```

## With Watchlist

Use this only when the user explicitly asks to save, observe, monitor, or add
selected funds to a watchlist:

```text
Watchlist(
  action: "add",
  symbol: "110011",
  name: "E Fund Small Cap",
  type: "fund",
  source: "fund-screening",
  tags: ["4433", "fund"]
)
```

After adding, read back the same symbol/id before claiming success. `tag` /
`tags` are labels, not a replacement for the fund name. If the user did not ask
for a dashboard or custom statistics, stop after the watchlist readback and
final evidence summary.

## Avoid these mistakes

- Do not start desktop fund screening with mobile Tushare
- Do not skip local `query_fund_*` checks and immediately refetch everything
- Do not claim external-only results are reusable local data without readback proof
- Do not present a deep fund analysis as complete when holdings coverage is clearly missing
