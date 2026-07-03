import type { Agent } from './agent'
import type { DataStore } from './data/store/data-store'
import { isFinanceApiFailure } from './api-failure-classifier'
import { buildGoalContextPack } from './goal-context-pack'
import { buildGoalPrompt, getGoalTemplate, GOAL_TEMPLATES } from './goal-templates'
import type { GoalAutomationRun, GoalTemplateId, GoalTrigger } from './goal-automation-types'
import type { GoalAutomationSuggestionInput } from './goal-automation-suggestions'
import { GoalAutomationSuggestionStore } from './goal-automation-suggestions'
import { GoalAutomationStateStore } from './goal-automation-state'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface DoctorReportLike {
  checks?: Array<{
    id?: string
    status?: string
    detail?: string
    nextStep?: string
  }>
}

export class GoalAutomationService {
  private state: GoalAutomationStateStore
  private suggestions: GoalAutomationSuggestionStore
  private readonly minRunGapMs = 10 * 60_000
  private readonly maxFailureCount = 3

  constructor(private basePath: string, private deps: {
    getEventAgent: () => Agent | null
    getChatAgent: () => Agent | null
    getDataStore: () => DataStore | null
  }) {
    this.state = new GoalAutomationStateStore(basePath)
    this.suggestions = new GoalAutomationSuggestionStore(basePath)
  }

  list() {
    const activeGoal = this.deps.getEventAgent()?.goalManager.getState()
    return GOAL_TEMPLATES.map((template) => ({
      template,
      state: this.state.get(template.id),
      activeGoal: activeGoal?.templateId === template.id ? {
        status: activeGoal.status,
        turnsUsed: activeGoal.turnsUsed,
        maxTurns: activeGoal.maxTurns,
        tokenBudget: activeGoal.tokenBudget,
        tokensUsed: activeGoal.tokensUsed,
        artifact: activeGoal.artifact,
        successCriteria: activeGoal.successCriteria,
        checkpoint: activeGoal.checkpoint,
        contextPackPath: activeGoal.contextPackPath,
        workPacket: activeGoal.workPacket,
        verifierResult: activeGoal.verifierResult,
      } : null,
    }))
  }

  setEnabled(templateId: GoalTemplateId, enabled: boolean) {
    return this.state.update(templateId, { enabled, paused: false })
  }

  pause(templateId: GoalTemplateId, paused: boolean) {
    return this.state.update(templateId, { paused })
  }

  listSuggestions(doctor?: DoctorReportLike | null) {
    const enabled = (id: GoalTemplateId) => this.state.get(id).enabled
    this.suggestions.seed(doctorSuggestions(doctor), enabled)
    return this.suggestions.seedCatalog(GOAL_TEMPLATES, enabled)
  }

  acceptSuggestion(ref: string) {
    const suggestion = this.suggestions.accept(ref)
    if (!suggestion) return { ok: false, error: `Goal automation suggestion not found or already resolved: ${ref}` }
    const state = this.setEnabled(suggestion.templateId, true)
    return { ok: true, suggestion, state }
  }

  dismissSuggestion(ref: string) {
    const suggestion = this.suggestions.dismiss(ref)
    if (!suggestion) return { ok: false, error: `Goal automation suggestion not found or already resolved: ${ref}` }
    return { ok: true, suggestion }
  }

