import type { Tool, ToolContext } from '../tool'
import { requiresUserInteraction, toolError } from '../tool'
import type { BridgeRequestHandler } from '../tool'
import { Agent, type AgentConfig } from '../agent'
import type { LLMProvider } from '../llm-provider'
import { ToolRegistry } from '../tool'
import { join } from 'path'

const MAX_CONCURRENT = 5

let agentFactory: AgentFactoryConfig | null = null

export interface AgentFactoryConfig {
  createLLM: () => LLMProvider
  getToolRegistry: () => ToolRegistry
  basePath: string
  assetsPath: string
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}

export function setAgentFactory(config: AgentFactoryConfig) {
  agentFactory = config
}

// Tools that sub-agents CANNOT use (prevent recursive delegation).
const DELEGATE_BLOCKED_TOOLS = new Set([
  'Agent', 'SendMessage', 'TeamCreate', 'TeamList', 'TeamDelete', // no recursive delegation
  'TaskStop', // parent controls task lifecycle
])

export function canDelegateToolToSubAgent(tool: Tool): boolean {
  return !DELEGATE_BLOCKED_TOOLS.has(tool.name) && !requiresUserInteraction(tool)
}

export class AgentTool implements Tool {
  name = 'Agent'
  description = 'Launch a sub-agent to handle complex tasks. Sub-agents can run in foreground (sync) or background (async). Use fork mode to inherit conversation context, or independent mode for fresh context.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['help', 'run'], description: 'Use "help" to inspect sub-agent delegation rules before launching; omit or use "run" to launch.' },
      description: { type: 'string', description: 'A short (3-5 word) description of the task' },
      prompt: { type: 'string', description: 'The full task prompt for the sub-agent' },
      run_in_background: { type: 'boolean', description: 'Set to true to run in background (default false)' },
      isolation: { type: 'string', enum: ['fork', 'independent'], description: 'Context mode: "fork" (default) inherits context, "independent" starts fresh' },
      name: { type: 'string', description: 'Name for the agent. Makes it addressable via SendMessage.' },
      team_name: { type: 'string', description: 'Optional existing team name. Requires run_in_background=true and registers the agent as a team member.' },
    },
    required: ['description', 'prompt'],
  }

  private emitEvent: ((event: Record<string, unknown>) => void) | null = null
  private parentAgent: Agent | null = null

  setEventEmitter(fn: (event: Record<string, unknown>) => void) { this.emitEvent = fn }
  setParentAgent(agent: Agent) { this.parentAgent = agent }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    if (String(input.action ?? 'run') === 'help') return null
    if (!input.description || !String(input.description).trim()) return 'description is required.'
    if (!input.prompt || !String(input.prompt).trim()) return 'prompt is required.'

    const runInBackground = Boolean(input.run_in_background ?? false)
    if (runInBackground) {
      const running = this.parentAgent?.taskRegistry.runningCount ?? 0
      if (running >= MAX_CONCURRENT) {
        return `Cannot launch background agent: maximum concurrent limit (${MAX_CONCURRENT}) reached. Wait for running tasks to complete.`
      }
    }
    if (input.team_name && !runInBackground) {
      return 'team_name can only be used with run_in_background=true because team members are tracked by background task ID.'
    }
    return null
  }

  async call(id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (String(input.action ?? 'run') === 'help') return agentToolHelp()
    const description = String(input.description)
    const prompt = String(input.prompt)
    const runInBackground = Boolean(input.run_in_background ?? false)
    const isolation = String(input.isolation ?? 'fork')
    const teamName = input.team_name ? String(input.team_name).trim() : ''
    const memberName = input.name ? String(input.name).trim() : description

    if (!agentFactory) {
      return toolError('Agent factory not configured. Sub-agent execution unavailable.')
    }
    if (teamName) {
      try {
        ctx.teamRegistry.requireActiveTeam(teamName)
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err))
      }
    }

    if (!runInBackground) {
      const parentSessionId = this.parentAgent?.session.id ?? 'unknown'
      const sidechainPath = this.getSidechainBasePath(parentSessionId, `sync-${Date.now()}-${id}`)
      const subAgent = this.createSubAgent(ctx, isolation, sidechainPath)
      return await this.runSync(subAgent, prompt, description)
    }

    return this.runBackground(ctx, prompt, description, id, isolation, {
      teamName: teamName || undefined,
      memberName,
    })
  }

  private createSubAgent(ctx: ToolContext, isolation: string, sessionBasePath: string): Agent {
    if (!agentFactory) throw new Error('No agent factory')

    const llm = agentFactory.createLLM()
    const fullRegistry = agentFactory.getToolRegistry()

    // Filter out blocked tools from sub-agent (prevent recursion + user interaction)
    const filteredRegistry = new ToolRegistry()
    for (const tool of fullRegistry.list()) {
      if (canDelegateToolToSubAgent(tool)) {
        filteredRegistry.register(tool)
      }
    }

    const config: AgentConfig = {
      llm,
      tools: filteredRegistry,
      basePath: agentFactory.basePath,
      sessionBasePath,
      assetsPath: agentFactory.assetsPath,
      skipPermissions: true,
      agentRole: 'subagent',
      bridgeRequest: agentFactory.bridgeRequest,
      getConfigValue: agentFactory.getConfigValue,
    }

    const sub = new Agent(config)

    // Fork: copy parent messages
    if (isolation === 'fork' && this.parentAgent) {
      sub.messages = [...this.parentAgent.messages]
    }

    return sub
  }

  private getSidechainBasePath(parentSessionId: string, sidechainId: string): string {
    if (!agentFactory) throw new Error('No agent factory')
    const safeParent = safePathSegment(parentSessionId || 'unknown')
    const safeId = safePathSegment(sidechainId || `sub-${Date.now()}`)
    return join(agentFactory.basePath, 'sessions', safeParent, 'subagents', safeId)
  }

  private async runSync(subAgent: Agent, prompt: string, description: string): Promise<string> {
    try {
      const start = Date.now()
      const textParts: string[] = []
      let toolCount = 0

      const stream = subAgent.run(prompt)
      for await (const ev of stream) {
        if (ev.type === 'text-delta') {
          textParts.push((ev as any).text)
        } else if (ev.type === 'tool-use-start') {
          toolCount++
          this.emitEvent?.({ type: 'text-delta', text: `\n[sub-agent → ${(ev as any).name}]\n` })
        } else if (ev.type === 'error') {
          throw new Error((ev as any).message)
        }
      }

      const elapsed = Date.now() - start
      const timeStr = elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`
      const result = textParts.join('')

      return `Sub-agent completed in ${timeStr} (${toolCount} tool calls).\n\n${result}`
    } catch (err) {
      return toolError(`Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private runBackground(
    ctx: ToolContext,
    prompt: string,
    description: string,
    toolUseId: string,
    isolation: string,
    opts?: { teamName?: string; memberName?: string }
  ): string {
    if (!this.parentAgent) {
      return toolError('Agent tool is not configured: parent agent is unavailable for background registration.')
    }
    const task = this.parentAgent.taskRegistry.register({
      description,
      prompt,
      toolUseId,
      parentSessionId: this.parentAgent.session.id,
      isBackgrounded: true,
    })
    const taskId = task.id
    const sidechainPath = this.getSidechainBasePath(this.parentAgent.session.id, taskId)
    task.sidechainPath = sidechainPath
    this.parentAgent.taskRegistry.save()
    const subAgent = this.createSubAgent(ctx, isolation, sidechainPath)
    this.parentAgent.registerBackgroundAgent(taskId, subAgent)
    if (opts?.teamName) {
      this.parentAgent.teamRegistry.registerRunningMember(opts.teamName, {
        name: opts.memberName || description,
        role: description,
        description,
        prompt,
        taskId,
        status: 'pending',
      })
    }

    // Fire and forget
    ;(async () => {
      try {
        this.parentAgent!.taskRegistry.updateStatus(taskId, 'running')
        this.parentAgent!.teamRegistry.updateMemberStatusByTask(taskId, 'running')
        const textParts: string[] = []
        let toolUseCount = 0
        const stream = subAgent.run(prompt)
        for await (const ev of stream) {
          if (ev.type === 'text-delta') textParts.push((ev as any).text)
          if (ev.type === 'error') {
            throw new Error(String((ev as any).message ?? 'sub-agent failed'))
          }
          if (ev.type === 'tool-use-start') {
            toolUseCount++
            this.parentAgent!.taskRegistry.updateProgress(taskId, {
              toolUseCount,
              activity: `Tool: ${(ev as any).name ?? 'unknown'}`,
            })
          }
        }
        this.parentAgent!.taskRegistry.updateStatus(taskId, 'completed', { result: textParts.join('') })
        this.parentAgent!.teamRegistry.updateMemberStatusByTask(taskId, 'completed')
        this.parentAgent!.removeBackgroundAgent(taskId)

        this.emitEvent?.({
          type: 'text-delta',
          text: `\n[Background agent "${description}" completed (task: ${taskId})]\n`,
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        this.parentAgent?.taskRegistry.updateStatus(taskId, 'failed', { error })
        this.parentAgent?.teamRegistry.updateMemberStatusByTask(taskId, 'failed', error)
        this.parentAgent?.removeBackgroundAgent(taskId)

        this.emitEvent?.({
          type: 'text-delta',
          text: `\n[Background agent "${description}" failed: ${error}]\n`,
        })
      }
    })()

    const teamLine = opts?.teamName ? `\nTeam: ${opts.teamName}\nMember: ${opts.memberName || description}` : ''
    return `Background agent launched.\nTask ID: ${taskId}\nDescription: ${description}\nOwnership: parent-owned-background\nParent session: ${this.parentAgent.session.id}\nSidechain: ${sidechainPath}${teamLine}\n\nUse TaskOutput(task_id:"${taskId}", block:false) only for progress checks. If the current answer depends on this agent, call TaskOutput(task_id:"${taskId}", block:true) before concluding. Use TeamList(team_name:"${opts?.teamName ?? ''}") for team state, or TaskStop(task_id:"${taskId}") to cancel.`
  }
}

function agentToolHelp(): string {
  return JSON.stringify({
    tool: 'Agent',
    purpose: 'Launch a sub-agent for bounded, inspectable work that should be separated from the current turn.',
    actions: {
      help: 'Return this contract without launching a sub-agent.',
      run: 'Launch a sub-agent. This is the default when action is omitted.',
    },
    requiredForRun: ['description', 'prompt'],
    modes: {
      foreground: {
        input: { run_in_background: false },
        result: 'Waits for the sub-agent and returns the final text plus tool-call count.',
      },
      background: {
        input: { run_in_background: true },
        result: 'Returns a Task ID. Use TaskOutput(task_id, block:true) before relying on the result.',
        limit: MAX_CONCURRENT,
      },
      isolation: {
        fork: 'Inherits parent conversation context.',
        independent: 'Starts with fresh sub-agent context.',
      },
      team: 'Use team_name only with run_in_background=true after TeamCreate.',
    },
    constraints: [
      'Sub-agents cannot recursively launch Agent/Team tools.',
      'Sub-agents cannot use tools marked as requiring user interaction.',
      'If the current answer depends on a background sub-agent, inspect TaskOutput with block:true before finalizing.',
    ],
    errorFeedback: [
      'Missing description or prompt returns a validation error.',
      'Unknown team_name returns a tool error.',
      'Background concurrency over the limit returns a validation error.',
    ],
  }, null, 2)
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown'
}

export class SendMessageTool implements Tool {
  name = 'SendMessage'
  description = 'Send a message to a running background agent by task ID or name.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Target agent task ID or name' },
      message: { type: 'string', description: 'Message content' },
    },
    required: ['to', 'message'],
  }

  private parentAgent: Agent | null = null

  setParentAgent(agent: Agent) { this.parentAgent = agent }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.to || !String(input.to).trim()) return 'to is required.'
    if (!input.message || !String(input.message).trim()) return 'message is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    if (!this.parentAgent) {
      return toolError('SendMessage is not configured: parent agent is unavailable.')
    }

    const to = String(input.to).trim()
    const message = String(input.message).trim()

    if (to === 'main' || to === 'parent') {
      this.parentAgent.notifications.enqueue('send_message', `<teammate-message>\n${message}\n</teammate-message>`, 'now')
      return JSON.stringify({ ok: true, delivered: true, to, target: 'main' })
    }

    let delivered = this.parentAgent.sendMessageToAgent(to, message)
    let resolvedTaskId: string | null = delivered ? to : null

    if (!delivered) {
      resolvedTaskId = this.parentAgent.findAgentIdByName(to)
      if (resolvedTaskId) delivered = this.parentAgent.sendMessageToAgent(resolvedTaskId, message)
    }

    if (!delivered) {
      return toolError(`Agent "${to}" not found or not running. Use TeamList and TaskOutput to inspect background agents before sending.`)
    }
    if (resolvedTaskId) this.parentAgent.teamRegistry.markMemberMessaged(resolvedTaskId)

    return JSON.stringify({ ok: true, delivered: true, to, taskId: resolvedTaskId })
  }
}

