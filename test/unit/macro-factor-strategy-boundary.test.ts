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

  it('rejects macro research and news sources as executable StrategySpec signals', () => {
    const validation = validateStrategySpec({
      name: 'Macro research is evidence, not executable signal',
      assetClass: 'stock',
      symbol: '600519',
      indicators: [
        {
          id: 'research_claim',
          type: 'macro_research_document',
          source: 'query_macro_research_content',
        },
        {
          id: 'news_sentiment',
          type: 'news_sentiment',
          source: 'finance_news',
        },
      ],
      entry: {
        all: [
          { left: 'research_claim', op: '>', right: 0 },
          { left: 'macro_policy_event', op: '==', right: 'supportive' },
        ],
      },
      exit: {
        any: [
          { left: 'news_sentiment', op: '<', right: -0.5 },
        ],
      },
    })

    expect(validation.status).toBe('rejected')
    expect(validation.unsupported.join('\n')).toContain('unsupported indicator "macro_research_document"')
    expect(validation.unsupported.join('\n')).toContain('unsupported indicator "news_sentiment"')
    expect(validation.unsupported.join('\n')).toContain('entry rule source "macro_policy_event" is not declared')
    expect(validation.unsupported.join('\n')).toContain('unsupported executable rule source "news_sentiment"')
    expect(JSON.stringify(validation.unsupportedDetails)).toContain('macro_research_document')
    expect(validation.workflowAdvice).toContain('Do not replace')
  })
})