  evaluateTriggers(trigger: GoalTrigger = 'schedule'): GoalAutomationRun[] {
    const runs: GoalAutomationRun[] = []
    for (const { template, state } of this.list()) {
      if (!state.enabled || state.paused) continue
      if (!template.persistentDuty) {
        const reason = 'Skipped because this template is manual run-now only, not a persistent duty.'
        this.state.update(template.id, {
          lastResult: reason,
          lastTriggerEvidence: 'Loop automation is limited to narrow persistent duties.',
          escalationNeeded: false,
        })
        this.state.recordDecision(template.id, {
          requestedTrigger: trigger,
          resolvedTrigger: trigger,
          status: 'skipped',
          reason,
          evidence: 'Loop automation is limited to narrow persistent duties.',
          nextRunAt: state.nextRunAt,
          runId: null,
        })
        continue
      }
      if (state.failureCount >= this.maxFailureCount) {
        this.state.update(template.id, {
          paused: true,
          escalationNeeded: true,
          lastResult: `Paused after ${state.failureCount} automation failures.`,
          lastError: state.lastError ?? 'Automation retry limit reached',
        })
        this.state.recordDecision(template.id, {
          requestedTrigger: trigger,
          resolvedTrigger: trigger,
          status: 'paused',
          reason: `Paused after ${state.failureCount} automation failures.`,
          evidence: state.lastError ?? 'Automation retry limit reached',
          nextRunAt: state.nextRunAt,
          runId: null,
        })
        continue
      }
      const decision = this.triggerDecision(template.id, trigger, state.lastRunAt)
      if (!decision.due) {
        if (decision.nextRunAt || decision.evidence) {
          this.state.update(template.id, {
            nextRunAt: decision.nextRunAt ?? state.nextRunAt,
            lastTriggerEvidence: decision.evidence ?? state.lastTriggerEvidence,
          })
        }
        this.state.recordDecision(template.id, {
          requestedTrigger: trigger,
          resolvedTrigger: decision.trigger,
          status: 'not_due',
          reason: decision.evidence ?? 'Trigger conditions were not met.',
          evidence: decision.evidence ?? null,
          nextRunAt: decision.nextRunAt ?? state.nextRunAt,
          runId: null,
        })
        continue
      }
      const run = this.runNow(this.triggeredTemplateId(template.id), decision.trigger, decision.evidence)
      runs.push(run)
      if (run.status === 'queued') break
    }
    return runs
  }

