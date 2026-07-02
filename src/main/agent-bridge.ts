import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { loadConfig } from './config'

interface BridgeMessage {
  id: string
  type: string
  [key: string]: unknown
}

type BridgeRouter = (path: string, params: Record<string, unknown>, method: string) => Promise<unknown>

export class AgentBridge {
  private basePath: string
  private stateFilePath: string
  private state: Record<string, unknown> = {}
  private router: BridgeRouter | null = null
  private onAgentMessage: ((msg: string, source: string, data: Record<string, unknown>) => unknown) | null = null
  private onNotify: ((msg: string) => void) | null = null

  constructor(basePath: string) {
    this.basePath = basePath
    this.stateFilePath = join(basePath, 'state.json')
    this.loadState()
  }

  setRouter(router: BridgeRouter) {
    this.router = router
  }

  setAgentMessageHandler(handler: (msg: string, source: string, data: Record<string, unknown>) => unknown) {
    this.onAgentMessage = handler
  }

  setNotifyHandler(handler: (msg: string) => void) {
    this.onNotify = handler
  }

  async handleMessage(msg: BridgeMessage): Promise<unknown> {
    switch (msg.type) {
      case 'http':
        return this.handleHttp(msg)
      case 'agent_message':
        return this.handleAgentMessage(msg)
      case 'notify':
        this.onNotify?.(String(msg.message ?? ''))
        return { ok: true }
      case 'getState':
        return { value: this.getScopedStateValue(msg) }
      case 'setState':
        this.setScopedStateValue(msg)
        this.saveState()
        return { ok: true }
      case 'getConfig':
        return { value: this.getConfigValue(String(msg.key)) }
      case 'readFile':
        return this.readFile(String(msg.path))
      case 'writeFile':
        return this.writeFile(String(msg.path), String(msg.content))
      case 'listDir':
        return this.listDir(String(msg.path))
      case 'fileExists':
        return { exists: existsSync(this.resolvePath(String(msg.path))) }
      case 'fileStat':
        return this.fileStat(String(msg.path))
      default:
        return { error: `Unknown bridge message type: ${msg.type}` }
    }
  }

  private async handleHttp(msg: BridgeMessage): Promise<unknown> {
    const path = String(msg.path ?? '')
    const params = (msg.params ?? {}) as Record<string, unknown>
    const method = String(msg.method ?? 'GET')

    if (this.router) {
      try {
        return await this.router(path, params, method)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (path.startsWith('http://') || path.startsWith('https://')) {
      return this.directFetch(path, params, method)
    }

    return { error: `No router configured for path: ${path}` }
  }

  private async directFetch(url: string, params: Record<string, unknown>, method: string): Promise<unknown> {
    try {
      const opts: RequestInit = { method, headers: { 'User-Agent': 'FinAgent/1.0' } }
      if (method === 'POST') {
        opts.headers = { ...opts.headers as Record<string, string>, 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(params)
      } else if (Object.keys(params).length > 0) {
        const qs = new URLSearchParams(params as Record<string, string>).toString()
        url = `${url}?${qs}`
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      const res = await fetch(url, { ...opts, signal: controller.signal })
      clearTimeout(timeout)

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        return await res.json()
      }
      return { text: await res.text() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  private handleAgentMessage(msg: BridgeMessage): unknown {
    const message = String(msg.message ?? '')
    const source = String(msg.source ?? 'dashboard')
    const data = (msg.data ?? {}) as Record<string, unknown>
    console.log('[AgentBridge] agent_message', {
      source,
      message: message.slice(0, 120),
      dataKeys: Object.keys(data),
    })
    if (!this.onAgentMessage) return { error: 'Agent message handler not initialized' }
    return this.onAgentMessage(message, source, data)
  }

  private getConfigValue(key: string): unknown {
    const config = loadConfig(this.basePath)
    if (key in config.apiKeys) return config.apiKeys[key]
    return (config as unknown as Record<string, unknown>)[key] ?? null
  }

  private readFile(path: string): unknown {
    const fullPath = this.resolvePath(path)
    if (!existsSync(fullPath)) return { error: `File not found: ${path}` }
    try {
      return { content: readFileSync(fullPath, 'utf-8') }
    } catch (err) {
      return { error: String(err) }
    }
  }

  private writeFile(path: string, content: string): unknown {
    const fullPath = this.resolvePath(path)
    try {
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  }

  private listDir(path: string): unknown {
    const fullPath = this.resolvePath(path)
    if (!existsSync(fullPath)) return { error: `Directory not found: ${path}` }
    try {
      return {
        entries: readdirSync(fullPath).map((name) => {
          const s = statSync(join(fullPath, name))
          return {
            name,
            type: s.isDirectory() ? 'directory' : 'file',
            size: s.size,
            modified: s.mtime.toISOString(),
          }
        }),
      }
    } catch (err) {
      return { error: String(err) }
    }
  }

  private fileStat(path: string): unknown {
    const fullPath = this.resolvePath(path)
    if (!existsSync(fullPath)) return { error: `Not found: ${path}` }
    try {
      const s = statSync(fullPath)
      return {
        size: s.size,
        type: s.isDirectory() ? 'directory' : 'file',
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        modified: s.mtime.toISOString(),
      }
    } catch (err) {
      return { error: String(err) }
    }
  }

  private resolvePath(path: string): string {
    if (path.startsWith('/')) return path
    return join(this.basePath, path)
  }

  private getScopedStateValue(msg: BridgeMessage): unknown {
    const key = String(msg.key ?? '')
    const scope = this.stateScope(msg)
    const scoped = this.state[scope]
    if (scoped && typeof scoped === 'object' && !Array.isArray(scoped) && key in scoped) {
      return (scoped as Record<string, unknown>)[key]
    }
    return this.state[key] ?? null
  }

  private setScopedStateValue(msg: BridgeMessage): void {
    const key = String(msg.key ?? '')
    const scope = this.stateScope(msg)
    const scoped = this.state[scope]
    const next = scoped && typeof scoped === 'object' && !Array.isArray(scoped)
      ? scoped as Record<string, unknown>
      : {}
    next[key] = msg.value
    this.state[scope] = next
  }

  private stateScope(msg: BridgeMessage): string {
    return String(msg.dashboardId ?? msg.panelId ?? msg.source ?? '_global')
  }

  private loadState() {
    if (existsSync(this.stateFilePath)) {
      try {
        this.state = JSON.parse(readFileSync(this.stateFilePath, 'utf-8'))
      } catch { /* ignore */ }
    }
  }

  private saveState() {
    try {
      mkdirSync(dirname(this.stateFilePath), { recursive: true })
      writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }
}
