import { useEffect, useMemo, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'
import {
  buildNewsFeedSummary,
  buildNewsProvenanceTooltip,
  filterNewsRows,
  isHeadlineOnlyNews,
  newsBodyText,
  newsSourceTime,
  newsUrl,
  type NewsItem,
  type NewsFeedRouteProvenance,
} from './news-feed-model'

const NEWS_FEED_POLL_INTERVAL_MS = sidebarPanelContract('news').pollIntervalMs ?? 300000
const DEFAULT_NEWS_QUERY = 'A股 财经 市场'

export default function NewsFeedWidget() {
  const t = useT()
  const [news, setNews] = useState<NewsItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [routeProvenance, setRouteProvenance] = useState<NewsFeedRouteProvenance | null>(null)
  const [expandedNews, setExpandedNews] = useState<Record<string, boolean>>({})

  const fetchNews = async () => {
    setLoading(true)
    try {
      const typedQuery = query.trim()
      const result = await window.agent?.bridgeMessage({
        id: 'news-feed', type: 'http',
        path: '/api/finance/news',
        params: typedQuery
          ? { query: typedQuery, enrich: 'true', max_enrich: '8' }
          : { priority_query: DEFAULT_NEWS_QUERY, enrich: 'true', max_enrich: '8' },
        method: 'GET',
      }) as any
      const rows = Array.isArray(result?.data) ? result.data : []
      setNews(rows.slice(0, 50))
      setRouteProvenance(result?.provenance && typeof result.provenance === 'object' ? result.provenance as NewsFeedRouteProvenance : null)
      setUpdatedAt(new Date().toISOString())
      setError(result?.error ? String(result.error) : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNews()
    const timer = setInterval(fetchNews, NEWS_FEED_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const filtered = useMemo(() => {
    return filterNewsRows(news, query)
  }, [news, query])

  const summary = useMemo(() => buildNewsFeedSummary(news), [news])

  const analyze = async (item: NewsItem) => {
    await window.agent?.send([
      'Analyze this market news item. Use local market data first, then fetch only missing context.',
      `Title: ${item.title}`,
      item.summary ? `Summary: ${item.summary}` : '',
      item.content ? `Content: ${truncate(item.content, 1200)}` : '',
      item.source ? `Source: ${item.source}` : '',
      item.time ? `Time: ${item.time}` : '',
      newsUrl(item) ? `URL: ${newsUrl(item)}` : '',
      item.relatedSymbols?.length ? `Related symbols: ${item.relatedSymbols.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }

  const copyNews = (item: NewsItem) => {
    navigator.clipboard?.writeText([
      item.title,
      item.summary,
      item.content,
      item.source || item.time ? `${item.source || '-'} ${item.time || ''}`.trim() : '',
      newsUrl(item),
    ].filter(Boolean).join('\n'))
  }

  const openNews = (item: NewsItem) => {
    const url = newsUrl(item)
    if (!url) return
    window.agent?.openExternal(url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="px-3 py-2 border-b theme-border space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs theme-text font-medium">{t('newsFeed')}</div>
            <div className="text-[10px] theme-text-tertiary">
              {news.length} {t('latestNews')} · {summary.sources} {t('newsSources')}{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ''}
              {summary.headlineOnly > 0 ? ` · ${summary.headlineOnly} ${t('headlineOnlyNews')}` : ''}
            </div>
          </div>
          <button onClick={fetchNews} className="text-[10px] theme-text-tertiary hover:theme-accent px-1">{t('refresh')}</button>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('newsSearch')}
          className="w-full theme-bg-secondary border theme-border rounded px-2 py-1 text-xs theme-text-secondary focus:outline-none focus:border-[#2962ff]"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && news.length === 0 && <div className="p-4 text-xs theme-text-tertiary text-center">{t('loadingNewsRequiresSidecar')}</div>}
        {error && <div className="m-3 p-2 text-xs theme-red border theme-border rounded">{error}</div>}
        {!loading && !error && filtered.length === 0 && <div className="p-4 text-xs theme-text-tertiary text-center">{t('noNews')}</div>}
        {filtered.map((item, i) => {
          const key = newsItemKey(item, i)
          const body = newsBodyText(item)
          const expanded = Boolean(expandedNews[key])
          const sourceTime = newsSourceTime(item)
          const provenanceTooltip = buildNewsProvenanceTooltip(item, routeProvenance, {
            interface: t('dataInterface'),
            provider: t('provider'),
            capability: t('capability'),
            schema: t('schema'),
            table: t('table'),
            cache: t('provenanceCache'),
            dataTime: t('provenanceAsOf'),
            fetched: t('provenanceFetched'),
          }, updatedAt)
          return (
            <div key={key} className="px-3 py-2 border-b theme-border/30 hover:theme-bg-secondary">
              <div className="text-xs theme-text leading-tight">{item.title}</div>
              {body && (
                <div className={`text-[10px] theme-text-secondary mt-1 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-2'}`}>
                  {body}
                </div>
              )}
              {isHeadlineOnlyNews(item) && (
                <div className="text-[10px] theme-text-tertiary mt-1">{t('headlineOnlyNews')}</div>
              )}
              {item.relatedSymbols?.length ? (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {item.relatedSymbols.slice(0, 6).map((code) => (
                    <span key={code} className="font-mono text-[10px] theme-text-tertiary theme-bg-secondary px-1 rounded">{code}</span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-[10px] theme-text-tertiary mt-1">
                <span className="truncate">{item.source || '-'}</span>
                <span className="relative group/news-time font-mono shrink-0">
                  {formatNewsTime(sourceTime) || '-'}
                  <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[18rem] max-w-[30rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/news-time:opacity-100">
                    {provenanceTooltip}
                  </span>
                </span>
                <span className="flex-1" />
                {body && (
                  <button
                    onClick={() => setExpandedNews((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className="hover:theme-accent"
                  >
                    {expanded ? t('collapse') : t('expand')}
                  </button>
                )}
                {newsUrl(item) && <button onClick={() => openNews(item)} className="hover:theme-accent">{t('openNews')}</button>}
                <button onClick={() => copyNews(item)} className="hover:theme-accent">{t('copyNews')}</button>
                <button onClick={() => analyze(item)} className="hover:theme-accent">{t('analyzeNews')}</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function newsItemKey(item: NewsItem, index: number): string {
  return `${item.source || '-'}:${newsSourceTime(item) || '-'}:${newsUrl(item) || item.title}:${index}`
}

function formatNewsTime(value: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
