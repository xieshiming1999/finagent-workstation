import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { Agent } from '../agent/agent'
import { Role } from '../agent/message'
import { financeWorkflowHooks } from '../domain/finance/workflows/finance-workflow-hooks'
import { ToolRegistry } from '../agent/tool'
import { EchoTool } from '../agent/tools/echo'
import { FileReadTool } from '../agent/tools/file-read'
import { FileWriteTool } from '../agent/tools/file-write'
import { FileEditTool } from '../agent/tools/file-edit'
import { BashTool } from '../agent/tools/bash'
import { BudgetGovernorTool } from '../agent/tools/budget-governor'
import { GlobTool } from '../agent/tools/glob'
import { GrepTool } from '../agent/tools/grep'
import { LSTool } from '../agent/tools/ls'
import { WebFetchTool } from '../agent/tools/web-fetch'
import { ServiceCallTool } from '../agent/tools/service-call'
import { ScriptTool } from '../agent/tools/script'
import { WebViewTool } from '../agent/tools/webview'
import { DashboardTool } from '../agent/tools/dashboard'
import { MarketDataTool } from '../agent/tools/market-data'
import { WindMcpTool } from '../agent/tools/wind-mcp'
import { SkillTool } from '../agent/tools/skill'
import { SourceReaderTool } from '../agent/tools/source-reader'
import { AskUserQuestionTool } from '../agent/tools/ask-user'
import { TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool, TaskOutputTool, TaskStopTool } from '../agent/tools/tasks'
import { EnterPlanModeTool, ExitPlanModeTool } from '../agent/tools/plan-mode'
import { EnvironmentTool } from '../agent/tools/environment'
import { InteractionEvidenceTool } from '../agent/tools/interaction-evidence'
import { WorkflowEvidenceTool } from '../agent/tools/workflow-evidence'
import { WorkflowVerifierTool } from '../agent/tools/workflow-verifier'
import { AgentSelfDebugTool } from '../agent/tools/agent-self-debug'
import { FinanceWorkflowStateTool } from '../agent/tools/finance-workflow-state'
import { CapabilityStatusTool } from '../agent/tools/capability-status'
import { ToolCatalogTool } from '../agent/tools/tool-catalog'
import { RunbookTool } from '../agent/tools/runbook'
import { ArtifactRegistryTool } from '../agent/tools/artifact-registry'
import { DataProcessTool } from '../agent/tools/data-process'
import { CronCreateTool, CronDeleteTool, CronListTool } from '../agent/tools/cron'
import { WatchlistTool } from '../agent/tools/watchlist'
import { WatchlistStore } from '../agent/watchlist-store'
import { WatchlistRefresher } from '../agent/watchlist-refresher'
import { PortfolioTool } from '../agent/tools/portfolio'
import { ProviderRouterTool } from '../agent/tools/provider-router'
import { RecoveryPlannerTool } from '../agent/tools/recovery-planner'
import { ResearchTool } from '../agent/tools/research'
import { CronScheduler } from '../agent/cron-scheduler'
import { MonitorCreateTool, MonitorUpdateTool, MonitorDeleteTool, MonitorListTool } from '../agent/tools/monitor'
import { MonitorStore } from '../agent/monitor-store'
import { MonitorScheduler } from '../agent/monitor-scheduler'
import { DataTaskEngine } from '../agent/data-task-engine'
import { UINotificationStore } from '../agent/ui-notification'
import { FileManageTool } from '../agent/tools/file-manage'
import { UIControlTool, UIQueryTool, UINotifyTool } from '../agent/tools/ui-tools'
import { AgentTool, SendMessageTool, TeamCreateTool, TeamListTool, TeamDeleteTool, setAgentFactory } from '../agent/tools/agent-tools'
import { DataTaskTool } from '../agent/tools/data-task'
import { SessionSearchTool, setSessionIndex } from '../agent/tools/session-search'
import { SessionIndex } from '../agent/session-index'
import { ScreenshotTool } from '../agent/tools/screenshot'
import { XueqiuTradeTool } from '../agent/tools/xueqiu-trade'
import { ReportDownloadTool, ReportParseTool } from '../agent/tools/report'
import { ImageCropTool, ImageExtractTool } from '../agent/tools/image'
import { MultimodalAgentTool } from '../agent/tools/multimodal-agent'
import { PageRenderTool } from '../agent/tools/page-render'
import { DataStoreTool } from '../agent/tools/data-store-tool'
import { DataStore } from '../agent/data/store/data-store'
import { setCurrentRuntimeBasePath } from '../agent/data/current-runtime-base-path'
import { GoalAutomationService } from '../agent/goal-automation-service'
import { FetchQueue, type FetchTask } from '../agent/data/queue/fetch-queue'
import { FetchScheduler } from '../agent/data/queue/fetch-scheduler'
import { globalApiStats } from '../agent/data/resilience'
import { loadConfig, getDefaultModel, findModelByCapability } from './config'
import { stopSidecar } from './sidecar'
import { AgentBridge } from './agent-bridge'
import { configureBridgeRouter, routeRequest } from './bridge-router'
import { initLogger } from './logger'
import { McpManager } from '../agent/mcp-client'
import { discoverPlugins, registerPluginTools, getPluginSkillPaths, getPluginCommandPaths, getPluginMcpConfigs } from '../agent/plugin-loader'
import { globalHookRegistry } from '../agent/hook-registry'
import { McpServer } from '../agent/mcp-server'
import { wireIPC } from './ipc-handlers'
import { migrateLegacyProjectBasePath, resolveProjectBasePath } from './project-path'
import { createLLMFromModelConfig, createLLMProvider, createWindow, globalConfigPath, registerSession } from './main-runtime'
import { configureDashboardTool, configureUiTools, configureWebViewTool, createRendererUiBridge } from './main-ui-tools'
import { reOpenWindowIfNeeded, startAppServices } from './main-startup'
import { isActionableFeedTaskFailure } from '../agent/data/data-feed-failure-policy'
import { WorkflowAutomationControl, startWorkflowAutomationServer, type WorkflowAutomationServer } from './workflow-automation-control'

