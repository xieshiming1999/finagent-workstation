import type { Tool, ToolContext } from '../tool'

export class EnterPlanModeTool implements Tool {
  name = 'EnterPlanMode'
  description = 'Enter plan mode for read-only exploration before implementing changes. Use this to design an approach before writing code.'
  isReadOnly = true
  inputSchema = { type: 'object', properties: {} }

  async call(): Promise<string> {
    return 'Plan mode entered. Explore the codebase and design your approach. Call ExitPlanMode when ready to implement.'
  }
}

export class ExitPlanModeTool implements Tool {
  name = 'ExitPlanMode'
  description = 'Exit plan mode and begin implementation.'
  isReadOnly = true
  inputSchema = { type: 'object', properties: {} }

  async call(): Promise<string> {
    return 'Plan mode exited. You can now make changes.'
  }
}
