import { useEffect, useMemo, useState } from 'react'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { ipc } from '../panels/DataPanelUtils'
import { t, useT } from '../store/useLanguageStore'
import {
  buildDataHealthQueueDisplayText,
  buildFailureEvidenceText,
  buildProviderEvidenceText,
  type DataFailureEvidenceDisplayRow,
  type DataProviderEvidenceDisplayRow,
} from './data-widget-model'

interface SourceSummary {
  total: number
  success: number
  failRate: number
  avgLatency: number
}

interface ApiStatsData {
  summary: Record<string, SourceSummary>
  rangeSummaries?: Record<string, Record<string, SourceSummary>>
  circuitBreaker: Record<string, { state: string; failures: number }>
  recent: ApiCallRow[]
  memorySummary?: Record<string, SourceSummary>
}

interface ApiHealthData {
  summary: {
    providerGapRows?: number
    credentialActivationRows?: number
    credentialValidatedRows?: number
    policyDisabledRows?: number
    liveStatusRows?: number
    liveStatusPassed?: number
    liveStatusFailedOrBlocked?: number
    liveProbeBacklogRows?: number
    evidenceGeneratedAt?: string | null
  }
  providerGapQueue?: ApiHealthQueueRow[]
  credentialActivationQueue?: ApiHealthQueueRow[]
  credentialValidatedQueue?: ApiHealthQueueRow[]
  policyDisabledQueue?: ApiHealthQueueRow[]
  failureActionQueue?: ApiHealthFailureRow[]
}

interface RuntimeProbeStatus {
  recommendedTargets?: RuntimeProbeTarget[]
  blockedTargets?: RuntimeProbeTarget[]
  providerProbePacks?: Array<{ provider: string; probeIds?: string[]; boundedProbeIds?: string[] }>
}

export interface RuntimeProbeTarget {
  probeId?: string
  interfaceId?: string
  provider?: string
  capabilityId?: string
  currentStatus?: string
  reason?: string
  expectedExitCondition?: string
  nextAction?: string
  retryPolicy?: string
  normalWorkflowAllowedBeforeSuccess?: boolean
}

export interface ApiHealthQueueRow extends DataProviderEvidenceDisplayRow {
  id?: string
  interfaceId: string
  provider: string
  status?: string | null
  gapClass?: string | null
  activationState?: string | null
  activationLabel?: string | null
  actionPriority?: number | null
  nextAction?: string | null
  cacheDecision?: string | null
  reason?: string | null
}

export interface ApiHealthFailureRow extends DataFailureEvidenceDisplayRow {
  id?: string
  provider?: string | null
  family?: string | null
  probeId?: string | null
  status?: string | null
  validationState?: string | null
  failureClass?: string | null
  nextAction?: string | null
  cacheDecision?: string | null
  error?: string | null
}

export interface ApiCallRow {
  source: string
  tool?: string
  action?: string
  url?: string
  endpoint?: string
  status?: number
  durationMs?: number
  duration_ms?: number
  success: boolean | number
  error?: string
  timestamp?: string
  created_at?: string
}

export interface RecentGroup {
  key: string
  source: string
  endpoint: string
  count: number
  successCount: number
  failureCount: number
  avgLatency: number
  p95Latency: number
  lastStatus?: number
  lastError?: string
  lastAt?: string
  calls: ApiCallRow[]
}

const RANGES = [
  { key: '5m', label: '5m', minutes: 5 },
  { key: '30m', label: '30m', minutes: 30 },
  { key: '1h', label: '1h', minutes: 60 },
  { key: '24h', label: '24h', minutes: 24 * 60 },
  { key: '7d', label: '7d', minutes: 7 * 24 * 60 },
]

type Tab = 'sources' | 'endpoints' | 'requests'
const API_HEALTH_POLL_INTERVAL_MS = sidebarPanelContract('api-health').pollIntervalMs ?? 10000

