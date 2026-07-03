import { describe, expect, it } from 'vitest'
import { buildUnclassifiedGubaObservation } from '../../src/agent/tools/research'

describe('Research sentiment contract', () => {
  it('keeps Guba titles as unclassified observations', () => {
    const result = buildUnclassifiedGubaObservation([
      '利好突破买入',
      '利空破位卖出',
    ], 'EastMoney Guba')

    expect(result).toMatchObject({ classification: 'unclassified', posts: 2 })
    expect(result).not.toHaveProperty('bullish')
    expect(result).not.toHaveProperty('bearish')
    expect(result).not.toHaveProperty('ratio')
  })
})
