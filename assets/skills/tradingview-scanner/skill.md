---
description: Free global-market data workflow covering TradingView technical indicators, Yahoo Finance prices, Reddit sentiment, and RSS news.
when_to_use: Use when the user needs technical indicators such as RSI, MACD, Bollinger Bands, ADX, buy-sell ratings, global prices, crypto quotes, market sentiment, or finance news.
---
# Global Market Data

This skill covers four free data sources, all callable directly through `WebFetch`. No server dependency is required for the basic fetch path.

TradingView dashboard widgets, dynamic price cards, chart embeds, heatmaps, and FinAgent Workstation bridge fallback rules are maintained in the separate `tradingview` skill. This skill only covers scanner and API retrieval.

## 1. TradingView Scanner

### Endpoint

```text
POST https://scanner.tradingview.com/{market}/scan
```

### Required browser-like headers

```json
{
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Origin": "https://www.tradingview.com",
  "Referer": "https://www.tradingview.com/"
}
```

### Request body for named symbols

```json
{
  "symbols": {
    "tickers": ["BINANCE:BTCUSDT", "NASDAQ:AAPL"],
    "query": { "types": [] }
  },
  "columns": ["close", "RSI", "MACD.macd", "MACD.signal", "BB.upper", "BB.lower", "EMA50", "SMA20", "ADX", "Recommend.All"]
}
```

### Request body for exchange-wide scans

```json
{
  "markets": ["crypto"],
  "symbols": { "query": { "types": [] } },
  "columns": ["close", "RSI", "Recommend.All", "volume"],
  "filter": [
    { "left": "exchange", "operation": "equal", "right": "BINANCE" }
  ],
  "sort": { "sortBy": "volume", "sortOrder": "desc" },
  "range": [0, 50]
}
```

### Response structure

```json
{
  "totalCount": 850,
  "data": [
    { "s": "BINANCE:BTCUSDT", "d": [68500.0, 62.3, 150.2, 120.5, 69000.0, 67000.0, 67800.0, 68200.0, 25.1, 0.3] }
  ]
}
```

The `d` array follows the order of the requested `columns`.

### Multi-timeframe suffixes

| Period | Suffix | Example |
|---|---|---|
| 5m | `\|5` | `close\|5`, `RSI\|5` |
| 15m | `\|15` | `MACD.macd\|15` |
| 1h | `\|60` | `BB.upper\|60` |
| 4h | `\|240` | `EMA50\|240` |
| Daily | none | `close`, `RSI` |
| Weekly | `\|1W` | `close\|1W` |
| Monthly | `\|1M` | `SMA20\|1M` |

### Useful columns

- OHLCV: `open`, `close`, `high`, `low`, `volume`
- Moving averages: `SMA10`, `SMA20`, `SMA30`, `SMA50`, `SMA100`, `SMA200`, `EMA9`, `EMA10`, `EMA20`, `EMA30`, `EMA50`, `EMA100`, `EMA200`
- Bollinger: `BB.upper`, `BB.lower`
- RSI: `RSI`, `RSI[1]`
- MACD: `MACD.macd`, `MACD.signal`
- Stochastics: `Stoch.K`, `Stoch.D`
- ADX: `ADX`, `ADX+DI`, `ADX-DI`
- Other: `ATR`, `VWAP`, `CCI20`, `W.R`, `AO`, `Mom`, `P.SAR`, `Ichimoku.BLine`, `Stoch.RSI.K`, `HullMA9`, `VWMA`, `UO`, `volume.SMA20`
- Ratings: `Recommend.All`, `Recommend.MA`, `Recommend.Other`
- Pivots: `Pivot.M.Classic.Middle`, `Pivot.M.Classic.R1/R2/R3`, `Pivot.M.Classic.S1/S2/S3`

### Exchange to market mapping

| Exchange | Market value | Symbol prefix |
|---|---|---|
| Binance / KuCoin / OKX / Bybit / Coinbase | `crypto` | `BINANCE:`, `KUCOIN:`, `OKX:` |
| NASDAQ / NYSE / AMEX | `america` | `NASDAQ:`, `NYSE:`, `AMEX:` |
| HKEX | `hongkong` | `HKEX:` |
| SSE / SZSE | `china` | `SSE:`, `SZSE:` |
| TWSE / TPEX | `taiwan` | `TWSE:`, `TPEX:` |
| ASX | `australia` | `ASX:` |

