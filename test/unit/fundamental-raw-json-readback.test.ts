import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { queryFundamental } from '../../src/agent/tools/data-store-tool-query-core-fundamentals'

describe('fundamental raw provider payload readback', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-fundamental-raw-store-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('preserves raw provider fields and exposes compact risk-useful facts', () => {
    store.saveFundamental([
      {
        code: '600519',
        report_date: '2026-03-31',
        pe_ttm: null,
        pb: null,
        roe: 8.1,
        revenue_yoy: 12.3,
        profit_yoy: 10.4,
        market_cap: null,
        source: 'eastmoney:earnings',
        updated_at: '2026-06-27T10:00:00.000Z',
        raw_json: JSON.stringify({
          REPORT_TYPE: '一季报',
          NOTICE_DATE: '2026-04-30',
          BPS: 216.32,
          EPS_BASIC: 21.76,
        }),
      },
    ])

    expect(store.query<{ raw_json: string }>('SELECT raw_json FROM fundamental WHERE code = ?', '600519')[0].raw_json)
      .toContain('"BPS":216.32')

    const output = queryFundamental(store, { code: '600519' })
    expect(output).toContain('Report:一季报')
    expect(output).toContain('Notice:2026-04-30')
    expect(output).toContain('BPS:216.32')
    expect(output).toContain('EPS:21.76')
  })
})
