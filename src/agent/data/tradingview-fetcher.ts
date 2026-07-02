const TV_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.tradingview.com',
  'Referer': 'https://www.tradingview.com/',
  'Content-Type': 'application/json',
}

const TF_SUFFIX: Record<string, string> = {
  '5m': '|5', '15m': '|15', '30m': '|30',
  '1h': '|60', '2h': '|120', '4h': '|240',
  '1d': '', '1w': '|1W', '1M': '|1M',
}

const DEFAULT_INDICATORS = [
  'close', 'open', 'high', 'low', 'volume',
  'RSI', 'MACD.macd', 'MACD.signal',
  'BB.upper', 'BB.lower',
  'EMA20', 'EMA50', 'SMA20', 'SMA50',
  'ADX', 'Stoch.K', 'Stoch.D',
  'Recommend.All', 'Recommend.MA', 'Recommend.Other',
]

const EXCHANGE_TO_MARKET: Record<string, string> = {
  BINANCE: 'crypto', COINBASE: 'crypto', BYBIT: 'crypto', OKX: 'crypto',
  NASDAQ: 'america', NYSE: 'america', AMEX: 'america',
  HKEX: 'hongkong', HK: 'hongkong',
  SSE: 'china', SZSE: 'china',
  TWSE: 'taiwan', ASX: 'australia', BIST: 'turkey',
}

export function detectMarket(symbol: string): string {
  const exchange = symbol.split(':')[0]
  if (EXCHANGE_TO_MARKET[exchange]) return EXCHANGE_TO_MARKET[exchange]
  if (symbol.endsWith('.HK')) return 'hongkong'
  if (/^\d{6}$/.test(symbol)) return 'china'
  return 'america'
}

export async function tvScan(
  tickers: string[],
  indicators?: string[],
  timeframe = '1d',
  market?: string,
): Promise<Array<Record<string, unknown>>> {
  const ind = indicators ?? DEFAULT_INDICATORS
  const mkt = market ?? detectMarket(tickers[0] ?? '')
  const sfx = TF_SUFFIX[timeframe] ?? ''
  const columns = sfx ? ind.map((i) => i + sfx) : ind

  const res = await fetch(`https://scanner.tradingview.com/${mkt}/scan`, {
    method: 'POST',
    headers: TV_HEADERS,
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns,
    }),
  })

  if (!res.ok) throw new Error(`TradingView scanner error: ${res.status}`)
  const json = await res.json() as any
  const data = json.data ?? []

  return data.map((row: any) => {
    const obj: Record<string, unknown> = { symbol: row.s }
    ind.forEach((name, i) => {
      const v = row.d?.[i]
      obj[name] = typeof v === 'number' ? +v.toFixed(4) : v
    })
    return obj
  })
}
