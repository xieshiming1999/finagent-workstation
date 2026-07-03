import { existsSync, readFileSync } from 'fs'
import { ArtifactRegistry, type ArtifactKind, type ArtifactRecord } from './artifact-registry'
import type { GoalJudgment, GoalState } from './goal-manager'
import type { GoalVerifierResult } from './goal-automation-types'

export type GoalVerifierFn = (state: GoalState, judgment: GoalJudgment) => Promise<GoalVerifierResult>

export function createGoalVerifier(basePath: string): GoalVerifierFn {
  return async (state, judgment) => verifyGoalState(state, judgment, basePath)
}

export function verifyGoalState(state: GoalState, judgment: GoalJudgment, basePath?: string): GoalVerifierResult {
  const checkedAt = Date.now()
  if (!state.templateId && !state.automation) {
    return { status: 'passed', checkedAt, reason: 'Manual non-template goal has no automation verifier contract.' }
  }
  const contextPath = state.contextPackPath
  if (!contextPath || !existsSync(contextPath)) {
    return { status: 'failed', checkedAt, reason: 'Goal automation context pack is missing.', evidence: contextPath ? [contextPath] : [] }
  }
  const contextPack = readContextPack(contextPath)
  if (!contextPack) {
    return { status: 'failed', checkedAt, reason: 'Goal automation context pack is not valid JSON.', evidence: [contextPath] }
  }
  if (judgment.safetyBoundary === 'approved_side_effect') {
    return { status: 'failed', checkedAt, reason: 'Goal automation templates do not authorize side effects.', evidence: [contextPath] }
  }
  const refs = validatedEvidenceRefs(state, judgment.evidence, basePath)
  if (refs.length === 0) {
    return {
      status: 'failed',
      checkedAt,
      reason: 'Typed goal judgment did not provide a verifiable context, file, or artifact reference.',
      evidence: [contextPath],
    }
  }

  switch (state.templateId) {
    case 'api_error_triage':
    case 'provider_contract_probe':
      return result(
        hasRows(contextPack.recentApiFailures) && hasRows(contextPack.recentApiFailureClasses), checkedAt, refs,
        'Typed API failure rows and failure-class records are present.',
        'Verifier requires typed API failure rows and failure-class records.',
      )
    case 'daily_data_health':
      return result(
        hasRows(contextPack.dataCoverage) || hasRows(contextPack.providerHealth) || hasRows(contextPack.activeTasks), checkedAt, refs,
        'Typed data-health context and evidence references are present.', 'Verifier requires typed data-health context.',
      )
    case 'dashboard_refresh':
    case 'report_generation': {
      const artifactRefs = matchingArtifactRefs(
        state, judgment.evidence,
        new Set<ArtifactKind>([state.templateId === 'dashboard_refresh' ? 'dashboard' : 'report']), basePath,
      )
      return result(
        artifactRefs.length > 0 && (hasRows(contextPack.dataCoverage) || hasRows(contextPack.providerHealth)), checkedAt,
        [...new Set([...refs, ...artifactRefs])],
        'A current typed output artifact and data-source context are present.',
        'Verifier requires a current typed output artifact and data-source context.',
      )
    }
    case 'market_pulse_refresh':
    case 'watchlist_monitor':
      return result(
        hasRows(contextPack.dataCoverage) || hasWatchlistRows(contextPack.watchlists) || hasRows(contextPack.providerHealth), checkedAt, refs,
        'Typed market/watchlist context and evidence references are present.',
        'Verifier requires typed market or watchlist context.',
      )
    default:
      return { status: 'passed', checkedAt, reason: 'Typed context and evidence-reference checks passed.', evidence: refs }
  }
}

function result(ok: boolean, checkedAt: number, evidence: string[], passed: string, failed: string): GoalVerifierResult {
  return { status: ok ? 'passed' : 'failed', checkedAt, reason: ok ? passed : failed, evidence }
}

function readContextPack(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function artifacts(basePath?: string): ArtifactRecord[] {
  return basePath ? new ArtifactRegistry(basePath).list() : []
}

function validatedEvidenceRefs(state: GoalState, refs: string[], basePath?: string): string[] {
  const records = artifacts(basePath)
  return [...new Set(refs.filter((ref) =>
    ref === state.contextPackPath || ref === state.checkpoint || existsSync(ref) ||
    records.some((record) => ref === record.id || ref === record.stableRef || ref === record.path),
  ))]
}

function matchingArtifactRefs(state: GoalState, refs: string[], kinds: Set<ArtifactKind>, basePath?: string): string[] {
  return artifacts(basePath)
    .filter((record) =>
      kinds.has(record.kind) && new Date(record.createdAt).getTime() >= state.createdAt && existsSync(record.path) &&
      refs.some((ref) => ref === record.id || ref === record.stableRef || ref === record.path),
    )
    .map((record) => record.stableRef)
}

function hasRows(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return false
}

function hasWatchlistRows(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  for (const list of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(list) && list.length > 0) return true
    if (list && typeof list === 'object' && Array.isArray((list as { items?: unknown }).items) && (list as { items: unknown[] }).items.length > 0) return true
  }
  return false
}
