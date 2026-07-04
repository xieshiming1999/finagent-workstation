import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import type { SnapshotLeaderItem } from '../../agent/data/market-snapshot'
import {
  pulseCategoryLabel,
  pulseRegimeLabel,
  pulseSecondaryText,
} from './market-pulse-format'
import { useT } from '../store/useLanguageStore'
import { addStockToWatchlist } from './watchlist-storage'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { formatFinanceProvenance, formatFinanceProvenanceTooltip } from './finance-provenance'
import {
  buildMarketPulseDataQuality,
  classifyMarketPulseState,
  type HotStockItem,
  type SnapshotData,
} from './market-pulse-model'

const MARKET_PULSE_POLL_INTERVAL_MS = sidebarPanelContract('pulse').pollIntervalMs ?? 60000

type PulseTarget =
  | { kind: 'stock'; code: string; name: string; rank?: number }
  | { kind: 'leader'; code: string; name: string; category: string; changePct: number }

interface PulseMenuState {
  x: number
  y: number
  target: PulseTarget
}

export default function MarketPulseWidget() {
  const t = useT()
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menu, setMenu] = useState<PulseMenuState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    try {
      const result = await window.agent?.bridgeMessage({
        id: 'pulse', type: 'readFile', path: 'snapshots/latest.json',
      }) as any
      if (result?.content) {
        setSnapshot(JSON.parse(result.content))
        setLoadError(null)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'read failed')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, MARKET_PULSE_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const openMenu = (event: MouseEvent, target: PulseTarget) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }

  const runAction = async (action: 'analyze' | 'compare' | 'dashboard' | 'copy') => {
    if (!menu) return
    const target = menu.target
    setMenu(null)
    if (action === 'copy') {
      if ('code' in target && target.code) await navigator.clipboard?.writeText(target.code)
      return
    }
    const label = target.name && target.name !== target.code ? `${target.name} (${target.code})` : target.code
    const prompts = {
      analyze: `Analyze ${label} from the Stock Market Pulse panel. Use local reusable market data first, then fetch only the missing quote/K-line/fund-flow data needed. Summarize catalysts, risk, trend, and next checks.`,
      compare: target.kind === 'stock'
        ? `Compare ${label} with the other current Stock Market Pulse hot stocks. Use local reusable data first, then fetch only missing quote/K-line/fund-flow data. Return a compact comparison table and ranking.`
        : `Compare ${label} with adjacent Stock Market Pulse sector or mover candidates. Use local reusable data first and explain relative strength, breadth, and risk.`,
      dashboard: `Create or update a compact dashboard for ${label} from the Stock Market Pulse panel. Include quote trend, K-line context, money flow, key events, and a concise AI view. Use the existing Dashboard tool/runtime instead of a static note.`,
    }
    await window.agent?.send(prompts[action])
  }

  const addHotStock = async (item: HotStockItem) => {
    const status = await addStockToWatchlist(item.code, item.name, t('defaultGroupName'))
    setMessage(`${item.name || item.code}: ${status === 'added' ? t('pulseAddedToWatchlist') : t('pulseAlreadyInWatchlist')}`)
    window.setTimeout(() => setMessage(null), 2500)
  }

  const refresh = async () => {
    setMessage(null)
    const result = await (window as any).electron?.ipcRenderer?.invoke('data:market-pulse-refresh') as any
    if (result?.error) {
      setMessage(String(result.error))
      return
    }
    await load()
    setMessage(result?.timestamp ? `${t('refresh')}: ${result.timestamp.slice(0, 16).replace('T', ' ')}` : t('refresh'))
    window.setTimeout(() => setMessage(null), 2500)
  }

  const surfaceState = classifyMarketPulseState({ loading, snapshot, error: loadError })
  if (surfaceState.state === 'loading') return <div className="p-3 text-xs theme-text-tertiary">{t('loadingMarketPulse')}</div>
  if (surfaceState.state === 'error') return <div className="p-3 text-xs theme-red">{loadError ?? t('fetchFailedText')}</div>
  if (!snapshot) return <div className="p-3 text-xs theme-text-tertiary">{t('noMarketSnapshot')}</div>

  const regimeColor = snapshot.regime === 'bullish' ? 'theme-red' : snapshot.regime === 'bearish' ? 'theme-green' : 'text-[#ffc107]'
  const dataQuality = buildMarketPulseDataQuality(snapshot)

  return (
    <div className="theme-bg theme-text-secondary p-3 space-y-3 relative">
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-xs theme-text font-medium">{t('marketPulse')}</div>
          <button
            type="button"
            onClick={refresh}
            className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary"
          >
            {t('refresh')}
          </button>
        </div>
        <div className="rounded border theme-border divide-y theme-border overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className={`text-sm font-bold ${regimeColor}`}>{pulseRegimeLabel(snapshot.regime)}</span>
            <span className="text-[10px] theme-text-tertiary">{snapshot.timestamp.split('T')[0]}</span>
          </div>
          <div className="px-2 py-1 text-[10px] theme-text-tertiary break-words">{snapshot.regimeReason}</div>
          {dataQuality.status === 'partial' && (
            <div className="px-2 py-1 text-[10px] theme-text-tertiary break-words">
              <div className="flex items-center justify-between gap-2">
                <span>{t('partialData')}</span>
                <span className="font-mono theme-text-secondary shrink-0">{dataQuality.failedSourceCount}</span>
              </div>
              <div className="mt-0.5 whitespace-pre-line font-mono text-[9px] theme-text-tertiary" title={dataQuality.detail ?? undefined}>
                {dataQuality.detail}
              </div>
            </div>
          )}
        </div>
        {message && <div className="text-[10px] theme-text-tertiary mt-1">{message}</div>}
      </div>

      <div className="flex gap-4 text-xs">
        <div>
          <span className="theme-red">▲ {snapshot.limitUpCount}</span>
          <span className="theme-text-tertiary ml-1">{t('limitUp')}</span>
        </div>
        <div>
          <span className="theme-green">▼ {snapshot.limitDownCount}</span>
          <span className="theme-text-tertiary ml-1">{t('limitDown')}</span>
        </div>
      </div>

      {surfaceState.rowCount === 0 && (
        <div className="rounded border theme-border px-2.5 py-2 text-[10px] theme-text-tertiary">
          <div>
            {(snapshot.failedSources?.length ?? 0) > 0
              ? t('pulseSummaryOnlyWithFailure')
              : t('pulseSummaryOnly')}
          </div>
        </div>
      )}

      {snapshot.sectorLeaders.length > 0 && (
        <PulseSection title={t('topSectors')} header={<PulseTableHeader columns={[t('watchName'), t('watchChangePct')]} />}>
          {snapshot.sectorLeaders.slice(0, 5).map((s, i) => (
            <LeaderRow key={`${s.code}-${i}`} item={s} onContextMenu={openMenu} />
          ))}
        </PulseSection>
      )}

      {(snapshot.nonSectorMovers?.length ?? 0) > 0 && (
        <PulseSection title={t('nonSectorMovers')} header={<PulseTableHeader columns={[t('watchName'), t('watchChangePct')]} />}>
          {snapshot.nonSectorMovers?.slice(0, 3).map((s, i) => (
            <LeaderRow key={`${s.code}-filtered-${i}`} item={s} onContextMenu={openMenu} />
          ))}
        </PulseSection>
      )}

      {snapshot.hotStocks.length > 0 && (
        <PulseSection title={t('hotStocks')} header={<PulseTableHeader columns={['#', t('watchName'), t('code'), t('watchPrice'), t('watchChangePct')]} />}>
          {snapshot.hotStocks.map((h, i) => (
            <HotStockRow key={i} item={h} onContextMenu={openMenu} onAdd={addHotStock} />
          ))}
        </PulseSection>
      )}

      {menu && <PulseContextMenu menu={menu} onAction={runAction} />}
    </div>
  )
}

