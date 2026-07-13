import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { portfolioToolCopy } from '../runtime-copy'

interface PortfolioData {
  cash: number
  initialCash: number
  positions: Record<string, { shares: number; costPrice: number; buyDate: string }>
  trades: Array<Record<string, unknown>>
  totalCommission: number
  executionReceipts: Record<string, Record<string, unknown>>
}

const MARKET_DEFAULTS: Record<string, { cash: number; currency: string; commission: number; minCommission: number }> = {
  cn: { cash: 1_000_000, currency: 'CNY', commission: 0.0003, minCommission: 5 },
  us: { cash: 100_000, currency: 'USD', commission: 0, minCommission: 1 },
  hk: { cash: 500_000, currency: 'HKD', commission: 0.001, minCommission: 20 },
}
const STAMP_DUTY_RATE = 0.001
const TRANSFER_FEE_RATE = 0.00002

function filePath(basePath: string, market: string): string {
  return join(basePath, 'memory', `.portfolio_${market}.json`)
}

function load(basePath: string, market: string): PortfolioData {
  const fp = filePath(basePath, market)
  const defaults = MARKET_DEFAULTS[market] ?? MARKET_DEFAULTS.cn
  const empty: PortfolioData = { cash: defaults.cash, initialCash: defaults.cash, positions: {}, trades: [], totalCommission: 0, executionReceipts: {} }
  if (!existsSync(fp)) return empty
  try { return { ...empty, ...JSON.parse(readFileSync(fp, 'utf-8')) } } catch { return empty }
}

function save(basePath: string, market: string, data: PortfolioData) {
  const fp = filePath(basePath, market)
  mkdirSync(dirname(fp), { recursive: true })
  writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8')
}

