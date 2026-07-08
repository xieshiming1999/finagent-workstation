import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import type { Agent } from '../agent/agent'
import type { AgentBridge } from './agent-bridge'
import type { McpManager } from '../agent/mcp-client'
import type { LoadedPlugin } from '../agent/plugin-loader'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { loadCalendar, saveCalendar, refreshCalendarFromDataApi } from './trading-calendar'
import { latestTradingDay } from './trading-calendar'
import { buildMarketSnapshot, saveSnapshot } from '../agent/data/market-snapshot'
import { getSidecarUrl, getGotdxUrl } from './sidecar'
import { globalApiStats, globalCircuitBreaker } from '../agent/data/tracked-fetch'
import { globalHookRegistry } from '../agent/hook-registry'
import type { LLMProvider } from '../agent/llm-provider'
import type { DataStore } from '../agent/data/store/data-store'
import { readMacroFactorRadar, refreshMacroFactorRadar } from './macro-factor-radar'
import type { FetchQueue } from '../agent/data/queue/fetch-queue'
import { getSourceStatus } from '../agent/data/queue/rate-limiter'
import { readAllLogs, readRecentLog } from './logger'
import { providerOrder, type FinanceDataTask, type FinanceProvider } from '../agent/data/provider-policy'
import { cachePolicyFor } from '../agent/data/cache-policy'
import { buildFundPulseRefreshRequests, queryFundSuggestions } from './fund-panel-data'
import type { GoalAutomationService } from '../agent/goal-automation-service'
import type { GoalTemplateId } from '../agent/goal-automation-types'
import { buildFinanceDoctorReport } from './finance-doctor'
import {
  readFundWatchlistCodes,
  resolveFeedCodesWithStore,
} from './watchlist-feed-codes'
import { enqueueConfiguredDataFeed } from '../agent/data/queue/data-feed-enqueue'
import { ArtifactRegistry } from '../agent/artifact-registry'
import { queueStatusEvent } from '../agent/agent-background'
import { buildDataInterfaceHealth } from '../agent/data/data-interface-health'
import {
  FinanceRuntimeProbeService,
  type RuntimeProbeMode,
} from '../agent/data/runtime-probe-service'
import {
  buildStrategyLibraryActionPrompt,
  findStrategyLibraryItem,
  readStrategyLibrary,
} from './strategy-library'

export interface IPCContext {
  getAgent: () => Agent | null
  getEventAgent?: () => Agent | null
  getBridge: () => AgentBridge | null
  getMcpManager: () => McpManager | null
  getPlugins: () => LoadedPlugin[]
  getBasePath: () => string
  globalConfigPath: () => string
  createLLMProvider: (cfg?: AppConfig) => LLMProvider
  getDataStore: () => DataStore | null
  getFetchQueue?: () => FetchQueue | null
  getGoalAutomation?: () => GoalAutomationService | null
}

function normalizeStrategyLibraryAction(action: unknown): 'rerun' | 'watch' | 'monitor' | 'read' {
  if (action === 'watch' || action === 'monitor' || action === 'read') return action
  return 'rerun'
}

