import {
  cacheCoverageForInterface,
  listDataApiInterfaces,
  listDataApiProviders,
  type DataApiProviderCapability,
  type DataApiProviderConstraint,
  type DataApiCapabilityStatus,
  type DataApiProvider,
} from './data-api-interface-contract'
import type { DataStore } from './store/data-store'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  loadRuntimeLiveStatusReport,
  mergeFinanceDataHealthEvidenceWithRuntimeLiveStatus,
  type RuntimeLiveStatusReport,
  type RuntimeLiveStatusRow,
} from './data-interface-runtime-evidence'

type TableStat = { name: string; count: number }
type ReusableRow = { name: string; count: number; latest: string | null; sources?: string | null }

export interface DataInterfaceHealthRow {
  interfaceId: string
  label: string
  canonicalSchema: string
  tables: string[]
  queryActions: string[]
  cacheStatus: string
  cacheReader: string | null
  cachePolicy: string
  capabilities: DataInterfaceHealthCapability[]
  supportedProviders: string[]
  gatedProviders: string[]
  outputOnlyProviders: string[]
  unsupportedProviders: string[]
  implicitNotSupportedProviderDetails: Array<{
    provider: DataApiProvider
    status: 'not-supported'
    capabilityId: null
    reason: string
  }>
  unstableProviders: string[]
  disabledProviders: string[]
  providerStatuses: Record<string, DataApiCapabilityStatus | 'not-supported'>
  localRows: number
  latest: string | null
  latestSourceTime: string | null
  sources: string | null
  recentFailures: number
  lastFailureAt: string | null
  lastFailure: string | null
  lastFailureClass: string | null
  liveProbeIds: string[]
  liveProbeBacklog: number
  passedLiveRows: number
  liveFailures: number
  liveStatus: string | null
  chinesePurpose: string | null
  category: string | null
  nextAction: string
  health: 'ready' | 'attention' | 'gap'
}

export interface DataInterfaceHealthCapability {
  provider: DataApiProvider
  capabilityId: string
  status: DataApiCapabilityStatus
  priority: number | null
  canonicalTable: string | null
  normalizer: string | null
  adapter: string | null
  probeId: string | null
  reason: string | null
  nextAction: string
}

export interface DataInterfaceHealthSummary {
  interfaces: number
  ready: number
  attention: number
  gaps: number
  recentFailures: number
  providerGapRows: number
  credentialActivationRows: number
  credentialValidatedRows: number
  policyDisabledRows: number
  providerGapLiveObserved: number
  providerGapLiveFailedOrBlocked: number
  credentialActivationLiveObserved: number
  credentialValidatedLiveObserved?: number
  providerGapClassCounts: Record<string, number>
  credentialActivationClassCounts: Record<string, number>
  policyDisabledClassCounts: Record<string, number>
  providers: DataApiProvider[]
  liveStatusRows: number
  liveStatusPassed: number
  liveStatusFailedOrBlocked: number
  liveProbeBacklogRows: number
  datasets: number
  evidenceGeneratedAt: string | null
}

export interface DataProviderHealthRow {
  provider: DataApiProvider
  supported: number
  gated: number
  outputOnly: number
  unstable: number
  disabled: number
  notSupported: number
  recentFailures: number
  lastFailureAt: string | null
  lastFailure: string | null
  lastFailureClass: string | null
  liveProbeCount: number
  livePassed: number
  liveFailures: number
  liveFailureClasses: Record<string, number>
  nextAction: string
  health: 'ready' | 'attention' | 'gap'
}

export interface DataInterfaceHealth {
  summary: DataInterfaceHealthSummary
  runtimeLiveStatusReport: RuntimeLiveStatusReport | null
  providerRows: DataProviderHealthRow[]
  datasetRows: DataDatasetHealthRow[]
  providerGapQueue: DataProviderGapQueueRow[]
  credentialActivationQueue: DataProviderGapQueueRow[]
  credentialValidatedQueue: DataProviderGapQueueRow[]
  policyDisabledQueue: DataProviderGapQueueRow[]
  failureActionQueue: DataFailureActionQueueRow[]
  rows: DataInterfaceHealthRow[]
}

export interface DataDatasetHealthRow {
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
}

export interface FinanceDataHealthEvidence {
  generatedAt?: string
  summary?: {
    liveStatusRows?: number
    liveStatusPassed?: number
    liveStatusFailedOrBlocked?: number
    liveProbeBacklogRows?: number
    datasets?: number
    providerGapLiveObserved?: number
    providerGapLiveFailedOrBlocked?: number
    credentialActivationRows?: number
    credentialValidatedRows?: number
    policyDisabledRows?: number
    credentialActivationLiveObserved?: number
    credentialValidatedLiveObserved?: number
    credentialActivationClassCounts?: Record<string, number>
    policyDisabledClassCounts?: Record<string, number>
  }
  interfaceHealth?: Array<{
    interfaceId: string
    category?: string
    chinesePurpose?: string
    liveProbeIds?: string[]
    liveProbeBacklog?: number
    passedLiveRows?: number
    failures?: number
    healthState?: string
  }>
  providerHealth?: Array<{
    provider: string
    liveProbeCount?: number
    liveFailures?: number
    liveFailureClasses?: Record<string, number>
  }>
  liveProviderHealth?: Array<{
    provider: string
    passed?: number
    liveProbeCount?: number
    failures?: number
    failureClasses?: Record<string, number>
  }>
  datasetHealth?: DataDatasetHealthRow[]
  providerGapQueue?: DataProviderGapQueueRow[]
  credentialActivationQueue?: DataProviderGapQueueRow[]
  credentialValidatedQueue?: DataProviderGapQueueRow[]
  policyDisabledQueue?: DataProviderGapQueueRow[]
  failureActionQueue?: DataFailureActionQueueRow[]
}

export interface DataProviderGapQueueRow {
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
  liveStatus?: string | null
  liveValidationState?: string | null
  liveFailureClass?: string | null
  liveHttpStatus?: number | null
  liveParsedCount?: number | null
  liveDurationMs?: number | null
  liveProviderTime?: string | null
  liveError?: string | null
  reusableShape?: boolean | string | null
  routeWiringStatus?: string | null
  routeImplementationRequired?: boolean
  gapClass?: string | null
  actionPriority?: number | null
  promotionCandidate?: boolean
  activationState?: string | null
  activationLabel?: string | null
  cacheDecision?: string | null
  nextAction?: string | null
  reason?: string | null
}

export interface DataFailureActionQueueRow {
  id?: string
  interfaceId?: string | null
  probeId?: string | null
  provider?: string | null
  family?: string | null
  status?: string | null
  validationState?: string | null
  failureClass?: string | null
  affectedInterfaces?: string[]
  affectedRows?: string[]
  affectedCapabilities?: DataFailureAffectedCapability[]
  capabilityId?: string | null
  canonicalSchema?: string | null
  canonicalTable?: string | null
  readbackAction?: string | null
  readbackActions?: string[]
  reason?: string | null
  recoveryPolicy?: string | null
  retryPolicy?: string | null
  cacheDecision?: string | null
  presenceReason?: string | null
  exitCondition?: string | null
  nextAction?: string | null
  error?: string | null
}

export interface DataFailureAffectedCapability {
  interfaceId: string
  capabilityId: string
  provider: string
  status: string
  canonicalSchema: string
  canonicalTable: string | null
  readbackAction: string | null
  readbackActions: string[]
  normalizer: string | null
}

export interface RuntimeCapabilityRouteDecision {
  capabilityId: string
  provider: string
  routeState:
    | 'validated'
    | 'allowed-unvalidated'
    | 'degraded-allowed'
    | 'blocked-credential-missing'
    | 'blocked-awaiting-validation'
    | 'blocked-provider-permission'
    | 'blocked-quota'
    | 'blocked-runtime'
    | 'blocked-transport'
    | 'temporarily-blocked'
    | 'blocked-policy'
  eligible: boolean
  reason: string
  evidenceStatus: string | null
  liveValidationState: string | null
  liveFailureClass: string | null
  temporaryBlockUntil: string | null
  routeBlockScope: string | null
  sortRank: number
}

