import { useState, useEffect, useCallback, useRef } from 'react'
import { fmtN, ipc, type SourceConfig } from './DataPanelUtils'
import { t, useT } from '../store/useLanguageStore'
import { displaySourcePriority, serializeSourcePriorityInput } from './data-feed-priority-model'
import { sidebarPanelContract } from './sidebar-panel-contract'
import {
  buildFailureEvidenceText,
  isActionableFeedFailure,
  type DataFailureEvidenceDisplayRow,
} from '../components/data-widget-model'

interface DataStats {
  tables: Array<{ name: string; count: number }>
  sizeBytes: number
  reusable?: Array<{ name: string; count: number; latest: string | null; sources?: string | null }>
}
interface CoverageItem { code: string; data_type: string; earliest_date: string | null; latest_date: string | null; row_count: number; last_updated: string | null }
interface FetchTask { id: number; task_type: string; code: string | null; status: string; priority: number; progress: string | null; created_at: string; updated_at?: string | null; error: string | null }
interface SourceStatus { source: string; minInterval: number; active: number; lastCall: number; status: 'online' | 'degraded' | 'offline'; errorCount: number }
interface FeedConfig { feed_id: string; display_name: string; feed_type: string; enabled: number; scope: string; scope_codes: string | null; history_years: number; update_frequency: string; trigger_time: string; source_priority: string; status: string; last_run_at: string | null; last_error: string | null; resolved_codes?: string[]; resolved_count?: number }
interface InterfaceHealth {
  summary: {
    interfaces: number
    ready: number
    attention: number
    gaps: number
    recentFailures: number
    providerGapRows?: number
    credentialActivationRows?: number
    credentialValidatedRows?: number
    policyDisabledRows?: number
    credentialActivationLiveObserved?: number
    providers: string[]
    liveStatusRows?: number
    liveStatusPassed?: number
    liveStatusFailedOrBlocked?: number
    liveProbeBacklogRows?: number
    datasets?: number
    evidenceGeneratedAt?: string | null
  }
  providerRows: Array<{
    provider: string
    supported: number
    gated: number
    outputOnly: number
    unstable: number
    disabled: number
    notSupported: number
    recentFailures: number
    lastFailureAt: string | null
    lastFailure: string | null
    lastFailureClass?: string | null
    liveProbeCount?: number
    livePassed?: number
    liveFailures?: number
    liveFailureClasses?: Record<string, number>
    nextAction?: string
    health: 'ready' | 'attention' | 'gap'
  }>
  datasetRows?: Array<{
    canonicalSchema: string
    dataStoreTables: string[]
    interfaces: string[]
    queryActions: string[]
    freshnessPolicies: string[]
    cacheStatuses: string[]
    detailedRows: number
    liveProbeBacklog: number
    failures: number
    healthState: string
  }>
  providerGapQueue?: Array<{
    id?: string
    interfaceId: string
    category?: string
    chinesePurpose?: string
    canonicalSchema?: string
    provider: string
    status: string
    capabilityId?: string | null
    adapter?: string | null
    normalizer?: string | null
    canonicalTable?: string | null
    probeId?: string | null
    reusableShape?: boolean | string | null
    routeWiringStatus?: string | null
    routeImplementationRequired?: boolean
    gapClass?: string | null
    actionPriority?: number | null
    promotionCandidate?: boolean
    nextAction?: string | null
    reason?: string | null
    presenceReason?: string | null
    cacheDecision?: string | null
    exitCondition?: string | null
  }>
  credentialActivationQueue?: Array<{
    id?: string
    interfaceId: string
    category?: string
    chinesePurpose?: string
    canonicalSchema?: string
    provider: string
    status: string
    capabilityId?: string | null
    probeId?: string | null
    normalizer?: string | null
    canonicalTable?: string | null
    liveStatus?: string | null
    liveValidationState?: string | null
    activationState?: string | null
    activationLabel?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    nextAction?: string | null
    reason?: string | null
    presenceReason?: string | null
    cacheDecision?: string | null
    exitCondition?: string | null
  }>
  credentialValidatedQueue?: Array<{
    id?: string
    interfaceId: string
    category?: string
    chinesePurpose?: string
    canonicalSchema?: string
    provider: string
    status: string
    capabilityId?: string | null
    probeId?: string | null
    normalizer?: string | null
    canonicalTable?: string | null
    liveStatus?: string | null
    liveValidationState?: string | null
    activationState?: string | null
    activationLabel?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    nextAction?: string | null
    reason?: string | null
    presenceReason?: string | null
    cacheDecision?: string | null
    exitCondition?: string | null
    retryPolicy?: string | null
  }>
  policyDisabledQueue?: Array<{
    id?: string
    interfaceId: string
    category?: string
    chinesePurpose?: string
    canonicalSchema?: string
    provider: string
    status: string
    capabilityId?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    nextAction?: string | null
    reason?: string | null
    presenceReason?: string | null
    cacheDecision?: string | null
    exitCondition?: string | null
  }>
  failureActionQueue?: Array<DataFailureEvidenceDisplayRow & {
    id?: string
    provider?: string | null
    family?: string | null
    status?: string | null
    validationState?: string | null
    failureClass?: string | null
    affectedRows?: string[]
    nextAction?: string | null
    presenceReason?: string | null
    cacheDecision?: string | null
    exitCondition?: string | null
    retryPolicy?: string | null
    error?: string | null
  }>
  rows: Array<{
    interfaceId: string
    label: string
    canonicalSchema: string
    tables: string[]
    capabilities: Array<{
      provider: string
      capabilityId: string
      status: string
      priority: number | null
      canonicalTable: string | null
      normalizer: string | null
      adapter: string | null
      probeId: string | null
      reason: string | null
      nextAction?: string
    }>
    cacheStatus: string
    cachePolicy: string
    supportedProviders: string[]
    gatedProviders: string[]
    outputOnlyProviders: string[]
    unsupportedProviders: string[]
    unstableProviders: string[]
    disabledProviders: string[]
    localRows: number
    latest: string | null
    latestSourceTime: string | null
    sources: string | null
    recentFailures: number
    lastFailureAt: string | null
    lastFailure: string | null
    lastFailureClass: string | null
    liveProbeIds?: string[]
    liveProbeBacklog?: number
    passedLiveRows?: number
    liveFailures?: number
    liveStatus?: string | null
    chinesePurpose?: string | null
    category?: string | null
    nextAction?: string
    health: 'ready' | 'attention' | 'gap'
  }>
}
interface RoutingPolicy {
  gates: Record<string, unknown>
  disabled: Record<string, string>
  cachePolicies?: Array<{ task: string; label: string; policy: { mode: string; maxAgeMs?: number; minRows?: number } }>
  routes: Array<{ task: string; label: string; providers: string[] }>
}

interface RuntimeProbeStatus {
  running: boolean
  mode: 'credential' | 'unstable' | 'failures' | 'all' | null
  runId?: string | null
  startedAt: string | null
  finishedAt: string | null
  selectedProbeIds: string[]
  selectedTargets?: RuntimeProbeTarget[]
  selectedCount: number
  outputPath: string | null
  liveStatusPath: string | null
  summary: Record<string, number> | null
  error: string | null
  availableModes?: Array<'credential' | 'unstable' | 'failures' | 'all'>
  recommendedTargets?: RuntimeProbeTarget[]
  blockedTargets?: RuntimeProbeTarget[]
  providerProbePacks?: Array<{
    provider: string
    label: string
    status: string
    boundedProbeIds: string[]
    schemaClassification: string
    finElectronStatus: string
    finAgentStatus: string
  }>
  guidance?: {
    progressiveDisclosurePath?: string[]
    normalWorkflowRule?: string
    rerunPolicy?: string
  }
}

interface RuntimeProbeTarget {
  interfaceId: string | null
  provider: string
  capabilityId: string | null
  probeId: string
  currentStatus: string
  reason: string
  expectedExitCondition: string
  riskPolicy: string
  timeoutPolicy: string
  normalWorkflowAllowedBeforeSuccess: boolean
  recommendedMode: 'credential' | 'unstable' | 'failures' | 'all'
  nextAction: string
  sourceQueue: string
}

type Tab = 'health' | 'feeds' | 'reusable' | 'coverage' | 'queue' | 'routing' | 'sources'
const DATA_PANEL_POLL_INTERVAL_MS = sidebarPanelContract('data').pollIntervalMs ?? 5000