export class TeamCreateTool implements Tool {
  name = 'TeamCreate'
  description = 'Create a named team of agents for collaborative multi-agent work.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Team name' },
      team_name: { type: 'string', description: 'Team name alias' },
      description: { type: 'string', description: 'Team purpose' },
      agents: {
        type: 'array',
        description: 'Optional planned members only. This does not launch agents; launch each with Agent(run_in_background:true, team_name).',
      },
    },
    required: [],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.name && !input.team_name) return 'name or team_name is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const name = String(input.name ?? input.team_name ?? '').trim()
    const description = input.description ? String(input.description) : undefined
    try {
      const team = ctx.teamRegistry.createTeam(name, description)
      if (Array.isArray(input.agents)) {
        for (const raw of input.agents) {
          if (!raw || typeof raw !== 'object') continue
          const member = raw as Record<string, unknown>
          const role = member.role ? String(member.role) : undefined
          const memberDescription = String(member.description ?? role ?? member.name ?? '').trim()
          if (!memberDescription) continue
          ctx.teamRegistry.addPlannedMember(name, {
            name: String(member.name ?? role ?? memberDescription),
            role,
            description: memberDescription,
            prompt: member.prompt ? String(member.prompt) : undefined,
          })
        }
      }
      const refreshed = ctx.teamRegistry.getTeam(team.name) ?? team
      return JSON.stringify({
        ok: true,
        team: refreshed,
        next_steps: [
          'Launch members with Agent(run_in_background:true, team_name, name, description, prompt).',
          'Check status with TeamList(team_name); when the current answer depends on a member, read output with TaskOutput(task_id, block:true).',
          'Send guidance with SendMessage(to:"team/member" or task_id, message).',
        ],
      }, null, 2)
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err))
    }
  }
}

