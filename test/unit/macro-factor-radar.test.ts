import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { readMacroFactorRadar, refreshMacroFactorRadar } from '../../src/main/macro-factor-radar'

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
    expect(result.sources.map((source) => source.id)).toContain('manual.msci')

    const msci = result.rows.find((row) => row.factor_id === 'manual:index_classification:msci:indonesia-watch')
    expect(msci).toMatchObject({
      family: 'index_classification',
      source_name: 'MSCI',
      source_type: 'manual_seed',
      status: 'watch',
    })
    expect(msci?.affected_assets).toContain('Indonesia equities')
    expect(msci?.transmission_channels).toContain('passive benchmark flow')
    expect(msci?.retrieval_test).toMatchObject({
      interface_id: 'macro.factor_radar',
      candidate_schema: 'market_moving_factor_v1',
      status: 'fallback-only',
    })
  })

  it('promotes cached finance news as unclassified narrative observations', async () => {
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

    const result = await refreshMacroFactorRadar(store, { apiKeys: {} } as any)
    const row = result.rows.find((item) => item.factor_id?.toString().startsWith('news:cached:'))
    expect(row).toMatchObject({
      family: 'narrative_attention',
      source_type: 'cached_finance_news',
      source_name: 'test-news',
      status: 'watch',
    })
    expect(row?.affected_assets).toEqual([])
    expect(row?.retrieval_test).toMatchObject({
      provider: 'finance_news',
      interface_id: 'macro.factor_radar',
      status: 'ok',
    })
  })
})
