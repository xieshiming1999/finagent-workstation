import { describe, expect, it } from 'vitest'

import { validateStrategySpec } from '../../src/domain/market/strategy-spec/strategy-spec-engine'

describe('macro factor strategy boundary', () => {
  it('rejects macro factor prose as an executable StrategySpec signal', () => {
    const validation = validateStrategySpec({
      name: 'Macro factor context is not an executable rule',
      assetClass: 'stock',
      symbol: '600519',
      indicators: [
        { id: 'macro_context', type: 'macro_factor', source: 'market_moving_factor_v1' },
      ],
      entry: {
        all: [
          { left: 'macro_context', op: '>', right: 0 },
        ],
      },
      exit: {
        any: [
          { type: 'stop_loss_pct', value: 8 },
        ],
      },
    })

    expect(validation.status).toBe('rejected')
    expect(validation.unsupported.join('\n')).toContain('unsupported indicator "macro_factor"')
    expect(JSON.stringify(validation.unsupportedDetails)).toContain('macro_factor')
    expect(validation.workflowAdvice).toContain('Do not replace')
  })
})
