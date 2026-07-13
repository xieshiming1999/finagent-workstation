import type { AgentEvent } from './agent-event'
import type { LLMProvider } from './llm-provider'
import type { ToolRegistry, ToolContext, Tool, BridgeRequestHandler } from './tool'
import { Role, userMessage, assistantMessage, toolMessage } from './message'
import type { Message, ToolUse } from './message'
import { Session } from './session'
import { PromptBuilder } from './prompt-builder'
import { estimateMessageTokens } from './compact'
import { PostTurnHookRegistry, type HookContext } from './post-turn-hooks'
import { NotificationQueue } from './notification-queue'
import type { SessionMemoryState } from './session-memory'
import { ContentAdapter } from './content-adapter'
import { IterationBudget } from './iteration-budget'
import { TaskRegistry } from './background-task'
import { TeamRegistry } from './team-context'
import { parseSlashCommand } from './slash-command'
import { shouldGenerateRecap, generateRecap } from './recap'
import { onFileRead as magicDocsOnFileRead, createMagicDocsState, type MagicDocsState } from './magic-docs'
import { createSpeculationState, type SpeculationState } from './speculation'
import { FileReadTool } from './tools/file-read'
import { ToolGuardrailController } from './safety-guardrails'
import { StreamingContextScrubber } from './context-scrubber'
import { PermissionManager } from './permission-manager'
import { DefaultContextEngine, type ContextEngine } from './context-engine'
import { GitSnapshot } from './git-snapshot'
import { globalToolAvailabilityCache } from './tool-availability-cache'
import { GoalManager } from './goal-manager'
import { createGoalJudge } from './goal-judge'
import type { JudgeFn } from './goal-manager'
import { PromptStash } from './prompt-stash'
import type { ToolExecutionResult } from './agent-tool-execution'
import type { AgentModePolicy } from './agent-mode-policy'
import { buildAgentDefaultPrompt, providerHintForModel } from './agent-runtime-utils'
import { tryCompactAgentContext } from './agent-compaction'
import { runAgentLoop } from './agent-loop'
import { emptyDomainWorkflowHooks, type DomainWorkflowHooks } from './domain-workflow-hooks'
import { runAgentTurn, runPostTurnHooks as runPostTurnHooksHelper } from './agent-runner'
import { backgroundCurrentTask as backgroundCurrentTaskHelper } from './agent-background'
import { runBtw as runBtwHelper } from './agent-commands'
import { buildAgentToolContext, buildSystemPrompt, createAgentCoreSetup } from './agent-core'
import { buildDefaultPrompt, loadApprovedToolsFromDisk, saveApprovedToolsToDisk } from './agent-helpers'
import { executeSingleToolCall, permissionDecisionForTool, sanitizeStoredToolInputs as sanitizeStoredToolInputsHelper, trimAndBudgetImages, updateDoomLoopState } from './agent-turn-utils'
import { extractSessionMemoryAsync as extractSessionMemoryAsyncHelper, registerDefaultHooks as registerDefaultHooksHelper } from './agent-hooks'
import { appendTurnToHistory as appendTurnToHistoryHelper, clearSessionState, pushAndPersistMessage, restoreSessionState, scheduleRecapTimer } from './agent-session-lifecycle'
import { buildBackgroundDeps, cancelBackgroundAgent as cancelBackgroundAgentFlow, drainNotifications as drainNotificationsFlow, findAgentIdByName as findAgentIdByNameFlow, handleSlashCommand as handleSlashCommandFlow, pumpBackgroundQueue, registerBackgroundAgent as registerBackgroundAgentFlow, removeBackgroundAgent as removeBackgroundAgentFlow, sendMessageToAgent as sendMessageToAgentFlow, startAutoProcessing as startAutoProcessingFlow, stopAutoProcessing as stopAutoProcessingFlow } from './agent-orchestration'
import { join } from 'path'

