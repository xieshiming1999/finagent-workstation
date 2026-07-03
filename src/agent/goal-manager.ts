import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { ArtifactRegistry } from './artifact-registry'
import {
  goalContinuationPrompt,
  goalContinuationPromptWithSubgoals,
  goalCopy as runtimeGoalCopy,
} from './runtime-copy'
import type {
  GoalArtifact,
  GoalAutomationInfo,
  GoalSetOptions,
  GoalTemplateId,
  GoalVerifierResult,
  GoalWorkPacket,
} from './goal-automation-types'

const DEFAULT_MAX_TURNS = 20
const MAX_CONSECUTIVE_PARSE_FAILURES = 3

export interface GoalState {
  goal: string
  status: GoalStatus
  turnsUsed: number
  maxTurns: number
  createdAt: number
  updatedAt: number
  elapsedMs: number
  promptTokensUsed: number
  completionTokensUsed: number
  tokensUsed: number
  tokenBudget: number | null
  lastTurnAt: number
  lastVerdict: 'done' | 'continue' | 'skipped' | null
  lastReason: string | null
  pausedReason: string | null
  consecutiveParseFailures: number
  subgoals: string[]
  successCriteria: string[]
  checkpoint: string | null
  verifierResult: GoalVerifierResult | null
  templateId: GoalTemplateId | null
  automation: GoalAutomationInfo | null
  contextPackPath: string | null
  artifact: GoalArtifact
  workPacket: GoalWorkPacket | null
}

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'budget_limited' | 'done' | 'cleared'

export interface GoalDecision {
  status: string
  shouldContinue: boolean
  continuationPrompt: string | null
  verdict: 'done' | 'blocked' | 'continue' | 'skipped' | 'inactive'
  reason: string
  message: string
}

export type GoalJudgment = {
  outcome: 'continue' | 'complete' | 'blocked'
  reason: string
  parseFailed: boolean
  progressKind: 'unknown' | 'progress_only' | 'implementation' | 'verification' | 'blocked'
  progressSummary: string | null
  evidence: string[]
  safetyBoundary: 'no_side_effect' | 'approved_side_effect' | 'not_applicable'
}

export type JudgeFn = (goal: string, response: string, subgoals?: string[]) => Promise<GoalJudgment>
export type VerifierFn = (state: GoalState, judgment: GoalJudgment) => Promise<GoalVerifierResult>

function goalCopy() {
  return {
    ...runtimeGoalCopy,
    invalidIndex: runtimeGoalCopy.invalidIndex,
    subgoalTextEmpty: runtimeGoalCopy.subgoalTextEmpty,
  }
}

export class GoalManager {
  private state: GoalState | null = null
  private readonly filePath: string

  constructor(basePath: string) {
    this.filePath = join(basePath, 'memory', 'goal-state.json')
    this.load()
  }

  // --- State queries ---

  isActive(): boolean {
    return this.state !== null && this.state.status === 'active'
  }

  hasGoal(): boolean {
    return this.state !== null && (this.state.status === 'active' || this.state.status === 'paused' || this.state.status === 'blocked' || this.state.status === 'budget_limited')
  }

  getState(): GoalState | null {
    return this.state
  }

  statusLine(): string {
    const copy = goalCopy()
    if (!this.state) return copy.noGoalSet()
    const s = this.state
    const statusIcon = s.status === 'active' ? '⊙' : s.status === 'paused' ? '⏸' : s.status === 'blocked' ? '!' : s.status === 'budget_limited' ? '◷' : s.status === 'done' ? '✓' : '✗'
    const subgoalInfo = s.subgoals.length > 0 ? `, ${s.subgoals.length} ${copy.subgoalsLabel()}` : ''
    const reasonInfo = s.lastReason ? ` — ${s.lastReason}` : ''
    const pauseInfo = s.pausedReason ? ` (${s.pausedReason})` : ''
    const elapsedInfo = `, ${copy.elapsedLabel()} ${formatDuration(this.elapsedMs())}`
    const tokenInfo = s.tokensUsed > 0 || s.tokenBudget ? `, ${copy.tokensLabel()} ${formatTokenUsage(s)}` : ''
    return `${statusIcon} ${copy.statusLabel()} [${copy.statusName(s.status)}] ${s.turnsUsed}/${s.maxTurns} ${copy.turnsLabel()}${elapsedInfo}${tokenInfo}${subgoalInfo}${pauseInfo}${reasonInfo}\n  ${s.goal}`
  }

