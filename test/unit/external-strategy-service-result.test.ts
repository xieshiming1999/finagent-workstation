import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildExternalStrategyServiceResult } from '../../src/domain/finance/workflows/external-strategy-service-result'

describe('external strategy service result', () => {
  it('packages structured backtest evidence into a registered strategy artifact', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'finagent-external-strategy-'))
    const result = buildExternalStrategyServiceResult({
      basePath,
      payload: {
        externalOperationContract: 'finagent.finance-operation.v1',
        commandPlan: {
          category: 'strategy',
          operation: 'review',
          payload: {
            strategy: { name: 'SMA review' },
            symbols: ['600519'],
            backtest: true,
          },
        },
      },
      messages: [
        {
          toolUses: [{
            id: 'tool-1',
            name: 'MarketData',
            input: { action: 'custom_strategy_backtest' },
          }],
        },
        {
          toolResult: {
            toolUseId: 'tool-1',
            isError: false,
            content: JSON.stringify({
              action: 'custom_strategy_backtest',
              status: 'backtested',
              code: '600519',
              strategyId: 'sma_review_v1',
              bars: 124,
              actualStartDate: '2026-01-06',
              actualEndDate: '2026-07-13',
              metrics: { totalReturnPct: 0 },
              dataEvidence: { source: 'local kline_daily', cacheStatus: 'local-hit' },
            }),
          },
        },
      ],
    })

    expect(result).toBeDefined()
    expect(JSON.parse(result!.finalAnswer)).toMatchObject({
      contract: 'strategy-review-v1',
      operationId: 'strategy.review',
      status: 'backtested',
      artifactId: result!.record.id,
    })
    expect(result!.record.verificationStatus).toBe('verified')
    expect(result!.record.path).not.toMatch(/^\//)
    expect(JSON.parse(readFileSync(join(basePath, result!.record.path), 'utf-8'))).toMatchObject({
      contract: 'strategy-review-v1',
      backtest: { status: 'backtested', bars: 124 },
    })
  })

  it('does not package unrelated or failed tool evidence', () => {
    expect(buildExternalStrategyServiceResult({
      basePath: mkdtempSync(join(tmpdir(), 'finagent-external-strategy-')),
      payload: { externalOperationContract: 'finagent.finance-operation.v1' },
      messages: [],
    })).toBeUndefined()
  })
})
