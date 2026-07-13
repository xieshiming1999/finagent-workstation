import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '../../src/agent/agent'
import type { WorkflowAutomationControl } from '../../src/main/workflow-automation-control'
import { sendPromptToChatAgent, type IPCContext } from '../../src/main/ipc-handlers'

describe('frontend run-service routing', () => {
  it('submits idle chat through attached visible service state', async () => {
    const runServicePrompt = vi.fn(async () => ({ status: 'completed' }))
    const directRun = vi.fn()
    const agent = {
      isRunning: false,
      session: { id: 'session-visible' },
      llm: { model: 'test-model' },
      run: directRun,
    } as unknown as Agent
    const ctx = {
      getAgent: () => agent,
      getWorkflowControl: () => ({ runServicePrompt } as unknown as WorkflowAutomationControl),
    } as unknown as IPCContext
    const send = vi.fn()

    await sendPromptToChatAgent(ctx, { sender: { send } } as never, 'frontend prompt')

    expect(runServicePrompt).toHaveBeenCalledWith({
      prompt: 'frontend prompt',
      sessionMode: 'attached',
      sessionId: 'session-visible',
      uiRuntime: 'visible',
      payload: { entryMode: 'frontend' },
    })
    expect(directRun).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('preserves queued input while an existing turn is running', async () => {
    const runServicePrompt = vi.fn()
    const enqueueUserInput = vi.fn()
    const agent = {
      isRunning: true,
      session: { id: 'session-visible' },
      llm: { model: 'test-model' },
      notifications: { length: 1 },
      enqueueUserInput,
    } as unknown as Agent
    const ctx = {
      getAgent: () => agent,
      getWorkflowControl: () => ({ runServicePrompt } as unknown as WorkflowAutomationControl),
    } as unknown as IPCContext
    const send = vi.fn()

    await sendPromptToChatAgent(ctx, { sender: { send } } as never, 'queued prompt')

    expect(enqueueUserInput).toHaveBeenCalledWith('queued prompt')
    expect(runServicePrompt).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('agent:event', expect.objectContaining({ type: 'queue-status' }))
  })
})
