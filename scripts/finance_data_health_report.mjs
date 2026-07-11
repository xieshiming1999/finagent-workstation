#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))
const mobileContractPath = resolve(repoRoot, '..', 'app/lib/domain/market/providers/data_api_interface_contract.dart')

const paths = {
  providerMatrix: 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
  detailedMatrix: 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json',
  liveProbeBacklog: 'reports/integrations/finance_live_probe_backlog_2026_06_18.json',
  liveStatusReport: 'reports/integrations/finance_live_status_report_2026_06_18.json',
  mobileStatus: 'reports/integrations/finance_mobile_api_status_2026_06_17.json',
}

const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_data_health_report_2026_06_18.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_data_health_report_2026_06_18.md')

const report = buildReport()

if (args['no-write'] !== 'true') {
  mkdirSync(resolve(jsonOut, '..'), { recursive: true })
  mkdirSync(resolve(mdOut, '..'), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance data health report: ${report.summary.interfaces} interfaces, ${report.summary.providers} providers, ${report.summary.datasets} datasets`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (args['fail-on-problem'] === 'true' && report.problems.length > 0) {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport() {
  const providerMatrix = readJson(paths.providerMatrix)
  const detailedMatrix = readJson(paths.detailedMatrix)
  const liveProbeBacklog = readJson(paths.liveProbeBacklog)
  const liveStatusReport = readJson(paths.liveStatusReport)
  const mobileStatus = readJson(paths.mobileStatus)
  const mobileContract = readMobileContract()
  const mobileInterfacesById = new Map(mobileContract.interfaces.map((item) => [item.id, item]))
  const mobileLiveRows = mobileStatusRows(mobileStatus)
  const mobileFailureRows = mobileLiveRows.filter((row) => row.status !== 'passed')
  const mobilePassedRows = mobileLiveRows.filter((row) => row.status === 'passed')
  const detailedRows = detailedMatrix.rows ?? []
  const backlogRows = liveProbeBacklog.rows ?? []
  const failureRows = [...(liveStatusReport.failures ?? []), ...mobileFailureRows]
  const failuresByProbeId = new Map(failureRows.map((row) => [row.id, row]))
  const passedLiveByProbeId = new Map([
    ...(liveStatusReport.passedApis ?? []),
    ...mobilePassedRows,
  ].filter((row) => row?.id).map((row) => [row.id, row]))

  const interfaces = (providerMatrix.rows ?? []).map((row) => {
    const unifiedProviders = mergeRuntimeProviders({
      providerColumns: providerMatrix.providerColumns ?? [],
      desktopProviders: row.providers ?? {},
      mobileInterface: mobileInterfacesById.get(row.interfaceId) ?? null,
    })
    const providerEntries = Object.entries(unifiedProviders)
    const statusCounts = countBy(providerEntries.map(([, value]) => value.status ?? 'unknown'))
    const supportedProviders = providerEntries
      .filter(([, value]) => value.status === 'supported' || value.status === 'global-only')
      .map(([provider]) => provider)
    const gatedProviders = providerEntries
      .filter(([, value]) => ['credential-gated', 'quota-gated', 'transport-unstable', 'disabled'].includes(value.status))
      .map(([provider, value]) => providerStatus(provider, value))
    const gapProviders = providerEntries
      .filter(([, value]) => ['output-only', 'not-supported'].includes(value.status))
      .map(([provider, value]) => providerStatus(provider, value))
    const probeIds = unique(providerEntries.map(([, value]) => value.probeId).filter(Boolean))
    const failures = probeIds.map((id) => failuresByProbeId.get(id)).filter(Boolean)
    const relatedDetailedRows = detailedRows.filter((item) => item.interfaceId === row.interfaceId)
    const relatedBacklogRows = backlogRows.filter((item) => item.interfaceId === row.interfaceId)
    const passedLiveRows = relatedDetailedRows.filter((item) => (item.probeSummary?.durablePassed ?? item.probeSummary?.passed ?? 0) > 0 || (item.liveStatusEvidence?.passed ?? 0) > 0)
    const relatedDetailedFailures = relatedDetailedRows.filter((item) => item.runtimeStatus === 'failed-or-blocked' || item.evidenceStatus === 'direct-live-non-pass')
    const combinedFailures = uniqueBy([
      ...failures.map((item) => ({
        probeId: item.id,
        provider: item.provider,
        validationState: item.validationState,
        failureClass: item.failureClass,
        error: item.error,
      })),
      ...relatedDetailedFailures.map((item) => ({
        probeId: item.liveStatusEvidence?.probeIds?.[0] ?? item.rowId,
        provider: item.provider,
        validationState: item.liveStatusEvidence?.lastValidationState ?? item.validationState,
        failureClass: item.liveStatusEvidence?.lastFailureClass ?? 'unknown',
        error: item.liveStatusEvidence?.lastError ?? null,
      })),
    ], (item) => item.probeId)
    const runtimeStatusCounts = countBy(relatedDetailedRows.map((item) => item.runtimeStatus ?? 'unknown'))
    const validationStateCounts = countBy(relatedDetailedRows.map((item) => item.validationState ?? 'unknown'))
    return {
      interfaceId: row.interfaceId,
      category: row.category,
      chinesePurpose: row.chinesePurpose,
      label: row.label,
      canonicalSchema: row.canonicalSchema,
      dataStoreTables: row.dataStoreTables ?? [],
      queryActions: row.queryActions ?? [],
      freshnessPolicy: row.freshnessPolicy,
      cacheStatus: row.cacheLookup?.status ?? 'unknown',
      cachePolicy: row.cacheLookup?.policy ?? null,
      supportedProviders,
      gatedProviders,
      gapProviders,
      providers: unifiedProviders,
      providerStatusCounts: statusCounts,
      runtimeStatusCounts,
      validationStateCounts,
      liveProbeIds: probeIds,
      liveProbeBacklog: relatedBacklogRows.length,
      passedLiveRows: passedLiveRows.length,
      failures: combinedFailures,
      healthState: interfaceHealthState({ failures: combinedFailures, relatedBacklogRows, passedLiveRows, statusCounts }),
      nextAction: interfaceNextAction({ failures: combinedFailures, relatedBacklogRows, statusCounts, providerEntries, passedLiveByProbeId, passedLiveRows }),
    }
  })

  const providerHealth = buildProviderHealth(providerMatrix.providerColumns ?? [], interfaces, liveProbeBacklog, liveStatusReport)
  const liveProviderHealth = buildLiveProviderHealth(liveStatusReport, mobileStatus)
  const datasetHealth = buildDatasetHealth(interfaces, detailedRows)
  const failureActionQueue = buildFailureActionQueue({ liveStatusReport, mobileStatus, interfaces, detailedRows })
  const { providerGapQueue, credentialActivationQueue, credentialValidatedQueue, policyDisabledQueue } = buildProviderGapQueues(providerMatrix, liveStatusReport)
  const problems = validateReport({ providerMatrix, detailedMatrix, liveProbeBacklog, liveStatusReport, mobileStatus, interfaces, providerHealth, liveProviderHealth, datasetHealth, failureActionQueue, providerGapQueue, credentialActivationQueue, credentialValidatedQueue, policyDisabledQueue })
  const interfaceHealthCounts = countBy(interfaces.map((item) => item.healthState))

  return {
    generatedAt: new Date().toISOString(),
    objective: 'Unified finance data health view for interface, provider, live-probe, cache/readback, and dataset provenance evidence.',
    source: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, resolve(repoRoot, value)])),
    summary: {
      interfaces: interfaces.length,
      providers: providerHealth.length,
      liveProviders: liveProviderHealth.length,
      datasets: datasetHealth.length,
      detailedRows: detailedMatrix.summary?.totalRows ?? 0,
      liveStatusRows: (liveStatusReport.summary?.total ?? 0) + mobileLiveRows.length,
      liveStatusPassed: (liveStatusReport.summary?.passed ?? 0) + mobilePassedRows.length,
      liveStatusFailedOrBlocked: (liveStatusReport.summary?.failed ?? 0) + (liveStatusReport.summary?.blocked ?? 0) + (liveStatusReport.summary?.timeout ?? 0) + mobileFailureRows.length,
      desktopLiveStatusRows: liveStatusReport.summary?.total ?? 0,
      mobileLiveStatusRows: mobileLiveRows.length,
      mobileLiveStatusPassed: mobilePassedRows.length,
      mobileNativeLiveFailed: mobileFailureRows.length,
      mobileRuntimeBlocked: mobileFailureRows.filter((row) => row.validationState === 'runtime-blocked').length,
      mobileTransportOrProviderUnstable: mobileFailureRows.filter((row) => row.validationState === 'transport-or-provider-unstable').length,
      liveProbeBacklogRows: liveProbeBacklog.summary?.totalBacklog ?? 0,
      failureActionRows: failureActionQueue.length,
      providerGapRows: providerGapQueue.length,
      credentialActivationRows: credentialActivationQueue.length,
      credentialValidatedRows: credentialValidatedQueue.length,
      policyDisabledRows: policyDisabledQueue.length,
      providerGapPromotionCandidates: providerGapQueue.filter((row) => row.promotionCandidate).length,
      providerGapSchemaKnownOutputOnly: providerGapQueue.filter((row) => row.status === 'output-only' && row.reusableShape).length,
      providerGapRouteImplementationRequired: providerGapQueue.filter((row) => row.routeImplementationRequired).length,
      providerGapNonEquivalentWrappers: providerGapQueue.filter((row) => row.routeWiringStatus === 'non-equivalent-wrapper').length,
      providerGapLiveObserved: providerGapQueue.filter((row) => row.liveStatus === 'passed').length,
      providerGapLiveFailedOrBlocked: providerGapQueue.filter((row) => row.liveStatus && row.liveStatus !== 'passed').length,
      credentialActivationLiveObserved: credentialActivationQueue.filter((row) => row.liveStatus === 'passed').length,
      credentialValidatedLiveObserved: credentialValidatedQueue.filter((row) => row.liveStatus === 'passed').length,
      policyDisabledClassCounts: countBy(policyDisabledQueue.map((row) => row.gapClass)),
      credentialActivationClassCounts: countBy(credentialActivationQueue.map((row) => row.gapClass)),
      providerGapClassCounts: countBy(providerGapQueue.map((row) => row.gapClass)),
      interfaceHealthCounts,
      providerStatusCounts: providerMatrix.summary?.statusCounts ?? {},
      problems: problems.length,
    },
    interfaceHealth: interfaces,
    providerHealth,
    liveProviderHealth,
    datasetHealth,
    failureActionQueue,
    providerGapQueue,
    credentialActivationQueue,
    credentialValidatedQueue,
    policyDisabledQueue,
    degradedInterfaces: interfaces.filter((item) => item.healthState === 'degraded'),
    backlogInterfaces: interfaces.filter((item) => item.healthState === 'needs-live-probe'),
    problems,
  }
}

function buildProviderGapQueues(providerMatrix, liveStatusReport) {
  const liveStatusByProbeId = new Map([
    ...(liveStatusReport.passedApis ?? []),
    ...(liveStatusReport.failures ?? []),
  ].filter((row) => row?.id).map((row) => [row.id, row]))
  const rows = []
  for (const item of providerMatrix.rows ?? []) {
    for (const [provider, capability] of Object.entries(item.providers ?? {})) {
      const status = capability?.status
      if (!['output-only', 'credential-gated', 'quota-gated', 'transport-unstable', 'disabled'].includes(status)) continue
      const hasReusableShape = Boolean(capability.normalizer && capability.canonicalTable)
      const routeWiringStatus = routeWiringStatusFor({ status, capability })
      const routeImplementationRequired = status === 'output-only' && ['missing-requirement-route', 'missing-canonical-shape'].includes(routeWiringStatus)
      const gapClass = providerGapClass({ status, routeWiringStatus, routeImplementationRequired })
      const liveStatus = capability.probeId ? liveStatusByProbeId.get(capability.probeId) : null
      rows.push({
        id: `gap:${item.interfaceId}:${provider}`,
        interfaceId: item.interfaceId,
        category: item.category,
        chinesePurpose: item.chinesePurpose,
        canonicalSchema: item.canonicalSchema,
        provider,
        status,
        capabilityId: capability.capabilityId,
        adapter: capability.adapter ?? null,
        normalizer: capability.normalizer ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        probeId: capability.probeId ?? null,
        liveStatus: liveStatus?.status ?? null,
        liveValidationState: liveStatus?.validationState ?? null,
        liveFailureClass: liveStatus?.failureClass || null,
        liveHttpStatus: liveStatus?.httpStatus ?? null,
        liveParsedCount: liveStatus?.parsedCount ?? null,
        liveDurationMs: liveStatus?.durationMs ?? null,
        liveProviderTime: liveStatus?.providerTime ?? null,
        liveError: liveStatus?.error || null,
        reusableShape: hasReusableShape,
        routeWiringStatus,
        routeImplementationRequired,
        gapClass,
        actionPriority: providerGapActionPriority(gapClass),
        promotionCandidate: status === 'output-only' && hasReusableShape && routeWiringStatus === 'route-ready-or-unverified',
        cacheDecision: providerGapCacheDecision({ status, gapClass }),
        nextAction: providerGapNextAction({ provider, status, capability, item, hasReusableShape, routeWiringStatus, liveStatus }),
        reason: capability.reason ?? null,
      })
    }
  }
  const credentialValidatedQueue = rows.filter((row) => isCredentialValidatedRow(row))
  const credentialActivationQueue = rows.filter((row) => isCredentialActivationRow(row) && !isCredentialValidatedRow(row))
  const policyDisabledQueue = rows.filter((row) => isPolicyDisabledRow(row))
  const providerGapQueue = rows.filter((row) => !isCredentialActivationRow(row) && !isPolicyDisabledRow(row))
  const rank = { 'transport-unstable': 0, 'credential-gated': 1, 'quota-gated': 2, 'output-only': 3, disabled: 4 }
  const sortRows = (items) => items.sort((a, b) => {
    const left = rank[a.status] ?? 9
    const right = rank[b.status] ?? 9
    if (left !== right) return left - right
    if (a.promotionCandidate !== b.promotionCandidate) return a.promotionCandidate ? -1 : 1
    return `${a.interfaceId}:${a.provider}`.localeCompare(`${b.interfaceId}:${b.provider}`)
  })
  return {
    providerGapQueue: sortRows(providerGapQueue),
    credentialActivationQueue: sortRows(credentialActivationQueue),
    credentialValidatedQueue: sortRows(credentialValidatedQueue),
    policyDisabledQueue: sortRows(policyDisabledQueue),
  }
}

function mergeRuntimeProviders({ providerColumns, desktopProviders, mobileInterface }) {
  const merged = Object.fromEntries(providerColumns.map((provider) => [provider, normalizeProviderCell(desktopProviders[provider] ?? {
    status: 'not-supported',
    capabilityId: null,
    adapter: null,
    normalizer: null,
    canonicalTable: null,
    probeId: null,
    reason: null,
  })]))
  for (const capability of mobileInterface?.capabilities ?? []) {
    const provider = normalizeMobileProvider(capability.provider)
    if (!provider || !providerColumns.includes(provider)) continue
    merged[provider] = mergeProviderCell(merged[provider], normalizeProviderCell(capability))
  }
  return merged
}

function normalizeProviderCell(cell) {
  return {
    status: cell?.status ?? 'not-supported',
    capabilityId: cell?.capabilityId ?? cell?.id ?? null,
    adapter: cell?.adapter ?? null,
    normalizer: cell?.normalizer ?? null,
    canonicalTable: cell?.canonicalTable ?? null,
    probeId: cell?.probeId ?? null,
    reason: cell?.reason ?? null,
    upstreamOrigin: cell?.upstreamOrigin ?? null,
  }
}

function mergeProviderCell(base, incoming) {
  if (!base) return incoming
  if (!incoming) return base
  const baseRank = providerStatusRank(base.status)
  const incomingRank = providerStatusRank(incoming.status)
  const winner = incomingRank > baseRank ? incoming : base
  const fallback = winner === incoming ? base : incoming
  return {
    ...winner,
    capabilityId: winner.capabilityId ?? fallback.capabilityId ?? null,
    adapter: winner.adapter ?? fallback.adapter ?? null,
    normalizer: winner.normalizer ?? fallback.normalizer ?? null,
    canonicalTable: winner.canonicalTable ?? fallback.canonicalTable ?? null,
    probeId: winner.probeId ?? fallback.probeId ?? null,
    reason: winner.reason ?? (winner.status === fallback.status ? (fallback.reason ?? null) : null),
    upstreamOrigin: winner.upstreamOrigin ?? fallback.upstreamOrigin ?? null,
  }
}

function providerStatusRank(status) {
  return ({
    supported: 7,
    'global-only': 6,
    'credential-gated': 5,
    'quota-gated': 5,
    'transport-unstable': 5,
    'output-only': 4,
    disabled: 3,
    'not-supported': 2,
  })[status] ?? 0
}

function isCredentialActivationRow(row) {
  return row.status === 'credential-gated' || row.status === 'quota-gated'
}

function isCredentialValidatedRow(row) {
  return (
    isCredentialActivationRow(row) &&
    row.liveStatus === 'passed' &&
    row.reusableShape === true &&
    !row.routeImplementationRequired &&
    !row.liveFailureClass &&
    Boolean(row.normalizer && row.canonicalTable)
  )
}

function isPolicyDisabledRow(row) {
  return row.status === 'disabled' && row.gapClass === 'policy-disabled'
}

function routeWiringStatusFor({ status, capability }) {
  if (status !== 'output-only') return 'blocked-or-not-supported'
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
  if (capability.normalizer && capability.canonicalTable) return 'route-ready-or-unverified'
  return 'missing-canonical-shape'
}

function providerGapClass({ status, routeWiringStatus, routeImplementationRequired }) {
  if (status === 'transport-unstable') return 'serial-live-retry'
  if (status === 'credential-gated' || status === 'quota-gated') return 'credential-or-quota-required'
  if (status === 'disabled') return 'policy-disabled'
  if (status === 'output-only' && routeWiringStatus === 'non-equivalent-wrapper') return 'non-equivalent-output-only'
  if (status === 'output-only' && routeImplementationRequired) return 'route-implementation-required'
  if (status === 'output-only') return 'output-only-review'
  return 'capability-gap'
}

function providerGapActionPriority(gapClass) {
  const priorities = {
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

function providerGapNextAction({ provider, status, capability, item, hasReusableShape, routeWiringStatus, liveStatus }) {
  if (status === 'transport-unstable') {
    if (liveStatus?.status === 'passed') return `Recent live evidence passed for ${provider}/${item.interfaceId}; verify normalize -> persist -> readback before clearing the transport-unstable capability state.`
    if (liveStatus) return `Keep ${provider}/${item.interfaceId} degraded; latest live evidence is ${liveStatus.validationState || liveStatus.status}${liveStatus.failureClass ? ` (${liveStatus.failureClass})` : ''}. Retry serially only after provider/network recovery.`
    return `Keep ${provider}/${item.interfaceId} degraded until serial live evidence shows the provider path is stable.`
  }
  if (status === 'credential-gated' || status === 'quota-gated') {
    if (liveStatus?.status === 'passed') return `Current configured environment has observed live ${provider}/${item.interfaceId}; keep the capability credential-gated for unconfigured runtimes and prove normalize -> persist -> readback before marking broadly supported.`
    if (liveStatus) return `Credential/quota-gated ${provider}/${item.interfaceId} has latest live state ${liveStatus.validationState || liveStatus.status}${liveStatus.failureClass ? ` (${liveStatus.failureClass})` : ''}; fix credential/quota/provider state before promotion.`
    return `Verify ${provider}/${item.interfaceId} with configured credentials/quota, then prove normalize -> persist -> readback before marking supported.`
  }
  if (status === 'disabled') return `Do not call ${provider}/${item.interfaceId}; keep disabled unless account permissions and runtime guardrails change.`
  if (status === 'output-only' && routeWiringStatus === 'non-equivalent-wrapper') return `Keep ${provider}/${item.interfaceId} output-only; this provider wrapper is known but not semantically equivalent to the requirement-level interface.`
  if (status === 'output-only' && routeWiringStatus === 'missing-requirement-route') return `Implement the requirement-level ${provider} route for ${item.interfaceId} before promotion; declared normalizer/table ${capability.normalizer ?? '-'}/${capability.canonicalTable ?? '-'} is only generic or diagnostic evidence.`
  if (status === 'output-only' && routeWiringStatus === 'missing-canonical-shape') return `Keep ${provider}/${item.interfaceId} output-only until a canonical normalizer, table, cache/readback rule, and tests exist.`
  if (status === 'output-only' && hasReusableShape) return `Implement or verify requirement-level ${provider} adapter wiring for ${item.interfaceId}; normalizer/table already declared as ${capability.normalizer}/${capability.canonicalTable}.`
  return `Keep ${provider}/${item.interfaceId} output-only until a canonical normalizer, table, cache/readback rule, and tests exist.`
}

function providerGapCacheDecision({ status, gapClass }) {
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

function buildLiveProviderHealth(liveStatusReport, mobileStatus) {
  const mobileRows = mobileStatusRows(mobileStatus)
  const mobilePassedRows = mobileRows.filter((item) => item.status === 'passed')
  const mobileFailureRows = mobileRows.filter((item) => item.status !== 'passed')
  const providerNames = unique([
    ...Object.keys(liveStatusReport.byProvider ?? {}),
    ...(liveStatusReport.failures ?? []).map((item) => item.provider),
    ...(liveStatusReport.passedApis ?? []).map((item) => item.provider),
    ...mobileRows.map((item) => item.provider),
  ].filter(Boolean)).sort()
  return providerNames.map((provider) => {
    const passedRows = [
      ...(liveStatusReport.passedApis ?? []).filter((item) => item.provider === provider),
      ...mobilePassedRows.filter((item) => item.provider === provider),
    ]
    const failureRows = [
      ...(liveStatusReport.failures ?? []).filter((item) => item.provider === provider),
      ...mobileFailureRows.filter((item) => item.provider === provider),
    ]
    return {
      provider,
      normalizedProvider: normalizeProvider(provider),
      liveProbeCount: (liveStatusReport.byProvider?.[provider] ?? 0) + mobileRows.filter((item) => item.provider === provider).length,
      passed: passedRows.length,
      failures: failureRows.length,
      validationStateCounts: countBy([...passedRows, ...failureRows].map((item) => item.validationState ?? item.status ?? 'unknown')),
      failureClasses: countBy(failureRows.map((item) => item.failureClass ?? 'unknown')),
      healthState: failureRows.length > 0 ? 'degraded' : 'observed',
      nextAction: failureRows.length > 0
        ? `Inspect ${provider} desktop/mobile live failures in the failure action queue before widening provider use.`
        : `Keep ${provider} desktop/mobile live probe evidence current.`,
    }
  })
}

function buildFailureActionQueue({ liveStatusReport, mobileStatus, interfaces, detailedRows }) {
  const interfacesByProbeId = new Map()
  for (const item of interfaces) {
    for (const probeId of item.liveProbeIds ?? []) {
      const rows = interfacesByProbeId.get(probeId) ?? []
      rows.push(item.interfaceId)
      interfacesByProbeId.set(probeId, rows)
    }
  }
  const detailedRowsByProbeId = new Map()
  for (const item of detailedRows ?? []) {
    for (const probeId of detailedRowProbeIds(item)) {
      const rows = detailedRowsByProbeId.get(probeId) ?? []
      rows.push(item)
      detailedRowsByProbeId.set(probeId, rows)
    }
  }
  return [...(liveStatusReport.failures ?? []), ...mobileFailureStatusRows(mobileStatus)].map((row) => {
    const relatedRows = detailedRowsByProbeId.get(row.id) ?? []
    const affectedInterfaces = unique([
      ...(interfacesByProbeId.get(row.id) ?? []),
      ...relatedRows.map((item) => item.interfaceId).filter(Boolean),
    ])
    const affectedCapabilities = affectedCapabilitiesForFailure({ row, relatedRows, interfaces })
    const firstCapability = affectedCapabilities[0]
    const primaryInterfaceId = affectedInterfaces[0] ?? firstCapability?.interfaceId ?? null
    const firstInterface = interfaces.find((item) => item.interfaceId === primaryInterfaceId)
    return {
      id: `failure:${row.id}`,
      interfaceId: primaryInterfaceId,
      probeId: row.id,
      provider: row.provider,
      family: row.family,
      runtime: row.runtime ?? 'finagent_workstation',
      status: row.status,
      validationState: row.validationState,
      failureClass: row.failureClass,
      affectedInterfaces,
      affectedCapabilities,
      capabilityId: firstCapability?.capabilityId ?? null,
      canonicalSchema: firstInterface?.canonicalSchema ?? relatedRows.find((item) => item.canonicalSchema)?.canonicalSchema ?? firstCapability?.canonicalSchema ?? null,
      canonicalTable: firstCapability?.canonicalTable ?? firstInterface?.dataStoreTables?.[0] ?? null,
      readbackAction: firstInterface?.queryActions?.[0] ?? null,
      readbackActions: firstInterface?.queryActions ?? [],
      affectedRows: unique(relatedRows.map((item) => item.rowId).filter(Boolean)),
      affectedSurfaces: unique(relatedRows.map((item) => item.surfaceId).filter(Boolean)),
      reason: failureReason(row),
      recoveryPolicy: failureRecoveryPolicy(row, firstInterface, firstCapability),
      retryPolicy: failureRetryPolicy(row),
      cacheDecision: failureCacheDecision(row, firstInterface, firstCapability),
      presenceReason: failurePresenceReason(row),
      exitCondition: failureExitCondition(row),
      nextAction: failureNextAction(row),
      error: row.error,
    }
  })
}

function affectedCapabilitiesForFailure({ row, relatedRows, interfaces }) {
  const providerKeys = unique([
    row.provider,
    normalizeProvider(row.provider),
    denormalizeProvider(row.provider),
  ].filter(Boolean))
  const capabilityRows = []
  for (const item of relatedRows) {
    const providerSupport = item.providerSupport ?? {}
    const queryActions = item.queryActions ?? interfaces.find((candidate) => candidate.interfaceId === item.interfaceId)?.queryActions ?? []
    for (const provider of providerKeys) {
      const capability = providerSupport[provider]
      if (!capability?.capabilityId) continue
      capabilityRows.push({
        interfaceId: item.interfaceId,
        capabilityId: capability.capabilityId,
        provider: row.provider ?? provider,
        normalizedProvider: provider,
        status: capability.status ?? null,
        canonicalSchema: item.canonicalSchema ?? null,
        canonicalTable: capability.canonicalTable ?? item.dataStoreTables?.[0] ?? null,
        readbackAction: queryActions[0] ?? null,
        readbackActions: queryActions,
        normalizer: capability.normalizer ?? null,
      })
    }
  }
  return uniqueBy(capabilityRows, (item) => `${item.interfaceId}:${item.provider}:${item.capabilityId}`)
}

function failureReason(row) {
  if (row.failureClass === 'auth_permission') {
    return `${row.provider} rejected ${row.id} because the configured credential lacks endpoint entitlement or account permission.`
  }
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') {
    return `${row.provider} failed because credentials or provider permissions are not accepted for ${row.id}.`
  }
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') {
    return `${row.provider} failed because quota or rate limit is exhausted for ${row.id}.`
  }
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') {
    return `${row.provider} response did not satisfy the expected provider/interface contract for ${row.id}.`
  }
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') {
    return `${row.provider} failed due to transport, timeout, or provider instability for ${row.id}.`
  }
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') {
    return `${row.provider} runtime dependency is unavailable for ${row.id}.`
  }
  return `Provider probe ${row.id} failed and requires classified triage before widening use.`
}

function failureRecoveryPolicy(row, firstInterface, firstCapability) {
  const readback = firstInterface?.queryActions?.[0] ?? firstCapability?.readbackAction ?? null
  const cacheText = readback ? ` Reuse ${readback} cache when available.` : ''
  if (row.failureClass === 'auth_permission') {
    return `Keep this provider capability gated; fix provider-side entitlement or account permission, then rerun only the bounded probe.${cacheText}`
  }
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') {
    return `Keep provider gate active; fix credentials or provider permission before live refresh.${cacheText}`
  }
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') {
    return `Stop broad provider collection until quota resets; prefer reusable cache and eligible fallback providers.${cacheText}`
  }
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') {
    return 'Fix adapter/parser/normalizer contract before persisting additional rows.'
  }
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') {
    return 'Retry only with serial probes and provider-specific timeout after provider/network recovery.'
  }
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') {
    return 'Restore the runtime dependency before retrying the probe.'
  }
  return 'Classify root cause, update provider evidence, and rerun focused verification before widening routing.'
}

function failureRetryPolicy(row) {
  if (row.failureClass === 'auth_permission') return 'no automatic retry until provider entitlement or permission changes'
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return 'no automatic retry until credential or permission changes'
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return 'no broad retry until quota reset; cache/readback first'
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return 'no retry until adapter or schema contract is fixed'
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return 'serial retry only after provider/network recovery'
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return 'retry only after runtime dependency is restored'
  return 'manual triage required before retry'
}

function failureCacheDecision(row, firstInterface, firstCapability) {
  const readback = firstInterface?.queryActions?.[0] ?? firstCapability?.readbackAction ?? null
  const cacheText = readback ? ` Use ${readback} readback if local data is fresh enough.` : ' Use local cache/readback or healthy fallback providers when available.'
  if (row.failureClass === 'auth_permission') return `Keep this provider out of live routing until entitlement changes.${cacheText}`
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return `Keep provider gate active and avoid live refresh until credentials or permissions change.${cacheText}`
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return `Do not spend more quota on broad retry; prefer cache/readback and fallback providers.${cacheText}`
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return 'Do not persist or reuse new provider output until adapter, parser, normalizer, and readback contract are fixed.'
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return `Preserve existing cached data; retry only with a bounded serial probe after provider/network recovery.${cacheText}`
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return `Provider refresh is blocked by runtime dependency; use cache/readback until the dependency is restored.${cacheText}`
  return `Classify root cause before widening live routing.${cacheText}`
}

function failurePresenceReason(row) {
  if (String(row.error ?? '').trim()) return String(row.error)
  return failureReason(row)
}

function failureExitCondition(row) {
  if (row.failureClass === 'auth_permission') {
    return 'Leaves this queue after endpoint entitlement or account permission changes are verified by the bounded probe, or after this provider capability is reclassified.'
  }
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') {
    return 'Leaves this queue after credential or permission changes are verified by a bounded probe, or after the capability is reclassified as gated, disabled, unsupported, or supported.'
  }
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') {
    return 'Leaves this queue after quota availability is verified or the capability is reclassified with explicit quota policy.'
  }
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') {
    return 'Leaves this queue after adapter/parser/normalizer contract is fixed and focused readback verification passes, or after the path is marked unsupported/diagnostic.'
  }
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') {
    return 'Leaves this queue after serial retry produces stable evidence or the provider is reclassified as unstable, disabled, unsupported, or gated.'
  }
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') {
    return 'Leaves this queue after the runtime dependency is restored and the registered probe is rerun successfully or reclassified.'
  }
  return 'Leaves this queue after root cause classification, provider evidence update, and focused verification.'
}

function detailedRowProbeIds(item) {
  const ids = [
    ...(item.liveProbeIds ?? []),
    ...(item.liveStatusEvidence?.probeIds ?? []),
  ]
  for (const capability of Object.values(item.providerSupport ?? {})) {
    if (capability?.probeId) ids.push(capability.probeId)
  }
  return unique(ids.filter(Boolean))
}

function buildProviderHealth(providerColumns, interfaces, liveProbeBacklog, liveStatusReport) {
  return providerColumns.map((provider) => {
    const entries = interfaces.map((row) => row.providers?.[provider]).filter(Boolean)
    const statusCounts = countBy(entries.map((item) => item.status ?? 'unknown'))
    const failureRows = (liveStatusReport.failures ?? []).filter((item) => item.provider === provider || normalizeProvider(item.provider) === provider)
    const backlogRows = (liveProbeBacklog.rows ?? []).filter((item) => item.provider === provider || normalizeProvider(item.provider) === provider)
    return {
      provider,
      supportedInterfaceCount: (statusCounts.supported ?? 0) + (statusCounts['global-only'] ?? 0),
      outputOnlyCount: statusCounts['output-only'] ?? 0,
      gatedCount: (statusCounts['credential-gated'] ?? 0) + (statusCounts['quota-gated'] ?? 0) + (statusCounts['transport-unstable'] ?? 0),
      disabledCount: statusCounts.disabled ?? 0,
      notSupportedCount: statusCounts['not-supported'] ?? 0,
      statusCounts,
      liveProbeCount: liveStatusReport.byProvider?.[provider] ?? liveStatusReport.byProvider?.[denormalizeProvider(provider)] ?? 0,
      liveFailures: failureRows.length,
      liveFailureClasses: countBy(failureRows.map((item) => item.failureClass ?? 'unknown')),
      liveProbeBacklog: backlogRows.length,
      healthState: providerHealthState({ statusCounts, failureRows, backlogRows }),
      nextAction: providerNextAction({ provider, statusCounts, failureRows, backlogRows }),
    }
  })
}

function buildDatasetHealth(interfaces, detailedRows) {
  const bySchema = new Map()
  for (const item of interfaces) {
    const key = item.canonicalSchema || 'unknown'
    const existing = bySchema.get(key) ?? {
      canonicalSchema: key,
      dataStoreTables: new Set(),
      interfaces: [],
      queryActions: new Set(),
      freshnessPolicies: new Set(),
      cacheStatuses: new Set(),
      healthStates: [],
      liveProbeBacklog: 0,
      failures: 0,
      detailedRows: 0,
    }
    for (const table of item.dataStoreTables) existing.dataStoreTables.add(table)
    for (const action of item.queryActions) existing.queryActions.add(action)
    if (item.freshnessPolicy) existing.freshnessPolicies.add(item.freshnessPolicy)
    if (item.cacheStatus) existing.cacheStatuses.add(item.cacheStatus)
    existing.interfaces.push(item.interfaceId)
    existing.healthStates.push(item.healthState)
    existing.liveProbeBacklog += item.liveProbeBacklog
    existing.failures += item.failures.length
    existing.detailedRows += detailedRows.filter((row) => row.interfaceId === item.interfaceId).length
    bySchema.set(key, existing)
  }
  return [...bySchema.values()].map((item) => ({
    canonicalSchema: item.canonicalSchema,
    dataStoreTables: [...item.dataStoreTables],
    interfaces: item.interfaces,
    queryActions: [...item.queryActions],
    freshnessPolicies: [...item.freshnessPolicies],
    cacheStatuses: [...item.cacheStatuses],
    detailedRows: item.detailedRows,
    liveProbeBacklog: item.liveProbeBacklog,
    failures: item.failures,
    healthState: datasetHealthState(item.healthStates),
  })).sort((a, b) => a.canonicalSchema.localeCompare(b.canonicalSchema))
}

function validateReport({ providerMatrix, detailedMatrix, liveProbeBacklog, liveStatusReport, mobileStatus, interfaces, providerHealth, liveProviderHealth, datasetHealth, failureActionQueue, providerGapQueue, credentialActivationQueue, credentialValidatedQueue, policyDisabledQueue }) {
  const problems = []
  const expectedFailureRows = (liveStatusReport.failures ?? []).length + mobileFailureStatusRows(mobileStatus).length
  const expectedLiveRows = (liveStatusReport.summary?.total ?? 0) + mobileStatusRows(mobileStatus).length
  if (interfaces.length !== providerMatrix.summary?.interfaces) problems.push(`interface health rows ${interfaces.length} != provider matrix interfaces ${providerMatrix.summary?.interfaces}`)
  if (providerHealth.length !== providerMatrix.summary?.providers) problems.push(`provider health rows ${providerHealth.length} != provider matrix providers ${providerMatrix.summary?.providers}`)
  const liveProviders = Object.keys(liveStatusReport.byProvider ?? {})
  const liveProviderNames = new Set(liveProviderHealth.map((row) => row.provider))
  for (const provider of liveProviders) if (!liveProviderNames.has(provider)) problems.push(`live provider health is missing ${provider}`)
  if (datasetHealth.length < 20) problems.push(`expected at least 20 dataset health groups, got ${datasetHealth.length}`)
  if ((detailedMatrix.summary?.unclassifiedRows ?? 0) !== 0) problems.push(`detailed matrix has ${detailedMatrix.summary?.unclassifiedRows} unclassified rows`)
  if ((liveProbeBacklog.summary?.missingProbeDefinition ?? 0) !== 0) problems.push(`live probe backlog has ${liveProbeBacklog.summary?.missingProbeDefinition} missing probe definitions`)
  if (expectedLiveRows < 71) problems.push(`live status has too few rows: ${expectedLiveRows}`)
  if (failureActionQueue.length !== expectedFailureRows) problems.push(`failure action queue ${failureActionQueue.length} != desktop+mobile live failures ${expectedFailureRows}`)
  for (const item of failureActionQueue) {
    if (!item.id || !item.probeId || !item.nextAction) problems.push(`failure action row missing stable id/probe/action: ${JSON.stringify(item)}`)
    if (!item.reason || !item.recoveryPolicy || !item.retryPolicy) problems.push(`failure action row missing reason/recovery/retry policy: ${JSON.stringify(item)}`)
    if (!item.cacheDecision) problems.push(`failure action row missing cache decision: ${JSON.stringify(item)}`)
    if (!item.presenceReason || !item.exitCondition) problems.push(`failure action row missing presence reason/exit condition: ${JSON.stringify(item)}`)
    if ((item.affectedInterfaces ?? []).length === 0) problems.push(`failure action row missing affected interface provenance: ${JSON.stringify(item)}`)
    if ((item.affectedCapabilities ?? []).length === 0) problems.push(`failure action row missing affected capability provenance: ${JSON.stringify(item)}`)
    if ((item.affectedRows ?? []).length === 0) problems.push(`failure action row missing affected detailed-matrix rows: ${JSON.stringify(item)}`)
  }
  const expectedGapRows = (providerMatrix.rows ?? []).flatMap((row) => Object.values(row.providers ?? {})).filter((capability) => ['output-only', 'credential-gated', 'quota-gated', 'transport-unstable', 'disabled'].includes(capability.status)).length
  if (providerGapQueue.length + credentialActivationQueue.length + credentialValidatedQueue.length + policyDisabledQueue.length !== expectedGapRows) problems.push(`provider gap/activation/validated/policy-disabled queues ${providerGapQueue.length}+${credentialActivationQueue.length}+${credentialValidatedQueue.length}+${policyDisabledQueue.length} != matrix gap cells ${expectedGapRows}`)
  for (const item of providerGapQueue) {
    if (!item.id || !item.interfaceId || !item.provider || !item.nextAction) problems.push(`provider gap row missing stable id/interface/provider/action: ${JSON.stringify(item)}`)
    if (!item.gapClass || typeof item.actionPriority !== 'number') problems.push(`provider gap row missing gap class/action priority: ${JSON.stringify(item)}`)
    if (!item.cacheDecision) problems.push(`provider gap row missing cache decision: ${JSON.stringify(item)}`)
    if (item.probeId && !item.liveStatus) problems.push(`provider gap row with probeId is missing live status evidence: ${JSON.stringify(item)}`)
  }
  for (const item of credentialActivationQueue) {
    if (!item.id || !item.interfaceId || !item.provider || !item.nextAction) problems.push(`credential activation row missing stable id/interface/provider/action: ${JSON.stringify(item)}`)
    if (!item.reason) problems.push(`credential activation row missing reason: ${JSON.stringify(item)}`)
    if (!item.cacheDecision) problems.push(`credential activation row missing cache decision: ${JSON.stringify(item)}`)
  }
  for (const item of credentialValidatedQueue) {
    if (!item.id || !item.interfaceId || !item.provider || !item.nextAction) problems.push(`credential validated row missing stable id/interface/provider/action: ${JSON.stringify(item)}`)
    if (item.liveStatus !== 'passed') problems.push(`credential validated row is not live-observed: ${JSON.stringify(item)}`)
    if (!item.normalizer || !item.canonicalTable) problems.push(`credential validated row lacks canonical shape: ${JSON.stringify(item)}`)
    if (!item.reason) problems.push(`credential validated row missing reason: ${JSON.stringify(item)}`)
    if (!item.cacheDecision) problems.push(`credential validated row missing cache decision: ${JSON.stringify(item)}`)
  }
  for (const item of policyDisabledQueue) {
    if (!item.id || !item.interfaceId || !item.provider || !item.nextAction) problems.push(`policy-disabled row missing stable id/interface/provider/action: ${JSON.stringify(item)}`)
    if (item.status !== 'disabled' || item.gapClass !== 'policy-disabled') problems.push(`policy-disabled row has inconsistent status/class: ${JSON.stringify(item)}`)
    if (!item.reason) problems.push(`policy-disabled row missing reason: ${JSON.stringify(item)}`)
    if (!item.cacheDecision) problems.push(`policy-disabled row missing cache decision: ${JSON.stringify(item)}`)
  }
  for (const item of interfaces) {
    if (!item.interfaceId || !item.canonicalSchema) problems.push(`interface health row missing identity/schema: ${JSON.stringify(item)}`)
    if (item.cacheStatus !== 'implemented') problems.push(`${item.interfaceId} cache status is ${item.cacheStatus}`)
    if (item.queryActions.length === 0) problems.push(`${item.interfaceId} has no readback query action`)
  }
  return problems
}

function failureNextAction(row) {
  if (row.validationState === 'runtime-blocked' || row.failureClass === 'runtime_unavailable') {
    return `Restore ${row.provider} runtime, then retry ${row.id} serially with --concurrency 1 and checkpoint/resume.`
  }
  if (row.validationState === 'transport-or-provider-unstable' || row.failureClass === 'transport' || row.failureClass === 'provider_outage') {
    return `Retry ${row.id} only after provider/network recovery; keep the failure classified if it repeats.`
  }
  if (row.failureClass === 'auth_permission') {
    return `Do not retry ${row.id} automatically; update provider entitlement/permission, then rerun only this bounded probe and verify readback.`
  }
  if (row.validationState === 'credential-gated' || row.validationState === 'quota-gated') {
    return `Use configured credential/quota gate before retrying ${row.id}.`
  }
  if (row.validationState === 'invalid-parameters') {
    return `Fix probe parameters or provider adapter contract before retrying ${row.id}.`
  }
  if (row.validationState === 'unsupported-by-provider') {
    return `Keep ${row.id} unsupported or replace it with a provider-supported interface.`
  }
  return `Inspect ${row.id} failure and update provider classification before retrying.`
}

function interfaceHealthState({ failures, relatedBacklogRows, passedLiveRows, statusCounts }) {
  if (failures.length > 0) {
    const hasObservedSupportedWorkflow =
      passedLiveRows.length > 0 &&
      ((statusCounts.supported ?? 0) > 0 || (statusCounts['global-only'] ?? 0) > 0)
    const gatedOnlyFailures = failures.every((failure) =>
      [
        'credential-or-permission',
        'quota-or-rate-limit',
        'auth_permission',
      ].includes(failure.failureClass ?? ''),
    )
    if (hasObservedSupportedWorkflow && gatedOnlyFailures) return 'observed'
    return 'degraded'
  }
  if (relatedBacklogRows.length > 0) return 'needs-live-probe'
  if (passedLiveRows.length > 0) return 'observed'
  if ((statusCounts.supported ?? 0) > 0 || (statusCounts['global-only'] ?? 0) > 0) return 'registered'
  if ((statusCounts['credential-gated'] ?? 0) > 0 || (statusCounts['quota-gated'] ?? 0) > 0) return 'gated'
  return 'unsupported'
}

function interfaceNextAction({ failures, relatedBacklogRows, statusCounts, providerEntries, passedLiveByProbeId, passedLiveRows }) {
  if (failures.length > 0) {
    const hasObservedSupportedWorkflow =
      passedLiveRows.length > 0 &&
      ((statusCounts.supported ?? 0) > 0 || (statusCounts['global-only'] ?? 0) > 0)
    const gatedOnlyFailures = failures.every((failure) =>
      [
        'credential-or-permission',
        'quota-or-rate-limit',
        'auth_permission',
      ].includes(failure.failureClass ?? ''),
    )
    if (hasObservedSupportedWorkflow && gatedOnlyFailures) {
      return 'Observed supported provider evidence exists; keep gated-provider failures visible without degrading the interface, and require configured credentials or quota before using the gated path.'
    }
    return 'Inspect classified provider failures and retry serially only after provider/runtime recovery.'
  }
  if (relatedBacklogRows.length > 0) return 'Run the generated serial live-probe command for this interface/provider family.'
  if ((statusCounts['output-only'] ?? 0) > 0) return 'Evaluate output-only provider cells for promotion only when business reuse and readback are clear.'
  const observedCredentialGate = providerEntries.some(([, value]) =>
    (value.status === 'credential-gated' || value.status === 'quota-gated') &&
    value.normalizer &&
    value.canonicalTable &&
    value.probeId &&
    passedLiveByProbeId.has(value.probeId)
  )
  if ((statusCounts['credential-gated'] ?? 0) > 0 || (statusCounts['quota-gated'] ?? 0) > 0) {
    if (observedCredentialGate) return 'Credential-gated provider evidence exists; keep the gate visible, use cache/readback first, and require configured credentials before live refresh.'
    return 'Verify credential-gated provider capability with quota-aware live evidence before marking supported.'
  }
  return 'Maintain interface/readback contract and monitor recent API health.'
}

function providerHealthState({ statusCounts, failureRows, backlogRows }) {
  if (failureRows.length > 0) return 'degraded'
  if ((statusCounts['credential-gated'] ?? 0) > 0 || (statusCounts['quota-gated'] ?? 0) > 0) return 'gated'
  if (backlogRows.length > 0) return 'needs-live-probe'
  if ((statusCounts.supported ?? 0) > 0 || (statusCounts['global-only'] ?? 0) > 0) return 'available'
  return 'unsupported'
}

function providerNextAction({ provider, statusCounts, failureRows, backlogRows }) {
  if (failureRows.length > 0) return `Classify and retry ${provider} failed probes serially after runtime/provider recovery.`
  if (backlogRows.length > 0) return `Run ${provider} backlog probes with --concurrency 1, waits, and checkpoint/resume.`
  if ((statusCounts['credential-gated'] ?? 0) > 0 || (statusCounts['quota-gated'] ?? 0) > 0) return `Use configured credentials/quota gates before widening ${provider} collection.`
  return `Keep ${provider} capability registration and readback evidence current.`
}

function datasetHealthState(states) {
  if (states.includes('degraded')) return 'degraded'
  if (states.includes('needs-live-probe')) return 'needs-live-probe'
  if (states.includes('observed')) return 'observed'
  if (states.includes('registered')) return 'registered'
  if (states.includes('gated')) return 'gated'
  return 'unsupported'
}

function providerStatus(provider, value) {
  return {
    provider,
    status: value.status ?? 'unknown',
    capabilityId: value.capabilityId ?? null,
    reason: value.reason ?? null,
    probeId: value.probeId ?? null,
  }
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Data Health Report')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- interfaces: ${report.summary.interfaces}`)
  lines.push(`- providers: ${report.summary.providers}`)
  lines.push(`- live providers: ${report.summary.liveProviders}`)
  lines.push(`- datasets: ${report.summary.datasets}`)
  lines.push(`- detailed rows: ${report.summary.detailedRows}`)
  lines.push(`- live status rows: ${report.summary.liveStatusRows}`)
  lines.push(`- live status passed: ${report.summary.liveStatusPassed}`)
  lines.push(`- live status failed/blocked: ${report.summary.liveStatusFailedOrBlocked}`)
  lines.push(`- live-probe backlog rows: ${report.summary.liveProbeBacklogRows}`)
  lines.push(`- failure action rows: ${report.summary.failureActionRows}`)
  lines.push(`- provider gap rows: ${report.summary.providerGapRows}`)
  lines.push(`- credential activation rows: ${report.summary.credentialActivationRows}`)
  lines.push(`- credential validated rows: ${report.summary.credentialValidatedRows}`)
  lines.push(`- policy disabled rows: ${report.summary.policyDisabledRows}`)
  lines.push(`- provider gap live observed: ${report.summary.providerGapLiveObserved}`)
  lines.push(`- provider gap live failed/blocked: ${report.summary.providerGapLiveFailedOrBlocked}`)
  lines.push(`- credential activation live observed: ${report.summary.credentialActivationLiveObserved}`)
  lines.push(`- credential validated live observed: ${report.summary.credentialValidatedLiveObserved}`)
  lines.push(`- provider gap promotion candidates: ${report.summary.providerGapPromotionCandidates}`)
  lines.push(`- report problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('Interface health counts:')
  lines.push('')
  for (const [key, value] of Object.entries(report.summary.interfaceHealthCounts)) lines.push(`- ${key}: ${value}`)
  lines.push('')
  lines.push('## Provider Health')
  lines.push('')
  lines.push('| Provider | Health | Supported | Output-only | Gated | Disabled | Not supported | Live probes | Failures | Backlog | Next action |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const provider of report.providerHealth) {
    lines.push(`| ${provider.provider} | ${provider.healthState} | ${provider.supportedInterfaceCount} | ${provider.outputOnlyCount} | ${provider.gatedCount} | ${provider.disabledCount} | ${provider.notSupportedCount} | ${provider.liveProbeCount} | ${provider.liveFailures} | ${provider.liveProbeBacklog} | ${escapePipe(provider.nextAction)} |`)
  }
  lines.push('')
  lines.push('## Live Provider Health')
  lines.push('')
  lines.push('| Provider | Normalized | Health | Live probes | Passed | Failures | Failure classes | Next action |')
  lines.push('|---|---|---|---:|---:|---:|---|---|')
  for (const provider of report.liveProviderHealth) {
    lines.push(`| ${escapePipe(provider.provider)} | ${escapePipe(provider.normalizedProvider)} | ${provider.healthState} | ${provider.liveProbeCount} | ${provider.passed} | ${provider.failures} | ${escapePipe(JSON.stringify(provider.failureClasses))} | ${escapePipe(provider.nextAction)} |`)
  }
  lines.push('')
  lines.push('## Interface Health')
  lines.push('')
  lines.push('| Interface | Purpose | Schema | Health | Workflow providers | Gated providers | Cache | Backlog | Failures | Next action |')
  lines.push('|---|---|---|---|---|---|---|---:|---:|---|')
  for (const item of report.interfaceHealth) {
    const workflowProviders = item.supportedProviders.join(', ') || '-'
    const gatedProviders = item.gatedProviders.map((provider) => `${provider.provider} (${provider.status})`).join(', ') || '-'
    lines.push(`| \`${item.interfaceId}\` | ${escapePipe(item.chinesePurpose || item.label || '')} | \`${item.canonicalSchema}\` | ${item.healthState} | ${escapePipe(workflowProviders)} | ${escapePipe(gatedProviders)} | ${item.cacheStatus} | ${item.liveProbeBacklog} | ${item.failures.length} | ${escapePipe(item.nextAction)} |`)
  }
  lines.push('')
  lines.push('## Dataset Health')
  lines.push('')
  lines.push('| Schema | Tables | Interfaces | Health | Query actions | Backlog | Failures |')
  lines.push('|---|---|---:|---|---|---:|---:|')
  for (const item of report.datasetHealth) {
    lines.push(`| \`${item.canonicalSchema}\` | ${item.dataStoreTables.map((table) => `\`${table}\``).join(', ') || '-'} | ${item.interfaces.length} | ${item.healthState} | ${item.queryActions.map((action) => `\`${action}\``).join(', ') || '-'} | ${item.liveProbeBacklog} | ${item.failures} |`)
  }
  lines.push('')
  lines.push('## Current Degraded Interfaces')
  lines.push('')
  if (report.degradedInterfaces.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.degradedInterfaces) {
      const firstFailure = item.failures[0]
      lines.push(`- \`${item.interfaceId}\`: ${firstFailure?.provider ?? 'provider'} ${firstFailure?.failureClass ?? 'failure'} - ${firstFailure?.error ?? 'classified failure'}`)
    }
  }
  lines.push('')
  lines.push('## Provider Gap Queue')
  lines.push('')
  if (report.providerGapQueue.length === 0) {
    lines.push('- none')
  } else {
    lines.push('| Interface | Provider | Status | Live | Gap class | Priority | Candidate | Route wiring | Route impl required | Capability | Normalizer/Table | Cache decision | Next action |')
    lines.push('|---|---|---|---|---|---:|---|---|---|---|---|---|---|')
    for (const item of report.providerGapQueue) {
      const live = item.liveStatus
        ? `${item.liveStatus}/${item.liveValidationState ?? '-'}${item.liveFailureClass ? `/${item.liveFailureClass}` : ''}`
        : '-'
      lines.push(`| \`${item.interfaceId}\` | ${escapePipe(item.provider)} | ${escapePipe(item.status)} | ${escapePipe(live)} | ${escapePipe(item.gapClass ?? '-')} | ${item.actionPriority ?? '-'} | ${item.promotionCandidate ? 'yes' : 'no'} | ${escapePipe(item.routeWiringStatus ?? '-')} | ${item.routeImplementationRequired ? 'yes' : 'no'} | ${escapePipe(item.capabilityId ?? '-')} | ${escapePipe(`${item.normalizer ?? '-'} / ${item.canonicalTable ?? '-'}`)} | ${escapePipe(item.cacheDecision ?? '-')} | ${escapePipe(item.nextAction)} |`)
    }
    const gatedIndexWeight = report.providerGapQueue.find((item) =>
      item.interfaceId === 'index.constituents' &&
      item.provider === 'tushare' &&
      item.capabilityId === 'tushare.index.constituents'
    )
    if (gatedIndexWeight) {
      lines.push('')
      lines.push('Operational guidance: `index.constituents` remains a governed interface, but the `tushare.index.constituents` provider path must stay gated while the current Tushare key/token returns 40203 permission evidence for `electron_tushare_index_weight`. Normal agent/app workflow should not advertise or call raw Tushare `index_weight`; use `query_index_constituents` or another supported provider, and retry this Tushare capability only after key/token privilege changes and a bounded probe verifies the new state.')
    }
  }
  lines.push('')
  lines.push('## Credential Activation Queue')
  lines.push('')
  if (report.credentialActivationQueue.length === 0) {
    lines.push('- none')
  } else {
    lines.push('| Interface | Provider | Status | Live | Canonical shape | Capability | Cache decision | Next action |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const item of report.credentialActivationQueue) {
      const live = item.liveStatus
        ? `${item.liveStatus}/${item.liveValidationState ?? '-'}${item.liveFailureClass ? `/${item.liveFailureClass}` : ''}`
        : '-'
      lines.push(`| \`${item.interfaceId}\` | ${escapePipe(item.provider)} | ${escapePipe(item.status)} | ${escapePipe(live)} | ${escapePipe(`${item.normalizer ?? '-'} / ${item.canonicalTable ?? '-'}`)} | ${escapePipe(item.capabilityId ?? '-')} | ${escapePipe(item.cacheDecision ?? '-')} | ${escapePipe(item.nextAction)} |`)
    }
  }
  lines.push('')
  lines.push('## Credential Validated Queue')
  lines.push('')
  if ((report.credentialValidatedQueue ?? []).length === 0) {
    lines.push('- none')
  } else {
    lines.push('| Interface | Provider | Status | Live | Canonical shape | Capability | Cache decision | Next action |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const item of report.credentialValidatedQueue) {
      const live = item.liveStatus
        ? `${item.liveStatus}/${item.liveValidationState ?? '-'}${item.liveFailureClass ? `/${item.liveFailureClass}` : ''}`
        : '-'
      lines.push(`| \`${item.interfaceId}\` | ${escapePipe(item.provider)} | ${escapePipe(item.status)} | ${escapePipe(live)} | ${escapePipe(`${item.normalizer ?? '-'} / ${item.canonicalTable ?? '-'}`)} | ${escapePipe(item.capabilityId ?? '-')} | ${escapePipe(item.cacheDecision ?? '-')} | ${escapePipe(item.nextAction)} |`)
    }
  }
  lines.push('')
  lines.push('## Policy Disabled Queue')
  lines.push('')
  if (report.policyDisabledQueue.length === 0) {
    lines.push('- none')
  } else {
    lines.push('| Interface | Provider | Status | Gap class | Capability | Reason | Cache decision | Next action |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const item of report.policyDisabledQueue) {
      lines.push(`| \`${item.interfaceId}\` | ${escapePipe(item.provider)} | ${escapePipe(item.status)} | ${escapePipe(item.gapClass ?? '-')} | ${escapePipe(item.capabilityId ?? '-')} | ${escapePipe(item.reason ?? '-')} | ${escapePipe(item.cacheDecision ?? '-')} | ${escapePipe(item.nextAction)} |`)
    }
    if (report.policyDisabledQueue.some((item) => item.provider === 'tushare')) {
      lines.push('')
      lines.push('Operational guidance: disabled Tushare capabilities are not provider fallbacks, not research defaults, and not normal workflow examples. Skills, AGENTS guidance, and UI/tool recovery text should route these requirements to local readback and governed EastMoney/AkShare/Yahoo/Wind paths, or keep them explicitly blocked until account permissions and runtime guardrails change.')
    }
  }
  lines.push('')
  lines.push('## Failure Action Queue')
  lines.push('')
  if (report.failureActionQueue.length === 0) {
    lines.push('- none')
  } else {
    lines.push('| Probe | Provider | Family | Validation | Failure | Interfaces | Capability | Matrix rows | Schema/Table | Readback | Presence reason | Cache decision | Exit condition | Retry policy | Next action |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const item of report.failureActionQueue) {
      lines.push(`| ${escapePipe(item.probeId)} | ${escapePipe(item.provider)} | ${escapePipe(item.family)} | ${escapePipe(item.validationState)} | ${escapePipe(item.failureClass)} | ${escapePipe(item.affectedInterfaces.join(', ') || '-')} | ${escapePipe(item.capabilityId ?? '-')} | ${escapePipe((item.affectedRows ?? []).join(', ') || '-')} | ${escapePipe(`${item.canonicalSchema ?? '-'} / ${item.canonicalTable ?? '-'}`)} | ${escapePipe(item.readbackAction ?? '-')} | ${escapePipe(item.presenceReason ?? '-')} | ${escapePipe(item.cacheDecision ?? '-')} | ${escapePipe(item.exitCondition ?? '-')} | ${escapePipe(item.retryPolicy ?? '-')} | ${escapePipe(item.nextAction)} |`)
    }
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) {
    lines.push('- none')
  } else {
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  return `${lines.join('\n')}\n`
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf-8'))
}

