import { describe, expect, it } from 'vitest'
import { executeToolCalls, type ToolExecutionResult } from '../../src/agent/agent-tool-execution'
import { ToolRegistry, type Tool, type ToolContext } from '../../src/agent/tool'
import type { ToolUse } from '../../src/agent/message'

describe('executeToolCalls permission denial', () => {
  it('stops the current tool batch after an explicit deny rule', async () => {
    const registry = registryWith('Write', 'Read')
    const executed: string[] = []
    const persisted: string[] = []

    const events = await collect(executeToolCalls({
      toolCalls: [
        { id: '1', name: 'Write', input: { file_path: 'memory/a.md' } },
        { id: '2', name: 'Read', input: { file_path: 'memory/a.md' } },
      ],
      tools: registry,
      ctx: {} as ToolContext,
      isCancelled: () => false,
      permissionDecision: (tool) => tool.name === 'Write' ? 'deny' : 'allow',
      waitForPermissionConfirmation: async () => ({ approved: true }),
      approveToolPermanently: () => {},
      executeToolCall: executeAndRecord(executed),
      pushAndPersist: (msg) => persisted.push(msg.toolResult?.content ?? ''),
    }))

    expect(executed).toEqual([])
    expect(events.map((event) => event.type)).toEqual(['tool-result'])
    expect(events[0]).toMatchObject({ name: 'Write', isError: true })
    expect(persisted[0]).toContain('Tool use was rejected by permission rule: Write')
  })

  it('stops the current tool batch after user rejection', async () => {
    const registry = registryWith('Write', 'Read')
    const executed: string[] = []
    const persisted: string[] = []

    const events = await collect(executeToolCalls({
      toolCalls: [
        { id: '1', name: 'Write', input: { file_path: 'memory/a.md' } },
        { id: '2', name: 'Read', input: { file_path: 'memory/a.md' } },
      ],
      tools: registry,
      ctx: {} as ToolContext,
      isCancelled: () => false,
      permissionDecision: (tool) => tool.name === 'Write' ? 'ask' : 'allow',
      waitForPermissionConfirmation: async () => ({ approved: false, rejectReason: 'Do not write.' }),
      approveToolPermanently: () => {},
      executeToolCall: executeAndRecord(executed),
      pushAndPersist: (msg) => persisted.push(msg.toolResult?.content ?? ''),
    }))

    expect(executed).toEqual([])
    expect(events.map((event) => event.type)).toEqual(['tool-confirm-request', 'tool-result'])
    expect(events[1]).toMatchObject({ name: 'Write', isError: true })
    expect(persisted[0]).toContain('Tool use was rejected by the user. Feedback: Do not write.')
  })
})

function registryWith(...names: string[]): ToolRegistry {
  const registry = new ToolRegistry()
  for (const name of names) {
    registry.register({
      name,
      description: name,
      inputSchema: {},
      isReadOnly: name === 'Read',
      async call() { return `${name} ok` },
    })
  }
  return registry
}

function executeAndRecord(executed: string[]) {
  return async (tc: ToolUse, tool: Tool): Promise<ToolExecutionResult> => {
    executed.push(tool.name)
    return { name: tc.name, result: `${tc.name} ok`, isError: false, durationMs: 1 }
  }
}

async function collect<T>(events: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const event of events) out.push(event)
  return out
}
