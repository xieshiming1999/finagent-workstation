import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'

describe('DataStore alpha_factor persistence', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-alpha-factor-store-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('writes and reads canonical alpha factor rows with provider provenance', () => {
    store.saveAlphaFactorRows([
      {
        provider: 'akshare',
        capability_id: 'akshare.stock.alpha_factors',
        source_action: 'alpha_factors',
        symbol: '600519',
        factor_name: 'momentum_5d',
        params_hash: 'daily-120',
        source_date: '2026-06-18',
        value: 0.12,
        bars: 120,
        fetched_at: '2026-06-18T10:00:00.000Z',
        params_json: '{"period":"daily","limit":120}',
        raw_json: '{"factorName":"momentum_5d"}',
      },
    ])

    expect(store.query('SELECT COUNT(*) as count FROM alpha_factor')[0]).toMatchObject({ count: 1 })
    expect(store.queryAlphaFactorRows({ symbol: '600519', factorName: 'momentum_5d' })[0]).toMatchObject({
      provider: 'akshare',
      capability_id: 'akshare.stock.alpha_factors',
      source_action: 'alpha_factors',
      symbol: '600519',
      factor_name: 'momentum_5d',
      source_date: '2026-06-18',
      value: 0.12,
      bars: 120,
    })
    expect(store.getReusableDataSummary().find((row) => row.name === 'alpha_factor')).toMatchObject({
      count: 1,
      latest: '2026-06-18',
      sources: 'akshare:1',
    })
  })
})
