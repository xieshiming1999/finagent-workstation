import { describe, expect, it } from 'vitest'
import {
  buildMarketSnapshotAnalysisEvidence,
  classifySnapshotLeader,
  formatSnapshot,
} from '../../src/agent/data/market-snapshot'

describe('market snapshot classification', () => {
  it('classifies option-like leaderboard names as filtered derivatives', () => {
    const row = classifySnapshotLeader('OPT1', '科创板50沽6月1250', 233.33)

    expect(row.isFiltered).toBe(true)
    expect(row.category).toBe('derivative')
    expect(row.instrumentType).toBe('option')
    expect(row.displayName).toContain('Put')
    expect(row.explanation).toContain('expires month 6')
    expect(row.explanation).toContain('1250')
  })

  it('classifies N-prefixed names as IPO-style movers', () => {
    const row = classifySnapshotLeader('N1', 'N彩客', 196.76)

    expect(row.isFiltered).toBe(true)
    expect(row.category).toBe('ipo')
    expect(row.instrumentType).toBe('ipo')
    expect(row.explanation).toContain('IPO')
  })

  it('keeps ordinary sector names as visible sectors', () => {
    const row = classifySnapshotLeader('BK0475', '白酒', 4.23)

    expect(row.isFiltered).toBe(false)
    expect(row.category).toBe('industry')
    expect(row.displayName).toBe('白酒')
  })

  it('formats non-sector movers separately in snapshot text', () => {
    const sector = classifySnapshotLeader('BK0475', '白酒', 4.23)
    const derivative = classifySnapshotLeader('OPT1', '科创板50沽6月1250', 233.33)
    const text = formatSnapshot({
      timestamp: '2026-06-08T10:00:00.000Z',
      indices: [],
      topGainers: [],
      topLosers: [],
      limitUpCount: 45,
      limitDownCount: 3,
      northboundNet: 0,
      hotStocks: [],
      sectorLeaders: [sector],
      nonSectorMovers: [derivative],
      failedSources: [],
      regime: 'bullish',
      regimeReason: 'test',
    })

    expect(text).toContain('Top Sectors:')
    expect(text).toContain('白酒')
    expect(text).toContain('Non-sector movers:')
    expect(text).toContain('Put')
  })

  it('includes source warnings in snapshot text when data is partial', () => {
    const sector = classifySnapshotLeader('BK0475', '白酒', 4.23)
    const text = formatSnapshot({
      timestamp: '2026-06-08T10:00:00.000Z',
      indices: [],
      topGainers: [],
      topLosers: [],
      limitUpCount: 45,
      limitDownCount: 3,
      northboundNet: 0,
      hotStocks: [],
      sectorLeaders: [sector],
      nonSectorMovers: [],
      failedSources: ['index-quotes: akshare: timeout'],
      regime: 'bullish',
      regimeReason: 'test',
    })

    expect(text).toContain('Data warnings:')
    expect(text).toContain('index-quotes: akshare: timeout')
  })

  it('formats hot stocks with name, code, heat, and rank change', () => {
    const text = formatSnapshot({
      timestamp: '2026-06-08T10:00:00.000Z',
      indices: [],
      topGainers: [],
      topLosers: [],
      limitUpCount: 45,
      limitDownCount: 3,
      northboundNet: 0,
      hotStocks: [{ code: '000725', name: '京东方A', rank: 1, rankChange: 2, hotValue: 156000 }],
      sectorLeaders: [],
      nonSectorMovers: [],
      failedSources: [],
      regime: 'bullish',
      regimeReason: 'test',
    })

    expect(text).toContain('Hot stocks:')
    expect(text).toContain('京东方A (000725)')
    expect(text).toContain('Heat:15.6e4')
    expect(text).toContain('Rank change:up 2')
  })

  it('builds market analysis evidence for snapshots', () => {
    const sector = classifySnapshotLeader('BK0475', '白酒', 4.23)
    const evidence = buildMarketSnapshotAnalysisEvidence({
      timestamp: '2026-06-08T10:00:00.000Z',
      indices: [],
      topGainers: [],
      topLosers: [],
      limitUpCount: 45,
      limitDownCount: 3,
      northboundNet: 1200000000,
      hotStocks: [{ code: '000725', name: '京东方A', rank: 1, rankChange: 2, hotValue: 156000, price: 6.9, changePct: 5.6 }],
      sectorLeaders: [sector],
      nonSectorMovers: [],
      failedSources: [],
      regime: 'bullish',
      regimeReason: 'test',
    })

    expect(evidence).toMatchObject({
      contract: 'analysis-evidence-v1',
      kind: 'market_analysis',
      strategyReadiness: 'analysis_only',
      sourceCoverage: {
        interfaceId: 'market.overview',
        canonicalSchema: 'market_snapshot',
        readbackAction: 'loadLatestSnapshot',
        sourceDataTime: '2026-06-08',
        cacheStatus: 'snapshot',
        coverageStatus: 'sufficient_for_analysis',
      },
    })
    expect(evidence.observedFacts).toContain('regime=bullish')
  })
})
