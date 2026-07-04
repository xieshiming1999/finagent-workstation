import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useT } from '../store/useLanguageStore'
import { fundPickerPrimarySelection, fundPickerRows, matchesFund, type FundSuggestion } from './watchlist-picker-model'
import {
  LEGACY_FUND_WATCHLIST_PATH,
  UNIFIED_WATCHLIST_PATH,
  buildFundWatchlistRows,
  emptyUnifiedWatchlist,
  fundItemsFromUnified,
  mergeLegacyFundWatchlist,
  normalizeUnifiedWatchlist,
  removeFundFromUnified,
  upsertFundInUnified,
  type FundWatchlistData,
  type FundWatchlistRow,
  type UnifiedWatchlistData,
} from './fund-watchlist-model'
import { formatFinanceProvenanceTooltip } from './finance-provenance'

export default function FundWatchlistWidget() {
  const t = useT()
  const fundGroupName = t('fundWatchlist')
  const defaultStockGroupName = t('watchlist')
  const [watchlist, setWatchlist] = useState<FundWatchlistData>({ items: [] })
  const [unifiedWatchlist, setUnifiedWatchlist] = useState<UnifiedWatchlistData>(emptyUnifiedWatchlist(defaultStockGroupName))
  const [rows, setRows] = useState<FundWatchlistRow[]>([])
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<FundWatchlistRow[]>([])
  const [cachedSuggestions, setCachedSuggestions] = useState<FundWatchlistRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadWatchlist()
    const reload = () => loadWatchlist()
    window.addEventListener('watchlist:fund-updated', reload)
    return () => window.removeEventListener('watchlist:fund-updated', reload)
  }, [])

  useEffect(() => {
    loadCachedRows(watchlist.items.map((item) => item.code))
  }, [watchlist])

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-search', text, 8) as FundWatchlistRow[] | undefined
        setSuggestions(Array.isArray(result) ? result : [])
      } catch {
        setSuggestions([])
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!pickerOpen) return
    loadCachedSuggestions()
    const close = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      setPickerOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [pickerOpen])

  const loadWatchlist = async () => {
    let nextUnified = emptyUnifiedWatchlist(defaultStockGroupName)
    let shouldSaveUnified = false
    try {
      const result = await window.agent?.bridgeMessage({
        id: 'fund-wl-load', type: 'readFile', path: UNIFIED_WATCHLIST_PATH,
      }) as any
      if (result?.content) {
        nextUnified = normalizeUnifiedWatchlist(JSON.parse(result.content), defaultStockGroupName, fundGroupName)
      }
      const legacy = await loadLegacyFundWatchlist()
      const merged = mergeLegacyFundWatchlist(nextUnified, legacy, fundGroupName)
      nextUnified = merged.data
      shouldSaveUnified = merged.changed
      const nextWatchlist = { items: fundItemsFromUnified(nextUnified) }
      setUnifiedWatchlist(nextUnified)
      setWatchlist(nextWatchlist)
      if (shouldSaveUnified) {
        await saveUnifiedWatchlist(nextUnified)
      }
    } catch {
      setUnifiedWatchlist(nextUnified)
      setWatchlist({ items: fundItemsFromUnified(nextUnified) })
    } finally {
      setLoading(false)
    }
  }

  const loadLegacyFundWatchlist = async (): Promise<FundWatchlistData> => {
    try {
      const result = await window.agent?.bridgeMessage({
        id: 'fund-wl-legacy-load', type: 'readFile', path: LEGACY_FUND_WATCHLIST_PATH,
      }) as any
      if (result?.content) {
        const parsed = JSON.parse(result.content)
        if (Array.isArray(parsed?.items)) return parsed
      }
    } catch {
      // no legacy fund watchlist
    }
    return { items: [] }
  }

  const saveUnifiedWatchlist = async (next: UnifiedWatchlistData) => {
    await window.agent?.bridgeMessage({
      id: 'fund-wl-save', type: 'writeFile', path: UNIFIED_WATCHLIST_PATH,
      content: JSON.stringify(next, null, 2),
    })
  }

  const loadCachedRows = async (codes: string[]) => {
    if (codes.length === 0) {
      setRows([])
      return
    }
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-watchlist', codes) as FundWatchlistRow[] | undefined
      setRows(buildFundWatchlistRows(watchlist.items, Array.isArray(result) ? result : undefined))
    } catch {
      setRows(buildFundWatchlistRows(watchlist.items, undefined))
    }
  }

  const loadCachedSuggestions = async () => {
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-suggestions', 8) as FundWatchlistRow[] | undefined
      setCachedSuggestions(Array.isArray(result) ? result : [])
    } catch {
      setCachedSuggestions([])
    }
  }

  const addFund = async (fund?: FundWatchlistRow) => {
    const code = (fund?.code ?? query).trim().replace(/\.\w+$/i, '')
    if (!code || watchlist.items.some((item) => item.code === code)) return
    const { data: nextUnified, status } = upsertFundInUnified(unifiedWatchlist, { code, name: fund?.name }, fundGroupName, 'manual')
    if (status === 'exists') return
    const next = { items: fundItemsFromUnified(nextUnified) }
    setUnifiedWatchlist(nextUnified)
    setWatchlist(next)
    setRows(buildFundWatchlistRows(next.items, rows))
    await saveUnifiedWatchlist(nextUnified)
    setQuery('')
    setSuggestions([])
    setPickerOpen(false)
  }

  const removeFund = async (id: string) => {
    const nextUnified = removeFundFromUnified(unifiedWatchlist, id)
    const next = { items: fundItemsFromUnified(nextUnified) }
    setUnifiedWatchlist(nextUnified)
    setWatchlist(next)
    setRows(buildFundWatchlistRows(next.items, rows))
    await saveUnifiedWatchlist(nextUnified)
  }

  const refreshFunds = async () => {
    const codes = watchlist.items.map((item) => item.code)
    const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-refresh', codes, codes.length === 0) as any
    setMessage(result?.error ? String(result.error) : t('fundRefreshQueued'))
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="flex items-center justify-between px-3 py-1.5 border-b theme-border">
        <span className="text-xs theme-text-tertiary font-medium">{t('fundWatchlist')} ({watchlist.items.length})</span>
        <button
          type="button"
          onClick={refreshFunds}
          className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary"
        >
          {t('refresh')}
        </button>
      </div>

      <div className="px-3 py-2 border-b theme-border">
        <div className="space-y-2">
          <div ref={pickerRef} className="relative">
            <div className="flex items-center gap-2">
              <input
                value={query}
                onFocus={() => setPickerOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPickerOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const selected = fundPickerPrimarySelection(
                      query,
                      suggestions,
                      cachedSuggestions,
                      new Set(watchlist.items.map((item) => item.code)),
                    )
                    addFund(selected)
                  }
                  if (event.key === 'Escape') setPickerOpen(false)
                }}
                placeholder={t('fundCode')}
                className="min-w-0 flex-1 h-9 theme-bg-secondary border theme-border rounded px-2.5 text-xs theme-text-secondary focus:outline-none focus:border-[#2962ff]"
              />
              <button
                type="button"
                onClick={() => addFund()}
                className="h-9 w-9 shrink-0 rounded border theme-border theme-bg-secondary theme-accent hover:text-[#5b8aff] hover:theme-bg-tertiary text-base leading-none"
                title={t('addAction')}
              >
                +
              </button>
            </div>
            {pickerOpen && (
              <FundPicker
                query={query}
                suggestions={suggestions}
                cachedSuggestions={cachedSuggestions}
                existingCodes={new Set(watchlist.items.map((item) => item.code))}
                onAdd={addFund}
              />
            )}
          </div>
        </div>
      </div>

      {message && <div className="px-3 py-1 text-[10px] theme-text-tertiary">{message}</div>}
      {loading && <div className="p-4 text-xs theme-text-tertiary text-center">{t('loading')}</div>}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="theme-text-tertiary border-b theme-border sticky top-0 theme-bg">
              <th className="text-left px-3 py-1.5 font-normal">{t('watchName')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('fundNav')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('fundDailyReturn')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('fundReturn1y')}</th>
              <th className="w-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const stored = watchlist.items.find((item) => item.code === row.code)
              const provenance = formatFinanceProvenanceTooltip(row, {
                source: t('provenanceSource'),
                asOf: t('provenanceAsOf'),
                fetched: t('provenanceFetched'),
                updated: t('provenanceUpdated'),
                cache: t('provenanceCache'),
                fresh: t('provenanceFresh'),
              })
              return (
                <tr key={row.code} className="border-b theme-border/30 hover:theme-bg-secondary">
                  <td className="px-3 py-1.5">
                    <div className="relative group/provenance">
                    <div className="theme-text text-xs truncate">{row.name || stored?.name || row.code}</div>
                    <div className="theme-text-tertiary text-[10px] font-mono truncate">
                      {row.code}
                    </div>
                    {provenance && (
                      <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[32rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/provenance:opacity-100">
                        {provenance}
                      </span>
                    )}
                    </div>
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono theme-text-secondary">{fmtNum(row.nav)}</td>
                  <td className={`text-right px-2 py-1.5 font-mono ${colorFor(row.daily_return)}`}>{fmtPct(row.daily_return)}</td>
                  <td className={`text-right px-2 py-1.5 font-mono ${colorFor(row.return_1y)}`}>{fmtPct(row.return_1y)}</td>
                  <td className="px-1">
                    {stored && (
                      <button
                        onClick={() => removeFund(stored.id)}
                        className="theme-text-tertiary hover:theme-red text-[11px] px-1.5 py-0.5 rounded hover:theme-bg-tertiary"
                        title={t('remove')}
                      >
                        x
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && !loading && (
          <div className="p-4 text-xs theme-text-tertiary text-center">{t('noFundsAddCode')}</div>
        )}
      </div>
    </div>
  )
}

function FundPicker(
  { query, suggestions, cachedSuggestions, existingCodes, onAdd }: {
    query: string
    suggestions: FundWatchlistRow[]
    cachedSuggestions: FundWatchlistRow[]
    existingCodes: Set<string>
    onAdd: (fund: FundWatchlistRow) => void
  },
) {
  const t = useT()
  const { isSearching, rows } = fundPickerRows(query, suggestions, cachedSuggestions, existingCodes)
  return (
    <div className="absolute left-0 right-0 top-10 z-40 min-w-72 rounded border theme-border theme-bg shadow-lg overflow-hidden">
      <PickerSection title={isSearching ? t('watchSearchResults') : t('fundSuggested')}>
        {rows.length > 0 ? rows.map((fund) => (
          <button
            key={fund.code}
            type="button"
            className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary"
            onMouseDown={(event) => {
              event.preventDefault()
              onAdd(fund)
            }}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] theme-text-secondary truncate">{fund.name || fund.code}</div>
                <div className="text-[9px] theme-text-tertiary">{fund.code}{fund.company ? ` · ${fund.company}` : ''}</div>
              </div>
              <div className={`text-[10px] tabular-nums text-right shrink-0 ${colorFor(fund.return_1y)}`}>
                {fmtPct(fund.return_1y)}
              </div>
            </div>
          </button>
        )) : (
          <div className="px-2 py-2 text-[10px] theme-text-tertiary">
            {isSearching ? t('noResults') : t('fundTypeToSearch')}
          </div>
        )}
      </PickerSection>
    </div>
  )
}

function PickerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-[9px] uppercase tracking-wide theme-text-tertiary theme-bg-secondary">{title}</div>
      {children}
    </div>
  )
}

function fmtNum(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') : '-'
}

function fmtPct(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function colorFor(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'theme-text-tertiary'
  return n >= 0 ? 'theme-red' : 'theme-green'
}
