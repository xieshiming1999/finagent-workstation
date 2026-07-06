import { describe, expect, it } from 'vitest'
import { parseGoalJudgeResponse } from '../../src/agent/goal-judge'

describe('goal judge typed contract', () => {
  it('accepts goal-judge-result-v1', () => {
    const result = parseGoalJudgeResponse(JSON.stringify({
      contract: 'goal-judge-result-v1',
      outcome: 'continue',
      reason: 'Verification remains.',
      safetyBoundary: 'no_side_effect',
      progress: {
        kind: 'implementation',
        summary: 'Changed the parser.',
        evidenceRefs: ['artifact:diff:1'],
      },
    }))

    expect(result).toMatchObject({
      parseFailed: false,
      outcome: 'continue',
      progressKind: 'implementation',
      evidence: ['artifact:diff:1'],
    })
  })

  it.each([
    '```json\n{"done":true,"reason":"done"}\n```',
    'Result: {"done":"yes","reason":"done"}',
    JSON.stringify({
      contract: 'goal-judge-result-v1',
      outcome: 'blocked',
      reason: 'input required',
      safetyBoundary: 'no_side_effect',
      progress: { kind: 'implementation', summary: '', evidenceRefs: [] },
    }),
  ])('rejects non-contract or inconsistent reply %#', (reply) => {
    expect(parseGoalJudgeResponse(reply)).toMatchObject({
      parseFailed: true,
      outcome: 'continue',
    })
  })
})
