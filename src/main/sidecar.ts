import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { connect } from 'net'

let sidecarProcess: ChildProcess | null = null
let gotdxProcess: ChildProcess | null = null
let sidecarPort = 19800
let gotdxPort = 19801
let sidecarReady = false
let gotdxReady = false

export function getSidecarUrl(): string | null {
  return sidecarReady ? `http://127.0.0.1:${sidecarPort}` : null
}

export function getGotdxUrl(): string | null {
  return gotdxReady ? `http://127.0.0.1:${gotdxPort}` : null
}

export async function startSidecar(appPath: string, basePath?: string): Promise<boolean> {
  if (sidecarProcess) return sidecarReady

  const sidecarDir = join(appPath, 'sidecar')
  const serverPy = join(sidecarDir, 'server.py')
  if (!existsSync(serverPy)) {
    console.log('Sidecar server.py not found at', serverPy)
    return false
  }

  const dbPath = basePath ? join(basePath, 'data', 'market.db') : ''

  return new Promise((resolve) => {
    try {
      sidecarProcess = spawn('uv', ['run', 'server.py', String(sidecarPort)], {
        cwd: sidecarDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FINDATA_DB_PATH: dbPath },
      })

      sidecarProcess.stderr?.on('data', (data) => {
        const msg = data.toString()
        if (msg.includes('Uvicorn running') || msg.includes('Application startup complete')) {
          sidecarReady = true
          resolve(true)
        }
      })

      sidecarProcess.on('error', (err) => {
        console.error('Python sidecar failed:', err.message)
        sidecarProcess = null
        resolve(false)
      })

      sidecarProcess.on('close', () => {
        sidecarReady = false
        sidecarProcess = null
      })

      setTimeout(() => {
        if (!sidecarReady) {
          fetch(`http://127.0.0.1:${sidecarPort}/health`)
            .then((res) => res.ok ? (sidecarReady = true, resolve(true)) : resolve(false))
            .catch(() => resolve(false))
        }
      }, 8000)
    } catch {
      resolve(false)
    }
  })
}

export async function startGotdx(appPath: string): Promise<boolean> {
  if (gotdxProcess) return gotdxReady

  const binaryName = process.platform === 'win32' ? 'gotdx-server.exe' : 'gotdx-server'
  const binaryPath = join(appPath, 'sidecar/gotdx', binaryName)
  if (!existsSync(binaryPath)) {
    console.log('gotdx binary not found at', binaryPath, 'Build it with: finagent_workstation/scripts/build_gotdx.sh')
    return false
  }

  // Find best TDX server from tdx_servers.json
  const tdxHost = await findBestTdxServer(appPath)
  const exHost = await findBestExServer(appPath)

  return new Promise((resolve) => {
    try {
      gotdxProcess = spawn(binaryPath, [String(gotdxPort)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TDX_HOST: tdxHost, TDX_EX_HOST: exHost },
      })

      gotdxProcess.stderr?.on('data', (data) => {
        if (data.toString().includes('listening')) {
          gotdxReady = true
          resolve(true)
        }
      })

      gotdxProcess.on('error', (err) => {
        console.error('gotdx sidecar failed:', err.message)
        gotdxProcess = null
        resolve(false)
      })

      gotdxProcess.on('close', () => {
        gotdxReady = false
        gotdxProcess = null
      })

      setTimeout(() => {
        if (!gotdxReady) {
          fetch(`http://127.0.0.1:${gotdxPort}/health`)
            .then((res) => res.ok ? (gotdxReady = true, resolve(true)) : resolve(false))
            .catch(() => resolve(false))
        }
      }, 3000)
    } catch {
      resolve(false)
    }
  })
}

export function stopSidecar(): void {
  if (sidecarProcess) { sidecarProcess.kill(); sidecarProcess = null; sidecarReady = false }
  if (gotdxProcess) { gotdxProcess.kill(); gotdxProcess = null; gotdxReady = false }
}

export function stopGotdx(): void {
  if (gotdxProcess) { gotdxProcess.kill(); gotdxProcess = null; gotdxReady = false }
}

