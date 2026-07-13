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
      this.emit('tool.call', {
        toolUseId: event.id,
        toolName: event.name,
        input: event.input,
      })
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
    if (event.type === 'tool-result') {
      this.emit('tool.result', {
        ...(event.id ? { toolUseId: event.id } : {}),
        toolName: event.name,
        isError: event.isError,
        durationMs: event.durationMs,
        result: boundedText(event.result),
      })
      const artifact = managedArtifactPayload(event.name, event.result)
      if (artifact) this.emit('artifact.created', artifact)
      if (event.id && this.pendingInteractions.delete(event.id)) {
        this.emit('interaction.resolved', {
          requestId: event.id,
          tool: event.name,
          isError: event.isError,
        })
      }
      if (event.id && this.pendingPermissions.delete(event.id)) {
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

function boundedText(value: string, limit = 12_000): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...<truncated ${value.length - limit} chars>`
}

function managedArtifactPayload(
  toolName: string,
  result: string,
): Record<string, unknown> | undefined {
  if (toolName !== 'ArtifactRegistry') return undefined
  try {
    const decoded = JSON.parse(result) as {
      managedArtifact?: boolean
      artifact?: Record<string, unknown>
    }
    if (decoded.managedArtifact !== true || !decoded.artifact) return undefined
    return {
      kind: String(decoded.artifact.kind ?? 'artifact'),
      artifactId: String(decoded.artifact.id ?? ''),
      stableRef: String(decoded.artifact.stableRef ?? ''),
      title: String(decoded.artifact.title ?? ''),
      managedArtifact: true,
    }
  } catch {
    return undefined
  }
}