export interface AgentConfig {
  llm: LLMProvider
  tools: ToolRegistry
  basePath: string
  sessionBasePath?: string
  workDir?: string
  assetsPath?: string
  systemPrompt?: string
  skipPermissions?: boolean
  capabilities?: { vision?: boolean; audio?: boolean }
  agentRole?: string
  modePolicy?: Partial<AgentModePolicy>
  /** Max recursive agent/tool iterations per user turn. 0 disables the cap. */
  iterationLimit?: number
  /** Per-session model override (changes LLM mid-session) */
  modelOverride?: string
  /** Drain queued notifications at each agent-loop entry. Chat agents use this; event agents use pump/batch intake instead. */
  drainNotificationsInLoop?: boolean
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
  domainWorkflowHooks?: DomainWorkflowHooks
}

export class Agent {
  llm: LLMProvider
  messages: Message[] = []
  lastPromptTokens = 0
  contextWindow = 128_000
  readonly session: Session
  readonly hooks = new PostTurnHookRegistry()
  readonly notifications = new NotificationQueue()
  private contextHints = new Map<string, string>()

  private tools: ToolRegistry
  private turnScopedTools: ToolRegistry | null = null
  private basePath: string
  private workDir: string
  private assetsPath: string
  private promptBuilder: PromptBuilder | null = null
  private overridePrompt: string | null = null
  private cancelled = false
  private running = false
  get isRunning(): boolean { return this.running }
  private approvedTools: Set<string> = new Set()
  private skipPermissions: boolean
  private iterationLimit: number
  private drainNotificationsInLoop: boolean
  private modePolicy: AgentModePolicy
  private bridgeRequest?: BridgeRequestHandler
  private getConfigValue?: (key: string) => unknown
  private domainWorkflowHooks: DomainWorkflowHooks
  private userTurnCount = 0
  private toolCallCount = 0
  private recentToolCalls: string[] = []
  private budget: IterationBudget
  private contentAdapter: ContentAdapter
  private capabilities: { vision: boolean; audio: boolean }
  pluginSkillPaths: string[] = []; pluginCommandPaths: string[] = []
  private turnStartTime = 0; private turnToolCallCount = 0
  private turnPromptTokens = 0; private turnCompletionTokens = 0
  private currentPrompt: string | null = null; private currentBackgroundTaskId: string | null = null
  private autoCompactFailures = 0
  private sessionMemoryState: SessionMemoryState = {
    lastSummarizedIndex: null,
    tokensAtLastExtraction: 0,
    initialized: false,
    extracting: false,
  }
  private maxTokensRecoveryCount = 0; private maxTokensRecoveryLimit = 3
  private contextExceededRetried = false
  private pendingConfirmResolve: ((result: { approved: boolean; alwaysAllow?: boolean; rejectReason?: string }) => void) | null = null
  private backgroundAgents = new Map<string, Agent>()
  private pumpActive = false
  private pumpEventSink: ((ev: AgentEvent) => void) | null = null
  private autoDreamState = { inProgress: false }; private skillImprovementState = { lastRunTurn: 0, inProgress: false }
  private housekeepingDone = false
  private magicDocsState: MagicDocsState = createMagicDocsState()
  private speculationState: SpeculationState = createSpeculationState()
  private pendingPostTurnEvents: AgentEvent[] = []
  private recapTimer: ReturnType<typeof setTimeout> | null = null
  onRecap: ((msg: Message) => void) | null = null
  private toolGuardrail = new ToolGuardrailController()
  private contextScrubber = new StreamingContextScrubber()
  readonly permissionManager: PermissionManager
  readonly contextEngine: ContextEngine = new DefaultContextEngine()
  readonly gitSnapshot: GitSnapshot | null = null
  readonly goalManager: GoalManager
  private goalJudge: JudgeFn
  readonly promptStash: PromptStash

