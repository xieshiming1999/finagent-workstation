import type { Tool } from '../tool'
import { toolError } from '../tool'
import type { CronScheduler } from '../cron-scheduler'

export class CronCreateTool implements Tool {
  name = 'CronCreate'
  description = 'Schedule a recurring or one-shot task using a cron expression, interval, or delay. Jobs fire when the event agent is active.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      cron: { type: 'string', description: 'Schedule expression. Supports standard 5-field cron ("M H DoM Mon DoW"), interval ("every 30 seconds"), or delay ("in 1 hour").' },
      prompt: { type: 'string', description: 'The prompt to execute at each fire time' },
      recurring: { type: 'boolean', description: 'true = repeat, false = fire once (default: true)' },
      durable: { type: 'boolean', description: 'true = persist across restarts (default: false)' },
    },
    required: ['cron', 'prompt'],
  }

  constructor(private scheduler: CronScheduler) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.cron) return 'cron is required. Use standard 5-field cron, "every N second|minute|hour|day", or "in/after N second|minute|hour|day".'
    if (!input.prompt) return 'prompt is required. The text to execute at each fire time.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const job = this.scheduler.create({
      cron: String(input.cron),
      prompt: String(input.prompt),
      recurring: input.recurring !== false,
      durable: Boolean(input.durable ?? false),
    })
    return `Cron job #${job.id} created. Schedule: ${job.schedule}${job.recurring ? ' (recurring, 7-day expiry)' : ' (one-shot)'}`
  }
}

export class CronDeleteTool implements Tool {
  name = 'CronDelete'
  description = 'Delete a scheduled cron job by ID.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: { id: { type: 'string', description: 'Job ID to delete' } },
    required: ['id'],
  }

  constructor(private scheduler: CronScheduler) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.id) return 'id is required. Provide the job ID to delete.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    return this.scheduler.delete(String(input.id))
      ? `Cron job #${input.id} deleted.`
      : toolError(`Job not found: ${input.id}`)
  }
}

export class CronListTool implements Tool {
  name = 'CronList'
  description = 'List all scheduled cron jobs.'
  isReadOnly = true
  inputSchema = { type: 'object', properties: {} }

  constructor(private scheduler: CronScheduler) {}

  async call(): Promise<string> {
    const jobs = this.scheduler.list()
    if (jobs.length === 0) return 'No scheduled jobs.'
    return jobs.map((j) =>
      `#${j.id} [${j.recurring ? 'recurring' : 'one-shot'}${j.durable ? ', durable' : ''}] ${j.schedule} — ${j.prompt.slice(0, 80)}${j.lastFired ? ` (last: ${j.lastFired})` : ''}${j.nextFire ? ` (next: ${j.nextFire})` : ''}`
    ).join('\n')
  }
}
