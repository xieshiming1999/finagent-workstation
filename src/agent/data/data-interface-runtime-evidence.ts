import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DataFailureActionQueueRow,
  DataProviderGapQueueRow,
  FinanceDataHealthEvidence,
} from './data-interface-health'

export interface RuntimeLiveStatusRow {
  id: string
  capabilityId?: string | null
  provider?: string | null
  family?: string | null
  status?: string | null
  validationState?: string | null
  failureClass?: string | null
  httpStatus?: number | null
  parsedCount?: number | null
  durationMs?: number | null
  providerTime?: string | null
  error?: string | null
  temporaryBlockUntil?: string | null
  routeBlockScope?: string | null
  nextProbeAfter?: string | null
}

export interface RuntimeLiveStatusReport {
  generatedAt?: string
  summary?: {
    total?: number
    passed?: number
    failed?: number
    blocked?: number
    skipped?: number
    credentialGated?: number
    quotaGated?: number
    unsupported?: number
    invalidParameters?: number
    transportOrProviderUnstable?: number
    runtimeBlocked?: number
  }
  byProvider?: Record<string, number>
  passedApis?: RuntimeLiveStatusRow[]
  failures?: RuntimeLiveStatusRow[]
}

export function loadRuntimeLiveStatusReport(basePath?: string | null): RuntimeLiveStatusReport | null {
  if (!basePath) return null
  const filePath = join(basePath, 'data', 'runtime-probes', 'live-status', 'latest.json')
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as RuntimeLiveStatusReport
  } catch {
    return null
  }
}

export function mergeFinanceDataHealthEvidenceWithRuntimeLiveStatus(
  evidence: FinanceDataHealthEvidence | null,
  runtimeLiveStatus: RuntimeLiveStatusReport | null,
): FinanceDataHealthEvidence | null {
  if (!evidence && !runtimeLiveStatus) return null
  if (!runtimeLiveStatus) return evidence

  const base: FinanceDataHealthEvidence = evidence ? {
    ...evidence,
    summary: evidence.summary ? { ...evidence.summary } : undefined,
    interfaceHealth: evidence.interfaceHealth ? [...evidence.interfaceHealth] : undefined,
    providerHealth: evidence.providerHealth ? [...evidence.providerHealth] : undefined,
    liveProviderHealth: evidence.liveProviderHealth ? [...evidence.liveProviderHealth] : undefined,
    datasetHealth: evidence.datasetHealth ? [...evidence.datasetHealth] : undefined,
    providerGapQueue: evidence.providerGapQueue ? evidence.providerGapQueue.map((row) => ({ ...row })) : undefined,
    credentialActivationQueue: evidence.credentialActivationQueue ? evidence.credentialActivationQueue.map((row) => ({ ...row })) : undefined,
    policyDisabledQueue: evidence.policyDisabledQueue ? evidence.policyDisabledQueue.map((row) => ({ ...row })) : undefined,
    failureActionQueue: evidence.failureActionQueue ? evidence.failureActionQueue.map((row) => ({ ...row })) : undefined,
  } : {}

  const allRows = [
    ...(runtimeLiveStatus.passedApis ?? []),
    ...(runtimeLiveStatus.failures ?? []),
  ].filter((row): row is RuntimeLiveStatusRow => Boolean(row?.id))
  const nonPassingCount = allRows.filter((row) => row.status !== 'passed').length
  const byProbeId = new Map(allRows.map((row) => [row.id, row]))

  const overlayGapRows = (rows: DataProviderGapQueueRow[] | undefined): DataProviderGapQueueRow[] | undefined =>
    rows?.map((row) => overlayGapRow(row, row.probeId ? byProbeId.get(row.probeId) ?? null : null))

  base.generatedAt = runtimeLiveStatus.generatedAt ?? base.generatedAt
  base.summary = {
    ...(base.summary ?? {}),
    liveStatusRows: Number(runtimeLiveStatus.summary?.total ?? base.summary?.liveStatusRows ?? 0),
    liveStatusPassed: Number(runtimeLiveStatus.summary?.passed ?? base.summary?.liveStatusPassed ?? 0),
    liveStatusFailedOrBlocked: Number(nonPassingCount),
  }
  base.providerGapQueue = overlayGapRows(base.providerGapQueue)
  base.credentialActivationQueue = overlayGapRows(base.credentialActivationQueue)
  base.policyDisabledQueue = overlayGapRows(base.policyDisabledQueue)
  base.interfaceHealth = overlayInterfaceHealth(base.interfaceHealth, byProbeId)
  base.liveProviderHealth = buildLiveProviderHealth(runtimeLiveStatus)
  base.failureActionQueue = overlayFailureActionQueue(base.failureActionQueue, runtimeLiveStatus.failures ?? [])

  return base
}