let mainWindow: BrowserWindow | null = null
let agent: Agent | null = null
let eventAgent: Agent | null = null
let bridge: AgentBridge | null = null
let mcpManager: McpManager | null = null
let plugins: import('../agent/plugin-loader').LoadedPlugin[] = []
let basePath = ''
let dataStoreInstance: DataStore | null = null
let fetchQueueInstance: FetchQueue | null = null
let goalAutomationService: GoalAutomationService | null = null
let goalAutomationTimer: ReturnType<typeof setInterval> | null = null
let workflowAutomationServer: WorkflowAutomationServer | null = null
let workflowPanelStateQuery: (() => Promise<unknown>) | null = null

type MainResolvedLanguage = 'en' | 'zh-CN'

function isWorkflowBackgroundDisabled(): boolean {
  if (process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION !== '1') return false
  const enable = String(process.env.FINAGENT_WORKSTATION_WORKFLOW_ENABLE_BACKGROUND ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(enable)) return false
  const value = String(process.env.FINAGENT_WORKSTATION_WORKFLOW_DISABLE_BACKGROUND ?? '').trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return true
}

async function waitForWorkflowEventAgentCheckpoint(
  runtime: Agent | null,
  timeoutMs: number,
  hasPendingUserQuestion?: () => boolean,
): Promise<{ completed: boolean; reason: 'no-runtime' | 'idle' | 'pending-user-question' | 'timeout'; waitedMs: number }> {
  const startedAt = Date.now()
  if (!runtime) return { completed: true, reason: 'no-runtime', waitedMs: 0 }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasPendingUserQuestion?.()) {
      return { completed: true, reason: 'pending-user-question', waitedMs: Date.now() - startedAt }
    }
    if (!runtime.isRunning && !runtime.notifications.isNotEmpty) {
      return { completed: true, reason: 'idle', waitedMs: Date.now() - startedAt }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return { completed: false, reason: 'timeout', waitedMs: Date.now() - startedAt }
}

function workflowEventAgentEvidence(
  runtime: Agent | null,
  messageStartIndex: number,
  events: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (!runtime) {
    return {
      messageCount: 0,
      eventCount: events.length,
      toolCalls: [],
      toolErrors: [],
      toolCallCount: 0,
      toolErrorCount: 0,
      finalAssistantText: '',
      isRunning: false,
      queueLength: null,
    }
  }
  const messages = runtime.messages.slice(messageStartIndex)
  const toolCalls = messages.flatMap((message) =>
    (message.toolUses ?? []).map((tool) => ({
      toolName: tool.name,
      input: tool.input,
    })),
  )
  const toolErrors = messages
    .filter((message) => message.toolResult?.isError)
    .map((message) => ({
      toolUseId: message.toolResult?.toolUseId ?? '',
      content: truncateWorkflowText(message.toolResult?.content ?? '', 2000),
    }))
  const finalAssistantText =
    [...messages]
      .reverse()
      .find((message) => message.role === Role.Assistant && message.content.trim())?.content
      .trim() ?? ''
  return {
    messageCount: messages.length,
    eventCount: events.length,
    toolCalls,
    toolErrors,
    toolCallCount: toolCalls.length,
    toolErrorCount: toolErrors.length,
    finalAssistantText: truncateWorkflowText(finalAssistantText, 4000),
    isRunning: runtime.isRunning,
    queueLength: runtime.notifications.length,
  }
}