export default function DataPanel() {
  const [tab, setTab] = useState<Tab>('health')
  const [stats, setStats] = useState<DataStats | null>(null)
  const [coverage, setCoverage] = useState<CoverageItem[]>([])
  const [tasks, setTasks] = useState<FetchTask[]>([])
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [feeds, setFeeds] = useState<FeedConfig[]>([])
  const [routing, setRouting] = useState<RoutingPolicy | null>(null)
  const [interfaceHealth, setInterfaceHealth] = useState<InterfaceHealth | null>(null)
  const [runtimeProbe, setRuntimeProbe] = useState<RuntimeProbeStatus | null>(null)
  const [feedsLoading, setFeedsLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, c, t, src, f, r, h, probe] = await Promise.all([
        ipc('data:stats'), ipc('data:coverage'), ipc('data:tasks'), ipc('data:sources'), ipc('data:feeds'), ipc('data:routing'), ipc('data:interface-health'), ipc('data:probe-status'),
      ])
      if (s) setStats(s as DataStats)
      if (c) setCoverage(c as CoverageItem[])
      if (t) setTasks(t as FetchTask[])
      if (src) setSources(src as SourceStatus[])
      if (f) {
        const result = f as any
        if (result.feeds) {
          setFeeds(result.feeds as FeedConfig[])
          setFeedsLoading(result.loading ?? false)
        } else if (Array.isArray(result)) {
          setFeeds(result as FeedConfig[])
          setFeedsLoading(false)
        }
      }
      if (r) setRouting(r as RoutingPolicy)
      if (h) setInterfaceHealth(h as InterfaceHealth)
      if (probe) setRuntimeProbe(probe as RuntimeProbeStatus)
    } catch {}
  }, [])

  const runProbe = useCallback(async (mode: 'credential' | 'unstable' | 'failures' | 'all') => {
    await ipc('data:run-probes', mode)
    await refresh()
  }, [refresh])

  useEffect(() => {
    refresh()
    timerRef.current = setInterval(refresh, DATA_PANEL_POLL_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [refresh])

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <Header stats={stats} onRefresh={refresh} />
      <TabBar tab={tab} setTab={setTab} />
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'health' && <HealthTab health={interfaceHealth} probeStatus={runtimeProbe} onRefresh={refresh} onRunProbe={runProbe} />}
        {tab === 'feeds' && <FeedsTab feeds={feeds} coverage={coverage} onRefresh={refresh} loading={feedsLoading} />}
        {tab === 'reusable' && <ReusableTab stats={stats} />}
        {tab === 'coverage' && <CoverageTab coverage={coverage} />}
        {tab === 'queue' && <QueueTab tasks={tasks} />}
        {tab === 'routing' && <RoutingTab routing={routing} sources={sources} />}
        {tab === 'sources' && <SourcesTab sources={sources} />}
      </div>
    </div>
  )
}

