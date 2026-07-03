import { homedir, platform, arch, totalmem, freemem } from 'os'
import type { Tool, ToolContext } from '../tool'

export class EnvironmentTool implements Tool {
  name = 'Environment'
  description = 'Get system environment information: OS, memory, Node version, paths, and environment variables.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['info', 'env'],
        description: 'info (system info, default) or env (environment variables)',
      },
      key: { type: 'string', description: 'Specific env var to read (for env action)' },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'info')

    if (action === 'env') {
      const key = input.key ? String(input.key) : undefined
      if (key) return process.env[key] ?? `(not set: ${key})`
      const safe = Object.entries(process.env)
        .filter(([k]) => !k.toLowerCase().includes('key') && !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('token') && !k.toLowerCase().includes('password'))
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 50)
      return safe.join('\n')
    }

    const total = (totalmem() / 1e9).toFixed(1)
    const free = (freemem() / 1e9).toFixed(1)

    return [
      `Platform: ${platform()} ${arch()}`,
      `Node: ${process.version}`,
      `Memory: ${free}GB free / ${total}GB total`,
      `Home: ${homedir()}`,
      `Base path: ${ctx.basePath}`,
      `CWD: ${process.cwd()}`,
      `Date: ${new Date().toISOString()}`,
    ].join('\n')
  }
}
