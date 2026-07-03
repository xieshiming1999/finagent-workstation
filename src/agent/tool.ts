import type { Message, ToolUse, ToolResult } from './message'

import type { TaskRegistry } from './background-task'
import type { TeamRegistry } from './team-context'

export type BridgeRequestHandler = (
  path: string,
  params: Record<string, unknown>,
  method: string,
  headers?: Record<string, string>
) => Promise<unknown>

export interface ToolContext {
  basePath: string
  workDir: string
  memoryDir: string
  bundleDir: string
  /** Project-local config dir: {cwd}/.finagent-workstation/ (skills, plugins, hooks, commands) */
  projectLocalDir: string
  /** Additional skill discovery paths from plugins */
  pluginSkillPaths: string[]
  skipPermissions: boolean
  approvedTools: Set<string>
  planMode: boolean
  readFileTimestamps: Map<string, number>
  taskRegistry: TaskRegistry
  teamRegistry: TeamRegistry
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  isReadOnly: boolean
  canParallel?: boolean
  /** True for tools that wait on direct user or renderer interaction. */
  requiresUserInteraction?: boolean

  validateInput?(input: Record<string, unknown>, ctx: ToolContext): string | null
  needsPermissions?(input: Record<string, unknown>): boolean
  call(id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

export function requiresUserInteraction(tool: Tool): boolean {
  return tool.requiresUserInteraction === true
}

export function looksLikeToolError(content: string): boolean {
  const text = content.trimStart()
  if (!text) return false

  const prefixes = [
    'Error:',
    'Validation error:',
    'Tool use was rejected',
    'BLOCKED:',
    'HTTP ',
    'Fetch error:',
    'Render error:',
    'Crop error:',
    'Parse error:',
    'Download failed',
    'Search failed.',
    'Sub-agent failed:',
    'WEBVIEW_ELEMENT_MISSING:',
    'WIND_TOOL_ERROR:',
    'RATE_LIMIT_DAILY:',
    'BALANCE_INSUFFICIENT:',
    'KEY_MISSING:',
    'INVALID_',
    'MISSING_',
  ]
  if (prefixes.some((prefix) => text.startsWith(prefix))) return true

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && typeof parsed.error === 'string'
    } catch {
      return false
    }
  }

  return false
}

export function toolError(message: string): never {
  throw new Error(message)
}

const DEFAULT_TRUSTED_RUNTIME_TOOLS = new Set([
  // UI/artifact tools write only app-runtime outputs or control in-app panels.
  'Dashboard',
  'WebView',
  'Screenshot',
  'PageRender',
  'ImageCrop',
  'DataTask',
])

function isDefaultTrustedRuntimeTool(tool: Tool): boolean {
  return DEFAULT_TRUSTED_RUNTIME_TOOLS.has(tool.name)
}

export function needsPermission(tool: Tool, approvedTools: Set<string>, skipPermissions: boolean): boolean {
  if (skipPermissions) return false
  if (isDefaultTrustedRuntimeTool(tool)) return false
  if (tool.isReadOnly) return false
  if (approvedTools.has(tool.name)) return false
  return true
}

export function needsPermissionForInput(tool: Tool, input: Record<string, unknown>, approvedTools: Set<string>, skipPermissions: boolean): boolean {
  if (skipPermissions) return false
  if (isDefaultTrustedRuntimeTool(tool)) return false
  if (approvedTools.has(tool.name)) return false
  if (tool.needsPermissions) return tool.needsPermissions(input)
  if (tool.isReadOnly) return false
  return true
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name) ?? this.fuzzyMatch(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  toOpenAI(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))
  }

  private fuzzyMatch(name: string): Tool | undefined {
    const lower = name.toLowerCase()
    for (const [key, tool] of this.tools) {
      if (key.toLowerCase() === lower) return tool
    }
    return undefined
  }
}
