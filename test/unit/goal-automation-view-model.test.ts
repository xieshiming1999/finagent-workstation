import { describe, expect, it } from 'vitest'
import { buildGoalAutomationDisplay, type GoalAutomationViewItem } from '../../src/renderer/components/goal-automation-view-model'

describe('goal automation view model', () => {
  it('surfaces latest decision, repeat count, and manual-only skip evidence', () => {
    const display = buildGoalAutomationDisplay(item({
      enabled: true,
      lastTriggerEvidence: 'Loop automation is limited to narrow persistent duties.',
      triggerLedger: [{
        at: 1000,
        requestedTrigger: 'schedule',
        resolvedTrigger: 'schedule',
        status: 'skipped',
        reason: 'Skipped because this template is manual run-now only, not a persistent duty.',
        evidence: 'Loop automation is limited to narrow persistent duties.',
        nextRunAt: null,
        runId: null,
        repeatCount: 3,
      }],
    }), (value) => `t${value}`)

    expect(display.state).toBe('enabled')
    expect(display.latestDecisionText).toContain('skipped')
    expect(display.latestDecisionText).toContain('(3x)')
    expect(display.evidence).toContain('persistent duties')
    expect(display.decisionHistory).toHaveLength(1)
  })

  it('marks escalation and errors as attention while preserving last error as result', () => {
    const display = buildGoalAutomationDisplay(item({
      enabled: true,
      escalationNeeded: true,
      lastError: 'Event agent unavailable',
      lastResult: 'queued',
    }), (value) => String(value))

    expect(display.state).toBe('attention')
    expect(display.lastResult).toBe('Event agent unavailable')
  })

  it('falls back to template objective when no trigger evidence exists', () => {
    const display = buildGoalAutomationDisplay(item({
      enabled: false,
      lastTriggerEvidence: null,
      triggerLedger: [],
    }), (value) => String(value))

    expect(display.state).toBe('disabled')
    expect(display.evidence).toBe('Template objective')
    expect(display.latestDecisionText).toBe('-')
  })

  it('summarizes active loop work packet for compact UI display', () => {
    const display = buildGoalAutomationDisplay({
      ...item({ enabled: true }),
      activeGoal: {
        status: 'active',
        turnsUsed: 2,
        maxTurns: 5,
        workPacket: {
          currentGap: 'tests still need readback evidence',
          nextPrompt: 'Run focused tests and inspect output.',
          progressKind: 'progress_only',
        },
      },
    }, (value) => String(value))

    expect(display.activeWorkText).toBe('progress_only: tests still need readback evidence')
    expect(display.activeWorkPacket?.nextPrompt).toContain('focused tests')
  })

  it('builds a formal task summary from goal artifact, template needs, and evidence', () => {
    const display = buildGoalAutomationDisplay({
      ...item({ enabled: true }),
      template: {
        id: 'api_error_triage',
        title: 'API Error',
        objective: 'Triage recent failures',
        contextNeeds: ['recent API failures', 'provider health'],
        guardrails: ['Stop on quota/auth errors'],
      },
      activeGoal: {
        status: 'active',
        turnsUsed: 3,
        maxTurns: 8,
        tokenBudget: 12000,
        tokensUsed: 4000,
        successCriteria: ['Focused verification passes'],
        checkpoint: '/tmp/checkpoint.json',
        contextPackPath: '/tmp/context.json',
        artifact: {
          objective: 'Fix provider contract mismatch',
          scope: 'index quotes',
          doneCriteria: ['Parser and readback updated'],
          verification: 'Run provider route tests',
          escalation: 'Escalate credentials or provider outage',
        },
        verifierResult: {
          status: 'failed',
          reason: 'readback missing',
          evidence: ['verifier evidence'],
        },
        workPacket: {
          currentGap: 'readback test missing',
          nextPrompt: 'Add the readback test.',
          progressKind: 'implementation',
          evidence: ['commit abc123'],
          verification: 'Run focused route test.',
        },
      },
    }, (value) => String(value))

    expect(display.taskSummary?.objective).toBe('Fix provider contract mismatch')
    expect(display.taskSummary?.dataRequirements).toContain('recent API failures')
    expect(display.taskSummary?.riskBoundary).toContain('Stop on quota')
    expect(display.taskSummary?.budget).toBe('4000/12000 tokens · 3/8 turns')
    expect(display.taskSummary?.doneCriteria).toContain('Parser and readback updated')
    expect(display.taskSummary?.evidence).toContain('commit abc123')
  })
})

function item(state: Partial<GoalAutomationViewItem['state']>): GoalAutomationViewItem {
  return {
    template: { id: 'report_generation', title: 'Report', objective: 'Template objective' },
    state: {
      enabled: false,
      paused: false,
      lastRunAt: null,
      nextRunAt: null,
      lastTrigger: null,
      lastTriggerEvidence: null,
      lastCheckpoint: null,
      lastError: null,
      lastResult: null,
      escalationNeeded: false,
      failureCount: 0,
      triggerLedger: [],
      ...state,
    },
  }
}
