import * as vm from 'vm'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createHash } from 'crypto'
import { MonitorStore, type Monitor } from './monitor-store'
import { UINotificationStore } from './ui-notification'
import type { BridgeRequestHandler } from './tool'
import { cacheKey, directFetch, extractHttpCalls, isErrorResponse, parseMaybeJson } from './monitor-scheduler-utils'

type HandlerSource = string
type WsBridgeConfig = {
  monitorId: string
  url: string
  onMessage?: HandlerSource
  onOpen?: HandlerSource
}

/**
 * MonitorScheduler: executes monitor JS scripts on their configured intervals.
 * Desktop equivalent of finagent's monitor_scheduler.dart (806 lines).
 * Uses Node.js vm module instead of flutter_js.
 */
export class MonitorScheduler {
  private store: MonitorStore
  private basePath: string
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  notificationStore: UINotificationStore | null = null
  onAlert: ((monitorId: string, message: string) => void) | null = null
  onAgentMessage: ((monitorId: string, monitorName: string, message: string, data: Record<string, unknown>) => void) | null = null
  getConfigValue: ((key: string) => unknown) | null = null
  requestHandler: BridgeRequestHandler | null = null
  private pushHandlers = new Map<string, Map<string, HandlerSource>>()
  private wsConfigs = new Map<string, WsBridgeConfig>()
  private wsConnections = new Map<string, any>()
  private wsReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(store: MonitorStore, basePath: string) {
    this.store = store
    this.basePath = basePath
  }

  start(): void {
    for (const monitor of this.store.list) {
      if (monitor.enabled) this.schedule(monitor)
    }
    this.store.onChanged = () => this.reconcile()
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    for (const timer of this.wsReconnectTimers.values()) clearTimeout(timer)
    this.wsReconnectTimers.clear()
    for (const ws of this.wsConnections.values()) {
      try { ws.close?.() } catch { /* ignore */ }
    }
    this.wsConnections.clear()
  }

  async runOnce(id: string): Promise<Monitor | null> {
    await this.runMonitor(id)
    return this.store.get(id) ?? null
  }

  private schedule(monitor: Monitor): void {
    if (this.timers.has(monitor.id)) return
    const intervalMs = monitor.intervalSeconds * 1000

    // Run immediately, then on interval
    this.runMonitor(monitor.id)
    const timer = setInterval(() => this.runMonitor(monitor.id), intervalMs)
    this.timers.set(monitor.id, timer)
  }

  private unschedule(id: string): void {
    const timer = this.timers.get(id)
    if (timer) { clearInterval(timer); this.timers.delete(id) }
    this.closeMonitorWebSockets(id)
    this.pushHandlers.delete(id)
  }

  private reconcile(): void {
    const activeIds = new Set<string>()
    for (const monitor of this.store.list) {
      activeIds.add(monitor.id)
      if (monitor.enabled && !this.timers.has(monitor.id)) {
        this.schedule(monitor)
      } else if (!monitor.enabled && this.timers.has(monitor.id)) {
        this.unschedule(monitor.id)
      }
    }
    // Remove timers for deleted monitors
    for (const id of this.timers.keys()) {
      if (!activeIds.has(id)) this.unschedule(id)
    }
  }

