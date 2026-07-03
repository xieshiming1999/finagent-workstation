import type { LLMProvider } from './llm-provider'
import type { Message } from './message'
import { getInvokedSkills } from './tools/skill'
import type { BridgeRequestHandler } from './tool'
import { ToolRegistry } from './tool'
import { FileReadTool } from './tools/file-read'
import { FileWriteTool } from './tools/file-write'
import { FileEditTool } from './tools/file-edit'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'

export interface SkillImprovementState {
  lastRunTurn: number
  inProgress: boolean
}

export function createSkillImprovementState(): SkillImprovementState {
  return { lastRunTurn: 0, inProgress: false }
}

const MIN_TURNS_BETWEEN_RUNS = 20

/**
 * Check whether skill improvement should run.
 * Conditions: skills were invoked, enough turns passed, not already running.
 */
export async function maybeRunSkillImprovement(opts: {
  llm: LLMProvider
  basePath: string
  assetsPath: string
  sessionId: string
  messages: Message[]
  readFileTimestamps: Map<string, number>
  pluginSkillPaths: string[]
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
  state: SkillImprovementState
  userTurnCount: number
}): Promise<void> {
  const { llm, basePath, assetsPath, sessionId, messages, state, userTurnCount } = opts
  if (state.inProgress) return
  if (userTurnCount - state.lastRunTurn < MIN_TURNS_BETWEEN_RUNS) return

  const invoked = getInvokedSkills()
  if (invoked.size === 0) return

  state.inProgress = true
  state.lastRunTurn = userTurnCount

  try {
    for (const skillName of invoked) {
      const skillPath = join(basePath, 'memory', 'skills', skillName, 'skill.md')
      const bundlePath = join(basePath, 'bundle', 'skills', skillName, 'skill.md')
      const path = existsSync(skillPath) ? skillPath : existsSync(bundlePath) ? bundlePath : null
      if (!path) continue

      const content = readFileSync(path, 'utf-8')
      if (content.length < 100) continue

      const memorySkillPath = join(basePath, 'memory', 'skills', skillName, 'skill.md')
      const previousMemoryContent = existsSync(memorySkillPath) ? readFileSync(memorySkillPath, 'utf-8') : null
      const result = await runSkillImprovementAgent({
        llm,
        basePath,
        assetsPath,
        sessionId,
        messages,
        skillName,
        skillPath: path,
        memorySkillPath,
        skillContent: content,
        readFileTimestamps: opts.readFileTimestamps,
        pluginSkillPaths: opts.pluginSkillPaths,
        bridgeRequest: opts.bridgeRequest,
        getConfigValue: opts.getConfigValue,
      })
      console.log(`[SkillImprovement] ${skillName}: ${truncate(result, 160)}`)
      const changed = result.trim() !== '' && !result.includes('NO_CHANGES_NEEDED') && existsSync(memorySkillPath)
      const validation = changed
        ? validateSkillImprovementContent({ skillName, content: readFileSync(memorySkillPath, 'utf-8') })
        : null
      if (validation) {
        if (previousMemoryContent != null) {
          writeFileSync(memorySkillPath, previousMemoryContent, 'utf-8')
        } else {
          rmSync(memorySkillPath, { force: true })
        }
        console.warn(`[SkillImprovement] ${skillName}: reverted unsafe skill override: ${validation}`)
        continue
      }
      maybeWriteSkillGovernanceRecord({
        skillName,
        sourceSkillPath: path,
        memorySkillPath,
        resultSummary: result,
      })
    }
  } catch (e) {
    console.error('[SkillImprovement] Error:', e)
  } finally {
    state.inProgress = false
  }
}

async function runSkillImprovementAgent(opts: {
  llm: LLMProvider
  basePath: string
  assetsPath: string
  sessionId: string
  messages: Message[]
  skillName: string
  skillPath: string
  memorySkillPath: string
  skillContent: string
  readFileTimestamps: Map<string, number>
  pluginSkillPaths: string[]
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}): Promise<string> {
  const { Agent } = await import('./agent')
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new FileWriteTool())
  tools.register(new FileEditTool())

  const subAgent = new Agent({
    llm: opts.llm.clone(),
    tools,
    basePath: opts.basePath,
    assetsPath: opts.assetsPath,
    sessionBasePath: join(opts.basePath, 'sessions', opts.sessionId || 'unknown', 'skill_improvement', opts.skillName),
    skipPermissions: true,
    iterationLimit: 5,
    systemPrompt: [
      'You are a skill improvement sidechain agent.',
      'You may only use Read, Write, and Edit.',
      'Only write to the target memory skill path when the recent conversation clearly supports an improvement.',
      'If no change is needed, do not write files and respond with NO_CHANGES_NEEDED.',
    ].join('\n'),
    bridgeRequest: opts.bridgeRequest,
    getConfigValue: opts.getConfigValue,
  })
  subAgent.pluginSkillPaths = opts.pluginSkillPaths
  subAgent.messages = opts.messages.map((m) => ({
    ...m,
    toolUses: m.toolUses?.map((tu) => ({ ...tu, input: { ...tu.input } })),
    toolResult: m.toolResult ? { ...m.toolResult } : undefined,
  }))
  for (const [path, ts] of opts.readFileTimestamps) {
    ;(subAgent as any).readFileTimestamps?.set?.(path, ts)
  }

  const prompt = buildSkillImprovementPrompt(
    opts.skillName,
    opts.skillContent,
    opts.messages,
    opts.skillPath,
    opts.memorySkillPath,
  )
  return subAgent.runToCompletion(prompt)
}