function overlayGapRow(
  row: DataProviderGapQueueRow,
  runtimeRow: RuntimeLiveStatusRow | null,
): DataProviderGapQueueRow {
  if (!runtimeRow) return row
  return {
    ...row,
    liveStatus: runtimeRow.status ?? row.liveStatus ?? null,
    liveValidationState: runtimeRow.validationState ?? row.liveValidationState ?? null,
    liveFailureClass: runtimeRow.failureClass ?? row.liveFailureClass ?? null,
    liveHttpStatus: runtimeRow.httpStatus ?? row.liveHttpStatus ?? null,
    liveParsedCount: runtimeRow.parsedCount ?? row.liveParsedCount ?? null,
    liveDurationMs: runtimeRow.durationMs ?? row.liveDurationMs ?? null,
    liveProviderTime: runtimeRow.providerTime ?? row.liveProviderTime ?? null,
    liveError: runtimeRow.error ?? row.liveError ?? null,
  }
}

function overlayInterfaceHealth(
  rows: FinanceDataHealthEvidence['interfaceHealth'],
  byProbeId: Map<string, RuntimeLiveStatusRow>,
): FinanceDataHealthEvidence['interfaceHealth'] {
  return rows?.map((row) => {
    const probeIds = row.liveProbeIds ?? []
    const matched = probeIds
      .map((probeId) => byProbeId.get(probeId))
      .filter((item): item is RuntimeLiveStatusRow => Boolean(item))
    if (matched.length === 0) return row
    const passed = matched.filter((item) => item.status === 'passed').length
    const failures = matched.length - passed
    return {
      ...row,
      passedLiveRows: passed,
      failures,
      healthState: failures > 0 ? 'degraded' : passed > 0 ? 'observed' : row.healthState,
    }
  })
}

function buildLiveProviderHealth(
  runtimeLiveStatus: RuntimeLiveStatusReport,
): FinanceDataHealthEvidence['liveProviderHealth'] {
  const byProvider = new Map<string, RuntimeLiveStatusRow[]>()
  for (const row of [
    ...(runtimeLiveStatus.passedApis ?? []),
    ...(runtimeLiveStatus.failures ?? []),
  ]) {
    const provider = String(row.provider ?? 'unknown')
    const rows = byProvider.get(provider) ?? []
    rows.push(row)
    byProvider.set(provider, rows)
  }
  return [...byProvider.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, rows]) => {
      const passed = rows.filter((row) => row.status === 'passed').length
      const failures = rows.length - passed
      return {
        provider,
        passed,
        liveProbeCount: rows.length,
        failures,
        failureClasses: countBy(rows.filter((row) => row.status !== 'passed').map((row) => row.failureClass ?? 'unknown')),
      }
    })
}

function overlayFailureActionQueue(
  existingRows: DataFailureActionQueueRow[] | undefined,
  liveFailures: RuntimeLiveStatusRow[],
): DataFailureActionQueueRow[] {
  const rows = [...(existingRows ?? [])]
  const indexByProbeId = new Map(
    rows
      .filter((row) => row.probeId)
      .map((row, index) => [String(row.probeId), index]),
  )
  for (const liveRow of liveFailures) {
    const mapped: DataFailureActionQueueRow = {
      id: `failure:${liveRow.id}`,
      probeId: liveRow.id,
      provider: liveRow.provider ?? null,
      family: liveRow.family ?? null,
      status: liveRow.status ?? null,
      validationState: liveRow.validationState ?? null,
      failureClass: liveRow.failureClass ?? null,
      retryPolicy: failureRetryPolicy(liveRow),
      cacheDecision: failureCacheDecision(liveRow),
      presenceReason: liveRow.error ?? failurePresenceReason(liveRow),
      exitCondition: failureExitCondition(liveRow),
      nextAction: failureNextAction(liveRow),
      error: liveRow.error ?? null,
    }
    const index = indexByProbeId.get(liveRow.id)
    if (typeof index === 'number') {
      rows[index] = { ...rows[index], ...mapped }
    } else {
      rows.push(mapped)
    }
  }
  return rows
}

