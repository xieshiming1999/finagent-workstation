import { describe, expect, it } from 'vitest'
import {
  buildAnalysisActionPrompt,
  createAnalysisEvidencePackage,
} from '../../src/domain/market/analysis/analysis-evidence-contract'

describe('analysis evidence contract', () => {
  it('keeps research evidence separate from strategy state', () => {
    const payload = createAnalysisEvidencePackage({
      kind: 'stock_analysis',
      subject: { type: 'stock', id: '600519', name: '贵州茅台' },
      observedFacts: ['bars=120', 'latestClose=1500'],
      interpretations: ['risk:RSI overbought'],
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
        cacheStatus: 'cache-hit',
        coverageStatus: 'sufficient_for_technical',
      },
    })

    expect(payload.contract).toBe('analysis-evidence-v1')
    expect(payload.strategyReadiness).toBe('analysis_only')
    expect(payload.missingEvidence).toContain('fundamental_valuation')
    expect(payload.sourceCoverage.coverageStatus).toBe('sufficient_for_technical')
    expect(payload.sourceCoverage.interfaceId).toBe('stock.daily_kline')
    expect(payload.sourceCoverage.canonicalTable).toBe('kline_daily')
    expect(payload.sourceCoverage.readbackAction).toBe('query_kline')
  })

  it('builds action prompts that preserve the analysis-only boundary', () => {
    const prompt = buildAnalysisActionPrompt({
      action: 'dashboard',
      kind: 'fund_analysis',
      sourceSurface: 'the Fund Pulse panel',
      subject: { type: 'fund', id: '000001', name: '华夏成长' },
    })

    expect(prompt).toContain('analysis-evidence-v1')
    expect(prompt).toContain('missing evidence')
    expect(prompt).toContain('do not present analysis as a validated strategy')
  })

  it('rejects unknown analysis vocabulary', () => {
    expect(() => createAnalysisEvidencePackage({
      kind: 'prompt_specific_guess' as never,
      subject: { type: 'stock', id: '600519' },
      observedFacts: [],
      interpretations: [],
      missingEvidence: [],
      confidence: 'medium',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        sources: [],
        coverageStatus: 'partial',
      },
    })).toThrow(/Unknown analysis evidence kind/)

    expect(() => createAnalysisEvidencePackage({
      kind: 'stock_analysis',
      subject: { type: 'raw_provider_payload' as never, id: '600519' },
      observedFacts: [],
      interpretations: [],
      missingEvidence: [],
      confidence: 'medium',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        sources: [],
        coverageStatus: 'partial',
      },
    })).toThrow(/Unknown analysis subject type/)
  })
})