  private async runMonitor(id: string): Promise<void> {
    const monitor = this.store.get(id)
    if (!monitor || !monitor.enabled) return

    try {
      const state = { ...monitor.state }
      const result: Record<string, unknown> = {}
      const alerts: string[] = []
      const agentMessages: Array<{ message: string; data: Record<string, unknown> }> = []
      const pushHandlers = new Map<string, HandlerSource>()
      const wsRegistrations: WsBridgeConfig[] = []
      const fetchCache = await this.prefetchServiceCalls(monitor.script)
      const resolvePath = (path: string) => path.startsWith('/') ? path : join(this.basePath, path)
      const callService = (url: string, params?: Record<string, unknown>, method = 'GET') => {
        const key = cacheKey(method, url, params ?? {})
        const cached = fetchCache[key]
        if (isErrorResponse(cached)) throw new Error(`callService("${url}") error: ${String((cached as Record<string, unknown>).error)}`)
        if (cached !== undefined) return cached
        throw new Error(`callService("${url}") not pre-fetched. Keys: ${Object.keys(fetchCache).join(', ')}`)
      }

      // Build Bridge API for the monitor script
      const bridge = {
        callService,
        fetch: callService,
        get: (url: string, options?: { params?: Record<string, unknown> }) => callService(url, options?.params ?? {}, 'GET'),
        post: (url: string, body?: Record<string, unknown>) => callService(url, body ?? {}, 'POST'),
        put: (url: string, body?: Record<string, unknown>) => callService(url, body ?? {}, 'PUT'),
        delete: (url: string, options?: { params?: Record<string, unknown> }) => callService(url, options?.params ?? {}, 'DELETE'),
        getState: (key: string) => state[key],
        setState: (key: string, value: unknown) => { state[key] = value },
        readFile: (path: string) => readFileSync(resolvePath(path), 'utf-8'),
        writeFile: (path: string, content: string) => {
          const fullPath = resolvePath(path)
          mkdirSync(dirname(fullPath), { recursive: true })
          writeFileSync(fullPath, content, 'utf-8')
          return { ok: true }
        },
        listDir: (path = '.') => {
          const fullPath = resolvePath(path)
          return readdirSync(fullPath).map((name) => {
            const s = statSync(join(fullPath, name))
            return { name, type: s.isDirectory() ? 'directory' : 'file', size: s.size, modified: s.mtime.toISOString() }
          })
        },
        fileExists: (path: string) => existsSync(resolvePath(path)),
        fileStat: (path: string) => {
          const s = statSync(resolvePath(path))
          return { size: s.size, type: s.isDirectory() ? 'directory' : 'file', isFile: s.isFile(), isDirectory: s.isDirectory(), modified: s.mtime.toISOString() }
        },
        notify: (msg: string) => { alerts.push(msg) },
        alert: (msg: string) => { alerts.push(`⚠ ${msg}`) },
        sendToAgent: (msg: string, data?: Record<string, unknown>) => { agentMessages.push({ message: msg, data: data ?? {} }); return { ok: true } },
        sendToMonitor: (monitorId: string, channel: string, data?: Record<string, unknown>) => {
          this.pushToMonitor(monitorId, channel, data ?? {})
          return { ok: true }
        },
        onPush: (channel: string, handler: unknown) => {
          if (typeof handler !== 'function') throw new Error('Bridge.onPush requires a function handler.')
          pushHandlers.set(channel, String(handler))
          return { ok: true }
        },
        ws: (url: string, options?: { onMessage?: unknown; onOpen?: unknown }) => {
          wsRegistrations.push({
            monitorId: monitor.id,
            url,
            onMessage: typeof options?.onMessage === 'function' ? String(options.onMessage) : undefined,
            onOpen: typeof options?.onOpen === 'function' ? String(options.onOpen) : undefined,
          })
          return { ok: true }
        },
        getConfig: (key: string) => this.getConfigValue?.(key) ?? null,
        setResult: (key: string, value: unknown) => { result[key] = value },
        parseCSV: (text: string, sep = ',') => text.split('\n').filter((line) => line.trim()).map((line) => line.split(sep).map((v) => v.trim())),
        toCSV: (rows: unknown[][], sep = ',') => rows.map((row) => row.map((cell) => {
          const value = String(cell)
          return value.includes(sep) || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value
        }).join(sep)).join('\n'),
        base64Encode: (text: string) => Buffer.from(String(text), 'utf-8').toString('base64'),
        base64Decode: (text: string) => Buffer.from(String(text), 'base64').toString('utf-8'),
        hexEncode: (text: string) => Buffer.from(String(text), 'utf-8').toString('hex'),
        hexDecode: (hex: string) => Buffer.from(String(hex), 'hex').toString('utf-8'),
        hash: (text: string, algo = 'sha256') => createHash(algo).update(String(text)).digest('hex'),
        sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
        avg: (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
        median: (arr: number[]) => {
          if (!arr.length) return 0
          const sorted = arr.slice().sort((a, b) => a - b)
          const mid = Math.floor(sorted.length / 2)
          return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        },
        groupBy: (arr: any[], key: string | ((item: any) => string)) => arr.reduce((out, item) => {
          const value = typeof key === 'function' ? key(item) : item[key]
          ;(out[value] ||= []).push(item)
          return out
        }, {} as Record<string, unknown[]>),
        unique: (arr: unknown[]) => Array.from(new Set(arr.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)))).map((v) => {
          try { return JSON.parse(v) } catch { return v }
        }),
        sortBy: (arr: any[], key: string | ((item: any) => unknown), desc?: boolean) => arr.slice().sort((a, b) => {
          const av = typeof key === 'function' ? key(a) : a[key]
          const bv = typeof key === 'function' ? key(b) : b[key]
          if (av < bv) return desc ? 1 : -1
          if (av > bv) return desc ? -1 : 1
          return 0
        }),
        flatten: (arr: unknown[]): unknown[] => arr.reduce<unknown[]>((out, item) => out.concat(Array.isArray(item) ? bridge.flatten(item) : item), []),
      }

      // Execute the monitor script in a sandbox
      const context = vm.createContext({
        Bridge: bridge,
        callService,
        console: { log: () => {}, error: () => {}, warn: () => {} },
        JSON,
        Math,
        Date,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        setTimeout: undefined,
        setInterval: undefined,
      })

      const wrappedScript = `(async () => { ${monitor.script} })()`
      const scriptResult = await vm.runInContext(wrappedScript, context, { timeout: 30_000 })
      if (pushHandlers.size > 0) this.pushHandlers.set(monitor.id, pushHandlers)
      for (const config of wsRegistrations) this.registerBridgeWebSocket(config)

      // Process result
      if (typeof scriptResult === 'object' && scriptResult !== null) {
        Object.assign(result, scriptResult)
      }

      this.store.updateResult(id, result, state)

      // Check condition
      if (monitor.condition) {
        try {
          const condCtx = vm.createContext({ result, state, JSON, Math })
          const condResult = vm.runInContext(monitor.condition, condCtx, { timeout: 1000 })
          if (condResult) {
            monitor.conditionTriggered = true
            alerts.push(monitor.condition)
          }
        } catch { /* condition eval failed — ignore */ }
      }

      // Process alerts
      for (const msg of alerts) {
        this.store.setAlert(id, msg)
        this.notificationStore?.add(monitor.name, msg, 'alert', 'monitor')
        this.onAlert?.(id, msg)
      }
      for (const msg of agentMessages) {
        this.onAgentMessage?.(id, monitor.name, msg.message, msg.data)
      }

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.store.updateError(id, error)
      console.error(`[MonitorScheduler] ${monitor.name} error:`, error)
    }
  }

  pushToMonitor(monitorId: string, channel: string, data: Record<string, unknown>): void {
    const handler = this.pushHandlers.get(monitorId)?.get(channel)
    const monitor = this.store.get(monitorId)
    if (!handler || !monitor) return
    this.runHandler(monitor, handler, data, `push:${channel}`)
  }

  private async prefetchServiceCalls(script: string): Promise<Record<string, unknown>> {
    const calls = extractHttpCalls(script)
    const results: Record<string, unknown> = {}
    await Promise.all(calls.map(async (call) => {
      const key = cacheKey(call.method, call.path, call.params)
      if (key in results) return
      try {
        results[key] = this.requestHandler
          ? await this.requestHandler(call.path, call.params, call.method)
          : await directFetch(call.path, call.params, call.method)
      } catch (err) {
        results[key] = { error: err instanceof Error ? err.message : String(err) }
      }
    }))
    return results
  }

  private registerBridgeWebSocket(config: WsBridgeConfig): void {
    if (!config.url || !config.onMessage) return
    const key = `${config.monitorId}:${config.url}`
    this.wsConfigs.set(key, config)
    if (this.wsConnections.has(key)) return
    this.connectBridgeWebSocket(key)
  }

  private connectBridgeWebSocket(key: string): void {
    const config = this.wsConfigs.get(key)
    if (!config) return
    const monitor = this.store.get(config.monitorId)
    if (!monitor || !monitor.enabled) return
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: new(url: string) => any }).WebSocket
    if (!WebSocketCtor) {
      this.store.updateError(monitor.id, 'Bridge.ws unavailable: runtime WebSocket constructor is missing.')
      return
    }
    try {
      const ws = new WebSocketCtor(config.url)
      this.wsConnections.set(key, ws)
      ws.onopen = () => {
        if (!config.onOpen) return
        const openResult = this.runHandler(monitor, config.onOpen, {}, 'ws:onOpen')
        if (typeof openResult === 'string' && openResult) ws.send?.(openResult)
      }
      ws.onmessage = (event: { data?: unknown }) => {
        const data = typeof event.data === 'string' ? parseMaybeJson(event.data) : event.data
        this.runHandler(monitor, config.onMessage!, { data }, 'ws:onMessage')
      }
      ws.onerror = () => this.store.updateError(monitor.id, `Bridge.ws error: ${config.url}`)
      ws.onclose = () => {
        this.wsConnections.delete(key)
        this.scheduleBridgeReconnect(key)
      }
    } catch (err) {
      this.store.updateError(monitor.id, `Bridge.ws connect failed: ${err instanceof Error ? err.message : String(err)}`)
      this.scheduleBridgeReconnect(key)
    }
  }

  private scheduleBridgeReconnect(key: string): void {
    if (this.wsReconnectTimers.has(key)) return
    const timer = setTimeout(() => {
      this.wsReconnectTimers.delete(key)
      this.connectBridgeWebSocket(key)
    }, 30_000)
    this.wsReconnectTimers.set(key, timer)
  }

  private closeMonitorWebSockets(monitorId: string): void {
    for (const [key, ws] of this.wsConnections.entries()) {
      if (!key.startsWith(`${monitorId}:`)) continue
      try { ws.close?.() } catch { /* ignore */ }
      this.wsConnections.delete(key)
    }
    for (const [key, timer] of this.wsReconnectTimers.entries()) {
      if (!key.startsWith(`${monitorId}:`)) continue
      clearTimeout(timer)
      this.wsReconnectTimers.delete(key)
    }
    for (const key of this.wsConfigs.keys()) {
      if (key.startsWith(`${monitorId}:`)) this.wsConfigs.delete(key)
    }
  }

  private runHandler(monitor: Monitor, handlerSource: string, data: Record<string, unknown>, eventName: string): unknown {
    const state = { ...monitor.state }
    const result: Record<string, unknown> = {}
    const alerts: string[] = []
    const agentMessages: Array<{ message: string; data: Record<string, unknown> }> = []
    const bridge = {
      notify: (msg: string) => { alerts.push(msg); return { ok: true } },
      alert: (msg: string) => { alerts.push(`⚠ ${msg}`); return { ok: true } },
      sendToAgent: (msg: string, payload?: Record<string, unknown>) => { agentMessages.push({ message: msg, data: payload ?? {} }); return { ok: true } },
      getConfig: (key: string) => this.getConfigValue?.(key) ?? null,
      setResult: (key: string, value: unknown) => { result[key] = value },
      sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
      avg: (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
      hash: (text: string, algo = 'sha256') => createHash(algo).update(String(text)).digest('hex'),
    }
    try {
      const context = vm.createContext({ Bridge: bridge, state, data, JSON, Math, Date, console: { log: () => {} } })
      const value = vm.runInContext(`(${handlerSource})(data)`, context, { timeout: 5000 })
      if (typeof value === 'object' && value !== null) Object.assign(result, value as Record<string, unknown>)
      this.store.updateResult(monitor.id, result, state)
      for (const msg of alerts) {
        this.store.setAlert(monitor.id, msg)
        this.notificationStore?.add(monitor.name, msg, 'alert', 'monitor')
        this.onAlert?.(monitor.id, msg)
      }
      for (const msg of agentMessages) this.onAgentMessage?.(monitor.id, monitor.name, msg.message, msg.data)
      return value
    } catch (err) {
      this.store.updateError(monitor.id, `${eventName} handler failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
}
