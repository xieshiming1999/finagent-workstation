import { type ReactNode, useEffect, useRef, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'
import { stockPickerPrimarySelection, stockPickerRows, type StockSuggestion } from './watchlist-picker-model'
import { formatFinanceProvenance, formatFinanceProvenanceTooltip } from './finance-provenance'
import {
  buildFallbackStockItem,
  buildFallbackStockItems,
  classifyStockWatchlistState,
  visibleStockItems,
  type StoredWatchItem,
  type WatchItem,
  type WatchlistData,
} from './watchlist-model'

const DEFAULT_CODES = '000001,600036,300750,601398,600519'
const DEFAULT_GROUP_ID = 'default'
const WATCHLIST_PATH = 'watchlists.json'
const LEGACY_CODES_PATH = 'watchlist_codes.json'
const WATCHLIST_QUOTE_POLL_INTERVAL_MS = sidebarPanelContract('watchlist').pollIntervalMs ?? 15000

export default function WatchlistWidget() {
  const t = useT()
  const [items, setItems] = useState<WatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addInput, setAddInput] = useState('')
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([])
  const [hotSuggestions, setHotSuggestions] = useState<StockSuggestion[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [watchlist, setWatchlist] = useState<WatchlistData>(createDefaultWatchlist(DEFAULT_CODES.split(','), t('defaultGroupName')))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadWatchlist()
    loadHotSuggestions()
    const reload = () => loadWatchlist()
    window.addEventListener('watchlist:stock-updated', reload)
    return () => window.removeEventListener('watchlist:stock-updated', reload)
  }, [])

  useEffect(() => {
    const activeItems = visibleStockItems(watchlist)
    if (activeItems.length === 0) {
      setItems([])
      setLoading(false)
      return
    }
    setItems(buildFallbackStockItems(activeItems))
    fetchQuotes(activeItems)
    timerRef.current = setInterval(() => fetchQuotes(visibleStockItems(watchlist)), WATCHLIST_QUOTE_POLL_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [watchlist])

  useEffect(() => {
    const query = addInput.trim()
    if (query.length < 2) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const rows = await (window as any).electron?.ipcRenderer?.invoke('data:stock-search', query, 8) as StockSuggestion[] | undefined
        setSuggestions(Array.isArray(rows) ? rows : [])
      } catch {
        setSuggestions([])
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [addInput])

  useEffect(() => {
    if (!pickerOpen) return
    const close = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      setPickerOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [pickerOpen])

  const loadWatchlist = async () => {
    try {
      const result = await window.agent?.bridgeMessage({
        id: 'wl-load-structured', type: 'readFile', path: WATCHLIST_PATH,
      }) as any
      if (result?.content) {
        const parsed = JSON.parse(result.content)
        if (Array.isArray(parsed?.groups) && Array.isArray(parsed?.items)) {
          setWatchlist(parsed)
          return
        }
      }
    } catch {
      // fall through to legacy/default compatibility path
    }

    const migrated = await loadLegacyOrDefaultWatchlist()
    setWatchlist(migrated)
    await saveWatchlist(migrated)
  }

  const loadLegacyOrDefaultWatchlist = async (): Promise<WatchlistData> => {
    try {
      const legacy = await window.agent?.bridgeMessage({
        id: 'wl-load-legacy', type: 'readFile', path: LEGACY_CODES_PATH,
      }) as any
      if (legacy?.content) {
        const parsed = JSON.parse(legacy.content)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return createDefaultWatchlist(parsed.map((value) => String(value)), t('defaultGroupName'))
        }
      }
    } catch {
      // ignore
    }
    return createDefaultWatchlist(DEFAULT_CODES.split(','), t('defaultGroupName'))
  }

  const saveWatchlist = async (data: WatchlistData) => {
    try {
      await window.agent?.bridgeMessage({
        id: 'wl-save-structured', type: 'writeFile', path: WATCHLIST_PATH,
        content: JSON.stringify(data, null, 2),
      })
    } catch {
      // ignore
    }
  }

  const loadHotSuggestions = async () => {
    try {
      const result = await window.agent?.bridgeMessage({
        id: 'wl-hot-suggestions', type: 'readFile', path: 'snapshots/latest.json',
      }) as any
      if (!result?.content) return
      const parsed = JSON.parse(result.content)
      const rows = Array.isArray(parsed?.hotStocks) ? parsed.hotStocks : []
      setHotSuggestions(rows.slice(0, 8).map((row: any) => ({
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
        market: guessMarket(String(row.code ?? '')),
        price: typeof row.price === 'number' ? row.price : null,
        changePct: typeof row.changePct === 'number' ? row.changePct : null,
      })).filter((row: StockSuggestion) => row.code))
    } catch {
      // ignore
    }
  }

  const fetchQuotes = async (activeItems: StoredWatchItem[]) => {
    if (activeItems.length === 0) return
    try {
      const result = await window.agent?.bridgeMessage({
        id: `wl-${Date.now()}`, type: 'http',
        path: '/api/finance/quote', params: { code: activeItems.map((item) => item.symbol).join(',') }, method: 'GET',
      }) as any
      if (result?.data && Array.isArray(result.data)) {
        const itemMeta = new Map(activeItems.map((item) => [item.symbol, item]))
        const routeCacheStatus = Number(result.freshCount ?? 0) > 0 ? 'fresh' : Number(result.cachedCount ?? 0) > 0 ? 'cache' : null
        const quoted = new Map<string, WatchItem>(result.data.map((q: any) => {
          const meta = itemMeta.get(String(q.code ?? ''))
          const item: WatchItem = {
            id: meta?.id ?? String(q.code ?? ''),
            code: q.code ?? '',
            name: q.name ?? meta?.name ?? '',
            price: q.price ?? 0,
            changePct: q.changePct ?? 0,
            change: q.change ?? 0,
            high: q.high ?? 0,
            low: q.low ?? 0,
            volume: q.volume ?? 0,
            pe: q.pe ?? null,
            turnoverRate: q.turnoverRate ?? null,
            source: q.source ?? (Array.isArray(result.freshSources) && result.freshSources.length === 1 ? result.freshSources[0] : null),
            timestamp: q.timestamp ?? null,
            fetchedAt: q.fetchedAt ?? q.fetched_at ?? null,
            cacheStatus: q.cacheStatus ?? q.cache_status ?? routeCacheStatus,
          }
          return [item.code, item] as [string, WatchItem]
        }))
        setItems(activeItems.map((item) => quoted.get(item.symbol) ?? buildFallbackStockItem(item)))
        setError(null)
      } else if (result?.error) {
        setError(String(result.error))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fetchFailedText'))
    }
    setLoading(false)
  }

  const addCode = async (suggestion?: StockSuggestion) => {
    const code = (suggestion?.code ?? addInput).trim().replace(/\.(SH|SZ|BJ)$/i, '')
    if (!code || watchlist.items.some((item) => item.symbol === code && item.status !== 'exited')) return
    const groupId = watchlist.groups.find((group) => group.id === DEFAULT_GROUP_ID)?.id ?? watchlist.groups[0]?.id ?? DEFAULT_GROUP_ID
    const next: WatchlistData = {
      groups: watchlist.groups.length > 0 ? watchlist.groups : [{ id: DEFAULT_GROUP_ID, name: t('defaultGroupName'), type: 'stock' }],
      items: [
        ...watchlist.items,
        {
          id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          groupId,
          symbol: code,
          name: suggestion?.name ?? '',
          type: 'stock',
          status: 'watching',
          source: 'widget',
          tags: [],
          priceAtAdd: 0,
          addedAt: new Date().toISOString(),
        },
      ],
    }
    setWatchlist(next)
    await saveWatchlist(next)
    setAddInput('')
    setSuggestions([])
    setPickerOpen(false)
  }

  const removeCode = async (itemId: string) => {
    const next = { ...watchlist, items: watchlist.items.filter((item) => item.id !== itemId) }
    setWatchlist(next)
    await saveWatchlist(next)
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  const refreshQuotes = async () => {
    setLoading(true)
    await fetchQuotes(visibleStockItems(watchlist))
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="flex items-center justify-between px-3 py-1.5 border-b theme-border">
        <span className="text-xs theme-text-tertiary font-medium">{t('watchlistCount')} ({items.length})</span>
        <button
          type="button"
          onClick={refreshQuotes}
          className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary"
        >
          {t('refresh')}
        </button>
      </div>

      <div className="px-3 py-2 border-b theme-border">
        <div ref={pickerRef} className="relative space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={addInput}
              onFocus={() => {
                setPickerOpen(true)
                loadHotSuggestions()
              }}
              onChange={(e) => {
                setAddInput(e.target.value)
                setPickerOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const selected = stockPickerPrimarySelection(
                    addInput,
                    suggestions,
                    hotSuggestions,
                    new Set(visibleStockItems(watchlist).map((item) => item.symbol)),
                  )
                  addCode(selected)
                }
                if (e.key === 'Escape') {
                  setSuggestions([])
                  setPickerOpen(false)
                }
              }}
              placeholder={t('code')}
              className="min-w-0 flex-1 h-9 theme-bg-secondary border theme-border rounded px-2.5 text-xs theme-text-secondary focus:outline-none focus:border-[#2962ff]"
            />
            <button
              type="button"
              onClick={() => addCode()}
              className="h-9 w-9 shrink-0 rounded border theme-border theme-bg-secondary theme-accent hover:text-[#5b8aff] hover:theme-bg-tertiary text-base leading-none"
              title={t('addAction')}
            >
              +
            </button>
          </div>
          {pickerOpen && (
            <WatchlistAddPicker
              query={addInput.trim()}
              suggestions={suggestions}
              hotSuggestions={hotSuggestions}
              existingCodes={new Set(visibleStockItems(watchlist).map((item) => item.symbol))}
              onAdd={addCode}
            />
          )}
        </div>
      </div>

      {loading && <div className="p-4 text-xs theme-text-tertiary text-center">{t('loading')}</div>}
      {error && <div className="px-3 py-1 text-xs theme-red">{error}</div>}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="theme-text-tertiary border-b theme-border sticky top-0 theme-bg">
              <th className="text-left px-3 py-1.5 font-normal">{t('watchName')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('watchPrice')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('watchChangePct')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('watchVolume')}</th>
              <th className="w-5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const up = item.changePct >= 0
              const color = up ? 'theme-red' : 'theme-green'
              const provenance = formatFinanceProvenance(item, {
                source: t('provenanceSource'),
                asOf: t('provenanceAsOf'),
                fetched: t('provenanceFetched'),
                updated: t('provenanceUpdated'),
                cache: t('provenanceCache'),
                fresh: t('provenanceFresh'),
              })
              const provenanceTooltip = formatFinanceProvenanceTooltip(item, {
                source: t('provenanceSource'),
                asOf: t('provenanceAsOf'),
                fetched: t('provenanceFetched'),
                updated: t('provenanceUpdated'),
                cache: t('provenanceCache'),
                fresh: t('provenanceFresh'),
              })
              return (
                <tr key={item.id} className="border-b theme-border/30 hover:theme-bg-secondary group">
                  <td className="px-3 py-1.5">
                    <div className="relative group/provenance">
                    <div className="theme-text text-xs">{item.name || item.code}</div>
                    <div className="theme-text-tertiary text-[10px] font-mono truncate">
                      {item.code}
                    </div>
                    {provenanceTooltip && (
                      <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[32rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/provenance:opacity-100">
                        {provenanceTooltip}
                      </span>
                    )}
                    </div>
                  </td>
                  <td className={`text-right px-2 py-1.5 font-mono ${color}`}>{item.price.toFixed(2)}</td>
                  <td className={`text-right px-2 py-1.5 font-mono ${color}`}>
                    {up ? '+' : ''}{item.changePct.toFixed(2)}%
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono theme-text-tertiary">{fmtVol(item.volume)}</td>
                  <td className="px-1">
                    <button
                      onClick={() => removeCode(item.id)}
                      className="theme-text-tertiary hover:theme-red text-[11px] px-1.5 py-0.5 rounded hover:theme-bg-tertiary"
                      title={t('remove')}
                    >
                      x
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {classifyStockWatchlistState({
          loading,
          error,
          rows: items,
          savedItems: visibleStockItems(watchlist),
        }).state === 'empty' && (
          <div className="p-4 text-xs theme-text-tertiary text-center">{t('noStocksAddCode')}</div>
        )}
      </div>
    </div>
  )
}

function WatchlistAddPicker(
  { query, suggestions, hotSuggestions, existingCodes, onAdd }: {
    query: string
    suggestions: StockSuggestion[]
    hotSuggestions: StockSuggestion[]
    existingCodes: Set<string>
    onAdd: (suggestion: StockSuggestion) => void
  },
) {
  const t = useT()
  const { showSearch, searchRows, visibleHot } = stockPickerRows(query, suggestions, hotSuggestions, existingCodes)
  return (
    <div className="absolute left-0 right-0 top-10 z-40 min-w-72 rounded border theme-border theme-bg shadow-lg overflow-hidden">
      <div className="max-h-80 overflow-y-auto">
        {showSearch && (
          <PickerSection title={t('watchSearchResults')}>
            {searchRows.length > 0 ? searchRows.map((item) => (
              <SuggestionRow key={`search-${item.code}`} item={item} onAdd={onAdd} />
            )) : (
              <div className="px-2 py-2 text-[10px] theme-text-tertiary">{t('noResults')}</div>
            )}
          </PickerSection>
        )}
        <PickerSection title={t('hotStocks')}>
          {visibleHot.length > 0 ? visibleHot.map((item) => (
            <SuggestionRow key={`hot-${item.code}`} item={item} onAdd={onAdd} />
          )) : (
            <div className="px-2 py-2 text-[10px] theme-text-tertiary">{t('noMarketSnapshot')}</div>
          )}
        </PickerSection>
      </div>
    </div>
  )
}

function PickerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b theme-border last:border-b-0">
      <div className="px-2 py-1 text-[9px] uppercase tracking-wide theme-text-tertiary theme-bg-secondary">{title}</div>
      {children}
    </div>
  )
}

function SuggestionRow({ item, onAdd }: { item: StockSuggestion; onAdd: (suggestion: StockSuggestion) => void }) {
  const changeText = typeof item.changePct === 'number' && Number.isFinite(item.changePct)
    ? `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`
    : ''
  const priceText = typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0
    ? item.price.toFixed(item.price >= 100 ? 2 : 3).replace(/\.?0+$/, '')
    : ''
  return (
    <button
      type="button"
      className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary"
      onMouseDown={(event) => {
        event.preventDefault()
        onAdd(item)
      }}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] theme-text-secondary truncate">{item.name || item.code}</div>
          <div className="text-[9px] theme-text-tertiary">{item.code} {item.market}</div>
        </div>
        {(priceText || changeText) && (
          <div className={`text-[10px] tabular-nums text-right shrink-0 ${item.changePct != null && item.changePct < 0 ? 'theme-green' : item.changePct != null ? 'theme-red' : 'theme-text-tertiary'}`}>
            <div>{priceText}</div>
            <div>{changeText}</div>
          </div>
        )}
      </div>
    </button>
  )
}

function createDefaultWatchlist(codes: string[], defaultGroupName: string): WatchlistData {
  return {
    groups: [{ id: DEFAULT_GROUP_ID, name: defaultGroupName, type: 'stock' }],
    items: codes.filter(Boolean).map((code) => ({
      id: `w-${code}`,
      groupId: DEFAULT_GROUP_ID,
      symbol: code,
      name: '',
      type: 'stock',
      status: 'watching',
      source: 'widget-compatibility',
      tags: [],
      priceAtAdd: 0,
      addedAt: new Date().toISOString(),
    })),
  }
}

function fmtVol(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(1) + 'B'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + 'W'
  return String(v)
}

function guessMarket(code: string): string {
  if (code.startsWith('6')) return 'SH'
  if (code.startsWith('8') || code.startsWith('4')) return 'BJ'
  return 'SZ'
}