  constructor(config: AgentConfig) {
    const core = createAgentCoreSetup(config)
    this.llm = config.llm
    this.tools = config.tools
    this.basePath = config.basePath
    this.workDir = core.workDir
    this.assetsPath = core.assetsPath
    this.overridePrompt = core.overridePrompt
    this.skipPermissions = core.skipPermissions
    this.iterationLimit = core.iterationLimit
    this.modePolicy = core.modePolicy
    this.drainNotificationsInLoop = core.drainNotificationsInLoop
    this.bridgeRequest = core.bridgeRequest
    this.getConfigValue = core.getConfigValue
    this.domainWorkflowHooks =
      config.domainWorkflowHooks ?? emptyDomainWorkflowHooks
    this.budget = core.budget
    this.capabilities = core.capabilities
    this.contentAdapter = core.contentAdapter
    this.promptBuilder = core.promptBuilder
    this.contextWindow = this.llm.contextWindow
    this.session = core.session
    this.restoreSession()
    this.loadApprovedTools()
    this.taskRegistry.configure(join(this.basePath, 'memory'))
    this.teamRegistry.configure(join(this.basePath, 'memory'))
    this.permissionManager = core.permissionManager
    this.goalManager = core.goalManager
    this.goalJudge = core.goalJudge
    this.promptStash = core.promptStash
    if (core.gitSnapshot) this.gitSnapshot = core.gitSnapshot

    this.registerDefaultHooks()

    // Wire magic docs: track MAGIC DOC patterns in file reads
    FileReadTool.onFileRead = (filePath, content) => {
      magicDocsOnFileRead(this.magicDocsState, filePath, content)
    }
  }

  setLLM(llm: LLMProvider): void {
    this.llm = llm
    this.contextWindow = llm.contextWindow
    this.goalJudge = createGoalJudge(this.llm)
    if (this.promptBuilder) {
      this.promptBuilder.providerHint = providerHintForModel(llm.model)
    }
  }

  private get systemPrompt(): string {
    const tools = this.activeTools()
    return buildSystemPrompt(
      this.overridePrompt,
      this.promptBuilder,
      this.pluginSkillPaths,
      tools,
      () => this.defaultPrompt(),
    )
  }

  private activeTools(): ToolRegistry {
    return this.turnScopedTools ?? this.tools
  }

  private readFileTimestamps = new Map<string, number>()
  readonly taskRegistry = new TaskRegistry()
  readonly teamRegistry = new TeamRegistry()

  private get toolContext(): ToolContext {
    return buildAgentToolContext({
      basePath: this.basePath,
      workDir: this.workDir,
      pluginSkillPaths: this.pluginSkillPaths,
      skipPermissions: this.skipPermissions,
      approvedTools: this.approvedTools,
      readFileTimestamps: this.readFileTimestamps,
      taskRegistry: this.taskRegistry,
      teamRegistry: this.teamRegistry,
      bridgeRequest: this.bridgeRequest,
      getConfigValue: this.getConfigValue,
    })
  }

  private turnMessageStartIndex = 0

  async *run(prompt: string, opts?: { images?: Array<{ data: string; mediaType?: string }>; disabledTools?: string[]; requirePermissions?: boolean }): AsyncGenerator<AgentEvent> {
    const previousTurnScopedTools = this.turnScopedTools
    const previousSkipPermissions = this.skipPermissions
    if (opts?.requirePermissions === true) this.skipPermissions = false
    this.turnScopedTools = opts?.disabledTools?.length
      ? this.tools.filtered({ disabledTools: opts.disabledTools })
      : null
    try {
      yield* runAgentTurn({
      isRunning: () => this.running,
      isCancelled: () => this.cancelled,
      setRunning: (value) => { this.running = value },
      setCancelled: (value) => { this.cancelled = value },
      setCurrentPrompt: (value) => { this.currentPrompt = value },
      setCurrentBackgroundTaskId: (value) => { this.currentBackgroundTaskId = value },
      incrementUserTurnCount: () => { this.userTurnCount++ },
      resetBudget: () => this.budget.reset(),
      resetContextScrubber: () => this.contextScrubber.reset(),
      resetToolGuardrail: () => this.toolGuardrail.reset(),
      clearRecentToolCalls: () => { this.recentToolCalls = [] },
      setDoomLoopWarningCount: (value) => { this.doomLoopWarningCount = value },
      setTurnStartTime: (value) => { this.turnStartTime = value },
      setTurnToolCallCount: (value) => { this.turnToolCallCount = value },
      setTurnPromptTokens: (value) => { this.turnPromptTokens = value },
      setTurnCompletionTokens: (value) => { this.turnCompletionTokens = value },
      setTurnMessageStartIndex: (value) => { this.turnMessageStartIndex = value },
      messages: this.messages,
      currentBackgroundTaskId: () => this.currentBackgroundTaskId,
      currentPrompt: () => this.currentPrompt,
      taskRegistryUpdateStatus: (taskId, status, payload) => this.taskRegistry.updateStatus(taskId, status as any, payload),
      scheduleRecap: () => this.scheduleRecap(),
      shouldPumpNotifications: () => this.pumpActive && this.notifications.isNotEmpty,
      pumpAsync: () => { if (this.pumpEventSink) this.pump(this.pumpEventSink).catch(() => {}) },
      handleSlashCommand: (name, args) => this.handleSlashCommand(name, args),
      parseSlashCommand,
      adaptAndPersistUserMessage: (turnPrompt, turnOpts) => {
        const images = turnOpts?.images?.map((img) => ({ type: 'image' as const, source: 'base64' as const, data: img.data, mediaType: img.mediaType }))
        const userMsg = userMessage(turnPrompt, images)
        const adapted = this.contentAdapter.adaptMessage(userMsg)
        this.messages.push(adapted)
        this.session.appendMessage(adapted)
      },
      agentLoop: () => this.agentLoop(),
      appendTurnToHistory: () => this.appendTurnToHistory(),
      runPostTurnHooks: () => this.runPostTurnHooks(),
      }, prompt, opts)
    } finally {
      this.turnScopedTools = previousTurnScopedTools
      this.skipPermissions = previousSkipPermissions
    }
  }

