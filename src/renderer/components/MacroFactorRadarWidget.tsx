import { useEffect, useMemo, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'

const POLL_INTERVAL_MS = sidebarPanelContract('factor-radar').pollIntervalMs ?? 300000

interface FactorRow {
  factor_id?: string
  family?: string
  title?: string
  summary?: string
  source_name?: string
  source_url?: string
  source_type?: string
  source_published_at?: string
  fetched_at?: string
  event_at?: string
  next_catalyst_at?: string
  affected_assets?: string[]
  affected_regions?: string[]
  affected_sectors?: string[]
  transmission_channels?: string[]
  expected_direction?: string
  severity?: string
  confidence?: string
  status?: string
  failure_class?: string | null
  evidence_items?: Array<Record<string, unknown>>
  retrieval_test?: Record<string, unknown> | null
}

interface SourceStatus {
  id: string
  name: string
  state: string
  detail: string
}

interface FactorResult {
  rows?: FactorRow[]
  sources?: SourceStatus[]
  generatedAt?: string
  error?: string
}

export default function MacroFactorRadarWidget() {
  const t = useT()
  const [rows, setRows] = useState<FactorRow[]>([])
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:macro-factors') as FactorResult
      setRows(Array.isArray(result?.rows) ? result.rows : [])
      setSources(Array.isArray(result?.sources) ? result.sources : [])
      setGeneratedAt(result?.generatedAt ?? null)
      setError(result?.error ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:macro-factor-refresh') as FactorResult
      setRows(Array.isArray(result?.rows) ? result.rows : [])
      setSources(Array.isArray(result?.sources) ? result.sources : [])
      setGeneratedAt(result?.generatedAt ?? null)
      setError(result?.error ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const summary = useMemo(() => summarize(rows), [rows])

  const sendToAgent = async (row: FactorRow) => {
    await window.agent?.send([
      'Use this macro factor as visible analysis evidence. Do not treat it as a trading signal.',
      `Title: ${row.title ?? '-'}`,
      `Family: ${row.family ?? '-'}`,
      `Source: ${row.source_name ?? '-'} (${row.source_type ?? '-'})`,
      `Source time: ${row.source_published_at ?? row.event_at ?? '-'}`,
      `Fetched at: ${row.fetched_at ?? '-'}`,
      `Affected: ${asList(row.affected_assets).join(', ') || '-'}`,
      `Status: ${row.status ?? '-'} / ${row.failure_class ?? 'ok'}`,
      row.summary ? `Summary: ${row.summary}` : '',
    ].filter(Boolean).join('\n'))
  }

  const copy = async (row: FactorRow) => {
    await navigator.clipboard?.writeText(factorTooltip(row))
  }

  const openSource = (row: FactorRow) => {
    if (!row.source_url) return
    window.agent?.openExternal(row.source_url).catch(() => {
      window.open(row.source_url, '_blank', 'noopener,noreferrer')
    })
  }

  if (loading && rows.length === 0) {
    return <div className="p-3 text-xs theme-text-tertiary">{t('macroFactorLoading')}</div>
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="px-3 py-2 border-b theme-border space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs theme-text font-medium">{t('factorRadar')}</div>
            <div className="text-[10px] theme-text-tertiary">
              {summary.active} {t('macroFactorActive')} · {summary.blocked} {t('macroFactorBlocked')}
              {generatedAt ? ` · ${new Date(generatedAt).toLocaleTimeString()}` : ''}
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent disabled:opacity-60"
          >
            {refreshing ? t('fetching') : t('refresh')}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Metric label={t('macroFactorSources')} value={sources.length} />
          <Metric label={t('macroFactorRows')} value={rows.length} />
          <Metric label={t('macroFactorSchema')} value="v1" />
        </div>
      </div>

      {error && (
        <div className="m-3 rounded border theme-border px-2 py-1 text-[10px] theme-red whitespace-pre-wrap">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && !error && (
          <div className="p-4 text-xs theme-text-tertiary text-center">{t('macroFactorEmpty')}</div>
        )}
        {rows.map((row, index) => (
          <div key={`${row.factor_id ?? row.title}-${index}`} className="px-3 py-2 border-b theme-border/30 hover:theme-bg-secondary">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${severityClass(row.severity, row.failure_class)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs theme-text leading-tight">{row.title ?? '-'}</div>
                <div className="text-[10px] theme-text-secondary mt-1 whitespace-pre-wrap line-clamp-3">{row.summary ?? '-'}</div>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[9px] theme-text-tertiary">
              <Chip value={row.family} />
              <Chip value={row.source_name} />
              <Chip value={row.source_type} />
              <Chip value={row.status} />
              {row.failure_class ? <Chip value={row.failure_class} /> : null}
            </div>
            <div className="mt-1 text-[10px] theme-text-tertiary">
              <span className="relative group/macro-time font-mono">
                {t('sourceTimeLabel')}: {shortTime(row.source_published_at ?? row.event_at)}
                <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 min-w-[20rem] max-w-[34rem] whitespace-pre-line rounded border theme-border theme-bg px-2 py-1 text-[10px] font-mono theme-text shadow-lg opacity-0 group-hover/macro-time:opacity-100">
                  {factorTooltip(row)}
                </span>
              </span>
              <span className="ml-2 font-mono">{t('provenanceFetched')}: {shortTime(row.fetched_at)}</span>
            </div>
            <div className="mt-1 text-[10px] theme-text-tertiary truncate">
              {t('macroFactorAffected')}: {asList(row.affected_assets).join(', ') || '-'}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] theme-text-tertiary">
              <button onClick={() => sendToAgent(row)} className="hover:theme-accent">{t('macroFactorSendToAgent')}</button>
              <button onClick={() => copy(row)} className="hover:theme-accent">{t('copyNews')}</button>
              {row.source_url && <button onClick={() => openSource(row)} className="hover:theme-accent">{t('openNews')}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border theme-border px-2 py-1">
      <div className="font-mono theme-text">{value}</div>
      <div className="theme-text-tertiary truncate">{label}</div>
    </div>
  )
}

function Chip({ value }: { value?: string | null }) {
  if (!value) return null
  return <span className="rounded theme-bg-secondary px-1 py-0.5">{value}</span>
}

function summarize(rows: FactorRow[]): { active: number; blocked: number } {
  return {
    active: rows.filter((row) => !row.failure_class && row.status !== 'unsupported').length,
    blocked: rows.filter((row) => row.failure_class || row.status === 'unsupported').length,
  }
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function shortTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function severityClass(severity?: string | null, failure?: string | null): string {
  if (failure) return 'bg-amber-500'
  if (severity === 'high' || severity === 'critical') return 'bg-red-500'
  if (severity === 'medium') return 'bg-blue-500'
  return 'bg-gray-400'
}

function factorTooltip(row: FactorRow): string {
  const retrieval = row.retrieval_test ?? {}
  return [
    `interface: ${String(retrieval.interface_id ?? 'macro.factor_radar')}`,
    `schema: market_moving_factor_v1`,
    `family: ${row.family ?? '-'}`,
    `source: ${row.source_name ?? '-'} / ${row.source_type ?? '-'}`,
    `source time: ${row.source_published_at ?? row.event_at ?? '-'}`,
    `fetched at: ${row.fetched_at ?? '-'}`,
    `status: ${row.status ?? '-'} / ${row.failure_class ?? 'ok'}`,
    `affected: ${asList(row.affected_assets).join(', ') || '-'}`,
    `channels: ${asList(row.transmission_channels).join(', ') || '-'}`,
  ].join('\n')
}
