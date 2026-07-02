# TradingView Scanner

For structured technical snapshots, use the built-in tool first:

```json
MarketData(action: "scan", code: "SSE:600519,SZSE:000001", timeframe: "1d")
```

The scanner can return `close`, `open`, `high`, `low`, `volume`, `RSI`,
`MACD.macd`, `MACD.signal`, `BB.upper`, `BB.lower`, `EMA20`, `EMA50`,
`SMA20`, `SMA50`, `ADX`, `Stoch.K`, `Stoch.D`, `Recommend.All`,
`Recommend.MA`, and `Recommend.Other`.

Typical market names when using raw scanner endpoints:

- A-share: `china`, symbols like `SSE:600519`, `SZSE:000001`
- Hong Kong: `hongkong`, symbols like `HKEX:700`
- US: `america`, symbols like `NASDAQ:AAPL`, `NYSE:BABA`
- Crypto: `crypto`

Scanner data is useful for technical summary tables. It is not a replacement
for local quote/K-line persistence, ranking datasets, or alert calculations.

For raw POST examples and browser headers, load `tradingview-scanner`.
