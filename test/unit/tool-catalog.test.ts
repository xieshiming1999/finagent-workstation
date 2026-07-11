import { describe, expect, it } from 'vitest'
import { ToolRegistry, type Tool, type ToolContext } from '../../src/agent/tool'
import { ToolCatalogTool } from '../../src/agent/tools/tool-catalog'

describe('ToolCatalogTool', () => {
  it('lists and details runtime tool capabilities', async () => {
    const registry = new ToolRegistry()
    registry.register(exampleTool())
    registry.register(new ToolCatalogTool(() => registry.capabilities()))
    const catalog = registry.get('ToolCatalog')!

    const list = JSON.parse(await catalog.call('list-1', { action: 'list' }, {} as ToolContext))
    expect(list).toMatchObject({
      contract: 'tool-catalog-result-v1',
      action: 'list',
    })
    expect(list.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Example',
        permission: 'write-or-side-effect',
        actions: ['help', 'run'],
      }),
      expect.objectContaining({
        name: 'ToolCatalog',
        permission: 'read-only',
        actions: ['detail', 'help', 'list'],
      }),
    ]))

    const detail = JSON.parse(await catalog.call('detail-1', {
      action: 'detail',
      tool: 'Example',
    }, {} as ToolContext))
    expect(detail.tool).toMatchObject({
      name: 'Example',
      schema: {
        actionValues: ['help', 'run'],
      },
    })
  })
})

function exampleTool(): Tool {
  return {
    name: 'Example',
    description: 'Example tool',
    isReadOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['run', 'help'] },
      },
    },
    async call() {
      return 'ok'
    },
  }
}
