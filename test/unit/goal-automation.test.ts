import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import { DataStore } from '../../src/agent/data/store/data-store'
import { GoalAutomationService } from '../../src/agent/goal-automation-service'
import { GoalManager, type GoalJudgment } from '../../src/agent/goal-manager'
import { GOAL_TEMPLATES, buildGoalPrompt, getGoalTemplate } from '../../src/agent/goal-templates'
import { NotificationQueue } from '../../src/agent/notification-queue'
import { Session } from '../../src/agent/session'
import { userMessage } from '../../src/agent/message'
import { verifyGoalState } from '../../src/agent/goal-verifier'

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-goal-automation-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

describe('goal-backed automation', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T10:00:00.000Z'))
    basePath = makeBasePath()
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    vi.useRealTimers()
    closeDb()
    if (basePath) rmSync(basePath, { recursive: true, force: true })
  })

  it('defines every requested template with criteria and verifier checks', () => {
    const ids = GOAL_TEMPLATES.map((template) => template.id)
    expect(ids).toEqual([
      'api_error_triage',
      'daily_data_health',
      'market_pulse_refresh',
      'watchlist_monitor',
      'dashboard_refresh',
      'report_generation',
      'provider_contract_probe',
    ])
    for (const template of GOAL_TEMPLATES) {
      expect(template.successCriteria.length).toBeGreaterThan(0)
      expect(template.guardrails.length).toBeGreaterThan(0)
      expect(template.verifierChecks.length).toBeGreaterThan(0)
      expect(buildGoalPrompt(template)).toContain('Verifier checks')
    }
    expect(GOAL_TEMPLATES.filter((template) => template.persistentDuty).map((template) => template.id)).toEqual([
      'api_error_triage',
      'daily_data_health',
      'market_pulse_refresh',
      'watchlist_monitor',
    ])
  })

  it('persists richer goal metadata compatibly', () => {
    const template = getGoalTemplate('api_error_triage')!
    const manager = new GoalManager(basePath)
    manager.set(buildGoalPrompt(template), template.defaultMaxTurns, {
      templateId: template.id,
      successCriteria: template.successCriteria,
      checkpoint: '/tmp/context.json',
      contextPackPath: '/tmp/context.json',
      source: `template:${template.id}`,
      planSnapshot: 'Plan: inspect recent API failures and summarize concrete fixes.',
      scope: 'API health logs only',
      doneCriteria: template.successCriteria,
      allowedTools: ['DataStore', 'MarketData'],
      verification: template.verifierChecks.join('; '),
      escalation: template.guardrails.join('; '),
      verifierResult: { status: 'unchecked', checkedAt: Date.now(), reason: 'test' },
      tokenBudget: 5000,
    })
    manager.recordTokenUsage(1200, 345)

    const reloaded = new GoalManager(basePath).getState()
    expect(reloaded?.templateId).toBe('api_error_triage')
    expect(reloaded?.successCriteria.length).toBe(template.successCriteria.length)
    expect(reloaded?.checkpoint).toBe('/tmp/context.json')
    expect(reloaded?.verifierResult?.status).toBe('unchecked')
    expect(reloaded?.createdAt).toBe(Date.now())
    expect(reloaded?.updatedAt).toBe(Date.now())
    expect(reloaded?.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(reloaded?.promptTokensUsed).toBe(1200)
    expect(reloaded?.completionTokensUsed).toBe(345)
    expect(reloaded?.tokensUsed).toBe(1545)
    expect(reloaded?.tokenBudget).toBe(5000)
    expect(reloaded?.artifact.objective).toContain('API/provider failures')
    expect(reloaded?.artifact.source).toBe('template:api_error_triage')
    expect(reloaded?.artifact.planSnapshot).toContain('recent API failures')
    expect(reloaded?.artifact.scope).toBe('API health logs only')
    expect(reloaded?.artifact.doneCriteria.length).toBe(template.successCriteria.length)
    expect(reloaded?.artifact.allowedTools).toEqual(['DataStore', 'MarketData'])
    const registry = new ArtifactRegistry(basePath)
    const goals = registry.list('goal')
    const snapshots = registry.list('plan_snapshot')
    expect(goals[0]).toMatchObject({
      path: join(basePath, 'memory', 'goal-state.json'),
      metadata: expect.objectContaining({ scope: 'API health logs only' }),
    })
    expect(snapshots[0]).toMatchObject({
      metadata: expect.objectContaining({
        goalArtifactId: goals[0]?.id,
        planSnapshot: expect.stringContaining('recent API failures'),
      }),
    })
    const status = new GoalManager(basePath).statusLine()
    expect(status).toContain('elapsed')
    expect(status).toContain('tokens')
  })

  it('persists goal turn, elapsed accounting, and loop work packet after evaluation', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 3, {
      planSnapshot: 'Plan: update the implementation and run focused tests.',
      verification: 'Focused tests pass.',
    })

    vi.advanceTimersByTime(65_000)
    const decision = await manager.evaluateAfterTurn(
      'Still working.',
      async () => judgment('continue', 'not done yet', 'progress_only'),
    )

    expect(decision.status).toBe('active')
    const reloaded = new GoalManager(basePath).getState()
    expect(reloaded?.turnsUsed).toBe(1)
    expect(reloaded?.elapsedMs).toBeGreaterThanOrEqual(65_000)
    expect(reloaded?.updatedAt).toBe(Date.now())
    expect(reloaded?.workPacket?.targetArtifact).toBe('plan_snapshot')
    expect(reloaded?.workPacket?.currentGap).toBe('not done yet')
    expect(reloaded?.workPacket?.progressKind).toBe('progress_only')
    expect(reloaded?.workPacket?.verification).toBe('Focused tests pass.')
    expect(decision.continuationPrompt).toContain('[Loop work packet]')
    expect(decision.continuationPrompt).toContain('Current gap: not done yet')
    expect(decision.continuationPrompt).toContain('Progress classification: progress_only')
    expect(decision.continuationPrompt).toContain('previous turn was progress-only')
    expect(decision.continuationPrompt).toContain('Verification: Focused tests pass.')
    expect(new GoalManager(basePath).statusLine()).toContain('1m 5s')
  })

  it('classifies implementation-like goal turns separately from progress-only turns', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 3)

    const decision = await manager.evaluateAfterTurn(
      'Implemented the parser fix and updated focused tests.',
      async () => judgment('continue', 'needs final verification', 'implementation'),
    )

    expect(decision.status).toBe('active')
    expect(new GoalManager(basePath).getState()?.workPacket?.progressKind).toBe('implementation')
    expect(decision.continuationPrompt).toContain('Progress classification: implementation')
  })

  it('uses structured evidence before classifying loop verification', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 3)

    await manager.evaluateAfterTurn(
      'I will run tests next.',
      async () => judgment('continue', 'needs real test evidence', 'progress_only'),
    )
    expect(new GoalManager(basePath).getState()?.workPacket?.progressKind).toBe('progress_only')

    const verifiedManager = new GoalManager(basePath)
    verifiedManager.resume()
    await verifiedManager.evaluateAfterTurn(
      'Ran pnpm --dir finagent_workstation test -- test/unit/goal-automation.test.ts. All tests passed. Commit a67ce21.',
      async () => judgment('continue', 'needs final ledger update', 'verification', [
        'test evidence: command output mentioned',
        'test evidence: passing result mentioned',
        'commit evidence: commit hash mentioned',
      ]),
    )
    const packet = new GoalManager(basePath).getState()?.workPacket

    expect(packet?.progressKind).toBe('verification')
    expect(packet?.evidence).toContain('test evidence: command output mentioned')
    expect(packet?.evidence).toContain('test evidence: passing result mentioned')
    expect(packet?.evidence).toContain('commit evidence: commit hash mentioned')
  })

  it('keeps goal artifact and work packet after session compaction reload', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 3, {
      planSnapshot: 'Plan: preserve the goal artifact through compact.',
      verification: 'Reloaded goal still has work packet.',
    })
    await manager.evaluateAfterTurn(
      'Still working.',
      async () => judgment('continue', 'need compact survival proof', 'progress_only'),
    )

    const session = new Session(basePath)
    session.appendMessage(userMessage('pre-compact details that should be summarized'))
    session.appendCompactBoundary('compact summary keeps only conversation state', 1)
    const loaded = session.load()
    expect(loaded.messages[0]?.isCompactSummary).toBe(true)

    const reloaded = new GoalManager(basePath).getState()
    expect(reloaded?.artifact.planSnapshot).toContain('preserve the goal artifact')
    expect(reloaded?.workPacket?.currentGap).toBe('need compact survival proof')
    expect(reloaded?.workPacket?.verification).toBe('Reloaded goal still has work packet.')
  })

  it('marks turn budget exhaustion as budget-limited and resumable', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 1)

    const decision = await manager.evaluateAfterTurn(
      'Still working.',
      async () => judgment('continue', 'not done yet', 'progress_only'),
    )

    expect(decision.status).toBe('budget_limited')
    expect(decision.shouldContinue).toBe(false)
    expect(decision.message).toContain('budget limited')
    const reloaded = new GoalManager(basePath)
    expect(reloaded.getState()?.status).toBe('budget_limited')
    expect(reloaded.hasGoal()).toBe(true)
    expect(reloaded.statusLine()).toContain('budget-limited')

    reloaded.resume()
    expect(reloaded.getState()?.status).toBe('active')
    expect(reloaded.getState()?.turnsUsed).toBe(0)
  })

  it('marks blocked judge outcomes as blocked and resumable', async () => {
    const manager = new GoalManager(basePath)
    manager.set('Keep working until done.', 3)

    const decision = await manager.evaluateAfterTurn(
      'I need user input before continuing.',
      async () => judgment('blocked', 'Waiting for user input.', 'blocked'),
    )

    expect(decision.status).toBe('blocked')
    expect(decision.verdict).toBe('blocked')
    expect(decision.shouldContinue).toBe(false)
    expect(decision.message).toContain('Goal blocked')
    const reloaded = new GoalManager(basePath)
    expect(reloaded.getState()?.status).toBe('blocked')
    expect(reloaded.getState()?.verifierResult?.reason).toContain('Goal blocked')
    expect(reloaded.hasGoal()).toBe(true)
    expect(reloaded.statusLine()).toContain('blocked')

    reloaded.resume()
    expect(reloaded.getState()?.status).toBe('active')
  })

  it('skips api_error_triage when there are no recent failures', () => {
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(basePath),
      getDataStore: () => store,
    })

    const result = service.runNow('api_error_triage')
    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('No recent finance API failures')
    expect(eventAgent.notifications.length).toBe(0)
  })

  it('queues api_error_triage with a persisted context pack for recent failures', () => {
    store.saveApiCall({
      source: 'eastmoney',
      tool: 'BridgeIPC',
      action: 'index-quotes',
      endpoint: '/api/finance/index/quotes',
      status: 0,
      success: false,
      failure_class: 'contract_mismatch',
      duration_ms: 30459,
      error: 'provider contract mismatch',
      created_at: new Date().toISOString(),
    })
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(basePath),
      getDataStore: () => store,
    })

    const result = service.runNow('api_error_triage')
    expect(result.status).toBe('queued')
    expect(result.contextPackPath).toBeTruthy()
    expect(eventAgent.goalManager.getState()?.templateId).toBe('api_error_triage')
    expect(eventAgent.notifications.length).toBe(1)
    const contextText = readFileSync(result.contextPackPath!, 'utf-8')
    expect(contextText).toContain('provider contract mismatch')
    expect(contextText).toContain('recentApiFailureClasses')
    expect(contextText).toContain('contract_mismatch')
    expect(contextText).toContain('sessionState')
    expect(contextText).toContain('relevantFiles')
    const registry = new ArtifactRegistry(basePath)
    expect(registry.list('context_pack')[0]).toMatchObject({
      path: result.contextPackPath,
      ownerTask: 'api_error_triage',
      verificationStatus: 'verified',
      expiresAt: expect.any(String),
      freshness: expect.objectContaining({ windowMinutes: 30, status: 'fresh' }),
      provenance: expect.objectContaining({ source: 'goal-context-pack' }),
      links: expect.arrayContaining([expect.stringContaining('artifact:context_pack:'), result.contextPackPath]),
    })
    expect(registry.list('api_error')[0]).toMatchObject({
      ownerTask: 'api_error_triage',
      verificationStatus: 'verified',
      freshness: expect.objectContaining({ windowMinutes: 30, status: 'fresh' }),
      provenance: expect.objectContaining({ source: 'api_call_log', classifier: 'api-failure-classifier' }),
      metadata: expect.objectContaining({
        recentApiFailures: 1,
        classes: expect.arrayContaining([
          expect.objectContaining({ classification: 'contract_mismatch' }),
        ]),
      }),
    })
  })

  it('runs enabled api_error_triage from API failure threshold trigger', () => {
    for (let i = 0; i < 3; i += 1) {
      store.saveApiCall({
        source: 'eastmoney',
        tool: 'BridgeIPC',
        action: 'index-quotes',
        endpoint: '/api/finance/index/quotes',
        status: 0,
        success: false,
        duration_ms: 1000 + i,
        error: `provider contract mismatch ${i}`,
        created_at: new Date().toISOString(),
      })
    }
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('api_error_triage', true)

    const runs = service.evaluateTriggers('schedule')

    expect(runs[0]?.status).toBe('queued')
    expect(runs[0]?.trigger).toBe('api_failure_threshold')
    expect(eventAgent.goalManager.getState()?.automation?.trigger).toBe('api_failure_threshold')
    expect(service.list().find((row) => row.template.id === 'api_error_triage')?.state.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('does not run api_error_triage for unrelated API failures', () => {
    for (let i = 0; i < 3; i += 1) {
      store.saveApiCall({
        source: 'paper',
        tool: 'PaperSearch',
        action: 'paper-search',
        endpoint: '/api/paper/search',
        status: 0,
        success: false,
        duration_ms: 1000 + i,
        error: `paper search timeout ${i}`,
        created_at: new Date().toISOString(),
      })
    }
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('api_error_triage', true)

    const runs = service.evaluateTriggers('schedule')
    const result = service.runNow('api_error_triage')

    expect(runs).toHaveLength(0)
    expect(eventAgent.notifications.length).toBe(0)
    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('No recent finance API failures')
    const contextText = readFileSync(result.contextPackPath!, 'utf-8')
    expect(contextText).not.toContain('paper search timeout')
    expect(contextText).toContain('"recentApiFailures": []')
    expect(service.list().find((row) => row.template.id === 'api_error_triage')?.state.lastTriggerEvidence).toContain('0 recent finance API failures')
  })

  it('records cooldown after event agent unavailable failure', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => null,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })

    const result = service.runNow('daily_data_health')

    const state = service.list().find((row) => row.template.id === 'daily_data_health')!.state
    expect(result.status).toBe('failed')
    expect(state.failureCount).toBe(1)
    expect(state.nextRunAt).toBeGreaterThan(Date.now())
    expect(state.triggerLedger[0]).toMatchObject({
      status: 'failed',
      reason: 'Event agent unavailable',
      nextRunAt: state.nextRunAt,
    })
  })

  it('offers capped consent-first automation suggestions without enabling templates', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })

    const first = service.listSuggestions()
    const second = service.listSuggestions()

    expect(first).toHaveLength(5)
    expect(second.map((suggestion) => suggestion.dedupKey)).toEqual(first.map((suggestion) => suggestion.dedupKey))
    expect(service.list().filter((row) => row.state.enabled)).toHaveLength(0)
  })

  it('seeds consent-first automation suggestions from doctor warnings', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })

    const suggestions = service.listSuggestions({
      checks: [
        {
          id: 'api_failures',
          status: 'warning',
          detail: '3 failure(s) in the last 30 minutes (eastmoney:3).',
          nextStep: 'Inspect API Health recent errors.',
        },
      ],
    })

    expect(suggestions[0]).toMatchObject({
      templateId: 'api_error_triage',
      source: 'integration',
      dedupKey: 'doctor:api_failures:api_error_triage',
    })
    expect(service.list().find((row) => row.template.id === 'api_error_triage')?.state.enabled).toBe(false)
  })

  it('accepts a doctor suggestion through the existing template enable path', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    const suggestion = service.listSuggestions({
      checks: [{ id: 'api_failures', status: 'critical', detail: '5 failures.' }],
    }).find((row) => row.dedupKey === 'doctor:api_failures:api_error_triage')!

    const result = service.acceptSuggestion(suggestion.id)

    expect(result.ok).toBe(true)
    expect(service.list().find((row) => row.template.id === 'api_error_triage')?.state.enabled).toBe(true)
    expect(service.listSuggestions({
      checks: [{ id: 'api_failures', status: 'critical', detail: '5 failures.' }],
    }).some((row) => row.dedupKey === suggestion.dedupKey)).toBe(false)
  })

  it('accepts an automation suggestion by enabling the existing template', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    const suggestion = service.listSuggestions()[0]!

    const result = service.acceptSuggestion(suggestion.id)

    expect(result.ok).toBe(true)
    expect(service.list().find((row) => row.template.id === suggestion.templateId)?.state.enabled).toBe(true)
    expect(service.listSuggestions().some((row) => row.templateId === suggestion.templateId)).toBe(false)
  })

  it('dismisses automation suggestions without re-offering the same template', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    const suggestion = service.listSuggestions()[0]!

    const result = service.dismissSuggestion(suggestion.id)

    expect(result.ok).toBe(true)
    expect(service.listSuggestions().some((row) => row.templateId === suggestion.templateId)).toBe(false)
    expect(service.list().find((row) => row.template.id === suggestion.templateId)?.state.enabled).toBe(false)
  })

  it('does not schedule watchlist_monitor without active watchlist inputs', () => {
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('watchlist_monitor', true)

    const runs = service.evaluateTriggers('schedule')

    expect(runs).toHaveLength(0)
    const state = service.list().find((row) => row.template.id === 'watchlist_monitor')?.state
    expect(state?.lastTriggerEvidence).toContain('No active watchlist items')
    expect(state?.triggerLedger[0]?.status).toBe('not_due')
    expect(state?.triggerLedger[0]?.reason).toContain('No active watchlist items')
  })

  it('persists and dedupes goal automation trigger ledger entries', () => {
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('watchlist_monitor', true)

    service.evaluateTriggers('schedule')
    service.evaluateTriggers('schedule')

    const state = service.list().find((row) => row.template.id === 'watchlist_monitor')?.state
    expect(state?.triggerLedger).toHaveLength(1)
    expect(state?.triggerLedger[0]?.status).toBe('not_due')
    expect(state?.triggerLedger[0]?.repeatCount).toBe(2)

    const reloaded = new GoalAutomationService(basePath, {
      getEventAgent: () => fakeAgent(basePath),
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    const reloadedState = reloaded.list().find((row) => row.template.id === 'watchlist_monitor')?.state
    expect(reloadedState?.triggerLedger[0]?.repeatCount).toBe(2)
  })

  it('skips manual-only templates during scheduled automation', () => {
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('report_generation', true)
    service.setEnabled('provider_contract_probe', true)

    const runs = service.evaluateTriggers('schedule')

    expect(runs).toHaveLength(0)
    expect(eventAgent.notifications.length).toBe(0)
    const report = service.list().find((row) => row.template.id === 'report_generation')?.state
    const probe = service.list().find((row) => row.template.id === 'provider_contract_probe')?.state
    expect(report?.triggerLedger[0]).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('manual run-now'),
    })
    expect(probe?.triggerLedger[0]).toMatchObject({
      status: 'skipped',
      evidence: expect.stringContaining('persistent duties'),
    })
  })

  it('queues watchlist_monitor when active watchlist inputs exist', () => {
    mkdirSync(join(basePath, 'memory'), { recursive: true })
    writeFileSync(join(basePath, 'memory', 'watchlist.json'), JSON.stringify({
      items: [{ symbol: '600519', status: 'watching', conditions: [{ field: 'price', op: '>', value: 1000, triggered: false }] }],
    }), 'utf-8')
    const eventAgent = fakeAgent(basePath)
    const service = new GoalAutomationService(basePath, {
      getEventAgent: () => eventAgent,
      getChatAgent: () => fakeAgent(join(basePath, 'chat-agent')),
      getDataStore: () => store,
    })
    service.setEnabled('watchlist_monitor', true)

    const runs = service.evaluateTriggers('schedule')

    expect(runs[0]?.status).toBe('queued')
    expect(runs[0]?.trigger).toBe('watchlist_condition')
    const state = service.list().find((row) => row.template.id === 'watchlist_monitor')?.state
    expect(state?.lastTrigger).toBe('watchlist_condition')
    expect(state?.lastTriggerEvidence).toContain('monitor rules')
  })

  it('verifies automated API triage completion with classification evidence', () => {
    const eventAgent = fakeAgent(basePath)
    const template = getGoalTemplate('api_error_triage')!
    const contextPath = join(basePath, 'memory', 'context.json')
    mkdirSync(join(basePath, 'memory'), { recursive: true })
    writeFileSync(contextPath, JSON.stringify({
      recentApiFailures: [{ error: 'provider contract mismatch' }],
      recentApiFailureClasses: [{ classification: 'provider_contract', count: 1 }],
    }), 'utf-8')
    store.saveApiCall({
      source: 'eastmoney',
      tool: 'BridgeIPC',
      action: 'index-quotes',
      endpoint: '/api/finance/index/quotes',
      status: 0,
      success: false,
      duration_ms: 1,
      error: 'provider contract mismatch',
      created_at: new Date().toISOString(),
    })
    eventAgent.goalManager.set(buildGoalPrompt(template), template.defaultMaxTurns, {
      templateId: template.id,
      contextPackPath: contextPath,
      automation: { trigger: 'api_failure_threshold', runId: 'run-1', source: 'test' },
    })
    const state = eventAgent.goalManager.getState()!
    expect(verifyGoalState(
      state,
      judgment('complete', 'Typed classification is complete.', 'verification', [contextPath]),
      basePath,
    )).toMatchObject({ status: 'passed' })
    expect(verifyGoalState(
      state,
      judgment('complete', 'No evidence reference.', 'verification'),
      basePath,
    )).toMatchObject({ status: 'failed' })
  })

  it('requires dashboard/report artifacts to include source evidence', () => {
    const template = getGoalTemplate('report_generation')!
    const contextPath = join(basePath, 'memory', 'report-context.json')
    const artifactPath = join(basePath, 'memory', 'reports', 'report.md')
    mkdirSync(join(basePath, 'memory', 'reports'), { recursive: true })
    writeFileSync(contextPath, JSON.stringify({ dataCoverage: [{ source: 'local' }], providerHealth: [] }), 'utf-8')
    writeFileSync(artifactPath, '# Report\n', 'utf-8')
    const manager = new GoalManager(basePath)
    manager.set(buildGoalPrompt(template), template.defaultMaxTurns, {
      templateId: template.id,
      contextPackPath: contextPath,
      automation: { trigger: 'run_now', runId: 'report-1', source: 'test' },
    })
    const state = manager.getState()!
    new ArtifactRegistry(basePath).register({
      kind: 'report',
      path: artifactPath,
      title: 'Report',
      source: 'test',
      id: 'report:goal-verifier',
    })

    expect(verifyGoalState(
      state,
      judgment('complete', 'Only context was referenced.', 'verification', [contextPath]),
      basePath,
    )).toMatchObject({ status: 'failed' })
    expect(verifyGoalState(
      state,
      judgment('complete', 'Typed report artifact is complete.', 'verification', ['artifact:report:goal-verifier']),
      basePath,
    )).toMatchObject({ status: 'passed' })
  })
})

function fakeAgent(basePath: string) {
  return {
    goalManager: new GoalManager(basePath),
    notifications: new NotificationQueue(),
  } as any
}

function judgment(
  outcome: GoalJudgment['outcome'],
  reason: string,
  progressKind: GoalJudgment['progressKind'],
  evidence: string[] = [],
): GoalJudgment {
  return {
    outcome,
    reason,
    parseFailed: false,
    progressKind,
    progressSummary: null,
    evidence,
    safetyBoundary: 'not_applicable',
  }
}
