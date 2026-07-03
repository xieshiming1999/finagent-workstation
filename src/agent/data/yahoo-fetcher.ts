import type { Quote, KlineBar } from './eastmoney-fetcher'

const UA = 'Mozilla/5.0 (compatible; FinAgent/1.0)'

export async function yahooPrice(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { headers: { 'User-Agent': UA } },
    )
    if (!res.ok) return null
    const json = await res.json() as any
    const result = json.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta ?? {}
    const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((c: any) => c != null)
    const price = meta.regularMarketPrice
    const prev = closes.length >= 2 ? closes[closes.length - 2] : null

    return {
      symbol,
      price,
      previousClose: prev,
      changePct: price && prev ? +((price - prev) / prev * 100).toFixed(2) : null,
      currency: meta.currency,
      marketState: meta.marketState,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    }
  } catch {
    return null
  }
}

export async function yahooHistory(symbol: string, range = '6mo'): Promise<KlineBar[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': UA } },
    )
    if (!res.ok) return []
    const json = await res.json() as any
    const result = json.chart?.result?.[0]
    if (!result) return []

    const timestamps: number[] = result.timestamp ?? []
    const q = result.indicators?.quote?.[0] ?? {}
    const bars: KlineBar[] = []

    for (let i = 0; i < timestamps.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
      if (o == null || h == null || l == null || c == null) continue
      bars.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        open: o, high: h, low: l, close: c,
        volume: q.volume?.[i] ?? 0,
        amount: 0,
        changePct: null,
        turnoverRate: null,
      })
    }
    return bars
  } catch {
    return []
  }
}

export async function yahooEarnings(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=incomeStatementHistory,defaultKeyStatistics`,
      { headers: { 'User-Agent': UA } },
    )
    if (!res.ok) return null
    const json = await res.json() as any
    const result = json.quoteSummary?.result?.[0]
    if (!result) return null

    const stats = result.defaultKeyStatistics ?? {}
    const income = result.incomeStatementHistory?.incomeStatementHistory ?? []

    return {
      symbol,
      pe: stats.trailingPE?.raw ?? null,
      pb: stats.priceToBook?.raw ?? null,
      enterpriseValue: stats.enterpriseValue?.fmt ?? null,
      statements: income.slice(0, 4).map((s: any) => ({
        period: s.endDate?.fmt,
        revenue: s.totalRevenue?.raw,
        netProfit: s.netIncome?.raw,
        grossProfit: s.grossProfit?.raw,
        eps: s.dilutedEPS?.raw,
      })),
    }
  } catch {
    return null
  }
}
