import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent } from '../agent/agent-event'

export interface LogSnapshot {
  path: string
  content: string
  files: Array<{ name: string; path: string; size: number; modified: string }>
  truncated: boolean
}

export interface AgentAPI {
  send: (prompt: string) => Promise<void>
  sendEventAgent: (prompt: string) => Promise<void>
  cancelEventAgent: () => Promise<void>
  backgroundEventAgent: () => Promise<string | null>
  clearEventAgentQueue: () => Promise<boolean>
  pauseEventAgentQueue: (paused: boolean) => Promise<boolean>
  cancel: () => Promise<void>
  background: () => Promise<string | null>
  clear: () => Promise<void>
  history: () => Promise<Array<{ name: string; path: string }>>
  sessions: () => Promise<Array<{ name: string; path: string }>>
  resume: (filePath: string) => Promise<void>
  resolvePermission: (result: { approved: boolean; alwaysAllow?: boolean; rejectReason?: string }) => Promise<void>
  getConfig: () => Promise<unknown>
  setConfig: (cfg: unknown) => Promise<boolean>
  getAssetPath: (relativePath: string) => Promise<string>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
  getWebviewPreload: () => Promise<string>
  getRecentLog: () => Promise<LogSnapshot>
  getLogs: () => Promise<LogSnapshot>
  logWebviewTrace: (event: unknown) => Promise<void>
  bridgeMessage: (msg: unknown) => Promise<unknown>
  getApiStats: () => Promise<unknown>
  getResearchWorkspace: () => Promise<unknown>
  getSidecarStatus: () => Promise<unknown>
  getMcpStatus: () => Promise<unknown>
  getPlugins: () => Promise<unknown>
  getHooks: () => Promise<unknown>
  getGoalAutomation: () => Promise<unknown>
  getGoalAutomationSuggestions: () => Promise<unknown>
  acceptGoalAutomationSuggestion: (ref: string) => Promise<unknown>
  dismissGoalAutomationSuggestion: (ref: string) => Promise<unknown>
  runGoalAutomation: (templateId: string) => Promise<unknown>
  setGoalAutomationEnabled: (templateId: string, enabled: boolean) => Promise<unknown>
  pauseGoalAutomation: (templateId: string, paused: boolean) => Promise<unknown>
  listDashboards: () => Promise<Array<{ name: string; path: string; size: number; modified: string }>>
  listStrategies: () => Promise<unknown>
  runStrategyAction: (action: string, strategyId: string) => Promise<unknown>
  getCalendar: () => Promise<unknown>
  saveCalendar: (calendar: unknown) => Promise<boolean>
  fetchCalendar: (year: number) => Promise<unknown>
  getSessionMessages: () => Promise<Array<{ role: string; content: string }>>
  getEventAgentSessionMessages: () => Promise<Array<{ role: string; content: string }>>
  logContextTrace: (event: unknown) => Promise<void>
  onEvent: (callback: (event: AgentEvent) => void) => () => void
  onEventAgentEvent: (callback: (event: AgentEvent) => void) => () => void
}

const api: AgentAPI = {
  send: (prompt) => ipcRenderer.invoke('agent:send', prompt),
  sendEventAgent: (prompt) => ipcRenderer.invoke('eventAgent:send', prompt),
  cancelEventAgent: () => ipcRenderer.invoke('eventAgent:cancel'),
  backgroundEventAgent: () => ipcRenderer.invoke('eventAgent:background'),
  clearEventAgentQueue: () => ipcRenderer.invoke('eventAgent:queueClear'),
  pauseEventAgentQueue: (paused) => ipcRenderer.invoke('eventAgent:queuePause', paused),
  cancel: () => ipcRenderer.invoke('agent:cancel'),
  background: () => ipcRenderer.invoke('agent:background'),
  clear: () => ipcRenderer.invoke('agent:clear'),
  history: () => ipcRenderer.invoke('agent:history'),
  sessions: () => ipcRenderer.invoke('agent:sessions'),
  resume: (filePath) => ipcRenderer.invoke('agent:resume', filePath),
  resolvePermission: (result) => ipcRenderer.invoke('agent:resolvePermission', result),
  getConfig: () => ipcRenderer.invoke('agent:getConfig'),
  setConfig: (cfg) => ipcRenderer.invoke('agent:setConfig', cfg),
  getAssetPath: (relativePath) => ipcRenderer.invoke('app:assetPath', relativePath),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getWebviewPreload: () => ipcRenderer.invoke('app:webviewPreload'),
  getRecentLog: () => ipcRenderer.invoke('app:recentLog'),
  getLogs: () => ipcRenderer.invoke('app:logs'),
  logWebviewTrace: (event) => ipcRenderer.invoke('app:webviewTrace', event),
  bridgeMessage: (msg) => ipcRenderer.invoke('bridge:message', msg),
  getApiStats: () => ipcRenderer.invoke('api:stats'),
  getResearchWorkspace: () => ipcRenderer.invoke('research:workspace'),
  getSidecarStatus: () => ipcRenderer.invoke('sidecar:status'),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),
  getPlugins: () => ipcRenderer.invoke('plugins:list'),
  getHooks: () => ipcRenderer.invoke('hooks:list'),
  getGoalAutomation: () => ipcRenderer.invoke('goalAutomation:list'),
  getGoalAutomationSuggestions: () => ipcRenderer.invoke('goalAutomation:suggestions'),
  acceptGoalAutomationSuggestion: (ref) => ipcRenderer.invoke('goalAutomation:acceptSuggestion', ref),
  dismissGoalAutomationSuggestion: (ref) => ipcRenderer.invoke('goalAutomation:dismissSuggestion', ref),
  runGoalAutomation: (templateId) => ipcRenderer.invoke('goalAutomation:runNow', templateId),
  setGoalAutomationEnabled: (templateId, enabled) => ipcRenderer.invoke('goalAutomation:setEnabled', templateId, enabled),
  pauseGoalAutomation: (templateId, paused) => ipcRenderer.invoke('goalAutomation:pause', templateId, paused),
  listDashboards: () => ipcRenderer.invoke('dashboard:list'),
  listStrategies: () => ipcRenderer.invoke('strategy:library'),
  runStrategyAction: (action, strategyId) => ipcRenderer.invoke('strategy:action', { action, strategyId }),
  getCalendar: () => ipcRenderer.invoke('calendar:get'),
  saveCalendar: (calendar) => ipcRenderer.invoke('calendar:save', calendar),
  fetchCalendar: (year) => ipcRenderer.invoke('calendar:fetch', year),
  getSessionMessages: () => ipcRenderer.invoke('agent:sessionMessages'),
  getEventAgentSessionMessages: () => ipcRenderer.invoke('eventAgent:sessionMessages'),
  logContextTrace: (event) => ipcRenderer.invoke('agent:contextTrace', event),
  onEvent: (callback) => {
    const listener = (_: unknown, ev: AgentEvent) => callback(ev)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.off('agent:event', listener)
  },
  onEventAgentEvent: (callback) => {
    const listener = (_: unknown, ev: AgentEvent) => callback(ev)
    ipcRenderer.on('event-agent:event', listener)
    return () => ipcRenderer.off('event-agent:event', listener)
  },
}

contextBridge.exposeInMainWorld('agent', api)

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  },
})

declare global {
  interface Window {
    agent: AgentAPI
  }
}
