export type PortfolioSurfaceState = 'loading' | 'empty' | 'error' | 'cached'

export interface StoredPosition {
  shares: number
  costPrice: number
  buyDate?: string
}

export interface PortfolioFile {
  cash?: number
  initialCash?: number
  positions?: Record<string, StoredPosition>
}

export interface QuoteRow {
  code: string
  name: string
  price: number
}

export interface PortfolioSummary {
  cash: number
  totalValue: number
  totalAssets: number
  totalPnl: number
  totalPnlPct: number
  positions: Array<{ code: string; name: string; shares: number; pnlPct: number }>
}

export interface PortfolioStateSummary {
  state: PortfolioSurfaceState
  positionCount: number
  hasReadError: boolean
}

export function classifyPortfolioState(input: {
  loading: boolean
  data: PortfolioSummary | null
  error?: string | null
}): PortfolioStateSummary {
  if (input.loading) {
    return { state: 'loading', positionCount: 0, hasReadError: false }
  }
  if (input.error && !input.data) {
    return { state: 'error', positionCount: 0, hasReadError: true }
  }
  if (!input.data) {
    return { state: 'empty', positionCount: 0, hasReadError: false }
  }
  return {
    state: 'cached',
    positionCount: input.data.positions.length,
    hasReadError: Boolean(input.error),
  }
}

export function buildPortfolioSummary(portfolio: PortfolioFile, quotes: QuoteRow[]): PortfolioSummary {
  const cash = Number(portfolio.cash ?? portfolio.initialCash ?? 1_000_000)
  const initialCash = Number(portfolio.initialCash ?? cash)
  const quoteMap = new Map(quotes.map((row) => [row.code, row]))
  const rawPositions = Object.entries(portfolio.positions ?? {})

  const positions = rawPositions.map(([code, pos]) => {
    const quote = quoteMap.get(code)
    const currentPrice = quote?.price && quote.price > 0 ? quote.price : pos.costPrice
    const value = pos.shares * currentPrice
    const cost = pos.shares * pos.costPrice
    const pnl = value - cost
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
    return {
      code,
      name: quote?.name || code,
      shares: pos.shares,
      value,
      pnl,
      pnlPct,
    }
  })

  const totalValue = positions.reduce((sum, pos) => sum + pos.value, 0)
  const totalPnl = positions.reduce((sum, pos) => sum + pos.pnl, 0)
  const totalAssets = cash + totalValue
  const totalPnlPct = initialCash > 0 ? (totalAssets - initialCash) / initialCash * 100 : 0

  return {
    cash,
    totalValue,
    totalAssets,
    totalPnl,
    totalPnlPct,
    positions: positions.map((pos) => ({
      code: pos.code,
      name: pos.name,
      shares: pos.shares,
      pnlPct: pos.pnlPct,
    })),
  }
}