function failureRetryPolicy(row: RuntimeLiveStatusRow): string {
  if (row.failureClass === 'auth_permission') return 'no automatic retry until provider entitlement or permission changes'
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return 'no automatic retry until credential or permission changes'
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return 'no broad retry until quota reset; cache/readback first'
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return 'no retry until adapter or schema contract is fixed'
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return 'serial retry only after provider/network recovery'
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return 'retry only after runtime dependency is restored'
  return 'manual triage required before retry'
}

function failureCacheDecision(row: RuntimeLiveStatusRow): string {
  if (row.failureClass === 'auth_permission') return 'Keep this provider out of live routing until entitlement changes. Use local cache/readback or healthy fallback providers when available.'
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return 'Keep provider gate active and avoid live refresh until credentials or permissions change. Use local cache/readback or healthy fallback providers when available.'
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return 'Do not spend more quota on broad retry; prefer cache/readback and fallback providers. Use local cache/readback or healthy fallback providers when available.'
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return 'Do not persist or reuse new provider output until adapter, parser, normalizer, and readback contract are fixed.'
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return 'Preserve existing cached data; retry only with a bounded serial probe after provider/network recovery. Use local cache/readback or healthy fallback providers when available.'
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return 'Provider refresh is blocked by runtime dependency; use cache/readback until the dependency is restored. Use local cache/readback or healthy fallback providers when available.'
  return 'Classify root cause before widening live routing. Use local cache/readback or healthy fallback providers when available.'
}

function failurePresenceReason(row: RuntimeLiveStatusRow): string {
  const provider = row.provider ?? 'provider'
  if (row.failureClass === 'auth_permission') return `${provider} rejected ${row.id} because the configured credential lacks endpoint entitlement or account permission.`
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return `${provider} failed because credentials or provider permissions are not accepted for ${row.id}.`
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return `${provider} failed because quota or rate limit is exhausted for ${row.id}.`
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return `${provider} response did not satisfy the expected provider/interface contract for ${row.id}.`
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return `${provider} failed due to transport, timeout, or provider instability for ${row.id}.`
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return `${provider} runtime dependency is unavailable for ${row.id}.`
  return `Provider probe ${row.id} failed and requires classified triage before widening use.`
}

function failureExitCondition(row: RuntimeLiveStatusRow): string {
  if (row.failureClass === 'auth_permission') return 'Leaves this queue after endpoint entitlement or account permission changes are verified by the bounded probe, or after this provider capability is reclassified.'
  if (row.failureClass === 'credential-or-permission' || row.validationState === 'credential-gated') return 'Leaves this queue after credential or permission changes are verified by a bounded probe, or after the capability is reclassified as gated, disabled, unsupported, or supported.'
  if (row.failureClass === 'quota-or-rate-limit' || row.validationState === 'quota-gated') return 'Leaves this queue after quota availability is verified or the capability is reclassified with explicit quota policy.'
  if (row.failureClass === 'schema-or-contract' || row.validationState === 'unsupported-by-provider') return 'Leaves this queue after adapter/parser/normalizer contract is fixed and focused readback verification passes, or after the path is marked unsupported/diagnostic.'
  if (row.failureClass === 'transport' || row.failureClass === 'timeout' || row.validationState === 'transport-or-provider-unstable') return 'Leaves this queue after serial retry produces stable evidence or the provider is reclassified as unstable, disabled, unsupported, or gated.'
  if (row.failureClass === 'runtime_unavailable' || row.validationState === 'runtime-blocked') return 'Leaves this queue after the runtime dependency is restored and the registered probe is rerun successfully or reclassified.'
  return 'Leaves this queue after root cause classification, provider evidence update, and focused verification.'
}

function failureNextAction(row: RuntimeLiveStatusRow): string {
  if (row.validationState === 'runtime-blocked' || row.failureClass === 'runtime_unavailable') return `Restore ${row.provider ?? 'provider'} runtime, then retry ${row.id} serially with bounded probe evidence.`
  if (row.validationState === 'transport-or-provider-unstable' || row.failureClass === 'transport' || row.failureClass === 'timeout') return `Retry ${row.id} only after provider/network recovery; keep the failure classified if it repeats.`
  if (row.failureClass === 'auth_permission') return `Do not retry ${row.id} automatically; update provider entitlement/permission, then rerun only this bounded probe and verify readback.`
  if (row.validationState === 'credential-gated' || row.validationState === 'quota-gated') return `Use configured credential/quota gate before retrying ${row.id}.`
  if (row.validationState === 'unsupported-by-provider') return `Keep ${row.id} unsupported or replace it with a provider-supported interface.`
  return `Inspect ${row.id} failure and update provider classification before retrying.`
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1
    return acc
  }, {})
}