  runNow(templateId: GoalTemplateId, trigger: GoalTrigger = 'run_now', triggerEvidence?: string): GoalAutomationRun {
    const template = getGoalTemplate(templateId)
    const startedAt = Date.now()
    const runId = `${templateId}-${startedAt}`
    if (!template) {
      return { runId, templateId, trigger, status: 'failed', reason: `Unknown goal template: ${templateId}`, startedAt }
    }

    const eventAgent = this.deps.getEventAgent()
    if (!eventAgent) {
      this.state.update(templateId, {
        lastRunAt: startedAt,
        nextRunAt: this.computeNextRunAt(templateId, startedAt),
        lastTrigger: trigger,
        lastTriggerEvidence: triggerEvidence ?? this.defaultTriggerEvidence(templateId, trigger),
        lastError: 'Event agent unavailable',
        escalationNeeded: true,
        failureCount: this.state.get(templateId).failureCount + 1,
      })
      this.state.recordDecision(templateId, {
        at: startedAt,
        requestedTrigger: trigger,
        resolvedTrigger: trigger,
        status: 'failed',
        reason: 'Event agent unavailable',
        evidence: triggerEvidence ?? null,
        nextRunAt: this.computeNextRunAt(templateId, startedAt),
        runId,
      })
      return { runId, templateId, trigger, status: 'failed', reason: 'Event agent unavailable', startedAt }
    }
    if (this.deps.getChatAgent()?.goalManager.isActive()) {
      const reason = 'Skipped because a user-controlled chat goal is active.'
      this.state.update(templateId, { lastRunAt: startedAt, lastResult: reason, escalationNeeded: true })
      this.state.recordDecision(templateId, {
        at: startedAt,
        requestedTrigger: trigger,
        resolvedTrigger: trigger,
        status: 'skipped',
        reason,
        evidence: triggerEvidence ?? null,
        nextRunAt: this.state.get(templateId).nextRunAt,
        runId,
      })
      return { runId, templateId, trigger, status: 'skipped', reason, startedAt }
    }
    if (eventAgent.goalManager.isActive()) {
      const reason = 'Skipped because the event agent is already running an active goal.'
      this.state.update(templateId, { lastRunAt: startedAt, lastResult: reason, escalationNeeded: true })
      this.state.recordDecision(templateId, {
        at: startedAt,
        requestedTrigger: trigger,
        resolvedTrigger: trigger,
        status: 'skipped',
        reason,
        evidence: triggerEvidence ?? null,
        nextRunAt: this.state.get(templateId).nextRunAt,
        runId,
      })
      return { runId, templateId, trigger, status: 'skipped', reason, startedAt }
    }

    const chatAgent = this.deps.getChatAgent()
    const context = buildGoalContextPack({
      basePath: this.basePath,
      templateId,
      trigger,
      dataStore: this.deps.getDataStore(),
      minutes: templateId === 'api_error_triage' ? 30 : 24 * 60,
      sessionState: {
        chatSessionId: chatAgent?.session?.id ?? null,
        chatMessages: chatAgent?.messages?.length ?? 0,
        eventSessionId: eventAgent.session?.id ?? null,
        eventMessages: eventAgent.messages?.length ?? 0,
      },
    })
    if (templateId === 'api_error_triage' && context.pack.recentApiFailures.length === 0) {
      const reason = 'No recent finance API failures in the last 30 minutes.'
      this.state.update(templateId, {
        lastRunAt: startedAt,
        nextRunAt: this.computeNextRunAt(templateId, startedAt),
        lastTrigger: trigger,
        lastTriggerEvidence:
          triggerEvidence ?? '0 recent finance API failures in the last 30 minutes; api_error_triage skipped.',
        lastCheckpoint: context.path,
        lastResult: reason,
        lastError: null,
        escalationNeeded: false,
      })
      this.state.recordDecision(templateId, {
        at: startedAt,
        requestedTrigger: trigger,
        resolvedTrigger: trigger,
        status: 'skipped',
        reason,
        evidence: triggerEvidence ?? '0 recent finance API failures in the last 30 minutes; api_error_triage skipped.',
        nextRunAt: this.computeNextRunAt(templateId, startedAt),
        runId,
      })
      return { runId, templateId, trigger, status: 'skipped', reason, contextPackPath: context.path, startedAt }
    }

    const prompt = buildGoalPrompt(template, context.summary)
    eventAgent.goalManager.set(prompt, template.defaultMaxTurns, {
      templateId,
      successCriteria: template.successCriteria,
      checkpoint: context.path,
      contextPackPath: context.path,
      automation: { trigger, runId, source: 'goal-automation' },
      verifierResult: { status: 'unchecked', checkedAt: startedAt, reason: 'Goal queued; verifier has not run yet.' },
    })
    const id = eventAgent.notifications.enqueue('goal-automation', prompt, 'now')
    const status = id ? 'queued' : 'failed'
    const reason = id ? 'Queued goal automation on event agent.' : 'Notification queue throttled or rejected goal automation.'
    this.state.update(templateId, {
      lastRunAt: startedAt,
      nextRunAt: this.computeNextRunAt(templateId, startedAt),
      lastTrigger: trigger,
      lastTriggerEvidence: triggerEvidence ?? this.defaultTriggerEvidence(templateId, trigger),
      lastCheckpoint: context.path,
      lastResult: reason,
      lastError: id ? null : reason,
      escalationNeeded: !id,
      failureCount: id ? 0 : this.state.get(templateId).failureCount + 1,
    })
    this.state.recordDecision(templateId, {
      at: startedAt,
      requestedTrigger: trigger,
      resolvedTrigger: trigger,
      status,
      reason,
      evidence: triggerEvidence ?? this.defaultTriggerEvidence(templateId, trigger),
      nextRunAt: this.computeNextRunAt(templateId, startedAt),
      runId,
    })
    return { runId, templateId, trigger, status, reason, prompt, contextPackPath: context.path, startedAt }
  }

  private computeNextRunAt(templateId: GoalTemplateId, from: number): number | null {
    if (templateId === 'api_error_triage') return from + this.minRunGapMs
    if (templateId === 'market_pulse_refresh') return from + 30 * 60_000
    if (templateId === 'watchlist_monitor') return from + 15 * 60_000
    if (templateId === 'daily_data_health' || templateId === 'dashboard_refresh' || templateId === 'report_generation') {
      return from + 24 * 60 * 60_000
    }
    return null
  }

