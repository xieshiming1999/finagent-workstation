import { describe, expect, it } from 'vitest'
import {
  detectContentType,
  parseAnalysisEvidence,
  parseStrategyReview,
  parseTradePrep,
  stripFinanceContractLines,
} from '../../src/renderer/components/rich-content/parsers'

describe('analysis evidence rich content', () => {
  const content = JSON.stringify({
    symbol: '600519',
    analysisEvidence: {
      contract: 'analysis-evidence-v1',
      kind: 'stock_analysis',
      subject: { type: 'stock', id: '600519', name: '贵州茅台' },
      observedFacts: ['bars=200', 'latestClose=259.2'],
      interpretations: ['signal:站上20日均线'],
      missingEvidence: ['fundamental_valuation'],
      confidence: 'medium',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        sources: ['local kline_daily', 'local quote_snapshot'],
        interfaceId: 'stock.daily_kline',
        capabilityId: 'local.cache',
        canonicalSchema: 'kline_daily',
        canonicalTable: 'kline_daily',
        readbackAction: 'query_kline',
        sourceDataTime: '2026-07-02',
        fetchedAt: '2026-07-02T15:00:00',
        cacheStatus: 'cache-hit',
        coverageStatus: 'sufficient_for_technical',
      },
    },
  })

  it('detects analysis evidence tool results', () => {
    expect(detectContentType({ role: 'tool-result', content })).toBe('analysis-evidence')
  })

  it('parses analysis evidence view fields', () => {
    const parsed = parseAnalysisEvidence(content)

    expect(parsed).toMatchObject({
      kind: 'stock_analysis',
      subjectLabel: '贵州茅台 (600519)',
      confidence: 'medium',
      strategyReadiness: 'analysis_only',
      sourceDataTime: '2026-07-02',
      fetchedAt: '2026-07-02T15:00:00',
      interfaceId: 'stock.daily_kline',
      canonicalTable: 'kline_daily',
      readbackAction: 'query_kline',
      cacheStatus: 'cache-hit',
      coverageStatus: 'sufficient_for_technical',
    })
    expect(parsed?.observedFacts).toContain('bars=200')
    expect(parsed?.missingEvidence).toContain('fundamental_valuation')
    expect(parsed?.sources).toEqual(['local kline_daily', 'local quote_snapshot'])
  })

  it('parses strategy review contract lines embedded in assistant text', () => {
    const content = [
      '组合再平衡监控已触发。',
      'strategyReview:{"contract":"strategy-review-v1","reviewKind":"portfolio_rebalance_monitor","strategyId":"portfolio_rank_v1","signal":"review_rebalance","subjects":["600519","000858"],"boundaries":["no_portfolio_mutation"],"confirmation":"1"}',
    ].join('\n')

    const parsed = parseStrategyReview(content)

    expect(parsed).toMatchObject({
      reviewKind: 'portfolio_rebalance_monitor',
      strategyId: 'portfolio_rank_v1',
      signal: 'review_rebalance',
      confirmation: '1',
    })
    expect(parsed?.subjects).toEqual(['600519', '000858'])
    expect(stripFinanceContractLines(content)).toBe('组合再平衡监控已触发。')
  })

  it('detects and parses trade preparation contracts', () => {
    const content = 'tradePrep:{"contract":"trade-prep-v1","prepKind":"strategy_signal_position_sizing","strategyId":"custom_strategy_v1","signal":"entry","symbol":"300059","sizing":{"budget":20000,"shares":900},"evidence":{"xueqiuBalance":true,"portfolioSnapshot":true},"previews":{"portfolioPreview":true},"boundaries":["no_order_write"],"confirmation":"触发时再确认"}'

    expect(detectContentType({ role: 'tool-result', content })).toBe('trade-prep')
    expect(parseTradePrep(content)).toMatchObject({
      prepKind: 'strategy_signal_position_sizing',
      strategyId: 'custom_strategy_v1',
      signal: 'entry',
      symbol: '300059',
      confirmation: '触发时再确认',
      sizing: { budget: 20000, shares: 900 },
    })
  })
})
