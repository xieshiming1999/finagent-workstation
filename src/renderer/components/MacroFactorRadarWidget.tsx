import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { usePanelStore } from '../store/usePanelStore'
import { useT } from '../store/useLanguageStore'

const POLL_INTERVAL_MS = sidebarPanelContract('factor-radar').pollIntervalMs ?? 300000

interface FactorRow {
  factor_id?: string
  family?: string
  title?: string
  summary?: string
  source_name?: string
  source_type?: string
  fetched_at?: string
  source_published_at?: string
  event_at?: string
  affected_assets?: string[]
  severity?: string
  status?: string
  failure_class?: string | null
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
  const addPanel = usePanelStore((s) => s.addPanel)
  const setActivePanel = usePanelStore((s) => s.setActive)
  const [rows, setRows] = useState<FactorRow[]>([])
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
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
  }, [])

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
    timerRef.current = setInterval(load, POLL_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [load])

  const summary = useMemo(() => summarize(rows), [rows])
  const sourceSummary = useMemo(() => summarizeSources(sources), [sources])

  const openFullView = () => {
    addPanel({ id: 'macro-research', type: 'macro-research' as any, title: t('factorRadar'), closable: true })
    setActivePanel('macro-research')
  }

  if (loading && rows.length === 0) {
    return <div className="p-3 text-xs theme-text-tertiary">{t('macroFactorLoading')}</div>
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 theme-bg theme-text-secondary">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs theme-text font-medium">{t('factorRadar')}</div>
          <div className="text-[10px] theme-text-tertiary">
            {generatedAt ? `${t('macroResearchGenerated')}: ${new Date(generatedAt).toLocaleTimeString()}` : t('macroFactorLoading')}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFullView} className="text-[10px] theme-text-tertiary hover:theme-accent px-1">{t('fullView')}</button>
          <button onClick={refresh} disabled={refreshing} className="text-[10px] theme-text-tertiary hover:theme-accent px-1 disabled:opacity-60">
            {refreshing ? t('fetching') : t('refresh')}
          </button>
        </div>
      </div>

      {error && <div className="rounded border theme-border px-2 py-1 text-[10px] theme-red whitespace-pre-wrap">{error}</div>}

      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <Metric label={t('macroResearchActiveEvidence')} value={summary.active} />
        <Metric label={t('macroResearchBlockedEvidence')} value={summary.blocked} tone={summary.blocked > 0 ? 'warn' : 'neutral'} />
        <Metric label={t('macroFactorSources')} value={sources.length} />
        <Metric label={t('macroFactorRows')} value={rows.length} />
      </div>

      <Section title={t('macroResearchSources')}>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Metric label="ready" value={sourceSummary.ready} />
          <Metric label="blocked" value={sourceSummary.blocked} tone={sourceSummary.blocked > 0 ? 'warn' : 'neutral'} />
          <Metric label="fallback" value={sourceSummary.fallback} />
        </div>
        {sources.slice(0, 4).map((source) => (
          <div key={source.id} className="rounded border theme-border/60 px-2 py-1 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="theme-text truncate">{source.name}</span>
              <span className="theme-text-tertiary shrink-0">{source.state}</span>
            </div>
            <div className="theme-text-tertiary line-clamp-2">{source.detail}</div>
          </div>
        ))}
      </Section>

      <Section title={t('macroResearchEvidence')}>
        {rows.length === 0 ? (
          <div className="text-[10px] theme-text-tertiary">{t('macroFactorEmpty')}</div>
        ) : rows.slice(0, 5).map((row) => (
          <EvidencePreview key={row.factor_id ?? `${row.title}-${row.fetched_at}`} row={row} />
        ))}
        {rows.length > 5 && (
          <button onClick={openFullView} className="text-[10px] theme-text-tertiary hover:theme-accent">
            {t('fullView')} · {rows.length - 5} more
          </button>
        )}
      </Section>
    </div>
  )
}

function EvidencePreview({ row }: { row: FactorRow }) {
  return (
    <div className="rounded border theme-border/60 px-2 py-1.5 text-[10px]">
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${severityClass(row.severity, row.failure_class)}`} />
        <div className="min-w-0">
          <div className="theme-text truncate">{row.title ?? '-'}</div>
          <div className="theme-text-tertiary line-clamp-2">{row.summary ?? '-'}</div>
          <div className="mt-1 theme-text-tertiary">
            {row.source_name ?? '-'} · {row.status ?? '-'} · {shortTime(row.source_published_at ?? row.event_at ?? row.fetched_at)}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-[10px] uppercase theme-text-tertiary">{title}</div>
      {children}
    </section>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'neutral' | 'warn' }) {
  return (
    <div className="rounded border theme-border px-2 py-1">
      <div className={tone === 'warn' ? 'font-mono text-amber-600' : 'font-mono theme-text'}>{value}</div>
      <div className="theme-text-tertiary truncate">{label}</div>
    </div>
  )
}

function summarize(rows: FactorRow[]): { active: number; blocked: number } {
  return {
    active: rows.filter((row) => !row.failure_class && row.status !== 'unsupported').length,
    blocked: rows.filter((row) => row.failure_class || row.status === 'unsupported').length,
  }
}

function summarizeSources(sources: SourceStatus[]): { ready: number; blocked: number; fallback: number } {
  return {
    ready: sources.filter((source) => /ready|available|ok|public|configured/i.test(source.state)).length,
    blocked: sources.filter((source) => /blocked|manual|licensed|credential|anti|unavailable/i.test(source.state)).length,
    fallback: sources.filter((source) => /fallback|diagnostic|partial/i.test(source.state)).length,
  }
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