function countBy(values) {
  const out = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function unique(values) {
  return [...new Set(values)]
}

function uniqueBy(values, keyFn) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const key = keyFn(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function mobileStatusRows(mobileStatus) {
  return (mobileStatus.rows ?? [])
    .filter((row) => row.liveProbe?.id)
    .map((row) => {
      const probe = row.liveProbe
      return {
        id: probe.id,
        runtime: row.runtime ?? 'shared_mobile',
        provider: row.provider,
        family: row.action ?? row.endpoint,
        status: probe.status ?? row.status ?? 'unknown',
        validationState: probe.validationState ?? row.validationState ?? 'unknown',
        failureClass: probe.failureClass ?? row.failureClass ?? '',
        error: probe.error ?? '',
        durationMs: probe.durationMs ?? null,
        parsedCount: probe.rowCount ?? null,
      }
    })
}

function mobileFailureStatusRows(mobileStatus) {
  return mobileStatusRows(mobileStatus).filter((row) => row.status !== 'passed')
}

function readMobileContract() {
  const text = readFileSync(mobileContractPath, 'utf-8')
  const start = text.indexOf('const _interfaces')
  const blocks = extractCalls(start >= 0 ? text.slice(start) : text, 'DataApiInterfaceDefinition')
  return {
    interfaces: blocks.map((block) => ({
      id: readStringField(block, 'id'),
      capabilities: extractCalls(block, 'DataApiProviderCapability').map((capability) => ({
        id: readStringField(capability, 'id'),
        provider: readEnumField(capability, 'provider', 'FinanceProvider'),
        status: toWireStatus(readEnumField(capability, 'status', 'DataApiCapabilityStatus')),
        upstreamOrigin: readStringField(capability, 'upstreamOrigin'),
        adapter: readStringField(capability, 'adapter'),
        normalizer: readStringField(capability, 'normalizer'),
        canonicalTable: readStringField(capability, 'canonicalTable'),
        probeId: readStringField(capability, 'probeId'),
        reason: readStringField(capability, 'reason'),
      })).filter((capability) => capability.id && capability.provider && capability.status),
    })).filter((item) => item.id),
  }
}

function extractCalls(text, name) {
  const blocks = []
  let searchFrom = 0
  while (true) {
    const startName = text.indexOf(`${name}(`, searchFrom)
    if (startName < 0) break
    const start = text.indexOf('(', startName)
    let depth = 0
    let quote = null
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      const prev = text[i - 1]
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null
        continue
      }
      if (ch === '\'' || ch === '"') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          blocks.push(text.slice(startName, i + 1))
          searchFrom = i + 1
          break
        }
      }
    }
    if (searchFrom <= startName) break
  }
  return blocks
}