export class TeamListTool implements Tool {
  name = 'TeamList'
  description = 'List teams or inspect one team with member task IDs, status, and progress handles.'
  isReadOnly = true
  inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional team name' },
      team_name: { type: 'string', description: 'Optional team name alias' },
      include_deleted: { type: 'boolean', description: 'Include deleted teams' },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const name = String(input.team_name ?? input.name ?? '').trim()
    if (name) {
      const team = ctx.teamRegistry.getTeam(name, { includeDeleted: Boolean(input.include_deleted) })
      if (!team) return toolError(`Team not found: ${name}`)
      return JSON.stringify({
        team,
        running_members: team.members
          .filter((m) => m.taskId && (m.status === 'pending' || m.status === 'running'))
          .map((m) => ({ name: m.name, task_id: m.taskId, status: m.status })),
      }, null, 2)
    }
    return JSON.stringify({
      teams: ctx.teamRegistry.listTeams({ includeDeleted: Boolean(input.include_deleted) }),
    }, null, 2)
  }
}

export class TeamDeleteTool implements Tool {
  name = 'TeamDelete'
  description = 'Delete a team and stop all its member agents.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Team name to delete' },
      team_name: { type: 'string', description: 'Team name alias' },
    },
    required: [],
  }

  private parentAgent: Agent | null = null

  setParentAgent(agent: Agent) { this.parentAgent = agent }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.name && !input.team_name) return 'name or team_name is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const name = String(input.name ?? input.team_name ?? '').trim()
    const team = ctx.teamRegistry.getTeam(name)
    if (!team) return toolError(`Team not found: ${name}`)
    const stopped: Array<{ member: string; task_id: string }> = []
    for (const member of team.members) {
      if (!member.taskId) continue
      const task = ctx.taskRegistry.get(member.taskId)
      if (task && (task.status === 'pending' || task.status === 'running')) {
        this.parentAgent?.cancelBackgroundAgent(member.taskId)
        ctx.taskRegistry.updateStatus(member.taskId, 'killed', { error: 'Team deleted' })
        stopped.push({ member: member.name, task_id: member.taskId })
      }
    }
    const deleted = ctx.teamRegistry.deleteTeam(name)
    return JSON.stringify({ ok: true, deleted: deleted.name, stopped }, null, 2)
  }
}
