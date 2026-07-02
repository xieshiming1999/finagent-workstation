# TradingView Widget Selection

TradingView widgets are display components. Use them for live visuals, not for
local persistence, ranking, scoring, or alerts.

## Selection Table

| Need | Widget | Use |
|------|--------|-----|
| Main candlestick chart | Advanced Chart | Stock/index/fund/commodity K-line visual |
| Live price card | Single Ticker | Price + change percentage |
| Symbol info panel | Symbol Info | Quote and basic symbol details |
| Mini chart card | Symbol Overview | Watchlist tiles and compact multi-symbol pages |
| Technical rating | Technical Analysis | Buy/sell rating, MA and oscillator summary |
| Top market strip | Ticker Tape | Dashboard header with indices/watchlist |
| Market groups | Market Overview / Market Data | Index/sector/commodity/FX overview |
| Market breadth | Stock Heatmap / ETF Heatmap / Crypto Heatmap | Risk/breadth visual |
| Interactive exploration | Screener | Visual scan by filters |
| Company context | Company Profile / Fundamental Data / Financials | Display-only company/fundamental panel |
| News/context | Top Stories / Timeline | Visual news stream |
| Macro events | Economic Calendar | Data release/event calendar |

## Dashboard Recipes

Individual stock page:

- `Single Ticker` at the top for live price/change.
- `Advanced Chart` as the main chart.
- `Technical Analysis` beside or below the chart.
- `Company Profile` or `Fundamental Data` if useful.
- Local fallback cards from `Bridge.fetch('/api/finance/quote', { code: '...' }, 'GET')`.

Watchlist / stock picks page:

- `Ticker Tape` at the top.
- `Symbol Overview` or `Single Ticker` per stock card.
- Local table from `DataStore` / `MarketData` for ranking, score, source, and
  notes.
- `Advanced Chart` only for the selected or expanded symbol to avoid heavy
  pages.

Market overview page:

- `Ticker Tape` header.
- `Market Overview` or `Market Data` for global/China indices.
- `Stock Heatmap` or `ETF Heatmap` for breadth.
- Local `Bridge.fetch('/api/finance/index/quotes')` and
  `Bridge.fetch('/api/finance/sector')` fallback panels.

Monitor dashboard:

- TradingView widgets for visual live numbers.
- `Bridge.fetch('/api/finance/quote')` or `/api/finance/index/quotes` for
  thresholds and Event Agent notifications.
- Never use widget DOM values for alert conditions.
