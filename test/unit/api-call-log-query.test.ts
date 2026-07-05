import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore } from '../../src/agent/data/store/data-store'
import { DataStoreTool } from '../../src/agent/tools/data-store-tool'
import type { ToolContext } from '../../src/agent/tool'

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), 'fin-api-log-'))
  cpSync(join(process.cwd(), 'assets', 'migrations'), join(base, 'data', 'migrations'), { recursive: true })
  return base
}

function makeBasePathWithoutRuntimeMigrations(): string {
  return mkdtempSync(join(tmpdir(), 'fin-api-log-no-runtime-migrations-'))
}

function makeCtx(basePath: string): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
    getConfigValue: () => undefined,
  }
}

describe('API call log query', () => {
  let basePath = ''
  let store: DataStore

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T10:00:00.000Z'))
    basePath = makeBasePath()
    store = new DataStore(basePath)
    await store.init()
  })

  afterEach(() => {
    vi.useRealTimers()
    closeDb()
    if (basePath) rmSync(basePath, { recursive: true, force: true })
  })

  it('reads recent API failures through DataStoreTool query_api_calls', async () => {
    store.saveApiCall({
      source: 'eastmoney',
      provider: 'eastmoney',
      interface_id: 'index.quote',
      capability_id: 'eastmoney.index.quote',
      tool: 'BridgeIPC',
      action: 'index-quotes',
      endpoint: '/api/finance/index/quotes',
      status: 0,
      success: false,
      duration_ms: 30459,
      error: 'provider contract mismatch',
    })

    const tool = new DataStoreTool()
    tool.setDataStore(store)

    await expect(tool.call('api-log', {
      action: 'query_api_calls',
      source: 'eastmoney',
      failures: true,
      minutes: 30,
    }, makeCtx(basePath))).resolves.toContain('API call log')
    await expect(tool.call('api-log', {
      action: 'query_api_calls',
      endpoint: 'index/quotes',
      failures: true,
      minutes: 30,
    }, makeCtx(basePath))).resolves.toContain('provider contract mismatch')
    await expect(tool.call('api-log', {
      action: 'query_api_calls',
      provider: 'eastmoney',
      interfaceId: 'index.quote',
      capabilityId: 'eastmoney.index.quote',
      failures: true,
      minutes: 30,
    }, makeCtx(basePath))).resolves.toContain('interface:index.quote capability:eastmoney.index.quote')
  })
})

describe('API call log migration fallback', () => {
  let basePath = ''

  afterEach(() => {
    closeDb()
    if (basePath) rmSync(basePath, { recursive: true, force: true })
  })

  it('uses bundled migrations when runtime migrations are not copied yet', async () => {
    basePath = makeBasePathWithoutRuntimeMigrations()
    const store = new DataStore(basePath)
    await store.init()

    store.saveApiCall({
      source: 'eastmoney',
      provider: 'eastmoney',
      interface_id: 'index.quote',
      capability_id: 'eastmoney.index.quote',
      tool: 'BridgeIPC',
      action: 'index-quotes',
      endpoint: '/api/finance/index/quotes',
      status: 200,
      success: true,
      duration_ms: 120,
    })

    const rows = store.query<Record<string, unknown>>('SELECT provider, interface_id, capability_id FROM api_call_log')
    expect(rows).toEqual([{
      provider: 'eastmoney',
      interface_id: 'index.quote',
      capability_id: 'eastmoney.index.quote',
    }])
  })
})