  clearSession(): void {
    if (this.messages.length > 3) this.extractSessionMemoryAsync(estimateMessageTokens(this.messages)).catch(() => {})
    clearSessionState(this.session, this.messages, {
      setMessages: (messages) => { this.messages = messages },
      setUserTurnCount: (value) => { this.userTurnCount = value },
      setToolCallCount: (value) => { this.toolCallCount = value },
      setDoomLoopWarningCount: (value) => { this.doomLoopWarningCount = value },
      setMaxTokensRecoveryCount: (value) => { this.maxTokensRecoveryCount = value },
      setContextExceededRetried: (value) => { this.contextExceededRetried = value },
      setSessionMemoryState: (value) => { this.sessionMemoryState = value },
    })
  }
  listHistory() { return this.session.listHistory() }
  listSessions() { return this.session.listSessions() }
  resumeSession(filePath: string): void { this.messages = this.session.resume(filePath).messages }
  preloadSession(filePath: string): void { this.messages = this.session.preload(filePath).messages }
  preloadCurrentSession(): void { this.messages = this.session.fork().messages }
  approveToolPermanently(toolName: string): void {
    this.approvedTools.add(toolName); this.permissionManager.approvePermanently(toolName); this.saveApprovedTools()
  }
  cancel(): void {
    this.cancelled = true
    const cancel = (this.llm as { cancel?: () => void }).cancel
    if (typeof cancel === 'function') cancel.call(this.llm)
  }
  enqueueUserInput(prompt: string): string { return this.notifications.enqueue('user_input', prompt, 'now') }
  addTool(tool: any): void { this.tools.register(tool) }

  findTool(name: string) { return this.tools.get(name) }
  registerBackgroundAgent(taskId: string, agent: Agent): void { registerBackgroundAgentFlow(this.backgroundDeps(), taskId, agent) }
  removeBackgroundAgent(taskId: string): void { removeBackgroundAgentFlow(this.backgroundDeps(), taskId) }
  cancelBackgroundAgent(taskId: string): void { cancelBackgroundAgentFlow(this.backgroundDeps(), taskId) }
  sendMessageToAgent(taskId: string, message: string): boolean { return sendMessageToAgentFlow(this.backgroundDeps(), taskId, message) }
  findAgentIdByName(name: string): string | null { return findAgentIdByNameFlow(this.backgroundDeps(), name) }
  startAutoProcessing(onEvent: (ev: AgentEvent) => void): void { startAutoProcessingFlow(this.backgroundDeps(), onEvent) }
  stopAutoProcessing(): void { stopAutoProcessingFlow(this.backgroundDeps()) }

