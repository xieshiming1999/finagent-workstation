import { describe, expect, it } from 'vitest'
import { RunServiceAgentEventObserver } from '../../src/main/run-service-agent-event-observer'

describe('run service agent event observer', () => {
  it('emits live tool and managed artifact events', () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = []
    const observer = new RunServiceAgentEventObserver((type, payload) => {
      events.push({ type, payload })
    })

    observer.observe({
      type: 'tool-use-start',
      id: 'tool-1',
      name: 'ArtifactRegistry',
      input: { action: 'register' },
    })
    observer.observe({
      type: 'tool-result',
      id: 'tool-1',
      name: 'ArtifactRegistry',
      result: JSON.stringify({
        managedArtifact: true,
        artifact: {
          id: 'strategy:item.json',
          kind: 'strategy',
          stableRef: 'artifact:strategy:item.json',
          title: 'Review',
        },
      }),
      isError: false,
      durationMs: 12,
    })

    expect(events.map((event) => event.type)).toEqual([
      'tool.call',
      'tool.result',
      'artifact.created',
    ])
    expect(events.at(-1)?.payload?.artifactId).toBe('strategy:item.json')
  })

  it('bounds live tool result payloads', () => {
    const payloads: Array<Record<string, unknown>> = []
    const observer = new RunServiceAgentEventObserver((type, payload) => {
      if (type === 'tool.result' && payload) payloads.push(payload)
    })

    observer.observe({
      type: 'tool-result',
      name: 'MarketData',
      result: 'x'.repeat(13_000),
      isError: false,
      durationMs: 1,
    })

    expect(payloads[0]?.result).toContain('<truncated 1000 chars>')
  })
})
