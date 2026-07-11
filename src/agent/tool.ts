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

export interface ToolCapabilitySummary {
  name: string
  description: string
  readOnly: boolean
  canParallel: boolean
  requiresUserInteraction: boolean
  permission: 'read-only' | 'trusted-runtime' | 'input-dependent' | 'write-or-side-effect'
  schema: {
    propertyNames: string[]
    required: string[]
    actionValues: string[]
  }
}

export function requiresUserInteraction(tool: Tool): boolean {
  return tool.requiresUserInteraction === true
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

  capabilities(): ToolCapabilitySummary[] {
    return this.list().map((tool) => summarizeToolCapability(tool))
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

export function summarizeToolCapability(tool: Tool): ToolCapabilitySummary {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.isReadOnly,
    canParallel: tool.canParallel ?? tool.isReadOnly,
    requiresUserInteraction: requiresUserInteraction(tool),
    permission: permissionSummary(tool),
    schema: summarizeToolSchema(tool.inputSchema),
  }
}

function permissionSummary(tool: Tool): ToolCapabilitySummary['permission'] {
  if (isDefaultTrustedRuntimeTool(tool)) return 'trusted-runtime'
  if (tool.needsPermissions) return 'input-dependent'
  if (tool.isReadOnly) return 'read-only'
  return 'write-or-side-effect'
}

function summarizeToolSchema(schema: Record<string, unknown>): ToolCapabilitySummary['schema'] {
  const properties = objectRecord(schema.properties)
  return {
    propertyNames: Object.keys(properties).sort(),
    required: stringArray(schema.required).sort(),
    actionValues: actionEnumValues(properties).sort(),
  }
}

function actionEnumValues(properties: Record<string, unknown>): string[] {
  const action = objectRecord(properties.action)
  return stringArray(action.enum)
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
