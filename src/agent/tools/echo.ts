import type { Tool, ToolContext } from '../tool'

export class EchoTool implements Tool {
  name = 'Echo'
  description = 'Echo a message back. Useful for testing or displaying text.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The message to echo' },
    },
    required: ['message'],
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    return String(input.message ?? '')
  }
}