  private async pump(onEvent: (ev: AgentEvent) => void): Promise<void> {
    await pumpBackgroundQueue(this.backgroundDeps(), onEvent)
  }

  addContextHint(type: string, content: string): void {
    this.contextHints.set(type, `[${new Date().toISOString().slice(11, 19)}] ${content}`)
  }

  addUIEvent(action: string, params: Record<string, unknown>): void {
    const paramsXml = Object.entries(params).map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')
    this.notifications.enqueue('ui', `<ui-event>\n<action>${action}</action>\n${paramsXml}\n</ui-event>`, 'next')
  }

  private drainContextHints(): string | null {
    if (this.contextHints.size === 0) return null
    const lines = Array.from(this.contextHints.values())
    this.contextHints.clear()
    return `[Context update]\n${lines.join('\n')}`
  }

  getModePolicy(): AgentModePolicy { return this.modePolicy }

  private appendTurnToHistory(): void {
    appendTurnToHistoryHelper(this.session, this.messages, this.turnMessageStartIndex, this.modePolicy.historySource)
  }

  private scheduleRecap(): void {
    if (!this.modePolicy.enableRecap) return
    scheduleRecapTimer({
      existingTimer: this.recapTimer,
      messages: this.messages,
      llm: this.llm,
      isRunning: () => this.running,
      pushAndPersist: (msg) => this.pushAndPersist(msg),
      onRecap: this.onRecap,
      setTimer: (timer) => { this.recapTimer = timer },
    })
  }

  private pushAndPersist(msg: Message): void { pushAndPersistMessage(this.messages, this.session, msg) }

  private async *handleSlashCommand(name: string, args: string): AsyncGenerator<AgentEvent> {
    const runningRef = {
      get value() { return thisAgent.running },
      set value(v: boolean) { thisAgent.running = v },
    }
    const thisAgent = this
    yield* handleSlashCommandFlow({
      name,
      argsText: args,
      basePath: this.basePath,
      projectLocalDir: this.toolContext.projectLocalDir,
      pluginCommandPaths: this.pluginCommandPaths,
      messages: this.messages,
      goalManager: this.goalManager,
      promptStash: this.promptStash,
      session: this.session,
      notifications: this.notifications,
      clearSession: () => this.clearSession(),
      resumeSession: (filePath) => this.resumeSession(filePath),
      runPostTurnHooks: () => this.runPostTurnHooks(),
      appendTurnToHistory: () => this.appendTurnToHistory(),
      pushAndPersist: (msg) => this.pushAndPersist(msg),
      agentLoop: () => this.agentLoop(),
      tryCompact: (customInstructions?: string) => this.tryCompact(customInstructions),
      runBtw: (question) => this.runBtw(question),
      setMessages: (messages) => { this.messages = messages },
      runningRef,
    })
  }

  async runToCompletion(prompt: string): Promise<string> {
    const buffer: string[] = []
    for await (const event of this.run(prompt)) {
      if (event.type === 'text-delta') buffer.push(event.text)
      if (event.type === 'error') throw new Error(event.message)
    }
    return buffer.join('')
  }

  private async runBtw(question: string): Promise<string> { return runBtwHelper(this.llm, this.messages, question) }

  backgroundCurrentTask(): string | null {
    return backgroundCurrentTaskHelper({
      taskRegistry: this.taskRegistry,
      sessionId: this.session.id,
      running: this.running,
      currentBackgroundTaskId: this.currentBackgroundTaskId,
      currentPrompt: this.currentPrompt,
      setCurrentBackgroundTaskId: (taskId) => { this.currentBackgroundTaskId = taskId },
    })
  }

  resolvePermission(result: { approved: boolean; alwaysAllow?: boolean; rejectReason?: string }): void {
    if (!this.pendingConfirmResolve) return
    this.pendingConfirmResolve(result)
    this.pendingConfirmResolve = null
  }

  private async *drainNotifications(): AsyncGenerator<AgentEvent> {
    yield* drainNotificationsFlow(this.notifications, (msg) => this.pushAndPersist(msg))
  }

