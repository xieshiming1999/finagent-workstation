import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { PromptBuilder } from '../../src/agent/prompt-builder'
import type { Tool } from '../../src/agent/tool'
import { InteractionEvidenceTool } from '../../src/agent/tools/interaction-evidence'
import { ToolCatalogTool } from '../../src/agent/tools/tool-catalog'

describe('PromptBuilder tool capability disclosure', () => {
  it('includes generated tool flags and action values in the available tool list', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-prompt-capability-'))
    const tool: Tool = {
      name: 'Example',
      description: 'Example broad tool',
      isReadOnly: false,
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['help', 'run'] },
        },
      },
      async call() { return 'ok' },
    }

    const prompt = new PromptBuilder(basePath, basePath).build([tool])

    expect(prompt).toContain('# Available Tools')
    expect(prompt).toContain('- Example [write-or-side-effect, serial, actions=help|run]: Example broad tool')
  })

  it('exposes InteractionEvidence as an agent-discoverable harness inspection tool', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-prompt-capability-'))
    const prompt = new PromptBuilder(basePath, basePath).build([new InteractionEvidenceTool()])

    expect(prompt).toContain('# Available Tools')
    expect(prompt).toContain('- InteractionEvidence [read-only, parallel-ok, actions=help|recent|summary]:')
  })

  it('exposes ToolCatalog as the agent-discoverable tool inspection surface', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-prompt-capability-'))
    const prompt = new PromptBuilder(basePath, basePath).build([
      new ToolCatalogTool(() => []),
    ])

    expect(prompt).toContain('# Available Tools')
    expect(prompt).toContain('- ToolCatalog [read-only, parallel-ok, actions=detail|help|list|module|modules]:')
  })
})
