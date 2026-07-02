const DEFAULT_SIDECAR_BASE_URL = 'http://127.0.0.1:19800'

let sidecarHealthyEver = false

export class SidecarStartupError extends Error {
  constructor(message = 'Python sidecar is still starting. Retry shortly.') {
    super(message)
    this.name = 'SidecarStartupError'
  }
}

export function isSidecarStartupError(error: unknown): error is SidecarStartupError {
  return error instanceof SidecarStartupError
}

export function resetSidecarHealthForTest(): void {
  sidecarHealthyEver = false
}

function isImmediateLocalConnectFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const causeCode = String((error as Error & { cause?: { code?: string } }).cause?.code ?? '').toUpperCase()
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ECONNRESET' || causeCode === 'UND_ERR_SOCKET') return true
  return message.includes('fetch failed') || message.includes('econnrefused') || message.includes('socket hang up')
}

async function waitForSidecarReady(
  baseUrl: string,
  timeoutMs: number,
  pollMs = 100,
): Promise<boolean> {
  if (sidecarHealthyEver) return true
  if (timeoutMs <= 0) return false
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(Math.min(1_000, timeoutMs)) })
      if (res.ok) {
        sidecarHealthyEver = true
        return true
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return false
}

export async function fetchSidecarJson(
  path: string,
  options: { timeoutMs?: number; startupWaitMs?: number; baseUrl?: string } = {},
): Promise<Response> {
  const baseUrl = options.baseUrl ?? DEFAULT_SIDECAR_BASE_URL
  const timeoutMs = options.timeoutMs ?? 15_000
  const startupWaitMs = options.startupWaitMs ?? 8_000
  const url = `${baseUrl}${path}`

  const runFetch = async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    sidecarHealthyEver = true
    return res
  }

  try {
    return await runFetch()
  } catch (error) {
    if (!sidecarHealthyEver && isImmediateLocalConnectFailure(error)) {
      const ready = await waitForSidecarReady(baseUrl, startupWaitMs)
      if (!ready) throw new SidecarStartupError()
      return await runFetch()
    }
    throw error
  }
}