  // --- Mutations ---

  set(goal: string, maxTurns: number = DEFAULT_MAX_TURNS, options: GoalSetOptions = {}): GoalState {
    goal = goal.trim()
    if (!goal) throw new Error(goalCopy().goalTextEmpty())

    const now = Date.now()
    const artifact = normalizeGoalArtifact(goal, options, now)
    this.state = {
      goal,
      status: 'active',
      turnsUsed: 0,
      maxTurns,
      createdAt: now,
      updatedAt: now,
      elapsedMs: 0,
      promptTokensUsed: 0,
      completionTokensUsed: 0,
      tokensUsed: 0,
      tokenBudget: normalizeOptionalPositiveNumber(options.tokenBudget),
      lastTurnAt: 0,
      lastVerdict: null,
      lastReason: null,
      pausedReason: null,
      consecutiveParseFailures: 0,
      subgoals: [],
      successCriteria: options.successCriteria ?? [],
      checkpoint: options.checkpoint ?? null,
      verifierResult: options.verifierResult ?? null,
      templateId: options.templateId ?? null,
      automation: options.automation ?? null,
      contextPackPath: options.contextPackPath ?? null,
      artifact,
      workPacket: null,
    }
    this.save()
    this.registerGoalArtifacts(artifact)
    return this.state
  }

  private registerGoalArtifacts(artifact: GoalArtifact): void {
    const registry = new ArtifactRegistry(dirname(dirname(this.filePath)))
    registry.register({
      kind: 'goal',
      path: this.filePath,
      title: artifact.objective,
      source: artifact.source,
      id: `goal:${artifact.createdAt}`,
      ownerTask: artifact.objective,
      verificationStatus: 'unverified',
      freshness: {
        sourceTime: artifactTime(artifact.createdAt),
        fetchedAt: artifactTime(artifact.updatedAt),
        status: 'fresh',
      },
      provenance: {
        source: artifact.source,
        artifactType: 'goal',
      },
      metadata: {
        scope: artifact.scope,
        doneCriteria: artifact.doneCriteria,
        allowedTools: artifact.allowedTools,
      },
    })
    if (artifact.planSnapshot?.trim()) {
      registry.register({
        kind: 'plan_snapshot',
        path: this.filePath,
        title: 'Plan snapshot for goal',
        source: artifact.source,
        id: `plan_snapshot:${artifact.createdAt}`,
        ownerTask: artifact.objective,
        verificationStatus: 'unverified',
        freshness: {
          sourceTime: artifactTime(artifact.createdAt),
          fetchedAt: artifactTime(artifact.updatedAt),
          status: 'fresh',
        },
        provenance: {
          source: artifact.source,
          artifactType: 'plan_snapshot',
          goalArtifactId: `goal:${artifact.createdAt}`,
        },
        metadata: {
          objective: artifact.objective,
          planSnapshot: artifact.planSnapshot,
          goalArtifactId: `goal:${artifact.createdAt}`,
        },
      })
    }
  }

  pause(reason: string = goalCopy().pausedByUser()): void {
    if (!this.state) return
    this.state.status = 'paused'
    this.state.pausedReason = reason
    this.save()
  }

  markBudgetLimited(reason: string): void {
    if (!this.state) return
    this.state.status = 'budget_limited'
    this.state.pausedReason = reason
    this.state.lastVerdict = 'continue'
    this.state.lastReason = reason
    this.save()
  }

  markBlocked(reason: string): void {
    if (!this.state) return
    this.state.status = 'blocked'
    this.state.pausedReason = reason
    this.state.lastVerdict = 'done'
    this.state.lastReason = reason
    this.state.verifierResult = {
      status: 'unchecked',
      checkedAt: Date.now(),
      reason: `Goal blocked before independent verifier: ${reason}`,
      evidence: this.state.contextPackPath ? [this.state.contextPackPath] : [],
    }
    this.save()
  }