  private triggerDecision(templateId: GoalTemplateId, trigger: GoalTrigger, lastRunAt: number | null): {
    due: boolean
    trigger: GoalTrigger
    evidence?: string
    nextRunAt?: number | null
  } {
    const now = Date.now()
    if (lastRunAt && now - lastRunAt < this.minRunGapMs) {
      return { due: false, trigger, evidence: 'Minimum automation run gap is still active.', nextRunAt: lastRunAt + this.minRunGapMs }
    }
    if (trigger === 'startup') {
      const due = templateId === 'daily_data_health' || templateId === 'api_error_triage'
      return { due, trigger: templateId === 'api_error_triage' ? 'api_failure_threshold' : 'startup', evidence: due ? 'Startup scan selected this template.' : undefined }
    }
    if (trigger === 'market_open' || trigger === 'market_close') {
      return {
        due: templateId === 'market_pulse_refresh' || templateId === 'watchlist_monitor',
        trigger,
        evidence: `${trigger} signal received.`,
      }
    }
    if (templateId === 'api_error_triage') {
      const count = this.recentFailureCount(30)
      return { due: count >= 3, trigger: 'api_failure_threshold', evidence: `${count} recent finance API failures in the last 30 minutes.` }
    }
    if (templateId === 'daily_data_health') {
      return { due: !lastRunAt || now - lastRunAt >= 24 * 60 * 60_000, trigger, evidence: 'Daily data health interval elapsed.' }
    }
    if (templateId === 'market_pulse_refresh') {
      const boundary = marketBoundarySignal(now)
      if (boundary) return { due: true, trigger: boundary.trigger, evidence: boundary.evidence }
      return { due: !lastRunAt || now - lastRunAt >= 30 * 60_000, trigger: 'stale_data', evidence: 'Market pulse refresh interval elapsed.' }
    }
    if (templateId === 'watchlist_monitor') {
      const watchlist = this.watchlistSignal()
      return {
        due: watchlist.hasActiveInputs && (!lastRunAt || now - lastRunAt >= 15 * 60_000),
        trigger: 'watchlist_condition',
        evidence: watchlist.evidence,
      }
    }
    if (templateId === 'dashboard_refresh' || templateId === 'report_generation') {
      return { due: !lastRunAt || now - lastRunAt >= 24 * 60 * 60_000, trigger, evidence: 'Daily artifact refresh interval elapsed.' }
    }
    return { due: false, trigger }
  }

  private triggeredTemplateId(templateId: GoalTemplateId): GoalTemplateId {
    return templateId
  }

  private defaultTriggerEvidence(templateId: GoalTemplateId, trigger: GoalTrigger): string {
    if (trigger === 'run_now') return 'User requested Run Now.'
    return `${templateId} triggered by ${trigger}.`
  }

  private watchlistSignal(): { hasActiveInputs: boolean; evidence: string } {
    const items = readWatchlistItems(this.basePath)
    const active = items.filter((item) => item.status !== 'exited' && Boolean(item.symbol || item.code))
    const withRules = active.filter((item) => {
      const conditions = Array.isArray(item.conditions) ? item.conditions : []
      return conditions.some((c: any) => c?.triggered !== true) || item.targetEntryPrice != null || item.stopLoss != null || item.targetPrice != null
    })
    if (withRules.length > 0) return { hasActiveInputs: true, evidence: `${withRules.length} active watchlist items have monitor rules.` }
    if (active.length > 0) return { hasActiveInputs: true, evidence: `${active.length} active watchlist items are available for monitoring summary.` }
    return { hasActiveInputs: false, evidence: 'No active watchlist items found; watchlist monitor not scheduled.' }
  }

  private recentFailureCount(minutes: number): number {
    const ds = this.deps.getDataStore()
    if (!ds?.isReady) return 0
    const since = new Date(Date.now() - minutes * 60_000).toISOString()
    const rows = ds.query<Record<string, unknown>>(
      'SELECT * FROM api_call_log WHERE created_at >= ? AND success = 0 ORDER BY created_at DESC LIMIT 200',
      since,
    )
    return rows.filter(isFinanceApiFailure).length
  }
}