  private backgroundDeps() {
    return buildBackgroundDeps({
      backgroundAgents: this.backgroundAgents,
      taskRegistry: this.taskRegistry,
      teamRegistry: this.teamRegistry,
      notifications: this.notifications,
      sessionId: this.session.id,
      runPrompt: (prompt: string) => this.run(prompt),
      pushAndPersist: (msg: Message) => this.pushAndPersist(msg),
      isRunning: () => this.running,
      isPumpActive: () => this.pumpActive,
      setPumpActive: (active: boolean) => { this.pumpActive = active },
      setPumpEventSink: (sink: ((ev: AgentEvent) => void) | null) => { this.pumpEventSink = sink },
      getPumpEventSink: () => this.pumpEventSink,
    })
  }

  private async *agentLoop(depth = 0): AsyncGenerator<AgentEvent> {
    yield* runAgentLoop({
      getCancelled: () => this.cancelled,
      iterationLimit: this.iterationLimit,
      budgetExhausted: () => this.budget.exhausted,
      budgetUsed: () => this.budget.used,
      notifications: this.notifications,
      shouldDrainNotificationsInLoop: this.drainNotificationsInLoop,
      drainNotifications: () => this.drainNotifications(),
      taskRegistry: this.taskRegistry,
      pushAndPersist: (msg) => this.pushAndPersist(msg),
      detectDoomLoop: () => this.detectDoomLoop(),
      recentToolCalls: this.recentToolCalls,
      tryCompact: () => this.tryCompact(),
      messages: this.messages,
      setMessages: (messages) => { this.messages = messages },
      drainContextHints: () => this.drainContextHints(),
      contextScrubber: this.contextScrubber,
      llm: this.llm,
      systemPrompt: this.systemPrompt,
      tools: this.activeTools(),
      contextWindow: this.contextWindow,
      setLastPromptTokens: (value) => { this.lastPromptTokens = value },
      setLastPromptMsgCount: (value) => { this.lastPromptMsgCount = value },
      addTurnPromptTokens: (value) => { this.turnPromptTokens += value },
      addTurnCompletionTokens: (value) => { this.turnCompletionTokens += value },
      recordGoalUsage: (promptTokens, completionTokens) => this.goalManager.recordTokenUsage(promptTokens, completionTokens),
      turnStartTime: this.turnStartTime,
      getTurnToolCallCount: () => this.turnToolCallCount,
      contextExceededRetried: this.contextExceededRetried,
      setContextExceededRetried: (value) => { this.contextExceededRetried = value },
      maxTokensRecoveryCount: this.maxTokensRecoveryCount,
      maxTokensRecoveryLimit: this.maxTokensRecoveryLimit,
      setMaxTokensRecoveryCount: (value) => { this.maxTokensRecoveryCount = value },
      toolContext: this.toolContext,
      permissionDecision: (tool, input) => this.permissionDecision(tool, input),
      waitForPermissionConfirmation: async () => await new Promise<{ approved: boolean; alwaysAllow?: boolean; rejectReason?: string }>((resolve) => {
        this.pendingConfirmResolve = resolve
      }),
      approveToolPermanently: (toolName) => this.approveToolPermanently(toolName),
      executeToolCall: (tc, tool, ctx) => this.executeToolCall(tc, tool, ctx),
      domainWorkflowHooks: this.domainWorkflowHooks,
    }, depth)
  }

  private async runPostTurnHooks(): Promise<AgentEvent[]> {
    if (!this.modePolicy.enablePostTurnHooks) return []
    return await runPostTurnHooksHelper(
      this.hooks,
      this.basePath,
      this.messages,
      this.userTurnCount,
      this.toolCallCount,
      this.pendingPostTurnEvents,
    )
  }

  private lastExtractMemoriesTime = 0