  resume(resetBudget: boolean = true): void {
    if (!this.state) return
    this.state.status = 'active'
    this.state.pausedReason = null
    if (resetBudget) this.state.turnsUsed = 0
    this.save()
  }

  clear(): void {
    if (!this.state) return
    this.state.status = 'cleared'
    this.save()
    this.state = null
  }

  markDone(reason: string, verifierResult?: GoalVerifierResult): void {
    if (!this.state) return
    this.state.status = 'done'
    this.state.lastVerdict = 'done'
    this.state.lastReason = reason
    this.state.verifierResult = verifierResult ?? {
      status: 'unchecked',
      checkedAt: Date.now(),
      reason: `LLM judge marked done before independent verifier: ${reason}`,
      evidence: this.state.contextPackPath ? [this.state.contextPackPath] : [],
    }
    this.save()
  }

  updateVerifierResult(result: GoalVerifierResult): void {
    if (!this.state) return
    this.state.verifierResult = result
    this.save()
  }

  recordTokenUsage(promptTokens: number, completionTokens: number): void {
    if (!this.state || (promptTokens <= 0 && completionTokens <= 0)) return
    this.state.promptTokensUsed += Math.max(0, Math.floor(promptTokens))
    this.state.completionTokensUsed += Math.max(0, Math.floor(completionTokens))
    this.state.tokensUsed = this.state.promptTokensUsed + this.state.completionTokensUsed
    this.save()
  }

  // --- Subgoals ---

  addSubgoal(text: string): string {
    if (!this.hasGoal()) throw new Error(goalCopy().noActiveGoal())
    text = text.trim()
    if (!text) throw new Error(goalCopy().subgoalTextEmpty())
    this.state!.subgoals.push(text)
    this.save()
    return text
  }

  removeSubgoal(index1Based: number): string {
    if (!this.state || this.state.subgoals.length === 0) throw new Error(goalCopy().noSubgoals())
    const idx = index1Based - 1
    if (idx < 0 || idx >= this.state.subgoals.length) {
      throw new Error(goalCopy().invalidIndex(this.state.subgoals.length))
    }
    const removed = this.state.subgoals.splice(idx, 1)[0]
    this.save()
    return removed
  }

  clearSubgoals(): number {
    if (!this.state) return 0
    const count = this.state.subgoals.length
    this.state.subgoals = []
    this.save()
    return count
  }

  renderSubgoalsBlock(): string {
    if (!this.state) return ''
    return this.state.subgoals.map((s, i) => `- ${i + 1}. ${s}`).join('\n')
  }

  // --- Core loop driver ---