export async function sidecarFetch(path: string, params: Record<string, string> = {}, readinessTimeoutMs = 8_000): Promise<unknown> {
  if (!getSidecarUrl() && readinessTimeoutMs > 0) {
    await waitForSidecarReady(readinessTimeoutMs)
  }
  const url = getSidecarUrl()
  if (!url) return { error: 'Python sidecar not running. Setup: cd sidecar && uv sync && uv run server.py' }

  const qs = new URLSearchParams(params).toString()
  const fullUrl = `${url}${path}${qs ? '?' + qs : ''}`
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(30_000) })
    return await res.json()
  } catch (err) {
    return { error: `Sidecar request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function waitForSidecarReady(timeoutMs: number, pollMs = 100): Promise<boolean> {
  if (sidecarReady) return Promise.resolve(true)
  if (timeoutMs <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      if (sidecarReady) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        clearInterval(timer)
        resolve(false)
      }
    }, pollMs)
  })
}

export async function gotdxFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = getGotdxUrl()
  if (!url) return { error: 'gotdx sidecar not running. Build: cd sidecar/gotdx && go build -o gotdx-server .' }

  const qs = new URLSearchParams(params).toString()
  const fullUrl = `${url}${path}${qs ? '?' + qs : ''}`
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(15_000) })
    return await res.json()
  } catch (err) {
    return { error: `gotdx request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Find the best (lowest latency) TDX server from tdx_servers.json.
 * Tests connectivity via TCP socket with timeout.
 * Falls back to default if all fail.
 */
async function findBestTdxServer(appPath: string): Promise<string> {
  const DEFAULT_HOST = '119.147.212.81:7709'

  // Load server list
  const serversFile = join(appPath, 'assets/bundle/tdx_servers.json')
  if (!existsSync(serversFile)) {
    const altPath = join(appPath, 'sidecar/gotdx/tdx_servers.json')
    if (!existsSync(altPath)) return DEFAULT_HOST
  }

  let servers: Array<{ host: string; port: number; name?: string }> = []
  try {
    const data = JSON.parse(readFileSync(existsSync(serversFile) ? serversFile : join(appPath, 'assets/bundle/tdx_servers.json'), 'utf-8'))
    servers = Array.isArray(data) ? data : (data.servers ?? [])
  } catch { return DEFAULT_HOST }

  if (servers.length === 0) return DEFAULT_HOST

  // Filter: only standard quote ports (7709/7711/7719), exclude ExQuote (7727)
  const stdServers = servers.filter((s) => s.port !== 7727)
  if (stdServers.length === 0) return DEFAULT_HOST

  // Test connectivity in parallel (max 10, 3s timeout each)
  const results = await Promise.allSettled(
    stdServers.slice(0, 10).map((s) => testTcpConnection(s.host, s.port, 3000))
  )

  let bestServer = DEFAULT_HOST
  let bestLatency = Infinity

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'fulfilled' && result.value < bestLatency) {
      bestLatency = result.value
      bestServer = `${stdServers[i].host}:${stdServers[i].port}`
    }
  }

  if (bestLatency < Infinity) {
    console.log(`[TDX] Best server: ${bestServer} (${bestLatency}ms)`)
  } else {
    console.log(`[TDX] All servers unreachable, using default: ${DEFAULT_HOST}`)
  }

  return bestServer
}

/** Test TCP connectivity and return latency in ms, or reject on timeout */
function testTcpConnection(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const socket = connect({ host, port, timeout: timeoutMs })
    socket.on('connect', () => {
      const latency = Date.now() - start
      socket.destroy()
      resolve(latency)
    })
    socket.on('error', () => { socket.destroy(); reject(new Error('connect failed')) })
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')) })
  })
}

/**
 * Find best ExQuote server (port 7727) from tdx_ex_servers.json.
 */
async function findBestExServer(appPath: string): Promise<string> {
  const DEFAULT_EX_HOST = '112.74.214.43:7727'
  const serversFile = join(appPath, 'assets/bundle/tdx_ex_servers.json')
  if (!existsSync(serversFile)) return DEFAULT_EX_HOST

  let servers: Array<{ host: string; port: number }> = []
  try {
    const data = JSON.parse(readFileSync(serversFile, 'utf-8'))
    servers = Array.isArray(data) ? data : (data.servers ?? [])
  } catch { return DEFAULT_EX_HOST }

  if (servers.length === 0) return DEFAULT_EX_HOST

  const results = await Promise.allSettled(
    servers.slice(0, 5).map((s) => testTcpConnection(s.host, s.port, 3000))
  )

  let best = DEFAULT_EX_HOST
  let bestLatency = Infinity
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && (results[i] as any).value < bestLatency) {
      bestLatency = (results[i] as any).value
      best = `${servers[i].host}:${servers[i].port}`
    }
  }

  if (bestLatency < Infinity) console.log(`[ExTDX] Best server: ${best} (${bestLatency}ms)`)
  return best
}