function PulseSection({ title, header, children }: { title: string; header?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t theme-border pt-2">
      <div className="text-[10px] theme-text-tertiary mb-1.5 uppercase tracking-wide">{title}</div>
      {header}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function PulseTableHeader({ columns }: { columns: string[] }) {
  return (
    <div className="flex items-center gap-1.5 text-[9px] theme-text-tertiary mb-1 whitespace-nowrap overflow-hidden">
      {columns.map((column, index) => (
        <span key={`${column}-${index}`} className={index === 1 ? 'min-w-0 flex-1 truncate' : 'shrink-0'}>
          {column}
        </span>
      ))}
    </div>
  )
}

function HotStockRow(
  { item, onContextMenu, onAdd }: {
    item: HotStockItem
    onContextMenu: (event: MouseEvent, target: PulseTarget) => void
    onAdd: (item: HotStockItem) => void
  },
) {
  const t = useT()
  const title = item.name && item.name !== item.code ? item.name : item.code
  const price = typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0
    ? item.price.toFixed(item.price >= 100 ? 2 : 3).replace(/\.?0+$/, '')
    : null
  const changePct = typeof item.changePct === 'number' && Number.isFinite(item.changePct)
    ? `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`
    : null
  const quoteText = [price ?? '-', changePct].filter(Boolean).join(' ')
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
    <div
      className="py-1 px-1 -mx-1 rounded hover:theme-bg-secondary cursor-default"
      onContextMenu={(event) => onContextMenu(event, { kind: 'stock', code: item.code, name: item.name, rank: item.rank })}
      title={item.code}
    >
      <div className="flex items-start gap-1.5 text-[10px] min-w-0">
        <span className="theme-text-tertiary shrink-0 w-5">#{item.rank}</span>
        <div className="min-w-0 flex-1 relative group/provenance">
          <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap overflow-hidden">
            <span className="theme-text-secondary truncate min-w-0">{title}</span>
            <span className="theme-text-tertiary text-[9px] shrink-0">{item.code}</span>
          </div>
          {provenanceTooltip && (
            <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[32rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/provenance:opacity-100">
              {provenanceTooltip}
            </span>
          )}
        </div>
        <span className={`${item.changePct != null && item.changePct < 0 ? 'theme-green' : item.changePct != null ? 'theme-red' : 'theme-text-secondary'} tabular-nums shrink-0 ml-auto`}>
          {quoteText}
        </span>
        <button
          type="button"
          className="shrink-0 w-5 h-5 rounded border theme-border theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary leading-none"
          title={t('addAction')}
          onClick={(event) => {
            event.stopPropagation()
            onAdd(item)
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

function LeaderRow({ item, onContextMenu }: { item: SnapshotLeaderItem; onContextMenu: (event: MouseEvent, target: PulseTarget) => void }) {
  const secondary = pulseSecondaryText(item)
  return (
    <div
      className="py-1 px-1 -mx-1 rounded hover:theme-bg-secondary cursor-default"
      onContextMenu={(event) => onContextMenu(event, {
        kind: 'leader',
        code: item.code,
        name: item.displayName,
        category: item.category,
        changePct: item.changePct,
      })}
      title={item.code}
    >
      <div className="flex items-start justify-between gap-2 text-[10px]">
        <div className="min-w-0">
          <div className="theme-text-secondary truncate">{item.displayName}</div>
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            <span className="px-1 rounded border theme-border theme-text-tertiary text-[9px] shrink-0">
              {pulseCategoryLabel(item.category)}
            </span>
            {secondary && (
              <span className="theme-text-tertiary text-[9px] truncate">{secondary}</span>
            )}
          </div>
        </div>
        <span className={`${item.changePct >= 0 ? 'theme-red' : 'theme-green'} shrink-0`}>
          {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
        </span>
      </div>
    </div>
  )
}

function PulseContextMenu(
  { menu, onAction }: { menu: PulseMenuState; onAction: (action: 'analyze' | 'compare' | 'dashboard' | 'copy') => void },
) {
  const t = useT()
  return (
    <div
      className="fixed z-50 min-w-36 py-1 rounded border theme-border theme-bg shadow-lg text-[10px]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary theme-text-secondary" onClick={() => onAction('analyze')}>
        {t('pulseActionAnalyze')}
      </button>
      <button className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary theme-text-secondary" onClick={() => onAction('compare')}>
        {t('pulseActionCompare')}
      </button>
      <button className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary theme-text-secondary" onClick={() => onAction('dashboard')}>
        {t('pulseActionDashboard')}
      </button>
      <div className="border-t theme-border my-1" />
      <button className="block w-full text-left px-2 py-1.5 hover:theme-bg-secondary theme-text-secondary" onClick={() => onAction('copy')}>
        {t('pulseActionCopyCode')}
      </button>
    </div>
  )
}
