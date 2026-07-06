import { buildDataInterfaceHealth, type DataInterfaceHealthRow } from '../data/data-interface-health'
import type { DataStore } from '../data/store/data-store'

type DataHealthSection = 'summary' | 'interfaces' | 'providers' | 'datasets' | 'gaps' | 'failures' | 'all'

export function dataHealth(ds: DataStore, input: Record<string, unknown>, runtimeBasePath?: string): string {
  const health = buildDataInterfaceHealth(ds?.isReady ? ds : null, undefined, {
    runtimeBasePath,
  })
  const section = normalizeSection(input.section)
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
  const interfaces = health.rows
    .slice()
    .sort(compareInterfaceHealth)
    .slice(0, limit)
    .map((row) => ({
      interfaceId: row.interfaceId,
      label: row.label,
      chinesePurpose: row.chinesePurpose,
      category: row.category,
      canonicalSchema: row.canonicalSchema,
      cacheStatus: row.cacheStatus,
      cachePolicy: row.cachePolicy,
      readbackAction: row.queryActions[0] ?? null,
      readbackActions: row.queryActions,
      supportedProviders: row.supportedProviders,
      gatedProviders: row.gatedProviders,
      outputOnlyProviders: row.outputOnlyProviders,
      unstableProviders: row.unstableProviders,
      localRows: row.localRows,
      latestSourceTime: row.latestSourceTime,
      sources: row.sources,
      recentFailures: row.recentFailures,
      lastFailureClass: row.lastFailureClass,
      liveProbeBacklog: row.liveProbeBacklog,
      liveFailures: row.liveFailures,
      liveStatus: row.liveStatus,
      health: row.health,
      nextAction: row.nextAction,
    }))
  const providers = health.providerRows
    .slice()
    .sort((a, b) => scoreProvider(b) - scoreProvider(a) || a.provider.localeCompare(b.provider))
    .slice(0, limit)
  const datasets = health.datasetRows.slice(0, limit)
  const gaps = health.providerGapQueue
    .slice()
    .sort(compareProviderGap)
    .slice(0, limit)
  const activations = health.credentialActivationQueue
    .slice()
    .sort(compareProviderGap)
    .slice(0, limit)
  const validatedCredentials = health.credentialValidatedQueue
    .slice()
    .sort(compareProviderGap)
    .slice(0, limit)
  const policyDisabled = health.policyDisabledQueue
    .slice()
    .sort(compareProviderGap)
    .slice(0, limit)
  const failures = health.failureActionQueue
    .slice()
    .sort(compareFailureAction)
    .slice(0, limit)
    .map(normalizeFailureActionForTool)
  const payload: Record<string, unknown> = {
    action: 'data_health',
    section,
    summary: health.summary,
    provenance: {
      interfaceId: 'data.health',
      providerId: 'local',
      provider: 'local',
      capabilityId: 'local.data_health',
      providerMode: 'local-evidence',
      cacheStatus: 'local-evidence',
      cacheDecision:
        'data_health reads local DataStore metadata, generated matrices, live probe evidence, and API health queues; it is operational evidence for routing and remediation, not reusable market data',
      canonicalSchema: 'data_health_report',
      canonicalTable: 'finance_data_health_report',
      readbackAction: 'data_health',
      failureClass: null,
      source: 'DataStore local metadata plus generated finance_data_health_report evidence',
      evidenceGeneratedAt: health.summary.evidenceGeneratedAt,
      fetchedAt: new Date().toISOString(),
    },
  }
  if (section === 'interfaces' || section === 'all') payload.interfaces = interfaces
  if (section === 'providers' || section === 'all') payload.providers = providers
  if (section === 'datasets' || section === 'all') payload.datasets = datasets
  if (section === 'gaps' || section === 'all') {
    payload.providerGapQueue = gaps
    payload.providerGaps = gaps
    payload.credentialActivationQueue = activations
    payload.credentialActivations = activations
    payload.credentialValidatedQueue = validatedCredentials
    payload.credentialValidated = validatedCredentials
    payload.policyDisabledQueue = policyDisabled
    payload.policyDisabled = policyDisabled
  }
  if (section === 'failures' || section === 'all') {
    payload.failureActionQueue = failures
    payload.failureActions = failures
  }
  if (section === 'summary') {
    payload.attentionInterfaces = interfaces.filter((row) => row.health !== 'ready').slice(0, limit)
    payload.providerAttention = providers.filter((row) => row.health !== 'ready').slice(0, limit)
    payload.datasetAttention = datasets.filter((row) => row.healthState !== 'ready' && row.healthState !== 'observed').slice(0, limit)
    payload.providerGapQueue = gaps
    payload.providerGaps = gaps
    payload.credentialActivationQueue = activations
    payload.credentialActivations = activations
    payload.credentialValidatedQueue = validatedCredentials
    payload.credentialValidated = validatedCredentials
    payload.policyDisabledQueue = policyDisabled
    payload.policyDisabled = policyDisabled
    payload.failureActionQueue = failures
    payload.failureActions = failures
  }
  return JSON.stringify(payload, null, 2)
}

