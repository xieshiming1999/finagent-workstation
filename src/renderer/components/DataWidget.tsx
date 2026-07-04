import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtN, ipc } from '../panels/DataPanelUtils'
import { sidebarPanelContract } from '../panels/sidebar-panel-contract'
import { useT } from '../store/useLanguageStore'
import { usePanelStore } from '../store/usePanelStore'
import {
  buildDataWidgetSummary,
  buildDataHealthQueueDisplayText,
  buildDataHealthQueueTitle,
  buildFailureEvidenceText,
  buildInterfaceProvenanceText,
  buildProviderEvidenceText,
  classifyDataTaskFailure,
  dataSurfaceContractSteps,
  type DataFailureEvidenceDisplayRow,
  type DataSurfaceContractStepId,
  type DataStats,
  type FeedConfig,
  type FetchTask,
  type SourceStatus,
} from './data-widget-model'
import { buildGoalAutomationDisplay, type GoalTriggerLedgerEntry } from './goal-automation-view-model'

const DATA_WIDGET_POLL_INTERVAL_MS = sidebarPanelContract('data').pollIntervalMs ?? 5000

interface GoalAutomationItem {
  template: { id: string; title: string; objective: string }
  activeGoal?: {
    status: string
    turnsUsed: number
    maxTurns: number
    workPacket?: {
      currentGap: string
      nextPrompt: string
      progressKind?: string | null
      progressSummary?: string | null
      verification?: string | null
    } | null
  } | null
  state: {
    enabled: boolean
    paused: boolean
    lastRunAt: number | null
    nextRunAt: number | null
    lastTrigger: string | null
    lastTriggerEvidence: string | null
    lastCheckpoint: string | null
    lastError: string | null
    lastResult: string | null
    escalationNeeded: boolean
    failureCount: number
    triggerLedger?: GoalTriggerLedgerEntry[]
  }
}

interface GoalAutomationSuggestion {
  id: string
  title: string
  description: string
  templateId: string
  source: string
  status: string
}

interface DoctorCheck {
  id: string
  status: 'ok' | 'warning' | 'critical'
  detail: string
  nextStep?: string
  metrics?: Record<string, string | number | boolean | null>
}

interface DoctorReport {
  status: 'ok' | 'warning' | 'critical'
  generatedAt: string
  summary: string
  checks: DoctorCheck[]
}

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
    recentFailures: number
    liveProbeCount?: number
    livePassed?: number
    liveFailures?: number
    lastFailure: string | null
    lastFailureClass?: string | null
    nextAction?: string
    health: 'ready' | 'attention' | 'gap'
  }>
  providerGapQueue?: Array<{
    id?: string
    interfaceId: string
    category?: string
    chinesePurpose?: string
    provider: string
    status: string
    capabilityId?: string | null
    adapter?: string | null
    normalizer?: string | null
    canonicalTable?: string | null
    probeId?: string | null
    liveStatus?: string | null
    liveValidationState?: string | null
    liveFailureClass?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    nextAction?: string | null
    reason?: string | null
  }>
  credentialActivationQueue?: Array<{
    id?: string
    interfaceId: string
    provider: string
    status: string
    capabilityId?: string | null
    adapter?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    probeId?: string | null
    liveStatus?: string | null
    liveValidationState?: string | null
    liveFailureClass?: string | null
    activationState?: string | null
    activationLabel?: string | null
    normalizer?: string | null
    canonicalTable?: string | null
    nextAction?: string | null
    reason?: string | null
  }>
  policyDisabledQueue?: Array<{
    id?: string
    interfaceId: string
    provider: string
    status: string
    capabilityId?: string | null
    probeId?: string | null
    gapClass?: string | null
    actionPriority?: number | null
    nextAction?: string | null
    reason?: string | null
  }>
  failureActionQueue?: Array<DataFailureEvidenceDisplayRow & {
    id?: string
    provider?: string | null
    family?: string | null
    status?: string | null
    validationState?: string | null
    failureClass?: string | null
    affectedRows?: string[]
    reason?: string | null
    recoveryPolicy?: string | null
    retryPolicy?: string | null
    nextAction?: string | null
    error?: string | null
  }>
  rows: Array<{
    interfaceId: string
    label: string
    canonicalSchema?: string | null
    canonicalTable?: string | null
    cacheStatus: string
    cachePolicy?: string | null
    readbackAction?: string | null
    readbackActions?: string[] | null
    supportedProviders: string[]
    localRows: number
    latest: string | null
    latestSourceTime: string | null
    sources: string | null
    recentFailures: number
    liveProbeIds?: string[]
    liveProbeBacklog?: number
    passedLiveRows?: number
    liveFailures?: number
    lastFailure: string | null
    lastFailureClass: string | null
    lastFailureAt?: string | null
    nextAction?: string
    health: 'ready' | 'attention' | 'gap'
    capabilities: Array<{
      provider: string
      capabilityId: string
      status: string
      probeId: string | null
      reason: string | null
      nextAction?: string
    }>
  }>
}