export function loadFinanceDataHealthEvidence(repoRoot = process.cwd(), runtimeBasePath?: string | null): FinanceDataHealthEvidence | null {
  const candidates = [
    resolve(repoRoot, 'reports/integrations/finance_data_health_report_2026_06_18.json'),
    resolve(repoRoot, '..', 'reports/integrations/finance_data_health_report_2026_06_18.json'),
  ]
  let evidence: FinanceDataHealthEvidence | null = null
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      evidence = JSON.parse(readFileSync(filePath, 'utf-8')) as FinanceDataHealthEvidence
      break
    } catch {
      evidence = null
      break
    }
  }
  return mergeFinanceDataHealthEvidenceWithRuntimeLiveStatus(
    evidence,
    loadRuntimeLiveStatusReport(runtimeBasePath),
  )
}

export function buildDataInterfaceHealth(
  ds: DataStore | null,
  evidence: FinanceDataHealthEvidence | null = loadFinanceDataHealthEvidence(),
  options?: { runtimeBasePath?: string | null; repoRoot?: string },
): DataInterfaceHealth {
  const runtimeLiveStatusReport = options?.runtimeBasePath
    ? loadRuntimeLiveStatusReport(options.runtimeBasePath)
    : null
  const resolvedEvidence = options?.runtimeBasePath
    ? mergeFinanceDataHealthEvidenceWithRuntimeLiveStatus(
        evidence ?? loadFinanceDataHealthEvidence(options?.repoRoot ?? process.cwd(), undefined),
        runtimeLiveStatusReport,
      )
    : evidence ?? loadFinanceDataHealthEvidence(
        options?.repoRoot ?? process.cwd(),
        options?.runtimeBasePath,
      )
  const providers = listDataApiProviders()
  const tableCounts = tableCountMap(ds)
  const reusable = reusableMap(ds)
  const failures = recentFailureMap(ds)
  const providerFailures = recentProviderFailureMap(ds)
  const evidenceByInterface = new Map((resolvedEvidence?.interfaceHealth ?? []).map((row) => [row.interfaceId, row]))
  const credentialGateObservedInterfaces = new Set(
    (resolvedEvidence?.credentialActivationQueue ?? [])
      .filter((row) => row.liveStatus === 'passed' && row.normalizer && row.canonicalTable)
      .map((row) => row.interfaceId),
  )
  const rows = listDataApiInterfaces().map((item): DataInterfaceHealthRow => {
    const cache = cacheCoverageForInterface(item.id)
    const providerStatuses = Object.fromEntries(providers.map((provider) => [provider, 'not-supported'])) as Record<string, DataApiCapabilityStatus | 'not-supported'>
    const supportedProviders: string[] = []
    const gatedProviders: string[] = []
    const outputOnlyProviders: string[] = []
    const unsupportedProviders: string[] = []
    const unstableProviders: string[] = []
    const disabledProviders: string[] = []
    const capabilities: DataInterfaceHealthCapability[] = []
    const declaredProviders = new Set<DataApiProvider>()

    for (const capability of item.capabilities) {
      declaredProviders.add(capability.provider)
      providerStatuses[capability.provider] = capability.status
      capabilities.push({
        provider: capability.provider,
        capabilityId: capability.id,
        status: capability.status,
        priority: capability.priority ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        normalizer: capability.normalizer ?? null,
        adapter: capability.adapter ?? null,
        probeId: capability.probeId ?? null,
        reason: capability.reason ?? null,
        nextAction: capabilityNextAction(capability.status, capability.reason ?? null),
      })
      if (capability.status === 'supported' || capability.status === 'global-only') supportedProviders.push(capability.provider)
      else if (capability.status === 'credential-gated' || capability.status === 'quota-gated') gatedProviders.push(capability.provider)
      else if (capability.status === 'output-only') outputOnlyProviders.push(capability.provider)
      else if (capability.status === 'transport-unstable') unstableProviders.push(capability.provider)
      else if (capability.status === 'disabled') disabledProviders.push(capability.provider)
      else unsupportedProviders.push(capability.provider)
    }
    const implicitNotSupportedProviderDetails = providers
      .filter((provider) => !declaredProviders.has(provider))
      .map((provider) => ({
        provider,
        status: 'not-supported' as const,
        capabilityId: null,
        reason: implicitNotSupportedReason(provider, item.id),
      }))

    const localRows = item.dataStoreTables.reduce((sum, table) => sum + (tableCounts.get(table) ?? 0), 0)
    const reusableRows = item.dataStoreTables.map((table) => reusable.get(table)).filter(Boolean) as ReusableRow[]
    const latest = latestOf(reusableRows.map((row) => row.latest))
    const sources = uniqueSources(reusableRows.map((row) => row.sources).filter(Boolean) as string[])
    const failure = failures.get(item.id)
    const evidenceRow = evidenceByInterface.get(item.id)
    const gapCount = gatedProviders.length + outputOnlyProviders.length + unstableProviders.length + disabledProviders.length
    const lastFailureClass = failure?.lastFailureClass ?? null
    const health = failure?.count
      ? 'attention'
      : supportedProviders.length > 0 && cache.status === 'implemented' && gapCount === 0
        ? 'ready'
        : 'gap'
    const nextAction = interfaceNextAction({
      failureClass: lastFailureClass,
      cacheStatus: cache.status,
      supportedProviders,
      gatedProviders,
      outputOnlyProviders,
      unstableProviders,
      disabledProviders,
      recentFailures: failure?.count ?? 0,
      credentialGateObserved: credentialGateObservedInterfaces.has(item.id),
    })

    return {
      interfaceId: item.id,
      label: item.label,
      canonicalSchema: item.canonicalSchema,
      tables: [...item.dataStoreTables],
      queryActions: [...item.queryActions],
      cacheStatus: cache.status,
      cacheReader: cache.reader,
      cachePolicy: cache.policy,
      capabilities,
      supportedProviders,
      gatedProviders,
      outputOnlyProviders,
      unsupportedProviders,
      implicitNotSupportedProviderDetails,
      unstableProviders,
      disabledProviders,
      providerStatuses,
      localRows,
      latest,
      latestSourceTime: latest,
      sources,
      recentFailures: failure?.count ?? 0,
      lastFailureAt: failure?.lastAt ?? null,
      lastFailure: failure?.lastError ?? null,
      lastFailureClass,
      liveProbeIds: evidenceRow?.liveProbeIds ?? [],
      liveProbeBacklog: Number(evidenceRow?.liveProbeBacklog ?? 0),
      passedLiveRows: Number(evidenceRow?.passedLiveRows ?? 0),
      liveFailures: Number(evidenceRow?.failures ?? 0),
      liveStatus: evidenceRow?.healthState ?? null,
      chinesePurpose: evidenceRow?.chinesePurpose ?? null,
      category: evidenceRow?.category ?? null,
      nextAction,
      health,
    }
  })
  const providerRows = buildProviderRows(rows, providers, providerFailures, resolvedEvidence)
  const credentialContexts = loadCredentialContexts()
  const normalizedCredentialRows = [...(resolvedEvidence?.credentialActivationQueue ?? []).map((row) => normalizeProviderGapQueueRow(row, credentialContexts))].filter(uniqueGapQueueRow)
  const credentialValidatedQueue = normalizedCredentialRows.filter((row) => row.activationState === 'configured-live-validated')
  const credentialActivationQueue = normalizedCredentialRows.filter((row) => row.activationState !== 'configured-live-validated')
  const policyDisabledQueue = [
    ...(resolvedEvidence?.policyDisabledQueue ?? []).map((row) => normalizeProviderGapQueueRow(row, credentialContexts)),
    ...buildContractGapQueue(rows)
      .map((row) => normalizeProviderGapQueueRow(row, credentialContexts))
      .filter(isPolicyDisabledGapRow),
  ].filter(uniqueGapQueueRow)
  const separatedKeys = new Set([...credentialActivationQueue, ...policyDisabledQueue].map(gapQueueKey))
  const providerGapQueue = [
    ...(resolvedEvidence?.providerGapQueue ?? []).map((row) => normalizeProviderGapQueueRow(row, credentialContexts)),
    ...buildContractGapQueue(rows)
      .map((row) => normalizeProviderGapQueueRow(row, credentialContexts))
      .filter((row) => !isPolicyDisabledGapRow(row) && !separatedKeys.has(gapQueueKey(row))),
  ].filter(uniqueGapQueueRow)
  const failureActionQueue = [
    ...(resolvedEvidence?.failureActionQueue ?? []),
    ...buildRecentFailureQueue(rows, providerRows),
  ].map((row) => enrichFailureQueueRow(row, rows)).filter(uniqueFailureQueueRow)

  return {
    summary: {
      interfaces: rows.length,
      ready: rows.filter((row) => row.health === 'ready').length,
      attention: rows.filter((row) => row.health === 'attention').length,
      gaps: rows.filter((row) => row.health === 'gap').length,
      recentFailures: rows.reduce((sum, row) => sum + row.recentFailures, 0),
      providerGapRows: providerGapQueue.length,
      credentialActivationRows: credentialActivationQueue.length,
      credentialValidatedRows: credentialValidatedQueue.length,
      policyDisabledRows: Number(resolvedEvidence?.summary?.policyDisabledRows ?? policyDisabledQueue.length),
      providerGapLiveObserved: Number(resolvedEvidence?.summary?.providerGapLiveObserved ?? providerGapQueue.filter((row) => row.liveStatus === 'passed').length),
      providerGapLiveFailedOrBlocked: Number(resolvedEvidence?.summary?.providerGapLiveFailedOrBlocked ?? providerGapQueue.filter((row) => row.liveStatus && row.liveStatus !== 'passed').length),
      credentialActivationLiveObserved: Number(resolvedEvidence?.summary?.credentialActivationLiveObserved ?? credentialActivationQueue.filter((row) => row.liveStatus === 'passed').length),
      providerGapClassCounts: countBy(providerGapQueue.map((row) => row.gapClass ?? 'unknown')),
      credentialActivationClassCounts: resolvedEvidence?.summary?.credentialActivationClassCounts ?? countBy(credentialActivationQueue.map((row) => row.gapClass ?? 'unknown')),
      policyDisabledClassCounts: resolvedEvidence?.summary?.policyDisabledClassCounts ?? countBy(policyDisabledQueue.map((row) => row.gapClass ?? 'unknown')),
      providers,
      liveStatusRows: Number(resolvedEvidence?.summary?.liveStatusRows ?? 0),
      liveStatusPassed: Number(resolvedEvidence?.summary?.liveStatusPassed ?? 0),
      liveStatusFailedOrBlocked: Number(resolvedEvidence?.summary?.liveStatusFailedOrBlocked ?? 0),
      liveProbeBacklogRows: Number(resolvedEvidence?.summary?.liveProbeBacklogRows ?? 0),
      datasets: Number(resolvedEvidence?.summary?.datasets ?? resolvedEvidence?.datasetHealth?.length ?? 0),
      evidenceGeneratedAt: resolvedEvidence?.generatedAt ?? null,
    },
    runtimeLiveStatusReport,
    providerRows,
    datasetRows: resolvedEvidence?.datasetHealth ?? [],
    providerGapQueue,
    credentialActivationQueue,
    credentialValidatedQueue,
    policyDisabledQueue,
    failureActionQueue,
    rows,
  }
}

