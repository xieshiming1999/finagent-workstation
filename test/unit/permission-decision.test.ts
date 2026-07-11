import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { permissionDecisionForTool } from '../../src/agent/agent-turn-utils'
import { PermissionManager } from '../../src/agent/permission-manager'
import type { Tool } from '../../src/agent/tool'

describe('permissionDecisionForTool', () => {
  it('uses the global bypass to skip routine permission prompts', () => {
    const permissions = tempPermissionManager()
    const approved = new Set<string>()

    expect(permissionDecisionForTool(true, permissions, approved, tool('Write'), {
      file_path: 'memory/a.md',
    })).toBe('allow')
  })

  it('asks for untrusted write tools when the global bypass is disabled', () => {
    const permissions = tempPermissionManager()
    const approved = new Set<string>()

    expect(permissionDecisionForTool(false, permissions, approved, tool('Write'), {
      file_path: 'memory/a.md',
    })).toBe('ask')
  })

  it('keeps read-only tools permission-free when the global bypass is disabled', () => {
    const permissions = tempPermissionManager()
    const approved = new Set<string>()

    expect(permissionDecisionForTool(false, permissions, approved, tool('Read', true), {
      file_path: 'memory/a.md',
    })).toBe('allow')
  })

  it('respects explicit rules when the global bypass is disabled', () => {
    const permissions = tempPermissionManager()
    permissions.addRule({ toolName: 'Write', action: 'deny' })
    const approved = new Set<string>()

    expect(permissionDecisionForTool(false, permissions, approved, tool('Write'), {
      file_path: 'memory/a.md',
    })).toBe('deny')
  })
})

function tempPermissionManager(): PermissionManager {
  return new PermissionManager(mkdtempSync(join(tmpdir(), 'finagent-permissions-')))
}

function tool(name: string, isReadOnly = false): Tool {
  return {
    name,
    description: name,
    inputSchema: {},
    isReadOnly,
    async call() { return 'ok' },
  }
}