function truncateWorkflowText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...<truncated>`
}

function getResolvedMainLanguage() : MainResolvedLanguage {
  const mode = loadConfig(globalConfigPath()).language
  if (mode === 'en' || mode === 'zh-CN') return mode
  const locale = app.getLocale().toLowerCase()
  return locale.startsWith('zh') ? 'zh-CN' : 'en'
}

function mainCopy() {
  return getResolvedMainLanguage() === 'zh-CN'
    ? {
        monitorNotification: (monitorName: string, message: string, data: unknown) =>
          `[监控通知：${monitorName}] ${message}\ndata: ${JSON.stringify(data)}`,
        dashboardNotification: (source: string, message: string, payload: string) =>
          `[仪表盘通知：${source}] ${message}${payload}`,
        dashboardQueued: (source: string, message: string) =>
          `[仪表盘] 已排队来自 ${source} 的消息：${message}\n`,
        dashboardThrottled: (source: string, message: string) =>
          `[仪表盘] 来自 ${source} 的消息被限流：${message}\n`,
      }
    : {
        monitorNotification: (monitorName: string, message: string, data: unknown) =>
          `[Monitor Notification: ${monitorName}] ${message}\ndata: ${JSON.stringify(data)}`,
        dashboardNotification: (source: string, message: string, payload: string) =>
          `[Dashboard Notification: ${source}] ${message}${payload}`,
        dashboardQueued: (source: string, message: string) =>
          `[Dashboard] queued message from ${source}: ${message}\n`,
        dashboardThrottled: (source: string, message: string) =>
          `[Dashboard] message from ${source} was throttled: ${message}\n`,
      }
}

function initAgent() {
  const globalBase = globalConfigPath()
  const cwd = process.cwd()
  const migration = migrateLegacyProjectBasePath(globalBase, cwd)
  basePath = resolveProjectBasePath(globalBase, cwd)
  setCurrentRuntimeBasePath(basePath)
  if (migration.migrated) {
    console.log('[initAgent] migrated legacy project runtime:', migration.from, '→', migration.to)
  }

  // Ensure directories exist
  const { mkdirSync, cpSync } = require('fs')
  mkdirSync(basePath, { recursive: true })

  // Global config lives at ~/.finagent-workstation/config.json (shared across projects)
  // Per-project data lives under ~/.finagent-workstation/projects/by-cwd/<cwd path segments>/

  initLogger(basePath)

  // Sync bundle assets to project data dir so agent can access via bundle/ paths
  const assetsPath = app.isPackaged
    ? join(process.resourcesPath, 'assets')
    : join(__dirname, '../../assets')
  const bundleSrc = join(assetsPath, 'bundle')
  const bundleDst = join(basePath, 'bundle')
  try {
    rmSync(bundleDst, { recursive: true, force: true })
    cpSync(bundleSrc, bundleDst, { recursive: true, force: true })
  } catch (e) {
    console.error('[initAgent] bundle sync failed:', e)
  }

  // Sync migrations to data dir
  const migrationsSrc = join(assetsPath, 'migrations')
  const migrationsDst = join(basePath, 'data', 'migrations')
  try {
    mkdirSync(join(basePath, 'data'), { recursive: true })
    cpSync(migrationsSrc, migrationsDst, { recursive: true, force: true })
    console.log('[initAgent] migrations synced:', migrationsSrc, '→', migrationsDst)
  } catch (e) {
    console.error('[initAgent] migrations sync failed:', e, 'src:', migrationsSrc, 'dst:', migrationsDst)
  }

  // Set API tokens from global config
  const globalConfig = loadConfig(globalConfigPath())
  const sharedGetConfigValue = (key: string) => {
    const cfg = loadConfig(globalConfigPath())
    if (key in cfg.apiKeys) return cfg.apiKeys[key]
    return (cfg as unknown as Record<string, unknown>)[key] ?? null
  }
  configureBridgeRouter({
    basePath,
    getConfigValue: sharedGetConfigValue,
  })

  const registry = new ToolRegistry()
  registry.register(new ToolCatalogTool(() => registry.capabilities()))
  registry.register(new EchoTool())
  registry.register(new FileReadTool())
  registry.register(new FileWriteTool())
  registry.register(new FileEditTool())
  const bashTool = new BashTool()
  bashTool.onProgress = (_toolUseId, output, elapsedMs) => {
    emitToRenderer({ type: 'tool-progress', name: 'Bash', output: output.slice(0, 500), elapsedMs })
  }
  registry.register(bashTool)
  registry.register(new GlobTool())
  registry.register(new GrepTool())
  registry.register(new LSTool())
  registry.register(new WebFetchTool())
  registry.register(new ServiceCallTool())
  registry.register(new ScriptTool())

  const webviewTool = new WebViewTool()
  const dashboardTool = new DashboardTool()
  const { emitToRenderer, queryRendererPanels, requestRendererUi } = createRendererUiBridge(() => mainWindow)
  workflowPanelStateQuery = queryRendererPanels
  configureWebViewTool(webviewTool, () => mainWindow, emitToRenderer, queryRendererPanels)
  configureDashboardTool(dashboardTool, assetsPath, emitToRenderer, queryRendererPanels)
  registry.register(webviewTool)
  registry.register(dashboardTool)
  registry.register(new MarketDataTool())
  registry.register(new WindMcpTool((key) => loadConfig(globalConfigPath()).apiKeys[key]))
  registry.register(new SkillTool(assetsPath))
  const askUserQuestionTool = new AskUserQuestionTool()
  askUserQuestionTool.setEventEmitter(emitToRenderer)
  registry.register(askUserQuestionTool)
  registry.register(new TaskCreateTool())
  registry.register(new TaskGetTool())
  registry.register(new TaskUpdateTool())
  registry.register(new TaskListTool())
  registry.register(new TaskOutputTool())
  const taskStopTool = new TaskStopTool()
  registry.register(taskStopTool)
  registry.register(new EnterPlanModeTool())
  registry.register(new ExitPlanModeTool())
  registry.register(new EnvironmentTool())
  registry.register(new InteractionEvidenceTool())
  registry.register(new WorkflowEvidenceTool())
  registry.register(new WorkflowVerifierTool())
  registry.register(new ProviderRouterTool())
  registry.register(new RecoveryPlannerTool())
  registry.register(new BudgetGovernorTool())
  registry.register(new SourceReaderTool())
  registry.register(new RunbookTool())
  registry.register(new ArtifactRegistryTool())
  registry.register(new CapabilityStatusTool(() => registry.capabilities()))
  registry.register(new AgentSelfDebugTool(() => registry.capabilities()))
  registry.register(new FinanceWorkflowStateTool())
  // Wire session index for SessionSearchTool
  const sessionsDir = join(basePath, 'sessions')
  const sessionIndex = new SessionIndex(sessionsDir)
  setSessionIndex(sessionIndex)

  const watchlistStore = new WatchlistStore()
  watchlistStore.load(basePath)
  registry.register(new DataProcessTool({
    watchlistItems: () => watchlistStore.items,
  }))

  const monitorStore = new MonitorStore(join(basePath, 'sessions'))
  monitorStore.load()
  const monitorScheduler = new MonitorScheduler(monitorStore, basePath)
  const notificationStore = new UINotificationStore(join(basePath, 'sessions'))
  monitorScheduler.notificationStore = notificationStore
  monitorScheduler.getConfigValue = sharedGetConfigValue
  monitorScheduler.requestHandler = routeRequest

  const dataTaskEngine = new DataTaskEngine(basePath)
  dataTaskEngine.load()
  dataTaskEngine.resumePending()
  const watchlistRefresher = new WatchlistRefresher(watchlistStore)
  watchlistRefresher.toolContext = {
    basePath,
    workDir: cwd,
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(cwd, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: null as any,
    teamRegistry: null as any,
    bridgeRequest: routeRequest,
    getConfigValue: sharedGetConfigValue,
  }
  registry.register(new WatchlistTool({
    onChanged: () => watchlistStore.load(basePath),
  }))
  registry.register(new PortfolioTool())
  registry.register(new ResearchTool())

  const cronScheduler = new CronScheduler(basePath)
  registry.register(new CronCreateTool(cronScheduler))
  registry.register(new CronDeleteTool(cronScheduler))
  registry.register(new CronListTool(cronScheduler))
  registry.register(new MonitorCreateTool(monitorStore))
  registry.register(new MonitorUpdateTool(monitorStore))
  registry.register(new MonitorDeleteTool(monitorStore))
  registry.register(new MonitorListTool(monitorStore))
  registry.register(new FileManageTool())
  registry.register(new DataTaskTool(dataTaskEngine))
  registry.register(new SessionSearchTool())

  const uiControlTool = new UIControlTool()
  const uiNotifyTool = new UINotifyTool()
  const agentTool = new AgentTool()
  agentTool.setEventEmitter(emitToRenderer)
  registry.register(uiControlTool)
  const uiQueryTool = new UIQueryTool()
  configureUiTools(uiControlTool, uiNotifyTool, uiQueryTool, () => mainWindow, emitToRenderer, queryRendererPanels, requestRendererUi)
  registry.register(uiQueryTool)
  registry.register(uiNotifyTool)
  registry.register(agentTool)
  const sendMessageTool = new SendMessageTool()
  registry.register(sendMessageTool)
  registry.register(new TeamListTool())
  registry.register(new TeamCreateTool())
  const teamDeleteTool = new TeamDeleteTool()
  registry.register(teamDeleteTool)
  registry.register(new ScreenshotTool())
  registry.register(new XueqiuTradeTool())
  registry.register(new ReportDownloadTool())
  registry.register(new ReportParseTool())
  registry.register(new ImageCropTool())
  registry.register(new ImageExtractTool())
  registry.register(new PageRenderTool())
  const dataStoreTool = new DataStoreTool()
  registry.register(dataStoreTool)

  const multimodalAgent = new MultimodalAgentTool()
  registry.register(multimodalAgent)

  const config = loadConfig(globalConfigPath())
  const defaultModel = getDefaultModel(config)
  const capabilities = {
    vision: defaultModel?.capabilities?.vision ?? false,
    audio: defaultModel?.capabilities?.audio ?? false,
  }

  // Plugins: discover from bundled + global + project-local
  const projectLocalDir = join(process.cwd(), '.finagent-workstation')
  plugins = discoverPlugins(globalConfigPath(), assetsPath, projectLocalDir)
  const pluginCount = registerPluginTools(plugins, registry)
  if (pluginCount > 0) console.log(`[Plugin] Registered ${pluginCount} tools from ${plugins.length} plugins`)

  // Load plugin hooks into global hook registry
  for (const p of plugins) {
    if (!p.hooksConfig) continue
    const hooks = Array.isArray(p.hooksConfig) ? p.hooksConfig : [p.hooksConfig]
    for (const h of hooks as any[]) {
      if (h.name && h.event && h.type === 'command' && h.command) {
        globalHookRegistry.registerCommand(h.name, h.event, h.command, { toolFilter: h.toolFilter })
      } else if (h.name && h.event && h.type === 'http' && h.url) {
        globalHookRegistry.registerHttp(h.name, h.event, h.url, { toolFilter: h.toolFilter })
      }
    }
  }

  // Hooks: load from config file
  // Hooks: load from global + project-local
  let hookCount = globalHookRegistry.loadFromConfig(join(globalConfigPath(), 'hooks.json'))
  hookCount += globalHookRegistry.loadFromConfig(join(projectLocalDir, 'hooks.json'))
  if (hookCount > 0) console.log(`[Hook] Loaded ${hookCount} hooks from config`)

  // MCP Server mode: expose our tools to Claude Desktop
  const mcpServer = new McpServer(registry)
  mcpServer.start()

  // MCP: connect to configured MCP servers and register their tools
  mcpManager = new McpManager(globalConfigPath())
  mcpManager.connectAll().then(async () => {
    // Also connect plugin MCP servers
    const pluginMcpConfigs = getPluginMcpConfigs(plugins)
    for (const cfg of pluginMcpConfigs) {
      await mcpManager!.connect(cfg).catch((e) => console.error(`[MCP] Plugin server ${cfg.name} error:`, e))
    }
    if (pluginMcpConfigs.length > 0) {
      console.log(`[MCP] Connected ${pluginMcpConfigs.length} plugin MCP servers`)
    }

    const mcpTools = mcpManager!.createToolAdapters()
    for (const tool of mcpTools) {
      registry.register(tool)
    }
    if (mcpTools.length > 0) {
      console.log(`[MCP] Registered ${mcpTools.length} tools from MCP servers`)
    }
  }).catch((e) => console.error('[MCP] Connection error:', e))

  const agentConfig = loadConfig(globalConfigPath())
  agent = new Agent({ llm: createLLMProvider(agentConfig), tools: registry, basePath, assetsPath, skipPermissions: agentConfig.skipToolPermissions, capabilities, agentRole: 'chat', iterationLimit: agentConfig.agentDepthLimit, drainNotificationsInLoop: true, bridgeRequest: routeRequest, getConfigValue: sharedGetConfigValue, domainWorkflowHooks: financeWorkflowHooks })
  agent.pluginSkillPaths = getPluginSkillPaths(plugins)
  agent.pluginCommandPaths = getPluginCommandPaths(plugins)
  agent.session.searchIndex = sessionIndex

  // Data layer: local market data store + fetch queue + scheduler
  const dataStore = new DataStore(basePath)
  dataStoreInstance = dataStore
  const fetchQueue = new FetchQueue(dataStore)
  fetchQueueInstance = fetchQueue
  dataStoreTool.setDataStore(dataStore)
  dataStoreTool.setFetchQueue(fetchQueue)
  const fetchScheduler = new FetchScheduler(dataStore, fetchQueue, basePath)
  fetchQueue.onProgress((task) => {
    console.log(`[Data] Task #${task.id} [${task.status}] ${task.taskType} ${task.code ?? ''} ${task.progress?.message ?? ''}`)
    // Sync task result back to feed config
    if (task.status === 'done' || task.status === 'failed') {
      const feedId = typeof task.params._feedId === 'string' ? task.params._feedId : task.taskType
      const config = dataStore.getFeedConfig(feedId)
      if (config) {
        syncFeedStatusFromTaskRun(dataStore, feedId, task)
      }
    }
  })
  // Start after async init completes
  dataStore.init().then(() => {
    globalApiStats.setSink((entry) => dataStore.saveApiCall({
      source: entry.source,
      tool: entry.tool ?? null,
      action: entry.action ?? null,
      endpoint: entry.url,
      status: entry.status,
      success: entry.success,
      duration_ms: entry.durationMs,
      error: entry.error ?? null,
      created_at: entry.timestamp,
    }))
    dataStore.cleanupApiReuseData({ quoteRetentionDays: 30, apiLogRetentionDays: 90 })
    if (isWorkflowBackgroundDisabled()) {
      console.log('[DataStore] initialized, fetch scheduler not started for isolated workflow test, isReady:', dataStore.isReady)
    } else {
      fetchScheduler.start()
      setTimeout(() => goalAutomationService?.evaluateTriggers('startup'), 5_000)
      console.log('[DataStore] initialized, scheduler started, isReady:', dataStore.isReady)
    }
  }).catch((e) => {
    console.error('[DataStore] init failed:', e)
    console.error('[DataStore] basePath:', basePath)
    console.error('[DataStore] migrations path:', join(basePath, 'data', 'migrations'))
  })

  agentTool.setParentAgent(agent)
  sendMessageTool.setParentAgent(agent)
  taskStopTool.setParentAgent(agent)
  teamDeleteTool.setParentAgent(agent)
  setAgentFactory({
    createLLM: () => createLLMProvider(),
    getToolRegistry: () => registry,
    basePath,
    assetsPath,
    bridgeRequest: routeRequest,
    getConfigValue: sharedGetConfigValue,
  })

  multimodalAgent.setConfig({
    findLLMForModality: (modality) => {
      const cfg = loadConfig(globalConfigPath())
      const modelCfg = findModelByCapability(cfg, modality)
      if (!modelCfg) return null
      return createLLMFromModelConfig(modelCfg)
    },
    getAgentTools: () => registry.toOpenAI().filter((t) =>
      ['Read', 'Write', 'Edit', 'LS', 'Glob', 'Grep', 'Bash'].includes(t.function.name)
    ),
    executeTool: async (name, input, ctx) => {
      const tool = registry.get(name)
      if (!tool) throw new Error(`Unknown tool '${name}'`)
      return await tool.call(`mm-${Date.now()}`, input, ctx)
    },
  })

  eventAgent = new Agent({
    llm: createLLMProvider(agentConfig),
    tools: registry,
    basePath,
    sessionBasePath: join(basePath, 'event-agent'),
    assetsPath,
    skipPermissions: agentConfig.skipToolPermissions,
    capabilities,
    agentRole: 'event',
    iterationLimit: agentConfig.agentDepthLimit,
    drainNotificationsInLoop: false,
    bridgeRequest: routeRequest,
    getConfigValue: sharedGetConfigValue,
    domainWorkflowHooks: financeWorkflowHooks,
  })

  goalAutomationService = new GoalAutomationService(basePath, {
    getEventAgent: () => eventAgent,
    getChatAgent: () => agent,
    getDataStore: () => dataStoreInstance,
  })
  if (isWorkflowBackgroundDisabled()) {
    console.log('[WorkflowAutomation] background schedulers disabled for isolated full-app workflow test')
    if (goalAutomationTimer) {
      clearInterval(goalAutomationTimer)
      goalAutomationTimer = null
    }
  } else {
    if (goalAutomationTimer) clearInterval(goalAutomationTimer)
    goalAutomationTimer = setInterval(() => {
      goalAutomationService?.evaluateTriggers('schedule')
    }, 60_000)

    // Start event agent auto-processing (pump): cron/monitor/watchlist notifications
    eventAgent.startAutoProcessing((ev) => {
      mainWindow?.webContents.send('event-agent:event', ev)
    })

    cronScheduler.setFireHandler(async (job) => {
      if (!eventAgent) return
      eventAgent.notifications.enqueue('cron', job.prompt, 'now')
    })
    cronScheduler.start()

    // Start watchlist auto-refresh (60s interval, market-aware)
    watchlistRefresher.chatQueue = agent!.notifications
    watchlistRefresher.eventQueue = eventAgent!.notifications
    watchlistRefresher.start()

    // Start monitor scheduler (JS execution engine)
    monitorScheduler.onAlert = (monitorId, message) => {
      mainWindow?.webContents.send('event-agent:event', { type: 'text-delta', text: `[Monitor Alert] ${message}\n` })
    }
    monitorScheduler.onAgentMessage = (monitorId, monitorName, message, data) => {
      eventAgent?.enqueueUserInput(mainCopy().monitorNotification(monitorName, message, data))
    }
    monitorScheduler.start()
  }

  // Wire data task engine notifications
  dataTaskEngine.notificationQueue = agent!.notifications

  bridge = new AgentBridge(basePath)
  bridge.setRouter(routeRequest)
  bridge.setNotifyHandler((msg) => {
    mainWindow?.webContents.send('event-agent:event', { type: 'text-delta', text: `[Notification] ${msg}\n` })
  })
  bridge.setAgentMessageHandler((msg, source, data) => {
    if (!eventAgent) {
      console.warn('[DashboardBridge] event agent unavailable', { source, message: msg.slice(0, 120) })
      return { error: 'Event agent not initialized' }
    }
    const payload = data && Object.keys(data).length > 0
      ? `\ndata: ${JSON.stringify(data, null, 2)}`
      : ''
    const prompt = mainCopy().dashboardNotification(source, msg, payload)
    const id = eventAgent.notifications.enqueue('dashboard', prompt, 'now')
    console.log('[DashboardBridge] enqueue', {
      source,
      notificationId: id,
      throttled: !id,
      message: msg.slice(0, 120),
      dataKeys: Object.keys(data ?? {}),
    })
    if (id) {
      console.log('[DashboardBridge] delivered-to-event-agent', {
        source,
        notificationId: id,
        eventSessionId: eventAgent.session.id,
        eventSessionBasePath: join(basePath, 'event-agent'),
      })
    }
    mainWindow?.webContents.send('event-agent:event', {
      type: 'text-delta',
      text: id
        ? mainCopy().dashboardQueued(source, msg)
        : mainCopy().dashboardThrottled(source, msg),
    })
    if (!id) return { error: 'Dashboard message throttled; retry after a few seconds', queued: false }
    return { ok: true, queued: true, notificationId: id }
  })

  const workflowControl = new WorkflowAutomationControl({
    getAgent: () => agent,
    getBasePath: () => basePath,
    getPanelState: async () => workflowPanelStateQuery ? await workflowPanelStateQuery() : [],
    emitAgentEvent: (event) => {
      mainWindow?.webContents.send('agent:event', event)
    },
    answerUserQuestion: async (answer, options) => {
      const eventMessageStart = eventAgent?.messages.length ?? 0
      const waitTimeoutMs = Math.max(500, Math.min(120_000, Math.floor(options?.timeoutMs ?? 30_000)))
      askUserQuestionTool.respondToQuestion(answer)
      const eventAgentWait = await waitForWorkflowEventAgentCheckpoint(
        eventAgent,
        waitTimeoutMs,
        () => Boolean(askUserQuestionTool.getPendingQuestion()),
      )
      return {
        eventAgent: workflowEventAgentEvidence(eventAgent, eventMessageStart, []),
        eventAgentWait,
        pendingUserQuestion: askUserQuestionTool.getPendingQuestion(),
        eventQueueLength: eventAgent?.notifications.length ?? null,
      }
    },
    getPendingUserQuestion: () => askUserQuestionTool.getPendingQuestion(),
    triggerMonitor: async (monitorId, options) => {
      const monitor = monitorStore.get(monitorId)
      if (!monitor) {
        return {
          ok: false,
          error: 'monitor not found',
          monitorId,
          available: monitorStore.list.map((item) => ({
            id: item.id,
            name: item.name,
            strategyId: item.strategyId,
          })),
        }
      }
      const capturedMessages: Array<{
        monitorId: string
        monitorName: string
        message: string
        data: Record<string, unknown>
      }> = []
      const eventMessageStart = eventAgent?.messages.length ?? 0
      const eventEvents: Array<Record<string, unknown>> = []
      const shouldDrainEventAgent = isWorkflowBackgroundDisabled() && Boolean(eventAgent)
      if (shouldDrainEventAgent && eventAgent) {
        eventAgent.notifications.accepting = true
        eventAgent.startAutoProcessing((ev) => {
          eventEvents.push(ev as Record<string, unknown>)
          mainWindow?.webContents.send('event-agent:event', ev)
        })
      }
      const original = monitorScheduler.onAgentMessage
      monitorScheduler.onAgentMessage = (id, name, message, data) => {
        capturedMessages.push({ monitorId: id, monitorName: name, message, data })
        if (original) {
          original(id, name, message, data)
        } else {
          eventAgent?.enqueueUserInput(mainCopy().monitorNotification(name, message, data))
        }
      }
      const waitTimeoutMs = Math.max(1_000, Math.min(120_000, Math.floor(options?.timeoutMs ?? 30_000)))
      let eventAgentWait: Record<string, unknown> | null = null
      try {
        const updated = await monitorScheduler.runOnce(monitorId)
        if (shouldDrainEventAgent && capturedMessages.length > 0) {
          eventAgentWait = await waitForWorkflowEventAgentCheckpoint(
            eventAgent,
            waitTimeoutMs,
            () => Boolean(askUserQuestionTool.getPendingQuestion()),
          )
        }
        return {
          ok: true,
          monitorId,
          monitorName: monitor.name,
          strategyId: monitor.strategyId,
          result: updated?.lastResult ?? null,
          lastError: updated?.lastError ?? null,
          agentMessages: capturedMessages,
          agentMessageCount: capturedMessages.length,
          eventAgent: workflowEventAgentEvidence(eventAgent, eventMessageStart, eventEvents),
          eventAgentWait,
          pendingUserQuestion: askUserQuestionTool.getPendingQuestion(),
          eventQueueLength: eventAgent?.notifications.length ?? null,
        }
      } catch (error) {
        return {
          ok: false,
          monitorId,
          monitorName: monitor.name,
          strategyId: monitor.strategyId,
          error: error instanceof Error ? error.message : String(error),
          agentMessages: capturedMessages,
          agentMessageCount: capturedMessages.length,
          eventAgent: workflowEventAgentEvidence(eventAgent, eventMessageStart, eventEvents),
          eventAgentWait,
          pendingUserQuestion: askUserQuestionTool.getPendingQuestion(),
          eventQueueLength: eventAgent?.notifications.length ?? null,
        }
      } finally {
        monitorScheduler.onAgentMessage = original
        if (shouldDrainEventAgent && eventAgent) {
          eventAgent.stopAutoProcessing()
          eventAgent.notifications.accepting = false
        }
      }
    },
    captureUiArtifact: async (runId) => {
      if (!mainWindow || mainWindow.isDestroyed()) return null
      const dir = join(basePath, 'data', 'workflow-automation', 'screenshots')
      mkdirSync(dir, { recursive: true })
      const image = await mainWindow.webContents.capturePage()
      const png = image.toPNG()
      const path = join(dir, `${runId}.png`)
      writeFileSync(path, png)
      return {
        kind: 'main-window-screenshot',
        path,
        bytes: png.length,
        capturedAt: new Date().toISOString(),
      }
    },
  })
  startWorkflowAutomationServer(workflowControl)
    .then((server) => {
      workflowAutomationServer = server
      if (server) console.log(`[WorkflowAutomation] local control host listening on http://127.0.0.1:${server.port}`)
    })
    .catch((error) => console.error('[WorkflowAutomation] failed to start local control host:', error))
}