export function runtimeRouteDecisionForCapability(
  health: DataInterfaceHealth,
  interfaceId: string,
  capability: DataApiProviderCapability,
  constraint: Pick<DataApiProviderConstraint, 'allowDegraded' | 'providerMode'> = {},
): RuntimeCapabilityRouteDecision {
  const queueRow = findCapabilityQueueRow(health, interfaceId, capability)
  const failureRow = findCapabilityFailureRow(health, interfaceId, capability)
  const liveStatusRow = findCapabilityRuntimeLiveStatusRow(health, capability)
  const evidenceStatus = liveStatusRow?.status ?? queueRow?.liveStatus ?? failureRow?.status ?? null
  const liveValidationState = liveStatusRow?.validationState ?? queueRow?.liveValidationState ?? failureRow?.validationState ?? null
  const liveFailureClass = liveStatusRow?.failureClass ?? queueRow?.liveFailureClass ?? failureRow?.failureClass ?? null
  const routeBlockScope = liveStatusRow?.routeBlockScope ?? null
  const temporaryBlockUntil = transientBlockUntil(liveStatusRow, health.runtimeLiveStatusReport?.generatedAt)
  const allowDegraded = constraint.allowDegraded === true

  if (capability.status === 'disabled' || queueRow?.gapClass === 'policy-disabled') {
    return blockedDecision(
      capability,
      'blocked-policy',
      queueRow?.nextAction ?? capability.reason ?? 'Provider capability is policy-disabled for normal workflow.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      null,
      routeBlockScope,
    )
  }

  switch (queueRow?.activationState) {
    case 'credential-missing':
      return blockedDecision(
        capability,
        'blocked-credential-missing',
        queueRow.nextAction ?? 'Required credential is missing; do not route normal workflow here.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        null,
        routeBlockScope,
      )
    case 'configured-awaiting-validation':
      return blockedDecision(
        capability,
        'blocked-awaiting-validation',
        queueRow.nextAction ?? 'Credential exists but live validation has not completed; keep cache/readback first.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        null,
        routeBlockScope,
      )
    case 'configured-provider-blocked':
      return blockedDecision(
        capability,
        'blocked-provider-permission',
        queueRow.nextAction ?? 'Provider rejected credential or entitlement; do not use this route for normal workflow.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        null,
        routeBlockScope,
      )
    case 'configured-quota-blocked':
      return blockedDecision(
        capability,
        'blocked-quota',
        queueRow.nextAction ?? 'Provider quota or entitlement is blocking live use; keep cache/readback first.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        null,
        routeBlockScope,
      )
    case 'configured-validation-failed':
      return blockedDecision(
        capability,
        'blocked-runtime',
        queueRow.nextAction ?? 'Live validation failed; classify and repair the provider path before normal routing.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        null,
        routeBlockScope,
      )
    case 'configured-live-validated':
      return allowedDecision(
        capability,
        'validated',
        queueRow.nextAction ?? 'Live schema has been validated for this configured provider capability.',
        evidenceStatus ?? 'passed',
        liveValidationState ?? 'configured-live-validated',
        liveFailureClass,
        null,
        routeBlockScope,
        0,
      )
  }

  if (liveFailureClass === 'credential-or-permission') {
    return blockedDecision(
      capability,
      'blocked-provider-permission',
      failureRow?.nextAction ?? queueRow?.nextAction ?? 'Recent runtime evidence shows provider permission failure; stop normal routing here.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      null,
      routeBlockScope,
    )
  }
  if (liveFailureClass === 'quota-or-rate-limit') {
    return blockedDecision(
      capability,
      'blocked-quota',
      failureRow?.nextAction ?? queueRow?.nextAction ?? 'Recent runtime evidence shows quota or rate-limit blocking; stop broad retries.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      null,
      routeBlockScope,
    )
  }
  if (liveFailureClass === 'runtime-blocked' || liveFailureClass === 'schema-or-contract') {
    return blockedDecision(
      capability,
      'blocked-runtime',
      failureRow?.nextAction ?? queueRow?.nextAction ?? 'Recent runtime evidence marks this capability blocked; do not treat it as ready.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      null,
      routeBlockScope,
    )
  }
  if (liveFailureClass === 'transport' || liveFailureClass === 'timeout' || queueRow?.gapClass === 'serial-live-retry') {
    if (temporaryBlockUntil && Date.parse(temporaryBlockUntil) <= Date.now()) {
      return allowedDecision(
        capability,
        'allowed-unvalidated',
        `Previous transient runtime block expired at ${temporaryBlockUntil}; route may be retried through bounded provider routing or runtime_probe.`,
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        temporaryBlockUntil,
        routeBlockScope,
        1,
      )
    }
    if (allowDegraded) {
      return allowedDecision(
        capability,
        'degraded-allowed',
        temporaryBlockUntil
          ? `Transient provider block is active until ${temporaryBlockUntil}; degraded routing is explicitly allowed.`
          : queueRow?.nextAction ?? failureRow?.nextAction ?? 'Recent runtime evidence shows transport instability; degraded routing is explicitly allowed.',
        evidenceStatus,
        liveValidationState,
        liveFailureClass,
        temporaryBlockUntil,
        routeBlockScope,
        2,
      )
    }
    return blockedDecision(
      capability,
      temporaryBlockUntil ? 'temporarily-blocked' : 'blocked-transport',
      temporaryBlockUntil
        ? `Transient provider block is active until ${temporaryBlockUntil}; use cache/readback or fallback providers before retrying.`
        : queueRow?.nextAction ?? failureRow?.nextAction ?? 'Recent runtime evidence shows transport instability; keep retry narrow and avoid normal routing.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      temporaryBlockUntil,
      routeBlockScope,
    )
  }

  if (evidenceStatus === 'passed' && (liveValidationState === 'valid-schema-observed' || liveValidationState === 'configured-live-validated')) {
    return allowedDecision(
      capability,
      'validated',
      queueRow?.nextAction ?? failureRow?.nextAction ?? 'Recent runtime evidence validated this provider capability.',
      evidenceStatus,
      liveValidationState,
      liveFailureClass,
      null,
      routeBlockScope,
      0,
    )
  }

  return allowedDecision(
    capability,
    'allowed-unvalidated',
    'No blocking runtime evidence is recorded for this capability; treat it as available but prefer validated providers when possible.',
    evidenceStatus,
    liveValidationState,
    liveFailureClass,
    null,
    routeBlockScope,
    1,
  )
}

