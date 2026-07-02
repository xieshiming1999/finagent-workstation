---
description: Build an auto-refreshing monitor dashboard in FinAgent Workstation and pair it with durable `MonitorCreate` background monitoring.
when_to_use: User asks for a price monitor, alert panel, auto-refreshing dashboard, or a long-running background monitor in FinAgent Workstation.
---

Build a visual monitor dashboard from the monitor template. For durable background monitoring, use `MonitorCreate` rather than mobile-only background page actions.

## Template

Use `Dashboard(template:"monitor")`. It already includes:
- interval polling with `setInterval`
- state indicators
- threshold checks plus automatic agent notification
- an activity log panel

## Creation flow

1. Load the template with `Dashboard(template: "monitor")`
2. Update `{{TITLE}}`, `CONFIG.monitors[]`, and `CONFIG.interval`
3. Write `{{DATA_DIR}}/memory/pages/<name>-monitor.html`
4. Open it with `UIControl(action: "openPage", ...)`
5. Use `MonitorCreate` for durable long-running monitoring and `MonitorList` for status

## Example CONFIG using local finance routes

```js
var CONFIG = {
  interval: 30000,
  monitors: [
    {
      id: 'stock_600519',
      label: 'Kweichow Moutai',
      unit: 'CNY',
      apiUrl: '/api/finance/quote',
      apiParams: {code: '600519'},
      extract: function(resp) {
        var rows = resp.data || [];
        var row = rows[0];
        return row ? parseFloat(row.price || row['最新价']) : null;
      },
      threshold: function(val, prevVal) {
        if (val > 2000) return { status: 'error', message: 'Moutai broke above 2000, now ' + val };
        if (val < 1800) return { status: 'warn', message: 'Moutai fell below 1800, now ' + val };
        return { status: 'ok' };
      }
    },
    {
      id: 'index_sh',
      label: 'Shanghai Composite',
      unit: 'pt',
      apiUrl: '/api/finance/index/quotes',
      apiParams: {code: '000001'},
      extract: function(resp) {
        var rows = resp.data || [];
        var row = rows[0];
        return row ? parseFloat(row.price || row['最新价']) : null;
      },
      threshold: function(val) {
        if (val < 3000) return { status: 'error', message: 'Shanghai Composite fell below 3000' };
        return { status: 'ok' };
      }
    }
  ]
};
```

Important: in FinAgent Workstation WebViews, use the preload-injected `Bridge.fetch('/api/finance/...', params)`. Do not invent a custom bridge, and do not reuse the mobile full-URL rule in desktop pages.

## Threshold behavior

When `threshold()` returns `warn` or `error`:
1. the state indicator changes color
2. the activity log records the event
3. `Bridge.sendToAgent(message, data)` notifies the agent
4. the event agent can decide what to do next

## Background operation

In FinAgent Workstation, durable monitoring belongs to `MonitorCreate`, not dashboard page background actions:

```text
MonitorCreate(name: "...", script: "...", intervalSeconds: 60, displayType: "value_card")
MonitorList()
```

The dashboard is for visualization. The monitor handles scheduling, alerts, and event-agent messaging.

## Common use cases

Load `Skill(skill: "tradingview")` first if the page will embed TradingView visuals. Threshold logic and notifications must still use structured data from `Bridge.fetch`, `DataStore`, or `MarketData`, not DOM scraping.

- stock-price alerts
- index-level alerts
- buy or sell target reminders
- oil-price or spread checks
- market-breadth and sentiment panels

## Pre-run check

Before starting a long-running monitor, check available memory through `Environment`. If available memory is below 500MB, warn the user.

## Design rules

- dark theme `#131722`
- state colors: green, yellow, red
- avoid intervals below 10 seconds
- store files under `{{DATA_DIR}}/memory/pages/`
- use a `-monitor` suffix in the filename