function buildSkillImprovementPrompt(
  skillName: string,
  content: string,
  messages: Message[],
  sourceSkillPath: string,
  memorySkillPath: string,
): string {
  const recentMessages = messages.length > 20 ? messages.slice(messages.length - 20) : messages
  const conversationSummary = recentMessages.map((m) => {
    const role = m.role.toUpperCase()
    if (m.toolUses?.length) {
      const tools = m.toolUses.map((t) => t.name).join(', ')
      return `${role}: [tools: ${tools}] ${truncate(m.content, 200)}`
    }
    if (m.toolResult) {
      return `${role}: [result: ${truncate(m.toolResult.content, 100)}]`
    }
    return `${role}: ${truncate(m.content, 300)}`
  }).join('\n')

  return `Analyze this skill definition against the recent conversation.
Identify concrete improvements: user corrections, missing steps, better defaults, or outdated instructions.

## Current skill: ${skillName}

Source path: ${sourceSkillPath}
Writable memory override path: ${memorySkillPath}

${content}

## Recent conversation

${conversationSummary}

## Instructions

If the skill needs improvement:
1. Produce a complete updated skill.md including frontmatter.
2. Use Write to save that complete content to the writable memory override path.
3. Then respond with a short summary of the change and the path written.

If no changes are needed, do not write files and respond with exactly: NO_CHANGES_NEEDED

Only make changes that are clearly supported by the conversation evidence.
Do not add speculative improvements. Preserve the overall structure and frontmatter format.

Finance skill guardrails:
- Record stable workflow guidance only; never convert one market observation into current investment advice.
- Keep provider/source freshness, quota limits, and local-first reuse explicit.
- If the improvement depends on a market/API condition, phrase it as a verification step, not as a permanent fact.`
}

export function maybeWriteSkillGovernanceRecord(opts: {
  skillName: string
  sourceSkillPath: string
  memorySkillPath: string
  resultSummary: string
  now?: number
}): boolean {
  if (!opts.resultSummary.trim() || opts.resultSummary.includes('NO_CHANGES_NEEDED')) return false
  if (!existsSync(opts.memorySkillPath)) return false
  const record = {
    version: 1,
    lifecycle: 'procedural',
    skillName: opts.skillName,
    updatedAt: new Date(opts.now ?? Date.now()).toISOString(),
    sourceSkillPath: opts.sourceSkillPath,
    memorySkillPath: opts.memorySkillPath,
    reason: truncate(opts.resultSummary.trim(), 500),
    promotion: {
      source: 'skill_improvement',
      evidenceRequired: true,
      stableWorkflowOnly: true,
    },
    financeFreshness: {
      marketObservationPolicy: 'verification-step-only',
      requiresSourceAndAsOf: true,
      forbidsCurrentAdviceClaims: true,
    },
    guardrails: [
      'Conversation evidence required.',
      'Finance market observations must remain verification steps, not permanent current facts.',
      'Provider/source freshness and local-first reuse must stay explicit.',
    ],
    rollback: {
      deleteMemoryOverride: opts.memorySkillPath,
      sourceOfTruth: opts.sourceSkillPath,
    },
  }
  const path = join(dirname(opts.memorySkillPath), 'governance.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
  return true
}

export function validateSkillImprovementContent(opts: { skillName: string; content: string }): string | null {
  const content = opts.content.trim()
  if (!content.includes('---')) return 'skill content must include frontmatter'
  if (!isFinanceSkillName(opts.skillName)) return null
  const blocked = [
    /\b(buy|sell)\s+(now|today)\b/i,
    /\bcurrent\s+(price|nav|valuation)\s+is\b/i,
    /\b(guaranteed|certain)\s+(return|profit|rise|gain)\b/i,
    /\bwill\s+(rise|fall|gain|drop)\b/i,
  ]
  return blocked.some((pattern) => pattern.test(content))
    ? 'finance skills must phrase market conditions as verification steps, not permanent current advice'
    : null
}

function isFinanceSkillName(skillName: string): boolean {
  return /(fin|stock|fund|market|trade|trading|quote|kline|wind|tushare|eastmoney|yfinance)/i.test(skillName)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