export function runtimeEligibleCapabilitiesForInterface(
  health: DataInterfaceHealth,
  interfaceId: string,
  capabilities: DataApiProviderCapability[],
  constraint: Pick<DataApiProviderConstraint, 'allowDegraded' | 'providerMode'> = {},
): Array<{ capability: DataApiProviderCapability; decision: RuntimeCapabilityRouteDecision }> {
  return capabilities
    .map((capability) => ({
      capability,
      decision: runtimeRouteDecisionForCapability(health, interfaceId, capability, constraint),
    }))
    .filter((item) => item.decision.eligible)
    .sort((left, right) => {
      if (left.decision.sortRank !== right.decision.sortRank) {
        return left.decision.sortRank - right.decision.sortRank
      }
      return (left.capability.priority ?? 999) - (right.capability.priority ?? 999)
    })
}

function blockedDecision(
  capability: DataApiProviderCapability,
  routeState: RuntimeCapabilityRouteDecision['routeState'],
  reason: string,
  evidenceStatus: string | null,
  liveValidationState: string | null,
  liveFailureClass: string | null,
  temporaryBlockUntil: string | null,
  routeBlockScope: string | null,
): RuntimeCapabilityRouteDecision {
  return {
    capabilityId: capability.id,
    provider: capability.provider,
    routeState,
    eligible: false,
    reason,
    evidenceStatus,
    liveValidationState,
    liveFailureClass,
    temporaryBlockUntil,
    routeBlockScope,
    sortRank: 9,
  }
}

function allowedDecision(
  capability: DataApiProviderCapability,
  routeState: RuntimeCapabilityRouteDecision['routeState'],
  reason: string,
  evidenceStatus: string | null,
  liveValidationState: string | null,
  liveFailureClass: string | null,
  temporaryBlockUntil: string | null,
  routeBlockScope: string | null,
  sortRank: number,
): RuntimeCapabilityRouteDecision {
  return {
    capabilityId: capability.id,
    provider: capability.provider,
    routeState,
    eligible: true,
    reason,
    evidenceStatus,
    liveValidationState,
    liveFailureClass,
    temporaryBlockUntil,
    routeBlockScope,
    sortRank,
  }
}

function transientBlockUntil(row: RuntimeLiveStatusRow | undefined, generatedAt?: string | null): string | null {
  if (!row) return null
  if (typeof row.temporaryBlockUntil === 'string' && row.temporaryBlockUntil.trim()) {
    return row.temporaryBlockUntil
  }
  const failureClass = String(row.failureClass ?? '').toLowerCase()
  if (failureClass !== 'transport' && failureClass !== 'timeout') return null
  const baseMs = Date.parse(String(generatedAt ?? ''))
  if (!Number.isFinite(baseMs)) return null
  const ttlMs = failureClass === 'timeout' ? 15 * 60 * 1000 : 30 * 60 * 1000
  return new Date(baseMs + ttlMs).toISOString()
}

function findCapabilityQueueRow(
  health: DataInterfaceHealth,
  interfaceId: string,
  capability: DataApiProviderCapability,
): DataProviderGapQueueRow | undefined {
  return [
    ...health.providerGapQueue,
    ...health.credentialActivationQueue,
    ...health.policyDisabledQueue,
  ].find((row) =>
    row.interfaceId === interfaceId &&
    row.provider === capability.provider &&
    (row.capabilityId == null || row.capabilityId === capability.id))
}

function findCapabilityFailureRow(
  health: DataInterfaceHealth,
  interfaceId: string,
  capability: DataApiProviderCapability,
): DataFailureActionQueueRow | undefined {
  return health.failureActionQueue.find((row) => {
    if (capability.probeId && row.probeId === capability.probeId) return true
    if (row.capabilityId && row.capabilityId === capability.id) return true
    return (row.affectedCapabilities ?? []).some((affected) =>
      affected.interfaceId === interfaceId &&
      affected.capabilityId === capability.id)
  })
}

function findCapabilityRuntimeLiveStatusRow(
  health: DataInterfaceHealth,
  capability: DataApiProviderCapability,
): RuntimeLiveStatusRow | undefined {
  return [
    ...(health.runtimeLiveStatusReport?.passedApis ?? []),
    ...(health.runtimeLiveStatusReport?.failures ?? []),
  ].find((row) =>
    (capability.probeId && row.id === capability.probeId) ||
    row.capabilityId === capability.id)
}

function gapQueueKey(row: DataProviderGapQueueRow): string {
  return `${row.interfaceId}|${row.provider}|${row.status}`
}

function implicitNotSupportedReason(provider: string, interfaceId: string): string {
  return `No ${provider} provider capability is registered for ${interfaceId}; keep this implicit not-supported provider out of routing unless a provider-specific adapter, normalizer, canonical persistence, readback, and evidence are added.`
}

function isPolicyDisabledGapRow(row: DataProviderGapQueueRow): boolean {
  return row.status === 'disabled' && row.gapClass === 'policy-disabled'
}

function uniqueGapQueueRow(row: DataProviderGapQueueRow, index: number, rows: DataProviderGapQueueRow[]): boolean {
  const key = `${row.interfaceId}|${row.provider}|${row.capabilityId ?? ''}|${row.status}`
  return rows.findIndex((candidate) => `${candidate.interfaceId}|${candidate.provider}|${candidate.capabilityId ?? ''}|${candidate.status}` === key) === index
}

function normalizeProviderGapQueueRow(row: DataProviderGapQueueRow, credentialContexts: Map<string, CredentialContext>): DataProviderGapQueueRow {
  const routeImplementationRequired = typeof row.routeImplementationRequired === 'boolean'
    ? row.routeImplementationRequired
    : row.status === 'output-only' && ['missing-requirement-route', 'missing-canonical-shape'].includes(row.routeWiringStatus ?? '')
  const gapClass = row.gapClass ?? capabilityGapClass(row.status ?? 'unknown', row.routeWiringStatus ?? null, routeImplementationRequired)
  const activation = resolveActivationState(row, credentialContexts)
  return {
    id: row.id ?? (row.interfaceId && row.provider ? `gap:${row.interfaceId}:${row.provider}` : undefined),
    ...row,
    routeImplementationRequired,
    gapClass,
    actionPriority: typeof row.actionPriority === 'number' ? row.actionPriority : capabilityGapActionPriority(gapClass),
    activationState: activation.state,
    activationLabel: activation.label,
    cacheDecision: row.cacheDecision ?? gapCacheDecision(gapClass, row.status ?? 'unknown'),
    nextAction: activation.nextAction ?? row.nextAction,
  }
}

