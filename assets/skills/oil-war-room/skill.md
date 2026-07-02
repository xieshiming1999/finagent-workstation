description: Oil analysis plus a custom HTML dashboard using TradingView charts and free data APIs
when_to_use: User asks to analyze oil, create a dashboard, or build an oil war room
---
# Oil Analysis & Dashboard Skill

## Oil Data Sources

### TradingView charts
TradingView widgets, Advanced Chart examples, dynamic price cards, period limits, and fallback rules for oil dashboards are maintained in the separate `tradingview` skill. Load it before generating an oil chart page:

```
Skill(skill: "tradingview")
```

Use the official Advanced Chart widget when generating an oil dashboard. Do not hand-roll a `widgetembed` iframe. Only use `D`, `W`, and `M` periods. Do not generate minute-level TradingView widgets.

Common symbols:
- Brent: ICEEUR:BRN1! or TVC:UKOIL
- WTI: NYMEX:CL1! or TVC:USOIL
- Shanghai crude: INE:SC1!
- Dubai crude: NYMEX:DC1!

### Free API access
The agent should prefer local FinAgent Workstation Bridge/API routes:
- **FinAgent Workstation finance route**: `/api/finance/...`
- **AkShare sidecar**: `/api/finance/sidecar/akshare/<func>`
- **Yahoo Finance**: commodity prices (see the `tradingview-scanner` skill)
  - Brent: BZ=F, WTI: CL=F
- **TradingView Scanner**: real-time oil technicals (see the `tradingview-scanner` skill)
  - Brent: market=`cfd`, symbol `TVC:UKOIL`
  - WTI: market=`cfd`, symbol `TVC:USOIL`
  - Use it for RSI, MACD, Bollinger Bands, buy/sell ratings, and similar indicators

## JS Bridge

JavaScript inside the HTML page can call free APIs through the preload-injected `Bridge` in the FinAgent Workstation WebView. Do not define `window.Bridge`, `window.AgentBridge`, or any custom Bridge wrapper.

```js
async function callAPI(path, params = {}) {
  return await Bridge.fetch(path, params, "GET");
}
```

Important: FinAgent Workstation supports relative `/api/finance/...` paths. In WebView pages, Bridge APIs return Promises and must be `await`ed inside `async` functions.

## Dashboard Design Rules

- **Self-contained**: inline CSS/JS, no external CDN dependency
- **Dark theme**: background `#131722`, text `#d1d4dc`
- **Responsive**: use viewport units plus flexbox/grid
- **File location**: write pages under `{{DATA_DIR}}/memory/pages/`
- After every create/update, refresh the `{{DATA_DIR}}/memory/pages/INDEX.md` index

## Dashboard Template Reference

The skill folder includes `dashboard.html` with a 4-panel TradingView layout. Follow the newer page rules from the `tradingview` skill when they differ.

## Debug Logs

- `{{DATA_DIR}}/memory/.bridge_logs/bridge_<date>.log` - API call log
- `{{DATA_DIR}}/memory/.bridge_logs/js_errors_<date>.log` - JavaScript error log
