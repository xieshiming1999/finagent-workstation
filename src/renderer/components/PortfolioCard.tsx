import { useEffect, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'
import {
  buildPortfolioSummary,
  classifyPortfolioState,
  type PortfolioFile,
  type PortfolioSummary,
  type QuoteRow,
} from './portfolio-model'

const PORTFOLIO_PATH = 'memory/.portfolio_cn.json'
const PORTFOLIO_POLL_INTERVAL_MS = sidebarPanelContract('portfolio').pollIntervalMs ?? 30000

export default function PortfolioCard() {
  const t = useT()
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const result = await window.agent?.bridgeMessage({
          id: 'portfolio-card-read', type: 'readFile', path: PORTFOLIO_PATH,
        }) as any
        if (!result?.content) {
          setData(null)
          setError(null)
          return
        }

        const portfolio = JSON.parse(result.content) as PortfolioFile
        const positions = portfolio.positions ?? {}
        const codes = Object.keys(positions)
        const quotes = codes.length > 0 ? await fetchQuotes(codes) : []
        const summary = buildPortfolioSummary(portfolio, quotes)
        setData(summary)
        setError(null)
      } catch (err) {
        setData(null)
        setError(err instanceof Error ? err.message : t('fetchFailedText'))
      } finally {
        setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, PORTFOLIO_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const surfaceState = classifyPortfolioState({ loading, data, error })
  if (surfaceState.state === 'loading') {
    return <div className="p-3 text-xs theme-text-tertiary">{t('loading')}</div>
  }
  if (surfaceState.state === 'error') {
    return <div className="p-3 text-xs theme-red">{error ?? t('fetchFailedText')}</div>
  }
  if (!data) {
    return <div className="p-3 text-xs theme-text-tertiary">{t('noPortfolioData')}</div>
  }

  const pnlColor = data.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'

  return (
    <div className="p-3 space-y-3" style={{ color: 'var(--text-secondary)' }}>
      <div>
        <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{t('totalAssets')}</div>
        <div className="text-lg font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
          {(data.totalAssets / 10000).toFixed(2)}<span className="text-xs ml-0.5">{t('tenThousandUnit')}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <span style={{ color: 'var(--text-tertiary)' }}>{t('profitLoss')}</span>
          <div className="font-mono font-medium" style={{ color: pnlColor }}>
            {data.totalPnl >= 0 ? '+' : ''}{data.totalPnl.toFixed(0)}
            <span className="ml-1">({data.totalPnlPct >= 0 ? '+' : ''}{data.totalPnlPct.toFixed(2)}%)</span>
          </div>
        </div>
        <div>
          <span style={{ color: 'var(--text-tertiary)' }}>{t('cash')}</span>
          <div className="font-mono" style={{ color: 'var(--text-primary)' }}>{(data.cash / 10000).toFixed(1)}{t('tenThousandUnit')}</div>
        </div>
      </div>

      {data.positions.length > 0 && (
        <div>
          <div className="text-[10px] mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('positions')} ({data.positions.length})</div>
          {data.positions.map((p) => (
            <div key={p.code} className="flex items-center justify-between text-[10px] py-0.5">
              <span style={{ color: 'var(--text-primary)' }}>{p.code} {p.name}</span>
              <span className="font-mono" style={{ color: p.pnlPct >= 0 ? 'var(--red)' : 'var(--green)' }}>
                {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

async function fetchQuotes(codes: string[]): Promise<QuoteRow[]> {
  try {
    const result = await window.agent?.bridgeMessage({
      id: 'portfolio-card-quotes',
      type: 'http',
      path: '/api/finance/quote',
      params: { code: codes.join(',') },
      method: 'GET',
    }) as any
    if (!Array.isArray(result?.data)) return []
    return result.data.map((row: any) => ({
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      price: Number(row.price ?? 0),
    })).filter((row: QuoteRow) => row.code)
  } catch {
    return []
  }
}