type CredentialContext = { configured: boolean; keyName: string | null }

function loadCredentialContexts(): Map<string, CredentialContext> {
  const contexts = new Map<string, CredentialContext>()
  const keyByProvider: Record<string, string> = {
    wind: 'WIND_API_KEY',
    tushare: 'TUSHARE_TOKEN',
  }
  let apiKeys: Record<string, string> = {}
  try {
    const configPath = resolve(homedir(), '.finagent-workstation', 'config.json')
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as { apiKeys?: Record<string, string> }
      apiKeys = raw.apiKeys ?? {}
    }
  } catch {
    apiKeys = {}
  }
  for (const [provider, keyName] of Object.entries(keyByProvider)) {
    contexts.set(provider, { configured: Boolean(apiKeys[keyName]), keyName })
  }
  return contexts
}

function resolveActivationState(
  row: DataProviderGapQueueRow,
  credentialContexts: Map<string, CredentialContext>,
): { state: string | null; label: string | null; nextAction: string | null } {
  if (row.status !== 'credential-gated' && row.status !== 'quota-gated') {
    return { state: null, label: null, nextAction: row.nextAction ?? null }
  }
  const context = credentialContexts.get(normalizeProviderKey(row.provider) ?? row.provider)
  const configured = context?.configured ?? false
  const liveFailure = row.liveFailureClass ?? null
  const liveValidation = row.liveValidationState ?? null
  const observedValid = row.liveStatus === 'passed' && liveValidation === 'valid-schema-observed'
  if (!configured) {
    return {
      state: 'credential-missing',
      label: context?.keyName ? `missing ${context.keyName}` : 'credential missing',
      nextAction: context?.keyName
        ? `Configure ${context.keyName}, then run a serial live probe and readback verification.`
        : 'Configure the required credential, then run a serial live probe and readback verification.',
    }
  }
  if (liveFailure === 'quota-or-rate-limit' || liveValidation === 'quota-gated' || row.status === 'quota-gated') {
    return {
      state: 'configured-quota-blocked',
      label: 'configured, quota/entitlement blocked',
      nextAction: 'Credential is configured. Stop broad retries and use cache/readback or fallback until quota or entitlement is available.',
    }
  }
  if (liveFailure === 'credential-or-permission' || liveValidation === 'credential-gated') {
    return {
      state: 'configured-provider-blocked',
      label: 'configured, provider rejected credential/permission',
      nextAction: 'Credential is configured, but provider permission/entitlement is blocking live use. Keep cache/readback first and fix provider-side access.',
    }
  }
  if (observedValid) {
    return {
      state: 'configured-live-validated',
      label: 'configured, live-validated',
      nextAction: 'Configured environment has already observed valid live schema. Do not keep this in the activation queue; keep provenance visible in the matrix and interface view.',
    }
  }
  if (row.liveStatus && row.liveStatus !== 'passed') {
    return {
      state: 'configured-validation-failed',
      label: 'configured, validation failed',
      nextAction: 'Credential is configured, but live validation did not pass. Classify the provider-side failure before enabling normal routing.',
    }
  }
  return {
    state: 'configured-awaiting-validation',
    label: 'configured, awaiting live validation',
    nextAction: 'Credential is configured. Run a serial live probe and readback verification before treating this capability as live-usable.',
  }
}

function uniqueFailureQueueRow(row: DataFailureActionQueueRow, index: number, rows: DataFailureActionQueueRow[]): boolean {
  const key = `${row.probeId ?? ''}|${row.provider ?? ''}|${row.family ?? ''}|${row.failureClass ?? ''}|${row.error ?? ''}`
  return rows.findIndex((candidate) => `${candidate.probeId ?? ''}|${candidate.provider ?? ''}|${candidate.family ?? ''}|${candidate.failureClass ?? ''}|${candidate.error ?? ''}` === key) === index
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1
    return acc
  }, {})
}

function buildContractGapQueue(rows: DataInterfaceHealthRow[]): DataProviderGapQueueRow[] {
  return rows.flatMap((row) => row.capabilities
    .filter((capability) => capability.status !== 'supported' && capability.status !== 'global-only' && capability.status !== 'not-supported')
    .map((capability) => {
      const routeWiringStatus = capabilityRouteWiringStatus(capability)
      const routeImplementationRequired = capability.status === 'output-only' && ['missing-requirement-route', 'missing-canonical-shape'].includes(routeWiringStatus ?? '')
      const gapClass = capabilityGapClass(capability.status, routeWiringStatus, routeImplementationRequired)
      return {
        id: `gap:${row.interfaceId}:${capability.provider}`,
        interfaceId: row.interfaceId,
        category: row.category ?? undefined,
        chinesePurpose: row.chinesePurpose ?? undefined,
        canonicalSchema: row.canonicalSchema,
        provider: capability.provider,
        status: capability.status,
        capabilityId: capability.capabilityId,
        adapter: capability.adapter,
        normalizer: capability.normalizer,
        canonicalTable: capability.canonicalTable,
        probeId: capability.probeId,
        reusableShape: Boolean(capability.normalizer && capability.canonicalTable),
        routeWiringStatus,
        routeImplementationRequired,
        gapClass,
        actionPriority: capabilityGapActionPriority(gapClass),
        promotionCandidate: capability.status === 'output-only' && Boolean(capability.normalizer && capability.canonicalTable) && routeWiringStatus === 'route-ready-or-unverified',
        cacheDecision: gapCacheDecision(gapClass, capability.status),
        nextAction: capability.nextAction,
        reason: capability.reason,
      }
    }))
}

function capabilityRouteWiringStatus(capability: DataInterfaceHealthCapability): string | null {
  if (capability.status !== 'output-only') return 'blocked-or-not-supported'
  const reason = String(capability.reason ?? '').toLowerCase()
  if (
    reason.includes('not equivalent') ||
    reason.includes('empty compatibility payload') ||
    reason.includes('category-scoped') ||
    reason.includes('symbol/name scoped') ||
    reason.includes('ranking/indicator scoped')
  ) {
    return 'non-equivalent-wrapper'
  }
  if (
    reason.includes('requirement-level') ||
    reason.includes('not wired') ||
    reason.includes('does not route') ||
    reason.includes('diagnostic/ingestion') ||
    reason.includes('normalizer/readback is not registered')
  ) {
    return 'missing-requirement-route'
  }
  if (reason.includes('separate normalizer/readback contract')) return 'missing-canonical-shape'
  if (capability.normalizer && capability.canonicalTable) return 'route-ready-or-unverified'
  return 'missing-canonical-shape'
}

function capabilityGapClass(status: string, routeWiringStatus: string | null, routeImplementationRequired: boolean): string {
  if (status === 'transport-unstable') return 'serial-live-retry'
  if (status === 'credential-gated' || status === 'quota-gated') return 'credential-or-quota-required'
  if (status === 'disabled') return 'policy-disabled'
  if (status === 'output-only' && routeWiringStatus === 'non-equivalent-wrapper') return 'non-equivalent-output-only'
  if (status === 'output-only' && routeImplementationRequired) return 'route-implementation-required'
  if (status === 'output-only') return 'output-only-review'
  return 'capability-gap'
}

function capabilityGapActionPriority(gapClass: string): number {
  const priorities: Record<string, number> = {
    'serial-live-retry': 1,
    'route-implementation-required': 1,
    'credential-or-quota-required': 2,
    'output-only-review': 3,
    'non-equivalent-output-only': 4,
    'policy-disabled': 5,
    'capability-gap': 9,
  }
  return priorities[gapClass] ?? 9
}

