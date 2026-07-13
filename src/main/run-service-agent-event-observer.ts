import type { AgentEvent } from '../agent/agent-event'
import type { RunServiceEventType } from '../agent/run-service-contract'

export type RunServiceEventSink = (
  type: RunServiceEventType,
  payload?: Record<string, unknown>,
) => void

export class RunServiceAgentEventObserver {
  private readonly pendingInteractions = new Map<string, string>()
  private readonly pendingPermissions = new Map<string, string>()

  constructor(private readonly emit?: RunServiceEventSink) {}

  observe(event: AgentEvent): void {
    if (!this.emit) return
    if (event.type === 'text-delta' && event.text) {
      this.emit('assistant.delta', { text: event.text })
    }
    if (event.type === 'tool-confirm-request') {
      this.pendingPermissions.set(event.requestId, event.name)
      this.emit('permission.required', {
        requestId: event.requestId,
        tool: event.name,
        input: event.input,
      })
    }
    if (event.type === 'tool-use-start') {
      const permissionTool = this.pendingPermissions.get(event.id)
      if (permissionTool) {
        this.emit('permission.resolved', {
          requestId: event.id,
          tool: permissionTool,
          approved: true,
        })
        this.pendingPermissions.delete(event.id)
      }
      if (event.name === 'AskUserQuestion') {
        this.pendingInteractions.set(event.id, event.name)
        this.emit('interaction.required', {
          requestId: event.id,
          tool: event.name,
          input: event.input,
        })
      }
    }
    if (event.type === 'tool-result' && event.id) {
      if (this.pendingInteractions.delete(event.id)) {
        this.emit('interaction.resolved', {
          requestId: event.id,
          tool: event.name,
          isError: event.isError,
        })
      }
      if (this.pendingPermissions.delete(event.id)) {
        this.emit('permission.resolved', {
          requestId: event.id,
          tool: event.name,
          approved: false,
          isError: event.isError,
        })
      }
    }
  }
}