  private registerDefaultHooks(): void {
    registerDefaultHooksHelper({
      hooks: this.hooks,
      llm: this.llm,
      messages: this.messages,
      basePath: this.basePath,
      assetsPath: this.assetsPath,
      sessionId: this.session.id,
      readFileTimestamps: this.readFileTimestamps,
      pluginSkillPaths: this.pluginSkillPaths,
      bridgeRequest: this.bridgeRequest,
      getConfigValue: this.getConfigValue,
      autoDreamState: this.autoDreamState,
      skillImprovementState: this.skillImprovementState,
      housekeepingDone: this.housekeepingDone,
      setHousekeepingDone: (value) => { this.housekeepingDone = value },
      magicDocsState: this.magicDocsState,
      speculationState: this.speculationState,
      pendingPostTurnEvents: this.pendingPostTurnEvents,
      goalManager: this.goalManager,
      goalJudge: this.goalJudge,
      notifications: this.notifications,
      userTurnCount: this.userTurnCount,
      turnMessageStartIndex: this.turnMessageStartIndex,
      lastExtractMemoriesTime: this.lastExtractMemoriesTime,
      setLastExtractMemoriesTime: (value) => { this.lastExtractMemoriesTime = value },
      sessionMemoryState: this.sessionMemoryState,
      extractSessionMemoryAsync: (tokens) => this.extractSessionMemoryAsync(tokens),
      assistantRole: Role.Assistant,
    })
  }

  private async extractSessionMemoryAsync(tokens: number): Promise<void> {
    await extractSessionMemoryAsyncHelper({
      basePath: this.basePath,
      sessionId: this.session.id,
      messages: this.messages,
      llm: this.llm,
      sessionMemoryState: this.sessionMemoryState,
      userRole: Role.User,
    }, tokens)
  }

  private async executeToolCall(tc: ToolUse, tool: Tool, ctx: ToolContext): Promise<ToolExecutionResult> {
    return await executeSingleToolCall({
      tc,
      tool,
      ctx,
      basePath: this.basePath,
      budgetConsume: (toolName) => this.budget.consume(toolName),
      budgetRefund: (toolName) => this.budget.refund(toolName),
      recordRecentToolCall: (entry) => {
        this.recentToolCalls.push(entry)
        if (this.recentToolCalls.length > 20) this.recentToolCalls.shift()
      },
      incrementToolCallCount: () => { this.toolCallCount++ },
      incrementTurnToolCallCount: () => { this.turnToolCallCount++ },
      pushAndPersist: (msg) => this.pushAndPersist(msg),
      toolGuardrail: this.toolGuardrail,
    })
  }

  private permissionDecision(tool: Tool, input: Record<string, unknown>): 'allow' | 'deny' | 'ask' {
    return permissionDecisionForTool(this.skipPermissions, this.permissionManager, this.approvedTools, tool, input)
  }

  private doomLoopWarningCount = 0

  private detectDoomLoop(): 'warn' | 'stop' | false {
    const { result, warningCount } = updateDoomLoopState(this.recentToolCalls, this.doomLoopWarningCount)
    this.doomLoopWarningCount = warningCount
    return result
  }

  private lastPromptMsgCount = 0

  private async tryCompact(customInstructions?: string): Promise<{ compacted: boolean; preCount: number; postCount: number }> {
    return await tryCompactAgentContext({
      messages: this.messages,
      contextWindow: this.contextWindow,
      llm: this.llm,
      basePath: this.basePath,
      sessionId: this.session.id,
      readFileTimestamps: this.readFileTimestamps,
      sessionMemoryState: this.sessionMemoryState,
      lastPromptTokens: this.lastPromptTokens,
      lastPromptMsgCount: this.lastPromptMsgCount,
      autoCompactFailures: this.autoCompactFailures,
    }, {
      setMessages: (messages) => { this.messages = messages },
      setLastPromptTokens: (value) => { this.lastPromptTokens = value },
      setLastPromptMsgCount: (value) => { this.lastPromptMsgCount = value },
      setAutoCompactFailures: (value) => { this.autoCompactFailures = value },
      appendCompactBoundary: (summary, preCount) => this.session.appendCompactBoundary(summary, preCount),
    }, customInstructions)
  }

  private restoreSession(): void { restoreSessionState(this.session, (messages) => { this.messages = messages }) }
  private loadApprovedTools(): void { this.approvedTools = loadApprovedToolsFromDisk(this.basePath) }
  private saveApprovedTools(): void { saveApprovedToolsToDisk(this.basePath, this.approvedTools) }
  private defaultPrompt(): string { return buildAgentDefaultPrompt(this.tools, this.basePath) }
}
