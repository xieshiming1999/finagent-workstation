import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { DataInterfaceHealth, DataProviderGapQueueRow, DataFailureActionQueueRow } from './data-interface-health'

export type RuntimeProbeMode = 'credential' | 'unstable' | 'failures' | 'all'

export interface RuntimeProbeTarget {
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
  recommendedMode: RuntimeProbeMode
  nextAction: string
  sourceQueue: 'credentialActivationQueue' | 'providerGapQueue' | 'failureActionQueue' | 'runtimeCritical'
}

export interface RuntimeProbeProviderPack {
  provider: string
  label: string
  status: 'active' | 'planned' | 'runtime-gated'
  sourceRouteFamilies: string[]
  boundedProbeIds: string[]
  rawEvidenceLocation: string
  timeoutPolicy: string
  concurrencyPolicy: string
  schemaClassification: string
  governanceMapping: string
  promotionRequirements: string[]
  finElectronStatus: string
  finAgentStatus: string
}

export interface RuntimeProbeStatus {
  running: boolean
  mode: RuntimeProbeMode | null
  runId: string | null
  startedAt: string | null
  finishedAt: string | null
  selectedProbeIds: string[]
  selectedTargets: RuntimeProbeTarget[]
  selectedCount: number
  outputPath: string | null
  liveStatusPath: string | null
  summary: Record<string, number> | null
  error: string | null
  availableModes: RuntimeProbeMode[]
  recommendedTargets: RuntimeProbeTarget[]
  blockedTargets: RuntimeProbeTarget[]
  providerProbePacks: RuntimeProbeProviderPack[]
  guidance: {
    progressiveDisclosurePath: string[]
    normalWorkflowRule: string
    rerunPolicy: string
  }
}

interface RuntimeProbeArtifacts {
  rootDir: string
  probeDir: string
  liveStatusDir: string
  statusPath: string
  latestProbePath: string
  latestLiveStatusPath: string
  latestLiveStatusMarkdownPath: string
}

export class FinanceRuntimeProbeService {
  private runningPromise: Promise<RuntimeProbeStatus> | null = null
  private status: RuntimeProbeStatus
  private readonly artifacts: RuntimeProbeArtifacts
  private readonly finElectronDir: string

  constructor(
    private readonly basePath: string,
    private readonly getHealth: () => DataInterfaceHealth,
  ) {
    this.artifacts = buildArtifacts(basePath)
    this.finElectronDir = resolveFinElectronDir()
    this.status = this.loadStatus()
  }

  getStatus(): RuntimeProbeStatus {
    return enrichStatus(this.status, this.getHealth())
  }

