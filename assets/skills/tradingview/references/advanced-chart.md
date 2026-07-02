# Advanced Chart Widget

Use official Advanced Chart widgets for generated FinAgent Workstation K-line
dashboards. Do not use raw `widgetembed` iframes or legacy `tv.js` snippets.

Script:

`https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`

Use chart intervals `D`, `W`, or `M` in generated dashboards. If the user asks
for minute-level charts, use local data/ECharts or link out to TradingView
instead of generating minute-level TradingView widgets.

For China-market dashboards, use red-up / green-down overrides:

```json
"overrides": {
  "mainSeriesProperties.candleStyle.upColor": "#ef5350",
  "mainSeriesProperties.candleStyle.downColor": "#26a69a",
  "mainSeriesProperties.candleStyle.borderUpColor": "#ef5350",
  "mainSeriesProperties.candleStyle.borderDownColor": "#26a69a",
  "mainSeriesProperties.candleStyle.wickUpColor": "#ef5350",
  "mainSeriesProperties.candleStyle.wickDownColor": "#26a69a"
}
```

Example:

```html
<div class="tradingview-widget-container" style="height:520px;width:100%">
  <div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
  {
    "autosize": true,
    "symbol": "SSE:600519",
    "interval": "D",
    "timezone": "Asia/Shanghai",
    "theme": "dark",
    "style": "1",
    "locale": "zh_CN",
    "hide_side_toolbar": false,
    "hide_top_toolbar": false,
    "hide_legend": false,
    "hide_volume": false,
    "allow_symbol_change": true,
    "details": true,
    "calendar": false,
    "save_image": false,
    "backgroundColor": "#131722",
    "gridColor": "rgba(148, 163, 184, 0.12)",
    "overrides": {
      "mainSeriesProperties.candleStyle.upColor": "#ef5350",
      "mainSeriesProperties.candleStyle.downColor": "#26a69a",
      "mainSeriesProperties.candleStyle.borderUpColor": "#ef5350",
      "mainSeriesProperties.candleStyle.borderDownColor": "#26a69a",
      "mainSeriesProperties.candleStyle.wickUpColor": "#ef5350",
      "mainSeriesProperties.candleStyle.wickDownColor": "#26a69a"
    }
  }
  </script>
</div>
```
