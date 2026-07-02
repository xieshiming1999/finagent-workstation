# Dynamic Digit Widgets

Use TradingView dynamic widgets for live visual display instead of static
hard-coded HTML numbers. Keep a local fallback for important numbers.

TradingView widgets are a visual source, not the canonical persisted data
source. When the widget is paired with local fallback data, label both layers:

- `TradingView visual quote` for the widget. If the widget does not expose a
  timestamp, state `provider timestamp unavailable`.
- `Local fallback` for Bridge/DataStore data, including provider/source,
  data time/as-of, and retrieved-at/fetched-at.

If the two layers show different price/change values, the page should display a
small data-status note such as `TradingView and local fallback may differ by
provider or timing`; the agent final answer should report that caveat.

Set the TradingView `locale` to match the current app language. The examples
below use English-first labels.

## Single Ticker

```html
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js" async>
  {
    "symbol": "SSE:600519",
    "width": "100%",
    "isTransparent": false,
    "colorTheme": "dark",
    "locale": "en"
  }
  </script>
</div>
```

## Technical Analysis

```html
<div class="tradingview-widget-container" style="height:420px;width:100%">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js" async>
  {
    "interval": "1D",
    "width": "100%",
    "height": "100%",
    "symbol": "SSE:600519",
    "showIntervalTabs": true,
    "displayMode": "single",
    "locale": "en",
    "colorTheme": "dark"
  }
  </script>
</div>
```

## Ticker Tape

```html
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js" async>
  {
    "symbols": [
      {"proName":"SSE:000001","title":"Shanghai Composite"},
      {"proName":"SZSE:399001","title":"Shenzhen Component"},
      {"proName":"NASDAQ:AAPL","title":"Apple"}
    ],
    "showSymbolLogo": true,
    "isTransparent": false,
    "displayMode": "adaptive",
    "colorTheme": "dark",
    "locale": "en"
  }
  </script>
</div>
```
