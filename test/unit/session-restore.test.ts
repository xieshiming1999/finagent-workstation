import { describe, expect, it } from 'vitest'
import { restoreChatMessages } from '../../src/renderer/store/sessionRestore'

describe('restoreChatMessages', () => {
  it('restores assistant content and tool uses from the same serialized message', () => {
    const restored = restoreChatMessages([
      {
        role: 'assistant',
        content: 'I will read the file.',
        toolUses: [{ name: 'Read', input: { file_path: 'memory/pages/a.html' } }],
      },
    ])

    expect(restored.map((m) => m.role)).toEqual(['assistant', 'tool-use'])
    expect(restored[0].content).toBe('I will read the file.')
    expect(restored[1].content).toContain('Read(')
  })

  it('summarizes restored WebView execute tool calls without showing script bodies', () => {
    const restored = restoreChatMessages([
      {
        role: 'assistant',
        toolUses: [{
          name: 'WebView',
          input: {
            action: 'execute',
            id: 'dash-600519-k6j5z3',
            script: '(async () => { const resp = await Bridge.fetch("/api/finance/quote", { code: "600519" }, "GET"); return resp; })();',
          },
        }],
      },
    ])

    expect(restored[0].content).toBe('WebView(execute, dash-600519-k6j5z3, script 115 chars)')
    expect(restored[0].content).not.toContain('Bridge.fetch')
  })

  it('only restores tool result rows when requested', () => {
    const msgs = [{
      role: 'tool',
      toolResult: { content: 'file content', isError: false },
    }]

    expect(restoreChatMessages(msgs).map((m) => m.role)).toEqual([])
    expect(restoreChatMessages(msgs, { includeToolResults: true }).map((m) => m.role)).toEqual(['tool-result'])
  })
})