function syncFeedStatusFromTaskRun(dataStore: DataStore, feedId: string, task: FetchTask): void {
  const feedRunId = typeof task.params._feedRunId === 'string' ? task.params._feedRunId : null
  if (!feedRunId) {
    dataStore.updateFeedConfig(feedId, {
      status: task.status === 'done' ? 'idle' : 'error',
      last_error: task.status === 'failed' ? (task.error ?? 'Unknown error') : null,
    })
    return
  }

  const rows = dataStore.query<Record<string, unknown>>(
    "SELECT id,status,error,code,task_type FROM fetch_tasks WHERE params LIKE ? ORDER BY id ASC",
    `%"_feedRunId":"${feedRunId}"%`,
  )
  const active = rows.some((row) => row.status === 'pending' || row.status === 'running')
  if (active) return

  const latestByCode = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = `${String(row.task_type ?? '')}:${String(row.code ?? '')}`
    latestByCode.set(key, row)
  }
  const finalRows = Array.from(latestByCode.values())
  const failed = finalRows.filter(isActionableFeedTaskFailure)
  dataStore.updateFeedConfig(feedId, {
    status: failed.length > 0 ? 'error' : 'idle',
    last_error: failed.length > 0
      ? String(failed.find((row) => row.error)?.error ?? 'One or more feed tasks failed')
      : null,
  })
}


app.whenReady().then(async () => {
  initAgent()
  wireIPC({
    getAgent: () => agent,
    getEventAgent: () => eventAgent,
    getBridge: () => bridge,
    getMcpManager: () => mcpManager,
    getPlugins: () => plugins,
    getBasePath: () => basePath,
    globalConfigPath,
    createLLMProvider,
    getDataStore: () => dataStoreInstance,
    getFetchQueue: () => fetchQueueInstance,
    getGoalAutomation: () => goalAutomationService,
  })
  mainWindow = createWindow()

  // Register this session for multi-instance detection
  registerSession(basePath)
  startAppServices(basePath, () => dataStoreInstance)
  reOpenWindowIfNeeded(() => (mainWindow = createWindow()))
})

app.on('window-all-closed', () => {
  if (goalAutomationTimer) {
    clearInterval(goalAutomationTimer)
    goalAutomationTimer = null
  }
  workflowAutomationServer?.close().catch((error) => console.error('[WorkflowAutomation] close failed:', error))
  mcpManager?.disconnectAll()
  stopSidecar()
  app.quit()
})
