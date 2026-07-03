import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DataStore } from '../../src/agent/data/store/data-store'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'

describe('DataStore structured stock identity readback', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-stock-identity-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
    store.run(
      `INSERT INTO stock_list (code,name,market,industry,stock_type,updated_at)
       VALUES (?,?,?,?,?,?)`,
      ['600519', '贵州茅台', 'SH', '白酒', 'stock', '2026-07-09T00:00:00.000Z'],
    )
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('returns typed identity rows for keyword lookup', async () => {
    const tool = new DataStoreTool()
    tool.setDataStore(store)

    const payload = JSON.parse(await tool.call(
      'identity-readback',
      { action: 'query_stock_list', keyword: '贵州茅台', limit: 5 },
      { basePath } as never,
    ))

    expect(payload).toMatchObject({
      action: 'query_stock_list',
      keyword: '贵州茅台',
      count: 1,
      data: [{ code: '600519', name: '贵州茅台', market: 'SH' }],
      provenance: {
        interfaceId: 'stock.identity_list',
        readbackAction: 'query_stock_list',
      },
    })
  })
})
