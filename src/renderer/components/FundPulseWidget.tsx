import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { useT } from '../store/useLanguageStore'
import { addFundToWatchlist } from './watchlist-storage'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import {
  buildFundPulseActionPrompt,
  buildFundPulseSummary,
  type EtfMover,
  type FundPulseAction,
  type FundPulseActionTarget,
  type FundLeader,
  type FundPulseCache,
  type FundPulseData,
  type FundTask,
} from './fund-pulse-model'
import { formatFinanceProvenance, formatFinanceProvenanceTooltip } from './finance-provenance'

const FUND_PULSE_POLL_INTERVAL_MS = sidebarPanelContract('fund-pulse').pollIntervalMs ?? 60000

interface FundPulseMenuState {
  x: number
  y: number
  target: FundPulseActionTarget
}

export default function FundPulseWidget() {
  const t = useT()
  const [data, setData] = useState<FundPulseData>({ etfMovers: [], fundLeaders: [], navMovers: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [menu, setMenu] = useState<FundPulseMenuState | null>(null)

  const load = async () => {
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-pulse') as FundPulseData | undefined
      if (result) setData(result)
    } catch {
      setData({ etfMovers: [], fundLeaders: [], navMovers: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, FUND_PULSE_POLL_INTERVAL_MS)
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

  const refresh = async () => {
    const result = await (window as any).electron?.ipcRenderer?.invoke('data:fund-pulse-refresh') as any
    if (result?.error) {
      setMessage(String(result.error))
    } else {
      const ids = Array.isArray(result?.taskIds) ? result.taskIds : []
      const queued = Array.isArray(result?.queued) ? result.queued : []
      if (ids.length > 0) {
        setMessage(`${t('fundRefreshQueued')}: ${ids.map((id: unknown) => `#${id}`).join(', ')}`)
      } else if (result?.existing) {
        setMessage(t('existingTask'))
      } else {
        setMessage(`${t('fundRefreshQueued')}: ${queued.length}`)
      }
    }
    await load()
  }

  const summary = buildFundPulseSummary(data)
  const hasStaleHiddenRows =
    (data.staleInfo?.fundLeaderStaleCount ?? 0) > 0 || (data.staleInfo?.navMoverStaleCount ?? 0) > 0
  const latestStaleDate = data.staleInfo?.latestFundLeaderDate ?? data.staleInfo?.latestNavMoverDate ?? null

  const openMenu = (event: MouseEvent, target: FundPulseActionTarget) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }

  const runAction = async (action: FundPulseAction | 'copy') => {
    if (!menu) return
    const target = menu.target
    setMenu(null)
    if (action === 'copy') {
      await navigator.clipboard?.writeText(target.code)
      return
    }
    await window.agent?.send(buildFundPulseActionPrompt(action, target))
  }

  const addFund = async (row: { code: string; name: string }) => {
    const status = await addFundToWatchlist(row.code, row.name)
    setMessage(`${row.name || row.code}: ${status === 'added' ? t('pulseAddedToWatchlist') : t('pulseAlreadyInWatchlist')}`)
    window.setTimeout(() => setMessage(null), 2500)
  }

  return (
    <div className="theme-bg theme-text-secondary p-3 space-y-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs theme-text font-medium">{t('fundPulse')}</div>
          <div className="text-[10px] theme-text-tertiary">{t('fundPulseCacheOnly')}</div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary"
          title={t('fundPulseRefreshHelp')}
        >
          {t('fundPulseRefreshNow')}
        </button>
      </div>
      <div className="text-[10px] theme-text-tertiary">{t('fundPulseRefreshHelp')}</div>

      {message && <div className="text-[10px] theme-text-tertiary">{message}</div>}
      {loading && <div className="p-3 text-xs theme-text-tertiary">{t('loading')}</div>}

      {!loading && hasStaleHiddenRows && (
        <div className="rounded border theme-border px-2.5 py-2 text-[10px] theme-text-tertiary space-y-1">
          <div>{t('fundPulseStale')}</div>
          {latestStaleDate && (
            <div className="font-mono normal-case tracking-normal">
              {t('fundPulseLatestDate')}: {latestStaleDate}
            </div>
          )}
        </div>
      )}

      {!loading && !summary.hasRows && (
        <div className="p-3 text-xs theme-text-tertiary border theme-border rounded space-y-2">
          <div className="text-center">{hasStaleHiddenRows ? t('fundPulseStale') : t('fundPulseEmpty')}</div>
          <CacheStatus cache={data.cache} />
          <TaskStatus tasks={summary.visibleTasks} />
        </div>
      )}

      {data.etfMovers.length > 0 && (
        <PulseSection title={t('etfMovers')} columns={[t('watchName'), t('watchPrice'), t('watchChangePct'), '']}>
          {data.etfMovers.map((row) => (
            <EtfRow key={row.code} row={row} onAdd={addFund} onContextMenu={openMenu} />
          ))}
        </PulseSection>
      )}

      {data.fundLeaders.length > 0 && (
        <PulseSection title={t('fundLeaders')} columns={[t('watchName'), t('fundNav'), t('fundReturnYtd'), t('fundReturn1y'), '']}>
          {data.fundLeaders.map((row) => (
            <FundRow key={row.code} row={row} kind="fund" primaryReturn="return_ytd" onAdd={addFund} onContextMenu={openMenu} />
          ))}
        </PulseSection>
      )}

      {data.navMovers.length > 0 && (
        <PulseSection title={t('fundNavMovers')} columns={[t('watchName'), t('fundNav'), t('fundDailyReturn'), '', '']}>
          {data.navMovers.map((row) => (
            <FundRow key={`${row.code}-${row.nav_date ?? ''}`} row={row} kind="nav" primaryReturn="daily_return" onAdd={addFund} onContextMenu={openMenu} />
          ))}
        </PulseSection>
      )}

      {menu && <FundPulseContextMenu menu={menu} onAction={runAction} />}
    </div>
  )
}

function CacheStatus({ cache }: { cache?: FundPulseCache }) {
  const t = useT()
  const rows = [
    [t('fundListLabel'), cache?.fundListCount ?? 0],
    [t('fundNavLabel'), cache?.fundNavCount ?? 0],
    [t('fundPerformanceLabel'), cache?.fundPerformanceCount ?? 0],
    [t('etfListLabel'), cache?.etfCount ?? 0],
    [t('etfQuoteLabel'), cache?.etfQuoteCount ?? 0],
  ] as const
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide theme-text-tertiary mb-1">{t('fundPulseCacheStatus')}</div>
      <div className="grid grid-cols-2 gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded border theme-border px-1.5 py-1">
            <div className="font-mono theme-text-secondary">{value}</div>
            <div className="text-[10px] theme-text-tertiary truncate">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TaskStatus({ tasks }: { tasks: FundTask[] }) {
  const t = useT()
  if (tasks.length === 0) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide theme-text-tertiary mb-1">{t('fundPulseTasks')}</div>
      <div className="space-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="theme-text-secondary truncate">#{task.id} {task.task_type}{task.code ? ` · ${task.code}` : ''}</span>
            <span className={task.status === 'failed' ? 'theme-red' : task.status === 'running' ? 'theme-green' : 'theme-text-tertiary'}>{task.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PulseSection({ title, columns, children }: { title: string; columns: string[]; children: ReactNode }) {
  const headerClass = columns.length === 3
    ? 'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2'
    : columns.length === 4
      ? 'grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2'
      : 'grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-2'
  return (
    <div className="border-t theme-border pt-2">
      <div className="text-[10px] theme-text-tertiary mb-1.5 uppercase tracking-wide">{title}</div>
      <div className={`${headerClass} text-[9px] theme-text-tertiary mb-1 whitespace-nowrap`}>
        {columns.map((column, index) => (
          <span key={`${title}-${column}`} className={index === 0 ? 'truncate' : 'text-right'}>
            {column}
          </span>
        ))}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function EtfRow(
  { row, onAdd, onContextMenu }: {
    row: EtfMover
    onAdd: (row: EtfMover) => void
    onContextMenu: (event: MouseEvent, target: FundPulseActionTarget) => void
  },
) {
  const t = useT()
  const provenance = useFinanceProvenanceTooltip(row)
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 py-1 px-1 -mx-1 rounded hover:theme-bg-secondary text-[10px]"
      onContextMenu={(event) => onContextMenu(event, { kind: 'etf', code: row.code, name: row.name })}
      title={row.code}
    >
      <div className="min-w-0 relative group/provenance">
        <div className="theme-text-secondary truncate">{row.name || row.code}</div>
        <div className="theme-text-tertiary text-[9px] font-mono truncate">
          {row.code}
        </div>
        {provenance && (
          <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[32rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/provenance:opacity-100">
            {provenance}
          </span>
        )}
      </div>
      <div className="theme-text-secondary tabular-nums text-right self-center">{fmtNum(row.price, 3)}</div>
      <div className={`${colorFor(row.change_pct)} tabular-nums text-right self-center`}>{fmtPct(row.change_pct)}</div>
      <button
        type="button"
        className="self-center w-5 h-5 rounded border theme-border theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary leading-none"
        title={t('addAction')}
        onClick={() => onAdd(row)}
      >
        +
      </button>
    </div>
  )
}

function FundRow(
  { row, kind, primaryReturn, onAdd, onContextMenu }: {
    row: FundLeader
    kind: 'fund' | 'nav'
    primaryReturn: 'return_ytd' | 'daily_return'
    onAdd: (row: FundLeader) => void
    onContextMenu: (event: MouseEvent, target: FundPulseActionTarget) => void
  },
) {
  const t = useT()
  const provenance = useFinanceProvenanceTooltip(row)
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-2 py-1 px-1 -mx-1 rounded hover:theme-bg-secondary text-[10px]"
      onContextMenu={(event) => onContextMenu(event, { kind, code: row.code, name: row.name })}
      title={row.code}
    >
      <div className="min-w-0 relative group/provenance">
        <div className="theme-text-secondary truncate">{row.name || row.code}</div>
        <div className="theme-text-tertiary text-[9px] font-mono truncate">
          {[row.code, row.fund_type].filter(Boolean).join(' · ')}
        </div>
        {provenance && (
          <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[32rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover/provenance:opacity-100">
            {provenance}
          </span>
        )}
      </div>
      <div className="theme-text-secondary tabular-nums text-right self-center">{fmtNum(row.nav, 4)}</div>
      <div className={`${colorFor(row[primaryReturn])} tabular-nums text-right self-center`}>{fmtPct(row[primaryReturn])}</div>
      <div className={`${colorFor(row.return_1y)} tabular-nums text-right self-center`}>{primaryReturn === 'return_ytd' ? fmtPct(row.return_1y) : ''}</div>
      <button
        type="button"
        className="self-center w-5 h-5 rounded border theme-border theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary leading-none"
        title={t('addAction')}
        onClick={() => onAdd(row)}
      >
        +
      </button>
    </div>
  )
}

function FundPulseContextMenu(
  { menu, onAction }: { menu: FundPulseMenuState; onAction: (action: FundPulseAction | 'copy') => void },
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

function fmtNum(value: unknown, digits: number): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : '-'
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

function useFinanceProvenance(row: Parameters<typeof formatFinanceProvenance>[0]): string {
  const t = useT()
  return formatFinanceProvenance(row, {
    source: t('provenanceSource'),
    asOf: t('provenanceAsOf'),
    fetched: t('provenanceFetched'),
    updated: t('provenanceUpdated'),
    cache: t('provenanceCache'),
    fresh: t('provenanceFresh'),
  })
}

function useFinanceProvenanceTooltip(row: Parameters<typeof formatFinanceProvenanceTooltip>[0]): string {
  const t = useT()
  return formatFinanceProvenanceTooltip(row, {
    source: t('provenanceSource'),
    asOf: t('provenanceAsOf'),
    fetched: t('provenanceFetched'),
    updated: t('provenanceUpdated'),
    cache: t('provenanceCache'),
    fresh: t('provenanceFresh'),
  })
}