export default function DataWidget() {
  const t = useT()
  const addPanel = usePanelStore((s) => s.addPanel)
  const setActivePanel = usePanelStore((s) => s.setActive)
  const [stats, setStats] = useState<DataStats | null>(null)
  const [tasks, setTasks] = useState<FetchTask[]>([])
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [feeds, setFeeds] = useState<FeedConfig[]>([])
  const [goalLoops, setGoalLoops] = useState<GoalAutomationItem[]>([])
  const [goalSuggestions, setGoalSuggestions] = useState<GoalAutomationSuggestion[]>([])
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [interfaceHealth, setInterfaceHealth] = useState<InterfaceHealth | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextStats, nextTasks, nextSources, nextFeeds, nextDoctor, nextInterfaceHealth, nextGoalLoops, nextGoalSuggestions] = await Promise.all([
        ipc('data:stats'), ipc('data:tasks'), ipc('data:sources'), ipc('data:feeds'), ipc('data:doctor'), ipc('data:interface-health'), window.agent?.getGoalAutomation?.(), window.agent?.getGoalAutomationSuggestions?.(),
      ])
      if (nextStats) setStats(nextStats as DataStats)
      if (Array.isArray(nextTasks)) setTasks(nextTasks as FetchTask[])
      if (Array.isArray(nextSources)) setSources(nextSources as SourceStatus[])
      if ((nextFeeds as any)?.feeds) setFeeds((nextFeeds as any).feeds as FeedConfig[])
      if ((nextDoctor as any)?.checks) setDoctor(nextDoctor as DoctorReport)
      if ((nextInterfaceHealth as any)?.summary) setInterfaceHealth(nextInterfaceHealth as InterfaceHealth)
      if (Array.isArray(nextGoalLoops)) setGoalLoops(nextGoalLoops as GoalAutomationItem[])
      if (Array.isArray(nextGoalSuggestions)) setGoalSuggestions(nextGoalSuggestions as GoalAutomationSuggestion[])
    } catch {
      // Keep the last good snapshot visible.
    }
  }, [])

  useEffect(() => {
    refresh()
    timerRef.current = setInterval(refresh, DATA_WIDGET_POLL_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [refresh])

  const summary = buildDataWidgetSummary({ stats, tasks, sources, feeds })

  const openFullView = () => {
    addPanel({ id: 'data-manager', type: 'data-manager' as any, title: t('dataManager'), closable: true })
    setActivePanel('data-manager')
  }

  const retryTask = async (task: FetchTask) => {
    const result = await ipc('data:fetch', task.task_type, task.code ?? undefined, { source: 'data-widget-retry' }) as any
    setMessage(result?.error ? String(result.error) : `${t('actionQueued')}: ${task.task_type}${task.code ? ` ${task.code}` : ''}`)
    await refresh()
  }

  const runFeed = async (feed: FeedConfig) => {
    const result = await ipc('data:feed-run', feed.feed_id) as any
    setMessage(result?.error ? String(result.error) : `${t('actionQueued')}: ${feed.display_name}`)
    await refresh()
  }

  const runGoalLoop = async (id: string) => {
    const result = await window.agent?.runGoalAutomation?.(id) as any
    setMessage(result?.reason ? String(result.reason) : `${t('goalAutomationQueued')}: ${id}`)
    await refresh()
  }

  const setGoalLoopEnabled = async (id: string, enabled: boolean) => {
    await window.agent?.setGoalAutomationEnabled?.(id, enabled)
    await refresh()
  }

  const pauseGoalLoop = async (id: string, paused: boolean) => {
    await window.agent?.pauseGoalAutomation?.(id, paused)
    await refresh()
  }

  const acceptGoalSuggestion = async (id: string) => {
    const result = await window.agent?.acceptGoalAutomationSuggestion?.(id) as any
    setMessage(result?.error ? String(result.error) : `${t('automationSuggestionAccepted')}: ${id}`)
    await refresh()
  }

  const dismissGoalSuggestion = async (id: string) => {
    const result = await window.agent?.dismissGoalAutomationSuggestion?.(id) as any
    setMessage(result?.error ? String(result.error) : `${t('automationSuggestionDismissed')}: ${id}`)
    await refresh()
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 theme-bg theme-text-secondary">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs theme-text font-medium">{t('dataManagerTitle')}</div>
          <div className="text-[10px] theme-text-tertiary">{fmtN(summary.totalRows)} {t('rowsLabel')} · {summary.sizeMb} MB</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFullView} className="text-[10px] theme-text-tertiary hover:theme-accent px-1">{t('fullView')}</button>
          <button onClick={refresh} className="text-[10px] theme-text-tertiary hover:theme-accent px-1">{t('refresh')}</button>
        </div>
      </div>
      <div className="text-[10px] theme-text-tertiary">{t('dataManagerSummary')}</div>
      {message && <div className="text-[10px] theme-text-tertiary border theme-border rounded px-2 py-1">{message}</div>}

      <Section title={t('dataSurfaceContract')}>
        <div className="space-y-1">
          {dataSurfaceContractSteps.map((step) => (
            <div key={step.id} className="flex gap-2 rounded px-1 py-1 text-[10px] theme-bg-secondary">
              <span className="font-mono theme-text-tertiary shrink-0 leading-4">{step.order}</span>
              <div className="min-w-0">
                <div className="theme-text-secondary leading-4">{surfaceStepTitle(step.id, t)}</div>
                <div className="theme-text-tertiary leading-4">{surfaceStepDetail(step.id, t)}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('dataHealth')}>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <Metric label={t('reusableData')} value={String(summary.reusable.length)} />
          <Metric label={t('dataFeeds')} value={`${summary.enabledFeeds.length}/${feeds.length}`} tone={summary.feedFailures.length > 0 ? 'bad' : 'neutral'} />
          <Metric label={t('queueTitle')} value={String(summary.activeTasks.length)} tone={summary.failedTasks.length > 0 ? 'bad' : 'neutral'} />
          <Metric label={t('sourcesTitle')} value={String(summary.offlineSources)} tone={summary.offlineSources > 0 ? 'bad' : 'good'} />
        </div>
        {interfaceHealth && <InterfaceHealthSummary health={interfaceHealth} />}
        {doctor && <DoctorSummary report={doctor} />}
        {summary.healthState === 'healthy' ? (
          <div className="mt-2 text-[10px] theme-green">{t('dataHealthy')}</div>
        ) : (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] theme-red">{t('recentFailures')}</div>
            {summary.failedTasks.map((task) => <TaskDiagnosis key={task.id} task={task} onRetry={() => retryTask(task)} />)}
            {summary.feedFailures.map((feed) => <FeedFailure key={feed.feed_id} feed={feed} onRun={() => runFeed(feed)} />)}
          </div>
        )}
      </Section>

      <Section title={t('feedStatus')}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
          <div className="theme-text-tertiary">
            Use {t('dataManager')} to manually download or refresh specific feeds.
          </div>
          <button onClick={openFullView} className="theme-text-tertiary hover:theme-accent px-1 shrink-0">{t('dataManager')}</button>
        </div>
        {feeds.length === 0 ? (
          <Empty text={t('datastoreInitializing')} />
        ) : feeds.slice(0, 5).map((feed) => (
          <FeedRow key={feed.feed_id} feed={feed} onRun={() => runFeed(feed)} />
        ))}
      </Section>

      <Section title={t('automationSuggestions')}>
        {goalSuggestions.length === 0 ? (
          <Empty text={t('noAutomationSuggestions')} />
        ) : goalSuggestions.slice(0, 5).map((suggestion) => (
          <GoalSuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            onAccept={() => acceptGoalSuggestion(suggestion.id)}
            onDismiss={() => dismissGoalSuggestion(suggestion.id)}
          />
        ))}
      </Section>

      <Section title={t('goalAutomation')}>
        {goalLoops.length === 0 ? (
          <Empty text={t('goalAutomationUnavailable')} />
        ) : goalLoops.slice(0, 5).map((item) => (
          <GoalLoopRow
            key={item.template.id}
            item={item}
            onRun={() => runGoalLoop(item.template.id)}
            onToggle={() => setGoalLoopEnabled(item.template.id, !item.state.enabled)}
            onPause={() => pauseGoalLoop(item.template.id, !item.state.paused)}
          />
        ))}
      </Section>

      <Section title={t('reusableData')}>
        {summary.reusable.length === 0 ? (
          <Empty text={t('noReusableDataSummary')} />
        ) : summary.reusable.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-2 py-1 text-[10px]">
            <div className="min-w-0">
              <div className="theme-text-secondary font-mono truncate">{row.name}</div>
              <div className="theme-text-tertiary truncate">
                {row.latest ?? '-'}{row.sources ? ` · ${t('provenanceSource')}: ${row.sources}` : ''}
              </div>
            </div>
            <div className="font-mono theme-text-tertiary shrink-0">{fmtN(row.count)}</div>
          </div>
        ))}
      </Section>

      <Section title={t('queueTitle')}>
        {summary.activeTasks.length === 0 && summary.failedTasks.length === 0 ? (
          <Empty text={t('noActiveTasks')} />
        ) : (
          <>
            {summary.activeTasks.map((task) => <TaskRow key={task.id} task={task} />)}
            {summary.failedTasks.map((task) => <TaskRow key={task.id} task={task} compact />)}
          </>
        )}
      </Section>

      <Section title={t('sourcesTitle')}>
        {sources.length === 0 ? (
          <Empty text={t('datastoreInitializing')} />
        ) : sources.slice(0, 8).map((source) => (
          <div key={source.source} className="flex items-center justify-between py-1 text-[10px]">
            <span className="theme-text-secondary truncate">{source.source}</span>
            <span className={`font-mono ${statusColor(source.status)}`}>
              {source.status}{source.errorCount > 0 ? ` · ${source.errorCount}` : ''}
            </span>
          </div>
        ))}
      </Section>
    </div>
  )
}

