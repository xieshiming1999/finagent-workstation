import type { Tool, ToolCapabilitySummary, ToolContext } from '../tool'

export class ToolCatalogTool implements Tool {
  name = 'ToolCatalog'
  description = 'Inspect the runtime tool catalog and capability summaries. Use list first, then detail for a specific tool.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'list', 'detail'],
        description: 'help, list all tool capabilities, or detail for one tool',
      },
      tool: { type: 'string', description: 'Tool name for detail action' },
    },
  }

  constructor(private readonly capabilitiesProvider: () => ToolCapabilitySummary[]) {}

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'list')
    if (action === 'help') return helpText()
    if (action !== 'list' && action !== 'detail') {
      throw new Error(`Invalid ToolCatalog action "${action}". Use action="help" for supported actions.`)
    }
    const capabilities = this.capabilitiesProvider().sort((a, b) => a.name.localeCompare(b.name))
    if (action === 'detail') {
      const name = String(input.tool ?? '').trim()
      if (!name) throw new Error('ToolCatalog detail requires "tool". Use action="list" to inspect tool names.')
      const found = capabilities.find((capability) => capability.name === name)
      if (!found) {
        throw new Error(`Tool "${name}" is not registered. Use ToolCatalog(action:"list") for available tools.`)
      }
      return JSON.stringify({
        contract: 'tool-catalog-result-v1',
        action,
        tool: found,
      })
    }
    return JSON.stringify({
      contract: 'tool-catalog-result-v1',
      action,
      count: capabilities.length,
      tools: capabilities.map((capability) => ({
        name: capability.name,
        permission: capability.permission,
        readOnly: capability.readOnly,
        canParallel: capability.canParallel,
        requiresUserInteraction: capability.requiresUserInteraction,
        actions: capability.schema.actionValues,
      })),
    })
  }
}

function helpText(): string {
  return JSON.stringify({
    contract: 'tool-catalog-help-v1',
    actions: ['list', 'detail'],
    guidance: 'Use list to inspect registered tools and action values. Use detail with a tool name before calling broad or unfamiliar tools.',
  })
}
