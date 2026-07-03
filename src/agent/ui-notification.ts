import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface UINotification {
  id: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'error' | 'alert'
  source: string
  timestamp: string
  read: boolean
}

export class UINotificationStore {
  private notifications: UINotification[] = []
  private storageDir: string
  private nextId = 1

  constructor(storageDir: string) {
    this.storageDir = storageDir
    this.load()
  }

  add(title: string, message: string, severity: UINotification['severity'] = 'info', source: string = 'agent'): UINotification {
    const notification: UINotification = {
      id: `n-${this.nextId++}`,
      title,
      message,
      severity,
      source,
      timestamp: new Date().toISOString(),
      read: false,
    }
    this.notifications.push(notification)
    if (this.notifications.length > 200) this.notifications.shift()
    this.save()
    return notification
  }

  list(): UINotification[] { return [...this.notifications] }
  unreadCount(): number { return this.notifications.filter((n) => !n.read).length }

  markRead(id: string): void {
    const n = this.notifications.find((x) => x.id === id)
    if (n) { n.read = true; this.save() }
  }

  markAllRead(): void {
    for (const n of this.notifications) n.read = true
    this.save()
  }

  clear(): void {
    this.notifications = []
    this.save()
  }

  private load(): void {
    const filePath = join(this.storageDir, 'notifications.json')
    if (!existsSync(filePath)) return
    try {
      this.notifications = JSON.parse(readFileSync(filePath, 'utf-8'))
      this.nextId = Math.max(...this.notifications.map((n) => parseInt(n.id.replace('n-', ''), 10) || 0), 0) + 1
    } catch { /* */ }
  }

  private save(): void {
    mkdirSync(this.storageDir, { recursive: true })
    writeFileSync(join(this.storageDir, 'notifications.json'), JSON.stringify(this.notifications, null, 2), 'utf-8')
  }
}
