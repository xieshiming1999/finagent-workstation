import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GoalTemplateId } from './goal-automation-types'

export interface GoalLoopState {
  templateId: GoalTemplateId
  enabled: boolean
  paused: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  lastTrigger: string | null
  lastTriggerEvidence: string | null
  lastCheckpoint: string | null
  lastError: string | null
  escalationNeeded: boolean
  lastResult: string | null
  failureCount: number
  triggerLedger: GoalTriggerLedgerEntry[]
}

export interface GoalTriggerLedgerEntry {
  at: number
  templateId: GoalTemplateId
  requestedTrigger: string
  resolvedTrigger: string
  status: 'not_due' | 'queued' | 'skipped' | 'failed' | 'paused'
  reason: string
  evidence: string | null
  nextRunAt: number | null
  runId: string | null
  repeatCount: number
}

export class GoalAutomationStateStore {
  private filePath: string
  private states: Record<string, GoalLoopState> = {}
  private readonly maxLedgerEntries = 30
  private readonly ledgerDedupeWindowMs = 5 * 60_000

  constructor(basePath: string) {
    this.filePath = join(basePath, 'memory', 'goal-automation-state.json')
    this.load()
  }

  list(): GoalLoopState[] {
    return Object.values(this.states)
  }

  get(templateId: GoalTemplateId): GoalLoopState {
    if (!this.states[templateId]) {
      this.states[templateId] = {
        templateId,
        enabled: false,
        paused: false,
        lastRunAt: null,
        nextRunAt: null,
        lastTrigger: null,
        lastTriggerEvidence: null,
        lastCheckpoint: null,
        lastError: null,
        escalationNeeded: false,
        lastResult: null,
        failureCount: 0,
        triggerLedger: [],
      }
    }
    return this.states[templateId]
  }

  update(templateId: GoalTemplateId, updates: Partial<GoalLoopState>): GoalLoopState {
    const current = this.get(templateId)
    const next = { ...current, ...updates, templateId, triggerLedger: normalizeLedger(updates.triggerLedger ?? current.triggerLedger, templateId) }
    this.states[templateId] = next
    this.save()
    return next
  }

  recordDecision(templateId: GoalTemplateId, entry: Omit<GoalTriggerLedgerEntry, 'at' | 'templateId' | 'repeatCount'> & { at?: number }): GoalLoopState {
    const state = this.get(templateId)
    const at = entry.at ?? Date.now()
    const nextEntry: GoalTriggerLedgerEntry = {
      at,
      templateId,
      requestedTrigger: entry.requestedTrigger,
      resolvedTrigger: entry.resolvedTrigger,
      status: entry.status,
      reason: entry.reason,
      evidence: entry.evidence ?? null,
      nextRunAt: entry.nextRunAt ?? null,
      runId: entry.runId ?? null,
      repeatCount: 1,
    }
    const ledger = normalizeLedger(state.triggerLedger, templateId)
    const last = ledger[0]
    if (last && at - last.at <= this.ledgerDedupeWindowMs && sameDecision(last, nextEntry)) {
      ledger[0] = { ...last, at, nextRunAt: nextEntry.nextRunAt, runId: nextEntry.runId ?? last.runId, repeatCount: last.repeatCount + 1 }
    } else {
      ledger.unshift(nextEntry)
    }
    return this.update(templateId, { triggerLedger: ledger.slice(0, this.maxLedgerEntries) })
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, GoalLoopState>
      this.states = data && typeof data === 'object'
        ? Object.fromEntries(Object.entries(data).map(([id, state]) => [id, { ...state, triggerLedger: normalizeLedger((state as GoalLoopState).triggerLedger, id as GoalTemplateId) }]))
        : {}
    } catch {
      this.states = {}
    }
  }

  private save(): void {
    const dir = join(this.filePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.states, null, 2), 'utf-8')
  }
}

function sameDecision(a: GoalTriggerLedgerEntry, b: GoalTriggerLedgerEntry): boolean {
  return a.requestedTrigger === b.requestedTrigger
    && a.resolvedTrigger === b.resolvedTrigger
    && a.status === b.status
    && a.reason === b.reason
    && a.evidence === b.evidence
}

function normalizeLedger(value: unknown, templateId: GoalTemplateId): GoalTriggerLedgerEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is Partial<GoalTriggerLedgerEntry> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      at: Number(entry.at ?? 0),
      templateId,
      requestedTrigger: String(entry.requestedTrigger ?? ''),
      resolvedTrigger: String(entry.resolvedTrigger ?? entry.requestedTrigger ?? ''),
      status: normalizeStatus(entry.status),
      reason: String(entry.reason ?? ''),
      evidence: typeof entry.evidence === 'string' ? entry.evidence : null,
      nextRunAt: typeof entry.nextRunAt === 'number' ? entry.nextRunAt : null,
      runId: typeof entry.runId === 'string' ? entry.runId : null,
      repeatCount: Math.max(1, Number(entry.repeatCount ?? 1)),
    }))
    .filter((entry) => entry.at > 0 && entry.requestedTrigger && entry.resolvedTrigger && entry.reason)
}

function normalizeStatus(value: unknown): GoalTriggerLedgerEntry['status'] {
  return value === 'not_due' || value === 'queued' || value === 'skipped' || value === 'failed' || value === 'paused'
    ? value
    : 'skipped'
}