function InterfaceHealthSummary({ health }: { health: InterfaceHealth }) {
  const t = useT()
  const attentionRows = health.rows
    .filter((row) => row.health !== 'ready' || row.recentFailures > 0)
    .sort((a, b) => b.recentFailures - a.recentFailures || healthRank(a.health) - healthRank(b.health))
    .slice(0, 3)
  const providerRows = health.providerRows
    .filter((row) => row.health !== 'ready' || row.recentFailures > 0 || row.gated > 0 || row.outputOnly > 0 || row.unstable > 0 || row.disabled > 0)
    .sort((a, b) => b.recentFailures - a.recentFailures || healthRank(a.health) - healthRank(b.health) || b.unstable - a.unstable)
    .slice(0, 3)
  const gapRows = [...(health.providerGapQueue ?? [])]
    .sort((a, b) => (a.actionPriority ?? 9) - (b.actionPriority ?? 9) || a.interfaceId.localeCompare(b.interfaceId) || a.provider.localeCompare(b.provider))
    .slice(0, 2)
  const activationRows = [...(health.credentialActivationQueue ?? [])]
    .sort((a, b) => (a.actionPriority ?? 9) - (b.actionPriority ?? 9) || a.interfaceId.localeCompare(b.interfaceId) || a.provider.localeCompare(b.provider))
    .slice(0, 2)
  const policyDisabledRows = [...(health.policyDisabledQueue ?? [])]
    .sort((a, b) => (a.actionPriority ?? 9) - (b.actionPriority ?? 9) || a.interfaceId.localeCompare(b.interfaceId) || a.provider.localeCompare(b.provider))
    .slice(0, 2)
  const failureRows = [...(health.failureActionQueue ?? [])]
    .sort((a, b) => failureRank(a.validationState) - failureRank(b.validationState) || String(a.provider ?? '').localeCompare(String(b.provider ?? '')) || String(a.probeId ?? a.family ?? '').localeCompare(String(b.probeId ?? b.family ?? '')))
    .slice(0, 2)

  return (
    <div className="mt-2 rounded border theme-border p-1.5 text-[10px]">
      <div className="grid grid-cols-4 gap-1">
        <Metric label={t('interfacesLabel')} value={String(health.summary.interfaces)} />
        <Metric label={t('readyLabel')} value={String(health.summary.ready)} tone="good" />
        <Metric label={t('gapsLabel')} value={String(health.summary.gaps)} tone={health.summary.gaps > 0 ? 'bad' : 'good'} />
        <Metric label={t('failuresLabel')} value={String(health.summary.recentFailures)} tone={health.summary.recentFailures > 0 ? 'bad' : 'good'} />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <Metric label={t('liveProbesLabel')} value={`${health.summary.liveStatusPassed ?? 0}/${health.summary.liveStatusRows ?? 0}`} tone={(health.summary.liveStatusFailedOrBlocked ?? 0) > 0 ? 'neutral' : 'good'} />
        <Metric label={t('blockedLabel')} value={String(health.summary.liveStatusFailedOrBlocked ?? 0)} tone={(health.summary.liveStatusFailedOrBlocked ?? 0) > 0 ? 'bad' : 'good'} />
        <Metric label={t('datasetsLabel')} value={String(health.summary.datasets ?? 0)} />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <Metric label={t('providerGapQueue')} value={String(health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0)} tone={(health.summary.providerGapRows ?? health.providerGapQueue?.length ?? 0) > 0 ? 'neutral' : 'good'} />
        <Metric label={t('credentialActivationQueue')} value={String(health.summary.credentialActivationRows ?? health.credentialActivationQueue?.length ?? 0)} />
        <Metric label={t('credentialValidated')} value={String(health.summary.credentialValidatedRows ?? 0)} tone="good" />
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1">
        <Metric label={t('policyDisabledQueue')} value={String(health.summary.policyDisabledRows ?? health.policyDisabledQueue?.length ?? 0)} />
      </div>
      <div className="mt-1 theme-text-tertiary font-mono break-words">
        {t('evidenceGeneratedAt')}: {health.summary.evidenceGeneratedAt ?? '-'} · {t('backlogLabel')}: {health.summary.liveProbeBacklogRows ?? 0}
      </div>
      {attentionRows.length > 0 && (
        <div className="mt-1 space-y-1">
          {attentionRows.map((row) => (
            <div key={row.interfaceId} className="border-t theme-border pt-1 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono theme-text-secondary break-all">{row.interfaceId}</span>
                <span className={`font-mono shrink-0 ${healthColor(row.health)}`}>{healthStatusLabel(row.health, t)}</span>
              </div>
              <div className="theme-text-tertiary break-words">
                {row.supportedProviders.join(', ') || '-'} · {row.cacheStatus} · {row.latestSourceTime ?? '-'} · {liveProbeText(row)}
              </div>
              <div className="theme-text-tertiary break-words">
                {t('latest')}: {formatShortTime(row.latestSourceTime ?? row.latest ?? health.summary.evidenceGeneratedAt ?? '-')}
              </div>
              <div className="theme-text-tertiary break-words">{buildInterfaceProvenanceText(row)}</div>
              {row.recentFailures > 0 && (
                <div className="theme-red break-words">{row.lastFailureClass ?? t('failuresLabel')} · {row.lastFailure ?? '-'}{row.lastFailureAt ? ` · ${formatShortTime(row.lastFailureAt)}` : ''}</div>
              )}
              <div className="theme-text-tertiary break-words">{capabilityGapText(row, t('rowsLabel'))}</div>
              <div className="theme-text-tertiary break-words">{row.nextAction ?? '-'}</div>
            </div>
          ))}
        </div>
      )}
      {providerRows.length > 0 && (
        <div className="mt-1 theme-text-tertiary break-words">
          {t('providerHealth')}: {providerRows.map((row) => `${row.provider} ${row.supported}/${row.gated + row.outputOnly + row.unstable + row.disabled} live ${row.livePassed ?? 0}/${row.liveProbeCount ?? 0}`).join(' · ')}
        </div>
      )}
      {gapRows.length > 0 && (
        <div className="mt-1 space-y-1">
          {gapRows.map((row) => (
            <div key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}`} className="theme-text-tertiary break-words">
              <span className="font-mono theme-text-secondary">{row.actionPriority ?? '-'}</span>
              {' · '}
              <span className="font-mono">{row.gapClass ?? row.status}</span>
              {' · '}
              <span className="font-mono">{row.interfaceId}</span>
              {' / '}
              <span className="font-mono">{row.provider}</span>
              {' · '}
              <span title={buildProviderEvidenceText(row)}>{buildProviderEvidenceText(row)}</span>
              <QueueExplanation row={row} kind="gap" fallback={row.chinesePurpose ?? undefined} />
            </div>
          ))}
        </div>
      )}
      {activationRows.length > 0 && (
        <div className="mt-1 space-y-1">
          {activationRows.map((row) => (
            <div key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}`} className="theme-text-tertiary break-words">
              <span className="font-mono theme-green">{row.liveStatus ?? '-'}</span>
              {' · '}
              <span className="font-mono">{row.interfaceId}</span>
              {' / '}
              <span className="font-mono">{row.provider}</span>
              {' · '}
              <span>{row.activationLabel ?? row.activationState ?? row.status}</span>
              {' · '}
              <span title={buildProviderEvidenceText(row)}>{buildProviderEvidenceText(row)}</span>
              <QueueExplanation row={row} kind="credential" />
            </div>
          ))}
        </div>
      )}
      {policyDisabledRows.length > 0 && (
        <div className="mt-1 space-y-1">
          {policyDisabledRows.map((row) => (
            <div key={row.id ?? `${row.interfaceId}:${row.provider}:${row.status}`} className="theme-text-tertiary break-words">
              <span className="font-mono">{row.gapClass ?? row.status}</span>
              {' · '}
              <span className="font-mono">{row.interfaceId}</span>
              {' / '}
              <span className="font-mono">{row.provider}</span>
              {' · '}
              <span title={buildProviderEvidenceText(row)}>{buildProviderEvidenceText(row)}</span>
              <QueueExplanation row={row} kind="disabled" />
            </div>
          ))}
        </div>
      )}
      {failureRows.length > 0 && (
        <div className="mt-1 space-y-1">
          {failureRows.map((row, index) => (
            <div key={row.id ?? `${row.probeId ?? row.family ?? 'failure'}:${index}`} className="theme-text-tertiary break-words">
              <span className="font-mono theme-red">{row.failureClass ?? row.validationState ?? row.status ?? '-'}</span>
              {' · '}
              <span className="font-mono">{row.provider ?? '-'}</span>
              {' · '}
              <span className="font-mono">{row.probeId ?? row.family ?? '-'}</span>
              {' · '}
              <span title={buildFailureEvidenceText(row)}>{buildFailureEvidenceText(row)}</span>
              <QueueExplanation
                row={{ ...row, interfaceId: row.affectedInterfaces?.[0] ?? row.family ?? undefined }}
                kind="failure"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QueueExplanation({ row, kind, fallback }: { row: Parameters<typeof buildDataHealthQueueDisplayText>[0]; kind: Parameters<typeof buildDataHealthQueueDisplayText>[1]; fallback?: string }) {
  const display = buildDataHealthQueueDisplayText(row, kind)
  const title = buildDataHealthQueueTitle(display)
  return (
    <div className="mt-0.5 space-y-0.5 break-words" title={title}>
      <div>{display.nextAction || fallback || '-'}</div>
      <div className="theme-text-tertiary">{display.cacheDecision}</div>
      <div className="theme-text-tertiary">{display.exitCondition}</div>
      <div className="font-mono theme-text-tertiary">{display.retryPolicy}</div>
    </div>
  )
}

function failureRank(validationState?: string | null): number {
  if (validationState === 'runtime-blocked') return 0
  if (validationState === 'transport-or-provider-unstable') return 1
  return 2
}

function liveProbeText(row: InterfaceHealth['rows'][number]): string {
  const ids = row.liveProbeIds ?? []
  const passed = row.passedLiveRows ?? 0
  const failures = row.liveFailures ?? 0
  const backlog = row.liveProbeBacklog ?? 0
  if (ids.length === 0 && passed === 0 && failures === 0 && backlog === 0) return 'live -'
  return `live ${passed}/${ids.length}${failures > 0 ? ` fail ${failures}` : ''}${backlog > 0 ? ` backlog ${backlog}` : ''}`
}

function healthRank(health: 'ready' | 'attention' | 'gap'): number {
  if (health === 'attention') return 0
  if (health === 'gap') return 1
  return 2
}

function healthColor(health: 'ready' | 'attention' | 'gap'): string {
  if (health === 'ready') return 'theme-green'
  if (health === 'attention') return 'theme-red'
  return 'theme-text-tertiary'
}

function healthStatusLabel(health: 'ready' | 'attention' | 'gap', t: ReturnType<typeof useT>): string {
  if (health === 'ready') return t('readyLabel')
  if (health === 'attention') return t('failuresLabel')
  return t('gapsLabel')
}

function capabilityGapText(row: InterfaceHealth['rows'][number], rowsLabel: string): string {
  const gaps = row.capabilities
    .filter((capability) => capability.status !== 'supported' && capability.status !== 'global-only' && capability.status !== 'not-supported')
    .map((capability) => {
      const probe = capability.probeId ? `/${capability.probeId}` : ''
      const reason = capability.reason ? `: ${capability.reason}` : ''
      const action = capability.nextAction ? ` -> ${capability.nextAction}` : ''
      return `${capability.provider}=${capability.status}${probe}${reason}${action}`
    })
  return gaps.join(' · ') || `${row.localRows} ${rowsLabel} · ${row.sources ?? '-'}`
}

function surfaceStepTitle(id: DataSurfaceContractStepId, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'dataClass': return t('surfaceDataClassTitle')
    case 'cachePolicy': return t('surfaceCachePolicyTitle')
    case 'providerPolicy': return t('surfaceProviderPolicyTitle')
    case 'normalizer': return t('surfaceNormalizerTitle')
    case 'persistTarget': return t('surfacePersistTargetTitle')
    case 'readbackAction': return t('surfaceReadbackActionTitle')
    case 'failureSink': return t('surfaceFailureSinkTitle')
    case 'uiSurface': return t('surfaceUiSurfaceTitle')
  }
}

function surfaceStepDetail(id: DataSurfaceContractStepId, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'dataClass': return t('surfaceDataClassDetail')
    case 'cachePolicy': return t('surfaceCachePolicyDetail')
    case 'providerPolicy': return t('surfaceProviderPolicyDetail')
    case 'normalizer': return t('surfaceNormalizerDetail')
    case 'persistTarget': return t('surfacePersistTargetDetail')
    case 'readbackAction': return t('surfaceReadbackActionDetail')
    case 'failureSink': return t('surfaceFailureSinkDetail')
    case 'uiSurface': return t('surfaceUiSurfaceDetail')
  }
}

function DoctorSummary({ report }: { report: DoctorReport }) {
  const t = useT()
  const visible = report.checks.filter((check) => check.status !== 'ok').slice(0, 4)
  const checks = visible.length > 0 ? visible : report.checks.slice(0, 2)
  return (
    <div className="mt-2 rounded border theme-border p-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="theme-text-secondary">{t('doctorTitle')}</span>
        <span className={`font-mono ${doctorStatusColor(report.status)}`}>{doctorStatusLabel(report.status, t)}</span>
      </div>
      <div className="theme-text-tertiary mt-0.5 truncate">{doctorSummaryText(report, t)}</div>
      <div className="mt-1 space-y-1">
        {checks.map((check) => (
          <div key={check.id} className="border-t theme-border pt-1 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="theme-text-secondary truncate">{doctorCheckLabel(check.id, t)}</span>
              <span className={`font-mono shrink-0 ${doctorStatusColor(check.status)}`}>{doctorStatusLabel(check.status, t)}</span>
            </div>
            <div className="theme-text-tertiary truncate">{doctorCheckDetail(check, t)}</div>
            {check.nextStep && <div className="theme-text-tertiary truncate">{t('nextStep')}: {doctorCheckNextStep(check.id, t)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function GoalLoopRow({ item, onRun, onToggle, onPause }: { item: GoalAutomationItem; onRun: () => void; onToggle: () => void; onPause: () => void }) {
  const t = useT()
  const stateText = item.state.enabled ? (item.state.paused ? t('paused') : t('enabled')) : t('disabled')
  const display = buildGoalAutomationDisplay(item, (value) => new Date(value).toLocaleTimeString())
  const tone = display.state === 'attention' ? 'theme-red' : display.state === 'enabled' ? 'theme-green' : 'theme-text-tertiary'
  const lastRun = item.state.lastRunAt ? new Date(item.state.lastRunAt).toLocaleTimeString() : '-'
  const nextRun = item.state.nextRunAt ? new Date(item.state.nextRunAt).toLocaleTimeString() : '-'
  const cooldown = item.state.nextRunAt && item.state.nextRunAt > Date.now()
    ? formatDuration(item.state.nextRunAt - Date.now())
    : '-'
  const trigger = item.state.lastTrigger ?? '-'
  const checkpoint = item.state.lastCheckpoint ? compactPath(item.state.lastCheckpoint) : '-'
  return (
    <div className="py-1.5 border-b theme-border last:border-b-0 text-[10px]">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="theme-text-secondary truncate">{item.template.title}</div>
          <div className={`font-mono ${tone}`}>
            {stateText}
            {item.state.escalationNeeded ? ` · ${t('escalationNeeded')}` : ''}
            {item.state.failureCount > 0 ? ` · ${item.state.failureCount} ${t('failShort')}` : ''}
          </div>
        </div>
        <button onClick={onRun} className="theme-text-tertiary hover:theme-accent px-1">{t('runNow')}</button>
        <button onClick={onPause} className="theme-text-tertiary hover:theme-accent px-1">
          {item.state.paused ? t('resume') : t('pause')}
        </button>
        <button onClick={onToggle} className="theme-text-tertiary hover:theme-accent px-1">
          {item.state.enabled ? t('disable') : t('enable')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 theme-text-tertiary">
        <div className="truncate">{t('lastRun')}: {lastRun}</div>
        <div className="truncate">{t('nextRun')}: {nextRun}</div>
        <div className="truncate">{t('cooldown')}: {cooldown}</div>
        <div className="truncate">{t('trigger')}: {trigger}</div>
        <div className="truncate">{t('checkpoint')}: {checkpoint}</div>
      </div>
      <div className="theme-text-tertiary truncate mt-1">{t('triggerEvidence')}: {display.evidence}</div>
      <div className="theme-text-tertiary truncate mt-1">{t('recentDecision')}: {display.latestDecisionText}</div>
      {display.activeWorkPacket && (
        <>
          <div className="theme-text-tertiary truncate mt-1">{t('currentWorkGap')}: {display.activeWorkText}</div>
          <div className="theme-text-tertiary truncate mt-1">{t('nextAction')}: {display.activeWorkPacket.nextPrompt}</div>
        </>
      )}
      {display.taskSummary && (
        <details className="mt-1 theme-text-tertiary">
          <summary className="cursor-pointer select-none hover:theme-accent">{t('taskGoalView')}</summary>
          <div className="mt-1 grid grid-cols-1 gap-0.5">
            <div className="truncate">{t('objective')}: {display.taskSummary.objective}</div>
            <div className="truncate">{t('scope')}: {display.taskSummary.scope}</div>
            <div className="truncate">{t('dataRequirements')}: {display.taskSummary.dataRequirements}</div>
            <div className="truncate">{t('riskBoundary')}: {display.taskSummary.riskBoundary}</div>
            <div className="truncate">{t('budget')}: {display.taskSummary.budget}</div>
            <div className="truncate">{t('doneCriteria')}: {display.taskSummary.doneCriteria}</div>
            <div className="truncate">{t('verification')}: {display.taskSummary.verification}</div>
            <div className="truncate">{t('escalation')}: {display.taskSummary.escalation}</div>
            <div className="truncate">{t('evidence')}: {display.taskSummary.evidence}</div>
          </div>
        </details>
      )}
      <details className="mt-1 theme-text-tertiary">
        <summary className="cursor-pointer select-none hover:theme-accent">{t('decisionHistory')} ({display.decisionHistory.length})</summary>
        {display.decisionHistory.length === 0 ? (
          <div className="mt-1">{t('noDecisionHistory')}</div>
        ) : (
          <div className="mt-1 space-y-1">
            {display.decisionHistory.map((entry, index) => (
              <div key={`${entry.at}-${entry.status}-${index}`} className="border-t theme-border pt-1 first:border-t-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono">{new Date(entry.at).toLocaleTimeString()} · {entry.status}{entry.repeatCount > 1 ? ` (${entry.repeatCount}x)` : ''}</span>
                  <span className="truncate">{entry.resolvedTrigger}</span>
                </div>
                <div className="truncate">{entry.reason}</div>
                {entry.evidence && <div className="truncate">{t('triggerEvidence')}: {entry.evidence}</div>}
                {entry.nextRunAt && <div className="truncate">{t('nextRun')}: {new Date(entry.nextRunAt).toLocaleTimeString()}</div>}
              </div>
            ))}
          </div>
        )}
      </details>
      <div className="theme-text-tertiary truncate mt-1">{t('lastResult')}: {display.lastResult}</div>
    </div>
  )
}

function GoalSuggestionRow({ suggestion, onAccept, onDismiss }: { suggestion: GoalAutomationSuggestion; onAccept: () => void; onDismiss: () => void }) {
  const t = useT()
  return (
    <div className="py-1.5 border-b theme-border last:border-b-0 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="theme-text-secondary truncate">{suggestion.title}</div>
          <div className="theme-text-tertiary truncate">{suggestion.source} · {suggestion.templateId}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onAccept} className="theme-accent hover:text-[#5b8aff] px-1">{t('accept')}</button>
          <button onClick={onDismiss} className="theme-text-tertiary hover:theme-accent px-1">{t('dismiss')}</button>
        </div>
      </div>
      <div className="theme-text-tertiary truncate mt-1">{suggestion.description}</div>
    </div>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'theme-green' : tone === 'bad' ? 'theme-red' : 'theme-text-secondary'
  return (
    <div className="rounded border theme-border px-1.5 py-1">
      <div className={`font-mono ${color}`}>{value}</div>
      <div className="theme-text-tertiary truncate">{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t theme-border pt-2">
      <div className="text-[10px] theme-text-tertiary mb-1.5 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="text-[10px] theme-text-tertiary py-1">{text}</div>
}

function TaskRow({ task, compact = false }: { task: FetchTask; compact?: boolean }) {
  return (
    <div className="py-1 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="theme-text-secondary truncate">{task.task_type}{task.code ? ` · ${task.code}` : ''}</span>
        <span className={`font-mono shrink-0 ${task.status === 'failed' ? 'theme-red' : 'theme-text-tertiary'}`}>{task.status}</span>
      </div>
      {task.error && !compact && <div className="theme-text-tertiary truncate">{task.error}</div>}
    </div>
  )
}

function TaskDiagnosis({ task, onRetry }: { task: FetchTask; onRetry: () => void }) {
  const t = useT()
  const diagnosis = diagnoseTask(task, t)
  const failureTime = task.updated_at || task.created_at
  return (
    <div className="rounded border theme-border p-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="theme-text-secondary truncate">{task.task_type}{task.code ? ` · ${task.code}` : ''}</span>
        <span className="theme-red font-mono shrink-0">failed</span>
      </div>
      {failureTime && <div className="theme-text-tertiary mt-1">{formatShortTime(failureTime)}</div>}
      <div className="theme-text-tertiary mt-1">{t('likelyCause')}: {diagnosis.cause}</div>
      <div className="theme-text-tertiary mt-0.5">{t('nextStep')}: {diagnosis.next}</div>
      <button onClick={onRetry} className="mt-1 text-[10px] theme-accent hover:text-[#5b8aff]">{t('retry')}</button>
    </div>
  )
}

function FeedRow({ feed, onRun }: { feed: FeedConfig; onRun: () => void }) {
  const t = useT()
  const hasProblem = Boolean(feed.last_error || feed.status === 'failed')
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[10px]">
      <div className="min-w-0">
        <div className="theme-text-secondary truncate">{feed.display_name}</div>
        <div className={hasProblem ? 'theme-red truncate' : 'theme-text-tertiary truncate'}>
          {feed.status}{feed.last_run_at ? ` · ${formatShortTime(feed.last_run_at)}` : ''}
        </div>
      </div>
      <button onClick={onRun} className="theme-text-tertiary hover:theme-accent shrink-0">{t('run')}</button>
    </div>
  )
}

function FeedFailure({ feed, onRun }: { feed: FeedConfig; onRun: () => void }) {
  const t = useT()
  return (
    <div className="rounded border theme-border p-1.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="theme-text-secondary truncate">{feed.display_name}</span>
        <span className="theme-red font-mono shrink-0">{feed.status || 'failed'}</span>
      </div>
      {feed.last_run_at && <div className="theme-text-tertiary mt-1">{formatShortTime(feed.last_run_at)}</div>}
      <div className="theme-text-tertiary mt-1">{t('likelyCause')}: {feed.last_error || t('feedCauseGeneric')}</div>
      <div className="theme-text-tertiary mt-0.5">{t('nextStep')}: {t('feedNextGeneric')}</div>
      <button onClick={onRun} className="mt-1 text-[10px] theme-accent hover:text-[#5b8aff]">{t('run')}</button>
    </div>
  )
}

function diagnoseTask(task: FetchTask, t: ReturnType<typeof useT>): { cause: string; next: string } {
  const kind = classifyDataTaskFailure(task)
  if (kind === 'timeout') {
    return {
      cause: t('dataCauseTimeout'),
      next: t('dataNextTimeout'),
    }
  }
  if (kind === 'all-sources') {
    return {
      cause: t('dataCauseAllSources'),
      next: t('dataNextAllSources'),
    }
  }
  return {
    cause: task.error || 'task failed',
    next: t('dataNextGeneric'),
  }
}

function statusColor(status: SourceStatus['status']): string {
  if (status === 'online') return 'theme-green'
  if (status === 'degraded') return 'text-[#ffc107]'
  return 'theme-red'
}

function doctorStatusColor(status: DoctorReport['status']): string {
  if (status === 'ok') return 'theme-green'
  if (status === 'warning') return 'text-[#ffc107]'
  return 'theme-red'
}

function doctorStatusLabel(status: DoctorReport['status'], t: ReturnType<typeof useT>): string {
  if (status === 'ok') return t('doctorOk')
  if (status === 'warning') return t('doctorWarning')
  return t('doctorCritical')
}

function doctorCheckLabel(id: string, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'datastore': return t('doctorDatastore')
    case 'api_failures': return t('doctorApiFailures')
    case 'queue': return t('doctorQueue')
    case 'stock_identity': return t('doctorStockIdentity')
    case 'fund_identity': return t('doctorFundIdentity')
    case 'quote_cache': return t('doctorQuoteCache')
    case 'kline_cache': return t('doctorKlineCache')
    case 'feeds': return t('doctorFeeds')
    case 'provider_routes': return t('doctorProviderRoutes')
    case 'schema_registry': return t('doctorSchemaRegistry')
    case 'desktop_services': return t('doctorDesktopServices')
    case 'runtime_paths': return t('doctorRuntimePaths')
    case 'session_history': return t('doctorSessionHistory')
    case 'session_index': return t('doctorSessionIndex')
    default: return id
  }
}

function doctorSummaryText(report: DoctorReport, t: ReturnType<typeof useT>): string {
  if (report.status === 'ok') return t('doctorSummaryOk')
  const critical = report.checks.filter((check) => check.status === 'critical').length
  const warning = report.checks.filter((check) => check.status === 'warning').length
  return `${critical} ${t('doctorCriticalCount')}, ${warning} ${t('doctorWarningCount')}`
}

function doctorCheckDetail(check: DoctorCheck, t: ReturnType<typeof useT>): string {
  const m = check.metrics ?? {}
  switch (check.id) {
    case 'datastore':
      return m.ready ? t('doctorDetailDatastoreReady') : t('doctorDetailDatastoreNotReady')
    case 'api_failures':
      return Number(m.failures ?? 0) > 0
        ? `${m.failures} ${t('doctorDetailApiFailures')}${m.top ? ` (${m.top})` : ''}${m.classes ? ` · ${m.classes}` : ''}`
        : t('doctorDetailApiClean')
    case 'queue':
      return `${m.pending ?? 0} ${t('queued')}, ${m.running ?? 0} ${t('running')}, ${m.failed ?? 0} ${t('failShort')}, ${m.stale ?? 0} ${t('doctorDetailStaleActive')}`
    case 'stock_identity':
    case 'fund_identity':
    case 'quote_cache':
    case 'kline_cache':
      return `${m.table ?? '-'}: ${m.count ?? 0} ${t('rowsLabel')}${m.latest ? `, ${t('latest')} ${m.latest}` : ''}`
    case 'feeds':
      return `${m.enabled ?? 0}/${m.total ?? 0} ${t('enabled')}, ${m.failed ?? 0} ${t('failShort')}`
    case 'provider_routes':
      return m.missing ? `${t('doctorDetailRoutesMissing')}: ${m.missing}` : t('doctorDetailRoutesOk')
    case 'schema_registry':
      return `${m.providers ?? 0} ${t('doctorDetailProviders')}, ${m.schemas ?? 0} ${t('doctorDetailSchemaRegistryOk')}, ${m.tables ?? 0} ${t('doctorDetailTables')}`
    case 'desktop_services':
      return `sidecar ${m.sidecar ?? '-'}, gotdx ${m.gotdx ?? '-'}`
    case 'runtime_paths':
      return `${m.path ?? '-'} · R:${String(m.readable ?? '-')} W:${String(m.writable ?? '-')}`
    case 'session_history':
      return `${t('current')}: ${m.currentExists ? t('yes') : t('no')}`
    case 'session_index':
      return `${m.exists ? t('doctorDetailSessionIndexPresent') : t('doctorDetailSessionIndexMissing')}`
    default:
      return check.detail
  }
}

function doctorCheckNextStep(id: string, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'datastore': return t('doctorNextDatastore')
    case 'api_failures': return t('doctorNextApiFailures')
    case 'queue': return t('doctorNextQueue')
    case 'stock_identity':
    case 'fund_identity':
    case 'quote_cache':
    case 'kline_cache':
      return t('doctorNextCache')
    case 'feeds': return t('doctorNextFeeds')
    case 'provider_routes': return t('doctorNextProviderRoutes')
    case 'schema_registry': return t('doctorNextSchemaRegistry')
    case 'desktop_services': return t('doctorNextDesktopServices')
    case 'runtime_paths': return t('doctorNextRuntimePaths')
    case 'session_history': return t('doctorNextSessionHistory')
    case 'session_index': return t('doctorNextSessionIndex')
    default: return t('dataNextGeneric')
  }
}

function formatShortTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function compactPath(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts.length <= 2 ? value : `${parts.at(-2)}/${parts.at(-1)}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