  async evaluateAfterTurn(lastResponse: string, judgeFn: JudgeFn, verifierFn?: VerifierFn): Promise<GoalDecision> {
    // 1. Check if goal is active
    if (!this.state || this.state.status !== 'active') {
      return {
        status: 'inactive',
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'inactive',
        reason: goalCopy().inactiveReason(),
        message: '',
      }
    }

    // 2. Increment turn counter
    this.state.turnsUsed += 1
    this.state.lastTurnAt = Date.now()

    // 3. Call judge
    const subgoals = this.state.subgoals.length > 0 ? this.state.subgoals : undefined
    const judgment = await judgeFn(this.state.goal, lastResponse, subgoals)
    const done = judgment.outcome === 'complete' || judgment.outcome === 'blocked'
    const { reason, parseFailed } = judgment

    // 4. Store verdict
    this.state.lastVerdict = done ? 'done' : 'continue'
    this.state.lastReason = reason

    // 5. Track parse failures
    if (parseFailed) {
      this.state.consecutiveParseFailures += 1
    } else {
      this.state.consecutiveParseFailures = 0
    }

    // 6. Done?
    if (done) {
      if (judgment.outcome === 'blocked') {
        this.markBlocked(reason)
        return {
          status: 'blocked',
          shouldContinue: false,
          continuationPrompt: null,
          verdict: 'blocked',
          reason,
          message: goalCopy().goalBlocked(reason),
        }
      }
      if (verifierFn) {
        const verifierResult = await verifierFn(this.state, judgment)
        this.state.verifierResult = verifierResult
        if (verifierResult.status !== 'passed') {
          const msg = `verifier ${verifierResult.status}: ${verifierResult.reason}`
          this.pause(msg)
          return {
            status: 'paused',
            shouldContinue: false,
            continuationPrompt: null,
            verdict: 'continue',
            reason: msg,
            message: goalCopy().goalPaused(msg),
          }
        }
        this.markDone(reason, verifierResult)
      } else {
        this.markDone(reason)
      }
      return {
        status: 'done',
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'done',
        reason,
        message: goalCopy().goalComplete(this.state.turnsUsed, this.state.maxTurns, reason),
      }
    }

    // 7. Too many parse failures?
    if (this.state.consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
      const msg = goalCopy().parseFailurePauseReason(this.state.consecutiveParseFailures)
      this.pause(msg)
      return {
        status: 'paused',
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'continue',
        reason: msg,
        message: goalCopy().goalPaused(msg),
      }
    }

    // 8. Budget exhausted?
    if (this.state.turnsUsed >= this.state.maxTurns) {
      const msg = goalCopy().turnBudgetPauseReason(this.state.turnsUsed, this.state.maxTurns)
      this.markBudgetLimited(msg)
      return {
        status: 'budget_limited',
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'continue',
        reason: msg,
        message: goalCopy().goalBudgetLimited(msg),
      }
    }

    // 9. Continue
    this.save()
    this.state.workPacket = this.buildWorkPacket(reason, judgment)
    this.save()
    const continuationPrompt = this.nextContinuationPrompt()
    return {
      status: 'active',
      shouldContinue: true,
      continuationPrompt,
      verdict: 'continue',
      reason,
      message: goalCopy().turnContinuing(this.state.turnsUsed, this.state.maxTurns),
    }
  }

  nextContinuationPrompt(): string | null {
    if (!this.state || this.state.status !== 'active') return null
    const packet = this.state.workPacket ?? this.buildWorkPacket(this.state.lastReason ?? 'Goal is not complete yet.')
    this.state.workPacket = packet
    this.save()
    const packetBlock = renderWorkPacket(packet)
    const artifactBlock = renderGoalArtifact(this.state.artifact)
    if (this.state.subgoals.length > 0) {
      return goalContinuationPromptWithSubgoals(`${this.state.goal}\n\n${artifactBlock}\n\n${packetBlock}`, this.renderSubgoalsBlock())
    }
    return goalContinuationPrompt(`${this.state.goal}\n\n${artifactBlock}\n\n${packetBlock}`)
  }

  private buildWorkPacket(reason: string, judgment?: GoalJudgment): GoalWorkPacket {
    const state = this.state
    if (!state) throw new Error('No active goal state.')
    const artifact = state.artifact
    const criteria = [
      ...artifact.doneCriteria,
      ...state.successCriteria,
      ...state.subgoals,
    ].filter((item) => item.trim())
    const verification = artifact.verification
      ?? (criteria.length > 0 ? `Verify these criteria: ${criteria.join('; ')}` : 'Verify the current turn against the objective and report concrete evidence.')
    const currentGap = reason.trim() || 'The goal has not been verified as complete.'
    const progressKind = judgment?.progressKind ?? 'unknown'
    const nextPrompt = progressKind === 'progress_only'
      ? `The previous turn was progress-only. Produce concrete implementation, readback, or verification evidence that moves the objective forward: ${currentGap}`
      : `Address the current gap with the smallest concrete implementation step that moves the objective forward: ${currentGap}`
    return {
      targetArtifact: artifact.planSnapshot ? 'plan_snapshot' : artifact.objective,
      currentGap,
      evidence: [
        ...(state.contextPackPath ? [`context pack: ${state.contextPackPath}`] : []),
        ...(state.checkpoint ? [`checkpoint: ${state.checkpoint}`] : []),
        ...(judgment?.evidence ?? []),
        ...(state.verifierResult?.evidence ?? []),
      ],
      implementationScope: artifact.scope,
      progressKind,
      progressSummary: judgment?.progressSummary ?? null,
      nextPrompt,
      verification,
      stopCondition: 'Stop when the done criteria are proven or the turn budget is exhausted.',
      escalationCondition: artifact.escalation ?? 'Escalate when required input, credentials, destructive schema changes, or unsafe side effects are needed.',
      createdAt: Date.now(),
      turn: state.turnsUsed + 1,
    }
  }