export function wireIPC(ctx: IPCContext): void {
  const runtimeProbeService = new FinanceRuntimeProbeService(
    ctx.getBasePath(),
    () => buildDataInterfaceHealth(
      (() => {
        const ds = ctx.getDataStore()
        return ds && ds.isReady ? ds : null
      })(),
      undefined,
      { runtimeBasePath: ctx.getBasePath() },
    ),
  )

  async function sendPromptToChatAgent(
    event: IpcMainInvokeEvent,
    prompt: string,
  ): Promise<void> {
    const agent = ctx.getAgent()
    if (!agent) { console.error('[agent:send] agent not initialized'); return }
    console.log(`[agent:send] prompt="${prompt.slice(0, 80)}" model=${agent.llm.model}`)
    try {
      if (agent.isRunning) {
        agent.enqueueUserInput(prompt)
        event.sender.send('agent:event', queueStatusEvent(agent.notifications, 'Queued'))
        return
      }

      const stream = agent.run(prompt)
      for await (const ev of stream) {
        event.sender.send('agent:event', ev)
      }
    } catch (err) {
      console.error('[agent:send] error:', err)
      event.sender.send('agent:event', { type: 'error', message: String(err) })
    }
  }

  ipcMain.handle('agent:send', async (event, prompt: string) => {
    await sendPromptToChatAgent(event, prompt)
  })

  ipcMain.handle('eventAgent:send', async (event, prompt: string) => {
    const agent = ctx.getEventAgent?.() ?? null
    if (!agent) { console.error('[eventAgent:send] event agent not initialized'); return }
    console.log(`[eventAgent:send] prompt="${prompt.slice(0, 80)}" model=${agent.llm.model}`)
    try {
      if (agent.isRunning) {
        agent.enqueueUserInput(prompt)
        event.sender.send('event-agent:event', queueStatusEvent(agent.notifications, 'Queued'))
        return
      }

      const stream = agent.run(prompt)
      for await (const ev of stream) {
        event.sender.send('event-agent:event', ev)
      }
    } catch (err) {
      console.error('[eventAgent:send] error:', err)
      event.sender.send('event-agent:event', { type: 'error', message: String(err) })
    }
  })

  ipcMain.handle('eventAgent:cancel', () => { ctx.getEventAgent?.()?.cancel() })

  ipcMain.handle('eventAgent:background', (event) => {
    const taskId = ctx.getEventAgent?.()?.backgroundCurrentTask() ?? null
    if (taskId) event.sender.send('event-agent:event', { type: 'backgrounded', taskId })
    return taskId
  })

  ipcMain.handle('eventAgent:queueClear', (event) => {
    const agent = ctx.getEventAgent?.() ?? null
    if (!agent) return false
    agent.notifications.clear()
    event.sender.send('event-agent:event', queueStatusEvent(agent.notifications))
    return true
  })

  ipcMain.handle('eventAgent:queuePause', (event, paused: boolean) => {
    const agent = ctx.getEventAgent?.() ?? null
    if (!agent) return false
    agent.notifications.accepting = !paused
    event.sender.send('event-agent:event', queueStatusEvent(agent.notifications, paused ? 'Paused' : undefined))
    return true
  })

  ipcMain.handle('agent:cancel', () => { ctx.getAgent()?.cancel() })

  ipcMain.handle('agent:background', (event) => {
    const taskId = ctx.getAgent()?.backgroundCurrentTask() ?? null
    if (taskId) event.sender.send('agent:event', { type: 'backgrounded', taskId })
    return taskId
  })

  ipcMain.handle('agent:resolvePermission', (_, result: { approved: boolean; alwaysAllow?: boolean; rejectReason?: string }) => {
    ctx.getAgent()?.resolvePermission(result)
  })

  ipcMain.handle('agent:getConfig', () => loadConfig(ctx.globalConfigPath()))

  ipcMain.handle('agent:setConfig', (_, cfg: AppConfig) => {
    saveConfig(ctx.globalConfigPath(), cfg)
    const agent = ctx.getAgent()
    if (agent) agent.setLLM(ctx.createLLMProvider(cfg))
    return true
  })

  ipcMain.handle('agent:clear', () => { ctx.getAgent()?.clearSession() })
  ipcMain.handle('agent:history', () => ctx.getAgent()?.listHistory() ?? [])
  ipcMain.handle('agent:sessions', () => ctx.getAgent()?.listSessions() ?? [])
  ipcMain.handle('agent:resume', (_, filePath: string) => { ctx.getAgent()?.resumeSession(filePath) })
  ipcMain.handle('agent:sessionPreview', (_, filePath: string) => readSessionPreview(ctx.getBasePath(), filePath))

  ipcMain.handle('agent:sessionMessages', () => {
    const agent = ctx.getAgent()
    if (!agent) return []
    return serializeSessionMessages(agent)
  })

  ipcMain.handle('eventAgent:sessionMessages', () => {
    const agent = ctx.getEventAgent?.() ?? null
    if (!agent) return []
    return serializeSessionMessages(agent)
  })

  ipcMain.handle('agent:contextTrace', (_, event: unknown) => {
    console.log('[ContextTrace:renderer]', event)
  })

  ipcMain.handle('app:webviewTrace', (_, event: unknown) => {
    console.log('[WebViewTrace]', event)
  })

  ipcMain.handle('app:recentLog', () => readRecentLog())
  ipcMain.handle('app:logs', () => readAllLogs())

  ipcMain.handle('app:assetPath', (_, relativePath: string) => join(__dirname, '../../assets', relativePath))
  ipcMain.handle('app:openExternal', async (_, url: string) => {
    const target = String(url ?? '').trim()
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, error: 'Only http/https URLs can be opened externally' }
    }
    await shell.openExternal(target)
    return { ok: true }
  })

  ipcMain.handle('calendar:get', () => loadCalendar(ctx.getBasePath()))
  ipcMain.handle('calendar:save', (_, calendar) => { saveCalendar(ctx.getBasePath(), calendar); return true })
  ipcMain.handle('calendar:fetch', async (_, year: number) => {
    return refreshCalendarFromDataApi(ctx.getBasePath(), ctx.getDataStore(), year)
  })
  ipcMain.handle('data:market-pulse-refresh', async () => {
    try {
      const tradingDate = latestTradingDay(loadCalendar(ctx.getBasePath()))
      const snapshot = await buildMarketSnapshot(tradingDate, ctx.getDataStore())
      saveSnapshot(ctx.getBasePath(), snapshot)
      return { ok: true, timestamp: snapshot.timestamp }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('app:webviewPreload', () => {
    const builtPreload = join(__dirname, '../preload/webview-preload.cjs')
    if (existsSync(builtPreload)) return builtPreload
    return join(__dirname, '../../src/preload/webview-preload.cjs')
  })

  ipcMain.handle('bridge:message', async (_, msg) => {
    const bridge = ctx.getBridge()
    if (!bridge) return { error: 'Bridge not initialized' }
    const safe = summarizeBridgeMessage(msg)
    console.log('[BridgeIPC] request', safe)
    const result = await bridge.handleMessage(msg)
    console.log('[BridgeIPC] response', { id: safe.id, type: safe.type, result: summarizeBridgeResult(result) })
    return result
  })

  ipcMain.handle('api:stats', () => {
    const ds = ctx.getDataStore()
    const ranges = { '5m': 5, '30m': 30, '1h': 60, '24h': 24 * 60, '7d': 7 * 24 * 60 }
    const rangeSummaries = Object.fromEntries(Object.entries(ranges).map(([key, minutes]) => [
      key,
      ds?.isReady ? ds.getApiCallSummary(minutes) : globalApiStats.getSummary(),
    ]))
    return {
      summary: ds?.isReady ? ds.getApiCallSummary(24 * 60) : globalApiStats.getSummary(),
      rangeSummaries,
      recent: ds?.isReady ? ds.getRecentApiCalls(24 * 60, 300) : globalApiStats.getRecent(24 * 60),
      memorySummary: globalApiStats.getSummary(),
      circuitBreaker: globalCircuitBreaker.getStatus(),
    }
  })

  ipcMain.handle('research:workspace', () => {
    const registry = new ArtifactRegistry(ctx.getBasePath())
    return registry.list('research').slice(0, 50).map((record) => {
      let payload: Record<string, unknown> | null = null
      try {
        const resolved = resolve(record.path)
        const base = resolve(ctx.getBasePath())
        if (resolved.startsWith(base) && existsSync(resolved)) {
          payload = JSON.parse(readFileSync(resolved, 'utf-8'))
        }
      } catch {
        payload = null
      }
      return { ...record, payload }
    })
  })

  ipcMain.handle('goalAutomation:list', () => {
    return ctx.getGoalAutomation?.()?.list() ?? []
  })

  ipcMain.handle('goalAutomation:suggestions', () => {
    return ctx.getGoalAutomation?.()?.listSuggestions(buildDoctorReport(ctx)) ?? []
  })

  ipcMain.handle('goalAutomation:acceptSuggestion', (_, ref: string) => {
    const svc = ctx.getGoalAutomation?.()
    if (!svc) return { ok: false, error: 'Goal automation service is not initialized' }
    return svc.acceptSuggestion(String(ref))
  })

  ipcMain.handle('goalAutomation:dismissSuggestion', (_, ref: string) => {
    const svc = ctx.getGoalAutomation?.()
    if (!svc) return { ok: false, error: 'Goal automation service is not initialized' }
    return svc.dismissSuggestion(String(ref))
  })

  ipcMain.handle('goalAutomation:runNow', (_, templateId: GoalTemplateId) => {
    const svc = ctx.getGoalAutomation?.()
    if (!svc) return { status: 'failed', reason: 'Goal automation service is not initialized' }
    return svc.runNow(templateId, 'run_now')
  })

  ipcMain.handle('goalAutomation:setEnabled', (_, templateId: GoalTemplateId, enabled: boolean) => {
    const svc = ctx.getGoalAutomation?.()
    if (!svc) return { error: 'Goal automation service is not initialized' }
    return svc.setEnabled(templateId, Boolean(enabled))
  })

  ipcMain.handle('goalAutomation:pause', (_, templateId: GoalTemplateId, paused: boolean) => {
    const svc = ctx.getGoalAutomation?.()
    if (!svc) return { error: 'Goal automation service is not initialized' }
    return svc.pause(templateId, Boolean(paused))
  })

  ipcMain.handle('sidecar:status', async () => {
    const sidecarUrl = getSidecarUrl()
    const gotdxUrl = getGotdxUrl()
    let tdxHealth: any = null
    if (gotdxUrl) {
      try {
        const res = await fetch(`${gotdxUrl}/health`, { signal: AbortSignal.timeout(3000) })
        tdxHealth = await res.json()
      } catch { tdxHealth = { status: 'unreachable' } }
    }
    return { sidecar: sidecarUrl ? 'running' : 'stopped', sidecarUrl, gotdx: gotdxUrl ? 'running' : 'stopped', gotdxUrl, tdxHealth }
  })

  ipcMain.handle('mcp:status', () => ctx.getMcpManager()?.getStatus() ?? [])

  ipcMain.handle('plugins:list', () => {
    return ctx.getPlugins().map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      tools: p.toolFiles.length,
      skills: p.skillPaths.length,
      commands: p.commandPaths.length,
      source: p.source,
      enabled: p.enabled,
    }))
  })

  ipcMain.handle('hooks:list', () => globalHookRegistry.list())

  ipcMain.handle('dashboard:list', () => {
    const { existsSync, readdirSync, statSync } = require('fs')
    const basePath = ctx.getBasePath()
    const results: Array<{ name: string; path: string; size: number; modified: string; source: string }> = []

    for (const [dir, source] of [
      [join(basePath, 'dashboards'), 'dashboards'],
      [join(basePath, 'memory/pages'), 'pages'],
    ] as const) {
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir).filter((f: string) => f.endsWith('.html'))) {
        const s = statSync(join(dir, f))
        results.push({ name: f.replace('.html', ''), path: join(dir, f), size: s.size, modified: s.mtime.toISOString(), source })
      }
    }

    return results.sort((a, b) => b.modified.localeCompare(a.modified))
  })

  ipcMain.handle('strategy:library', () => readStrategyLibrary(ctx.getBasePath()))

  ipcMain.handle('strategy:action', async (event, input: { action?: string; strategyId?: string }) => {
    const action = normalizeStrategyLibraryAction(input?.action)
    const library = readStrategyLibrary(ctx.getBasePath())
    if (!library.ok) throw new Error(`STRATEGY_LIBRARY_UNREADABLE: ${library.error}`)
    const strategy = findStrategyLibraryItem(library, input?.strategyId)
    if (!strategy) {
      const suffix = input?.strategyId ? `: ${input.strategyId}` : ''
      throw new Error(`STRATEGY_LIBRARY_ITEM_NOT_FOUND${suffix}`)
    }
    const normalizedAction = action === 'rerun' && !strategy.runnable ? 'read' : action
    await sendPromptToChatAgent(
      event,
      buildStrategyLibraryActionPrompt(normalizedAction, strategy),
    )
    return {
      ok: true,
      action: normalizedAction,
      strategyId: strategy.strategyId,
      status: strategy.status,
    }
  })

  // Data layer IPC
  ipcMain.handle('data:stats', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { tables: [], sizeBytes: 0 }
    return { ...ds.getStats(), reusable: ds.getReusableDataSummary() }
  })

  ipcMain.handle('data:interface-health', () => {
    const ds = ctx.getDataStore()
    return buildDataInterfaceHealth(ds && ds.isReady ? ds : null, undefined, {
      runtimeBasePath: ctx.getBasePath(),
    })
  })

  ipcMain.handle('data:probe-status', () => runtimeProbeService.getStatus())

  ipcMain.handle('data:macro-factors', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { rows: [], sources: [], generatedAt: new Date().toISOString(), error: 'DataStore not yet initialized, please wait' }
    return readMacroFactorRadar(ds)
  })

  ipcMain.handle('data:macro-factor-refresh', async () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { rows: [], sources: [], generatedAt: new Date().toISOString(), error: 'DataStore not yet initialized, please wait' }
    return refreshMacroFactorRadar(ds, loadConfig(ctx.globalConfigPath()))
  })

  ipcMain.handle('data:run-probes', async (_, mode: RuntimeProbeMode = 'all', probeIds: string[] = []) => {
    return runtimeProbeService.run(mode, Array.isArray(probeIds) ? probeIds : [])
  })

  ipcMain.handle('data:coverage', (_, dataType?: string) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    return ds.getAllCoverage(dataType)
  })

  ipcMain.handle('data:tasks', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    return ds.query(
      `SELECT * FROM fetch_tasks
        WHERE NOT (
          status = 'failed'
          AND (
            error LIKE 'manual data-feed verification recovered stale active task%'
            OR error LIKE 'manual verification interrupted before completion%'
            OR error LIKE 'stale active task recovered on startup%'
            OR (code IS NULL AND error LIKE 'code required%')
            OR (
              task_type = 'fund_money_yield'
              AND NOT EXISTS (
                SELECT 1 FROM fund_list f
                WHERE f.code = fetch_tasks.code
                  AND f.fund_category = 'money'
              )
            )
            OR (
              task_type = 'fund_nav'
              AND EXISTS (
                SELECT 1 FROM fund_list f
                WHERE f.code = fetch_tasks.code
                  AND f.fund_category IN ('money', 'backend', 'unknown')
              )
            )
          )
        )
        ORDER BY created_at DESC LIMIT 50`,
    )
  })

  ipcMain.handle('data:sources', async () => {
    const tsStatus = getSourceStatus()

    // Also check sidecar health
    const sidecarSources: Array<{ source: string; minInterval: number; active: number; lastCall: number; status: 'online' | 'degraded' | 'offline'; errorCount: number }> = []
    try {
      const res = await fetch('http://127.0.0.1:19800/rate_limit/status', { signal: AbortSignal.timeout(3000) })
      const rl = await res.json() as any
      const akI = rl.akshare?.interactive ?? {}
      const akB = rl.akshare?.background ?? {}
      sidecarSources.push({
        source: 'akshare',
        minInterval: (akI.current_interval ?? 0.5) * 1000,
        active: 0,
        lastCall: akI.last_call ?? 0,
        status: (akI.consecutive_errors ?? 0) > 3 ? 'degraded' : 'online',
        errorCount: (akI.total_errors ?? 0) + (akB.total_errors ?? 0),
      })
      const yfI = rl.yfinance?.interactive ?? {}
      sidecarSources.push({
        source: 'yfinance',
        minInterval: (yfI.current_interval ?? 1) * 1000,
        active: 0,
        lastCall: yfI.last_call ?? 0,
        status: (yfI.consecutive_errors ?? 0) > 3 ? 'degraded' : 'online',
        errorCount: yfI.total_errors ?? 0,
      })
    } catch {
      sidecarSources.push({ source: 'akshare', minInterval: 0, active: 0, lastCall: 0, status: 'offline', errorCount: 0 })
      sidecarSources.push({ source: 'yfinance', minInterval: 0, active: 0, lastCall: 0, status: 'offline', errorCount: 0 })
    }

    try {
      const res = await fetch('http://127.0.0.1:19801/health', { signal: AbortSignal.timeout(3000) })
      const h = await res.json() as any
      sidecarSources.push({
        source: 'tdx',
        minInterval: 200,
        active: 0,
        lastCall: 0,
        status: h.status === 'ok' ? 'online' : 'offline',
        errorCount: 0,
      })
    } catch {
      sidecarSources.push({ source: 'tdx', minInterval: 0, active: 0, lastCall: 0, status: 'offline', errorCount: 0 })
    }

    sidecarSources.push({ source: 'tradingview', minInterval: 0, active: 0, lastCall: 0, status: 'online', errorCount: 0 })
    sidecarSources.push({ source: 'local', minInterval: 0, active: 0, lastCall: 0, status: 'online', errorCount: 0 })
    sidecarSources.push({ source: 'eastmoneyDirect', minInterval: 0, active: 0, lastCall: 0, status: 'online', errorCount: 0 })
    sidecarSources.push({ source: 'sina', minInterval: 0, active: 0, lastCall: 0, status: 'online', errorCount: 0 })
    sidecarSources.push({ source: 'tencent', minInterval: 0, active: 0, lastCall: 0, status: 'online', errorCount: 0 })
    const cfg = loadConfig(ctx.globalConfigPath())
    sidecarSources.push({
      source: 'wind',
      minInterval: 0,
      active: 0,
      lastCall: 0,
      status: cfg.apiKeys?.WIND_API_KEY ? 'online' : 'offline',
      errorCount: 0,
    })
    sidecarSources.push({
      source: 'tushare',
      minInterval: 61_000,
      active: 0,
      lastCall: 0,
      status: cfg.apiKeys?.TUSHARE_TOKEN ? 'online' : 'offline',
      errorCount: 0,
    })

    return sidecarSources
  })

  ipcMain.handle('data:doctor', () => {
    return buildDoctorReport(ctx)
  })

  ipcMain.handle('data:routing', async () => {
    const cfg = loadConfig(ctx.globalConfigPath())
    const tasks: Array<{ task: FinanceDataTask; label: string }> = [
      { task: 'quote', label: 'A-share quotes' },
      { task: 'kline', label: 'A-share daily K-line' },
      { task: 'indexQuote', label: 'Index quotes' },
      { task: 'indexKline', label: 'Index K-line' },
      { task: 'sector', label: 'Sectors' },
      { task: 'limitPool', label: 'Limit up/down pool' },
      { task: 'dragonTiger', label: 'Dragon Tiger' },
      { task: 'fund', label: 'Funds / ETF' },
      { task: 'fundamental', label: 'Fundamentals' },
      { task: 'moneyFlow', label: 'Money flow' },
      { task: 'macro', label: 'Macro' },
      { task: 'intradayTick', label: 'Intraday tick' },
    ]
    const gates = {
      windConfigured: Boolean(cfg.apiKeys?.WIND_API_KEY),
      windQuotaAvailable: true,
      tushareConfigured: Boolean(cfg.apiKeys?.TUSHARE_TOKEN),
      tusharePermissionLikely: true,
      allowAkshareCompatibility: true,
    }
    const disabled: Partial<Record<FinanceProvider, string>> = {}
    if (!gates.windConfigured) disabled.wind = 'WIND_API_KEY not configured'
    if (!gates.tushareConfigured) disabled.tushare = 'TUSHARE_TOKEN not configured'
    return {
      gates,
      disabled,
      routes: tasks.map((item) => ({
        task: item.task,
        label: item.label,
        providers: providerOrder(item.task, gates),
      })),
      cachePolicies: [
        { task: 'quote', label: 'A-share quotes', policy: cachePolicyFor('quote') },
        { task: 'kline', label: 'A-share daily K-line', policy: cachePolicyFor('kline') },
        { task: 'indexKline', label: 'Index K-line', policy: cachePolicyFor('indexKline') },
        { task: 'fund', label: 'Funds / ETF', policy: cachePolicyFor('fund') },
      ],
    }
  })

  ipcMain.handle('data:fetch', (_, type: string, code?: string, params?: Record<string, unknown>) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { error: 'DataStore not yet initialized, please wait' }
    const priority = (params?.priority as number) ?? 3
    const id = enqueueDataTask(ctx, ds, type, code ?? null, params ?? {}, priority)
    return { id, message: `Task #${id} queued: ${type} ${code ?? ''}` }
  })

  ipcMain.handle('data:stock-search', (_, query: string, limit = 8) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    const q = String(query ?? '').trim()
    if (q.length < 1) return []
    const rows = ds.query<{ code: string; name: string; market: string }>(
      `SELECT code,name,market FROM stock_list
        WHERE code LIKE ? OR name LIKE ?
        ORDER BY CASE WHEN code = ? THEN 0 WHEN code LIKE ? THEN 1 ELSE 2 END, code
        LIMIT ?`,
      `%${q}%`,
      `%${q}%`,
      q,
      `${q}%`,
      Math.max(1, Math.min(20, Number(limit) || 8)),
    )
    return rows
  })

  ipcMain.handle('data:fund-search', (_, query: string, limit = 8) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    const q = String(query ?? '').trim()
    if (q.length < 1) return []
    return ds.query(
      `SELECT code,name,fund_type,company,nav,nav_date,return_1y,return_3y,return_ytd,updated_at FROM fund_list
        WHERE code LIKE ? OR name LIKE ?
        ORDER BY CASE WHEN code = ? THEN 0 WHEN code LIKE ? THEN 1 ELSE 2 END, code
        LIMIT ?`,
      `%${q}%`,
      `%${q}%`,
      q,
      `${q}%`,
      Math.max(1, Math.min(20, Number(limit) || 8)),
    )
  })

  ipcMain.handle('data:fund-suggestions', (_, limit = 8) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    return queryFundSuggestions(ds, limit)
  })

  ipcMain.handle('data:fund-watchlist', (_, codes: string[]) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return []
    const cleanCodes = Array.from(new Set((Array.isArray(codes) ? codes : [])
      .map((code) => String(code ?? '').trim())
      .filter(Boolean)))
    return cleanCodes.map((code) => {
      const meta = ds.query<Record<string, unknown>>('SELECT * FROM fund_list WHERE code = ? LIMIT 1', code)[0] ?? {}
      const nav = ds.query<Record<string, unknown>>('SELECT * FROM fund_nav WHERE code = ? ORDER BY date DESC LIMIT 1', code)[0] ?? {}
      return {
        code,
        name: meta.name ?? code,
        fund_type: meta.fund_type ?? null,
        company: meta.company ?? null,
        manager: meta.manager ?? null,
        nav: nav.nav ?? meta.nav ?? null,
        nav_date: nav.date ?? meta.nav_date ?? null,
        daily_return: nav.daily_return ?? null,
        return_1y: meta.return_1y ?? null,
        return_3y: meta.return_3y ?? null,
        return_ytd: meta.return_ytd ?? null,
        source: nav.source ?? 'fund_list',
        provider_time: nav.date ?? meta.nav_date ?? null,
        cache_status: nav.date || meta.code ? 'cache' : 'missing',
        updated_at: meta.updated_at ?? null,
      }
    })
  })

  ipcMain.handle('data:fund-pulse', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { etfMovers: [], fundLeaders: [], navMovers: [] }
    const fundPulseCutoff = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10)
    const etfMovers = ds.query(
      `SELECT sl.code, COALESCE(qs.name, sl.name, sl.code) AS name, qs.price, qs.change_pct, qs.volume,
          qs.timestamp, qs.fetched_at, qs.source, qs.timestamp AS provider_time, 'cache' AS cache_status
        FROM stock_list sl
        JOIN quote_snapshot qs ON qs.code = sl.code
        WHERE sl.stock_type = 'etf'
          AND qs.timestamp = (
            SELECT MAX(q2.timestamp) FROM quote_snapshot q2 WHERE q2.code = qs.code
          )
        ORDER BY ABS(COALESCE(qs.change_pct, 0)) DESC, qs.timestamp DESC
        LIMIT 8`,
    )
    const fundLeaders = ds.query(
      `SELECT code,name,fund_type,company,nav,nav_date,return_ytd,return_1y,
          'fund_list' AS source, nav_date AS provider_time, updated_at, 'cache' AS cache_status
        FROM fund_list
        WHERE return_ytd IS NOT NULL OR return_1y IS NOT NULL
          AND nav_date IS NOT NULL
          AND nav_date >= ?
        ORDER BY COALESCE(return_ytd, return_1y, 0) DESC
        LIMIT 8`,
      fundPulseCutoff,
    )
    const navMovers = ds.query(
      `SELECT fn.code, COALESCE(fl.name, fn.code) AS name, fl.fund_type, fl.company,
          fn.nav, fn.date AS nav_date, fn.daily_return, fl.return_1y,
          fn.source, fn.date AS provider_time, fl.updated_at, 'cache' AS cache_status
        FROM fund_nav fn
        LEFT JOIN fund_list fl ON fl.code = fn.code
        WHERE fn.date = (
          SELECT MAX(fn2.date) FROM fund_nav fn2 WHERE fn2.code = fn.code
        )
          AND fn.daily_return IS NOT NULL
          AND fn.date IS NOT NULL
          AND fn.date >= ?
        ORDER BY fn.daily_return DESC
        LIMIT 8`,
      fundPulseCutoff,
    )
    const staleInfo = {
      fundLeaderStaleCount: ds.query<{ count: number }>(
        `SELECT COUNT(*) AS count
          FROM fund_list
          WHERE (return_ytd IS NOT NULL OR return_1y IS NOT NULL)
            AND (nav_date IS NULL OR nav_date < ?)`,
        fundPulseCutoff,
      )[0]?.count ?? 0,
      navMoverStaleCount: ds.query<{ count: number }>(
        `SELECT COUNT(*) AS count
          FROM fund_nav fn
          WHERE fn.date = (
            SELECT MAX(fn2.date) FROM fund_nav fn2 WHERE fn2.code = fn.code
          )
            AND fn.daily_return IS NOT NULL
            AND (fn.date IS NULL OR fn.date < ?)`,
        fundPulseCutoff,
      )[0]?.count ?? 0,
      latestFundLeaderDate: ds.query<{ latest: string | null }>(
        `SELECT MAX(nav_date) AS latest
          FROM fund_list
          WHERE return_ytd IS NOT NULL OR return_1y IS NOT NULL`,
      )[0]?.latest ?? null,
      latestNavMoverDate: ds.query<{ latest: string | null }>(
        'SELECT MAX(date) AS latest FROM fund_nav WHERE daily_return IS NOT NULL',
      )[0]?.latest ?? null,
    }
    const cache = {
      fundListCount: ds.query<{ count: number }>('SELECT COUNT(*) as count FROM fund_list')[0]?.count ?? 0,
      fundNavCount: ds.query<{ count: number }>('SELECT COUNT(*) as count FROM fund_nav')[0]?.count ?? 0,
      fundPerformanceCount: ds.query<{ count: number }>('SELECT COUNT(*) as count FROM fund_performance_metrics')[0]?.count ?? 0,
      etfCount: ds.query<{ count: number }>("SELECT COUNT(*) as count FROM stock_list WHERE stock_type = 'etf'")[0]?.count ?? 0,
      etfQuoteCount: ds.query<{ count: number }>("SELECT COUNT(*) as count FROM quote_snapshot WHERE code IN (SELECT code FROM stock_list WHERE stock_type = 'etf')")[0]?.count ?? 0,
    }
    const tasks = ds.query(
      `SELECT id,task_type,code,status,created_at,updated_at,error,progress
        FROM fetch_tasks
        WHERE task_type IN ('fund_list','fund_nav','fund_performance','etf_quotes')
        ORDER BY created_at DESC
        LIMIT 6`,
    )
    return { etfMovers, fundLeaders, navMovers, cache, tasks, staleInfo }
  })

  ipcMain.handle('data:fund-pulse-refresh', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { error: 'DataStore not yet initialized, please wait' }
    const plan = buildFundPulseRefreshRequests(ds, readFundWatchlistCodes(ctx.getBasePath()))
    const taskIds = plan.requests.map((request) => (
      enqueueDataTask(ctx, ds, request.taskType, request.code, request.params, request.priority)
    ))
    return { taskIds, existing: plan.existing, queued: plan.requests.map((request) => ({ taskType: request.taskType, code: request.code })) }
  })

  ipcMain.handle('data:fund-refresh', (_, codes: string[] = [], includeList = false) => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { error: 'DataStore not yet initialized, please wait' }
    const taskIds: number[] = []
    if (includeList) taskIds.push(enqueueDataTask(ctx, ds, 'fund_list', null, { source: 'fund-watchlist' }, 2))
    for (const code of Array.from(new Set(codes.map((value) => String(value ?? '').trim()).filter(Boolean)))) {
      taskIds.push(enqueueDataTask(ctx, ds, 'fund_nav', code, { source: 'fund-watchlist' }, 2))
    }
    return { taskIds }
  })

  ipcMain.handle('data:feeds', () => {
    const ds = ctx.getDataStore()
    if (!ds || !ds.isReady) return { loading: true, feeds: [] }
    return {
      loading: false,
      feeds: ds.getFeedConfigs().map((feed) => {
        const resolvedCodes = resolveFeedCodesWithStore(feed, ctx.getBasePath(), ds)
        return {
          ...feed,
          resolved_codes: resolvedCodes,
          resolved_count: resolvedCodes.length,
        }
      }),
    }
  })

  ipcMain.handle('data:feed-update', (_, feedId: string, updates: Record<string, unknown>) => {
    const ds = ctx.getDataStore()
    if (!ds) return { error: 'DataStore not initialized' }
    ds.updateFeedConfig(feedId, updates as any)
    return { ok: true }
  })

  ipcMain.handle('data:feed-run', (_, feedId: string) => {
    const ds = ctx.getDataStore()
    if (!ds) return { error: 'DataStore not initialized' }
    const config = ds.getFeedConfig(feedId)
    if (!config) return { error: `Feed ${feedId} not found` }
    if (!config.enabled) return { error: `Feed ${feedId} is disabled` }

    const queue = {
      enqueue: (taskType: string, code: string | null, params: Record<string, unknown>, priority: number) =>
        enqueueDataTask(ctx, ds, taskType, code, params, priority),
    }
    const result = enqueueConfiguredDataFeed(ds, queue, config, {
      basePath: ctx.getBasePath(),
      taskPriority: 2,
      prerequisitePriority: 1,
    })
    if (result.kind === 'needs_codes') return { error: result.message, needsCodes: true, openSettings: true }
    if (result.kind === 'prerequisite') {
      return {
        id: result.taskIds[0] ?? null,
        taskIds: result.taskIds,
        prerequisite: true,
        message: `${config.display_name} queued prerequisite: ${result.reason}. Run the feed again after it completes.`,
      }
    }
    return { id: result.taskIds[0] ?? null, taskIds: result.taskIds, message: result.message }
  })

  ipcMain.handle('data:feed-stop', (_, feedId: string) => {
    const ds = ctx.getDataStore()
    if (!ds) return { error: 'DataStore not initialized' }
    ds.updateFeedConfig(feedId, { status: 'idle' })
    return { ok: true }
  })
}

