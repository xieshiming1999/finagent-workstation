---
description: Xueqiu MONI simulated trading workflow through the current endpoints, including portfolio inspection, guarded order preparation, simulated buy/sell, and cash transfer.
when_to_use: Use when the user wants to inspect a Xueqiu simulation portfolio, asks to buy/sell/execute/place an order through available app trading, asks for simulated trading records, or uses strong execution wording that must stay inside the Xueqiu MONI boundary.
---

# Xueqiu Sim Trading

## Prerequisites

Configure these first:
- `XQ_COOKIE`: authenticated Xueqiu browser cookie
- `XQ_PORTFOLIO`: portfolio names are enough, for example `finasimu,finhsimu,finamsim`. The tool resolves names to gids through `trans_group/list.json`; gids are optional fallback values.

## Discovery First

Always start from:

```text
XueqiuTrade(action: "portfolios")
```

That returns the current `name -> gid` mapping. Use the returned `name` or `gid` in later calls.

## Read Portfolio State

For portfolio, position, and history inspection, answer in normal chat text by
default. Create a dashboard, page, or report only when the user explicitly asks
for a rendered artifact. Use Markdown tables for ordinary chat answers; do not
return fenced/raw HTML for portfolio, position, or history summaries.

```text
XueqiuTrade(action: "balance", portfolio: "finasimu")
XueqiuTrade(action: "position", portfolio: "finasimu")
XueqiuTrade(action: "history", portfolio: "finasimu")
```

## Preview Before Write

Before any buy/sell after a confirmation-style workflow, use the read-only
preview action to validate the portfolio, symbol, quote route, current account
state, and estimated trade value. This action must not be treated as execution.

```text
XueqiuTrade(action: "preview_order", portfolio: "finasimu",
  side: "buy", symbol: "SH600519", shares: 5, price: 1215)
```

Only after preview evidence is shown and the user explicitly confirms the final
order fields may the agent call `buy` or `sell`.

## Buy Or Sell

Use explicit trade fields, not target weights. If the user gives a percentage
or budget-sized intent, first read portfolio cash/assets and a current quote,
then convert the intent into explicit `shares` and `price` before any write.
If the security, portfolio, price, share count, or approval is missing, ask
for it instead of calling `buy` or `sell`.

When asking for missing order fields or confirmation, use `AskUserQuestion`
instead of only writing a free-text question. A guarded execution workflow
should leave a structured confirmation checkpoint in the chat UI. Ask for the
minimum missing fields: execution mode, portfolio, order size, price assumption,
and whether to proceed or stop.

If the user asks only for sizing or says not to trade directly, do not call
`buy`, `sell`, `transfer_in`, or `transfer_out`. The final answer must say the
workflow was calculation-only and no Xueqiu MONI write action was executed.

Do not impose the local `Portfolio` tool's A-share 100-share lot validation on
Xueqiu MONI sizing. Xueqiu MONI accepts explicit `shares` in the current tested
contract; use the user intent, cash, price, and `preview_order` evidence as the
authority. If `preview_order` rejects a share count, report that provider
rejection and ask for a revised order size.

If a Xueqiu MONI buy, sell, or transfer call fails, stop the write workflow for
that user turn. Do not retry the same write, do not compensate with a local
`Portfolio` write, and do not update `Watchlist` trade state as if the external
simulation succeeded. Report the Xueqiu error and ask for a new explicit
instruction after the cookie, endpoint, or portfolio state is fixed.

After a successful `buy`, `sell`, `transfer_in`, or `transfer_out`, inspect
`postTradeReadback`. A verified readback means the tool reread the relevant
Xueqiu balance/history and, for trades, position evidence after the write.
If `readbackStatus` is `partial`, report that the write response succeeded but
external verification is incomplete; do not claim a fully closed external trade
loop.

```text
XueqiuTrade(action: "buy", portfolio: "finasimu",
  symbol: "SH600519", shares: 5, price: 1215)

XueqiuTrade(action: "sell", portfolio: "finasimu",
  symbol: "SH600519", shares: 5, price: 1215)
```

## Move Cash

```text
XueqiuTrade(action: "transfer_in", portfolio: "finasimu", amount: 10000)
XueqiuTrade(action: "transfer_out", portfolio: "finasimu", amount: 500)
```

## Important Rules

1. This is simulated trading, not live brokerage execution.
2. `XueqiuTrade` remains permission-gated.
3. Discover the portfolio mapping before writing.
4. Use explicit `shares` and `price`; do not invent weight-based rebalance calls.
5. Refresh the cookie when the API reports login expiry.
6. Record the trade thesis separately after execution.
7. Treat strong execution wording as order intent, but the supported execution
   route is still Xueqiu MONI only. Do not claim a separate real-broker path.
8. For ambiguous portfolio selection, infer from market only when the symbol is
   unambiguous: A-share to the A-share simulation, HK to the H-share simulation,
   and US to the US-share simulation. Otherwise ask which portfolio to use.
9. For any write-like trading intent, if approval or required order fields are
   incomplete, call `AskUserQuestion` and wait for the user's answer before
   calling `XueqiuTrade(action: "buy"|"sell"|"transfer_in"|"transfer_out")`.
10. Use `preview_order` as the post-confirmation dry-run/readback boundary; it
    validates the proposed order without calling Xueqiu write endpoints.
11. For completed MONI writes, check `postTradeReadback.readbackStatus` before
    summarizing the result. `verified` can be reported as write plus readback
    evidence; `partial` must be reported with its warnings.
12. When analyzing history, do not label every cash/asset difference as an
    unexplained defect. MONI accounting can include commission, stamp tax,
    dividends/interest, FX conversion, market settlement, and account-level
    adjustments that may not be fully itemized in `transaction/list.json` or
    `bank_transfer/query.json`. Report the observed reconciliation difference
    and list these likely causes unless the endpoint exposes enough fee, tax,
    dividend, and currency fields to prove the exact source.
