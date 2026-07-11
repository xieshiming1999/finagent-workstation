import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { ProviderRouterTool } from '../../src/agent/tools/provider-router'

describe('ProviderRouterTool', () => {
  it('routes quote with code-owned provider order and blocks', async () => {
    const result = JSON.parse(await new ProviderRouterTool().call('router-1', {
      action: 'route',
      task: 'quote',
      preferredProviders: ['eastmoneyDirect', 'tdx'],
      temporarilyBlockedProviders: ['tdx'],
    }, tempToolContext()))

    expect(result.contract).toBe('provider-router-route-v1')
    expect(result.order).toEqual(['eastmoneyDirect'])
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'tdx', reason: 'temporarily_blocked' }),
    ]))
    expect(result.serialProviders).toContain('eastmoneyDirect')
  })

  it('explains credential and compatibility gates', async () => {
    const result = JSON.parse(await new ProviderRouterTool().call('router-2', {
      action: 'route',
      task: 'macro',
      gates: { tushareConfigured: true },
    }, tempToolContext()))

    expect(result.order).toEqual(['tushare'])
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'wind', reason: 'wind_not_configured' }),
      expect.objectContaining({ provider: 'akshare', reason: 'akshare_compatibility_disabled' }),
    ]))
  })

  it('uses provider health to skip unhealthy provider', async () => {
    const result = JSON.parse(await new ProviderRouterTool().call('router-health', {
      action: 'route',
      task: 'quote',
      providerHealth: [
        {
          provider: 'tdx',
          status: 'runtime_unavailable',
          reason: 'gotdx sidecar unavailable',
        },
      ],
    }, tempToolContext()))

    expect(result.order[0]).toBe('eastmoneyDirect')
    expect(result.providerHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'tdx',
        reason: expect.stringContaining('runtime_unavailable'),
      }),
    ]))
  })

  it('merges runtime provider health by default', async () => {
    const result = JSON.parse(await new ProviderRouterTool(() => [
      {
        provider: 'tdx',
        status: 'runtime_unavailable',
        reason: 'runtime probe failed',
        source: 'test-runtime-health',
      },
    ]).call('router-runtime-health', {
      action: 'route',
      task: 'quote',
    }, tempToolContext()))

    expect(result.order[0]).toBe('eastmoneyDirect')
    expect(result.providerHealthSource).toMatchObject({
      runtimeEnabled: true,
      runtimeRows: 1,
      manualRows: 0,
    })
    expect(result.providerHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'tdx',
        reason: expect.stringContaining('runtime_unavailable'),
      }),
    ]))
  })

  it('can disable runtime provider health for diagnostics', async () => {
    const result = JSON.parse(await new ProviderRouterTool(() => [
      {
        provider: 'tdx',
        status: 'runtime_unavailable',
        reason: 'runtime probe failed',
        source: 'test-runtime-health',
      },
    ]).call('router-runtime-health-off', {
      action: 'route',
      task: 'quote',
      includeRuntimeHealth: false,
    }, tempToolContext()))

    expect(result.order[0]).toBe('tdx')
    expect(result.providerHealth).toEqual([])
    expect(result.providerHealthSource).toMatchObject({
      runtimeEnabled: false,
      runtimeRows: 0,
    })
  })

  it('rejects unsupported task through the tool error channel', async () => {
    await expect(new ProviderRouterTool().call('router-3', {
      action: 'route',
      task: 'unknown',
    }, tempToolContext())).rejects.toThrow('requires a supported task')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-provider-router-tool-'))
  const memoryDir = join(basePath, 'memory')
  mkdirSync(memoryDir, { recursive: true })
  return {
    basePath,
    workDir: basePath,
    memoryDir,
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: false,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
  }
}
