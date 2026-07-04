export interface SourceConfig {
  id: string
  name: string
  description: string
  enabled: boolean
  priority: number
  status: 'online' | 'degraded' | 'offline' | 'unknown'
  interval: number
  errors: number
  lastCall: number
}

export function fmtN(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export async function ipc(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window as any).electron?.ipcRenderer?.invoke(channel, ...args)
}
