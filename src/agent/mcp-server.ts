import { createServer, type Server } from 'http'
import type { ToolRegistry } from './tool'

/**
 * MCP Server mode: expose finagent_workstation's tools as an MCP server.
 * Claude Desktop or other MCP clients can connect and use our tools.
 *
 * Reference: openclaw/src/mcp/channel-server.ts
 *
 * Protocol: HTTP JSON-RPC (simplified streamable HTTP transport)
 * Endpoints: POST /mcp (JSON-RPC messages)
 */

export class McpServer {
  private server: Server | null = null
  private registry: ToolRegistry
  private port: number

  constructor(registry: ToolRegistry, port = 19900) {
    this.registry = registry
    this.port = port
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/mcp') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const body = await readBody(req)
      try {
        const request = JSON.parse(body)
        const response = await this.handleRequest(request)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(response))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }))
      }
    })

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[MCP Server] Port ${this.port} is already in use; embedded MCP server disabled for this instance.`)
        this.server = null
        return
      }
      console.error('[MCP Server] Failed to start:', err.message)
      this.server = null
    })

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[MCP Server] Listening on http://127.0.0.1:${this.port}/mcp`)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private async handleRequest(request: any): Promise<any> {
    const { id, method, params } = request

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'finagent-workstation', version: '1.0.0' },
          },
        }

      case 'tools/list':
        return {
          jsonrpc: '2.0', id,
          result: {
            tools: this.registry.list().map((t) => ({
              name: t.name,
              description: t.description.slice(0, 2048),
              inputSchema: t.inputSchema,
            })),
          },
        }

      case 'tools/call': {
        const { name, arguments: args } = params ?? {}
        const tool = this.registry.get(name)
        if (!tool) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `tool "${name}" not found` }], isError: true } }
        }
        try {
          const ctx = { basePath: '', workDir: process.cwd(), memoryDir: '', bundleDir: '', projectLocalDir: '', pluginSkillPaths: [] as string[], skipPermissions: true, approvedTools: new Set<string>(), planMode: false, readFileTimestamps: new Map(), taskRegistry: null as any, teamRegistry: null as any }
          const result = await tool.call(`mcp-${Date.now()}`, args ?? {}, ctx)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } }
        } catch (e) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true } }
        }
      }

      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    }
  }
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
    req.on('end', () => resolve(chunks.join('')))
  })
}