export default function ApiHealthPanel() {
  const tr = useT()
  const [stats, setStats] = useState<ApiStatsData | null>(null)
  const [health, setHealth] = useState<ApiHealthData | null>(null)
  const [probeStatus, setProbeStatus] = useState<RuntimeProbeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('30m')
  const [tab, setTab] = useState<Tab>('endpoints')

  const load = () => {
    Promise.all([
      window.agent?.getApiStats(),
      ipc('data:interface-health'),
      ipc('data:probe-status'),
    ])
      .then(([s, h, p]: any[]) => {
        setStats(s)
        setHealth(h)
        setProbeStatus(p?.status ?? p ?? null)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, API_HEALTH_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const selectedRange = RANGES.find((r) => r.key === range) ?? RANGES[1]
  const recentRows = useMemo(() => filterRecent(stats?.recent ?? [], selectedRange.minutes), [stats, selectedRange.minutes])
  const sourceSummary = stats?.rangeSummaries?.[range] ?? stats?.summary ?? {}
  const sources = Object.entries(sourceSummary)
  const endpointGroups = useMemo(() => groupRecentCalls(recentRows), [recentRows])
  const failingEndpointCount = endpointGroups.filter((g) => g.failureCount > 0).length
  const healthFocus = useMemo(() => buildApiHealthFocus(health), [health])
  const runtimeProbeFocus = useMemo(() => buildRuntimeProbeFocus(probeStatus), [probeStatus])

  if (!stats) {
    return (
      <div className="p-4 text-xs theme-text-tertiary">
        {error ? `${tr('errorPrefix')}: ${error}` : tr('loadingApiStats')}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full theme-bg theme-text-secondary overflow-y-auto">
      <div className="px-3 py-2 border-b theme-border">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs theme-text-tertiary font-medium uppercase tracking-wider">{tr('apiHealth')}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] theme-text-tertiary">{failingEndpointCount} {failingEndpointCount === 1 ? tr('failingEndpoint') : tr('failingEndpoints')}</span>
            <button
              type="button"
              onClick={load}
              className="h-7 px-2 rounded border theme-border theme-bg-secondary text-[10px] theme-text-tertiary hover:theme-accent hover:theme-bg-tertiary normal-case tracking-normal"
            >
              {tr('refresh')}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-1 text-[10px] theme-red break-words" title={error}>
            {tr('errorPrefix')}: {error}
          </div>
        )}
        <div className="flex items-center gap-1 mt-2 overflow-x-auto">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2 py-1 rounded text-[10px] shrink-0 ${range === r.key ? 'theme-bg-secondary theme-text' : 'theme-text-tertiary hover:theme-bg-secondary'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {health && <GovernanceSummary health={health} focus={healthFocus} runtimeProbeFocus={runtimeProbeFocus} />}
      </div>

      <div className="grid grid-cols-3 border-b theme-border text-[10px]">
        <TabButton label={tr('bySource')} active={tab === 'sources'} onClick={() => setTab('sources')} />
        <TabButton label={tr('byEndpoint')} active={tab === 'endpoints'} onClick={() => setTab('endpoints')} />
        <TabButton label={tr('requests')} active={tab === 'requests'} onClick={() => setTab('requests')} />
      </div>

      {tab === 'sources' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 p-3">
          {sources.map(([name, s]) => (
            <SourceCard key={name} name={name} summary={s} circuitBreaker={stats.circuitBreaker[name]} />
          ))}
          {sources.length === 0 && <EmptyState text={`${tr('noApiCallsInRange')} ${selectedRange.label}`} />}
        </div>
      )}

      {tab === 'endpoints' && (
        <div className="px-3 py-3 space-y-1 text-[10px]">
          {endpointGroups.slice(0, 40).map((g) => <EndpointGroupCard key={g.key} group={g} />)}
          {endpointGroups.length === 0 && <EmptyState text={`${tr('noRecentApiCallsInRange')} ${selectedRange.label}`} />}
        </div>
      )}

      {tab === 'requests' && (
        <div className="px-3 py-3 space-y-1 text-[10px]">
          {recentRows.slice(0, 120).map((row, i) => <RequestRow key={`${getTime(row)}-${i}`} row={row} />)}
          {recentRows.length === 0 && <EmptyState text={`${tr('noRequestsInRange')} ${selectedRange.label}`} />}
        </div>
      )}
    </div>
  )
}

function GovernanceSummary({ health, focus, runtimeProbeFocus }: { health: ApiHealthData; focus: ApiHealthFocus; runtimeProbeFocus: RuntimeProbeFocus }) {
  return (
    <div className="mt-2 rounded border theme-border p-1.5 text-[10px]">
      <div className="mb-1 flex items-center gap-1 theme-text-tertiary">
        <span>{t('credentialActivationQueue')}</span>
        <HelpBadge text={t('credentialActionQueueHelp')} />
      </div>
      <div className="grid grid-cols-4 gap-1">
        <Metric label={t('liveProbesLabel')} value={`${health.summary.liveStatusPassed ?? 0}/${health.summary.liveStatusRows ?? 0}`} good={(health.summary.liveStatusFailedOrBlocked ?? 0) === 0} bad={(health.summary.liveStatusFailedOrBlocked ?? 0) > 0} />
        <Metric label={t('providerGapQueue')} value={String(health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0)} warn={(health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0) > 0} />
        <Metric label={t('credentialActivationQueue')} value={String(health.summary.credentialActivationRows ?? health.credentialActivationQueue?.length ?? 0)} />
        <Metric label={t('credentialValidated')} value={String(health.summary.credentialValidatedRows ?? 0)} good />
        <Metric label={t('policyDisabledQueue')} value={String(health.summary.policyDisabledRows ?? health.policyDisabledQueue?.length ?? 0)} />
        <Metric label={t('runtimeProbeTargets')} value={`${runtimeProbeFocus.recommendedCount}/${runtimeProbeFocus.blockedCount}`} warn={runtimeProbeFocus.recommendedCount > 0} bad={runtimeProbeFocus.blockedCount > 0} />
      </div>
      <div className="mt-1 theme-text-tertiary font-mono break-words whitespace-normal">
        {t('evidenceGeneratedAt')}: {health.summary.evidenceGeneratedAt ?? '-'} · {t('backlogLabel')}: {health.summary.liveProbeBacklogRows ?? 0}
      </div>
      {focus.rows.length > 0 && (
        <div className="mt-1 space-y-1">
          {focus.rows.map((row) => (
            <div key={row.key} className="theme-text-tertiary break-words whitespace-normal rounded px-1.5 py-1 theme-bg-secondary">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                <span className={`font-mono ${row.tone === 'bad' ? 'theme-red' : row.tone === 'good' ? 'theme-green' : 'theme-text-secondary'}`}>{row.label}</span>
                <span>·</span>
                <span className="font-mono break-all">{row.interfaceId}</span>
                <span>/</span>
                <span className="font-mono">{row.provider}</span>
              </div>
              <HealthDetailLine label={t('nextAction')} value={row.nextAction} />
              <HealthDetailLine label={t('cacheDecisionLabel')} value={row.cacheDecision} />
              <HealthDetailLine label={t('presenceReasonLabel')} value={row.presenceReason} />
              <HealthDetailLine label={t('exitConditionLabel')} value={row.exitCondition} />
              <HealthDetailLine label={t('retryPolicyLabel')} value={row.retryPolicy} mono />
              <HealthDetailLine label={t('evidenceLabel')} value={row.evidence} mono />
            </div>
          ))}
        </div>
      )}
      {runtimeProbeFocus.rows.length > 0 && (
        <div className="mt-1 space-y-1">
          {runtimeProbeFocus.rows.map((row) => (
            <div key={row.key} className="theme-text-tertiary break-words whitespace-normal rounded px-1.5 py-1 theme-bg-secondary">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                <span className={`font-mono ${row.tone === 'bad' ? 'theme-red' : 'text-[#ffc107]'}`}>{row.label}</span>
                <span>·</span>
                <span className="font-mono break-all">{row.interfaceId}</span>
                <span>/</span>
                <span className="font-mono">{row.provider}</span>
              </div>
              <HealthDetailLine label={t('nextAction')} value={row.nextAction} />
              <HealthDetailLine label={t('exitConditionLabel')} value={row.exitCondition} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HealthDetailLine({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="mt-0.5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-1 whitespace-normal">
      <span className="theme-text-tertiary">{label}</span>
      <span className={`min-w-0 break-words ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`py-2 border-r theme-border last:border-r-0 ${active ? 'theme-text theme-bg-secondary' : 'theme-text-tertiary hover:theme-bg-secondary'}`}
    >
      {label}
    </button>
  )
}

function SourceCard({ name, summary, circuitBreaker }: { name: string; summary: SourceSummary; circuitBreaker?: { state: string; failures: number } }) {
  const okRate = summary.total > 0 ? summary.success / summary.total * 100 : 100
  const failCount = summary.total - summary.success
  const stateColor = circuitBreaker?.state === 'open' ? 'bg-[#ef5350]' : circuitBreaker?.state === 'half-open' ? 'bg-[#ffc107]' : 'bg-[#26a69a]'
  const rateColor = okRate >= 90 ? 'bg-[#26a69a]' : okRate >= 70 ? 'bg-[#ffc107]' : 'bg-[#ef5350]'
  return (
    <div className="theme-bg-secondary border theme-border rounded p-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${stateColor}`} />
        <span className="text-xs theme-text font-medium">{name}</span>
        <span className="ml-auto text-[10px] theme-text-tertiary">{summary.total} {t('calls')}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded overflow-hidden theme-bg">
          <div className={`h-full ${rateColor}`} style={{ width: `${Math.max(0, Math.min(100, okRate))}%` }} />
        </div>
        <span className={okRate >= 90 ? 'theme-green text-[10px]' : okRate >= 70 ? 'text-[#ffc107] text-[10px]' : 'theme-red text-[10px]'}>
          {okRate.toFixed(1)}% OK
        </span>
      </div>
      <div className="grid grid-cols-4 gap-x-2 mt-2 text-[10px]">
        <Metric label={t('avgShort')} value={`${summary.avgLatency}ms`} warn={summary.avgLatency > 3000} />
        <Metric label="OK" value={String(summary.success)} good />
        <Metric label={t('failShort')} value={String(failCount)} bad={failCount > 0} />
        <Metric label="CB" value={circuitBreaker?.state ?? t('closed')} bad={circuitBreaker?.state === 'open'} warn={circuitBreaker?.state === 'half-open'} />
      </div>
    </div>
  )
}

function EndpointGroupCard({ group }: { group: RecentGroup }) {
  const hasFailures = group.failureCount > 0
  const okRate = group.count > 0 ? group.successCount / group.count * 100 : 100
  return (
    <details className="theme-bg-secondary border theme-border rounded p-2">
      <summary className="flex items-center gap-2 min-w-0 cursor-pointer list-none">
        <span className="w-14 shrink-0 font-mono theme-text">{group.source}</span>
        <span className={`w-10 shrink-0 text-center rounded font-mono ${hasFailures ? 'theme-red' : 'theme-green'}`}>
          {hasFailures ? 'ERR' : String(group.lastStatus ?? 'OK')}
        </span>
        <span className="w-12 shrink-0 text-right font-mono theme-text-tertiary">x{group.count}</span>
        <span className="w-14 shrink-0 text-right font-mono theme-text-tertiary">{group.avgLatency}ms</span>
        <span className="w-14 shrink-0 text-right font-mono theme-text-tertiary">P95 {group.p95Latency}ms</span>
        <span className="min-w-0 flex-1 break-all font-mono theme-text-secondary">{shortEndpoint(group.endpoint)}</span>
        <span className={okRate >= 90 ? 'theme-green shrink-0' : okRate >= 70 ? 'text-[#ffc107] shrink-0' : 'theme-red shrink-0'}>{okRate.toFixed(0)}%</span>
      </summary>
      <div className="mt-2 pl-[4.5rem] space-y-1">
        {group.lastError && <div className="theme-red font-mono break-words">{friendlyError(group.lastError)}</div>}
        <div className="grid grid-cols-4 gap-2 theme-text-tertiary">
          <span>OK {group.successCount}</span>
          <span>{t('failShort')} {group.failureCount}</span>
          <span>{t('lastShort')} {formatTime(group.lastAt)}</span>
          <span>{t('status')} {group.lastStatus ?? 'ERR'}</span>
        </div>
        {group.calls.slice(0, 5).map((row, i) => <RequestDetail key={`${getTime(row)}-${i}`} row={row} />)}
      </div>
    </details>
  )
}

function RequestRow({ row }: { row: ApiCallRow }) {
  const success = isSuccess(row)
  return (
    <details className="theme-bg-secondary border theme-border rounded p-2">
      <summary className="flex items-center gap-2 min-w-0 cursor-pointer list-none">
        <span className="w-16 shrink-0 font-mono theme-text-tertiary">{formatTime(row.timestamp ?? row.created_at)}</span>
        <span className="w-14 shrink-0 font-mono theme-text">{row.source}</span>
        <span className={`w-10 shrink-0 text-center rounded font-mono ${success ? 'theme-green' : 'theme-red'}`}>{row.status || (success ? 'OK' : 'ERR')}</span>
        <span className="w-14 shrink-0 text-right font-mono theme-text-tertiary">{durationOf(row)}ms</span>
        <span className="min-w-0 flex-1 break-all font-mono theme-text-secondary">{shortEndpoint(row.url ?? row.endpoint ?? '')}</span>
      </summary>
      <div className="mt-2 pl-[4.5rem]">
        <RequestDetail row={row} />
      </div>
    </details>
  )
}

function RequestDetail({ row }: { row: ApiCallRow }) {
  return (
    <div className="font-mono theme-text-tertiary space-y-0.5">
      <DetailLine label={t('endpoint')} value={row.url ?? row.endpoint ?? '-'} />
      <DetailLine label={t('tool')} value={[row.tool, row.action].filter(Boolean).join(' / ') || '-'} />
      <DetailLine label={t('status')} value={String(row.status ?? (isSuccess(row) ? 'OK' : 'ERR'))} />
      <DetailLine label={t('duration')} value={`${durationOf(row)}ms`} />
      {row.error && <DetailLine label={t('error')} value={friendlyError(row.error)} error />}
    </div>
  )
}

export interface ApiHealthFocus {
  rows: Array<{
    key: string
    label: string
    tone: 'neutral' | 'good' | 'bad'
    interfaceId: string
    provider: string
    evidence: string
    presenceReason: string
    cacheDecision: string
    exitCondition: string
    retryPolicy: string
    nextAction: string
  }>
}

export interface RuntimeProbeFocus {
  recommendedCount: number
  blockedCount: number
  rows: Array<{
    key: string
    label: string
    tone: 'warn' | 'bad'
    interfaceId: string
    provider: string
    nextAction: string
    exitCondition: string
  }>
}

export function buildRuntimeProbeFocus(status: RuntimeProbeStatus | null): RuntimeProbeFocus {
  const recommended = status?.recommendedTargets ?? []
  const blocked = status?.blockedTargets ?? []
  return {
    recommendedCount: recommended.length,
    blockedCount: blocked.length,
    rows: [
      ...recommended.slice(0, 2).map((target) => runtimeProbeFocusRow(target, 'recommended probe', 'warn' as const)),
      ...blocked.slice(0, 2).map((target) => runtimeProbeFocusRow(target, 'blocked route', 'bad' as const)),
    ].slice(0, 4),
  }
}

function runtimeProbeFocusRow(target: RuntimeProbeTarget, label: string, tone: 'warn' | 'bad') {
  return {
    key: `${label}:${target.probeId ?? target.interfaceId ?? target.provider ?? 'target'}`,
    label,
    tone,
    interfaceId: target.interfaceId ?? '-',
    provider: target.provider ?? '-',
    nextAction: target.nextAction ?? target.reason ?? 'Inspect runtime_probe status, then run only the bounded registered probe.',
    exitCondition: target.expectedExitCondition ?? 'Leaves this state after bounded probe evidence changes provider readiness.',
  }
}

export function buildApiHealthFocus(health: ApiHealthData | null): ApiHealthFocus {
  if (!health) return { rows: [] }
  const failures = [...(health.failureActionQueue ?? [])]
    .sort((a, b) => failureRank(a.validationState) - failureRank(b.validationState) || String(a.provider ?? '').localeCompare(String(b.provider ?? '')))
    .slice(0, 2)
    .map((row, index) => failureFocusRow(row, index))
  const gaps = [...(health.providerGapQueue ?? [])]
    .sort(apiHealthQueueSort)
    .slice(0, 2)
    .map((row) => queueFocusRow(row, row.gapClass ?? row.status ?? 'gap', 'neutral' as const))
  const activations = [...(health.credentialActivationQueue ?? [])]
    .sort(apiHealthQueueSort)
    .slice(0, 2)
    .map((row) => queueFocusRow(row, row.activationLabel ?? row.liveStatus ?? row.status ?? 'credential', 'good' as const))
  const validated = [...(health.credentialValidatedQueue ?? [])]
    .sort(apiHealthQueueSort)
    .slice(0, 2)
    .map((row) => queueFocusRow(row, row.activationLabel ?? row.liveStatus ?? row.status ?? 'credential validated', 'good' as const, 'credentialValidated'))
  const disabled = [...(health.policyDisabledQueue ?? [])]
    .sort(apiHealthQueueSort)
    .slice(0, 1)
    .map((row) => queueFocusRow(row, row.gapClass ?? row.status ?? 'disabled', 'neutral' as const))
  return { rows: [...failures, ...gaps, ...activations, ...validated, ...disabled].slice(0, 6) }
}

function apiHealthQueueSort(a: ApiHealthQueueRow, b: ApiHealthQueueRow): number {
  return (a.actionPriority ?? 9) - (b.actionPriority ?? 9)
    || a.interfaceId.localeCompare(b.interfaceId)
    || a.provider.localeCompare(b.provider)
}

function queueFocusRow(
  row: ApiHealthQueueRow,
  label: string,
  tone: 'neutral' | 'good' | 'bad',
  kind?: 'gap' | 'credential' | 'credentialValidated' | 'disabled',
) {
  const display = buildDataHealthQueueDisplayText(
    row,
    kind ?? (tone === 'good' ? 'credential' : label.includes('disabled') || row.status === 'disabled' ? 'disabled' : 'gap'),
  )
  return {
    key: row.id ?? `${row.interfaceId}:${row.provider}:${label}`,
    label: display.label || label,
    tone,
    interfaceId: row.interfaceId,
    provider: row.provider,
    evidence: buildProviderEvidenceText(row),
    presenceReason: display.presenceReason,
    cacheDecision: display.cacheDecision,
    exitCondition: display.exitCondition,
    retryPolicy: display.retryPolicy,
    nextAction: display.nextAction,
  }
}

function failureFocusRow(row: ApiHealthFailureRow, index: number) {
  const display = buildDataHealthQueueDisplayText({
    ...row,
    interfaceId: (row.affectedInterfaces ?? [])[0] ?? row.family ?? '-',
    provider: row.provider ?? '-',
  }, 'failure')
  return {
    key: row.id ?? `failure:${row.provider ?? 'unknown'}:${row.probeId ?? row.family ?? index}`,
    label: display.label,
    tone: 'bad' as const,
    interfaceId: (row.affectedInterfaces ?? [])[0] ?? row.family ?? '-',
    provider: row.provider ?? '-',
    evidence: buildFailureEvidenceText(row),
    presenceReason: display.presenceReason,
    cacheDecision: display.cacheDecision,
    exitCondition: display.exitCondition,
    retryPolicy: display.retryPolicy,
    nextAction: display.nextAction,
  }
}

function HelpBadge({ text }: { text: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-mono theme-text-tertiary"
      title={text}
    >
      i
    </span>
  )
}

function failureRank(validationState?: string | null): number {
  if (validationState === 'runtime-blocked') return 0
  if (validationState === 'transport-or-provider-unstable') return 1
  return 2
}

function DetailLine({ label, value, error = false }: { label: string; value: string; error?: boolean }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-16 shrink-0 theme-text-tertiary">{label}</span>
      <span className={`min-w-0 break-words ${error ? 'theme-red' : 'theme-text-secondary'}`} title={value}>{value}</span>
    </div>
  )
}

function Metric({ label, value, warn = false, bad = false, good = false }: { label: string; value: string; warn?: boolean; bad?: boolean; good?: boolean }) {
  return (
    <div>
      <div className="theme-text-tertiary">{label}</div>
      <div className={bad ? 'theme-red' : warn ? 'text-[#ffc107]' : good ? 'theme-green' : 'theme-text-secondary'}>{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-4 text-xs theme-text-tertiary text-center">{text}</div>
}

export function filterRecent(rows: ApiCallRow[], minutes: number): ApiCallRow[] {
  const cutoff = Date.now() - minutes * 60_000
  return rows.filter((row) => getTime(row) >= cutoff)
}

export function groupRecentCalls(rows: ApiCallRow[]): RecentGroup[] {
  const groups = new Map<string, RecentGroup & { latencies: number[] }>()
  for (const row of rows) {
    const source = row.source || 'unknown'
    const endpoint = row.url ?? row.endpoint ?? ''
    const key = `${source}|${endpoint}`
    const duration = durationOf(row)
    const success = isSuccess(row)
    const current = groups.get(key) ?? {
      key,
      source,
      endpoint,
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgLatency: 0,
      p95Latency: 0,
      calls: [],
      latencies: [],
    }
    current.count += 1
    current.successCount += success ? 1 : 0
    current.failureCount += success ? 0 : 1
    current.latencies.push(duration)
    current.calls.push(row)
    current.avgLatency = Math.round(current.latencies.reduce((sum, value) => sum + value, 0) / current.latencies.length)
    current.p95Latency = percentile(current.latencies, 0.95)
    if (!current.lastAt || getTime(row) >= new Date(current.lastAt).getTime()) {
      current.lastAt = row.timestamp ?? row.created_at
      current.lastStatus = row.status
      current.lastError = row.error
    }
    groups.set(key, current)
  }

  return Array.from(groups.values())
    .map(({ latencies: _latencies, calls, ...group }) => ({ ...group, calls: calls.sort((a, b) => getTime(b) - getTime(a)) }))
    .sort((a, b) => {
      const byFailure = Number(b.failureCount > 0) - Number(a.failureCount > 0)
      if (byFailure !== 0) return byFailure
      const byTime = new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime()
      if (byTime !== 0) return byTime
      return b.count - a.count
    })
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return Math.round(sorted[index] ?? 0)
}

function isSuccess(row: ApiCallRow): boolean {
  return row.success === true || row.success === 1
}

function durationOf(row: ApiCallRow): number {
  const duration = Number(row.durationMs ?? row.duration_ms ?? 0)
  return Number.isFinite(duration) ? Math.round(duration) : 0
}

function getTime(row: ApiCallRow): number {
  return new Date(row.timestamp ?? row.created_at ?? 0).getTime()
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function shortEndpoint(endpoint: string): string {
  return endpoint.replace(/https?:\/\/[^/]+/, '') || '-'
}

function friendlyError(error: string): string {
  if (/code mismatch|contract|wrong instrument|invalid TDX|tdx:[^;]*(invalid|mismatch)|response did not match/i.test(error)) {
    return t('providerContractMismatch')
  }
  if (/proxy|RemoteDisconnected|HTTPSConnectionPool|Max retries/i.test(error)) {
    return t('networkBlocked')
  }
  if (/timeout|aborted/i.test(error)) return t('requestTimedOut')
  if (/fetch failed/i.test(error)) return t('fetchFailedText')
  return error
}
