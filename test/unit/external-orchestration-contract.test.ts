import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import {
  externalArbitrationContract,
  externalEvidenceLedgerContract,
  externalInterventionContract,
  externalTaskBriefContract,
  promptForExternalIntervention,
  promptForExternalTaskBrief,
  validateExternalArbitration,
  validateExternalEvidenceLedger,
  validateExternalIntervention,
} from '../../src/agent/external-orchestration-contract'

function taskBrief(overrides: Record<string, unknown> = {}) {
  return {
    contract: externalTaskBriefContract,
    taskId: 'task-1', request: 'Analyze 600519 with current evidence.',
    product: 'workstation', category: 'analysis', operation: 'run',
    arguments: { symbol: '600519' },
    evidenceRequirements: [{ id: 'quote', description: 'Current quote and source timestamp' }],
    uiRuntime: 'headless', allowedSideEffect: 'read-only', interactionPolicy: 'caller-mediated',
    completionConditions: ['Every required evidence item has a status'],
    ...overrides,
  }
}

describe('external orchestration contracts', () => {
  it('produces a bounded task prompt and rejects escalation', () => {
    expect(promptForExternalTaskBrief({ runtime: 'workstation', brief: taskBrief() }))
      .toContain('calling code agent owns the evidence checklist')
    expect(() => promptForExternalTaskBrief({ runtime: 'workstation', brief: taskBrief({ product: 'mobile' }) }))
      .toThrow(/does not match/)
    expect(() => promptForExternalTaskBrief({
      runtime: 'workstation', brief: taskBrief({ category: 'execution', operation: 'simulate' }),
    })).toThrow(/broader than allowedSideEffect/)
  })

  it('preserves intervention coordinates and validates evidence ownership', () => {
    const intervention = validateExternalIntervention({
      contract: externalInterventionContract, taskId: 'task-1', intent: 'fill_evidence_gap',
      target: { product: 'workstation', runId: 'run-1', sessionId: 'session-1', turnId: 'turn-1', toolCallId: 'tool-1' },
      rationale: 'Quote timestamp is missing.', expectedContract: 'analysis-evidence-v1',
      changeRequest: { requirementId: 'quote' },
    })
    expect(intervention.target.toolCallId).toBe('tool-1')
    expect(promptForExternalIntervention({ runtime: 'workstation', intervention })).toContain('append corrected evidence')

    const ledger = validateExternalEvidenceLedger({
      contract: externalEvidenceLedgerContract, taskId: 'task-1', product: 'workstation',
      entries: [{ id: 'event:3', requirementId: 'quote', status: 'success', coordinates: { runId: 'run-1', sequence: 3 } }],
    })
    expect(ledger.entries).toHaveLength(1)
    expect(() => validateExternalArbitration({
      contract: externalArbitrationContract, taskId: 'task-1', product: 'workstation', disposition: 'accepted',
      coordinates: [], claims: [{ claim: 'Quote is current', evidenceEntryIds: [] }], conflicts: [], interventions: [],
      safetyState: { sideEffect: 'read-only' }, remainingUncertainty: [], finalSummary: 'Accepted.', artifactIds: [],
    })).toThrow(/needs evidenceEntryIds/)
  })

  it('writes immutable report revisions with parent lineage', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'finagent-revision-'))
    const registry = new ArtifactRegistry(basePath)
    const first = registry.registerReportRevision({
      logicalReportId: 'stock-report', title: 'Stock report', source: 'code-agent', content: { summary: 'first' },
      changeSummary: 'Initial report', evidenceEntryIds: ['event:3'], sourceCoordinates: { runId: 'run-1' },
      now: new Date('2026-07-13T00:00:00Z'),
    })
    const original = readFileSync(join(basePath, first.path), 'utf-8')
    const second = registry.registerReportRevision({
      logicalReportId: 'stock-report', title: 'Stock report', source: 'code-agent', content: { summary: 'second' },
      changeSummary: 'Added risk evidence', evidenceEntryIds: ['event:3', 'event:8'],
      sourceCoordinates: { runId: 'run-1', sequence: 8 }, parentArtifactId: first.id,
      now: new Date('2026-07-13T00:01:00Z'),
    })
    expect(second.id).not.toBe(first.id)
    expect(second.links).toContain(first.stableRef)
    expect(readFileSync(join(basePath, first.path), 'utf-8')).toBe(original)
    expect(JSON.parse(readFileSync(join(basePath, second.path), 'utf-8')).parentArtifactId).toBe(first.id)
  })
})
