---
description: Proactively load before generating or modifying any finance dashboard that uses TradingView widgets, live prices, K-line charts, ticker tapes, heatmaps, technical ratings, or TradingView Scanner.
when_to_use: Load this skill when the user explicitly asks for TradingView, live visual chart widgets, TradingView Scanner, heatmaps, ticker tape, or a dashboard whose main requirement is TradingView-style live visualization. Do not load it for a normal finance analysis/report dashboard that can use the app Dashboard template.
---
# TradingView Skill

Use this skill for TradingView dashboard visualization and TradingView Scanner
work. TradingView is a visual layer for live widgets, not the default path for
ordinary finance report dashboards. If the user asks for a stock/fund analysis
dashboard without explicitly requesting TradingView or live chart widgets, use
the app `Dashboard(template:"report")` workflow from the stock/fund skill
instead of this skill.

## Core Rules

- Use TradingView widgets for visual live display: price, change percentage,
  ticker tape, market overview, heatmaps, K-line charts, symbol information,
  and technical ratings.
- Use `MarketData`, `DataStore`, `WindMcp`, TDX, EastMoney, or AkShare for
  calculations, sorting, scoring, persistence, alerts, and fallback DOM data.
- Do not scrape values from TradingView widget DOM.
- Every important TradingView panel must have a local fallback from
  `Bridge.fetch('/api/finance/...')` or persisted `DataStore` rows.
- TradingView visual widgets and local fallback data are separate sources. Do
  not imply they are synchronized unless the page has verified the same
  provider/as-of value. Show source labels and timestamps for the local
  fallback: provider/source, data time/as-of, and retrieved-at/fetched-at. If
  the TradingView widget does not expose a timestamp, label it as
  `TradingView visual quote (provider timestamp unavailable)` rather than
  treating its visible number as canonical evidence.
- Dashboard answers must mention any visible mismatch between TradingView and
  local fallback data as a source/timing caveat, not as a hidden success.
- Keep generated TradingView dashboards bounded. For first-pass stock
  dashboards, prefer one chart, one quote/fallback block, one technical summary,
  one fundamentals/risk block, and one concise source-time note. Avoid writing
  large custom pages when a Dashboard template or compact HTML can satisfy the
  user intent.
- Do not invent Bridge routes in generated pages. Supported normal finance
  routes include `/api/finance/quote`, `/api/finance/index/quotes`,
  `/api/finance/kline`, `/api/finance/technical`, and `/api/finance/news`.
- Generated FinAgent Workstation WebView pages must use the native preload-injected
  `Bridge`; never define `window.Bridge`, `window.AgentBridge`, or mock bridge
  wrappers.
- Agent-side data preparation and dashboard updates should use `MarketData`,
  `DataStore`, `ServiceCall`, and `UIControl(pushData/openPage/refresh)`.
  Do not use `WebView(action:"execute")` to fetch fallback quote data or patch
  dashboard DOM as the normal workflow; reserve WebView execution for
  inspection, screenshots, and narrow UI debugging.

## Load The Right Reference

Read only the minimal reference files needed for the task. For multi-widget
dashboards, it is acceptable to read the chart, dynamic-widget, and Bridge
fallback references once each; do not reread the same reference.

| Task | Read |
|------|------|
| Choose widgets or dashboard layout | `{{SKILL_DIR}}/references/widgets.md` |
| Main K-line / candlestick widget | `{{SKILL_DIR}}/references/advanced-chart.md` |
| Live price cards, quote digits, technical ratings, ticker tape | `{{SKILL_DIR}}/references/dynamic-digits.md` |
| TradingView Scanner fields and examples | `{{SKILL_DIR}}/references/scanner.md` |
| FinAgent Workstation Bridge fallback and Event Agent calls | `{{SKILL_DIR}}/references/finagent-workstation-bridge.md` |

## Quick Workflow

1. Decide if TradingView is only visual display or if Scanner data is also
   needed.
2. Fetch or reuse structured data first with `MarketData` / `DataStore` /
   `Bridge.fetch`.
3. Add TradingView widgets for the live visual layer.
4. Add fallback DOM from structured data so the dashboard still works if
   TradingView scripts fail.
5. For China-market dashboards, use red-up / green-down chart overrides from
   `advanced-chart.md`.

## Symbol Format

- A-share: `SSE:600519`, `SZSE:000001`
- China indices: `SSE:000001`, `SZSE:399001`, `SZSE:399006`
- Hong Kong: `HKEX:700`
- US: `NASDAQ:AAPL`, `NYSE:BABA`
- ETFs: `AMEX:SPY`, `NASDAQ:QQQ`
- Commodities/futures: `TVC:USOIL`, `TVC:UKOIL`, `NYMEX:CL1!`,
  `ICEEUR:BRN1!`
