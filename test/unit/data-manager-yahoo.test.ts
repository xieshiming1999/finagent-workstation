import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('data-manager yahoo earnings bundle', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('builds the earnings bundle from the correct sidecar endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/yfinance/info?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: {
            trailingPE: 28.5,
            priceToBook: 6.7,
            enterpriseValue: '3.2T',
            sector: 'Technology',
          },
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/financials?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [
            { _index: 'Total Revenue', '2025-12-31': 120000000 },
          ],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/balance_sheet?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [
            { _index: 'Total Assets', '2025-12-31': 350000000 },
          ],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/cash_flow?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [
            { _index: 'Operating Cash Flow', '2025-12-31': 85000000 },
          ],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/recommendations?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [{ period: '0m', strongBuy: 10 }],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/institutional_holders?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [{ organization: 'Big Fund', position: 123456 }],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/mutualfund_holders?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [{ organization: 'Mutual Fund', position: 654321 }],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      if (url.includes('/yfinance/insider_transactions?symbol=AAPL')) {
        return new Response(JSON.stringify({
          data: [{ filerName: 'CEO', transactionText: 'Sale' }],
          symbol: 'AAPL',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const dm = await import('../../src/agent/data/data-manager')
    dm.clearCache()
    const bundle = await dm.getYahooEarnings('AAPL')

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/yfinance/earnings_dates?symbol=AAPL'),
      expect.anything(),
    )
    expect(bundle).toMatchObject({
      info: { sector: 'Technology' },
      defaultKeyStatistics: {
        trailingPE: 28.5,
        priceToBook: 6.7,
        enterpriseValue: '3.2T',
      },
      incomeStatementHistory: {
        incomeStatementHistory: [{ _index: 'Total Revenue', '2025-12-31': 120000000 }],
      },
      balanceSheetHistory: {
        balanceSheetStatements: [{ _index: 'Total Assets', '2025-12-31': 350000000 }],
      },
      cashflowStatementHistory: {
        cashflowStatements: [{ _index: 'Operating Cash Flow', '2025-12-31': 85000000 }],
      },
      recommendationTrend: {
        trend: [{ period: '0m', strongBuy: 10 }],
      },
      institutionOwnership: {
        ownershipList: [{ organization: 'Big Fund', position: 123456 }],
      },
      fundOwnership: {
        ownershipList: [{ organization: 'Mutual Fund', position: 654321 }],
      },
      insiderTransactions: {
        transactions: [{ filerName: 'CEO', transactionText: 'Sale' }],
      },
    })
  })
})