function readStringField(block, field) {
  const direct = block.match(new RegExp(`${field}:\\s*'([^']*)'`))
  if (direct) return direct[1]
  const doubleQuoted = block.match(new RegExp(`${field}:\\s*"([^"]*)"`))
  if (doubleQuoted) return doubleQuoted[1]
  const multiline = block.match(new RegExp(`${field}:\\s*([\\s\\S]*?)(?:,\\n\\s*[a-zA-Z_]|,\\n\\s*\\)|\\n\\s*\\))`))
  if (!multiline) return null
  const pieces = [...multiline[1].matchAll(/'([^']*)'/g)].map((match) => match[1])
  return pieces.length ? pieces.join('') : null
}

function readEnumField(block, field, enumName) {
  const match = block.match(new RegExp(`${field}:\\s*${enumName}\\.([a-zA-Z0-9_]+)`))
  return match?.[1] ?? null
}

function toWireStatus(value) {
  return ({
    supported: 'supported',
    disabled: 'disabled',
    credentialGated: 'credential-gated',
    quotaGated: 'quota-gated',
    transportUnstable: 'transport-unstable',
    notSupported: 'not-supported',
    outputOnly: 'output-only',
    globalOnly: 'global-only',
  })[value] ?? value
}

function normalizeMobileProvider(provider) {
  const map = {
    eastmoneyDirect: 'eastmoney',
    yfinance: 'yahoo',
  }
  return map[provider] ?? provider
}

function normalizeProvider(provider) {
  if (provider === 'yfinance') return 'yahoo'
  return provider
}

function denormalizeProvider(provider) {
  if (provider === 'yahoo') return 'yfinance'
  return provider
}

function escapePipe(value) {
  return String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim()
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    const raw = item.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) parsed[raw.slice(0, eq)] = raw.slice(eq + 1)
    else if (i + 1 < values.length && !values[i + 1].startsWith('--')) parsed[raw] = values[++i]
    else parsed[raw] = 'true'
  }
  return parsed
}
