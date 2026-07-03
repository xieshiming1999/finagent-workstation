import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from './tool'
import { toolError } from './tool'

/**
 * MCP (Model Context Protocol) Client for finagent_workstation.
 * Connects to external MCP servers, discovers tools/resources, and adapts them
 * to the internal Tool interface.
 *
 * Reference: claude-code-best/src/services/mcp/client.ts
 * Reference: opencode/packages/opencode/src/mcp/index.ts
 */

export interface McpServerConfig {
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverName: string
}

export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  serverName: string
}

interface McpConnection {
  config: McpServerConfig
  process: ChildProcess | null
  tools: McpTool[]
  resources: McpResource[]
  status: 'connecting' | 'connected' | 'failed' | 'disabled'
  error?: string
}

export class McpManager {
  private connections = new Map<string, McpConnection>()
  private configPath: string

  constructor(globalBasePath: string) {
    this.configPath = join(globalBasePath, 'mcp_servers.json')
  }

  /** Load MCP server configs from disk */
  loadConfig(): McpServerConfig[] {
    if (!existsSync(this.configPath)) return []
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8'))
    } catch { return [] }
  }

  /** Save MCP server configs to disk */
  saveConfig(configs: McpServerConfig[]): void {
    mkdirSync(join(this.configPath, '..'), { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(configs, null, 2), 'utf-8')
  }

  /** Connect to all configured MCP servers */
  async connectAll(): Promise<void> {
    const configs = this.loadConfig()
    for (const config of configs) {
      if (config.enabled === false) {
        this.connections.set(config.name, { config, process: null, tools: [], resources: [], status: 'disabled' })
        continue
      }
      await this.connect(config)
    }
  }

  /** Connect to a single MCP server */
  async connect(config: McpServerConfig): Promise<void> {
    const conn: McpConnection = { config, process: null, tools: [], resources: [], status: 'connecting' }
    this.connections.set(config.name, conn)

    try {
      if (config.type === 'stdio') {
        await this.connectStdio(conn)
      } else if (config.type === 'http') {
        await this.connectHttp(conn)
      }
      conn.status = 'connected'
      console.log(`[MCP] Connected to ${config.name}: ${conn.tools.length} tools, ${conn.resources.length} resources`)
    } catch (e) {
      conn.status = 'failed'
      conn.error = e instanceof Error ? e.message : String(e)
      console.error(`[MCP] Failed to connect to ${config.name}:`, conn.error)
    }
  }

  /** Disconnect all MCP servers */
  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      if (conn.process) {
        conn.process.kill('SIGTERM')
        setTimeout(() => conn.process?.kill('SIGKILL'), 500)
      }
    }
    this.connections.clear()
  }

  /** Get all discovered MCP tools */
  getTools(): McpTool[] {
    const tools: McpTool[] = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') tools.push(...conn.tools)
    }
    return tools
  }

  /** Get all discovered MCP resources */
  getResources(): McpResource[] {
    const resources: McpResource[] = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') resources.push(...conn.resources)
    }
    return resources
  }

  /** Get connection status for all servers */
  getStatus(): Array<{ name: string; status: string; tools: number; error?: string }> {
    return Array.from(this.connections.values()).map((c) => ({
      name: c.config.name,
      status: c.status,
      tools: c.tools.length,
      error: c.error,
    }))
  }

  /** Create Tool adapters for all MCP tools */
  createToolAdapters(): Tool[] {
    const tools = this.getTools().map((mcpTool) => new McpToolAdapter(mcpTool, this))

    // Add resource tools if any server has resources
    if (this.getResources().length > 0) {
      tools.push(this.createListResourcesTool() as unknown as McpToolAdapter)
      tools.push(this.createReadResourceTool() as unknown as McpToolAdapter)
    }

    return tools
  }

  private createListResourcesTool(): Tool {
    const manager = this
    return {
      name: 'ListMcpResources',
      description: 'List available resources from MCP servers.',
      inputSchema: { type: 'object', properties: {} },
      isReadOnly: true,
      canParallel: true,
      async call(): Promise<string> {
        const resources = manager.getResources()
        if (resources.length === 0) return 'No MCP resources available.'
        return resources.map((r) => `${r.serverName}: ${r.name} (${r.uri})${r.description ? ` — ${r.description}` : ''}`).join('\n')
      },
    }
  }

  private createReadResourceTool(): Tool {
    const manager = this
    return {
      name: 'ReadMcpResource',
      description: 'Read a specific MCP resource by URI.',
      inputSchema: { type: 'object', properties: { uri: { type: 'string', description: 'Resource URI' } }, required: ['uri'] },
      isReadOnly: true,
      canParallel: true,
      async call(_id: string, input: Record<string, unknown>): Promise<string> {
        const uri = String(input.uri ?? '')
        if (!uri) return toolError('uri required')
        const resource = manager.getResources().find((r) => r.uri === uri)
        if (!resource) return toolError(`Resource not found: ${uri}`)
        // Read via MCP JSON-RPC
        const conn = manager.connections.get(resource.serverName)
        if (!conn?.process) return toolError('Server not connected')
        try {
          const result = await (manager as any).sendJsonRpc(conn.process, 'resources/read', { uri })
          if (result?.contents) {
            return result.contents.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
          }
          return JSON.stringify(result)
        } catch (e) {
          return toolError(`Reading MCP resource failed: ${e}`)
        }
      },
    }
  }

  /** Call an MCP tool */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const conn = this.connections.get(serverName)
    if (!conn || conn.status !== 'connected') {
      return toolError(`MCP server "${serverName}" not connected`)
    }

    if (conn.config.type === 'stdio' && conn.process) {
      return this.callStdioTool(conn, toolName, args)
    } else if (conn.config.type === 'http' && conn.config.url) {
      return this.callHttpTool(conn, toolName, args)
    }

    return toolError('unsupported MCP transport')
  }

  // --- Private methods ---

  private async connectStdio(conn: McpConnection): Promise<void> {
    const { command, args = [], env = {} } = conn.config
    if (!command) throw new Error('stdio server requires command')

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    conn.process = child

    // Send initialize request
    const initResponse = await this.sendJsonRpc(child, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'finagent-workstation', version: '1.0.0' },
    })

    // Send initialized notification
    this.sendNotification(child, 'notifications/initialized', {})

    // List tools
    const toolsResponse = await this.sendJsonRpc(child, 'tools/list', {})
    conn.tools = (toolsResponse?.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      serverName: conn.config.name,
    }))

    // List resources (optional)
    try {
      const resourcesResponse = await this.sendJsonRpc(child, 'resources/list', {})
      conn.resources = (resourcesResponse?.resources ?? []).map((r: any) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        serverName: conn.config.name,
      }))
    } catch { /* resources not supported */ }

    // Listen for ToolListChanged notifications (refresh tools on change)
    this.listenForNotifications(child, conn)
  }

  private async connectHttp(conn: McpConnection): Promise<void> {
    const { url } = conn.config
    if (!url) throw new Error('http server requires url')

    // HTTP/SSE transport — simplified: just list tools
    const res = await fetch(`${url}/tools/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as any
    conn.tools = (data?.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      serverName: conn.config.name,
    }))
  }

  private async callStdioTool(conn: McpConnection, toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!conn.process) return toolError('process not running')
    const result = await this.sendJsonRpc(conn.process, 'tools/call', { name: toolName, arguments: args })
    if (result?.content) {
      return result.content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
    }
    return JSON.stringify(result)
  }

  private async callHttpTool(conn: McpConnection, toolName: string, args: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${conn.config.url}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: toolName, arguments: args }),
    })
    if (!res.ok) return toolError(`HTTP ${res.status}`)
    const data = await res.json() as any
    if (data?.content) {
      return data.content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
    }
    return JSON.stringify(data)
  }

  private sendJsonRpc(child: ChildProcess, method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Date.now()
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

      let buffer = ''
      const onData = (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.id === id) {
              child.stdout?.off('data', onData)
              if (parsed.error) reject(new Error(parsed.error.message))
              else resolve(parsed.result)
            }
          } catch { /* skip */ }
        }
      }

      child.stdout?.on('data', onData)
      child.stdin?.write(msg)

      setTimeout(() => {
        child.stdout?.off('data', onData)
        reject(new Error('MCP timeout (30s)'))
      }, 30_000)
    })
  }

  private sendNotification(child: ChildProcess, method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
    child.stdin?.write(msg)
  }

  /**
   * Listen for server notifications (ToolListChanged, ResourceListChanged).
   * On change, re-fetch tools/resources and notify via onToolsChanged callback.
   */
  onToolsChanged: (() => void) | null = null

  private listenForNotifications(child: ChildProcess, conn: McpConnection): void {
    let buffer = ''
    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          // Notifications have no 'id' field
          if (msg.method && !msg.id) {
            if (msg.method === 'notifications/tools/list_changed' ||
                msg.method === 'notifications/resources/list_changed') {
              console.log(`[MCP] ${conn.config.name}: ${msg.method} — refreshing`)
              this.refreshConnection(conn).catch(() => {})
            }
          }
        } catch { /* not JSON or not a notification — skip */ }
      }
    })
  }

  /** Re-fetch tools and resources for a connection */
  private async refreshConnection(conn: McpConnection): Promise<void> {
    if (!conn.process) return
    try {
      const toolsResponse = await this.sendJsonRpc(conn.process, 'tools/list', {})
      conn.tools = (toolsResponse?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        serverName: conn.config.name,
      }))

      try {
        const resourcesResponse = await this.sendJsonRpc(conn.process, 'resources/list', {})
        conn.resources = (resourcesResponse?.resources ?? []).map((r: any) => ({
          uri: r.uri, name: r.name, description: r.description,
          mimeType: r.mimeType, serverName: conn.config.name,
        }))
      } catch { /* */ }

      this.onToolsChanged?.()
    } catch (e) {
      console.error(`[MCP] Refresh failed for ${conn.config.name}:`, e)
    }
  }
}

/**
 * Adapts an MCP tool to the internal Tool interface.
 */
class McpToolAdapter implements Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  isReadOnly = false
  canParallel = true
  private mcpTool: McpTool
  private manager: McpManager

  constructor(mcpTool: McpTool, manager: McpManager) {
    this.name = `mcp__${mcpTool.serverName}__${mcpTool.name}`
    const MAX_DESC = 2048
    const desc = mcpTool.description.length > MAX_DESC ? mcpTool.description.slice(0, MAX_DESC) + '...' : mcpTool.description
    this.description = `[MCP:${mcpTool.serverName}] ${desc}`
    this.inputSchema = mcpTool.inputSchema
    this.mcpTool = mcpTool
    this.manager = manager
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    return this.manager.callTool(this.mcpTool.serverName, this.mcpTool.name, input)
  }
}
