import { describe, expect, it } from 'vitest'
import { windGlobalRecommendationRows } from '../../src/agent/data/normalizers/wind-normalizer'

describe('Wind recommendation typed contract', () => {
  it('accepts numeric source fields', () => {
    const rows = windGlobalRecommendationRows({ data: {
      columns: ['Wind代码', '日期', '买入', '持有'],
      rows: [['AAPL.US', '20260714', 12, 3]],
    } }, '')

    expect(rows[0]).toMatchObject({ symbol: 'AAPL', buy: 12, hold: 3 })
  })

  it('ignores free-form rating prose', () => {
    const rows = windGlobalRecommendationRows({ data: {
      columns: ['Wind代码', '日期', '投资评级'],
      rows: [['AAPL.US', '20260714', '强烈买入']],
    } }, '')

    expect(rows).toEqual([])
  })
})
