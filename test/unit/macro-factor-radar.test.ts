import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { readMacroFactorRadar, refreshMacroFactorRadar } from '../../src/main/macro-factor-radar'
import {
  macroResearchExtract,
  macroResearchExtractionStatus,
  queryMacroResearchContent,
  selectMacroResearchDetailUrlForTest,
} from '../../src/agent/tools/macro-research-extraction'
import {
  macroResearchProvenance,
  macroResearchSources,
  macroNumericSeriesCatalog,
  queryMacroAttribution,
  queryMacroFactors,
  queryMacroNumericSeries,
  queryMacroResearchEvidence,
} from '../../src/agent/tools/data-store-tool-query-macro'
import { MACRO_RESEARCH_SOURCES } from '../../src/agent/tools/macro-research-source-catalog'

describe('macro factor radar persistence', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-macro-factor-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('seeds and reads market_moving_factor_v1 rows with provenance fields', () => {
    const result = readMacroFactorRadar(store)
    expect(result.rows.length).toBeGreaterThanOrEqual(2)
    expect(result.sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      'msci',
      'pboc',
      'world_bank',
    ]))

    const msci = result.rows.find((row) => row.factor_id === 'manual:index_classification:msci:indonesia-watch')
    expect(msci).toMatchObject({
      family: 'index_classification',
      source_name: 'MSCI',
      source_type: 'manual_seed',
      status: 'watch',
    })
    expect(msci?.affected_assets).toContain('Indonesia equities')
    expect(msci?.transmission_channels).toContain('passive benchmark flow')
    expect(msci).toMatchObject({
      access_status: 'public',
      freshness_status: 'acceptable',
      confidence_effect: 'mixed',
      next_evidence_action: 'use cache/readback',
      asset_impact: 'mixed',
    })
    expect(msci?.retrieval_test).toMatchObject({
      interface_id: 'macro.factor_radar',
      candidate_schema: 'market_moving_factor_v1',
      status: 'fallback-only',
    })
  })

  it('promotes SourceReader macro evidence artifacts into macro research rows', () => {
    const evidenceDir = join(basePath, 'memory', 'macro_evidence')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'macro_eia.json'), JSON.stringify({
      contract: 'macro-evidence-record-v1',
      id: 'macro:eia-oil',
      source: 'EIA',
      provider: 'eia',
      title: 'EIA official series WCESTUS1',
      sourceDate: '2026-07-03',
      topic: 'oil inventory pressure',
      region: 'US/global',
      assetClass: 'commodity/equity/fund',
      keyClaims: ['US commercial crude oil inventories WCESTUS1 = 420000 MBBL as of 2026-07-03.'],
      affectedAssets: ['oil', 'energy equities', 'A-shares'],
      confidenceEffect: 'Adds official inventory context.',
      freshness: 'ok',
      evidenceClass: 'official-numeric-series',
      numericSeries: {
        seriesId: 'WCESTUS1',
        metricName: 'US commercial crude oil inventories',
        value: 420000,
        unit: 'MBBL',
        sourceDataTime: '2026-07-03',
        fetchedAt: '2026-07-12T02:00:00Z',
        provider: 'eia',
        status: 'ok',
      },
      fetchedAt: '2026-07-12T02:00:00Z',
      tradeBoundary: 'Macro numeric evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
      missingEvidence: ['No second official source attached.'],
    }, null, 2))

    const result = readMacroFactorRadar(store, basePath)
    const row = result.rows.find((item) => item.factor_id === 'source_reader:macro-eia-oil')
    expect(row).toMatchObject({
      family: 'official-numeric-series',
      title: 'EIA official series WCESTUS1',
      source_name: 'EIA',
      source_type: 'official-numeric-series',
      evidence_tier: 'official-numeric-series',
      source_published_at: '2026-07-03',
      fetched_at: '2026-07-12T02:00:00Z',
      status: 'active',
      asset_impact: 'linked',
    })
    expect(row?.affected_assets).toEqual(['oil', 'energy equities', 'A-shares'])
    expect(row?.linked_macro_evidence_ids).toEqual(['macro:eia-oil'])
    expect(row?.macro_values).toMatchObject({
      artifactPath: join(evidenceDir, 'macro_eia.json'),
      numericSeries: {
        seriesId: 'WCESTUS1',
        value: 420000,
      },
    })
    expect(result.sources.find((source) => source.id === 'source_reader.macro_evidence')).toMatchObject({
      state: 'ok',
    })
  })

  it('promotes cached finance news as unclassified narrative observations', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const text = String(url)
      if (text.includes('api.bls.gov/publicAPI/v2/timeseries/data')) {
        return new Response(JSON.stringify({
          Results: {
            series: [{
              data: [{ year: '2026', period: 'M06', periodName: 'June', value: '321.0' }],
            }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (text.includes('api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD')) {
        return new Response(JSON.stringify([
          { lastupdated: '2026-07-01' },
          [{ date: '2025', value: 30769700000000 }],
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (text.includes('imf.org/external/datamapper/api/v1/NGDP_RPCH/USA')) {
        return new Response(JSON.stringify({
          values: { NGDP_RPCH: { USA: { '2030': 1.7, '2031': 1.8 } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (text.includes('sdmx.oecd.org/public/rest/v1/data/OECD.SDD.NAD')) {
        return new Response(JSON.stringify({
          dataSets: [{
            series: {
              '0:0:0:0:0:0:0:0:0': {
                observations: { '0': [1.2] },
              },
            },
          }],
          structures: [{
            dimensions: {
              series: [
                { id: 'FREQ', values: [{ id: 'Q' }] },
                { id: 'ADJUSTMENT', values: [{ id: 'Y' }] },
                { id: 'REF_AREA', values: [{ id: 'OECD' }] },
                { id: 'SECTOR', values: [{ id: 'S1' }] },
                { id: 'COUNTERPART_SECTOR', values: [{ id: 'S1' }] },
                { id: 'TRANSACTION', values: [{ id: 'B1GQ' }] },
                { id: 'UNIT_MEASURE', values: [{ id: 'PC' }] },
                { id: 'TRANSFORMATION', values: [{ id: 'GCM' }] },
                { id: 'TABLE_IDENTIFIER', values: [{ id: 'T0102' }] },
              ],
              observation: [
                { id: 'TIME_PERIOD', values: [{ id: '2026-Q1' }] },
              ],
            },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'unexpected test URL' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    store.saveFinanceNews([
      {
        news_id: 'macro-copper-news',
        title: 'Copper supply report lifts miner attention',
        summary: 'Copper and commodity prices are reacting to a supply-demand research update.',
        source: 'test-news',
        published_at: new Date(Date.now() - 86_400_000).toISOString(),
        url: 'https://example.test/copper',
      },
    ])

    let result
    try {
      result = await refreshMacroFactorRadar(store, { apiKeys: {} } as any)
    } finally {
      vi.unstubAllGlobals()
    }
    const row = result.rows.find((item) => item.factor_id?.toString().startsWith('news:cached:'))
    expect(row).toMatchObject({
      family: 'narrative_attention',
      source_type: 'cached_finance_news',
      evidence_tier: 'linked_news_evidence',
      source_name: 'test-news',
      status: 'watch',
    })
    expect(row?.limitations).toContain('Finance news is a current-event clue, not an official macro fact.')
    expect(row).toMatchObject({
      access_status: 'public',
      freshness_status: 'fresh',
      confidence_effect: 'neutral',
      next_evidence_action: 'use cache/readback',
      asset_impact: 'no direct relevance',
      affected_assets: [],
      confidence: 'unassessed',
    })
    expect(row?.macro_values).toMatchObject({
      evidenceTier: 'linked_news_evidence',
      limitation: 'news_clue_not_official_fact',
    })
    expect(row?.affected_assets).toEqual([])
    expect(row?.retrieval_test).toMatchObject({
      provider: 'finance_news',
      interface_id: 'macro.factor_radar',
      status: 'ok',
    })
    const attribution = JSON.parse(queryMacroAttribution(store, { target: 'Copper', limit: 5 }))
    const newsAttribution = attribution.attributions.find((item: any) =>
      item.evidence?.some((evidence: any) => evidence.sourceType === 'cached_finance_news'))
    expect(newsAttribution?.evidence[0]).toMatchObject({
      evidenceTier: 'linked_news_evidence',
      limitations: expect.arrayContaining([
        'Finance news is a current-event clue, not an official macro fact.',
      ]),
    })

    const worldBank = result.rows.find((item) => `${item.factor_id}`.startsWith('world_bank:macro_series:NY.GDP.MKTP.CD:'))
    expect(worldBank).toMatchObject({
      family: 'macro_series',
      source_name: 'World Bank',
      source_type: 'official_api',
      status: 'active',
    })
    const imf = result.rows.find((item) => `${item.factor_id}`.startsWith('imf:macro_series:NGDP_RPCH:USA:'))
    expect(imf).toMatchObject({
      family: 'macro_series',
      source_name: 'IMF',
      source_type: 'official_api',
      status: 'active',
    })
    const oecd = result.rows.find((item) => `${item.factor_id}`.startsWith('oecd:macro_series:DF_QNA_EXPENDITURE_GROWTH_OECD:OECD:'))
    expect(oecd).toMatchObject({
      family: 'macro_series',
      source_name: 'OECD',
      source_type: 'official_api',
      status: 'active',
    })
    const eia = result.rows.find((item) => `${item.factor_id}` === 'eia:macro_series:WCESTUS1:credential')
    expect(eia).toMatchObject({
      family: 'macro_series',
      source_name: 'EIA',
      status: 'unsupported',
      failure_class: 'credential_missing',
      access_status: 'credential-gated',
      freshness_status: 'acceptable',
      confidence_effect: 'insufficient evidence',
    })
    const nbs = result.rows.find((item) => `${item.factor_id}` === 'nbs_china:macro_series:easyquery:security_control')
    expect(nbs).toMatchObject({
      family: 'macro_series',
      source_name: 'NBS China',
      status: 'unsupported',
      failure_class: 'security_control',
      access_status: 'security-blocked',
      freshness_status: 'blocked',
      next_evidence_action: 'do not retry automatically; inspect source boundary',
    })

    const nbsReadback = JSON.parse(queryMacroNumericSeries(store, { provider: 'nbs_china', limit: 5 }))
    expect(nbsReadback).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
    })
    expect(nbsReadback.series[0]).toMatchObject({
      seriesId: 'NBS_EASYQUERY_PENDING',
      provider: 'nbs china',
      failureClass: 'security_control',
      value: null,
    })
    const oecdReadback = JSON.parse(queryMacroNumericSeries(store, { provider: 'oecd', limit: 5 }))
    expect(oecdReadback).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
    })
    expect(oecdReadback.series[0]).toMatchObject({
      seriesId: 'DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM',
      provider: 'oecd',
      sourceName: 'OECD',
      value: expect.any(Number),
    })
  }, 15000)

  it('queries relevant macro factors with explicit missing evidence', () => {
    readMacroFactorRadar(store)

    const copper = JSON.parse(queryMacroFactors(store, { target: 'Copper', limit: 5 }))
    expect(copper).toMatchObject({
      action: 'query_macro_factors',
      status: 'ok',
      provenance: {
        canonicalSchema: 'market_moving_factor_v1',
        canonicalTable: 'market_moving_factor',
        readbackAction: 'query_macro_factors',
      },
    })
    expect(copper.rows.some((row: any) => `${row.title}`.includes('Copper'))).toBe(true)

    const missing = JSON.parse(queryMacroFactors(store, { target: 'Nonexistent factor target', limit: 5 }))
    expect(missing).toMatchObject({
      action: 'query_macro_factors',
      count: 0,
      status: 'missing',
    })
    expect(missing.missingReason).toContain('macro-evidence gap')
  })

  it('builds structured macro attribution rows from governed evidence', () => {
    readMacroFactorRadar(store)

    const attribution = JSON.parse(queryMacroAttribution(store, { target: 'Copper', limit: 5 }))
    expect(attribution).toMatchObject({
      action: 'query_macro_attribution',
      status: 'ok',
      provenance: {
        canonicalSchema: 'macro_attribution_v1',
        evidenceSchema: 'market_moving_factor_v1',
      },
    })
    expect(attribution.attributions.length).toBeGreaterThan(0)
    expect(attribution.attributions[0]).toMatchObject({
      category: expect.any(String),
      confidence: expect.any(String),
      invalidationCondition: expect.any(String),
      nextUpdateAction: expect.any(String),
    })
    expect(attribution.attributions[0].evidence[0]).toMatchObject({
      sourceName: expect.any(String),
      fetchedAt: expect.any(String),
    })

    const missing = JSON.parse(queryMacroAttribution(store, { target: 'No such macro target', limit: 5 }))
    expect(missing).toMatchObject({
      action: 'query_macro_attribution',
      status: 'missing',
      updateDecision: {
        requiresUpdate: true,
      },
    })
    expect(missing.attributions[0]).toMatchObject({
      category: 'data-quality',
      confidence: 'unknown',
    })
  })

  it('queries official numeric macro series separately from research evidence', () => {
    const fetchedAt = '2026-07-08T00:00:00.000Z'
    store.saveMarketMovingFactors([
      {
        factor_id: 'fred:rates_liquidity:DGS10:2026-07-07',
        family: 'rates_liquidity',
        title: 'US 10Y Treasury yield',
        summary: 'Official numeric rates evidence.',
        source_name: 'FRED',
        source_url: 'https://fred.stlouisfed.org/series/DGS10',
        source_type: 'official_api',
        source_published_at: '2026-07-07',
        fetched_at: fetchedAt,
        event_at: '2026-07-07',
        affected_assets: ['Treasury yields'],
        affected_regions: ['United States'],
        affected_sectors: [],
        transmission_channels: ['discount rate'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: 'DGS10 2026-07-07 = 4.1', retrieved_at: fetchedAt }],
        macro_values: { actual: 4.1, unit: 'percent', period: '2026-07-07' },
        retrieval_test: {
          provider: 'fred',
          interface_id: 'macro.factor_radar',
          capability_id: 'fred.series.observations',
          status: 'ok',
        },
      },
      {
        factor_id: 'macro:macro_research_document:goldman_sachs',
        family: 'macro_research_document',
        title: 'Research narrative row',
        summary: 'Narrative row must not be returned as numeric series.',
        source_name: 'Goldman Sachs',
        source_type: 'research_narrative',
        fetched_at: fetchedAt,
        status: 'usable',
        macro_values: { keyClaims: ['macro view'] },
      },
      {
        factor_id: 'world_bank:macro_series:NY.GDP.MKTP.CD:2025',
        family: 'macro_series',
        title: 'US GDP current US$ World Bank observation',
        summary: 'Official numeric growth evidence.',
        source_name: 'World Bank',
        source_url: 'https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD',
        source_type: 'official_api',
        source_published_at: '2026-07-01',
        fetched_at: fetchedAt,
        event_at: '2025',
        affected_assets: ['US equities'],
        affected_regions: ['United States'],
        affected_sectors: [],
        transmission_channels: ['growth level'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: 'NY.GDP.MKTP.CD 2025 = 30769700000000', retrieved_at: fetchedAt }],
        macro_values: { actual: 30769700000000, unit: 'current US$', period: '2025', frequency: 'annual' },
        retrieval_test: {
          provider: 'world_bank',
          interface_id: 'macro.factor_radar',
          capability_id: 'world_bank.indicator.NY.GDP.MKTP.CD',
          status: 'ok',
        },
      },
      {
        factor_id: 'imf:macro_series:NGDP_RPCH:USA:2031',
        family: 'macro_series',
        title: 'US real GDP growth IMF DataMapper observation',
        summary: 'Official numeric growth evidence.',
        source_name: 'IMF',
        source_url: 'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/USA',
        source_type: 'official_api',
        source_published_at: '2031',
        fetched_at: fetchedAt,
        event_at: '2031',
        affected_assets: ['US equities'],
        affected_regions: ['United States'],
        affected_sectors: [],
        transmission_channels: ['growth momentum'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: 'NGDP_RPCH USA 2031 = 1.8', retrieved_at: fetchedAt }],
        macro_values: { actual: 1.8, unit: 'percent change', period: '2031', frequency: 'annual' },
        retrieval_test: {
          provider: 'imf',
          interface_id: 'macro.factor_radar',
          capability_id: 'imf.datamapper.NGDP_RPCH.USA',
          status: 'ok',
        },
      },
      {
        factor_id: 'eia:macro_series:WCESTUS1:2026-07-03',
        family: 'macro_series',
        title: 'US commercial crude oil inventories EIA observation',
        summary: 'Official numeric energy inventory evidence.',
        source_name: 'EIA',
        source_url: 'https://api.eia.gov/v2/petroleum/stoc/wstk/data/',
        source_type: 'official_api',
        source_published_at: '2026-07-03',
        fetched_at: fetchedAt,
        event_at: '2026-07-03',
        affected_assets: ['oil'],
        affected_regions: ['United States'],
        affected_sectors: ['Energy'],
        transmission_channels: ['energy inventory'],
        expected_direction: 'mixed',
        severity: 'medium',
        confidence: 'high',
        status: 'active',
        evidence_items: [{ label: 'WCESTUS1 2026-07-03 = 420000', retrieved_at: fetchedAt }],
        macro_values: { actual: 420000, unit: 'thousand barrels', period: '2026-07-03', frequency: 'weekly' },
        retrieval_test: {
          provider: 'eia',
          interface_id: 'macro.factor_radar',
          capability_id: 'eia.petroleum.stoc.wstk.WCESTUS1',
          status: 'ok',
        },
      },
    ])

    const result = JSON.parse(queryMacroNumericSeries(store, { provider: 'fred', limit: 5 }))
    expect(result).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
      provenance: {
        interfaceId: 'macro.official_series',
        readbackAction: 'query_macro_numeric_series',
        canonicalTable: 'market_moving_factor',
      },
    })
    expect(result.series[0]).toMatchObject({
      seriesId: 'DGS10',
      metricName: 'US 10Y Treasury yield',
      provider: 'fred',
      value: 4.1,
      unit: 'percent',
      sourceDataTime: '2026-07-07',
      fetchedAt,
    })

    const worldBank = JSON.parse(queryMacroNumericSeries(store, { provider: 'world_bank', limit: 5 }))
    expect(worldBank).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
    })
    expect(worldBank.series[0]).toMatchObject({
      seriesId: 'NY.GDP.MKTP.CD',
      provider: 'world_bank',
      value: 30769700000000,
      unit: 'current US$',
      sourceDataTime: '2025',
    })

    const imf = JSON.parse(queryMacroNumericSeries(store, { provider: 'imf', limit: 5 }))
    expect(imf).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
    })
    expect(imf.series[0]).toMatchObject({
      seriesId: 'NGDP_RPCH',
      provider: 'imf',
      value: 1.8,
      unit: 'percent change',
      sourceDataTime: '2031',
    })

    const eia = JSON.parse(queryMacroNumericSeries(store, { provider: 'eia', limit: 5 }))
    expect(eia).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'ok',
      count: 1,
    })
    expect(eia.series[0]).toMatchObject({
      seriesId: 'WCESTUS1',
      provider: 'eia',
      value: 420000,
      unit: 'thousand barrels',
      sourceDataTime: '2026-07-03',
    })
  })

  it('refreshes configured EIA into governed numeric readback rows', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const text = String(url)
      if (text.includes('api.eia.gov/v2/petroleum/stoc/wstk/data')) {
        return new Response(JSON.stringify({
          response: {
            data: [{
              period: '2026-07-03',
              series: 'WCESTUS1',
              value: '420000',
              units: 'MBBL',
              'series-description': 'Weekly U.S. Ending Stocks of Crude Oil',
            }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'provider not needed for this test' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    })
    try {
      const refreshed = await refreshMacroFactorRadar(store, {
        apiKeys: { EIA_API_KEY: 'test-eia-key' },
      } as any)
      const eiaRow = refreshed.rows.find((row) => row.factor_id === 'eia:macro_series:WCESTUS1:2026-07-03')
      expect(eiaRow).toMatchObject({
        family: 'macro_series',
        source_name: 'EIA',
        source_type: 'official_api',
        status: 'active',
        access_status: 'public',
        freshness_status: 'acceptable',
        confidence_effect: 'mixed',
        macro_values: {
          actual: 420000,
          unit: 'MBBL',
          period: '2026-07-03',
          frequency: 'weekly',
        },
        retrieval_test: {
          provider: 'eia',
          status: 'ok',
        },
      })

      const readback = JSON.parse(queryMacroNumericSeries(store, { provider: 'eia', seriesId: 'WCESTUS1', limit: 5 }))
      expect(readback).toMatchObject({
        action: 'query_macro_numeric_series',
        status: 'ok',
        count: 1,
        provenance: {
          canonicalTable: 'market_moving_factor',
          readbackAction: 'query_macro_numeric_series',
        },
      })
      expect(readback.series[0]).toMatchObject({
        provider: 'eia',
        seriesId: 'WCESTUS1',
        value: 420000,
        unit: 'MBBL',
        sourceDataTime: '2026-07-03',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('exposes source-specific macro research catalog access behavior', () => {
    const all = JSON.parse(macroResearchSources({ limit: 80 }))
    expect(all).toMatchObject({
      action: 'macro_research_sources',
      status: 'ok',
      provenance: {
        interfaceId: 'macro.research_source_catalog',
        canonicalSchema: 'macro_research_source_catalog_v1',
        readbackAction: 'macro_research_sources',
      },
    })

    const byId = new Map(all.rows.map((row: any) => [row.id, row]))
    expect(byId.get('oecd')).toMatchObject({
      accessClass: 'browser-public',
      testedStatus: 'browser-ua-http-readable',
      automationPolicy: 'browser-compatible-public-page',
    })
    expect(byId.get('lme')).toMatchObject({
      accessClass: 'browser-public',
      testedStatus: 'playwright-browser-ua-readable',
    })
    expect(byId.get('iea')).toMatchObject({
      accessClass: 'anti-bot-manual-browser',
      testedStatus: 'cloudflare-verification',
      automationPolicy: 'do-not-repeat-automated-fetch-after-challenge',
    })
    expect(byId.get('opec')).toMatchObject({
      accessClass: 'anti-bot-manual-browser',
      testedStatus: 'cloudflare-verification',
    })
    expect(byId.get('sp_dji')).toMatchObject({
      testedStatus: 'security-blocked-in-automation',
      automationPolicy: 'manual-or-official-delivery-only',
    })
    expect(byId.get('fidelity')).toMatchObject({
      accessClass: 'security-blocked-or-manual-browser',
    })
    expect(byId.get('pboc')).toMatchObject({
      evidenceValue: 'official_policy_event',
    })
    expect(byId.get('pboc_policy_reports')).toMatchObject({
      testedStatus: 'official-subpage-html-ok',
    })
    expect(byId.get('pboc_policy_reports')?.categories).toContain('policy_report')
    expect(byId.get('pboc_news_releases')?.categories).toContain('open_market_operations')
    expect(byId.get('nbs_china')).toMatchObject({
      evidenceValue: 'official_macro_fact',
    })
    expect(byId.get('nbs_data_releases')).toMatchObject({
      testedStatus: 'official-list-detail-html-ok',
      accessClass: 'official-public-source',
    })
    expect(byId.get('nbs_data_releases')?.categories).toContain('data_release')
    expect(byId.get('nbs_data_releases')?.retrievalMethods).toContain('list_to_detail_html')
    expect(byId.get('csrc_policy_notices')?.categories).toContain('capital_market_policy')
    expect(byId.get('safe_china')?.categories).toContain('capital_flow')
    expect(byId.get('safe_statistics')?.categories).toContain('cross_border_finance')
    expect(byId.get('china_exchanges')?.categories).toContain('market_structure_event')
    expect(byId.get('china_exchange_notices')?.entryUrls).toContain('https://www.sse.com.cn/disclosure/announcement/general/')
    expect(byId.get('hkex_news_releases')).toMatchObject({
      accessClass: 'manual-browser-or-webview',
      testedStatus: 'akamai-503-to-simple-http',
      automationPolicy: 'browser-or-manual-evidence-only',
    })
    expect(byId.get('hkex_news_releases')?.retrievalMethods).toContain('webview')
    expect(byId.get('szse_notice_api')).toMatchObject({
      accessClass: 'official-api-and-public-report',
      testedStatus: 'official-api-payload-ok',
      evidenceValue: 'official_policy_event',
    })
    expect(byId.get('szse_notice_api')?.retrievalMethods).toContain('official_api')
    expect(byId.get('szse_notice_api')?.categories).toContain('api_payload')
    expect(byId.get('imf')?.categories).toContain('country_risk')
    expect(byId.get('world_bank')).toMatchObject({
      accessClass: 'official-api',
    })
    expect(byId.get('vanguard')).toMatchObject({
      evidenceValue: 'allocation_regime',
    })
    expect(byId.get('state_street')?.categories).toContain('etf_flow_context')

    const cme = JSON.parse(macroResearchSources({ provider: 'cme' }))
    expect(cme.rows[0]).toMatchObject({
      accessClass: 'manual-browser-or-official-data-delivery',
      automationPolicy: 'do-not-scrape',
      testedStatus: 'automation-explicitly-blocked',
    })

    const ubs = JSON.parse(macroResearchSources({ provider: 'ubs' }))
    expect(ubs.rows[0]).toMatchObject({
      accessClass: 'browser-public',
      testedStatus: 'playwright-browser-ua-readable',
      automationPolicy: 'browser-compatible-public-page',
    })

    const msci = JSON.parse(macroResearchSources({ category: 'market_classification' }))
    expect(msci.rows.some((row: any) => row.provider === 'msci')).toBe(true)
    expect(msci.rows.every((row: any) => row.categories.includes('market_classification'))).toBe(true)

    const commodity = JSON.parse(macroResearchSources({ category: 'commodity_research', priority: 1 }))
    expect(commodity).toMatchObject({
      action: 'macro_research_sources',
      status: 'ok',
    })
    expect(commodity.rows.some((row: any) => row.provider === 'goldman_sachs')).toBe(true)
    expect(commodity.rows.some((row: any) => row.provider === 'eia')).toBe(true)

    const chinaPolicy = JSON.parse(macroResearchSources({ category: 'official_policy_event', priority: 1 }))
    expect(chinaPolicy.rows.some((row: any) => row.provider === 'pboc_policy_reports')).toBe(true)
    expect(chinaPolicy.rows.some((row: any) => row.provider === 'csrc_policy_notices')).toBe(true)
    expect(chinaPolicy.rows.some((row: any) => row.provider === 'china_exchange_notices')).toBe(true)
  })

  it('exposes official numeric macro series catalog availability', () => {
    const all = JSON.parse(macroNumericSeriesCatalog({ limit: 20 }))
    expect(all).toMatchObject({
      action: 'macro_numeric_series_catalog',
      status: 'ok',
      provenance: {
        interfaceId: 'macro.official_series',
        canonicalTable: 'market_moving_factor',
        readbackAction: 'query_macro_numeric_series',
      },
    })
    expect(all.count).toBeGreaterThanOrEqual(8)
    expect(all.rows.map((row: any) => row.seriesId)).toEqual(expect.arrayContaining([
      'DGS10',
      'CUUR0000SA0',
      'NIPA:T10101',
      'NY.GDP.MKTP.CD',
      'NGDP_RPCH',
      'DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM',
      'WCESTUS1',
      'NBS_EASYQUERY_PENDING',
    ]))

    const bea = JSON.parse(macroNumericSeriesCatalog({ provider: 'bea' }))
    expect(bea.count).toBe(1)
    expect(bea.rows[0]).toMatchObject({
      credentialKey: 'BEA_API_KEY',
      status: 'credential-gated',
    })

    const securityControlled = JSON.parse(macroNumericSeriesCatalog({ status: 'security-control' }))
    expect(securityControlled.count).toBe(1)
    expect(securityControlled.rows[0]).toMatchObject({
      provider: 'nbs_china',
      seriesId: 'NBS_EASYQUERY_PENDING',
    })

    const oecd = JSON.parse(macroNumericSeriesCatalog({ provider: 'oecd' }))
    expect(oecd.count).toBe(1)
    expect(oecd.rows[0]).toMatchObject({
      seriesId: 'DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM',
      status: 'supported',
    })
  })

  it('classifies missing official numeric readback by provider status', () => {
    const eia = JSON.parse(queryMacroNumericSeries(store, { provider: 'eia', seriesId: 'WCESTUS1' }))
    expect(eia).toMatchObject({
      action: 'query_macro_numeric_series',
      status: 'missing',
      count: 0,
      failureClass: 'credential-or-quota-required',
      provenance: {
        cacheStatus: 'local-miss',
      },
    })
    expect(eia.missingEvidence[0]).toMatchObject({
      provider: 'eia',
      seriesId: 'WCESTUS1',
      credentialKey: 'EIA_API_KEY',
    })

    const nbs = JSON.parse(queryMacroNumericSeries(store, { provider: 'nbs_china' }))
    expect(nbs.failureClass).toBe('source-access-controlled')

    const oecd = JSON.parse(queryMacroNumericSeries(store, { provider: 'oecd' }))
    expect(oecd.failureClass).toBe('missing-local-readback')
  })

  it('normalizes macro research source provenance into reusable readback rows', () => {
    const generated = JSON.parse(macroResearchProvenance(store, { limit: 80 }))
    expect(generated).toMatchObject({
      action: 'macro_research_provenance',
      status: 'ok',
      persisted: true,
      provenance: {
        interfaceId: 'macro.research_provenance',
        canonicalSchema: 'market_moving_factor_v1',
        canonicalTable: 'market_moving_factor',
      },
    })
    expect(generated.generatedRows).toBeGreaterThan(10)
    expect(generated.providerMatrix.length).toBeGreaterThanOrEqual(15)

    const readback = JSON.parse(queryMacroResearchEvidence(store, { limit: 120 }))
    expect(readback).toMatchObject({
      action: 'query_macro_research_evidence',
      status: 'ok',
      provenance: {
        readbackAction: 'query_macro_research_evidence',
        canonicalTable: 'market_moving_factor',
      },
    })

    const families = new Set(readback.rows.map((row: any) => row.family))
    expect(families.has('macro_research_document')).toBe(true)
    expect(families.has('macro_index_event')).toBe(true)
    expect(families.has('macro_policy_event')).toBe(true)
    expect(families.has('macro_official_series')).toBe(true)
    expect(families.has('macro_commodity_event')).toBe(true)
    expect(families.has('macro_source_retrieval_evidence')).toBe(true)

    const cme = readback.rows.find((row: any) => row.factor_id === 'macro:source_retrieval:cme')
    expect(cme).toMatchObject({
      family: 'macro_source_retrieval_evidence',
      status: 'blocked',
      failure_class: 'manual-browser-or-official-data-delivery',
    })
    expect(cme.retrieval_test).toMatchObject({
      automationPolicy: 'do-not-scrape',
      readback_action: 'query_macro_research_evidence',
    })
    expect(readback.rows.some((row: any) => row.factor_id === 'macro:macro_commodity_event:cme')).toBe(false)

    const msci = readback.rows.find((row: any) => row.factor_id === 'macro:macro_index_event:msci')
    expect(msci).toMatchObject({
      family: 'macro_index_event',
      source_name: 'MSCI',
      status: 'usable',
    })
    expect(msci.macro_values.extractableFields).toContain('effectiveDate')

    const commodity = JSON.parse(macroResearchProvenance(store, { family: 'commodity_research' }))
    expect(commodity).toMatchObject({
      action: 'macro_research_provenance',
      status: 'ok',
      persisted: true,
    })
    expect(commodity.generatedRows).toBeGreaterThan(0)
    expect(commodity.rows.some((row: any) => row.family === 'macro_commodity_event')).toBe(true)

    const commodityReadback = JSON.parse(queryMacroResearchEvidence(store, {
      family: 'commodity_research',
      limit: 20,
    }))
    expect(commodityReadback).toMatchObject({
      action: 'query_macro_research_evidence',
      status: 'ok',
    })
    expect(commodityReadback.rows.some((row: any) => row.source_name === 'EIA')).toBe(true)

    const factorAlias = JSON.parse(queryMacroFactors(store, {
      target: 'Copper',
      family: 'commodity_research',
      limit: 10,
    }))
    expect(factorAlias).toMatchObject({
      action: 'query_macro_factors',
      status: 'ok',
    })
  })

  it('extracts public research article content into hashed readback evidence', async () => {
    const html = `
      <html>
        <head><title>Why record-high copper prices are not forecast to last</title></head>
        <body>
          <nav>Global navigation should be removed</nav>
          <article>
            <h1>Why record-high copper prices are not forecast to last</h1>
            <time>June 18, 2026</time>
            <p>Goldman Sachs Research says copper markets face a near-term price shock as inventories tighten and miners react to supply limits.</p>
            <p>The report argues that copper demand, energy transition spending, and China construction activity can change commodity expectations for several months.</p>
            <p>Rates, inflation, and global growth still affect whether investors treat the copper move as a durable macro signal or as a temporary inventory event.</p>
          </article>
        </body>
      </html>`

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'goldman_sachs',
      content: html,
      contentType: 'html',
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
      persisted: true,
    })
    expect(extracted.rows[0].macro_values.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(extracted.rows[0].macro_values.artifactPath).toContain('macro_research_content')
    expect(extracted.rows[0].macro_values.keyClaims.length).toBeGreaterThanOrEqual(2)
    expect(extracted.rows[0].macro_values.bodyPreview).toContain('copper markets')

    const readback = JSON.parse(queryMacroResearchContent(store, { provider: 'Goldman Sachs', target: 'copper' }))
    expect(readback).toMatchObject({
      action: 'query_macro_research_content',
      status: 'ok',
      count: 1,
    })
    expect(readback.readbackContract.normalUse).toContain('contentEvidence')
    expect(readback.contentEvidence[0]).toMatchObject({
      title: 'Why record-high copper prices are not forecast to last',
      sourceName: 'Goldman Sachs',
      sourceDataTime: '2026-06-18',
      contentHash: extracted.rows[0].macro_values.contentHash,
    })
    expect(readback.contentEvidence[0].bodyPreview).toContain('copper markets')
    expect(readback.contentEvidence[0].keyClaims.some((claim: any) =>
      String(claim.claim ?? '').includes('copper markets')
    )).toBe(true)
    expect(readback.rows[0].source_published_at).toBe('2026-06-18')
    expect(readback.rows[0].macro_values.keyClaims[0].contentHash).toBe(extracted.rows[0].macro_values.contentHash)

    const readbackByProviderId = JSON.parse(queryMacroResearchContent(store, { provider: 'goldman_sachs', target: 'copper' }))
    expect(readbackByProviderId).toMatchObject({
      action: 'query_macro_research_content',
      status: 'ok',
      count: 1,
    })
  })

  it('extracts official list pages through one bounded same-origin detail page', async () => {
    const listUrl = 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/index.html'
    const detailUrl = 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/202607/t20260708_600001.html'
    const responses = new Map([
      [listUrl, `
        <html><body>
          <a href="/english/">English</a>
          <a href="./202607/t20260708_600001.html">2026年7月货币政策执行报告发布</a>
        </body></html>
      `],
      [detailUrl, `
        <html><head><title>2026年7月货币政策执行报告发布</title></head>
        <body><article>
          <h1>2026年7月货币政策执行报告发布</h1>
          <time>2026-07-08</time>
          <p>中国人民银行发布货币政策执行报告，指出稳健的货币政策将保持流动性合理充裕，并关注利率、汇率和信贷结构对债券、A股和实体经济的传导。</p>
          <p>报告强调政策协调、资本流动和金融市场预期管理，相关变化应作为市场分析中的宏观假设、风险边界和失效条件，而不是直接买卖信号。</p>
          <p>后续分析应持续跟踪公开市场操作、贷款市场报价利率、银行间流动性和外汇市场稳定情况。</p>
        </article></body></html>
      `],
    ])
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const text = responses.get(String(url))
      return new Response(text ?? '', {
        status: text ? 200 : 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    })

    try {
      const extracted = JSON.parse(await macroResearchExtract(store, {
        provider: 'pboc_policy_reports',
      }, basePath))

      expect(extracted).toMatchObject({
        action: 'macro_research_extract',
        status: 'ok',
        extracted: 1,
        failed: 0,
      })
      expect(extracted.rows[0].source_url).toBe(detailUrl)
      expect(extracted.rows[0].macro_values.listSourceUrl).toBe(listUrl)
      expect(extracted.rows[0].retrieval_test.listSourceUrl).toBe(listUrl)
      expect(extracted.rows[0].macro_values.bodyPreview).toContain('流动性合理充裕')

      const readback = JSON.parse(queryMacroResearchContent(store, {
        provider: 'pboc_policy_reports',
        target: '流动性',
      }))
      expect(readback).toMatchObject({
        action: 'query_macro_research_content',
        status: 'ok',
        count: 1,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('extracts China official detail metadata without navigation noise', async () => {
    const detailUrl = 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/202607/t20260708_600001.html'
    const detailHtml = `
      <html>
        <head>
          <title>站点导航 - 中国人民银行</title>
          <meta name="ArticleTitle" content="中国人民银行开展公开市场逆回购操作">
          <meta name="PubDate" content="2026年7月8日">
        </head>
        <body>
          <nav>首页 机构设置 政策法规 统计数据 English</nav>
          <div class="TRS_Editor">
            <p>中国人民银行公告称，为保持银行体系流动性合理充裕，开展公开市场逆回购操作，并继续关注利率、汇率和信贷结构对金融市场的传导。</p>
            <p>本次操作属于官方政策和流动性事件，应作为A股、债券和银行间资金面的宏观假设、观察因素和失效条件，而不是直接买卖信号。</p>
            <p>后续市场分析需要跟踪公开市场操作规模、利率变化、资金价格和外汇市场预期。</p>
          </div>
          <footer>版权所有 联系我们 网站地图</footer>
        </body>
      </html>
    `

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'pboc_policy_reports',
      url: detailUrl,
      content: detailHtml,
      contentType: 'html',
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.source_url).toBe(detailUrl)
    expect(row.source_published_at).toBe('2026-07-08')
    expect(row.macro_values.title).toBe('中国人民银行开展公开市场逆回购操作')
    expect(row.macro_values.bodyPreview).toContain('流动性合理充裕')
    expect(row.macro_values.bodyPreview).not.toContain('首页 机构设置')
    expect(row.macro_values.keyClaims.some((claim: any) => `${claim.claim}`.includes('公开市场逆回购操作'))).toBe(true)
  })

  it('extracts CSRC-style official notice body and h2 title', async () => {
    const detailUrl = 'http://www.csrc.gov.cn/csrc/c100028/c20260708/content.shtml'
    const noticeHtml = `
      <html>
        <head><title>信息公开 - 中国证监会</title></head>
        <body>
          <div class="topnav">首页 机构概况 政府信息公开 政策法规</div>
          <div class="content">
            <h2>证监会发布资本市场制度型开放政策安排</h2>
            <div class="source">时间：2026-07-08 来源：证监会</div>
            <p>证监会表示，将完善资本市场基础制度，优化境内外投资者参与机制，并加强上市公司监管和信息披露质量。</p>
            <p>该政策可能影响A股风险偏好、外资配置、券商和交易所相关市场结构预期，应作为宏观政策和监管事件证据使用。</p>
            <p>后续应跟踪配套规则发布时间、交易所细则和市场主体反馈，不能把政策公告直接转化为买卖信号。</p>
          </div>
          <footer>版权所有 网站地图</footer>
        </body>
      </html>
    `

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'csrc_policy_notices',
      url: detailUrl,
      content: noticeHtml,
      contentType: 'html',
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.source_url).toBe(detailUrl)
    expect(row.family).toBe('macro_policy_event')
    expect(row.source_published_at).toBe('2026-07-08')
    expect(row.macro_values.title).toBe('证监会发布资本市场制度型开放政策安排')
    expect(row.macro_values.bodyPreview).toContain('资本市场基础制度')
    expect(row.macro_values.bodyPreview).not.toContain('首页 机构概况')
    expect(new Set(row.macro_values.keyClaims.map((claim: any) => claim.claimCategory))).toEqual(new Set(['official_policy_event']))
  })

  it('extracts SAFE-style statistics tables as official macro evidence', async () => {
    const detailUrl = 'https://www.safe.gov.cn/safe/2026/0708/25001.html'
    const tableHtml = `
      <html>
        <head><title>统计数据 - 国家外汇管理局门户网站</title></head>
        <body>
          <div class="channel">首页 数据统计 外汇储备 国际收支</div>
          <div class="article">
            <h1>2026年6月末外汇储备规模数据</h1>
            <p>发布时间：2026年7月8日 来源：国家外汇管理局</p>
            <table>
              <tr><th>项目</th><th>金额</th><th>说明</th></tr>
              <tr><td>外汇储备</td><td>32000亿美元</td><td>跨境资金流动总体稳定</td></tr>
              <tr><td>黄金储备</td><td>7300万盎司</td><td>储备结构保持连续披露</td></tr>
            </table>
            <p>外汇储备和跨境资金流动数据应作为汇率、外资流动和A股风险偏好的官方宏观事实证据。</p>
          </div>
        </body>
      </html>
    `

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'safe_statistics',
      url: detailUrl,
      content: tableHtml,
      contentType: 'html',
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.source_url).toBe(detailUrl)
    expect(row.family).toBe('macro_official_series')
    expect(row.source_published_at).toBe('2026-07-08')
    expect(row.macro_values.title).toBe('2026年6月末外汇储备规模数据')
    expect(row.macro_values.bodyPreview).toContain('外汇储备')
    expect(row.macro_values.bodyPreview).toContain('跨境资金流动')
    expect(row.macro_values.bodyPreview).not.toContain('首页 数据统计')
    expect(new Set(row.macro_values.keyClaims.map((claim: any) => claim.claimCategory))).toEqual(new Set(['official_macro_fact']))
  })

  it('selects and extracts NBS list-to-detail data release pages', async () => {
    const source = MACRO_RESEARCH_SOURCES.find((item) => item.provider === 'nbs_data_releases')
    expect(source).toBeTruthy()
    const listUrl = 'https://www.stats.gov.cn/sj/zxfb/'
    const listHtml = `
      <html><body>
        <a href="#">上一页</a>
        <a href="./202607/t20260703_1964057.html" target="_blank" title="2026年6月下旬流通领域重要生产资料市场价格变动情况">
          2026年6月下旬流通领域重要生产资料市场价格变动情况
        </a>
        <span>2026-07-04</span>
        <a href="./202606/t20260630_1964032.html" target="_blank" title="2026年6月中国采购经理指数运行情况">
          2026年6月中国采购经理指数运行情况
        </a>
        <span>2026-06-30</span>
      </body></html>
    `
    const selected = selectMacroResearchDetailUrlForTest({
      sourceUrl: listUrl,
      html: listHtml,
      source: source!,
    })
    expect(selected).toBe('https://www.stats.gov.cn/sj/zxfb/202607/t20260703_1964057.html')

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'nbs_data_releases',
      url: selected,
      contentType: 'html',
      content: `
        <html>
          <head>
            <title>2026年6月下旬流通领域重要生产资料市场价格变动情况 - 国家统计局</title>
            <meta name="ArticleTitle" content="2026年6月下旬流通领域重要生产资料市场价格变动情况">
            <meta name="PubDate" content="2026-07-04">
          </head>
          <body>
            <nav>首页 数据 数据发布</nav>
            <div class="article">
              <h1>2026年6月下旬流通领域重要生产资料市场价格变动情况</h1>
              <p>发布时间：2026-07-04 来源：国家统计局</p>
              <table>
                <tr><th>产品名称</th><th>本期价格</th><th>涨跌幅</th></tr>
                <tr><td>电解铜</td><td>85000元/吨</td><td>1.2%</td></tr>
              </table>
              <p>流通领域重要生产资料价格变化可作为商品、工业成本和通胀压力的官方宏观事实证据。</p>
            </div>
          </body>
        </html>
      `,
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.family).toBe('macro_official_series')
    expect(row.source_url).toBe(selected)
    expect(row.source_published_at).toBe('2026-07-04')
    expect(row.macro_values.title).toBe('2026年6月下旬流通领域重要生产资料市场价格变动情况')
    expect(row.macro_values.bodyPreview).toContain('电解铜')
    expect(row.macro_values.bodyPreview).not.toContain('首页 数据')
  })

  it('extracts exchange notice pages as official policy events', async () => {
    const detailUrl = 'https://www.sse.com.cn/disclosure/announcement/general/c20260708_600001.html'
    const noticeHtml = `
      <html>
        <head><title>上交所公告 | 上海证券交易所</title></head>
        <body>
          <header>首页 披露 公告 服务</header>
          <main class="detail">
            <h1>关于优化科创板做市和交易机制安排的通知</h1>
            <p>日期：2026-07-08 来源：上海证券交易所</p>
            <p>上海证券交易所发布通知，优化科创板做市、交易机制和信息披露监管安排，提升市场流动性和价格发现效率。</p>
            <p>该通知属于交易所官方政策和市场结构事件，应进入宏观政策事件证据，用于观察券商、科创板和A股风险偏好变化。</p>
          </main>
          <footer>版权所有 网站地图</footer>
        </body>
      </html>
    `

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'china_exchange_notices',
      url: detailUrl,
      content: noticeHtml,
      contentType: 'html',
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.source_url).toBe(detailUrl)
    expect(row.family).toBe('macro_policy_event')
    expect(row.source_published_at).toBe('2026-07-08')
    expect(row.macro_values.title).toBe('关于优化科创板做市和交易机制安排的通知')
    expect(row.macro_values.bodyPreview).toContain('市场流动性')
    expect(row.macro_values.bodyPreview).not.toContain('首页 披露')
    expect(new Set(row.macro_values.keyClaims.map((claim: any) => claim.claimCategory))).toEqual(new Set(['official_policy_event']))
  })

  it('classifies attachment-only and JavaScript list pages as retrieval evidence', async () => {
    const attachmentResult = JSON.parse(await macroResearchExtract(store, {
      provider: 'safe_statistics',
      url: 'https://www.safe.gov.cn/safe/2026/0708/attachment-only.html',
      contentType: 'html',
      content: `
        <html><body>
          <div class="article">
            <h1>外汇统计数据附件下载</h1>
            <a href="/safe/2026/0708/reserve-data.xlsx">附件：外汇储备统计表下载</a>
          </div>
        </body></html>
      `,
    }, basePath))

    expect(attachmentResult).toMatchObject({
      action: 'macro_research_extract',
      status: 'failed',
      extracted: 0,
      failed: 1,
    })
    expect(attachmentResult.failures[0]).toMatchObject({
      provider: 'safe_statistics',
      failureClass: 'attachment-only-source',
    })
    expect(attachmentResult.rows[0]).toMatchObject({
      family: 'macro_source_retrieval_evidence',
      status: 'blocked',
      failure_class: 'attachment-only-source',
    })

    const jsResult = JSON.parse(await macroResearchExtract(store, {
      provider: 'china_exchange_notices',
      url: 'https://www.szse.cn/disclosure/notice/general/index.html',
      contentType: 'html',
      content: `
        <html><body>
          <div id="app"></div>
          <script src="/js/runtime.js"></script>
          <script src="/js/notices.js"></script>
        </body></html>
      `,
    }, basePath))

    expect(jsResult).toMatchObject({
      action: 'macro_research_extract',
      status: 'failed',
      extracted: 0,
      failed: 1,
    })
    expect(jsResult.failures[0]).toMatchObject({
      provider: 'china_exchange_notices',
      failureClass: 'javascript-rendered-list',
    })
    expect(jsResult.rows[0]).toMatchObject({
      family: 'macro_source_retrieval_evidence',
      status: 'blocked',
      failure_class: 'javascript-rendered-list',
    })
  })

  it('extracts official API payloads into content-backed evidence', async () => {
    const apiPayload = JSON.stringify({
      data: {
        title: '深圳证券交易所发布市场交易机制优化通知',
        publishTime: '2026-07-08',
        source: '深圳证券交易所',
        content:
          '深圳证券交易所发布通知，优化交易机制、信息披露和市场监管安排，提升市场流动性和风险定价效率。该通知属于交易所官方政策和市场结构事件，应作为A股风险偏好、券商业务和成长板块交易活跃度的宏观假设和观察因素，而不是直接买卖信号。',
      },
    })

    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'szse_notice_api',
      url: 'https://www.szse.cn/api/disclosure/notice/detail?id=20260708',
      contentType: 'api_payload',
      apiPayload,
    }, basePath))

    expect(extracted).toMatchObject({
      action: 'macro_research_extract',
      status: 'ok',
      extracted: 1,
      failed: 0,
    })
    const row = extracted.rows[0]
    expect(row.family).toBe('macro_policy_event')
    expect(row.source_name).toBe('SZSE Notice API')
    expect(row.source_published_at).toBe('2026-07-08')
    expect(row.macro_values.title).toBe('深圳证券交易所发布市场交易机制优化通知')
    expect(row.macro_values.contentType).toBe('api_payload')
    expect(row.macro_values.bodyPreview).toContain('市场流动性')
    expect(row.macro_values.bodyPreview).toContain('风险定价效率')
    expect(row.retrieval_test.status).toBe('extracted')
  })

  it('selects official detail links without treating directories as evidence', () => {
    const source = {
      id: 'test',
      provider: 'test',
      providerName: 'Test',
      priority: 1,
      accessClass: 'official-public-source',
      retrievalMethods: ['direct_html'],
      categories: ['official_policy_event', 'data_release'],
      evidenceValue: 'official_policy_event',
      entryUrls: [],
      testedStatus: 'test',
      testedAt: '2026-07-09',
      defaultUserAgentRequired: false,
      automationPolicy: 'official-public-source',
      limitation: 'test',
      nextAction: 'test',
    }
    const selected = selectMacroResearchDetailUrlForTest({
      sourceUrl: 'https://www.szse.cn/disclosure/notice/general/index.html',
      source,
      html: `
        <html><body>
          <a href="/disclosure/notice/general/">通知公告</a>
          <a href="/disclosure/notice/general/t20260708_600001.html">2026年7月8日深交所通知公告</a>
        </body></html>
      `,
    })
    expect(selected).toBe('https://www.szse.cn/disclosure/notice/general/t20260708_600001.html')

    const tied = selectMacroResearchDetailUrlForTest({
      sourceUrl: 'http://www.csrc.gov.cn/csrc/c100028/common_list.shtml',
      source,
      html: `
        <html><body>
          <a href="/csrc/c100028/c20260708/content.shtml">证监会组织开展上市公司报告专项活动</a>
          <a href="/csrc/c100028/c20210101/content.shtml">证监会较长旧标题公告通知政策数据统计市场交易</a>
        </body></html>
      `,
    })
    expect(tied).toBe('http://www.csrc.gov.cn/csrc/c100028/c20260708/content.shtml')
  })

  it('extracts official index-event PDF text and records blocked sources as retrieval evidence only', async () => {
    const pdfText = `
      MSCI 2026 Market Classification Review
      2026-06-20
      MSCI announced that Indonesia remains under review for market accessibility and index classification.
      The effective date for any reclassification would affect passive benchmark flow and emerging market allocation.
      Investors should monitor consultation status, implementation timing, and official document updates.
    `
    const extracted = JSON.parse(await macroResearchExtract(store, {
      provider: 'msci',
      urlIndex: 1,
      content: pdfText,
      contentType: 'pdf_text',
    }, basePath))

    expect(extracted.extracted).toBe(1)
    expect(extracted.rows[0]).toMatchObject({
      family: 'macro_index_event',
      source_name: 'MSCI',
      status: 'usable',
    })
    expect(extracted.rows[0].macro_values.contentType).toBe('pdf_text')
    expect(extracted.rows[0].macro_values.keyClaims.some((claim: any) => `${claim.claim}`.includes('Indonesia'))).toBe(true)

    const policyHtml = `
      <html><head><title>中国人民银行货币政策执行报告</title></head>
      <body><article>
        <h1>中国人民银行货币政策执行报告</h1>
        <time>2026-07-08</time>
        <p>中国人民银行指出，稳健的货币政策要保持流动性合理充裕，关注利率、汇率和信贷结构对 A股、债券和实体经济的传导影响。</p>
        <p>报告强调政策协调、资本流动和金融市场预期管理，相关政策变化应作为市场分析的宏观假设和失效条件，而不是直接买卖信号。</p>
      </article></body></html>`
    const policy = JSON.parse(await macroResearchExtract(store, {
      provider: 'pboc',
      content: policyHtml,
      contentType: 'html',
    }, basePath))
    expect(policy.extracted).toBe(1)
    expect(policy.rows[0]).toMatchObject({
      family: 'macro_policy_event',
      source_name: "People's Bank of China",
      status: 'usable',
    })
    expect(policy.rows[0].macro_values.interfaceId).toBe('macro.policy_event')
    expect(new Set(policy.rows[0].macro_values.keyClaims.map((claim: any) => claim.claimCategory))).toEqual(new Set(['official_policy_event']))

    const blocked = JSON.parse(await macroResearchExtract(store, { provider: 'cme' }, basePath))
    expect(blocked).toMatchObject({
      action: 'macro_research_extract',
      status: 'failed',
      extracted: 0,
      failed: 1,
    })
    expect(blocked.rows[0]).toMatchObject({
      family: 'macro_source_retrieval_evidence',
      status: 'blocked',
      failure_class: 'manual-browser-or-official-data-delivery',
    })
    expect(blocked.rows.some((row: any) => row.family === 'macro_commodity_event')).toBe(false)
  })

  it('reports extraction support for all current macro research sources', () => {
    const status = JSON.parse(macroResearchExtractionStatus())
    expect(status.action).toBe('macro_research_extraction_status')
    expect(status.rows.length).toBeGreaterThanOrEqual(25)
    const byProvider = new Map(status.rows.map((row: any) => [row.provider, row]))
    expect(byProvider.get('goldman_sachs')).toMatchObject({
      contentExtractorStatus: 'implemented',
      keyClaimExtractorStatus: 'bounded-structural-extraction',
      contentHashReadbackStatus: 'supported',
    })
    expect(byProvider.get('msci')).toMatchObject({
      canonicalEvidenceFamily: 'macro_index_event',
      pdfExtractorStatus: 'minimal-text-parser',
    })
    expect(byProvider.get('pboc_policy_reports')).toMatchObject({
      canonicalEvidenceFamily: 'macro_policy_event',
    })
    expect(byProvider.get('nbs_data_releases')).toMatchObject({
      canonicalEvidenceFamily: 'macro_official_series',
    })
    expect(byProvider.get('hkex_news_releases')).toMatchObject({
      contentExtractorStatus: 'not-extracted',
      contentHashReadbackStatus: 'retrieval-evidence-only',
    })
    expect(byProvider.get('szse_notice_api')).toMatchObject({
      contentExtractorStatus: 'implemented',
      canonicalEvidenceFamily: 'macro_policy_event',
      allowedRetrievalMethod: 'official_api',
    })
    expect(byProvider.get('safe_statistics')).toMatchObject({
      contentHashReadbackStatus: 'supported',
    })
    expect(byProvider.get('cme')).toMatchObject({
      contentExtractorStatus: 'not-extracted',
      contentHashReadbackStatus: 'retrieval-evidence-only',
    })
    expect(byProvider.get('sp_dji')).toMatchObject({
      contentHashReadbackStatus: 'retrieval-evidence-only',
    })
    expect(byProvider.get('pboc')).toMatchObject({
      canonicalEvidenceFamily: 'macro_policy_event',
    })
    expect(byProvider.get('vanguard')).toMatchObject({
      canonicalEvidenceFamily: 'macro_research_document',
    })
  })
})
