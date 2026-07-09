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
  evidence_tier?: string | null
  limitations?: string[]
  linked_macro_evidence_ids?: string[]
  retrieval_test?: Record<string, unknown> | null
}

interface SourceStatus {
  id: string
  name: string
  state: string
  detail: string
}

interface NumericSeriesRow {
  id?: string
  provider?: string
  sourceName?: string
  seriesId?: string
  metricName?: string
  family?: string
  frequency?: string
  unit?: string | null
  credentialKey?: string | null
  status?: string
  sourceUrl?: string | null
  nextAction?: string
}

interface FactorResult {
  rows?: FactorRow[]
  sources?: SourceStatus[]
  numericSeriesCatalog?: NumericSeriesRow[]
  generatedAt?: string
  error?: string
}

export default function MacroResearchPanel() {
  const t = useT()
  const [rows, setRows] = useState<FactorRow[]>([])
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [numericSeriesCatalog, setNumericSeriesCatalog] = useState<NumericSeriesRow[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [familyFilter, setFamilyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('all')
  const [regionFilter, setRegionFilter] = useState('all')
  const [retrievalFilter, setRetrievalFilter] = useState('all')

  const load = async () => {
    try {
      const result = await (window as any).electron?.ipcRenderer?.invoke('data:macro-factors') as FactorResult
      setRows(Array.isArray(result?.rows) ? result.rows : [])
      setSources(Array.isArray(result?.sources) ? result.sources : [])
      setNumericSeriesCatalog(Array.isArray(result?.numericSeriesCatalog) ? result.numericSeriesCatalog : [])
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
      setNumericSeriesCatalog(Array.isArray(result?.numericSeriesCatalog) ? result.numericSeriesCatalog : [])
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
  const filteredRows = useMemo(
    () => filterRows(rows, {
      query,
      source: sourceFilter,
      family: familyFilter,
      status: statusFilter,
      asset: assetFilter,
      region: regionFilter,
      retrieval: retrievalFilter,
    }),
    [rows, query, sourceFilter, familyFilter, statusFilter, assetFilter, regionFilter, retrievalFilter],
  )
  const groupedRows = useMemo(() => groupRows(filteredRows), [filteredRows])
  const sourceSummary = useMemo(() => summarizeSources(sources), [sources])
  const numericSummary = useMemo(() => summarizeNumericSeries(numericSeriesCatalog), [numericSeriesCatalog])
  const sourceOptions = useMemo(() => uniqueOptions(rows.map((row) => row.source_name)), [rows])
  const familyOptions = useMemo(() => uniqueOptions(rows.map((row) => row.family)), [rows])
  const assetOptions = useMemo(() => uniqueOptions(rows.flatMap((row) => asList(row.affected_assets))), [rows])
  const regionOptions = useMemo(() => uniqueOptions(rows.flatMap((row) => asList(row.affected_regions))), [rows])
  const retrievalOptions = useMemo(() => uniqueOptions(rows.map((row) => retrievalMode(row))), [rows])

  const sendToAgent = async (row: FactorRow) => {
    await window.agent?.send([
      'Use this macro research evidence as visible analysis context. Do not treat it as a trading signal.',
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
    return <div className="p-4 text-xs theme-text-tertiary">{t('macroFactorLoading')}</div>
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary">
      <div className="px-4 py-3 border-b theme-border space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm theme-text font-semibold">{t('factorRadar')}</div>
            <div className="mt-1 text-[11px] theme-text-tertiary">
              {t('macroResearchGenerated')}: {generatedAt ? new Date(generatedAt).toLocaleString() : '-'}
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[10px]">
          <Metric label={t('macroResearchActiveEvidence')} value={summary.active} />
          <Metric label={t('macroResearchBlockedEvidence')} value={summary.blocked} />
          <Metric label={t('macroFactorSources')} value={sources.length} />
          <Metric label={t('macroNumericSeries')} value={numericSeriesCatalog.length} />
          <Metric label={t('macroFactorSchema')} value="market_moving_factor_v1" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2 text-[10px]">
          <FilterSelect
            label={t('macroResearchFilterSource')}
            value={sourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
          />
          <FilterSelect
            label={t('macroResearchFilterFamily')}
            value={familyFilter}
            options={familyOptions}
            onChange={setFamilyFilter}
          />
          <FilterSelect
            label={t('macroResearchFilterStatus')}
            value={statusFilter}
            options={['active', 'usable', 'watch', 'blocked', 'unsupported']}
            onChange={setStatusFilter}
          />
          <FilterSelect
            label={t('macroResearchFilterAsset')}
            value={assetFilter}
            options={assetOptions}
            onChange={setAssetFilter}
          />
          <FilterSelect
            label={t('macroResearchFilterRegion')}
            value={regionFilter}
            options={regionOptions}
            onChange={setRegionFilter}
          />
          <FilterSelect
            label={t('macroResearchFilterRetrieval')}
            value={retrievalFilter}
            options={retrievalOptions}
            onChange={setRetrievalFilter}
          />
        </div>
        <div className="text-[10px] theme-text-tertiary leading-relaxed">
          {t('macroResearchFilterHint')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
          <label className="space-y-1">
            <div className="theme-text-tertiary">{t('macroResearchSearch')}</div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 w-full rounded border theme-border theme-bg-secondary px-2 text-[11px] theme-text outline-none"
              placeholder={t('macroResearchSearchPlaceholder')}
            />
          </label>
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
        {rows.length > 0 && (
          <div className="p-4 space-y-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs theme-text font-semibold">{t('macroResearchSources')}</h3>
                <span className="text-[10px] theme-text-tertiary">
                  {sourceSummary.ready} ready · {sourceSummary.blocked} blocked · {sourceSummary.fallback} fallback
                </span>
              </div>
              <div className="text-[10px] theme-text-tertiary leading-relaxed">
                {t('macroResearchSourceStateHint')}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                {sources.slice(0, 12).map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs theme-text font-semibold">{t('macroNumericSeries')}</h3>
                <span className="text-[10px] theme-text-tertiary">
                  {numericSummary.supported} supported · {numericSummary.gated} gated · {numericSummary.blocked} blocked
                </span>
              </div>
              <div className="text-[10px] theme-text-tertiary leading-relaxed">
                {t('macroNumericSeriesHint')}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                {numericSeriesCatalog.map((series) => (
                  <NumericSeriesCard key={series.id ?? `${series.provider}-${series.seriesId}`} series={series} />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs theme-text font-semibold">{t('macroResearchEvidence')}</h3>
              {filteredRows.length === 0 && (
                <div className="rounded border theme-border p-3 text-xs theme-text-tertiary">
                  {t('macroResearchNoFilteredEvidence')}
                </div>
              )}
              {Object.entries(groupedRows).map(([family, familyRows]) => (
                <div key={family} className="rounded border theme-border theme-bg-secondary/40">
                  <div className="flex items-center justify-between gap-2 border-b theme-border px-3 py-2">
                    <div className="text-xs theme-text font-medium">{family || '-'}</div>
                    <div className="text-[10px] theme-text-tertiary">{familyRows.length} {t('macroFactorRows')}</div>
                  </div>
                  <div className="divide-y theme-border/30">
                    {familyRows.map((row, index) => (
                      <EvidenceRow
                        key={`${row.factor_id ?? row.title}-${index}`}
                        row={row}
                        onAnalyze={() => sendToAgent(row)}
                        onCopy={() => copy(row)}
                        onOpen={() => openSource(row)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const t = useT()
  return (
    <label className="space-y-1">
      <div className="theme-text-tertiary">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full rounded border theme-border theme-bg-secondary px-2 text-[11px] theme-text outline-none"
      >
        <option value="all">{t('macroResearchFilterAll')}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function EvidenceRow({
  row,
  onAnalyze,
  onCopy,
  onOpen,
}: {
  row: FactorRow
  onAnalyze: () => void
  onCopy: () => void
  onOpen: () => void
}) {
  const t = useT()
  return (
    <div className="px-3 py-3 hover:theme-bg-secondary">
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${severityClass(row.severity, row.failure_class)}`} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-xs theme-text font-medium leading-tight">{row.title ?? '-'}</div>
            <div className="text-[11px] theme-text-secondary mt-1 whitespace-pre-wrap leading-relaxed">{row.summary ?? '-'}</div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 text-[10px]">
            <DetailBlock
              title={t('macroResearchProvenance')}
              lines={[
                `${row.source_name ?? '-'} / ${row.source_type ?? '-'}`,
                `${t('sourceTimeLabel')}: ${row.source_published_at ?? row.event_at ?? '-'}`,
                `${t('provenanceFetched')}: ${row.fetched_at ?? '-'}`,
                `evidence tier: ${evidenceTier(row)}`,
                `status: ${row.status ?? '-'} / ${row.failure_class ?? 'ok'}`,
                `${t('macroResearchRetrievalMode')}: ${retrievalMode(row)}`,
              ]}
            />
            <DetailBlock
              title={t('macroResearchOverview')}
              lines={[
                `${t('macroResearchDirection')}: ${row.expected_direction ?? '-'}`,
                `${t('macroResearchConfidence')}: ${row.confidence ?? '-'}`,
                `${t('macroResearchCatalyst')}: ${row.next_catalyst_at ?? '-'}`,
                `severity: ${row.severity ?? '-'}`,
              ]}
            />
            <DetailBlock
              title={t('macroFactorAffected')}
              lines={[
                `${t('macroFactorAffected')}: ${asList(row.affected_assets).join(', ') || '-'}`,
                `${t('macroResearchRegions')}: ${asList(row.affected_regions).join(', ') || '-'}`,
                `${t('macroResearchSectors')}: ${asList(row.affected_sectors).join(', ') || '-'}`,
              ]}
            />
            <DetailBlock
              title={t('macroResearchChannels')}
              lines={[
                asList(row.transmission_channels).join(', ') || '-',
                ...asList(row.limitations),
                linkedEvidenceLine(row),
                row.source_url ? row.source_url : '',
              ].filter(Boolean)}
            />
          </div>
          <div className="flex flex-wrap gap-1 text-[9px] theme-text-tertiary">
            <Chip value={row.family} />
            <Chip value={row.source_name} />
            <Chip value={row.source_type} />
            <Chip value={evidenceTier(row)} />
            <Chip value={row.status} />
            {row.failure_class ? <Chip value={row.failure_class} /> : null}
          </div>
          <div className="flex items-center gap-3 text-[10px] theme-text-tertiary">
            <button onClick={onAnalyze} className="hover:theme-accent">{t('macroFactorSendToAgent')}</button>
            <button onClick={onCopy} className="hover:theme-accent">{t('copyNews')}</button>
            {row.source_url && <button onClick={onOpen} className="hover:theme-accent">{t('openNews')}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded border theme-border/60 px-2 py-1.5">
      <div className="mb-1 text-[9px] uppercase theme-text-tertiary">{title}</div>
      <div className="space-y-0.5">
        {lines.map((line, index) => (
          <div key={index} className="break-words theme-text-secondary">{line}</div>
        ))}
      </div>
    </div>
  )
}

function SourceRow({ source }: { source: SourceStatus }) {
  return (
    <div className="rounded border theme-border/60 px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] theme-text truncate">{source.name}</div>
          <div className="text-[10px] theme-text-tertiary break-words">{source.detail}</div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${sourceStateClass(source.state)}`}>
          {source.state}
        </span>
      </div>
    </div>
  )
}

function NumericSeriesCard({ series }: { series: NumericSeriesRow }) {
  const t = useT()
  return (
    <div className="rounded border theme-border/60 px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] theme-text break-words">
            {series.metricName ?? series.seriesId ?? '-'}
          </div>
          <div className="text-[10px] theme-text-tertiary break-words">
            {series.sourceName ?? series.provider ?? '-'} · {series.seriesId ?? '-'} · {series.frequency ?? '-'} · {series.unit ?? '-'}
          </div>
          <div className="text-[10px] theme-text-tertiary break-words">
            {series.credentialKey ? `${t('macroCredentialKey')}: ${series.credentialKey}` : t('macroNoCredentialRequired')}
          </div>
          <div className="text-[10px] theme-text-tertiary break-words">
            {series.nextAction ?? '-'}
          </div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${sourceStateClass(series.status ?? '')}`}>
          {series.status ?? '-'}
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border theme-border px-2 py-1.5">
      <div className="font-mono theme-text break-words">{value}</div>
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

function summarizeSources(sources: SourceStatus[]): { ready: number; blocked: number; fallback: number } {
  return {
    ready: sources.filter((source) => /ready|available|ok|public|configured/i.test(source.state)).length,
    blocked: sources.filter((source) => /blocked|manual|licensed|credential|anti|unavailable/i.test(source.state)).length,
    fallback: sources.filter((source) => /fallback|diagnostic|partial/i.test(source.state)).length,
  }
}

function summarizeNumericSeries(rows: NumericSeriesRow[]): { supported: number; gated: number; blocked: number } {
  return {
    supported: rows.filter((row) => /supported|ok|active/i.test(row.status ?? '')).length,
    gated: rows.filter((row) => /credential|quota|cache/i.test(row.status ?? '')).length,
    blocked: rows.filter((row) => /security|blocked|unsupported/i.test(row.status ?? '')).length,
  }
}

function groupRows(rows: FactorRow[]): Record<string, FactorRow[]> {
  const grouped: Record<string, FactorRow[]> = {}
  for (const row of rows) {
    const family = row.family || 'macro_research'
    grouped[family] = grouped[family] ?? []
    grouped[family].push(row)
  }
  return grouped
}

function filterRows(
  rows: FactorRow[],
  filters: {
    query: string
    source: string
    family: string
    status: string
    asset: string
    region: string
    retrieval: string
  },
): FactorRow[] {
  const query = filters.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.source !== 'all' && row.source_name !== filters.source) return false
    if (filters.family !== 'all' && row.family !== filters.family) return false
    if (filters.asset !== 'all' && !asList(row.affected_assets).includes(filters.asset)) return false
    if (filters.region !== 'all' && !asList(row.affected_regions).includes(filters.region)) return false
    if (filters.retrieval !== 'all' && retrievalMode(row) !== filters.retrieval) return false
    if (filters.status !== 'all') {
      const status = row.failure_class ? 'blocked' : String(row.status ?? '')
      if (status !== filters.status) return false
    }
    if (!query) return true
    const haystack = [
      row.factor_id,
      row.family,
      row.title,
      row.summary,
      row.source_name,
      row.source_type,
      row.status,
      row.failure_class,
      retrievalMode(row),
      ...(row.affected_assets ?? []),
      ...(row.affected_regions ?? []),
      ...(row.affected_sectors ?? []),
      ...(row.transmission_channels ?? []),
    ].map((value) => String(value ?? '').toLowerCase())
    return haystack.some((value) => value.includes(query))
  })
}

function uniqueOptions(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function retrievalMode(row: FactorRow): string {
  const retrieval = row.retrieval_test ?? {}
  const status = String(retrieval.status ?? row.failure_class ?? '').trim()
  if (status) return status
  const sourceType = String(row.source_type ?? '').trim()
  if (sourceType) return sourceType
  return 'unknown'
}

function severityClass(severity?: string | null, failure?: string | null): string {
  if (failure) return 'bg-amber-500'
  if (severity === 'high' || severity === 'critical') return 'bg-red-500'
  if (severity === 'medium') return 'bg-blue-500'
  return 'bg-gray-400'
}

function sourceStateClass(state: string): string {
  if (/blocked|manual|licensed|credential|anti|unavailable/i.test(state)) return 'bg-amber-500/20 text-amber-700'
  if (/fallback|diagnostic|partial/i.test(state)) return 'bg-blue-500/15 text-blue-700'
  return 'bg-emerald-500/15 text-emerald-700'
}

function factorTooltip(row: FactorRow): string {
  const retrieval = row.retrieval_test ?? {}
  return [
    `interface: ${String(retrieval.interface_id ?? 'macro.factor_radar')}`,
    `schema: market_moving_factor_v1`,
    `family: ${row.family ?? '-'}`,
    `source: ${row.source_name ?? '-'} / ${row.source_type ?? '-'}`,
    `evidence tier: ${evidenceTier(row)}`,
    `source time: ${row.source_published_at ?? row.event_at ?? '-'}`,
    `fetched at: ${row.fetched_at ?? '-'}`,
    `status: ${row.status ?? '-'} / ${row.failure_class ?? 'ok'}`,
    `retrieval: ${retrievalMode(row)}`,
    `affected: ${asList(row.affected_assets).join(', ') || '-'}`,
    `channels: ${asList(row.transmission_channels).join(', ') || '-'}`,
    `limitations: ${asList(row.limitations).join('; ') || '-'}`,
    `linked macro evidence: ${asList(row.linked_macro_evidence_ids).join(', ') || '-'}`,
  ].join('\n')
}

function evidenceTier(row: FactorRow): string {
  const explicit = String(row.evidence_tier ?? '').trim()
  if (explicit) return explicit
  const sourceType = String(row.source_type ?? '').toLowerCase()
  if (/official_api|official_series|official_document/.test(sourceType)) return 'official_numeric_or_document'
  if (/research|content/.test(sourceType)) return 'content_backed_research'
  if (/news/.test(sourceType)) return 'linked_news_evidence'
  if (/manual|licensed|fallback/.test(sourceType)) return 'retrieval_or_manual_evidence'
  if (row.failure_class) return 'missing_or_blocked'
  return 'governed_macro_evidence'
}

function linkedEvidenceLine(row: FactorRow): string {
  const linked = asList(row.linked_macro_evidence_ids)
  return linked.length > 0 ? `linked macro evidence: ${linked.join(', ')}` : ''
}