### Example POST call

```text
WebFetch(
  url: "https://scanner.tradingview.com/crypto/scan",
  method: "POST",
  headers: {"Content-Type":"application/json","Origin":"https://www.tradingview.com","Referer":"https://www.tradingview.com/"},
  body: "{\"symbols\":{\"tickers\":[\"BINANCE:BTCUSDT\",\"BINANCE:ETHUSDT\"],\"query\":{\"types\":[]}},\"columns\":[\"close\",\"RSI\",\"MACD.macd\",\"MACD.signal\",\"Recommend.All\",\"volume\"]}"
)
```

## 2. Yahoo Finance prices

### Endpoint

```text
GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=2d
```

### Symbol formats

| Asset type | Format | Example |
|---|---|---|
| US equities | plain ticker | `AAPL`, `TSLA`, `NVDA` |
| Crypto | `XXX-USD` | `BTC-USD`, `ETH-USD`, `SOL-USD` |
| ETFs | plain ticker | `SPY`, `QQQ`, `GLD` |
| Indices | `^code` | `^GSPC`, `^IXIC`, `^VIX` |
| FX | `XXXYYY=X` | `EURUSD=X`, `GBPUSD=X` |

### Important response fields

The key fields are `regularMarketPrice`, `currency`, `marketState`, and the `close` series inside `indicators.quote`.

Previous close is the second-to-last value in `close`.

### Common global snapshot symbols

```text
Indices: ^GSPC, ^DJI, ^IXIC, ^VIX
Crypto: BTC-USD, ETH-USD, SOL-USD, BNB-USD
FX: EURUSD=X, GBPUSD=X, JPYUSD=X
ETFs: SPY, QQQ, GLD
```

## 3. Reddit sentiment

### Endpoint

```text
GET https://www.reddit.com/r/{subreddit}/search.json?q={symbol}&sort=new&t=week&limit=10
```

### Useful subreddits

- Crypto: `CryptoCurrency`, `Bitcoin`, `ethereum`, `CryptoMarkets`
- Equities: `stocks`, `investing`, `wallstreetbets`, `StockMarket`

### Sentiment keywords

- Bullish: `buy`, `bull`, `moon`, `pump`, `long`, `breakout`, `bullish`, `rally`, `surge`, `undervalued`, `support`, `recovery`
- Bearish: `sell`, `bear`, `dump`, `short`, `crash`, `drop`, `bearish`, `tank`, `decline`, `overvalued`, `overbought`, `bubble`

Sentiment score:

```text
(bullish_count - bearish_count) / (bullish_count + bearish_count)
```

Range is `-1.0` to `+1.0`.

## 4. RSS finance news

| Source | URL |
|---|---|
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` |
| CoinTelegraph | `https://cointelegraph.com/rss` |
| Reuters Business | `https://feeds.reuters.com/reuters/businessNews` |

Use `WebFetch` with `GET` and parse `<title>`, `<link>`, `<pubDate>`, and `<description>`.

## Recommended workflow

1. Technical analysis: `MarketData(action: "scan", symbols: [...])`
2. Live prices: `MarketData(action: "price", symbols: [...])`
3. Sentiment: Reddit fetch plus sentiment scoring
4. News aggregation: RSS feeds
5. Final output: combine the above into a table, cards, or dashboard

Use `MarketData(action: "scan")` for normal screening. It returns the normalized
`market.screening` / `screening_result` output-only contract with provider,
status, warnings, rows, and provenance. Direct `WebFetch` POST to TradingView
Scanner is diagnostic or advanced fallback behavior only; do not treat raw
TradingView responses as normal structured workflow data unless a code-owned
normalizer/interface is added.

### Backtest use

```text
MarketData(action: "backtest", symbols: ["AAPL"], strategy: "rsi", period: "1y")
MarketData(action: "backtest", symbols: ["BTC-USD"], strategy: "compare")
```

Backtest output includes the equity curve, trades, and full performance metrics. Use `Dashboard(template:"backtest")` to visualize the result.

## Guardrails

- TradingView Scanner is unofficial and needs browser-like headers
- Yahoo data is delayed by roughly 15 minutes
- Reddit is open but should still be rate-limited
- No API key is required for the four core sources in this skill