function enqueueDataTask(
  ctx: IPCContext,
  ds: DataStore,
  taskType: string,
  code: string | null,
  params: Record<string, unknown>,
  priority: number,
): number {
  const queue = ctx.getFetchQueue?.() ?? null
  if (queue) return queue.enqueue(taskType, code, params, priority)
  return ds.createTask(taskType, code, params, priority)
}

function serializeSessionMessages(agent: Agent): Array<Record<string, unknown>> {
  return agent.messages
    .filter((m) => m.content || m.toolUses?.length || m.toolResult)
    .map((m) => ({
      role: m.role,
      content: m.content ?? '',
      isRecap: (m as any).isRecap === true,
      toolUses: m.toolUses?.map((tu) => {
        const input: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(tu.input ?? {})) {
          const s = String(v)
          input[k] = s.length > 100 ? s.slice(0, 100) + '...' : s
        }
        return { name: tu.name, input }
      }),
      toolResult: m.toolResult ? {
        content: m.toolResult.content.slice(0, 2000),
        isError: m.toolResult.isError,
        imagePaths: m.toolResult.imagePaths,
        imageMetadata: m.toolResult.imageMetadata,
      } : undefined,
    }))
}

function readSessionPreview(basePath: string, filePath: string): Record<string, unknown> {
  const allowedRoots = [
    resolve(basePath, 'sessions'),
    resolve(basePath, 'sessions', 'history'),
    resolve(basePath, 'sessions', 'archive'),
  ]
  const target = resolve(String(filePath ?? ''))
  const isAllowed = allowedRoots.some((root) => {
    const rel = relative(root, target)
    return (rel === 'current.jsonl' || (rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')))
  })
  if (!isAllowed || !target.endsWith('.jsonl') || !existsSync(target)) {
    return { error: 'Session history file is not available' }
  }

  const lines = readFileSync(target, 'utf-8').split('\n').filter((line) => line.trim())
  const messages: Array<{ role: string; content: string; toolName?: string; isError?: boolean; timestamp?: string }> = []
  let title: string | null = null
  let createdAt: string | null = null

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, any>
      if (entry.type === 'session_meta') {
        createdAt = String(entry.createdAt ?? '')
        continue
      }
      if (entry.type === 'title') {
        title = String(entry.title ?? '')
        continue
      }

      const role = String(entry.role ?? '')
      if (!role) continue
      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
      const content = String(entry.content ?? '').trim()
      if (role === 'user' || role === 'assistant') {
        if (content) messages.push({ role, content: trimPreview(content, 2000), timestamp })
        const toolUses = Array.isArray(entry.toolUses) ? entry.toolUses : []
        for (const tool of toolUses) {
          messages.push({
            role: 'tool-use',
            content: trimPreview(JSON.stringify(tool.input ?? {}), 600),
            toolName: String(tool.name ?? 'Tool'),
            timestamp,
          })
        }
      } else if (entry.toolResult || entry.tool_result) {
        const result = entry.toolResult ?? entry.tool_result
        messages.push({
          role: 'tool-result',
          content: trimPreview(String(result?.content ?? ''), 800),
          isError: Boolean(result?.isError),
          timestamp,
        })
      }
    } catch {
      // Skip malformed lines in archived sessions.
    }
    if (messages.length >= 80) break
  }

  return { title, createdAt, messages }
}

