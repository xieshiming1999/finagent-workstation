import { join } from 'path'
import { ContentAdapter } from './content-adapter'
import { IterationBudget } from './iteration-budget'
import { PromptBuilder } from './prompt-builder'
import { Session } from './session'
import { PermissionManager } from './permission-manager'
import { GoalManager } from './goal-manager'
import { createGoalJudge } from './goal-judge'
import { PromptStash } from './prompt-stash'
import { GitSnapshot } from './git-snapshot'
import type { ToolContext, ToolRegistry, BridgeRequestHandler } from './tool'
import type { LLMProvider } from './llm-provider'
import { resolveAgentModePolicy, type AgentModePolicy } from './agent-mode-policy'
import { ensureRuntimeMemoryScaffold } from './runtime-memory-scaffold'

export function createAgentCoreSetup(config: {
  llm: LLMProvider
  tools: ToolRegistry
  basePath: string
  sessionBasePath?: string
  workDir?: string
  assetsPath?: string
  agentRole?: string
  modePolicy?: Partial<AgentModePolicy>
  iterationLimit?: number
  capabilities?: { vision?: boolean; audio?: boolean }
  systemPrompt?: string
  skipPermissions?: boolean
  drainNotificationsInLoop?: boolean
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}) {
  ensureRuntimeMemoryScaffold(config.basePath, config.agentRole ?? 'chat')
  const workDir = config.workDir ?? process.cwd()
  const assetsPath = config.assetsPath ?? config.basePath
  const capabilities = {
    vision: config.capabilities?.vision ?? false,
    audio: config.capabilities?.audio ?? false,
  }
  const contentAdapter = new ContentAdapter({
    tmpDir: join(config.basePath, 'tmp', 'images'),
    isVisionCapable: () => capabilities.vision,
  })
  const modePolicy = resolveAgentModePolicy({
    agentRole: config.agentRole,
    drainNotificationsInLoop: config.drainNotificationsInLoop,
    modePolicy: config.modePolicy,
  })
  const promptBuilder = config.assetsPath
    ? new PromptBuilder(config.basePath, config.assetsPath, config.agentRole ?? 'chat')
    : null
  const session = new Session(config.sessionBasePath ?? config.basePath)
  const permissionManager = new PermissionManager(config.basePath)
  const goalManager = new GoalManager(config.basePath)
  const goalJudge = createGoalJudge(config.llm)
  const promptStash = new PromptStash(config.basePath)
  const snapshot = new GitSnapshot(config.basePath, workDir)
  const gitSnapshot = snapshot.isGitRepo() ? snapshot : null

  return {
    workDir,
    assetsPath,
    overridePrompt: config.systemPrompt ?? null,
    skipPermissions: config.skipPermissions ?? false,
    iterationLimit: config.iterationLimit ?? 100,
    modePolicy,
    drainNotificationsInLoop: modePolicy.drainNotificationsInLoop,
    bridgeRequest: config.bridgeRequest,
    getConfigValue: config.getConfigValue,
    budget: new IterationBudget(config.iterationLimit ?? 100),
    capabilities,
    contentAdapter,
    promptBuilder,
    session,
    permissionManager,
    goalManager,
    goalJudge,
    promptStash,
    gitSnapshot,
  }
}

export function buildSystemPrompt(
  overridePrompt: string | null,
  promptBuilder: PromptBuilder | null,
  pluginSkillPaths: string[],
  tools: ToolRegistry,
  defaultPrompt: () => string,
): string {
  if (overridePrompt) return overridePrompt
  if (promptBuilder) {
    promptBuilder.pluginSkillPaths = pluginSkillPaths
    return promptBuilder.build(tools.list())
  }
  return defaultPrompt()
}

export function buildAgentToolContext(args: {
  basePath: string
  workDir: string
  pluginSkillPaths: string[]
  skipPermissions: boolean
  approvedTools: Set<string>
  readFileTimestamps: Map<string, number>
  taskRegistry: unknown
  teamRegistry: unknown
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}): ToolContext {
  return {
    basePath: args.basePath,
    workDir: args.workDir,
    memoryDir: join(args.basePath, 'memory'),
    bundleDir: join(args.basePath, 'bundle'),
    projectLocalDir: join(args.workDir, '.finagent-workstation'),
    pluginSkillPaths: args.pluginSkillPaths,
    skipPermissions: args.skipPermissions,
    approvedTools: args.approvedTools,
    planMode: false,
    readFileTimestamps: args.readFileTimestamps,
    taskRegistry: args.taskRegistry as ToolContext['taskRegistry'],
    teamRegistry: args.teamRegistry as ToolContext['teamRegistry'],
    bridgeRequest: args.bridgeRequest,
    getConfigValue: args.getConfigValue,
  }
}
