# FinAgent Workstation Bridge Fallback

Generated WebView pages must use the native preload-injected `Bridge`.

- Do not define `window.Bridge`, `window.AgentBridge`, or mock bridge wrappers.
- In WebView pages, all Bridge calls return Promises; use `async` handlers and
  `await`.
- Use `Bridge.fetch(path, params, method)` with route params in the params
  object. Prefer `/api/finance/quote` + `{ code: "600519" }` over embedding a
  query string in the path.
- The short logical path is: agent tools fetch/compute data, `UIControl(pushData)`
  sends live updates, and page code receives them through `Bridge.onPush`.
  Do not ask the agent to run `WebView(action:"execute")` just to fetch fallback
  data or mutate dashboard DOM. Use WebView execution only for inspection or
  debugging an already-open page.
- If `Bridge` is unavailable, show a small inline error and log
  `console.error`; the page is not running in the expected FinAgent Workstation WebView
  preload context or needs to be reopened/refreshed.
- `Bridge.sendToAgent(...)` success means Event Agent queue acceptance only,
  not task completion.

Fallback quote example:

```html
<section class="quote-card">
  <div class="source-note">TradingView visual quote · provider timestamp unavailable</div>
  <div class="tradingview-widget-container">
    <div class="tradingview-widget-container__widget"></div>
    <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js" async>
    {"symbol":"SSE:600519","width":"100%","colorTheme":"dark","locale":"zh_CN"}
    </script>
  </div>
  <div class="fallback-quote" id="fallback-600519">Loading local quote...</div>
</section>
<script>
async function loadLocalQuote() {
  try {
    const resp = await Bridge.fetch('/api/finance/quote', { code: '600519' }, 'GET');
    const q = (resp.data || [])[0];
    if (q) {
      const source = q.source || q.provider || resp.source || 'local';
      const asOf = q.asOf || q.as_of || q.timestamp || q.time || 'unknown';
      const fetchedAt = q.fetchedAt || q.fetched_at || resp.fetchedAt || new Date().toISOString();
      document.getElementById('fallback-600519').textContent =
        `Local fallback: ${q.name || q.code} ${q.price} (${q.changePct}%) · source ${source} · data time ${asOf} · retrieved at ${fetchedAt}`;
    }
  } catch (err) {
    console.error('local quote fallback failed', err);
  }
}
loadLocalQuote();
</script>
```

Event Agent request pattern:

```js
async function requestAgentUpdate(prompt, file, stocks) {
  if (typeof Bridge === "undefined" || typeof Bridge.sendToAgent !== "function") {
    throw new Error("Bridge API is only available inside FinAgent Workstation WebView");
  }
  const result = await Bridge.sendToAgent("dashboard_request", { prompt, file, stocks });
  if (result && result.error) throw new Error(result.error);
  return result;
}
```

Live update pattern:

```js
Bridge.onPush("quotes", function(payload) {
  for (const quote of payload.quotes || []) {
    const el = document.querySelector(`[data-code="${quote.code}"] .fallback-quote`);
    if (el) el.textContent = `${quote.name || quote.code} ${quote.price} (${quote.changePct}%)`;
  }
});
```

Agent-side update:

```json
{
  "action": "pushData",
  "params": {
    "id": "dash-stock-picks",
    "channel": "quotes",
    "data": { "quotes": [{ "code": "600519", "price": 1281.91, "changePct": -1.94 }] }
  }
}
```
