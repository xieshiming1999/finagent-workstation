---
description: Scheduled batch analysis and catalyst-calendar workflow for daily watchlist review and upcoming-event tracking.
when_to_use: User asks for daily watchlist review, automatic analysis, scheduled reports, or event and catalyst reminders in FinAgent Workstation.
---

# Scheduled Analysis

## Setup

Use `CronCreate` for a recurring daily review:

```text
CronCreate(
  cron: "0 18 * * 1-5",
  prompt: "Run the daily watchlist review:\n1. Use Watchlist(action:'list', status:'watching') to load watched symbols\n2. Run DataProcess(action:'summary') for a quick review on each symbol\n3. Mark changes such as breakouts, breakdowns, or signal shifts\n4. Highlight symbols that now meet entry conditions\n5. Check the catalyst calendar for the next 7 days\n6. Summarize everything into a daily report",
  recurring: true,
  durable: true
)
```

## Catalyst calendar

### Event types

| Event type | Data source | Typical impact | Lead time |
|---|---|---|---|
| Earnings release | Research search for disclosure timing | High | 3 days |
| Dividend or ex-rights date | Research search for dividend date | Medium | 1 day |
| Lock-up expiry | Research search for unlock event | High, often negative | 7 days |
| Shareholder meeting | Research search | Low | 1 day |
| Index rebalance | Research search for CSI 300 or other index changes | Medium | 5 days |
| Industry policy | Research search for policy or regulation changes | High | early attention |
| Product launch or capacity ramp | Research search for production or launch updates | Medium | progress watch |

### How to wire catalyst tracking

```text
Research(action: "search", query: "<company> earnings guidance dividend unlock event 2026")

Watchlist(
  action: "update",
  symbol: "<code>",
  note: "Catalysts: 5/15 Q1 earnings release, 6/1 lock-up expiry of 120M shares"
)

MonitorCreate(
  name: "<company> earnings reminder",
  template: "date_alert",
  params: {"targetDate": "2026-05-15", "daysAhead": 3, "event": "Q1 earnings release"},
  interval: "1d"
)
```

### How catalysts appear in the daily report

```text
Upcoming catalysts in the next 7 days:
- [5/10] Moutai (600519): Q1 earnings guidance, watch for a positive surprise
- [5/12] CATL (300750): 230M-share unlock, watch for short-term selling pressure
- [5/15] BYD (002594): new model launch event, watch sales guidance

Recent catalyst review:
- [5/3] Wuliangye: ex-dividend completed, price recovery still in progress
```

### Action guidance by catalyst

| Catalyst | Before the event | After the event |
|---|---|---|
| Strong-expected earnings | Build or add before the release | Add on a beat, cut on a miss |
| Uncertain earnings | Reduce risk or stay flat | Wait for confirmation |
| Unlock date | Consider trimming ahead of time | Watch real selling volume afterward |
| Dividend / ex-rights | Hold if dividend yield is the thesis | Reassess post ex-rights behavior |
| Positive industry policy | Build exposure in leaders early | Trim if the benefit is fully priced in |

## Daily report format

```text
Daily watchlist review (2026-05-05)

12 symbols in the watchlist. Key changes today:

Warnings:
- Wuliangye (000858): broke below MA20, signal turned bearish, consider removing from watchlist
- LONGi (601012): three days of low volume, now close to the planned entry zone

Opportunities:
- Moutai (600519): low-volume pullback to MA10, entry setup is active
  -> suggested buy zone 1650, stop 1520, target 1800

No major change:
- CATL / BYD / China Merchants Bank and 7 others

Open positions:
- Ping An (601318): bought at 52 -> now 54.3 (+4.4%), hold
```

## Report output

```text
Dashboard(template: "report")
-> fill the daily-report data
-> FileWrite {{DATA_DIR}}/memory/pages/reports/daily_<date>.html
-> UIControl(action: "addPage", params: {path: "{{DATA_DIR}}/memory/pages/reports/daily_<date>.html", title: "Daily Report <date>", tag: "report"})
```

## Suggested frequencies

| Style | Recommended frequency | Cron |
|---|---|---|
| Short-term | 10:00 and 14:30 every trading day | `"0 10,14 * * 1-5"` |
| Medium-term | 18:00 every trading day | `"0 18 * * 1-5"` |
| Long-term / value | Monday 18:00 | `"0 18 * * 1"` |
| Funds | Friday 18:00 | `"0 18 * * 5"` |
