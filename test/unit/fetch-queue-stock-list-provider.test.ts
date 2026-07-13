import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'

const { fetchStockListA } = vi.hoisted(() => ({
  fetchStockListA: vi.fn(async () => ({
    data: [{
      code: '600519',
      name: '贵州茅台',
      market: 'SH',
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'stock',
      updated_at: '2026-07-13T00:00:00.000Z',
    }],
    source: 'tdx',
    fetchedAt: '2026-07-13T00:00:00.000Z',
  })),
}))

vi.mock('../../src/agent/data/fetchers/fetcher-stock-list', () => ({
  fetchStockListA,
  fetchStockListHK: vi.fn(),
  fetchStockListUS: vi.fn(),
}))

import { FetchQueue } from '../../src/agent/data/queue/fetch-queue'

describe('FetchQueue stock-list provider routing', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-stock-list-provider-'))
    cpSync(join(process.cwd(), 'assets', 'migrations'), join(basePath, 'data', 'migrations'), { recursive: true })
    store = new DataStore(basePath)
    await store.init()
    fetchStockListA.mockClear()
  })

  afterEach(() => {
    closeDb(basePath)
    rmSync(basePath, { recursive: true, force: true })
  })

  it('passes an explicit provider as a strict router constraint', async () => {
    const queue = new FetchQueue(store)
    queue.enqueue('stock_list', null, { provider: 'tdx', forceLive: true })

    await queue.start()

    expect(fetchStockListA).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'tdx',
      providerMode: 'strict',
      skipCache: true,
    }))
    expect(store.queryStockIdentity('600519')).toMatchObject({ name: '贵州茅台' })
  })
})