function buildRecentFailureQueue(rows: DataInterfaceHealthRow[], providers: DataProviderHealthRow[]): DataFailureActionQueueRow[] {
  const interfaceFailures = rows
    .filter((row) => row.recentFailures > 0)
    .map((row) => {
      const affectedCapabilities = affectedCapabilitiesForInterface(row)
      return {
        id: `failure:${row.interfaceId}`,
        probeId: row.interfaceId,
        provider: null,
        family: row.interfaceId,
        status: 'recent-failure',
        validationState: row.health,
        failureClass: row.lastFailureClass,
        affectedInterfaces: [row.interfaceId],
        affectedCapabilities,
        capabilityId: affectedCapabilities[0]?.capabilityId ?? null,
        canonicalSchema: row.canonicalSchema,
        canonicalTable: row.tables[0] ?? null,
        readbackAction: row.queryActions[0] ?? null,
        readbackActions: row.queryActions,
        nextAction: row.nextAction,
        reason: failureReason(row.lastFailureClass, row.health, row.interfaceId, null),
        recoveryPolicy: failureRecoveryPolicy(row.lastFailureClass, row.health, row.queryActions[0] ?? null),
        retryPolicy: failureRetryPolicy(row.lastFailureClass, row.health),
        cacheDecision: failureCacheDecision(row.lastFailureClass, row.health, row.queryActions[0] ?? null),
        error: row.lastFailure,
      }
    })
  const providerFailures = providers
    .filter((row) => row.recentFailures > 0)
    .map((row) => ({
      id: `failure:provider:${row.provider}`,
      probeId: `provider:${row.provider}`,
      provider: row.provider,
      family: 'provider',
      status: 'recent-failure',
      validationState: row.health,
      failureClass: row.lastFailureClass,
      affectedInterfaces: interfacesForProvider(rows, row.provider),
      affectedCapabilities: affectedCapabilitiesForProvider(rows, row.provider),
      nextAction: row.nextAction,
      reason: failureReason(row.lastFailureClass, row.health, `provider:${row.provider}`, row.provider),
      recoveryPolicy: failureRecoveryPolicy(row.lastFailureClass, row.health, null),
      retryPolicy: failureRetryPolicy(row.lastFailureClass, row.health),
      cacheDecision: failureCacheDecision(row.lastFailureClass, row.health, null),
      error: row.lastFailure,
    }))
  return [...interfaceFailures, ...providerFailures]
}

function enrichFailureQueueRow(row: DataFailureActionQueueRow, rows: DataInterfaceHealthRow[]): DataFailureActionQueueRow {
  const affectedCapabilities = row.affectedCapabilities?.length
    ? row.affectedCapabilities
    : row.provider
      ? affectedCapabilitiesForProvider(rows, row.provider)
      : affectedCapabilitiesForInterfaces(rows, row.affectedInterfaces ?? [])
  const primaryInterfaceId = row.interfaceId ??
    row.affectedInterfaces?.[0] ??
    affectedCapabilities[0]?.interfaceId ??
    null
  const firstInterface = rows.find((candidate) => candidate.interfaceId === primaryInterfaceId)
  const recoveryPolicy = row.recoveryPolicy ?? failureRecoveryPolicy(
    row.failureClass ?? null,
    row.validationState ?? null,
    row.readbackAction ?? firstInterface?.queryActions[0] ?? affectedCapabilities[0]?.readbackAction ?? null,
  )
  return {
    ...row,
    interfaceId: primaryInterfaceId,
    affectedCapabilities,
    capabilityId: row.capabilityId ?? affectedCapabilities[0]?.capabilityId ?? null,
    canonicalSchema: row.canonicalSchema ?? firstInterface?.canonicalSchema ?? affectedCapabilities[0]?.canonicalSchema ?? null,
    canonicalTable: row.canonicalTable ?? firstInterface?.tables[0] ?? affectedCapabilities[0]?.canonicalTable ?? null,
    readbackAction: row.readbackAction ?? firstInterface?.queryActions[0] ?? affectedCapabilities[0]?.readbackAction ?? null,
    readbackActions: row.readbackActions ?? firstInterface?.queryActions ?? affectedCapabilities[0]?.readbackActions,
    reason: row.reason ?? failureReason(row.failureClass ?? null, row.validationState ?? null, row.probeId ?? row.family ?? row.id ?? 'provider failure', row.provider ?? null),
    recoveryPolicy,
    retryPolicy: row.retryPolicy ?? failureRetryPolicy(row.failureClass ?? null, row.validationState ?? null),
    cacheDecision: row.cacheDecision ?? failureCacheDecision(
      row.failureClass ?? null,
      row.validationState ?? null,
      row.readbackAction ?? firstInterface?.queryActions[0] ?? affectedCapabilities[0]?.readbackAction ?? null,
    ),
    nextAction: row.nextAction ?? recoveryPolicy,
    presenceReason: row.presenceReason ?? failurePresenceReason(
      row.failureClass ?? null,
      row.validationState ?? null,
      row.probeId ?? row.family ?? row.id ?? 'provider failure',
      row.provider ?? null,
      row.error ?? null,
    ),
    exitCondition: row.exitCondition ?? failureExitCondition(row.failureClass ?? null, row.validationState ?? null),
  }
}

function failureReason(failureClass: string | null | undefined, validationState: string | null | undefined, subject: string, provider: string | null): string {
  const source = provider ?? 'Provider'
  if (failureClass === 'auth_permission') return `${source} rejected ${subject} because the configured credential lacks endpoint entitlement or account permission.`
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return `${source} failed because credentials or provider permissions are not accepted for ${subject}.`
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return `${source} failed because quota or rate limit is exhausted for ${subject}.`
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return `${source} response did not satisfy the expected provider/interface contract for ${subject}.`
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return `${source} failed due to transport, timeout, or provider instability for ${subject}.`
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return `${source} runtime dependency is unavailable for ${subject}.`
  return `${source} failure requires classified triage before widening use for ${subject}.`
}

function failureRecoveryPolicy(failureClass: string | null | undefined, validationState: string | null | undefined, readbackAction: string | null): string {
  const cacheText = readbackAction ? ` Reuse ${readbackAction} cache when available.` : ''
  if (failureClass === 'auth_permission') return `Keep this provider capability gated; fix provider-side entitlement or account permission, then rerun only the bounded probe.${cacheText}`
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return `Keep provider gate active; fix credentials or provider permission before live refresh.${cacheText}`
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return `Stop broad provider collection until quota resets; prefer reusable cache and eligible fallback providers.${cacheText}`
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'Fix adapter/parser/normalizer contract before persisting additional rows.'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'Retry only with serial probes and provider-specific timeout after provider/network recovery.'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'Restore the runtime dependency before retrying the probe.'
  return 'Classify root cause, update provider evidence, and rerun focused verification before widening routing.'
}

function failureRetryPolicy(failureClass: string | null | undefined, validationState: string | null | undefined): string {
  if (failureClass === 'auth_permission') return 'no automatic retry until provider entitlement or permission changes'
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return 'no automatic retry until credential or permission changes'
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return 'no broad retry until quota reset; cache/readback first'
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'no retry until adapter or schema contract is fixed'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return 'serial retry only after provider/network recovery'
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return 'retry only after runtime dependency is restored'
  return 'manual triage required before retry'
}

function gapCacheDecision(gapClass: string, status: string): string {
  if (status === 'credential-gated' || status === 'quota-gated') {
    return 'Use existing cache/readback or eligible fallback providers first; do not call this provider live until credential/quota evidence is current.'
  }
  if (status === 'disabled') {
    return 'Do not use this provider capability for normal workflow or cache refresh while policy-disabled.'
  }
  if (status === 'transport-unstable') {
    return 'Keep cached data when available; retry only through bounded serial probe evidence before normal routing.'
  }
  if (status === 'output-only' && gapClass === 'route-implementation-required') {
    return 'Not eligible for canonical cache reuse yet; implement adapter, normalizer, persistence, and readback before normal workflow.'
  }
  if (status === 'output-only') {
    return 'Treat as bounded output-only evidence; do not assume reusable cache/readback until promoted or explicitly retained output-only.'
  }
  return 'Normal cache/readback behavior is not available until this capability is classified or implemented.'
}