function Header({ stats, onRefresh }: { stats: DataStats | null; onRefresh: () => void }) {
  const t = useT()
  const sizeMb = stats ? (stats.sizeBytes / 1048576).toFixed(1) : '0'
  const totalRows = stats?.tables.reduce((s, t) => s + t.count, 0) ?? 0
  return (
    <div className="flex items-center px-4 py-2 border-b gap-4" style={{ borderColor: 'var(--border)' }}>
      <h2 className="text-sm font-semibold">{t('dataManagerTitle')}</h2>
      <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(totalRows)} {t('rowsLabel')} · {sizeMb} MB</span>
      <span className="flex-1" />
      <button onClick={onRefresh} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)' }}>{t('refresh')}</button>
    </div>
  )
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const t = useT()
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'health', label: t('dataHealth') },
    { id: 'feeds', label: `📡 ${t('dataFeeds')}` },
    { id: 'reusable', label: t('reusableData') },
    { id: 'coverage', label: `📈 ${t('coverageTitle')}` },
    { id: 'queue', label: `⬇️ ${t('queueTitle')}` },
    { id: 'routing', label: t('fetchRoutingTitle') },
    { id: 'sources', label: `🔌 ${t('sourcesTitle')}` },
  ]
  return (
    <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)}
          className={`px-4 py-2 text-xs border-b-2 ${tab === t.id ? 'border-blue-500' : 'border-transparent'}`}
          style={{ color: tab === t.id ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ReusableTab({ stats }: { stats: DataStats | null }) {
  const t = useT()
  const rows = stats?.reusable ?? []
  if (rows.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('noReusableDataSummary')}</div>
  }
  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <table className="w-full text-xs">
        <thead style={{ background: 'var(--bg-secondary)' }}>
          <tr>
            <th className="text-left p-2 font-medium">{t('dataset')}</th>
            <th className="text-right p-2 font-medium">{t('rowsLabel')}</th>
            <th className="text-left p-2 font-medium">{t('latest')}</th>
            <th className="text-left p-2 font-medium">{t('provenanceSource')}</th>
            <th className="text-left p-2 font-medium">{t('agentAccess')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td className="p-2 font-mono">{r.name}</td>
              <td className="p-2 text-right font-mono">{fmtN(r.count)}</td>
              <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{r.latest ?? '-'}</td>
              <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{r.sources ?? '-'}</td>
              <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>{agentAccessHint(r.name)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HealthTab({
  health,
  probeStatus,
  onRefresh,
  onRunProbe,
}: {
  health: InterfaceHealth | null
  probeStatus: RuntimeProbeStatus | null
  onRefresh: () => void
  onRunProbe: (mode: 'credential' | 'unstable' | 'failures' | 'all') => Promise<void>
}) {
  const t = useT()
  if (!health) return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('datastoreInitializing')}</div>
  const rows = [...health.rows].sort((a, b) => {
    const rank = { attention: 0, gap: 1, ready: 2 }
    return rank[a.health] - rank[b.health] || b.recentFailures - a.recentFailures || a.interfaceId.localeCompare(b.interfaceId)
  })
  const providerRows = [...(health.providerRows ?? [])].sort((a, b) => {
    const rank = { attention: 0, gap: 1, ready: 2 }
    return rank[a.health] - rank[b.health] || b.recentFailures - a.recentFailures || b.supported - a.supported || a.provider.localeCompare(b.provider)
  })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2 text-xs">
        <HealthMetric label={t('interfacesLabel')} value={health.summary.interfaces} />
        <HealthMetric label={t('readyLabel')} value={health.summary.ready} tone="good" />
        <HealthMetric label={t('gapsLabel')} value={health.summary.gaps} tone={health.summary.gaps > 0 ? 'warn' : 'good'} />
        <HealthMetric label={t('failuresLabel')} value={health.summary.recentFailures} tone={health.summary.recentFailures > 0 ? 'bad' : 'good'} />
        <HealthMetric label={t('providersLabel')} value={health.summary.providers.length} />
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <HealthMetric label={t('liveProbesLabel')} value={health.summary.liveStatusRows ?? 0} />
        <HealthMetric label={t('passedLabel')} value={health.summary.liveStatusPassed ?? 0} tone="good" />
        <HealthMetric label={t('blockedLabel')} value={health.summary.liveStatusFailedOrBlocked ?? 0} tone={(health.summary.liveStatusFailedOrBlocked ?? 0) > 0 ? 'warn' : 'good'} />
        <HealthMetric label={t('datasetsLabel')} value={health.summary.datasets ?? health.datasetRows?.length ?? 0} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <HealthMetric label={t('providerGapQueue')} value={health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0} tone={(health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0) > 0 ? 'warn' : 'good'} />
        <HealthMetric label={t('credentialActivationQueue')} value={health.summary.credentialActivationRows ?? health.credentialActivationQueue?.length ?? 0} />
        <HealthMetric label={t('credentialValidated')} value={health.summary.credentialValidatedRows ?? 0} tone="good" />
        <HealthMetric label={t('policyDisabledQueue')} value={health.summary.policyDisabledRows ?? health.policyDisabledQueue?.length ?? 0} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
        <div>
          {t('evidenceGeneratedAt')}: {health.summary.evidenceGeneratedAt ?? '-'} · {t('backlogLabel')}: {fmtN(health.summary.liveProbeBacklogRows ?? 0)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="shrink-0 rounded px-2 py-1 text-xs"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            title={t('credentialActionQueueHelp')}
          >
            {t('recheckCredentialState')}
          </button>
          <button
            onClick={() => void onRunProbe('all')}
            disabled={probeStatus?.running}
            className="shrink-0 rounded px-2 py-1 text-xs disabled:opacity-50"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
          >
            {t('runAllProbes')}
          </button>
        </div>
      </div>
      <HealthActionSummary health={health} />
      <div className="rounded border px-2 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{t('runtimeProbeStatus')}</span>
          <span className="font-mono" style={{ color: probeStatus?.running ? 'var(--accent)' : 'var(--text-tertiary)' }}>
            {probeStatus?.running ? t('probeRunning') : t('probeIdle')}
          </span>
          <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>
            {t('selectedProbes')}: {fmtN(probeStatus?.selectedCount ?? 0)}
          </span>
          <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>
            {t('lastProbeRun')}: {probeStatus?.finishedAt ?? probeStatus?.startedAt ?? '-'}
          </span>
          {probeStatus?.summary?.passed != null && (
            <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>
              {t('passedLabel')} {fmtN(Number(probeStatus.summary.passed ?? 0))} / {fmtN(Number(probeStatus.summary.total ?? 0))}
            </span>
          )}
          {probeStatus?.error && (
            <span className="font-mono" style={{ color: 'var(--red)' }}>
              {probeStatus.error}
            </span>
          )}
        </div>
        {probeStatus?.guidance && (
          <div className="mt-2 grid gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            <div>{t('runtimeProbePath')}: <span className="font-mono">{probeStatus.guidance.progressiveDisclosurePath?.join(' -> ')}</span></div>
            <div>{probeStatus.guidance.normalWorkflowRule}</div>
            <div>{probeStatus.guidance.rerunPolicy}</div>
          </div>
        )}
        <RuntimeProbeRecommendations probeStatus={probeStatus} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => void onRunProbe('credential')}
            disabled={probeStatus?.running}
            className="rounded px-2 py-1 disabled:opacity-50"
            style={{ background: 'var(--bg-secondary)' }}
          >
            {t('runCredentialProbes')}
          </button>
          <button
            onClick={() => void onRunProbe('unstable')}
            disabled={probeStatus?.running}
            className="rounded px-2 py-1 disabled:opacity-50"
            style={{ background: 'var(--bg-secondary)' }}
          >
            {t('runUnstableProbes')}
          </button>
          <button
            onClick={() => void onRunProbe('failures')}
            disabled={probeStatus?.running}
            className="rounded px-2 py-1 disabled:opacity-50"
            style={{ background: 'var(--bg-secondary)' }}
          >
            {t('runFailureProbes')}
          </button>
        </div>
      </div>
      <HealthQueues health={health} />
      <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>{t('providerHealth')}</div>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--bg-secondary)' }}>
            <tr>
              <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
              <th className="text-right p-2 font-medium">{t('supportedLabel')}</th>
              <th className="text-right p-2 font-medium">{t('gatedLabel')}</th>
              <th className="text-right p-2 font-medium">{t('outputOnlyLabel')}</th>
              <th className="text-right p-2 font-medium">{t('unstableLabel')}</th>
              <th className="text-right p-2 font-medium">{t('liveProbesLabel')}</th>
              <th className="text-left p-2 font-medium">{t('error')}</th>
            </tr>
          </thead>
          <tbody>
            {providerRows.map((row) => (
              <tr key={row.provider} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                <td className="p-2 font-mono" style={{ color: row.health === 'ready' ? 'var(--green)' : row.health === 'attention' ? 'var(--accent)' : 'var(--text-tertiary)' }}>{row.provider}</td>
                <td className="p-2 text-right font-mono">{fmtN(row.supported)}</td>
                <td className="p-2 text-right font-mono">{fmtN(row.gated)}</td>
                <td className="p-2 text-right font-mono">{fmtN(row.outputOnly)}</td>
                <td className="p-2 text-right font-mono">{fmtN(row.unstable)}</td>
                <td className="p-2 text-right font-mono">{fmtN(row.liveProbeCount ?? 0)} / {fmtN(row.livePassed ?? 0)}</td>
                <td className="p-2 font-mono" style={{ color: row.recentFailures > 0 ? 'var(--red)' : 'var(--text-tertiary)' }}>
                  {row.recentFailures > 0 ? `${row.recentFailures} · ${row.lastFailureClass ?? 'failure'} · ${row.lastFailure ?? row.lastFailureAt ?? '-'}` : row.nextAction ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--bg-secondary)' }}>
            <tr>
              <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
              <th className="text-left p-2 font-medium">{t('schemaLabel')}</th>
              <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
              <th className="text-right p-2 font-medium">{t('rowsLabel')}</th>
              <th className="text-left p-2 font-medium">{t('latest')}</th>
              <th className="text-left p-2 font-medium">{t('provenanceSource')}</th>
              <th className="text-left p-2 font-medium">{t('gapsLabel')}</th>
              <th className="text-left p-2 font-medium">{t('error')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.interfaceId} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                <td className="p-2">
                  <div className="font-mono">{row.interfaceId}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.chinesePurpose ?? row.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.cacheStatus} · {row.cachePolicy}</div>
                </td>
                <td className="p-2 font-mono">{row.canonicalSchema}</td>
                <td className="p-2 font-mono">
                  <div>{providerSupportSummary(row)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{capabilitySummary(row, t('noSupportedCapability'))}</div>
                </td>
                <td className="p-2 text-right font-mono">{fmtN(row.localRows)}</td>
                <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  <div>{row.latestSourceTime ?? row.latest ?? '-'}</div>
                  <div className="text-[10px]">{row.latestSourceTime ? t('sourceTimeLabel') : t('notAvailable')}</div>
                </td>
                <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{row.sources ?? '-'}</td>
                <td className="p-2 font-mono" style={{ color: row.health === 'ready' ? 'var(--green)' : 'var(--accent)' }}>
                  <div>{providerGapSummary(row)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{liveProbeSummary(row)} · {row.nextAction ?? '-'}</div>
                </td>
                <td className="p-2 font-mono" style={{ color: row.recentFailures > 0 ? 'var(--red)' : 'var(--text-tertiary)' }}>
                  {row.recentFailures > 0 ? `${row.recentFailures} · ${row.lastFailureClass ?? 'failure'} · ${row.lastFailure ?? row.lastFailureAt ?? '-'}${row.lastFailureAt ? ` · ${formatShortTime(row.lastFailureAt)}` : ''}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {health.datasetRows && health.datasetRows.length > 0 && (
        <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>{t('datasetHealth')}</div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('schemaLabel')}</th>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-right p-2 font-medium">{t('rowsLabel')}</th>
                <th className="text-right p-2 font-medium">{t('backlogLabel')}</th>
                <th className="text-left p-2 font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {health.datasetRows.slice(0, 12).map((row) => (
                <tr key={row.canonicalSchema} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-mono">{row.canonicalSchema}</td>
                  <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{row.interfaces.join(', ')}</td>
                  <td className="p-2 text-right font-mono">{fmtN(row.detailedRows)}</td>
                  <td className="p-2 text-right font-mono">{fmtN(row.liveProbeBacklog)}</td>
                  <td className="p-2 font-mono" style={{ color: row.healthState === 'observed' || row.healthState === 'registered' ? 'var(--green)' : 'var(--accent)' }}>{row.healthState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HealthActionSummary({ health }: { health: InterfaceHealth }) {
  const t = useT()
  const runtimeFailures = health.failureActionQueue ?? []
  const credentialRows = health.credentialActivationQueue ?? []
  const validatedCredentialRows = health.credentialValidatedQueue ?? []
  const gapRows = health.providerGapQueue ?? []
  const disabledRows = health.policyDisabledQueue ?? []
  const cards = [
    {
      key: 'runtime',
      title: t('failureActionQueue'),
      count: runtimeFailures.length,
      tone: runtimeFailures.length > 0 ? 'bad' as const : 'good' as const,
      help: 'Provider paths with failed runtime evidence. Fix dependency, retry bounded probe, or keep cache/fallback first.',
      rows: runtimeFailures.slice(0, 3).map((row) => ({
        head: `${row.failureClass ?? row.validationState ?? row.status ?? 'failure'} · ${row.provider ?? '-'}`,
        body: `${(row.affectedInterfaces ?? []).join(', ') || row.family || row.probeId || '-'} · ${row.probeId ?? '-'}`,
        action: row.nextAction ?? row.error ?? row.exitCondition ?? failureExitCondition(row.failureClass ?? null),
        title: [
          row.presenceReason ?? row.error ?? '',
          row.exitCondition ?? failureExitCondition(row.failureClass ?? null),
          row.retryPolicy ?? '',
          row.nextAction ?? '',
        ].filter(Boolean).join('\n'),
      })),
    },
    {
      key: 'credential',
      title: t('credentialActivationQueue'),
      count: credentialRows.length,
      tone: credentialRows.length > 0 ? 'warn' as const : 'good' as const,
      help: 'Configured or gated provider capabilities waiting for live validation, entitlement, or quota confirmation.',
      rows: credentialRows.slice(0, 3).map((row) => ({
        head: `${row.provider} · ${row.activationLabel ?? row.activationState ?? row.status}`,
        body: `${row.interfaceId} · ${row.capabilityId ?? row.probeId ?? '-'}`,
        action: row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null),
        title: `${row.interfaceId} · ${row.capabilityId ?? row.probeId ?? '-'}\n${row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null)}`,
      })),
    },
    {
      key: 'credential-validated',
      title: t('credentialValidated'),
      count: validatedCredentialRows.length,
      tone: 'good' as const,
      help: 'Credential-gated capabilities with current live valid-schema evidence. They are not pending activation work.',
      rows: validatedCredentialRows.slice(0, 3).map((row) => ({
        head: `${row.provider} · ${row.activationLabel ?? row.activationState ?? row.liveStatus ?? row.status}`,
        body: `${row.interfaceId} · ${row.capabilityId ?? row.probeId ?? '-'}`,
        action: row.nextAction ?? row.reason ?? 'Keep cache/readback first; route through the governed interface when provider policy allows it.',
        title: [
          row.presenceReason ?? row.reason ?? `${row.provider}/${row.interfaceId} has current valid-schema evidence.`,
          row.exitCondition ?? 'Leaves this evidence list when validation expires, credentials/quota become unavailable, the capability is promoted, or it is reclassified.',
          row.retryPolicy ?? 'no broad retry; rerun only the registered credential probe when evidence is stale or configuration changes',
          row.nextAction ?? '',
        ].filter(Boolean).join('\n'),
      })),
    },
    {
      key: 'gap',
      title: t('providerGapQueue'),
      count: gapRows.length,
      tone: gapRows.length > 0 ? 'warn' as const : 'good' as const,
      help: 'Known provider/interface gaps. Some need implementation; some need bounded live retry; none are unknown schema.',
      rows: gapRows.slice(0, 3).map((row) => ({
        head: `${row.gapClass ?? row.status} · ${row.provider}`,
        body: `${row.interfaceId} · ${row.capabilityId ?? row.probeId ?? '-'}`,
        action: row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null),
        title: `${row.interfaceId} · ${row.capabilityId ?? row.probeId ?? '-'}\n${row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null)}`,
      })),
    },
    {
      key: 'disabled',
      title: t('policyDisabledQueue'),
      count: disabledRows.length,
      tone: disabledRows.length > 0 ? 'neutral' as const : 'good' as const,
      help: 'Routes intentionally kept out of normal workflow. These should not be retried by agent prompts.',
      rows: disabledRows.slice(0, 3).map((row) => ({
        head: `${row.status} · ${row.provider}`,
        body: `${row.interfaceId} · ${row.capabilityId ?? '-'}`,
        action: row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null),
        title: `${row.interfaceId} · ${row.capabilityId ?? '-'}\n${row.nextAction ?? row.reason ?? queueExitCondition(row.status, row.gapClass ?? null)}`,
      })),
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.key} className="rounded border p-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }} title={card.help}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">{card.title}</span>
            <span className="font-mono" style={{ color: toneColor(card.tone) }}>{fmtN(card.count)}</span>
          </div>
          <div className="space-y-1">
            {card.rows.length === 0 && (
              <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>-</div>
            )}
            {card.rows.map((row, index) => (
              <div key={`${card.key}-${index}`} className="rounded px-2 py-1" style={{ background: 'var(--bg)' }} title={row.title ?? `${row.body}\n${row.action}`}>
                <div className="break-words font-mono">{row.head}</div>
                <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.body}</div>
                <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.action}</div>
              </div>
            ))}
            {card.count > card.rows.length && (
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(card.count - card.rows.length)} {t('moreCount')}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RuntimeProbeRecommendations({ probeStatus }: { probeStatus: RuntimeProbeStatus | null }) {
  const t = useT()
  const recommended = probeStatus?.recommendedTargets ?? []
  const blocked = probeStatus?.blockedTargets ?? []
  const packs = probeStatus?.providerProbePacks ?? []
  if (recommended.length === 0 && blocked.length === 0 && packs.length === 0) return null
  return (
    <div className="mt-2 grid gap-2 xl:grid-cols-3">
      <div className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">{t('recommendedProbeTargets')}</span>
          <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(recommended.length)}</span>
        </div>
        <div className="space-y-1">
          {recommended.slice(0, 5).map((target) => <RuntimeProbeTargetRow key={target.probeId} target={target} />)}
          {recommended.length === 0 && <div style={{ color: 'var(--text-tertiary)' }}>{t('noRecommendedProbeTargets')}</div>}
          {recommended.length > 5 && <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(recommended.length - 5)} {t('moreCount')}</div>}
        </div>
      </div>
      <div className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">{t('blockedProbeTargets')}</span>
          <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(blocked.length)}</span>
        </div>
        <div className="space-y-1">
          {blocked.slice(0, 5).map((target) => <RuntimeProbeTargetRow key={target.probeId} target={target} />)}
          {blocked.length === 0 && <div style={{ color: 'var(--text-tertiary)' }}>{t('noBlockedProbeTargets')}</div>}
          {blocked.length > 5 && <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(blocked.length - 5)} {t('moreCount')}</div>}
        </div>
      </div>
      <div className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">{t('providerProbePacks')}</span>
          <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(packs.length)}</span>
        </div>
        <div className="space-y-1">
          {packs.slice(0, 4).map((pack) => (
            <div key={pack.provider} className="rounded px-2 py-1" style={{ background: 'var(--bg-secondary)' }} title={`${pack.finElectronStatus}\n${pack.finAgentStatus}\n${pack.schemaClassification}`}>
              <div className="font-mono">{pack.provider} · {pack.status}</div>
              <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{pack.boundedProbeIds.slice(0, 3).join(', ')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RuntimeProbeTargetRow({ target }: { target: RuntimeProbeTarget }) {
  return (
    <div className="rounded px-2 py-1" style={{ background: 'var(--bg-secondary)' }} title={`${target.reason}\nExit: ${target.expectedExitCondition}\nNext: ${target.nextAction}\nRisk: ${target.riskPolicy}\nTimeout: ${target.timeoutPolicy}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-all font-mono">{target.probeId}</span>
        <span className="font-mono text-[10px]" style={{ color: target.normalWorkflowAllowedBeforeSuccess ? 'var(--green)' : 'var(--accent)' }}>{target.recommendedMode}</span>
      </div>
      <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        {target.interfaceId ?? '-'} · {target.provider} · {target.currentStatus}
      </div>
      <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{target.nextAction}</div>
    </div>
  )
}

function HealthQueues({ health }: { health: InterfaceHealth }) {
  const t = useT()
  const gaps = health.providerGapQueue ?? []
  const activations = health.credentialActivationQueue ?? []
  const validatedCredentials = health.credentialValidatedQueue ?? []
  const policyDisabled = health.policyDisabledQueue ?? []
  const failures = health.failureActionQueue ?? []
  if (gaps.length === 0 && activations.length === 0 && validatedCredentials.length === 0 && policyDisabled.length === 0 && failures.length === 0) return null
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {activations.length > 0 && (
        <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-1">
              <span>{t('credentialActivationQueue')}</span>
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-mono"
                style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                title={t('credentialActionQueueHelp')}
              >
                i
              </span>
              <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(activations.length)}</span>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
                <th className="text-left p-2 font-medium">{t('liveStatusLabel')}</th>
                <th className="text-left p-2 font-medium">{t('activationStateLabel')}</th>
                <th className="text-left p-2 font-medium">{t('schemaLabel')}</th>
                <th className="text-left p-2 font-medium">{t('nextAction')}</th>
              </tr>
            </thead>
            <tbody>
              {activations.slice(0, 8).map((row) => (
                <tr key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}:${row.capabilityId ?? ''}`} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 min-w-0">
                    <div className="break-all font-mono" title={row.interfaceId}>{row.interfaceId}</div>
                    <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={row.chinesePurpose ?? row.canonicalSchema ?? ''}>
                      {row.chinesePurpose ?? row.canonicalSchema ?? '-'}
                    </div>
                  </td>
                  <td className="p-2 font-mono">{row.provider}</td>
                  <td className="p-2 font-mono" style={{ color: row.liveStatus === 'passed' ? 'var(--green)' : 'var(--text-tertiary)' }}>
                    {row.liveStatus ?? '-'}
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.liveValidationState ?? '-'}</div>
                  </td>
                  <td className="p-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    <div>{row.activationLabel ?? row.activationState ?? '-'}</div>
                    <div className="text-[10px]">{row.status}</div>
                  </td>
                  <td className="p-2 font-mono">
                    <div>{row.normalizer ?? '-'}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.canonicalTable ?? '-'}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="break-words" title={row.nextAction ?? row.reason ?? ''}>{row.nextAction ?? row.reason ?? '-'}</div>
                    <div className="break-words text-[10px]" title={row.cacheDecision ?? ''}>
                      <span className="font-medium">{t('cacheDecisionLabel')}: </span>
                      {row.cacheDecision ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={queueExitCondition(row.status, row.gapClass ?? null)}>{queueExitCondition(row.status, row.gapClass ?? null)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {validatedCredentials.length > 0 && (
        <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>
            {t('credentialValidated')} <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(validatedCredentials.length)}</span>
          </div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
                <th className="text-left p-2 font-medium">{t('liveStatusLabel')}</th>
                <th className="text-left p-2 font-medium">{t('schemaLabel')}</th>
                <th className="text-left p-2 font-medium">{t('nextAction')}</th>
              </tr>
            </thead>
            <tbody>
              {validatedCredentials.slice(0, 8).map((row) => (
                <tr key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}:${row.capabilityId ?? ''}`} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 min-w-0">
                    <div className="break-all font-mono" title={row.interfaceId}>{row.interfaceId}</div>
                    <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={row.chinesePurpose ?? row.canonicalSchema ?? ''}>
                      {row.chinesePurpose ?? row.canonicalSchema ?? '-'}
                    </div>
                  </td>
                  <td className="p-2 font-mono">{row.provider}</td>
                  <td className="p-2 font-mono" style={{ color: row.liveStatus === 'passed' ? 'var(--green)' : 'var(--text-tertiary)' }}>
                    {row.liveStatus ?? '-'}
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.liveValidationState ?? row.activationState ?? '-'}</div>
                  </td>
                  <td className="p-2 font-mono">
                    <div>{row.normalizer ?? '-'}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.canonicalTable ?? '-'}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="break-words" title={row.nextAction ?? row.reason ?? ''}>{row.nextAction ?? row.reason ?? '-'}</div>
                    <div className="break-words text-[10px]" title={row.cacheDecision ?? ''}>
                      <span className="font-medium">{t('cacheDecisionLabel')}: </span>
                      {row.cacheDecision ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={row.exitCondition ?? ''}>
                      {row.exitCondition ?? 'Validated evidence stays visible while the capability remains credential-gated for unconfigured runtimes.'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {validatedCredentials.length > 8 && <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(validatedCredentials.length - 8)} {t('moreCount')}</div>}
        </div>
      )}
      {gaps.length > 0 && (
        <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>
            {t('providerGapQueue')} <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(gaps.length)}</span>
          </div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
                <th className="text-left p-2 font-medium">{t('actionPriority')}</th>
                <th className="text-left p-2 font-medium">{t('gapClassLabel')}</th>
                <th className="text-left p-2 font-medium">{t('nextAction')}</th>
              </tr>
            </thead>
            <tbody>
              {gaps.slice(0, 8).map((row) => (
                <tr key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}:${row.capabilityId ?? ''}`} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 min-w-0">
                    <div className="break-all font-mono" title={row.interfaceId}>{row.interfaceId}</div>
                    <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={row.chinesePurpose ?? row.canonicalSchema ?? ''}>
                      {row.chinesePurpose ?? row.canonicalSchema ?? '-'}
                    </div>
                    <div className="break-all text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }} title={row.category ?? ''}>
                      {row.category ?? '-'}
                    </div>
                  </td>
                  <td className="p-2 font-mono">{row.provider}</td>
                  <td className="p-2 font-mono">
                    <span style={{ color: row.actionPriority === 1 ? 'var(--accent)' : 'var(--text-tertiary)' }}>{row.actionPriority ?? '-'}</span>
                  </td>
                  <td className="p-2 font-mono">
                    <div>{row.gapClass ?? row.status}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.status} · {row.routeWiringStatus ?? row.capabilityId ?? '-'}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="break-words" title={row.nextAction ?? row.reason ?? ''}>{row.nextAction ?? row.reason ?? '-'}</div>
                    <div className="break-words text-[10px]" title={row.cacheDecision ?? ''}>
                      <span className="font-medium">{t('cacheDecisionLabel')}: </span>
                      {row.cacheDecision ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={queueExitCondition(row.status, row.gapClass ?? null)}>{queueExitCondition(row.status, row.gapClass ?? null)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length > 8 && <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(gaps.length - 8)} {t('moreCount')}</div>}
        </div>
      )}

      {policyDisabled.length > 0 && (
        <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>
            {t('policyDisabledQueue')} <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(policyDisabled.length)}</span>
          </div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
                <th className="text-left p-2 font-medium">{t('status')}</th>
                <th className="text-left p-2 font-medium">{t('nextAction')}</th>
              </tr>
            </thead>
            <tbody>
              {policyDisabled.slice(0, 8).map((row) => (
                <tr key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}:${row.capabilityId ?? ''}`} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 min-w-0">
                    <div className="break-all font-mono" title={row.interfaceId}>{row.interfaceId}</div>
                    <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={row.chinesePurpose ?? row.canonicalSchema ?? ''}>
                      {row.chinesePurpose ?? row.canonicalSchema ?? '-'}
                    </div>
                  </td>
                  <td className="p-2 font-mono">{row.provider}</td>
                  <td className="p-2 font-mono">
                    <div>{row.status}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.gapClass ?? '-'}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="break-words" title={row.nextAction ?? row.reason ?? ''}>{row.nextAction ?? row.reason ?? '-'}</div>
                    <div className="break-words text-[10px]" title={row.cacheDecision ?? ''}>
                      <span className="font-medium">{t('cacheDecisionLabel')}: </span>
                      {row.cacheDecision ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={queueExitCondition(row.status, row.gapClass ?? null)}>{queueExitCondition(row.status, row.gapClass ?? null)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {policyDisabled.length > 8 && <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(policyDisabled.length - 8)} {t('moreCount')}</div>}
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-secondary)' }}>
            {t('failureActionQueue')} <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{fmtN(failures.length)}</span>
          </div>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-secondary)' }}>
              <tr>
                <th className="text-left p-2 font-medium">{t('providersLabel')}</th>
                <th className="text-left p-2 font-medium">{t('interfaceLabel')}</th>
                <th className="text-left p-2 font-medium">{t('failureClassLabel')}</th>
                <th className="text-left p-2 font-medium">{t('nextAction')}</th>
              </tr>
            </thead>
            <tbody>
              {failures.slice(0, 8).map((row, index) => (
                <tr key={row.id ?? `${row.probeId ?? row.family ?? 'failure'}:${index}`} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-mono">{row.provider ?? '-'}</td>
                  <td className="p-2 min-w-0">
                    <div className="break-all font-mono" title={row.probeId ?? row.family ?? ''}>{row.probeId ?? row.family ?? '-'}</div>
                    <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={(row.affectedInterfaces ?? []).join(', ')}>
                      {(row.affectedInterfaces ?? []).join(', ') || row.family || '-'}
                    </div>
                    <div className="break-all text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }} title={buildFailureEvidenceText(row)}>
                      {buildFailureEvidenceText(row)}
                    </div>
                    {(row.affectedRows ?? []).length > 0 && (
                      <div className="break-words text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={(row.affectedRows ?? []).join(', ')}>
                        {t('matrixRowsLabel')}: {(row.affectedRows ?? []).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="p-2 font-mono" style={{ color: row.validationState === 'runtime-blocked' ? 'var(--accent)' : 'var(--red)' }}>
                    <div>{row.failureClass ?? '-'}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{row.validationState ?? row.status ?? '-'}</div>
                  </td>
                  <td className="p-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="break-words" title={row.presenceReason ?? row.error ?? ''}>
                      <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{t('presenceReasonLabel')}: </span>
                      {row.presenceReason ?? row.error ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={row.exitCondition ?? failureExitCondition(row.failureClass ?? null)}>
                      <span className="font-medium">{t('exitConditionLabel')}: </span>
                      {row.exitCondition ?? failureExitCondition(row.failureClass ?? null)}
                    </div>
                    <div className="break-words text-[10px]" title={row.retryPolicy ?? ''}>
                      <span className="font-medium">{t('retryPolicyLabel')}: </span>
                      {row.retryPolicy ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={row.cacheDecision ?? ''}>
                      <span className="font-medium">{t('cacheDecisionLabel')}: </span>
                      {row.cacheDecision ?? '-'}
                    </div>
                    <div className="break-words text-[10px]" title={row.nextAction ?? ''}>
                      <span className="font-medium">{t('nextAction')}: </span>
                      {row.nextAction ?? '-'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {failures.length > 8 && <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+{fmtN(failures.length - 8)} {t('moreCount')}</div>}
        </div>
      )}
    </div>
  )
}

function HealthMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--accent)' : 'var(--text-primary)'
  return (
    <div className="rounded border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="text-lg font-mono" style={{ color }}>{value}</div>
    </div>
  )
}

function toneColor(tone: 'neutral' | 'good' | 'warn' | 'bad'): string {
  return tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--accent)' : 'var(--text-primary)'
}

function queueExitCondition(status?: string | null, gapClass?: string | null): string {
  if (status === 'credential-gated' || status === 'quota-gated') return 'Exit: configure provider state and pass live validation, or reclassify as blocked/unsupported.'
  if (status === 'disabled') return 'Exit: policy changes, or keep disabled and out of normal workflow.'
  if (status === 'not-supported') return 'Exit: implement interface/provider/normalizer/readback, or keep explicit not-supported.'
  if (status === 'output-only' || status === 'deferred') return 'Exit: promote through full interface contract, or keep evidence-only.'
  if (gapClass === 'serial-live-retry') return 'Exit: bounded probe passes, or failure is classified as implementation/provider work.'
  return 'Exit: resolve listed action and refresh data health.'
}

function failureExitCondition(failureClass?: string | null): string {
  if (failureClass === 'credential-or-permission') return 'Exit: credential/permission fixed and live validation passes.'
  if (failureClass === 'quota-or-rate-limit') return 'Exit: quota resets or provider entitlement is restored.'
  if (failureClass === 'transport' || failureClass === 'timeout') return 'Exit: bounded retry passes, or route remains degraded/cache-first.'
  if (failureClass === 'runtime-blocked') return 'Exit: runtime dependency or implementation gap is fixed.'
  return 'Exit: fresh evidence passes or failure is reclassified as non-retryable.'
}

function providerGapSummary(row: InterfaceHealth['rows'][number]): string {
  const parts = row.capabilities
    .filter((capability) => capability.status !== 'supported' && capability.status !== 'global-only' && capability.status !== 'not-supported')
    .map((capability) => {
      const reason = capability.reason ? `:${capability.reason}` : ''
      const probe = capability.probeId ? `:${capability.probeId}` : ''
      return `${capability.provider}=${capability.status}${probe}${reason}`
    })
  return parts.join(' ') || 'ready'
}

function capabilitySummary(row: InterfaceHealth['rows'][number], fallback: string): string {
  const supported = row.capabilities
    .filter((capability) => capability.status === 'supported' || capability.status === 'global-only')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((capability) => `${capability.capabilityId}${capability.probeId ? `/${capability.probeId}` : ''}`)
  if (supported.length > 0) return supported.slice(0, 3).join(' · ')
  const gated = row.capabilities
    .filter((capability) => capability.status === 'credential-gated' || capability.status === 'quota-gated')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((capability) => `${capability.provider} (${capability.status})${capability.probeId ? `/${capability.probeId}` : ''}`)
  if (gated.length > 0) return gated.slice(0, 3).join(' · ')
  return fallback
}

function providerSupportSummary(row: InterfaceHealth['rows'][number]): string {
  if (row.supportedProviders.length > 0) return row.supportedProviders.join(', ')
  if (row.gatedProviders.length > 0) return row.gatedProviders.map((provider) => `${provider} (credential-gated)`).join(', ')
  if (row.outputOnlyProviders.length > 0) return row.outputOnlyProviders.map((provider) => `${provider} (output-only)`).join(', ')
  if (row.unstableProviders.length > 0) return row.unstableProviders.map((provider) => `${provider} (unstable)`).join(', ')
  if (row.disabledProviders.length > 0) return row.disabledProviders.map((provider) => `${provider} (disabled)`).join(', ')
  return '-'
}

function liveProbeSummary(row: InterfaceHealth['rows'][number]): string {
  const ids = row.liveProbeIds ?? []
  const passed = row.passedLiveRows ?? 0
  const failures = row.liveFailures ?? 0
  const backlog = row.liveProbeBacklog ?? 0
  if (ids.length === 0 && passed === 0 && failures === 0 && backlog === 0) return 'live: -'
  return `live: ${passed}/${ids.length}${failures > 0 ? ` fail ${failures}` : ''}${backlog > 0 ? ` backlog ${backlog}` : ''}`
}

function agentAccessHint(name: string): string {
  if (name === 'quote_snapshot') return t('agentAccessQuote')
  if (name === 'api_result_cache') return t('agentAccessApiCache')
  if (name === 'api_call_log') return t('agentAccessApiLog')
  if (name === 'kline_daily') return t('agentAccessKline')
  if (name === 'fundamental') return t('agentAccessFundamental')
  return t('agentAccessGeneric')
}

// --- Feeds Tab: per-type control cards ---

function FeedsTab({ feeds, coverage, onRefresh, loading }: { feeds: FeedConfig[]; coverage: CoverageItem[]; onRefresh: () => void; loading: boolean }) {
  const t = useT()
  if (loading) return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('datastoreInitializing')}</div>
  if (feeds.length === 0) return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('noFeedConfigs')}</div>
  const latestManualRun = feeds
    .map((feed) => feed.last_run_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null

  return (
    <div className="space-y-3">
      <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="font-medium">{t('dataFeeds')}</div>
        <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Use each feed card's {t('runNow')} button to manually download or refresh that dataset.
          {latestManualRun ? ` ${t('lastRun')}: ${formatShortTime(latestManualRun)}.` : ''}
        </div>
      </div>
      {feeds.map((feed) => (
        <FeedCard key={feed.feed_id} feed={feed} coverage={coverage} onRefresh={onRefresh} />
      ))}
    </div>
  )
}

function FeedCard({ feed, coverage, onRefresh }: { feed: FeedConfig; coverage: CoverageItem[]; onRefresh: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [runMsg, setRunMsg] = useState('')
  const relatedCoverage = coverage.filter((c) => c.data_type === feed.feed_type)
  const totalBars = relatedCoverage.reduce((s, c) => s + c.row_count, 0)
  const latestDate = relatedCoverage.reduce((max, c) => c.latest_date && c.latest_date > max ? c.latest_date : max, '')
  const resolvedCount = feed.resolved_count ?? feed.resolved_codes?.length ?? 0

  const updateFeed = async (updates: Record<string, unknown>) => {
    await ipc('data:feed-update', feed.feed_id, updates)
    onRefresh()
  }

  const runFeed = async () => {
    setRunMsg(t('starting'))
    const result = await ipc('data:feed-run', feed.feed_id) as any
    if (result?.error) {
      setRunMsg(`${t('errorPrefix')}: ${result.error}`)
      if (result.openSettings) setEditing(true)
    } else {
      setRunMsg(result?.message ?? `#${result?.id ?? '?'} ${t('taskQueued')}`)
    }
    onRefresh()
    setTimeout(() => setRunMsg(''), 5000)
  }

  const stopFeed = async () => {
    await ipc('data:feed-stop', feed.feed_id)
    setRunMsg(t('stopped'))
    onRefresh()
    setTimeout(() => setRunMsg(''), 3000)
  }

  const actionableFeedFailure = isActionableFeedFailure(feed)
  const historicalFeedError = Boolean(feed.last_error) && !actionableFeedFailure
  const statusColor = feed.status === 'running'
    ? 'bg-green-500 animate-pulse'
    : actionableFeedFailure
      ? 'bg-red-500'
      : historicalFeedError
        ? 'bg-amber-400'
        : feed.enabled ? 'bg-gray-400' : 'bg-gray-300'
  const statusLabel = feed.status === 'running'
    ? t('runningStatus')
    : actionableFeedFailure
      ? t('error')
      : historicalFeedError
        ? t('historicalStatus')
        : feed.enabled ? t('idle') : t('disabled')
  const runMsgIsError = runMsg.startsWith(`${t('errorPrefix')}:`)

  return (
    <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', opacity: feed.enabled ? 1 : 0.6 }}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="font-medium text-sm">{feed.display_name}</span>
        <span className="flex-1" />

        <button onClick={() => updateFeed({ enabled: feed.enabled ? 0 : 1 })}
          className="px-2 py-0.5 rounded" style={{ background: 'var(--bg-primary)' }}>
          {feed.enabled ? t('disable') : t('enable')}
        </button>

        {feed.status === 'running' ? (
          <button onClick={stopFeed} className="px-2 py-0.5 rounded bg-red-100 text-red-700">{t('stop')}</button>
        ) : (
          <button
            onClick={runFeed}
            className="px-2 py-0.5 rounded bg-blue-100 text-blue-700"
            disabled={!feed.enabled}
          >
            {t('runNow')}
          </button>
        )}

        <button onClick={() => setEditing(!editing)} className="px-2 py-0.5 rounded" style={{ background: 'var(--bg-primary)' }}>
          {editing ? t('done') : t('settingsAction')}
        </button>
      </div>

      <div className="flex gap-4 mt-2" style={{ color: 'var(--text-tertiary)' }}>
        <span>{statusLabel}</span>
        <span>{resolvedCount} {t('feedSymbols')}</span>
        <span>{fmtN(totalBars)} {t('rowsLabel')}</span>
        {latestDate && <span>{t('latest')}: {latestDate}</span>}
        {feed.last_run_at && <span>{t('lastRun')}: {new Date(feed.last_run_at).toLocaleString()}</span>}
      </div>

      {runMsg && <div className={`mt-1 text-[10px] break-words ${runMsgIsError ? 'text-red-500' : 'text-blue-500'}`}>{runMsg}</div>}

      {feed.last_error && (
        <div className={`mt-1 break-words ${actionableFeedFailure ? 'text-red-500' : 'text-amber-500'}`}>
          {actionableFeedFailure ? feed.last_error : `${t('historicalFeedError')}: ${feed.last_error}`}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <SettingRow label={t('scope')}>
            <select value={feed.scope} onChange={(e) => updateFeed({ scope: e.target.value })}
              className="text-xs p-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
              <option value="watchlist">{t('watchlistStocks')}</option>
              <option value="csi300">{t('scopeCsi300')}</option>
              <option value="csi500">{t('scopeCsi500')}</option>
              <option value="all">{t('scopeAllAShares')}</option>
              <option value="custom">{t('customCodes')}</option>
              <option value="preset">{t('scopePresetIndex')}</option>
            </select>
          </SettingRow>

          {feed.scope === 'custom' && (
            <SettingRow label={t('codeLabel')}>
              <input type="text" value={feed.scope_codes ?? ''} placeholder={t('feedScopeCodesPlaceholder')}
                onChange={(e) => updateFeed({ scope_codes: e.target.value })}
                className="text-xs p-1 rounded w-60" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </SettingRow>
          )}

          <SettingRow label={t('history')}>
            <select value={feed.history_years} onChange={(e) => updateFeed({ history_years: Number(e.target.value) })}
              className="text-xs p-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
              <option value={0}>{t('notApplicableShort')}</option>
              <option value={1}>{t('year1')}</option>
              <option value={3}>{t('year3')}</option>
              <option value={5}>{t('year5')}</option>
              <option value={10}>{t('year10')}</option>
            </select>
          </SettingRow>

          <SettingRow label={t('frequency')}>
            <select value={feed.update_frequency} onChange={(e) => updateFeed({ update_frequency: e.target.value })}
              className="text-xs p-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
              <option value="manual">{t('manualOnly')}</option>
              <option value="5min">{t('every5Min')}</option>
              <option value="30min">{t('every30Min')}</option>
              <option value="hourly">{t('hourly')}</option>
              <option value="daily_close">{t('afterMarketClose')}</option>
              <option value="weekly">{t('weekly')}</option>
              <option value="monthly">{t('monthly')}</option>
              <option value="quarterly">{t('quarterly')}</option>
              <option value="yearly">{t('yearly')}</option>
            </select>
          </SettingRow>

          {(feed.update_frequency === 'daily_close' || feed.update_frequency === 'hourly') && (
            <SettingRow label={t('triggerAt')}>
              <input type="time" value={feed.trigger_time ?? '15:30'}
                onChange={(e) => updateFeed({ trigger_time: e.target.value })}
                className="text-xs p-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>({t('beijingTime')})</span>
            </SettingRow>
          )}

          <SettingRow label={t('sourcePriorityLabel')}>
            <FeedSourcePriorityEditor feed={feed} onUpdate={updateFeed} />
          </SettingRow>
        </div>
      )}
    </div>
  )
}

function FeedSourcePriorityEditor(
  { feed, onUpdate }: {
    feed: FeedConfig
    onUpdate: (updates: Record<string, unknown>) => Promise<void>
  },
) {
  const t = useT()
  const [value, setValue] = useState(displaySourcePriority(feed.source_priority))
  const [error, setError] = useState('')

  useEffect(() => {
    setValue(displaySourcePriority(feed.source_priority))
    setError('')
  }, [feed.source_priority])

  const save = async () => {
    try {
      const sourcePriority = serializeSourcePriorityInput(value)
      if (sourcePriority !== feed.source_priority) await onUpdate({ source_priority: sourcePriority })
      setError('')
    } catch {
      setError(t('sourcePriorityInvalid'))
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        type="text"
        value={value}
        placeholder={t('sourcePriorityPlaceholder')}
        onChange={(event) => {
          setValue(event.target.value)
          setError('')
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          }
          if (event.key === 'Escape') {
            setValue(displaySourcePriority(feed.source_priority))
            setError('')
          }
        }}
        className="text-xs p-1 rounded w-72 font-mono"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      />
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-right" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </div>
  )
}

// --- Coverage Tab ---

function CoverageTab({ coverage }: { coverage: CoverageItem[] }) {
  const t = useT()
  const byType = new Map<string, CoverageItem[]>()
  for (const c of coverage) {
    if (!byType.has(c.data_type)) byType.set(c.data_type, [])
    byType.get(c.data_type)!.push(c)
  }

  return (
    <div className="space-y-4">
      {[...byType.entries()].map(([type, items]) => (
        <div key={type}>
          <h3 className="text-xs font-medium mb-1">{type} <span style={{ color: 'var(--text-tertiary)' }}>({items.length} {t('feedSymbols')})</span></h3>
          <table className="w-full text-xs">
            <thead><tr style={{ color: 'var(--text-tertiary)' }}>
              <th className="text-left py-1 px-2">{t('codeLabel')}</th>
              <th className="text-left py-1 px-2">{t('earliest')}</th>
              <th className="text-left py-1 px-2">{t('latest')}</th>
              <th className="text-right py-1 px-2">{t('rowsLabel')}</th>
            </tr></thead>
            <tbody>
              {items.slice(0, 50).map((c) => (
                <tr key={c.code} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-0.5 px-2 font-mono">{c.code}</td>
                  <td className="py-0.5 px-2" style={{ color: 'var(--text-tertiary)' }}>{c.earliest_date ?? '-'}</td>
                  <td className="py-0.5 px-2" style={{ color: 'var(--text-tertiary)' }}>{c.latest_date ?? '-'}</td>
                  <td className="py-0.5 px-2 text-right font-mono">{c.row_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 50 && <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>+{items.length - 50} {t('moreCount')}</div>}
        </div>
      ))}
      {coverage.length === 0 && <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('noDataDownloadedYet')}</div>}
    </div>
  )
}

// --- Queue Tab ---

function QueueTab({ tasks }: { tasks: FetchTask[] }) {
  const t = useT()
  if (tasks.length === 0) return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('noFetchTasks')}</div>
  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const progress = parseProgress(task.progress)
        const pct = progress?.total ? Math.round((progress.fetched / progress.total) * 100) : 0
        return (
          <div key={task.id} className="p-2 rounded text-xs" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${task.status === 'running' ? 'bg-green-500 animate-pulse' : task.status === 'done' ? 'bg-blue-500' : task.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`} />
              <span className="font-mono">{task.task_type}</span>
              {task.code && <span style={{ color: 'var(--text-tertiary)' }}>{task.code}</span>}
              <span className="flex-1" />
              <span style={{ color: 'var(--text-tertiary)' }}>{task.status}</span>
            </div>
            <div className="mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {t('lastRun')}: {formatShortTime(task.updated_at ?? task.created_at)}
            </div>
            {progress && progress.total > 0 && (
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono w-10 text-right" style={{ color: 'var(--text-tertiary)' }}>{pct}%</span>
              </div>
            )}
            {progress?.message && <div className="mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{progress.message}</div>}
            {task.error && <div className="mt-1 text-red-500 truncate">{task.error}</div>}
          </div>
        )
      })}
    </div>
  )
}

function formatShortTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function parseProgress(value: string | null | undefined): any {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return { message: String(value) }
  }
}

// --- Routing Tab ---

function RoutingTab({ routing, sources }: { routing: RoutingPolicy | null; sources: SourceStatus[] }) {
  const t = useT()
  if (!routing) return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t('datastoreInitializing')}</div>
  const statusBySource = new Map(sources.map((source) => [source.source, source]))
  return (
    <div className="space-y-3">
      <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="font-medium">{t('fetchRoutingTitle')}</div>
        <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>{t('routingHint')}</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div className="rounded px-2 py-1" style={{ background: 'var(--bg-primary)' }}>
            <div className="font-medium">{t('routingReadPathTitle')}</div>
            <div className="mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{t('routingReadPathHint')}</div>
          </div>
          <div className="rounded px-2 py-1" style={{ background: 'var(--bg-primary)' }}>
            <div className="font-medium">{t('routingFetchPathTitle')}</div>
            <div className="mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{t('routingFetchPathHint')}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <GateBadge label="Wind" ok={Boolean(routing.gates.windConfigured)} offText={routing.disabled.wind} />
          <GateBadge label="Tushare" ok={Boolean(routing.gates.tushareConfigured)} offText={routing.disabled.tushare} />
          <GateBadge label="AkShare" ok={Boolean(routing.gates.allowAkshareCompatibility)} />
        </div>
      </div>

      <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="font-medium">{t('storagePolicyTitle')}</div>
        <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>{t('storagePolicyHint')}</div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {(routing.cachePolicies ?? []).map((item) => (
            <div key={item.task} className="rounded px-2 py-1" style={{ background: 'var(--bg-primary)' }}>
              <div className="font-medium">{routeLabel(item.task, t)}</div>
              <div className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {item.policy.mode}
                {item.policy.maxAgeMs != null ? ` · ttl ${formatDuration(item.policy.maxAgeMs)}` : ''}
                {item.policy.minRows != null ? ` · min ${item.policy.minRows} rows` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {routing.routes.map((route) => (
        <div key={route.task} className="rounded border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <span className="font-medium">{routeLabel(route.task, t)}</span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{route.task}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {route.providers.map((provider, index) => {
              const status = statusBySource.get(provider)?.status ?? 'unknown'
              return (
                <div key={`${route.task}-${provider}`} className="flex items-center gap-1">
                  {index > 0 && <span style={{ color: 'var(--text-tertiary)' }}>→</span>}
                  <ProviderPill provider={provider} status={status} rank={index + 1} />
                </div>
              )
            })}
            {route.providers.length === 0 && <span style={{ color: 'var(--text-tertiary)' }}>{t('noAvailableRoute')}</span>}
          </div>
          <div className="mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{routeReason(route.task, t)}</div>
        </div>
      ))}
    </div>
  )
}

function GateBadge({ label, ok, offText }: { label: string; ok: boolean; offText?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      {label}: {ok ? 'on' : offText ?? 'off'}
    </span>
  )
}

function ProviderPill({ provider, status, rank }: { provider: string; status: string; rank: number }) {
  const tone = status === 'online'
    ? 'bg-green-100 text-green-700'
    : status === 'degraded'
      ? 'bg-yellow-100 text-yellow-700'
      : status === 'offline'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded ${tone}`}>
      <span className="font-mono text-[10px]">#{rank}</span>
      <span>{provider}</span>
      <span className="opacity-70">· {status}</span>
    </span>
  )
}

function routeLabel(task: string, t: (key: any) => string): string {
  const labels: Record<string, string> = {
    quote: t('routeQuote'),
    kline: t('routeKline'),
    indexQuote: t('routeIndexQuote'),
    indexKline: t('routeIndexKline'),
    sector: t('routeSector'),
    limitPool: t('routeLimitPool'),
    dragonTiger: t('routeDragonTiger'),
    fund: t('routeFund'),
    fundamental: t('routeFundamental'),
    moneyFlow: t('routeMoneyFlow'),
    macro: t('routeMacro'),
    intradayTick: t('routeIntradayTick'),
  }
  return labels[task] ?? task
}

function routeReason(task: string, t: (key: any) => string): string {
  if (task === 'quote' || task === 'kline' || task === 'indexQuote' || task === 'indexKline') return t('routingReasonRealtime')
  if (task === 'sector' || task === 'limitPool' || task === 'dragonTiger' || task === 'moneyFlow') return t('routingReasonEastmoney')
  if (task === 'fundamental' || task === 'macro') return t('routingReasonProfessional')
  if (task === 'fund') return t('routingReasonFund')
  return t('routingReasonGeneric')
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 3_600_000)}h`
}

// --- Sources Tab ---

function SourcesTab({ sources }: { sources: SourceStatus[] }) {
  const t = useT()
  const [configs, setConfigs] = useState<SourceConfig[]>([])
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  useEffect(() => {
    const sourceInfo: Record<string, { name: string; desc: string }> = {
      local: { name: t('sourceLocalName'), desc: t('sourceLocalDesc') },
      akshare: { name: t('sourceAkshareName'), desc: t('sourceAkshareDesc') },
      eastmoneyDirect: { name: t('sourceEastmoneyDirectName'), desc: t('sourceEastmoneyDirectDesc') },
      yfinance: { name: t('sourceYfinanceName'), desc: t('sourceYfinanceDesc') },
      tdx: { name: t('sourceTdxName'), desc: t('sourceTdxDesc') },
      wind: { name: t('sourceWindName'), desc: t('sourceWindDesc') },
      tushare: { name: t('sourceTushareName'), desc: t('sourceTushareDesc') },
      sina: { name: t('sourceSinaName'), desc: t('sourceSinaDesc') },
      tencent: { name: t('sourceTencentName'), desc: t('sourceTencentDesc') },
      tradingview: { name: t('sourceTradingviewName'), desc: t('sourceTradingviewDesc') },
    }

    const defaultOrder = ['local', 'tdx', 'eastmoneyDirect', 'akshare', 'yfinance', 'wind', 'tushare', 'sina', 'tencent', 'tradingview']
    const items: SourceConfig[] = defaultOrder.map((id, i) => {
      const src = sources.find((s) => s.source === id)
      const info = sourceInfo[id] ?? { name: id, desc: '' }
      return {
        id,
        name: info.name,
        description: info.desc,
        enabled: true,
        priority: i,
        status: src?.status ?? 'unknown',
        interval: src?.minInterval ?? 0,
        errors: src?.errorCount ?? 0,
        lastCall: src?.lastCall ?? 0,
      }
    })
    setConfigs(items)
  }, [sources, t])

  const testSource = async (id: string) => {
    setTesting(id)
    setTestResult((prev) => ({ ...prev, [id]: t('testingShort') }))
    try {
      let url = ''
      if (id === 'akshare') url = 'http://127.0.0.1:19800/health'
      else if (id === 'yfinance') url = 'http://127.0.0.1:19800/yfinance_search?q=info'
      else if (id === 'tdx') url = 'http://127.0.0.1:19801/health'
      else if (id === 'local' || id === 'eastmoneyDirect' || id === 'sina' || id === 'tencent' || id === 'tradingview') {
        setTestResult((prev) => ({ ...prev, [id]: 'OK' }))
        setTesting(null)
        return
      }
      else { setTestResult((prev) => ({ ...prev, [id]: t('testNotAvailable') })); setTesting(null); return }

      const start = Date.now()
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const ms = Date.now() - start
      if (res.ok) {
        setTestResult((prev) => ({ ...prev, [id]: `OK (${ms}ms)` }))
      } else {
        setTestResult((prev) => ({ ...prev, [id]: `HTTP ${res.status}` }))
      }
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [id]: `${t('failedPrefix')}: ${e instanceof Error ? e.message : 'timeout'}` }))
    }
    setTesting(null)
  }

  const color = (s: string) => s === 'online' ? 'bg-green-500' : s === 'degraded' ? 'bg-yellow-500' : s === 'offline' ? 'bg-red-500' : 'bg-gray-400'
  const badge = (s: string) => s === 'online' ? 'bg-green-100 text-green-700' : s === 'degraded' ? 'bg-yellow-100 text-yellow-700' : s === 'offline' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
  const statusLabel = (s: string) => s === 'online' ? t('sourceStatusOnline') : s === 'degraded' ? t('sourceStatusDegraded') : s === 'offline' ? t('sourceStatusOffline') : t('sourceStatusUnknown')

  return (
    <div className="space-y-2">
      <div className="text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
        {t('sourcePriorityHint')}
      </div>
      {configs.map((s, i) => (
        <div key={s.id} className="p-3 rounded border text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)', opacity: s.enabled ? 1 : 0.5 }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono w-4 text-center" style={{ color: 'var(--text-tertiary)' }}>#{i + 1}</span>
            <span className={`w-2 h-2 rounded-full ${color(s.status)}`} />
            <span className="font-medium">{s.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge(s.status)}`}>{statusLabel(s.status)}</span>
            <span className="flex-1" />
            {s.errors > 0 && <span className="text-red-500 text-[10px]">{s.errors} {t('errorsLabel')}</span>}
            {s.interval > 0 && <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{(s.interval / 1000).toFixed(1)}s</span>}
          </div>
          <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>{s.description}</div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => testSource(s.id)} disabled={testing === s.id}
              className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">{testing === s.id ? t('testingShort') : t('test')}</button>
            {testResult[s.id] && (
              <span className={`text-[10px] ${testResult[s.id].startsWith('OK') ? 'text-green-600' : 'text-red-500'}`}>
                {testResult[s.id]}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