function doctorSuggestions(report?: DoctorReportLike | null): GoalAutomationSuggestionInput[] {
  const checks = Array.isArray(report?.checks) ? report.checks : []
  return checks
    .filter((check) => check.status === 'warning' || check.status === 'critical')
    .map((check): GoalAutomationSuggestionInput | null => {
      const id = String(check.id ?? 'unknown')
      const templateId = doctorTemplateForCheck(id)
      if (!templateId) return null
      const severity = String(check.status).toUpperCase()
      return {
        title: doctorSuggestionTitle(id, templateId),
        description: [severity, check.detail, check.nextStep].filter(Boolean).join(' · '),
        templateId,
        source: 'integration' as const,
        dedupKey: `doctor:${id}:${templateId}`,
      }
    })
    .filter((input): input is GoalAutomationSuggestionInput => input !== null)
}

function doctorTemplateForCheck(id: string): GoalTemplateId | null {
  if (id === 'api_failures') return 'api_error_triage'
  if (id === 'provider_routes' || id === 'desktop_services') return 'provider_contract_probe'
  if (id === 'queue' || id === 'stock_identity' || id === 'fund_identity' || id === 'quote_cache' || id === 'kline_cache' || id === 'feeds') {
    return 'daily_data_health'
  }
  return null
}

function doctorSuggestionTitle(id: string, templateId: GoalTemplateId): string {
  if (id === 'api_failures') return 'Triage recent API failures'
  if (id === 'provider_routes') return 'Probe missing provider routes'
  if (id === 'desktop_services') return 'Check desktop data services'
  if (id === 'feeds') return 'Review failed data feeds'
  if (id === 'queue') return 'Review failed data queue tasks'
  if (id === 'stock_identity' || id === 'fund_identity') return 'Refresh missing identity cache'
  if (id === 'quote_cache' || id === 'kline_cache') return 'Refresh missing reusable market cache'
  return `Enable ${templateId}`
}

function readWatchlistItems(basePath: string): Array<Record<string, any>> {
  const unifiedPaths = [
    join(basePath, 'watchlists.json'),
    join(basePath, 'memory', 'watchlists.json'),
    join(basePath, 'memory', 'watchlist.json'),
  ]
  const legacyFundPaths = [
    join(basePath, 'fund_watchlists.json'),
    join(basePath, 'memory', 'fund_watchlists.json'),
    join(basePath, 'memory', 'fund-watchlist.json'),
  ]
  const out: Array<Record<string, any>> = []
  for (const path of unifiedPaths) {
    if (!existsSync(path)) continue
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      if (Array.isArray(data?.items)) out.push(...data.items)
    } catch {}
  }
  const existing = new Set(out.map((item) => String(item.symbol ?? item.code ?? '').trim()).filter(Boolean))
  for (const path of legacyFundPaths) {
    if (!existsSync(path)) continue
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      if (!Array.isArray(data?.items)) continue
      for (const item of data.items) {
        const code = String(item.code ?? '').trim()
        if (!code || existing.has(code)) continue
        out.push({ ...item, symbol: code, type: 'fund', source: item.source ?? 'legacy-fund-watchlist' })
        existing.add(code)
      }
    } catch {}
  }
  return out
}

function marketBoundarySignal(nowMs: number): { trigger: GoalTrigger; evidence: string } | null {
  const bj = new Date(nowMs + 8 * 60 * 60 * 1000)
  const day = bj.getUTCDay()
  if (day === 0 || day === 6) return null
  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  if (minutes >= 9 * 60 + 30 && minutes < 9 * 60 + 40) {
    return { trigger: 'market_open', evidence: 'A-share market open window in Beijing time.' }
  }
  if (minutes >= 15 * 60 && minutes < 15 * 60 + 10) {
    return { trigger: 'market_close', evidence: 'A-share market close window in Beijing time.' }
  }
  return null
}