  // --- Persistence ---

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as GoalState
      if (data.status === 'active' || data.status === 'paused' || data.status === 'blocked' || data.status === 'budget_limited') {
        this.state = {
          goal: data.goal ?? '',
          status: data.status,
          turnsUsed: Number(data.turnsUsed) || 0,
          maxTurns: Number(data.maxTurns) || DEFAULT_MAX_TURNS,
          createdAt: Number(data.createdAt) || 0,
          updatedAt: Number(data.updatedAt) || Number(data.lastTurnAt) || Number(data.createdAt) || 0,
          elapsedMs: Number(data.elapsedMs) || 0,
          promptTokensUsed: Number(data.promptTokensUsed) || 0,
          completionTokensUsed: Number(data.completionTokensUsed) || 0,
          tokensUsed: Number(data.tokensUsed) || (Number(data.promptTokensUsed) || 0) + (Number(data.completionTokensUsed) || 0),
          tokenBudget: normalizeOptionalPositiveNumber(data.tokenBudget),
          lastTurnAt: Number(data.lastTurnAt) || 0,
          lastVerdict: data.lastVerdict ?? null,
          lastReason: data.lastReason ?? null,
          pausedReason: data.pausedReason ?? null,
          consecutiveParseFailures: Number(data.consecutiveParseFailures) || 0,
          subgoals: Array.isArray(data.subgoals) ? data.subgoals : [],
          successCriteria: Array.isArray(data.successCriteria) ? data.successCriteria : [],
          checkpoint: typeof data.checkpoint === 'string' ? data.checkpoint : null,
          verifierResult: data.verifierResult ?? null,
          templateId: data.templateId ?? null,
          automation: data.automation ?? null,
          contextPackPath: typeof data.contextPackPath === 'string' ? data.contextPackPath : null,
          artifact: normalizeGoalArtifact(data.goal ?? '', { goalArtifact: (data as any).artifact ?? null }, Number(data.createdAt) || Date.now()),
          workPacket: normalizeWorkPacket((data as any).workPacket),
        }
      }
    } catch { /* corrupted file — start fresh */ }
  }

  private save(): void {
    if (!this.state) return
    this.refreshAccounting()
    const dir = join(this.filePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  private elapsedMs(now: number = Date.now()): number {
    if (!this.state) return 0
    const createdAt = this.state.createdAt || now
    if (this.state.status === 'active') return Math.max(0, now - createdAt)
    const end = this.state.updatedAt || this.state.lastTurnAt || now
    return Math.max(0, end - createdAt)
  }

  private refreshAccounting(): void {
    if (!this.state) return
    const now = Date.now()
    this.state.updatedAt = now
    this.state.elapsedMs = this.elapsedMs(now)
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTokenUsage(state: Pick<GoalState, 'tokensUsed' | 'tokenBudget'>): string {
  const used = formatTokenCount(state.tokensUsed)
  return state.tokenBudget ? `${used}/${formatTokenCount(state.tokenBudget)}` : used
}

function formatTokenCount(value: number): string {
  if (value < 1000) return `${value}`
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`
  return `${Math.round(value / 1000)}k`
}

function normalizeOptionalPositiveNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null
}

function normalizeGoalArtifact(goal: string, options: GoalSetOptions, now: number): GoalArtifact {
  const existing = options.goalArtifact
  if (existing && typeof existing === 'object') {
    const existingDoneCriteria = stringArray((existing as any).doneCriteria)
    const existingAllowedTools = stringArray((existing as any).allowedTools)
    return {
      objective: stringOr(existing.objective, goal),
      source: stringOr(existing.source, options.source ?? 'goal-command'),
      planSnapshot: optionalString(existing.planSnapshot ?? options.planSnapshot),
      scope: optionalString(existing.scope ?? options.scope),
      doneCriteria: existingDoneCriteria.length > 0 ? existingDoneCriteria : stringArray(options.doneCriteria ?? options.successCriteria),
      allowedTools: existingAllowedTools.length > 0 ? existingAllowedTools : stringArray(options.allowedTools),
      verification: optionalString(existing.verification ?? options.verification),
      escalation: optionalString(existing.escalation ?? options.escalation),
      createdAt: Number(existing.createdAt) || now,
      updatedAt: Number(existing.updatedAt) || now,
    }
  }
  return {
    objective: goal,
    source: options.source ?? 'goal-command',
    planSnapshot: optionalString(options.planSnapshot),
    scope: optionalString(options.scope),
    doneCriteria: stringArray(options.doneCriteria ?? options.successCriteria),
    allowedTools: stringArray(options.allowedTools),
    verification: optionalString(options.verification),
    escalation: optionalString(options.escalation),
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeWorkPacket(value: unknown): GoalWorkPacket | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return {
    targetArtifact: optionalString(data.targetArtifact),
    currentGap: stringOr(data.currentGap, 'The goal has not been verified as complete.'),
    evidence: stringArray(data.evidence),
    implementationScope: optionalString(data.implementationScope),
    nextPrompt: stringOr(data.nextPrompt, 'Execute the next concrete step.'),
    progressKind: normalizeProgressKind(data.progressKind),
    progressSummary: optionalString(data.progressSummary),
    verification: stringOr(data.verification, 'Verify the result against the goal.'),
    stopCondition: stringOr(data.stopCondition, 'Stop when completion is proven.'),
    escalationCondition: stringOr(data.escalationCondition, 'Escalate when user input or unsafe side effects are needed.'),
    createdAt: Number(data.createdAt) || Date.now(),
    turn: Number(data.turn) || 0,
  }
}

function renderGoalArtifact(artifact: GoalArtifact): string {
  const lines = [
    '[Goal artifact]',
    `Objective: ${artifact.objective}`,
    `Source: ${artifact.source}`,
  ]
  if (artifact.planSnapshot) lines.push(`Plan snapshot:\n${artifact.planSnapshot}`)
  if (artifact.scope) lines.push(`Scope: ${artifact.scope}`)
  if (artifact.doneCriteria.length > 0) lines.push(`Done criteria:\n${artifact.doneCriteria.map((item) => `- ${item}`).join('\n')}`)
  if (artifact.allowedTools.length > 0) lines.push(`Allowed tools:\n${artifact.allowedTools.map((item) => `- ${item}`).join('\n')}`)
  if (artifact.verification) lines.push(`Verification: ${artifact.verification}`)
  if (artifact.escalation) lines.push(`Escalation: ${artifact.escalation}`)
  return lines.join('\n')
}

function artifactTime(millis: number): string {
  return new Date(millis).toISOString()
}

function renderWorkPacket(packet: GoalWorkPacket): string {
  return [
    '[Loop work packet]',
    `Target artifact: ${packet.targetArtifact ?? 'not specified'}`,
    `Current gap: ${packet.currentGap}`,
    packet.evidence.length > 0 ? `Evidence:\n${packet.evidence.map((item) => `- ${item}`).join('\n')}` : 'Evidence: none recorded yet',
    `Implementation scope: ${packet.implementationScope ?? 'use the goal scope and current repo context'}`,
    `Progress classification: ${packet.progressKind ?? 'unknown'}${packet.progressSummary ? ` — ${packet.progressSummary}` : ''}`,
    `Next prompt: ${packet.nextPrompt}`,
    `Verification: ${packet.verification}`,
    `Stop condition: ${packet.stopCondition}`,
    `Escalation condition: ${packet.escalationCondition}`,
  ].join('\n')
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function stringOr(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback
}

type LoopProgressKind = NonNullable<GoalWorkPacket['progressKind']>

function normalizeProgressKind(value: unknown): LoopProgressKind {
  if (value === 'progress_only' || value === 'implementation' || value === 'verification' || value === 'blocked' || value === 'unknown') {
    return value
  }
  return 'unknown'
}
