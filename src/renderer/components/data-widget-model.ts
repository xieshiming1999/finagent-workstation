import {
  financeDataContractSteps,
  type FinanceDataContractStep,
  type FinanceDataContractStepId,
} from '../../agent/data/finance-data-contract'
import {
  isActionableFeedFailure as isSharedActionableFeedFailure,
  isActionableFeedTaskFailure,
} from '../../agent/data/data-feed-failure-policy'

export interface DataStats {
  tables: Array<{ name: string; count: number }>
  sizeBytes: number
  reusable?: ReusableDataRow[]
}

export interface ReusableDataRow {
  name: string
  count: number
  latest: string | null
  sources?: string | null
}

export interface FetchTask {
  id: number
  task_type: string
  code: string | null
  status: string
  error: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface SourceStatus {
  source: string
  status: 'online' | 'degraded' | 'offline'
  active: number
  errorCount: number
}

export interface FeedConfig {
  feed_id: string
  display_name: string
  enabled: number
  status: string
  last_run_at: string | null
  last_error: string | null
}

export interface DataWidgetSummary {
  totalRows: number
  sizeMb: string
  reusable: ReusableDataRow[]
  activeTasks: FetchTask[]
  failedTasks: FetchTask[]
  offlineSources: number
  enabledFeeds: FeedConfig[]
  feedFailures: FeedConfig[]
  healthState: 'healthy' | 'attention'
}

export type DataSurfaceContractStepId = FinanceDataContractStepId

export type DataSurfaceContractStep = FinanceDataContractStep

export const dataSurfaceContractSteps: readonly DataSurfaceContractStep[] =
  financeDataContractSteps

export function buildDataWidgetSummary(args: {
  stats: DataStats | null
  tasks: FetchTask[]
  sources: SourceStatus[]
  feeds: FeedConfig[]
}): DataWidgetSummary {
  const totalRows = args.stats?.tables.reduce((sum, row) => sum + row.count, 0) ?? 0
  const sizeMb = args.stats ? (args.stats.sizeBytes / 1048576).toFixed(1) : '0'
  const reusable = args.stats?.reusable?.slice(0, 6) ?? []
  const activeTasks = args.tasks
    .filter((task) => task.status === 'running' || task.status === 'pending')
    .slice(0, 5)
  const failedTasks = args.tasks
    .filter(isActionableFetchTaskFailure)
    .slice(0, 3)
  const offlineSources = args.sources.filter((source) => source.status !== 'online').length
  const enabledFeeds = args.feeds.filter((feed) => Number(feed.enabled) !== 0)
  const feedFailures = args.feeds
    .filter(isActionableFeedFailure)
    .slice(0, 3)

  return {
    totalRows,
    sizeMb,
    reusable,
    activeTasks,
    failedTasks,
    offlineSources,
    enabledFeeds,
    feedFailures,
    healthState: failedTasks.length === 0 && feedFailures.length === 0 ? 'healthy' : 'attention',
  }
}

export function isActionableFetchTaskFailure(task: FetchTask): boolean {
  return isActionableFeedTaskFailure(task)
}

export function isActionableFeedFailure(feed: FeedConfig): boolean {
  return isSharedActionableFeedFailure(feed)
}

export type DataTaskFailureKind = 'timeout' | 'all-sources' | 'generic'

export function classifyDataTaskFailure(task: Pick<FetchTask, 'error'>): DataTaskFailureKind {
  const error = String(task.error ?? '').toLowerCase()
  if (error.includes('timeout') || error.includes('aborted')) return 'timeout'
  if (error.includes('all sources failed')) return 'all-sources'
  return 'generic'
}

export interface DataInterfaceProvenanceDisplayRow {
  canonicalSchema?: string | null
  canonicalTable?: string | null
  cachePolicy?: string | null
  cacheStatus?: string | null
  readbackAction?: string | null
  readbackActions?: string[] | null
}

export interface DataProviderEvidenceDisplayRow {
  capabilityId?: string | null
  probeId?: string | null
  liveStatus?: string | null
  liveValidationState?: string | null
  liveFailureClass?: string | null
  normalizer?: string | null
  canonicalTable?: string | null
}

export interface DataFailureAffectedCapabilityDisplayRow {
  interfaceId?: string | null
  capabilityId?: string | null
  provider?: string | null
  normalizedProvider?: string | null
  status?: string | null
  canonicalSchema?: string | null
  canonicalTable?: string | null
  readbackAction?: string | null
  readbackActions?: string[] | null
  normalizer?: string | null
}

export interface DataFailureEvidenceDisplayRow {
  capabilityId?: string | null
  probeId?: string | null
  canonicalSchema?: string | null
  canonicalTable?: string | null
  readbackAction?: string | null
  readbackActions?: string[] | null
  affectedInterfaces?: string[] | null
  affectedCapabilities?: DataFailureAffectedCapabilityDisplayRow[] | null
}

export interface DataHealthQueueDisplayRow {
  interfaceId?: string | null
  provider?: string | null
  status?: string | null
  gapClass?: string | null
  activationState?: string | null
  activationLabel?: string | null
  liveStatus?: string | null
  liveValidationState?: string | null
  validationState?: string | null
  failureClass?: string | null
  nextAction?: string | null
  reason?: string | null
  presenceReason?: string | null
  exitCondition?: string | null
  retryPolicy?: string | null
  cacheDecision?: string | null
  recoveryPolicy?: string | null
  error?: string | null
}

export interface DataHealthQueueDisplayText {
  label: string
  presenceReason: string
  exitCondition: string
  nextAction: string
  retryPolicy: string
  cacheDecision: string
}

export function buildDataHealthQueueTitle(display: DataHealthQueueDisplayText): string {
  return [
    display.presenceReason,
    display.cacheDecision,
    display.exitCondition,
    display.retryPolicy,
    display.nextAction,
  ].filter(Boolean).join('\n')
}

export function buildInterfaceProvenanceText(row: DataInterfaceProvenanceDisplayRow): string {
  const schema = row.canonicalSchema ?? row.canonicalTable ?? '-'
  const readback = row.readbackAction ?? firstNonEmpty(row.readbackActions) ?? '-'
  const cache = row.cachePolicy ?? row.cacheStatus ?? '-'
  return `schema ${schema} · readback ${readback} · cache ${cache}`
}

export function buildProviderEvidenceText(row: DataProviderEvidenceDisplayRow): string {
  const capability = row.capabilityId ?? '-'
  const probe = row.probeId ?? '-'
  const live = row.liveStatus ?? row.liveValidationState ?? row.liveFailureClass ?? '-'
  const canonical = row.normalizer || row.canonicalTable
    ? `${row.normalizer ?? '-'}/${row.canonicalTable ?? '-'}`
    : '-'
  return `capability ${capability} · probe ${probe} · live ${live} · ${canonical}`
}

export function buildFailureEvidenceText(row: DataFailureEvidenceDisplayRow): string {
  const firstCapability = row.affectedCapabilities?.[0]
  const capability = row.capabilityId ?? firstCapability?.capabilityId ?? '-'
  const schema =
    row.canonicalSchema ??
    row.canonicalTable ??
    firstCapability?.canonicalSchema ??
    firstCapability?.canonicalTable ??
    '-'
  const readback =
    row.readbackAction ??
    firstNonEmpty(row.readbackActions) ??
    firstCapability?.readbackAction ??
    firstNonEmpty(firstCapability?.readbackActions) ??
    '-'
  const probe = row.probeId ?? '-'
  const interfaceId = firstNonEmpty(row.affectedInterfaces) ?? firstCapability?.interfaceId ?? '-'
  return `capability ${capability} · schema ${schema} · readback ${readback} · interface ${interfaceId} · probe ${probe}`
}

export function buildDataHealthQueueDisplayText(
  row: DataHealthQueueDisplayRow,
  kind: 'failure' | 'gap' | 'credential' | 'credentialValidated' | 'disabled',
): DataHealthQueueDisplayText {
  const provider = row.provider ?? 'provider'
  const interfaceId = row.interfaceId ?? 'interface'
  const status = row.gapClass ?? row.failureClass ?? row.activationLabel ?? row.activationState ?? row.validationState ?? row.liveValidationState ?? row.liveStatus ?? row.status ?? kind
  const reason = row.reason ?? row.error ?? ''
  if (kind === 'failure') {
    return {
      label: status,
      presenceReason: row.presenceReason ?? (reason || `${provider}/${interfaceId} has failed or blocked live evidence.`),
      exitCondition: row.exitCondition ?? exitConditionForFailure(status, provider),
      nextAction: row.nextAction ?? row.recoveryPolicy ?? (reason || 'Inspect API Health, fix the failing dependency or provider state, then run a bounded probe.'),
      retryPolicy: row.retryPolicy ?? retryPolicyForFailure(status),
      cacheDecision: row.cacheDecision ?? 'Use cache/readback or healthy fallback providers when available; do not treat failed provider output as reusable data.',
    }
  }
  if (kind === 'credential') {
    return {
      label: status,
      presenceReason: reason || `${provider}/${interfaceId} is credential or quota gated.`,
      exitCondition: 'Leaves this list after credentials/quota are available, live validation passes, and the route is either kept credential-gated with evidence or promoted through normalizer -> persist -> readback proof.',
      nextAction: row.nextAction ?? 'Use cache/readback first; run the matching credential probe only after credentials and quota are available.',
      retryPolicy: 'no broad retry; run the registered credential probe serially',
      cacheDecision: row.cacheDecision ?? 'Use existing cache/readback or eligible fallback providers first; do not call this provider live until credential/quota evidence is current.',
    }
  }
  if (kind === 'credentialValidated') {
    return {
      label: status,
      presenceReason: reason || `${provider}/${interfaceId} is credential-gated but has current live valid-schema evidence in this runtime.`,
      exitCondition: row.exitCondition ?? 'Leaves this evidence list only when live validation expires, credentials/quota become unavailable, the capability is promoted to an ungated supported route, or it is reclassified.',
      nextAction: row.nextAction ?? 'Keep cache/readback first; use this provider only through its governed interface and current credential/quota policy.',
      retryPolicy: row.retryPolicy ?? 'no broad retry; rerun only the registered credential probe when evidence is stale or configuration changes',
      cacheDecision: row.cacheDecision ?? 'Credentialed live evidence exists, but cache/readback remains the first reuse path unless provider policy requires refresh.',
    }
  }
  if (kind === 'disabled') {
    return {
      label: status,
      presenceReason: reason || `${provider}/${interfaceId} is policy-disabled for normal workflow.`,
      exitCondition: 'Leaves this list only if policy, permissions, and runtime guardrails change and the capability is reclassified with evidence.',
      nextAction: row.nextAction ?? 'Do not route normal workflow to this provider capability.',
      retryPolicy: 'do not retry while policy-disabled',
      cacheDecision: row.cacheDecision ?? 'Do not use this provider capability for normal workflow or cache refresh while policy-disabled.',
    }
  }
  return {
    label: status,
    presenceReason: reason || `${provider}/${interfaceId} has a provider capability gap.`,
    exitCondition: exitConditionForGap(status),
    nextAction: row.nextAction ?? 'Decide whether to implement, explicitly gate, disable, mark unsupported, or keep diagnostic/output-only.',
    retryPolicy: retryPolicyForGap(status),
    cacheDecision: row.cacheDecision ?? 'Normal cache/readback behavior is not available until this capability is classified or implemented.',
  }
}

function exitConditionForFailure(status: string, provider: string): string {
  if (status.includes('runtime') || status.includes('blocked')) return `Leaves this list after the ${provider} runtime dependency is restored and the registered probe writes passing evidence.`
  if (status.includes('credential') || status.includes('permission') || status.includes('auth')) return 'Leaves this list after credential/permission state changes and a bounded live probe succeeds or the capability is reclassified.'
  return 'Leaves this list after the failure is classified, fixed, and replaced by passing live evidence or an explicit non-callable status.'
}

function retryPolicyForFailure(status: string): string {
  if (status.includes('runtime') || status.includes('blocked')) return 'retry only after runtime dependency is restored'
  if (status.includes('credential') || status.includes('permission') || status.includes('auth')) return 'no automatic retry until credential or permission changes'
  return 'retry only as a bounded targeted probe'
}

function exitConditionForGap(status: string): string {
  if (status.includes('route-implementation')) return 'Leaves this list after adapter, normalizer, canonical persistence/output shape, readback/cache policy, and tests are implemented.'
  if (status.includes('credential') || status.includes('quota')) return 'Leaves this list after credentials/quota are proven or the capability is reclassified as disabled/not-supported.'
  if (status.includes('output-only')) return 'Leaves this list after it is either promoted to a governed interface or explicitly retained as normalized output-only.'
  return 'Leaves this list after implementation, explicit gate, disabled status, unsupported status, or diagnostic classification is recorded.'
}

function retryPolicyForGap(status: string): string {
  if (status.includes('credential') || status.includes('quota')) return 'no broad retry; validate credential/quota first'
  if (status.includes('route-implementation')) return 'do not retry until route implementation exists'
  return 'review before retry'
}

function firstNonEmpty(values?: string[] | null): string | null {
  return values?.find((value) => value.trim().length > 0) ?? null
}