function normalizeSection(value: unknown): DataHealthSection {
  if (value === 'interfaces' || value === 'providers' || value === 'datasets' || value === 'gaps' || value === 'failures' || value === 'all') return value
  return 'summary'
}

function compareInterfaceHealth(a: DataInterfaceHealthRow, b: DataInterfaceHealthRow): number {
  return scoreInterface(b) - scoreInterface(a) || a.interfaceId.localeCompare(b.interfaceId)
}

function scoreInterface(row: DataInterfaceHealthRow): number {
  return row.recentFailures * 1000
    + row.liveFailures * 500
    + row.liveProbeBacklog * 100
    + row.unstableProviders.length * 80
    + row.outputOnlyProviders.length * 30
    + row.gatedProviders.length * 20
    + (row.health === 'gap' ? 10 : row.health === 'attention' ? 50 : 0)
}

function scoreProvider(row: { recentFailures: number; liveFailures: number; unstable: number; outputOnly: number; gated: number; health: string }): number {
  return row.recentFailures * 1000
    + row.liveFailures * 500
    + row.unstable * 100
    + row.outputOnly * 30
    + row.gated * 20
    + (row.health === 'gap' ? 10 : row.health === 'attention' ? 50 : 0)
}

function compareProviderGap(a: { actionPriority?: number | null; status?: string; promotionCandidate?: boolean; routeImplementationRequired?: boolean; interfaceId?: string; provider?: string }, b: { actionPriority?: number | null; status?: string; promotionCandidate?: boolean; routeImplementationRequired?: boolean; interfaceId?: string; provider?: string }): number {
  return providerGapPriority(a) - providerGapPriority(b)
    || scoreProviderGap(b) - scoreProviderGap(a)
    || String(a.interfaceId ?? '').localeCompare(String(b.interfaceId ?? ''))
    || String(a.provider ?? '').localeCompare(String(b.provider ?? ''))
}

function providerGapPriority(row: { actionPriority?: number | null }): number {
  return typeof row.actionPriority === 'number' ? row.actionPriority : 9
}

function scoreProviderGap(row: { status?: string; promotionCandidate?: boolean; routeImplementationRequired?: boolean }): number {
  return (row.promotionCandidate ? 100 : 0)
    + (row.routeImplementationRequired ? 50 : 0)
    + (row.status === 'output-only' ? 30 : row.status === 'credential-gated' || row.status === 'quota-gated' ? 20 : 10)
}

function compareFailureAction(a: { failureClass?: string | null; provider?: string | null; family?: string | null }, b: { failureClass?: string | null; provider?: string | null; family?: string | null }): number {
  return scoreFailureAction(b) - scoreFailureAction(a)
    || String(a.provider ?? '').localeCompare(String(b.provider ?? ''))
    || String(a.family ?? '').localeCompare(String(b.family ?? ''))
}

function normalizeFailureActionForTool<T extends {
  id?: string | null
  probeId?: string | null
  interfaceId?: string | null
  provider?: string | null
  capabilityId?: string | null
  failureClass?: string | null
  validationState?: string | null
  retryPolicy?: string | null
  cacheDecision?: string | null
  presenceReason?: string | null
  exitCondition?: string | null
  nextAction?: string | null
  recoveryPolicy?: string | null
  error?: string | null
}>(row: T): T {
  const retryPolicy = row.retryPolicy ?? failureRetryPolicy(row.failureClass ?? null, row.validationState ?? null)
  const cacheDecision = row.cacheDecision ?? failureCacheDecision(row.failureClass ?? null, row.validationState ?? null)
  const presenceReason = row.presenceReason ?? row.error ?? failurePresenceReason(row.failureClass ?? null, row.validationState ?? null)
  const exitCondition = row.exitCondition ?? failureExitCondition(row.failureClass ?? null, row.validationState ?? null)
  const nextAction = row.nextAction ?? row.recoveryPolicy ?? failureNextAction(row.failureClass ?? null, row.validationState ?? null)
  const {
    retryPolicy: _retryPolicy,
    cacheDecision: _cacheDecision,
    presenceReason: _presenceReason,
    exitCondition: _exitCondition,
    nextAction: _nextAction,
    ...rest
  } = row
  return {
    ...rest,
    id: row.id ?? null,
    probeId: row.probeId ?? null,
    interfaceId: row.interfaceId ?? null,
    provider: row.provider ?? null,
    capabilityId: row.capabilityId ?? null,
    failureClass: row.failureClass ?? null,
    validationState: row.validationState ?? null,
    presenceReason,
    cacheDecision,
    exitCondition,
    retryPolicy,
    nextAction,
  } as T
}