export class PortfolioTool implements Tool {
  name = 'Portfolio'
  description = 'Paper trading portfolio: add/remove positions, buy/sell trades with full commission model, P&L snapshot, risk analysis. Use action="help".'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'remove', 'trade', 'preview_trade', 'snapshot', 'risk', 'history', 'clear', 'help'], description: 'Portfolio action' },
      symbol: { type: 'string', description: 'Stock code (e.g., 600519)' },
      shares: { type: 'number', description: 'Number of shares' },
      costPrice: { type: 'number', description: 'Cost price per share (for add action)' },
      side: { type: 'string', description: 'Trade side: buy or sell' },
      price: { type: 'number', description: 'Trade price per share' },
      idempotencyKey: { type: 'string', description: 'Required stable key for trade retries' },
      market: { type: 'string', description: 'Market: cn(A-share)/us(US)/hk(HK). Default: cn' },
    },
    required: ['action'],
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    const action = String(input.action ?? 'help').toLowerCase()
    return action === 'add' || action === 'remove' || action === 'trade' || action === 'clear'
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) {
      return portfolioToolCopy.validateAction()
    }
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help')
    const market = String(input.market ?? 'cn')
    const data = load(ctx.basePath, market)

    try {
      switch (action) {
        case 'help': return portfolioToolCopy.helpText()
        case 'add': return this.add(input, data, ctx.basePath, market)
        case 'remove': return this.remove(input, data, ctx.basePath, market)
        case 'trade': return this.trade(input, data, ctx.basePath, market)
        case 'preview_trade': return this.previewTrade(input, data, market)
        case 'snapshot': return this.snapshot(data, market)
        case 'risk': return this.risk(data)
        case 'history': return this.history(data)
        case 'clear': {
          const defaults = MARKET_DEFAULTS[market] ?? MARKET_DEFAULTS.cn
          save(ctx.basePath, market, { cash: defaults.cash, initialCash: defaults.cash, positions: {}, trades: [], totalCommission: 0, executionReceipts: {} })
          return portfolioToolCopy.cleared()
        }
        default:
          return toolError(portfolioToolCopy.unknownAction(action))
      }
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err))
    }
  }

  private add(input: Record<string, unknown>, data: PortfolioData, basePath: string, market: string): string {
    const symbol = input.symbol as string | undefined
    const shares = Number(input.shares)
    const costPrice = Number(input.costPrice)
    if (!symbol || !shares || !costPrice) {
      return toolError(portfolioToolCopy.missingAddFields())
    }

    data.positions[symbol] = { shares, costPrice, buyDate: today() }
    save(basePath, market, data)
    return portfolioToolCopy.added(symbol, shares, costPrice, Object.keys(data.positions).length)
  }

  private remove(input: Record<string, unknown>, data: PortfolioData, basePath: string, market: string): string {
    const symbol = input.symbol as string | undefined
    if (!symbol) return toolError(portfolioToolCopy.missingSymbol())
    delete data.positions[symbol]
    save(basePath, market, data)
    return portfolioToolCopy.removed(symbol, Object.keys(data.positions).length)
  }

  private trade(input: Record<string, unknown>, data: PortfolioData, basePath: string, market: string): string {
    const symbol = input.symbol as string | undefined
    const side = String(input.side ?? '').toLowerCase()
    const shares = Number(input.shares)
    const price = Number(input.price)
    const idempotencyKey = String(input.idempotencyKey ?? '').trim()
    if (!symbol || !side || !shares || !price || !idempotencyKey) {
      return toolError('symbol, side(buy/sell), shares, price, idempotencyKey required')
    }
    if (side !== 'buy' && side !== 'sell') {
      return toolError(portfolioToolCopy.invalidSide())
    }

    const mkt = MARKET_DEFAULTS[market] ?? MARKET_DEFAULTS.cn
    const isAShare = /^\d{6}$/.test(symbol)
    const order = { symbol, side, shares, price }
    const prior = data.executionReceipts[idempotencyKey]
    if (prior) {
      if (JSON.stringify(prior.order) !== JSON.stringify(order)) {
        return toolError('idempotencyKey already belongs to a different order')
      }
      return JSON.stringify({ ...prior, idempotentReplay: true }, null, 2)
    }

    // A-share lot size check
    if (isAShare && shares % 100 !== 0) {
      return toolError(portfolioToolCopy.invalidALotSize(shares))
    }

    const tradeValue = shares * price
    const commission = Math.max(tradeValue * mkt.commission, mkt.minCommission)
    const stampDuty = side === 'sell' ? tradeValue * STAMP_DUTY_RATE : 0
    const transferFee = tradeValue * TRANSFER_FEE_RATE
    const totalCost = commission + stampDuty + transferFee

    if (side === 'buy') {
      const needed = tradeValue + totalCost
      if (needed > data.cash) {
        return toolError(portfolioToolCopy.insufficientCash(needed.toFixed(2), data.cash.toFixed(2)))
      }
      data.cash -= needed

      const existing = data.positions[symbol]
      if (existing) {
        const newShares = existing.shares + shares
        const newCost = (existing.costPrice * existing.shares + price * shares) / newShares
        data.positions[symbol] = { shares: newShares, costPrice: +newCost.toFixed(2), buyDate: existing.buyDate }
      } else {
        data.positions[symbol] = { shares, costPrice: price, buyDate: today() }
      }
    } else if (side === 'sell') {
      const existing = data.positions[symbol]
      if (!existing) {
        return toolError(portfolioToolCopy.noPosition(symbol))
      }
      if (shares > existing.shares) {
        return toolError(portfolioToolCopy.insufficientPosition(existing.shares, shares))
      }

      // T+1 check
      if (isAShare && existing.buyDate === today()) {
        return toolError(portfolioToolCopy.tPlusOneBlocked(symbol))
      }

      data.cash += tradeValue - totalCost
      const remaining = existing.shares - shares
      if (remaining <= 0) {
        delete data.positions[symbol]
      } else {
        existing.shares = remaining
      }
    }

    data.trades.push({
      symbol, side, shares, price, date: today(),
      commission: +commission.toFixed(2),
      stampDuty: +stampDuty.toFixed(2),
      totalCost: +totalCost.toFixed(2),
    })
    data.totalCommission += totalCost
    const receipt = {
      contract: 'finagent.execution-receipt.v1',
      action: 'trade',
      sideEffect: true,
      executionStatus: 'executed',
      executionVenue: 'local_paper_portfolio',
      externalBrokerStatus: 'not_external_broker',
      idempotencyKey,
      idempotentReplay: false,
      market,
      currency: mkt.currency,
      order,
      postTradeReadback: this.postTradeReadback(data, market, symbol),
      executedAt: new Date().toISOString(),
      tradeBoundary: 'Local Portfolio(action:"trade") mutates only the local paper portfolio. It does not execute or sync a Xueqiu/broker order.',
    }
    data.executionReceipts[idempotencyKey] = receipt
    save(basePath, market, data)
    return JSON.stringify(receipt, null, 2)
  }

  private previewTrade(input: Record<string, unknown>, data: PortfolioData, market: string): string {
    const symbol = input.symbol as string | undefined
    const side = input.side as string | undefined
    const shares = Number(input.shares)
    const price = Number(input.price)
    if (!symbol || !side || !(shares > 0) || !(price > 0)) {
      return toolError(portfolioToolCopy.missingTradeFields())
    }
    const normalizedSide = side.toLowerCase()
    if (normalizedSide !== 'buy' && normalizedSide !== 'sell') {
      return toolError(portfolioToolCopy.invalidSide())
    }

    const mkt = MARKET_DEFAULTS[market] ?? MARKET_DEFAULTS.cn
    const isAShare = /^\d{6}$/.test(symbol)
    const tradeValue = shares * price
    const commission = Math.max(tradeValue * mkt.commission, mkt.minCommission)
    const stampDuty = normalizedSide === 'sell' ? tradeValue * STAMP_DUTY_RATE : 0
    const transferFee = tradeValue * TRANSFER_FEE_RATE
    const totalCost = commission + stampDuty + transferFee
    const existing = data.positions[symbol]
    const errors: string[] = []
    const warnings: string[] = []

    if (isAShare && shares % 100 !== 0) {
      errors.push(portfolioToolCopy.invalidALotSize(shares))
    }
    if (normalizedSide === 'buy') {
      const needed = tradeValue + totalCost
      if (needed > data.cash) {
        errors.push(portfolioToolCopy.insufficientCash(needed.toFixed(2), data.cash.toFixed(2)))
      }
    } else {
      if (!existing) {
        errors.push(portfolioToolCopy.noPosition(symbol))
      } else if (shares > existing.shares) {
        errors.push(portfolioToolCopy.insufficientPosition(existing.shares, shares))
      }
      if (isAShare && existing?.buyDate === today()) {
        errors.push(portfolioToolCopy.tPlusOneBlocked(symbol))
      }
    }

    const postCash = normalizedSide === 'buy'
      ? data.cash - tradeValue - totalCost
      : data.cash + tradeValue - totalCost
    if (postCash < 0) warnings.push('postTradeCash would be negative; execution is blocked until order size or cash changes.')

    return JSON.stringify({
      action: 'preview_trade',
      sideEffect: false,
      executionAllowed: errors.length === 0,
      market,
      currency: mkt.currency,
      order: { symbol, side: normalizedSide, shares, price },
      estimated: {
        tradeValue: +tradeValue.toFixed(2),
        commission: +commission.toFixed(2),
        stampDuty: +stampDuty.toFixed(2),
        transferFee: +transferFee.toFixed(2),
        totalCost: +totalCost.toFixed(2),
        cashBefore: +data.cash.toFixed(2),
        cashAfter: +postCash.toFixed(2),
      },
      currentPosition: existing ?? null,
      errors,
      warnings,
      nextStep: errors.length === 0
        ? 'Ask for explicit confirmation before Portfolio(action:"trade") or any XueqiuTrade write.'
        : 'Fix the blocking errors before asking for execution confirmation.',
    }, null, 2)
  }

  private snapshot(data: PortfolioData, market: string): string {
    const positions = Object.entries(data.positions)
    if (positions.length === 0) {
      return JSON.stringify({
        action: 'snapshot',
        market,
        cash: +data.cash.toFixed(2),
        positionValue: 0,
        totalAssets: +data.cash.toFixed(2),
        initialCash: data.initialCash,
        totalPnl: +(data.cash - data.initialCash).toFixed(2),
        totalPnlPct: data.initialCash > 0
          ? +(((data.cash - data.initialCash) / data.initialCash) * 100).toFixed(2)
          : 0,
        totalCommission: +data.totalCommission.toFixed(2),
        positions: 0,
        holdings: [],
      }, null, 2)
    }

    let totalValue = 0
    const rows = positions.map(([symbol, pos]) => {
      const value = pos.costPrice * pos.shares
      totalValue += value
      return {
        symbol,
        shares: pos.shares,
        costPrice: pos.costPrice,
        currentPrice: pos.costPrice,
        value: +value.toFixed(2),
        pnl: 0,
        pnlPct: 0,
        buyDate: pos.buyDate,
      }
    })

    const totalAssets = data.cash + totalValue
    const totalPnl = totalAssets - data.initialCash
    const totalPnlPct = data.initialCash > 0 ? totalPnl / data.initialCash * 100 : 0

    return JSON.stringify({
      action: 'snapshot',
      market,
      cash: +data.cash.toFixed(2),
      positionValue: +totalValue.toFixed(2),
      totalAssets: +totalAssets.toFixed(2),
      initialCash: data.initialCash,
      totalPnl: +totalPnl.toFixed(2),
      totalPnlPct: +totalPnlPct.toFixed(2),
      totalCommission: +data.totalCommission.toFixed(2),
      positions: rows.length,
      holdings: rows,
    }, null, 2)
  }

  private risk(data: PortfolioData): string {
    const positions = Object.entries(data.positions)
    if (positions.length === 0) return portfolioToolCopy.emptyPortfolio()

    let totalValue = 0
    const holdings: Array<{ symbol: string; value: number; pnlPct: number }> = []
    const alerts: string[] = []
    for (const [symbol, pos] of positions) {
      const value = pos.costPrice * pos.shares
      totalValue += value
      holdings.push({ symbol, value, pnlPct: 0 })
    }

    const concentration = holdings
      .map((h) => {
        const weight = totalValue > 0 ? +(h.value / totalValue * 100).toFixed(1) : 0
        if (weight > 20) {
          alerts.push(portfolioToolCopy.concentrationAlert(h.symbol, weight))
        }
        return { symbol: h.symbol, weight }
      })
      .sort((a, b) => b.weight - a.weight)

    return JSON.stringify({
      action: 'risk',
      totalValue: +totalValue.toFixed(2),
      positions: holdings.length,
      concentration,
      ...(alerts.length > 0 ? { alerts } : {}),
    }, null, 2)
  }

  private history(data: PortfolioData): string {
    if (data.trades.length === 0) return portfolioToolCopy.noTradeHistory()
    const recent = data.trades.slice(-20)
    return JSON.stringify({ action: 'history', total: data.trades.length, recent }, null, 2)
  }

  private postTradeReadback(data: PortfolioData, market: string, symbol: string): Record<string, unknown> {
    let positionValue = 0
    for (const pos of Object.values(data.positions)) {
      positionValue += pos.costPrice * pos.shares
    }
    const totalAssets = data.cash + positionValue
    const symbolPosition = data.positions[symbol] ?? null
    const lastTrade = data.trades.length > 0 ? data.trades[data.trades.length - 1] : null
    return {
      source: 'local_paper_portfolio',
      readbackAction: 'portfolio_snapshot_after_trade',
      readbackStatus: 'verified',
      market,
      positionsCount: Object.keys(data.positions).length,
      cash: +data.cash.toFixed(2),
      positionValue: +positionValue.toFixed(2),
      totalAssets: +totalAssets.toFixed(2),
      symbol,
      symbolPosition,
      tradeCount: data.trades.length,
      lastTrade,
      fetchedAt: new Date().toISOString(),
    }
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}