function failureCacheDecision(
  failureClass: string | null | undefined,
  validationState: string | null | undefined,
  readbackAction: string | null,
): string {
  const cacheText = readbackAction ? ` Use ${readbackAction} readback if local data is fresh enough.` : ' Use local cache/readback or healthy fallback providers when available.'
  if (failureClass === 'auth_permission') return `Keep this provider out of live routing until entitlement changes.${cacheText}`
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') return `Keep provider gate active and avoid live refresh until credentials or permissions change.${cacheText}`
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') return `Do not spend more quota on broad retry; prefer cache/readback and fallback providers.${cacheText}`
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') return 'Do not persist or reuse new provider output until adapter, parser, normalizer, and readback contract are fixed.'
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') return `Preserve existing cached data; retry only with a bounded serial probe after provider/network recovery.${cacheText}`
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') return `Provider refresh is blocked by runtime dependency; use cache/readback until the dependency is restored.${cacheText}`
  return `Classify root cause before widening live routing.${cacheText}`
}

function failurePresenceReason(
  failureClass: string | null | undefined,
  validationState: string | null | undefined,
  subject: string,
  provider: string | null,
  error: string | null | undefined,
): string {
  if (error?.trim()) return error
  return failureReason(failureClass, validationState, subject, provider)
}

function failureExitCondition(failureClass: string | null | undefined, validationState: string | null | undefined): string {
  if (failureClass === 'auth_permission') {
    return 'Leaves this queue after endpoint entitlement or account permission changes are verified by the bounded probe, or after this provider capability is reclassified.'
  }
  if (failureClass === 'credential-or-permission' || validationState === 'credential-gated') {
    return 'Leaves this queue after credential or permission changes are verified by a bounded probe, or after the capability is reclassified as gated, disabled, unsupported, or supported.'
  }
  if (failureClass === 'quota-or-rate-limit' || validationState === 'quota-gated') {
    return 'Leaves this queue after quota availability is verified or the capability is reclassified with explicit quota policy.'
  }
  if (failureClass === 'schema-or-contract' || validationState === 'unsupported-by-provider') {
    return 'Leaves this queue after adapter/parser/normalizer contract is fixed and focused readback verification passes, or after the path is marked unsupported/diagnostic.'
  }
  if (failureClass === 'transport' || failureClass === 'timeout' || validationState === 'transport-or-provider-unstable') {
    return 'Leaves this queue after serial retry produces stable evidence or the provider is reclassified as unstable, disabled, unsupported, or gated.'
  }
  if (failureClass === 'runtime_unavailable' || validationState === 'runtime-blocked') {
    return 'Leaves this queue after the runtime dependency is restored and the registered probe is rerun successfully or reclassified.'
  }
  return 'Leaves this queue after root cause classification, provider evidence update, and focused verification.'
}

function interfacesForProvider(rows: DataInterfaceHealthRow[], provider: string): string[] {
  return rows
    .filter((row) => row.capabilities.some((capability) => capability.provider === provider && capability.status !== 'not-supported'))
    .map((row) => row.interfaceId)
    .sort()
}

function affectedCapabilitiesForInterfaces(rows: DataInterfaceHealthRow[], interfaceIds: string[]): DataFailureAffectedCapability[] {
  const wanted = new Set(interfaceIds)
  return rows
    .filter((row) => wanted.has(row.interfaceId))
    .flatMap(affectedCapabilitiesForInterface)
}

function affectedCapabilitiesForInterface(row: DataInterfaceHealthRow): DataFailureAffectedCapability[] {
  return row.capabilities
    .filter((capability) => capability.status !== 'not-supported')
    .map((capability) => affectedCapability(row, capability))
}

function affectedCapabilitiesForProvider(rows: DataInterfaceHealthRow[], provider: string): DataFailureAffectedCapability[] {
  return rows
    .flatMap((row) => row.capabilities
      .filter((capability) => capability.provider === provider && capability.status !== 'not-supported')
      .map((capability) => affectedCapability(row, capability)))
    .sort((a, b) => {
      const interfaceCompare = a.interfaceId.localeCompare(b.interfaceId)
      return interfaceCompare || a.capabilityId.localeCompare(b.capabilityId)
    })
}

function affectedCapability(row: DataInterfaceHealthRow, capability: DataInterfaceHealthCapability): DataFailureAffectedCapability {
  return {
    interfaceId: row.interfaceId,
    capabilityId: capability.capabilityId,
    provider: capability.provider,
    status: capability.status,
    canonicalSchema: row.canonicalSchema,
    canonicalTable: capability.canonicalTable ?? row.tables[0] ?? null,
    readbackAction: row.queryActions[0] ?? null,
    readbackActions: row.queryActions,
    normalizer: capability.normalizer,
  }
}

function tableCountMap(ds: DataStore | null): Map<string, number> {
  const stats = ds?.isReady ? ds.getStats() : { tables: [] as TableStat[] }
  return new Map(stats.tables.map((table) => [table.name, Number(table.count ?? 0)]))
}

function reusableMap(ds: DataStore | null): Map<string, ReusableRow> {
  if (!ds?.isReady) return new Map()
  return new Map(ds.getReusableDataSummary().map((row) => [row.name, row]))
}

function recentFailureMap(ds: DataStore | null): Map<string, { count: number; lastAt: string | null; lastError: string | null; lastFailureClass: string | null }> {
  if (!ds?.isReady) return new Map()
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const rows = ds.query<{ interface_id: string | null; count: number; last_at: string | null; last_error: string | null; last_failure_class: string | null }>(
    `SELECT log.interface_id, COUNT(*) AS count, MAX(log.created_at) AS last_at,
        (SELECT latest.error FROM api_call_log latest
          WHERE latest.interface_id = log.interface_id AND latest.created_at >= ? AND latest.success = 0
          ORDER BY latest.created_at DESC LIMIT 1) AS last_error,
        (SELECT latest.failure_class FROM api_call_log latest
          WHERE latest.interface_id = log.interface_id AND latest.created_at >= ? AND latest.success = 0
          ORDER BY latest.created_at DESC LIMIT 1) AS last_failure_class
      FROM api_call_log log
      WHERE log.created_at >= ? AND log.success = 0 AND log.interface_id IS NOT NULL
      GROUP BY log.interface_id`,
    cutoff,
    cutoff,
    cutoff,
  )
  return new Map(rows.filter((row) => row.interface_id).map((row) => [String(row.interface_id), {
    count: Number(row.count ?? 0),
    lastAt: row.last_at ?? null,
    lastError: row.last_error ?? null,
    lastFailureClass: row.last_failure_class ?? null,
  }]))
}

function recentProviderFailureMap(ds: DataStore | null): Map<string, { count: number; lastAt: string | null; lastError: string | null; lastFailureClass: string | null }> {
  if (!ds?.isReady) return new Map()
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const rows = ds.query<{ provider_key: string | null; count: number; last_at: string | null; last_error: string | null; last_failure_class: string | null }>(
    `SELECT COALESCE(log.provider, log.source) AS provider_key, COUNT(*) AS count, MAX(log.created_at) AS last_at,
        (SELECT latest.error FROM api_call_log latest
          WHERE COALESCE(latest.provider, latest.source) = COALESCE(log.provider, log.source)
            AND latest.created_at >= ? AND latest.success = 0
          ORDER BY latest.created_at DESC LIMIT 1) AS last_error,
        (SELECT latest.failure_class FROM api_call_log latest
          WHERE COALESCE(latest.provider, latest.source) = COALESCE(log.provider, log.source)
            AND latest.created_at >= ? AND latest.success = 0
          ORDER BY latest.created_at DESC LIMIT 1) AS last_failure_class
      FROM api_call_log log
      WHERE log.created_at >= ? AND log.success = 0 AND COALESCE(log.provider, log.source) IS NOT NULL
      GROUP BY provider_key`,
    cutoff,
    cutoff,
    cutoff,
  )
  const out = new Map<string, { count: number; lastAt: string | null; lastError: string | null; lastFailureClass: string | null }>()
  for (const row of rows) {
    const provider = normalizeProviderKey(row.provider_key)
    if (!provider) continue
    const existing = out.get(provider)
    const count = Number(row.count ?? 0)
    out.set(provider, {
      count: (existing?.count ?? 0) + count,
      lastAt: latestOf([existing?.lastAt, row.last_at]),
      lastError: row.last_error ?? existing?.lastError ?? null,
      lastFailureClass: row.last_failure_class ?? existing?.lastFailureClass ?? null,
    })
  }
  return out
}