function trimPreview(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function buildDoctorReport(ctx: IPCContext) {
  const cfg = loadConfig(ctx.globalConfigPath())
  return buildFinanceDoctorReport({
    dataStore: ctx.getDataStore(),
    basePath: ctx.getBasePath(),
    gates: {
      windConfigured: Boolean(cfg.apiKeys?.WIND_API_KEY),
      windQuotaAvailable: true,
      tushareConfigured: Boolean(cfg.apiKeys?.TUSHARE_TOKEN),
      tusharePermissionLikely: true,
      allowAkshareCompatibility: true,
    },
  })
}

function summarizeBridgeMessage(msg: unknown): Record<string, unknown> {
  const m = msg && typeof msg === 'object' ? msg as Record<string, unknown> : {}
  const data = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? m.data as Record<string, unknown> : {}
  return {
    id: m.id,
    type: m.type,
    path: m.path,
    method: m.method,
    source: m.source,
    message: typeof m.message === 'string' ? m.message.slice(0, 120) : undefined,
    dataKeys: Object.keys(data),
  }
}

function summarizeBridgeResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { value: result }
  const r = result as Record<string, unknown>
  const data = Array.isArray(r.data) ? r.data : null
  return {
    ok: r.ok,
    error: r.error,
    queued: r.queued,
    notificationId: r.notificationId,
    source: r.source,
    warning: r.warning,
    dataCount: data?.length,
    firstCode: data && data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>).code : undefined,
  }
}
