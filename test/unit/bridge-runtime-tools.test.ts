import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TaskRegistry } from '../../src/agent/background-task'
import { TeamRegistry } from '../../src/agent/team-context'
import type { ToolContext } from '../../src/agent/tool'
import { ScriptTool } from '../../src/agent/tools/script'
import { ServiceCallTool } from '../../src/agent/tools/service-call'
import { MonitorStore, type Monitor } from '../../src/agent/monitor-store'
import { MonitorScheduler } from '../../src/agent/monitor-scheduler'

function makeCtx(basePath: string, bridgeRequest?: ToolContext['bridgeRequest']): ToolContext {
  return {
    basePath,
    workDir: basePath,
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: new TaskRegistry(),
    teamRegistry: new TeamRegistry(),
    bridgeRequest,
    getConfigValue: (key) => key === 'TEST_KEY' ? 'secret' : null,
  }
}

describe('Bridge runtime tools', () => {
  it('ServiceCall uses the bridge router and persists large data responses', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-service-call-'))
    const tool = new ServiceCallTool()
    const ctx = makeCtx(basePath, async (path, params, method) => {
      expect(path).toBe('/api/finance/quote')
      expect(method).toBe('GET')
      expect(params.code).toBe('600519')
      return { data: Array.from({ length: 60 }, (_, i) => ({ i, code: params.code })) }
    })

    const result = JSON.parse(await tool.call('sc1', {
      path: '/api/finance/quote',
      params: { code: '600519' },
    }, ctx))

    expect(result.rows).toBe(60)
    expect(result.file).toContain('/memory/data/')
    expect(readFileSync(result.file, 'utf-8').split('\n')).toHaveLength(60)
  })

  it('Script provides synchronous pre-fetched Bridge HTTP and compatibility aliases', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-script-'))
    const tool = new ScriptTool()
    const ctx = makeCtx(basePath, async (path, params, method) => ({ path, params, method, ok: true }))

    const result = JSON.parse(await tool.call('s1', {
      code: `
        const path = "/api/finance/quote";
        const q = callService(path, { code: "600519" });
        const q2 = Bridge.get("/api/finance/kline", { params: { code: "600519" } });
        const q3 = Bridge.callService("/api/finance/technical", { code: "600519", indicators: "rsi" });
        console.log("rows", Bridge.sum([1,2,3]));
        return { q, q2, q3, key: Bridge.getConfig("TEST_KEY") };
      `,
    }, ctx))

    expect(result.ok).toBe(true)
    expect(result.result.q).toMatchObject({ path: '/api/finance/quote', method: 'GET', ok: true })
    expect(result.result.q2).toMatchObject({ path: '/api/finance/kline', method: 'GET', ok: true })
    expect(result.result.q3).toMatchObject({ path: '/api/finance/technical', method: 'GET', ok: true })
    expect(result.result.q2.params).toEqual({ code: '600519' })
    expect(result.result.q3.params).toEqual({ code: '600519', indicators: 'rsi' })
    expect(result.result.key).toBe('secret')
    expect(result.logs[0]).toContain('rows 6')
    expect(result.prefetched).toBe(3)
  })

  it('MonitorScheduler runs Bridge.fetch and Bridge.callService synchronously through the app router', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-monitor-runtime-'))
    const store = new MonitorStore(basePath)
    const monitor: Monitor = {
      id: 'm1',
      name: 'quote monitor',
      script: `
        const q = Bridge.fetch('/api/finance/quote', { code: '600519' });
        const t = Bridge.callService('/api/finance/technical', { code: '600519', indicators: 'rsi' });
        Bridge.setState('seen', true);
        return { code: q.data[0].code, rsi: t.data.rsi14, source: q.source };
      `,
      intervalSeconds: 60,
      displayType: 'value_card',
      enabled: true,
      state: {},
      conditionTriggered: false,
      hasUnreadAlert: false,
    }
    store.add(monitor)
    const scheduler = new MonitorScheduler(store, basePath)
    scheduler.requestHandler = async (path, params, method) => {
      if (path === '/api/finance/technical') return { source: 'router', data: { rsi14: 33.8, code: params.code, method, path } }
      return { source: 'router', data: [{ code: params.code, method, path }] }
    }

    await (scheduler as any).runMonitor('m1')

    expect(store.get('m1')?.lastError).toBeUndefined()
    expect(store.get('m1')?.state.seen).toBe(true)
    expect(store.get('m1')?.lastResult).toMatchObject({ code: '600519', rsi: 33.8, source: 'router' })
  })

  it('MonitorScheduler exposes documented top-level callService alias', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-bridge-monitor-alias-'))
    const store = new MonitorStore(basePath)
    store.load()
    const monitor = {
      id: 'm-callservice-alias',
      name: 'alias monitor',
      enabled: true,
      intervalSeconds: 60,
      script: `
        const q = callService('/api/finance/quote', { code: '600519' });
        return { value: q.data[0].price, source: q.source };
      `,
      displayType: 'value_card',
      state: {},
      conditionTriggered: false,
      hasUnreadAlert: false,
    }
    store.add(monitor)
    const scheduler = new MonitorScheduler(store, basePath)
    scheduler.requestHandler = async (path, params) => {
      expect(path).toBe('/api/finance/quote')
      expect(params.code).toBe('600519')
      return { source: 'test', data: [{ price: 1168.63 }] }
    }

    scheduler.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    scheduler.stop()

    expect(store.get(monitor.id)?.lastError).toBeUndefined()
    expect(store.get(monitor.id)?.lastResult).toMatchObject({
      value: 1168.63,
      source: 'test',
    })
  })

  it('MonitorScheduler forwards Bridge.sendToAgent with structured strategy preflight data', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-monitor-agent-message-'))
    const store = new MonitorStore(basePath)
    store.load()
    const monitor: Monitor = {
      id: 'm-agent-message',
      name: 'strategy signal monitor',
      enabled: true,
      intervalSeconds: 60,
      script: `
        Bridge.sendToAgent('策略信号已触发：贵州茅台 600519。请先计算可以买多少和风险，不要直接下单；需要用户确认后才允许进入雪球模拟盘或 Portfolio 写入。', {
          template: 'strategy_signal',
          strategyId: 'custom_20_v1',
          code: '600519',
          price: 1200,
          confirmationRequired: true,
          tradeBoundary: 'No Portfolio or XueqiuTrade action before explicit user confirmation.'
        });
        return { signal: 'entry', value: 1200 };
      `,
      displayType: 'value_card',
      state: {},
      conditionTriggered: false,
      hasUnreadAlert: false,
    }
    store.add(monitor)
    const scheduler = new MonitorScheduler(store, basePath)
    const messages: Array<{ id: string; name: string; message: string; data: Record<string, unknown> }> = []
    scheduler.onAgentMessage = (id, name, message, data) => {
      messages.push({ id, name, message, data })
    }

    await (scheduler as any).runMonitor(monitor.id)

    expect(store.get(monitor.id)?.lastError).toBeUndefined()
    expect(store.get(monitor.id)?.lastResult).toMatchObject({ signal: 'entry', value: 1200 })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: monitor.id,
      name: monitor.name,
    })
    expect(messages[0].message).toContain('请先计算可以买多少和风险')
    expect(messages[0].data).toMatchObject({
      template: 'strategy_signal',
      strategyId: 'custom_20_v1',
      code: '600519',
      confirmationRequired: true,
    })
  })
})
