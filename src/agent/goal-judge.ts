import { Role } from './message'
import type { LLMProvider } from './llm-provider'
import type { GoalJudgment, JudgeFn } from './goal-manager'

const JUDGE_SYSTEM_PROMPT =
  'You are a strict judge evaluating whether an autonomous agent has achieved a user\'s stated goal. ' +
  'You receive the goal text and the agent\'s most recent response. Your only job is to decide whether the goal is fully satisfied.\n\n' +
  'A goal is COMPLETE only when:\n' +
  '- The response explicitly confirms the goal was completed, OR\n' +
  '- The response clearly shows the final deliverable was produced, OR\n' +
  'Use outcome="blocked" only when progress requires user input or an external state change.\n' +
  'Otherwise use outcome="continue".\n\n' +
  'Classify this turn\'s concrete progress as unknown, progress_only, implementation, verification, or blocked.\n' +
  'Evidence refs must be exact paths, artifact ids, tool-result ids, or command/test identifiers stated in the response; never invent one.\n\n' +
  'Reply ONLY with one strict JSON object on one line and no markdown:\n' +
  '{"contract":"goal-judge-result-v1","outcome":"continue|complete|blocked","reason":"<one-sentence rationale>","safetyBoundary":"no_side_effect|approved_side_effect|not_applicable","progress":{"kind":"unknown|progress_only|implementation|verification|blocked","summary":"<short summary or empty>","evidenceRefs":["<exact reference>"]}}'

const MAX_GOAL_CHARS = 2000
const MAX_RESPONSE_CHARS = 4000
const MAX_SUBGOALS_CHARS = 2000

function buildJudgeUserPrompt(goal: string, response: string, subgoals?: string[]): string {
  const truncGoal = goal.slice(0, MAX_GOAL_CHARS)
  const truncResponse = response.slice(-MAX_RESPONSE_CHARS)

  if (subgoals && subgoals.length > 0) {
    const subgoalsBlock = subgoals.map((s, i) => `- ${i + 1}. ${s}`).join('\n').slice(0, MAX_SUBGOALS_CHARS)
    return `Goal:\n${truncGoal}\n\nAdditional criteria (all must be satisfied):\n${subgoalsBlock}\n\nAgent's most recent response:\n${truncResponse}\n\nIs the goal AND every criterion satisfied?`
  }

  return `Goal:\n${truncGoal}\n\nAgent's most recent response:\n${truncResponse}\n\nIs the goal satisfied?`
}

export function parseGoalJudgeResponse(text: string): GoalJudgment {
  if (!text || !text.trim()) {
    return invalid('judge returned empty response')
  }

  const cleaned = text.trim()
  let obj: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(cleaned)
    if (typeof parsed === 'object' && parsed !== null) obj = parsed as Record<string, unknown>
  } catch { /* strict JSON only */ }

  if (!obj) {
    return invalid(`judge reply was not one strict JSON object: ${cleaned.slice(0, 100)}`)
  }
  if (obj.contract !== 'goal-judge-result-v1' ||
      !isOutcome(obj.outcome) ||
      typeof obj.reason !== 'string' ||
      !obj.reason.trim() ||
      !isSafetyBoundary(obj.safetyBoundary) ||
      !obj.progress ||
      typeof obj.progress !== 'object') {
    return invalid('judge JSON does not satisfy goal-judge-result-v1')
  }
  const progress = obj.progress as Record<string, unknown>
  if (!isProgressKind(progress.kind) ||
      typeof progress.summary !== 'string' ||
      !Array.isArray(progress.evidenceRefs) ||
      !progress.evidenceRefs.every((value) => typeof value === 'string' && value.trim())) {
    return invalid('judge progress does not satisfy goal-judge-result-v1')
  }
  if ((obj.outcome === 'blocked') !== (progress.kind === 'blocked')) {
    return invalid('judge outcome and progress kind are inconsistent')
  }
  return {
    outcome: obj.outcome,
    reason: obj.reason.trim(),
    parseFailed: false,
    progressKind: progress.kind,
    progressSummary: progress.summary.trim() || null,
    evidence: progress.evidenceRefs as string[],
    safetyBoundary: obj.safetyBoundary,
  }
}

function invalid(reason: string): GoalJudgment {
  return { outcome: 'continue', reason, parseFailed: true, progressKind: 'unknown', progressSummary: null, evidence: [], safetyBoundary: 'not_applicable' }
}

function isOutcome(value: unknown): value is GoalJudgment['outcome'] {
  return value === 'continue' || value === 'complete' || value === 'blocked'
}

function isProgressKind(value: unknown): value is GoalJudgment['progressKind'] {
  return value === 'unknown' || value === 'progress_only' || value === 'implementation' || value === 'verification' || value === 'blocked'
}

function isSafetyBoundary(value: unknown): value is GoalJudgment['safetyBoundary'] {
  return value === 'no_side_effect' || value === 'approved_side_effect' || value === 'not_applicable'
}

export function createGoalJudge(llm: LLMProvider): JudgeFn {
  return async (goal: string, response: string, subgoals?: string[]) => {
    if (!goal.trim()) return { outcome: 'continue', reason: 'empty goal', parseFailed: false, progressKind: 'unknown', progressSummary: null, evidence: [], safetyBoundary: 'not_applicable' }
    if (!response.trim()) return { outcome: 'continue', reason: 'empty response (nothing to evaluate)', parseFailed: false, progressKind: 'unknown', progressSummary: null, evidence: [], safetyBoundary: 'not_applicable' }

    try {
      const userPrompt = buildJudgeUserPrompt(goal, response, subgoals)
      const messages = [{ role: Role.User as const, content: userPrompt, timestamp: new Date().toISOString() }]

      const parts: string[] = []
      const stream = llm.sendMessage(JUDGE_SYSTEM_PROMPT, messages, [])
      for await (const ev of stream) {
        if (ev.type === 'text-delta') parts.push(ev.text)
      }

      return parseGoalJudgeResponse(parts.join(''))
    } catch (e) {
      // API/transport errors are NOT parse failures — fail-open to continue
      return { outcome: 'continue', reason: `judge error: ${e instanceof Error ? e.message : String(e)}`, parseFailed: false, progressKind: 'unknown', progressSummary: null, evidence: [], safetyBoundary: 'not_applicable' }
    }
  }
}