function failureRetryPolicy(failureClass: string | null, validationState: string | null): string {
  if (failureClass === 'auth_permission') return 'no automatic retry until provider entitlement or permission changes'
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return 'no automatic retry until credential or permission changes'
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return 'no broad retry until quota reset; cache/readback first'
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'no retry until adapter or schema contract is fixed'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'serial retry only after provider/network recovery'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'retry only after runtime dependency is restored'
  return 'manual triage required before retry'
}

function failureCacheDecision(failureClass: string | null, validationState: string | null): string {
  if (failureClass === 'auth_permission') return 'Keep this provider out of live routing until entitlement changes. Use local cache/readback or healthy fallback providers when available.'
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return 'Keep provider gate active and avoid live refresh until credentials or permissions change. Use local cache/readback or healthy fallback providers when available.'
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return 'Do not spend more quota on broad retry; prefer cache/readback and fallback providers. Use local cache/readback or healthy fallback providers when available.'
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'Do not persist or reuse new provider output until adapter, parser, normalizer, and readback contract are fixed.'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'Preserve existing cached data; retry only with a bounded serial probe after provider/network recovery. Use local cache/readback or healthy fallback providers when available.'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'Provider refresh is blocked by runtime dependency; use cache/readback until the dependency is restored. Use local cache/readback or healthy fallback providers when available.'
  return 'Classify root cause before widening live routing. Use local cache/readback or healthy fallback providers when available.'
}

function failurePresenceReason(failureClass: string | null, validationState: string | null): string {
  if (failureClass === 'auth_permission') return 'Provider rejected the probe because the configured credential lacks endpoint entitlement or account permission.'
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return 'Provider credentials or permissions are not accepted for this route.'
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return 'Provider quota or rate limit blocks this route.'
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'Provider response does not satisfy the expected interface contract.'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'Provider route is failing due to transport, timeout, or provider instability.'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'Runtime dependency is unavailable for this provider route.'
  return 'Provider failure requires classified triage before widening use.'
}

function failureExitCondition(failureClass: string | null, validationState: string | null): string {
  if (failureClass === 'auth_permission') return 'Leaves this queue after endpoint entitlement or account permission changes are verified by the bounded probe, or after this provider capability is reclassified.'
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return 'Leaves this queue after credential or permission changes are verified by a bounded probe, or after the capability is reclassified as gated, disabled, unsupported, or supported.'
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return 'Leaves this queue after quota availability is verified or the capability is reclassified with explicit quota policy.'
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'Leaves this queue after adapter/parser/normalizer contract is fixed and focused readback verification passes, or after the path is marked unsupported/diagnostic.'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'Leaves this queue after serial retry produces stable evidence or the provider is reclassified as unstable, disabled, unsupported, or gated.'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'Leaves this queue after the runtime dependency is restored and the registered probe is rerun successfully or reclassified.'
  return 'Leaves this queue after root cause classification, provider evidence update, and focused verification.'
}

function failureNextAction(failureClass: string | null, validationState: string | null): string {
  if (validationState === 'runtime-blocked' || failureClass === 'runtime_unavailable') return 'Restore the runtime dependency, then retry only the bounded registered probe.'
  if (validationState === 'transport-or-provider-unstable' || failureClass === 'transport' || failureClass === 'timeout') return 'Retry only after provider/network recovery; keep the failure classified if it repeats.'
  if (failureClass === 'auth_permission') return 'Do not retry automatically; update provider entitlement/permission, then rerun only this bounded probe and verify readback.'
  if (validationState === 'credential-gated' || validationState === 'quota-gated') return 'Use configured credential/quota gate before retrying this route.'
  if (validationState === 'unsupported-by-provider') return 'Keep this route unsupported or replace it with a provider-supported interface.'
  return 'Inspect the failure and update provider classification before retrying.'
}

function scoreFailureAction(row: { failureClass?: string | null }): number {
  if (row.failureClass === 'schema-or-contract') return 100
  if (row.failureClass === 'credential-or-permission' || row.failureClass === 'quota-or-rate-limit') return 80
  if (row.failureClass === 'transport' || row.failureClass === 'timeout') return 60
  return 10
}
