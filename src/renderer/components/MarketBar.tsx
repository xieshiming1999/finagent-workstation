import { useEffect, useState } from 'react'
import { useT } from '../store/useLanguageStore'
import { formatFinanceProvenance } from './finance-provenance'
import { uiSurfaceContract } from '../panels/ui-surface-contract'

interface IndexData {
  code: string
  name: string
  price: number
  changePct: number
  source?: string | null
  fetchedAt?: string | null
  cacheStatus?: string | null
}

const INDEX_CODES = ['000001', '399001', '399006', '000688', '000300', '000905', '000852', '000016']
const INDEX_LABELS: Record<string, string> = {
  '000001': '上证',
  '399001': '深成',
  '399006': '创业板',
  '000688': '科创50',
  '000300': '沪深300',
  '000905': '中证500',
  '000852': '中证1000',
  '000016': '上证50',
}
const PAGE_SIZE = 4
const MARKET_BAR_POLL_INTERVAL_MS = uiSurfaceContract('market-bar').pollIntervalMs ?? 30000
const MARKET_BAR_ROTATE_INTERVAL_MS = uiSurfaceContract('market-bar').rotateIntervalMs ?? 10000

export default function MarketBar() {
  const t = useT()
  const [indices, setIndices] = useState<IndexData[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchIndices = async () => {
      try {
        const result = await window.agent?.bridgeMessage({
          id: 'market-bar',
          type: 'http',
          path: '/api/finance/index/quotes',
          params: { code: INDEX_CODES.join(',') },
          method: 'GET',
        }) as any
        if (Array.isArray(result?.data) && result.data.length > 0) {
          setIndices(result.data.map((q: any) => {
            const code = String(q.code ?? '')
            return {
              code,
              name: INDEX_LABELS[code] ?? q.name?.replace('指数', '') ?? code,
              price: Number(q.price) || 0,
              changePct: Number(q.changePct) || 0,
              source: q.source ?? result.source ?? null,
              fetchedAt: q.fetchedAt ?? result.fetchedAt ?? null,
              cacheStatus: q.cacheStatus ?? result.cacheStatus ?? 'fresh',
            }
          }))
          setError(null)
        } else if (result?.error) {
          setError(formatMarketError(result.error, t))
        } else {
          setError(t('noIndexQuotesReturned'))
        }
      } catch (err) {
        setError(formatMarketError(err instanceof Error ? err.message : err, t))
      } finally {
        setLoading(false)
      }
    }

    fetchIndices()
    const timer = setInterval(fetchIndices, MARKET_BAR_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (indices.length <= PAGE_SIZE) {
      setPage(0)
      return
    }
    const timer = setInterval(() => {
      setPage((current) => (current + 1) % Math.ceil(indices.length / PAGE_SIZE))
    }, MARKET_BAR_ROTATE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [indices.length])

  if (indices.length === 0) {
    return (
      <div className="flex items-center gap-4 px-3 py-1 theme-bg-secondary text-xs theme-text-tertiary shrink-0">
        <span>{loading ? t('marketDataLoading') : `${t('marketDataUnavailable')}${error ? `: ${error}` : ''}`}</span>
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(indices.length / PAGE_SIZE))
  const visible = indices.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="flex items-center gap-3 px-3 py-1 theme-bg-secondary text-xs shrink-0 overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        {visible.map((idx) => (
          <div key={idx.code} className="flex items-center gap-1.5 shrink-0" title={indexProvenance(idx, t)}>
            <span className="theme-text-tertiary">{idx.name}</span>
            <span className={idx.changePct >= 0 ? 'theme-red' : 'theme-green'}>
              {idx.price.toFixed(2)}
            </span>
            <span className={`${idx.changePct >= 0 ? 'theme-red' : 'theme-green'}`}>
              {idx.changePct >= 0 ? '+' : ''}{idx.changePct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="ml-auto flex items-center gap-1 shrink-0" aria-hidden="true">
          {Array.from({ length: pageCount }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 w-1.5 rounded-full ${index === page ? 'bg-[#2962ff]' : 'theme-bg-tertiary'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function indexProvenance(index: IndexData, t: ReturnType<typeof useT>): string {
  return formatFinanceProvenance(index, {
    source: t('provenanceSource'),
    asOf: t('provenanceAsOf'),
    fetched: t('provenanceFetched'),
    updated: t('provenanceUpdated'),
    cache: t('provenanceCache'),
    fresh: t('provenanceFresh'),
  })
}

function formatMarketError(error: unknown, t: ReturnType<typeof useT>): string {
  const text = String(error ?? '')
  if (/ProxyError|HTTPSConnectionPool|RemoteDisconnected|Max retries exceeded/i.test(text)) {
    return t('indexQuoteBlocked')
  }
  if (/timeout|aborted/i.test(text)) return t('indexQuoteTimedOut')
  if (!text.trim()) return t('indexQuoteFailed')
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}
