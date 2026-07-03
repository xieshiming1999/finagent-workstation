import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface Monitor {
  id: string
  name: string
  script: string
  intervalSeconds: number
  condition?: string
  displayType: string
  enabled: boolean
  userPrompt?: string
  description?: string
  groupId?: string
  groupName?: string
  strategyId?: string
  strategyRules?: Record<string, unknown>
  streamUrl?: string
  state: Record<string, unknown>
  lastResult?: Record<string, unknown>
  lastRunTime?: string
  lastError?: string
  conditionTriggered: boolean
  hasUnreadAlert: boolean
  alertMessage?: string
}

const MAX_MONITORS = 50

export class MonitorStore {
  private monitors = new Map<string, Monitor>()
  private filePath: string
  onChanged: (() => void) | null = null

  constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'monitors.json')
  }

  get list(): Monitor[] { return Array.from(this.monitors.values()) }
  get count(): number { return this.monitors.size }
  get(id: string): Monitor | undefined { return this.monitors.get(id) }

  load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const list = JSON.parse(readFileSync(this.filePath, 'utf-8')) as any[]
      this.monitors.clear()
      for (const item of list) {
        this.monitors.set(item.id, {
          id: item.id, name: item.name ?? '', script: item.script ?? '',
          intervalSeconds: item.intervalSeconds ?? 300,
          condition: item.condition, displayType: item.displayType ?? 'value_card',
          enabled: item.enabled ?? true, userPrompt: item.userPrompt,
          description: item.description, groupId: item.groupId, groupName: item.groupName,
          strategyId: item.strategyId,
          strategyRules: item.strategyRules && typeof item.strategyRules === 'object' && !Array.isArray(item.strategyRules) ? item.strategyRules : undefined,
          streamUrl: item.streamUrl,
          state: item.state ?? {}, lastResult: item.lastResult,
          lastRunTime: item.lastRunTime, lastError: item.lastError,
          conditionTriggered: item.conditionTriggered ?? false,
          hasUnreadAlert: item.hasUnreadAlert ?? false, alertMessage: item.alertMessage,
        })
      }
    } catch (e) {
      console.error('[MonitorStore] Load error:', e)
    }
  }

  save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(Array.from(this.monitors.values()), null, 2), 'utf-8')
    } catch (e) {
      console.error('[MonitorStore] Save error:', e)
    }
  }

  add(monitor: Monitor): string {
    if (this.monitors.size >= MAX_MONITORS) {
      return `Cannot create monitor: maximum limit (${MAX_MONITORS}) reached.`
    }
    this.monitors.set(monitor.id, monitor)
    this.save()
    this.onChanged?.()
    return ''
  }

  remove(id: string): boolean {
    if (this.monitors.delete(id)) { this.save(); this.onChanged?.(); return true }
    return false
  }

  updateResult(id: string, result: Record<string, unknown>, state: Record<string, unknown>): void {
    const m = this.monitors.get(id)
    if (!m) return
    m.lastResult = result; m.state = state
    m.lastRunTime = new Date().toISOString(); m.lastError = undefined
    this.save(); this.onChanged?.()
  }

  updateError(id: string, error: string): void {
    const m = this.monitors.get(id)
    if (!m) return
    m.lastError = error; m.lastRunTime = new Date().toISOString()
    this.save(); this.onChanged?.()
  }

  setEnabled(id: string, enabled: boolean): void {
    const m = this.monitors.get(id)
    if (!m) return; m.enabled = enabled; this.save(); this.onChanged?.()
  }

  setAlert(id: string, message: string): void {
    const m = this.monitors.get(id)
    if (!m) return; m.hasUnreadAlert = true; m.alertMessage = message
    this.save(); this.onChanged?.()
  }

  clearAlert(id: string): void {
    const m = this.monitors.get(id)
    if (!m || !m.hasUnreadAlert) return; m.hasUnreadAlert = false
    this.save(); this.onChanged?.()
  }

  toSummary(id: string): string {
    const m = this.monitors.get(id)
    if (!m) return `Monitor ${id} not found`
    const status = m.enabled ? (m.lastError ? 'error' : 'ok') : 'disabled'
    const lastRun = m.lastRunTime?.slice(11, 19) ?? 'never'
    const preview = m.lastResult ? JSON.stringify(m.lastResult).slice(0, 100) : '(no data)'
    const strategy = m.strategyId ? `\n  strategyId: ${m.strategyId}` : ''
    const rules = m.strategyRules ? `\n  strategyRules: ${JSON.stringify(m.strategyRules)}` : ''
    return `[${status}] ${m.name} (id: ${m.id}, interval: ${Math.floor(m.intervalSeconds / 60)}m, lastRun: ${lastRun})${strategy}${rules}\n  result: ${preview}`
  }
}