function buildProviderRows(
  rows: DataInterfaceHealthRow[],
  providers: DataApiProvider[],
  failures: Map<string, { count: number; lastAt: string | null; lastError: string | null; lastFailureClass: string | null }>,
  evidence: FinanceDataHealthEvidence | null,
): DataProviderHealthRow[] {
  const providerEvidence = new Map((evidence?.providerHealth ?? []).map((row) => [normalizeProviderKey(row.provider) ?? row.provider, row]))
  const liveEvidence = new Map((evidence?.liveProviderHealth ?? []).map((row) => [normalizeProviderKey(row.provider) ?? row.provider, row]))
  return providers.map((provider) => {
    let supported = 0
    let gated = 0
    let outputOnly = 0
    let unstable = 0
    let disabled = 0
    let notSupported = 0
    for (const row of rows) {
      const status = row.providerStatuses[provider]
      if (status === 'supported' || status === 'global-only') supported += 1
      else if (status === 'credential-gated' || status === 'quota-gated') gated += 1
      else if (status === 'output-only') outputOnly += 1
      else if (status === 'transport-unstable') unstable += 1
      else if (status === 'disabled') disabled += 1
      else notSupported += 1
    }
    const failure = failures.get(provider)
    const matrixProvider = providerEvidence.get(provider)
    const liveProvider = liveEvidence.get(provider)
    const lastFailureClass = failure?.lastFailureClass ?? null
    const health = failure?.count || unstable > 0
      ? 'attention'
      : supported > 0
        ? 'ready'
        : 'gap'
    return {
      provider,
      supported,
      gated,
      outputOnly,
      unstable,
      disabled,
      notSupported,
      recentFailures: failure?.count ?? 0,
      lastFailureAt: failure?.lastAt ?? null,
      lastFailure: failure?.lastError ?? null,
      lastFailureClass,
      liveProbeCount: Number(matrixProvider?.liveProbeCount ?? liveProvider?.liveProbeCount ?? 0),
      livePassed: Number(liveProvider?.passed ?? 0),
      liveFailures: Number(matrixProvider?.liveFailures ?? liveProvider?.failures ?? 0),
      liveFailureClasses: matrixProvider?.liveFailureClasses ?? liveProvider?.failureClasses ?? {},
      nextAction: providerNextAction({
        provider,
        supported,
        gated,
        outputOnly,
        unstable,
        disabled,
        recentFailures: failure?.count ?? 0,
        lastFailureClass,
      }),
      health,
    }
  })
}

function capabilityNextAction(status: DataApiCapabilityStatus, reason: string | null): string {
  if (status === 'supported' || status === 'global-only') return 'Use interface route with cache/readback before provider refresh.'
  if (status === 'credential-gated' || status === 'quota-gated') return 'Configure credential/quota, then run serial live probe and readback verification.'
  if (status === 'output-only') return reason?.includes('normalizer') || reason?.includes('readback')
    ? 'Add provider normalizer, canonical persistence, and readback before marking supported.'
    : 'Evaluate whether this output-only capability has reusable business-data value.'
  if (status === 'transport-unstable') return 'Keep serial probes with conservative timeout; classify transport separately from schema failure.'
  if (status === 'disabled') return 'Do not route normal workflows here; fix policy/permission before enabling.'
  if (status === 'not-supported') return 'Leave explicit not-supported unless provider protocol can supply an equivalent dataset.'
  return 'Review capability classification.'
}

function interfaceNextAction(input: {
  failureClass: string | null
  cacheStatus: string
  supportedProviders: string[]
  gatedProviders: string[]
  outputOnlyProviders: string[]
  unstableProviders: string[]
  disabledProviders: string[]
  recentFailures: number
  credentialGateObserved?: boolean
}): string {
  if (input.recentFailures > 0) {
    if (input.failureClass === 'transport' || input.failureClass === 'timeout') return 'Inspect recent API failures; retry with serial probe and provider-specific timeout.'
    if (input.failureClass === 'credential-or-permission') return 'Stop retries and fix credentials or provider permission before live calls.'
    if (input.failureClass === 'quota-or-rate-limit') return 'Stop broad collection and use cache/fallback until quota resets.'
    if (input.failureClass === 'schema-or-contract') return 'Fix parser/normalizer contract before persisting more rows.'
    return 'Triage recent provider failure before relying on fallback data.'
  }
  if (input.cacheStatus !== 'implemented') return 'Implement cache/readback rule before treating this interface as reusable.'
  if (input.unstableProviders.length > 0) return 'Run serial live probes and classify transport instability before changing routing.'
  if (input.outputOnlyProviders.length > 0) return 'Review output-only provider gaps for normalizer/readback promotion.'
  if (input.gatedProviders.length > 0) {
    if (input.credentialGateObserved) return 'Credential-gated provider evidence exists; keep the gate visible, use cache/readback first, and require configured credentials before live refresh.'
    return 'Verify credential-gated providers with configured credentials and live probe evidence before enabling fallback.'
  }
  if (input.disabledProviders.length > 0) return 'Keep disabled providers out of normal routing until policy is fixed.'
  if (input.supportedProviders.length === 0) return 'Add at least one supported provider capability or keep interface unsupported.'
  return 'Ready for normal cache-first interface routing.'
}

function providerNextAction(input: {
  provider: string
  supported: number
  gated: number
  outputOnly: number
  unstable: number
  disabled: number
  recentFailures: number
  lastFailureClass: string | null
}): string {
  if (input.recentFailures > 0) {
    if (input.lastFailureClass === 'transport' || input.lastFailureClass === 'timeout') return 'Inspect recent provider failures and rerun only serial probes.'
    if (input.lastFailureClass === 'credential-or-permission') return 'Fix credentials/permission; do not retry broad provider calls.'
    if (input.lastFailureClass === 'quota-or-rate-limit') return 'Use cache/fallback until quota resets.'
    return 'Triage recent failures before expanding provider routing.'
  }
  if (input.unstable > 0) return 'Keep unstable capabilities isolated and validate with serial probes.'
  if (input.outputOnly > 0) return 'Promote high-value output-only capabilities only after normalizer/readback exists.'
  if (input.gated > 0) return 'Use credentials and quota checks before live validation.'
  if (input.disabled > 0) return 'Keep disabled capabilities out of normal workflows.'
  if (input.supported === 0) return 'Provider has no supported interfaces; keep it out of normal routing.'
  return 'Provider has supported governed interfaces.'
}

function normalizeProviderKey(value: string | null | undefined): string | null {
  if (!value) return null
  const provider = value.trim().toLowerCase()
  if (!provider) return null
  if (provider === 'yfinance') return 'yahoo'
  if (provider === 'eastmoney-direct') return 'eastmoney'
  if (provider.startsWith('akshare')) return 'akshare'
  if (provider.startsWith('tdx')) return 'tdx'
  return provider
}

function latestOf(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter(Boolean).sort()
  return sorted.length > 0 ? sorted[sorted.length - 1] ?? null : null
}

function uniqueSources(values: string[]): string | null {
  const sources = new Set<string>()
  for (const value of values) {
    for (const part of value.split(',')) {
      const source = part.trim()
      if (source) sources.add(source)
    }
  }
  return sources.size > 0 ? [...sources].sort().join(', ') : null
}