  async run(mode: RuntimeProbeMode, requestedProbeIds: string[] = []): Promise<RuntimeProbeStatus> {
    if (this.runningPromise) return this.runningPromise
    const health = this.getHealth()
    const guidance = buildRuntimeProbeGuidance(health)
    const selectedProbeIds = requestedProbeIds.length > 0 ? [...new Set(requestedProbeIds)].sort() : selectProbeIds(mode, guidance.recommendedTargets)
    const selectedTargets = targetsForProbeIds(selectedProbeIds, [
      ...guidance.recommendedTargets,
      ...guidance.blockedTargets,
    ])
    const startedAt = new Date().toISOString()
    this.status = {
      running: true,
      mode,
      runId: runtimeProbeRunId(startedAt),
      startedAt,
      finishedAt: null,
      selectedProbeIds,
      selectedTargets,
      selectedCount: selectedProbeIds.length,
      outputPath: null,
      liveStatusPath: null,
      summary: null,
      error: null,
      ...guidance,
    }
    this.persistStatus()

    this.runningPromise = this.runInternal(mode, selectedProbeIds)
      .then((status) => {
        this.status = status
        this.persistStatus()
        return status
      })
      .catch((error) => {
        this.status = {
          ...this.status,
          running: false,
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
        this.persistStatus()
        return this.status
      })
      .finally(() => {
        this.runningPromise = null
      })
    return this.runningPromise
  }

  private async runInternal(mode: RuntimeProbeMode, selectedProbeIds: string[]): Promise<RuntimeProbeStatus> {
    if (selectedProbeIds.length === 0) {
      return {
        ...this.status,
        running: false,
        finishedAt: new Date().toISOString(),
        summary: { total: 0, passed: 0 },
        error: null,
      }
    }

    mkdirSync(this.artifacts.probeDir, { recursive: true })
    mkdirSync(this.artifacts.liveStatusDir, { recursive: true })
    const stampedProbePath = join(this.artifacts.probeDir, `probe-${new Date().toISOString().replaceAll(':', '-')}.json`)
    if (process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE === '1') {
      const summary = { total: selectedProbeIds.length, passed: selectedProbeIds.length, failed: 0 }
      const rows = selectedProbeIds.map((probeId) => ({
        probeId,
        status: 'passed',
        provider: providerFromProbeId(probeId),
        fixture: true,
      }))
      writeFileSync(stampedProbePath, `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf-8')
      copyFileContents(stampedProbePath, this.artifacts.latestProbePath)
      writeFileSync(this.artifacts.latestLiveStatusPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf-8')
      writeFileSync(
        this.artifacts.latestLiveStatusMarkdownPath,
        [
          '# Runtime Probe Fixture Evidence',
          '',
          `Total: ${summary.total}`,
          `Passed: ${summary.passed}`,
          '',
          ...rows.map((row) => `- ${row.probeId}: ${row.status}`),
          '',
        ].join('\n'),
        'utf-8',
      )
      return {
        running: false,
        mode,
        runId: this.status.runId,
        startedAt: this.status.startedAt,
        finishedAt: new Date().toISOString(),
        selectedProbeIds,
        selectedTargets: this.status.selectedTargets,
        selectedCount: selectedProbeIds.length,
        outputPath: this.artifacts.latestProbePath,
        liveStatusPath: this.artifacts.latestLiveStatusPath,
        summary,
        error: null,
        availableModes: this.status.availableModes,
        recommendedTargets: this.status.recommendedTargets,
        blockedTargets: this.status.blockedTargets,
        providerProbePacks: this.status.providerProbePacks,
        guidance: this.status.guidance,
      }
    }
    await runNodeScript(this.finElectronDir, 'scripts/finance_live_probe_matrix.mjs', [
      '--stage', 'standard',
      '--wait-ms', '750',
      '--no-fail-on-error', 'true',
      '--output', stampedProbePath,
      '--ids', selectedProbeIds.join(','),
    ])
    copyFileContents(stampedProbePath, this.artifacts.latestProbePath)
    await runNodeScript(this.finElectronDir, 'scripts/finance_live_status_report.mjs', [
      '--inputDir', this.artifacts.probeDir,
      '--json', this.artifacts.latestLiveStatusPath,
      '--md', this.artifacts.latestLiveStatusMarkdownPath,
    ])
    const liveStatus = JSON.parse(readFileSync(this.artifacts.latestLiveStatusPath, 'utf-8')) as { summary?: Record<string, number> }
    return {
      running: false,
      mode,
      runId: this.status.runId,
      startedAt: this.status.startedAt,
      finishedAt: new Date().toISOString(),
      selectedProbeIds,
      selectedTargets: this.status.selectedTargets,
      selectedCount: selectedProbeIds.length,
      outputPath: this.artifacts.latestProbePath,
      liveStatusPath: this.artifacts.latestLiveStatusPath,
      summary: liveStatus.summary ?? null,
      error: null,
      availableModes: this.status.availableModes,
      recommendedTargets: this.status.recommendedTargets,
      blockedTargets: this.status.blockedTargets,
      providerProbePacks: this.status.providerProbePacks,
      guidance: this.status.guidance,
    }
  }

  private loadStatus(): RuntimeProbeStatus {
    if (!existsSync(this.artifacts.statusPath)) {
      return emptyStatus()
    }
    try {
      const parsed = JSON.parse(readFileSync(this.artifacts.statusPath, 'utf-8')) as RuntimeProbeStatus
      return {
        ...emptyStatus(),
        ...parsed,
        running: false,
        selectedProbeIds: Array.isArray(parsed.selectedProbeIds) ? parsed.selectedProbeIds : [],
        selectedTargets: Array.isArray(parsed.selectedTargets) ? parsed.selectedTargets : [],
      }
    } catch {
      return emptyStatus()
    }
  }

  private persistStatus(): void {
    mkdirSync(dirname(this.artifacts.statusPath), { recursive: true })
    writeFileSync(this.artifacts.statusPath, `${JSON.stringify(this.status, null, 2)}\n`, 'utf-8')
  }
}

function buildArtifacts(basePath: string): RuntimeProbeArtifacts {
  const rootDir = join(basePath, 'data', 'runtime-probes')
  const probeDir = join(rootDir, 'matrix')
  const liveStatusDir = join(rootDir, 'live-status')
  return {
    rootDir,
    probeDir,
    liveStatusDir,
    statusPath: join(rootDir, 'status.json'),
    latestProbePath: join(probeDir, 'latest.json'),
    latestLiveStatusPath: join(liveStatusDir, 'latest.json'),
    latestLiveStatusMarkdownPath: join(liveStatusDir, 'latest.md'),
  }
}

function emptyStatus(): RuntimeProbeStatus {
  return {
    running: false,
    mode: null,
    runId: null,
    startedAt: null,
    finishedAt: null,
    selectedProbeIds: [],
    selectedTargets: [],
    selectedCount: 0,
    outputPath: null,
    liveStatusPath: null,
    summary: null,
    error: null,
    ...emptyGuidance(),
  }
}

function selectProbeIds(mode: RuntimeProbeMode, targets: RuntimeProbeTarget[]): string[] {
  return [...new Set(
    targets
      .filter((target) => mode === 'all' || target.recommendedMode === mode)
      .map((target) => target.probeId)
      .filter(Boolean),
  )].sort()
}

export function buildRuntimeProbeGuidance(health: DataInterfaceHealth): Pick<RuntimeProbeStatus, 'availableModes' | 'recommendedTargets' | 'blockedTargets' | 'providerProbePacks' | 'guidance'> {
  const recommendedTargets = dedupeTargets([
    ...health.credentialActivationQueue.flatMap((row) => targetFromCredentialRow(row)),
    ...health.providerGapQueue.flatMap((row) => targetFromProviderGapRow(row)),
    ...health.failureActionQueue.flatMap((row) => targetFromFailureRow(row)),
    ...routingCriticalTargets(health),
  ])
  const blockedTargets = dedupeTargets([
    ...health.credentialActivationQueue.flatMap((row) => blockedTargetFromCredentialRow(row)),
    ...health.policyDisabledQueue.flatMap((row) => blockedTargetFromGapRow(row, 'policy-disabled')),
    ...health.providerGapQueue.flatMap((row) => blockedTargetFromGapRow(row, 'not-actionable-gap')),
    ...health.failureActionQueue.flatMap((row) => blockedTargetFromFailureRow(row)),
  ])
  return {
    availableModes: ['credential', 'unstable', 'failures', 'all'],
    recommendedTargets,
    blockedTargets,
    providerProbePacks: providerProbePacks(),
    guidance: {
      progressiveDisclosurePath: ['interfaces', 'interface_describe', 'interface_availability', 'data_health', 'runtime_probe'],
      normalWorkflowRule: 'Use cache/readback or validated provider routes first. Do not use unsupported, deferred, reference-only, or unknown-schema routes as normal workflow.',
      rerunPolicy: 'Run only recommended or explicitly selected bounded probe IDs. Do not broad-probe on startup or retry provider-rejected routes.',
    },
  }
}

function enrichStatus(status: RuntimeProbeStatus, health: DataInterfaceHealth): RuntimeProbeStatus {
  return {
    ...status,
    selectedProbeIds: [...status.selectedProbeIds],
    selectedTargets: [...(status.selectedTargets ?? [])],
    ...buildRuntimeProbeGuidance(health),
  }
}

function emptyGuidance(): Pick<RuntimeProbeStatus, 'availableModes' | 'recommendedTargets' | 'blockedTargets' | 'providerProbePacks' | 'guidance'> {
  return {
    availableModes: ['credential', 'unstable', 'failures', 'all'],
    recommendedTargets: [],
    blockedTargets: [],
    providerProbePacks: providerProbePacks(),
    guidance: {
      progressiveDisclosurePath: ['interfaces', 'interface_describe', 'interface_availability', 'data_health', 'runtime_probe'],
      normalWorkflowRule: 'Use governed interfaces and validated provider evidence before live provider calls.',
      rerunPolicy: 'Run bounded probes only when current health or explicit user selection justifies them.',
    },
  }
}

function targetFromCredentialRow(row: DataProviderGapQueueRow): RuntimeProbeTarget[] {
  if (!row.probeId || row.activationState === 'credential-missing') return []
  return [buildTarget({
    row,
    probeId: row.probeId,
    currentStatus: row.liveStatus ?? row.activationState ?? row.status,
    reason: row.reason ?? 'Credential or quota-gated capability has configuration/evidence that can be revalidated.',
    expectedExitCondition: 'Leaves credential action list when live validation passes, or when provider reports permission/quota/config failure.',
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'credential',
    sourceQueue: 'credentialActivationQueue',
    riskPolicy: 'Credential/quota scoped; run only selected capability probes.',
    nextAction: row.nextAction ?? 'Run credential probe after confirming credentials/quota are configured.',
  })]
}

function targetFromProviderGapRow(row: DataProviderGapQueueRow): RuntimeProbeTarget[] {
  if (!row.probeId || row.gapClass !== 'serial-live-retry') return []
  return [buildTarget({
    row,
    probeId: row.probeId,
    currentStatus: row.liveStatus ?? row.status,
    reason: row.reason ?? 'Provider gap has a registered serial live probe and needs fresh evidence.',
    expectedExitCondition: 'Leaves provider gap after live evidence validates the route, or after failure is classified as provider/runtime/schema work.',
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'unstable',
    sourceQueue: 'providerGapQueue',
    riskPolicy: 'Transport/schema validation; serial probe only.',
    nextAction: row.nextAction ?? 'Run unstable probe, then inspect data_health/interface_availability.',
  })]
}

function targetFromFailureRow(row: DataFailureActionQueueRow): RuntimeProbeTarget[] {
  if (!row.probeId) return []
  if (!isFailureProbeRetryCandidate(row)) return []
  return [{
    interfaceId: row.affectedInterfaces?.[0] ?? null,
    provider: row.provider ?? 'unknown',
    capabilityId: row.capabilityId ?? row.affectedCapabilities?.[0]?.capabilityId ?? null,
    probeId: row.probeId,
    currentStatus: row.status ?? row.validationState ?? row.failureClass ?? 'failed',
    reason: row.reason ?? row.error ?? 'A classified failure has a registered probe that can be rechecked.',
    expectedExitCondition: 'Leaves failure action list when fresh evidence passes or the failure is reclassified as non-retryable implementation/provider work.',
    riskPolicy: 'Failure retry; run bounded probe only, keep cache/readback first.',
    timeoutPolicy: timeoutPolicyForProvider(row.provider ?? null),
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'failures',
    nextAction: row.nextAction ?? 'Run failure probe, then inspect refreshed failure class and route readiness.',
    sourceQueue: 'failureActionQueue',
  }]
}

function isFailureProbeRetryCandidate(row: DataFailureActionQueueRow): boolean {
  if (!row.probeId) return false
  const failureClass = normalizedPolicyText(row.failureClass)
  const validationState = normalizedPolicyText(row.validationState)
  const retryPolicy = normalizedPolicyText(row.retryPolicy)
  if (
    retryPolicy.includes('do-not-retry') ||
    retryPolicy.includes('no retry') ||
    retryPolicy.includes('no automatic retry') ||
    retryPolicy.includes('no broad retry')
  ) {
    return false
  }
  if (
    failureClass.includes('provider_rejected') ||
    failureClass.includes('unsupported') ||
    failureClass.includes('schema-or-contract') ||
    failureClass.includes('credential-or-permission') ||
    failureClass.includes('quota-or-rate-limit') ||
    validationState.includes('unsupported') ||
    validationState.includes('credential-gated') ||
    validationState.includes('quota-gated')
  ) {
    return false
  }
  if (
    failureClass.includes('transport') ||
    failureClass.includes('timeout') ||
    failureClass.includes('runtime_unavailable') ||
    validationState.includes('transport-or-provider-unstable') ||
    validationState.includes('runtime-blocked')
  ) {
    return true
  }
  return retryPolicy.includes('serial retry') || retryPolicy.includes('bounded probe')
}

function normalizedPolicyText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function routingCriticalTargets(health: DataInterfaceHealth): RuntimeProbeTarget[] {
  const critical = new Set(['stock.quote', 'index.quote', 'fund.etf_quote', 'news.finance_feed', 'stock.daily_kline', 'index.daily_kline'])
  const targets: RuntimeProbeTarget[] = []
  for (const row of health.rows) {
    if (!critical.has(row.interfaceId)) continue
    if (row.liveStatus === 'passed') continue
    for (const probeId of row.liveProbeIds ?? []) {
      targets.push({
        interfaceId: row.interfaceId,
        provider: row.supportedProviders[0] ?? row.gatedProviders[0] ?? 'unknown',
        capabilityId: row.capabilities.find((capability) => capability.probeId === probeId)?.capabilityId ?? null,
        probeId,
        currentStatus: row.liveStatus ?? row.health,
        reason: 'Routing-critical interface lacks fresh passed runtime evidence.',
        expectedExitCondition: 'Runtime evidence passes, or the interface remains cache/readback/fallback-first until a provider route is validated.',
        riskPolicy: 'Routing-critical bounded probe; keep provider-specific limits.',
        timeoutPolicy: timeoutPolicyForProvider(row.supportedProviders[0] ?? null),
        normalWorkflowAllowedBeforeSuccess: row.localRows > 0,
        recommendedMode: 'all',
        nextAction: 'Run bounded probe only if live route freshness is needed; otherwise prefer cache/readback.',
        sourceQueue: 'runtimeCritical',
      })
    }
  }
  return targets
}

function blockedTargetFromCredentialRow(row: DataProviderGapQueueRow): RuntimeProbeTarget[] {
  if (!row.probeId || row.activationState !== 'credential-missing') return []
  return [buildTarget({
    row,
    probeId: row.probeId,
    currentStatus: row.activationState,
    reason: 'Credential is missing; live probe would only confirm missing configuration.',
    expectedExitCondition: 'Configure credential/quota, then run credential probe.',
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'credential',
    sourceQueue: 'credentialActivationQueue',
    riskPolicy: 'Blocked before network call.',
    nextAction: row.nextAction ?? 'Configure credential before probing.',
  })]
}

function blockedTargetFromGapRow(row: DataProviderGapQueueRow, label: string): RuntimeProbeTarget[] {
  if (!row.probeId) return []
  if (row.gapClass === 'serial-live-retry') return []
  if (!['disabled', 'not-supported', 'credential-gated', 'quota-gated', 'output-only', 'deferred'].includes(row.status) && label !== 'policy-disabled') return []
  return [buildTarget({
    row,
    probeId: row.probeId,
    currentStatus: row.liveStatus ?? row.status,
    reason: row.reason ?? `${label} is not a runtime-probe candidate without implementation/configuration change.`,
    expectedExitCondition: 'Reclassify capability, implement route/normalizer/readback, or configure required provider state before probing.',
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'all',
    sourceQueue: 'providerGapQueue',
    riskPolicy: 'Blocked to avoid repeating known non-actionable provider calls.',
    nextAction: row.nextAction ?? 'Do not probe as normal workflow; resolve the listed implementation or policy gap first.',
  })]
}

function blockedTargetFromFailureRow(row: DataFailureActionQueueRow): RuntimeProbeTarget[] {
  if (!row.probeId || isFailureProbeRetryCandidate(row)) return []
  return [{
    interfaceId: row.affectedInterfaces?.[0] ?? row.interfaceId ?? null,
    provider: row.provider ?? 'unknown',
    capabilityId: row.capabilityId ?? row.affectedCapabilities?.[0]?.capabilityId ?? null,
    probeId: row.probeId,
    currentStatus: row.status ?? row.validationState ?? row.failureClass ?? 'blocked',
    reason: row.reason ?? row.error ?? 'Classified failure is not retryable until its root cause changes.',
    expectedExitCondition: row.exitCondition ?? 'Root cause changes, implementation is fixed, or the path is reclassified before probing again.',
    riskPolicy: 'Blocked from runtime_probe retry selection; resolve root cause before probing.',
    timeoutPolicy: timeoutPolicyForProvider(row.provider ?? null),
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'failures',
    nextAction: row.nextAction ?? 'Do not retry this probe until the listed root cause is fixed or reclassified.',
    sourceQueue: 'failureActionQueue',
  }]
}

function buildTarget(args: {
  row: DataProviderGapQueueRow
  probeId: string
  currentStatus: string
  reason: string
  expectedExitCondition: string
  normalWorkflowAllowedBeforeSuccess: boolean
  recommendedMode: RuntimeProbeMode
  sourceQueue: RuntimeProbeTarget['sourceQueue']
  riskPolicy: string
  nextAction: string
}): RuntimeProbeTarget {
  return {
    interfaceId: args.row.interfaceId,
    provider: args.row.provider,
    capabilityId: args.row.capabilityId ?? null,
    probeId: args.probeId,
    currentStatus: args.currentStatus,
    reason: args.reason,
    expectedExitCondition: args.expectedExitCondition,
    riskPolicy: args.riskPolicy,
    timeoutPolicy: timeoutPolicyForProvider(args.row.provider),
    normalWorkflowAllowedBeforeSuccess: args.normalWorkflowAllowedBeforeSuccess,
    recommendedMode: args.recommendedMode,
    nextAction: args.nextAction,
    sourceQueue: args.sourceQueue,
  }
}

function targetsForProbeIds(probeIds: string[], targets: RuntimeProbeTarget[]): RuntimeProbeTarget[] {
  const byId = new Map(targets.map((target) => [target.probeId, target]))
  return probeIds.map((probeId) => byId.get(probeId) ?? {
    interfaceId: null,
    provider: providerFromProbeId(probeId),
    capabilityId: null,
    probeId,
    currentStatus: 'explicit-selection',
    reason: 'Explicit user/agent selected bounded probe ID.',
    expectedExitCondition: 'Probe run writes durable evidence or reports unsupported/failed status.',
    riskPolicy: 'Explicit bounded probe selection; no arbitrary endpoint discovery.',
    timeoutPolicy: timeoutPolicyForProvider(providerFromProbeId(probeId)),
    normalWorkflowAllowedBeforeSuccess: false,
    recommendedMode: 'all',
    nextAction: 'Run selected probe, then inspect data_health/interface_availability.',
    sourceQueue: 'runtimeCritical',
  })
}

function dedupeTargets(targets: RuntimeProbeTarget[]): RuntimeProbeTarget[] {
  const seen = new Set<string>()
  const result: RuntimeProbeTarget[] = []
  for (const target of targets) {
    if (!target.probeId || seen.has(target.probeId)) continue
    seen.add(target.probeId)
    result.push(target)
  }
  return result.sort((a, b) => a.provider.localeCompare(b.provider) || a.probeId.localeCompare(b.probeId))
}

function providerFromProbeId(probeId: string): string {
  if (probeId.includes('.')) return probeId.split('.')[0]
  if (probeId.includes('_')) return probeId.split('_')[0]
  return 'unknown'
}

function timeoutPolicyForProvider(provider: string | null): string {
  switch ((provider ?? '').toLowerCase()) {
    case 'eastmoney':
    case 'akshare':
      return 'serial, provider-aware timeout; EastMoney/AkShare may need longer timeout.'
    case 'wind':
    case 'tushare':
      return 'serial credential/quota-aware probe; stop on quota or permission block.'
    case 'tdx':
      return 'serial local/sidecar probe; classify parser/runtime separately.'
    default:
      return 'serial bounded probe with default runtime timeout.'
  }
}

function providerProbePacks(): RuntimeProbeProviderPack[] {
  const promotionRequirements = ['interface contract', 'provider capability', 'adapter/normalizer', 'cache/readback', 'provenance fields', 'focused tests', 'cross-runtime status']
  return [
    {
      provider: 'tencent',
      label: 'Tencent Finance direct and Tencent-origin routes',
      status: 'active',
      sourceRouteFamilies: ['qt.gtimg.cn quote', 'proxy.finance.qq.com rank/kline', 'stock.gtimg.cn transactions/AH', 'web.ifzq.gtimg.cn HK/reference'],
      boundedProbeIds: [
        'tencent.direct.stock_quote',
        'tencent.direct.index_quote',
        'tencent.direct.fund_etf_quote',
        'tencent.direct.stock_rank_list',
        'tencent.direct.stock_daily_kline',
        'tencent.direct.stock_transactions',
        'tencent.quote.listed_fund_batch',
        'tencent.quote.convertible_bond_batch',
        'tencent.kline.convertible_bond_none',
        'tencent.kline.etf_none',
        'tencent.transactions.etf_page_0',
      ],
      rawEvidenceLocation: 'reports/integrations/tencent-broad-raw-2026-06-23/',
      timeoutPolicy: 'serial, 750ms wait in runtime matrix; no broad startup probe',
      concurrencyPolicy: 'concurrency 1 for runtime live probes',
      schemaClassification: 'supported, typed-output-only, deferred, reference-only, unsupported',
      governanceMapping: 'Supported interfaces enter normal workflow only after capability, normalizer, persistence/readback, provenance, and tests are present; remaining broad discovery rows stay evidence-only until promoted.',
      promotionRequirements,
      finElectronStatus: '13 governed Tencent provider capabilities under interface contracts; HK/US quote is global-only under stock.quote, while HK K-line, AH rows, and provider metadata remain evidence-only until promoted.',
      finAgentStatus: 'stock.quote includes A-share and global-only Tencent HK/US quote capabilities; index.quote, bounded fund.etf_quote, bounded fund.listed_fund_quote, unadjusted ETF daily OHLCV, ETF transactions, convertible-bond quote, and unadjusted convertible-bond daily K-line are supported; adjusted ETF/convertible-bond daily K-line, HK K-line, and AH routes remain explicit not-supported/deferred until native adapters exist.',
    },
    {
      provider: 'sina',
      label: 'Sina Finance direct and wrapper-origin routes',
      status: 'active',
      sourceRouteFamilies: ['direct Sina quote/kline/news/sector/transactions', 'AkShare *_sina wrapper reference rows'],
      boundedProbeIds: ['sina.direct.stock_quote', 'sina.direct.index_quote', 'sina.direct.stock_daily_kline', 'sina.direct.stock_transactions', 'sina.direct.news_finance_feed'],
      rawEvidenceLocation: 'reports/integrations/sina-wrapper-reprobe-raw/',
      timeoutPolicy: 'serial direct probes; wrapper references stay bounded and source-labeled',
      concurrencyPolicy: 'concurrency 1 for live/provider verification',
      schemaClassification: 'supported, output-only, wrapper-reference, deferred, failed/diagnostic',
      governanceMapping: 'Direct Sina capabilities can enter normal workflow only through interfaces; wrapper evidence remains AkShare/Sina-origin unless promoted.',
      promotionRequirements,
      finElectronStatus: '11 governed Sina interfaces plus output-only intraday OHLCV, transaction-count, classification/ESG, and fund dividend/factor evidence; direct Sina ETF daily K-line remains not-supported until a native decoder exists.',
      finAgentStatus: 'aligned governed interfaces where native; wrapper/batch paths explicit bounded evidence or not-supported',
    },
    {
      provider: 'wind',
      label: 'Wind professional credential-gated data',
      status: 'runtime-gated',
      sourceRouteFamilies: ['Wind AIFinMarket JSON-RPC tools'],
      boundedProbeIds: ['wind.* credential/quota live probes from provider matrix'],
      rawEvidenceLocation: 'data/runtime-probes/live-status/latest.json',
      timeoutPolicy: 'serial credential/quota-aware; stop broad collection on quota/permission block',
      concurrencyPolicy: 'credential-gated probes only when configured or explicitly selected',
      schemaClassification: 'supported, credential-gated, quota-gated, output-only diagnostic',
      governanceMapping: 'Credential-gated rows must validate before normal live route; cache/readback first when blocked.',
      promotionRequirements,
      finElectronStatus: 'credential-gated professional data provider with canonical normalizers for known schemas',
      finAgentStatus: 'same interface IDs with native WindMcp behavior where available',
    },
  ]
}

function runtimeProbeRunId(startedAt: string): string {
  return `runtime-probe-${startedAt.replace(/[:.]/g, '-')}`
}

function runNodeScript(cwd: string, scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(stderr.trim() || `Script failed with exit code ${code}`))
    })
  })
}

function copyFileContents(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, readFileSync(sourcePath))
}

function resolveFinElectronDir(): string {
  const candidates = [
    resolve(process.cwd()),
    resolve(process.cwd(), 'finagent_workstation'),
    resolve(__dirname, '..', '..', '..'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'scripts', 'finance_live_probe_matrix.mjs'))) return candidate
  }
  throw new Error('Could not locate finagent_workstation runtime scripts directory.')
}
