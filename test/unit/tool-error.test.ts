import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { ToolRegistry, needsPermissionForInput, requiresUserInteraction, summarizeToolCapability, toolError, type Tool } from '../../src/agent/tool'
import { AskUserQuestionTool } from '../../src/agent/tools/ask-user'
import { canDelegateToolToSubAgent } from '../../src/agent/tools/agent-tools'
import { FileReadTool } from '../../src/agent/tools/file-read'
import { GlobTool } from '../../src/agent/tools/glob'
import { GrepTool } from '../../src/agent/tools/grep'
import { LSTool } from '../../src/agent/tools/ls'
import { SessionSearchTool } from '../../src/agent/tools/session-search'
import { UIQueryTool } from '../../src/agent/tools/ui-tools'

describe('explicit tool errors', () => {
  it('throws explicit tool failures through the helper', () => {
    expect(() => toolError('missing input')).toThrow('missing input')
  })

  it('keeps desktop tools from returning error-looking strings as success', () => {
    const toolsDir = join(process.cwd(), 'src', 'agent', 'tools')
    const offenders: string[] = []
    for (const file of listTsFiles(toolsDir)) {
      const text = readFileSync(file, 'utf-8')
      const callStart = text.indexOf(' call(')
      const scanned = callStart >= 0 ? text.slice(callStart) : text
      const pattern = /return\s+(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g
      for (const match of scanned.matchAll(pattern)) {
        const literal = match[1] ?? match[2] ?? match[3] ?? ''
        if (/^(Error|Invalid regex|Error searching|Error writing|Failed to|failed to|Unsupported|Missing|required)/.test(literal.trim())) {
          offenders.push(`${file.replace(`${process.cwd()}/`, '')}: ${literal.slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('needsPermissionForInput', () => {
  const tool = (name: string, isReadOnly = false): Tool => ({
    name,
    description: name,
    inputSchema: {},
    isReadOnly,
    async call() { return 'ok' },
  })

  it('auto-allows trusted runtime UI and artifact tools', () => {
    const approved = new Set<string>()
    expect(needsPermissionForInput(tool('Dashboard'), {}, approved, false)).toBe(false)
    expect(needsPermissionForInput(tool('WebView'), {}, approved, false)).toBe(false)
    expect(needsPermissionForInput(tool('Screenshot'), {}, approved, false)).toBe(false)
    expect(needsPermissionForInput(tool('PageRender'), {}, approved, false)).toBe(false)
    expect(needsPermissionForInput(tool('ImageCrop'), {}, approved, false)).toBe(false)
    expect(needsPermissionForInput(tool('DataTask'), {}, approved, false)).toBe(false)
  })

  it('still asks for untrusted write tools by default', () => {
    expect(needsPermissionForInput(tool('Write'), {}, new Set(), false)).toBe(true)
    expect(needsPermissionForInput(tool('Bash'), {}, new Set(), false)).toBe(true)
    expect(needsPermissionForInput(tool('XueqiuTrade'), {}, new Set(), false)).toBe(true)
  })

  it('keeps the desktop read-only local tool family permission-free', () => {
    const readOnlyTools: Tool[] = [
      new FileReadTool(),
      new LSTool(),
      new GrepTool(),
      new GlobTool(),
      new SessionSearchTool('/tmp'),
      new UIQueryTool(async () => ({})),
    ]

    for (const readOnlyTool of readOnlyTools) {
      expect(readOnlyTool.isReadOnly, readOnlyTool.name).toBe(true)
      expect(needsPermissionForInput(readOnlyTool, {}, new Set(), false), readOnlyTool.name).toBe(false)
    }
  })
})

describe('requiresUserInteraction', () => {
  const tool = (name: string, requiresInteraction = false): Tool => ({
    name,
    description: name,
    inputSchema: {},
    isReadOnly: true,
    requiresUserInteraction: requiresInteraction,
    async call() { return 'ok' },
  })

  it('marks AskUserQuestion as an interactive desktop tool', () => {
    const askUser = new AskUserQuestionTool()
    expect(requiresUserInteraction(askUser)).toBe(true)
  })

  it('keeps interactive tools out of delegated sub-agent registries', () => {
    expect(canDelegateToolToSubAgent(tool('InteractivePicker', true))).toBe(false)
    expect(canDelegateToolToSubAgent(tool('ReadOnlyProbe', false))).toBe(true)
  })

  it('still blocks recursive delegation tools even without interaction metadata', () => {
    expect(canDelegateToolToSubAgent(tool('Agent', false))).toBe(false)
    expect(canDelegateToolToSubAgent(tool('TeamCreate', false))).toBe(false)
  })
})

describe('tool capability summaries', () => {
  it('summarizes interaction, permission, schema keys, and action discovery from code', () => {
    const tool: Tool = {
      name: 'Example',
      description: 'Example broad tool',
      isReadOnly: false,
      requiresUserInteraction: true,
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['help', 'run'] },
          symbol: { type: 'string' },
        },
      },
      needsPermissions(input) {
        return input.action === 'run'
      },
      async call() { return 'ok' },
    }

    expect(summarizeToolCapability(tool)).toMatchObject({
      name: 'Example',
      readOnly: false,
      canParallel: false,
      requiresUserInteraction: true,
      permission: 'input-dependent',
      schema: {
        propertyNames: ['action', 'symbol'],
        required: ['action'],
        actionValues: ['help', 'run'],
      },
    })
  })

  it('exposes registry capabilities for progressive discovery', () => {
    const registry = new ToolRegistry()
    registry.register(new AskUserQuestionTool())

    const ask = registry.capabilities().find((capability) => capability.name === 'AskUserQuestion')
    expect(ask).toMatchObject({
      readOnly: true,
      requiresUserInteraction: true,
      permission: 'read-only',
    })
    expect(ask?.schema.propertyNames).toContain('question')
  })
})

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...listTsFiles(path))
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}
