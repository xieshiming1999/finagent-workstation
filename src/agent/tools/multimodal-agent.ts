import { readFileSync, existsSync } from 'fs'
import type { Tool, ToolContext } from '../tool'
import { looksLikeToolError, toolError } from '../tool'
import type { LLMProvider } from '../llm-provider'
import type { Message, ImageContent, AudioContent, ContentPart } from '../message'
import { Role } from '../message'

type Modality = 'vision' | 'audio'

export interface MultimodalAgentConfig {
  findLLMForModality: (modality: Modality) => LLMProvider | null
  getAgentTools: () => Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
  executeTool: (name: string, input: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

export class MultimodalAgentTool implements Tool {
  name = 'MultimodalAgent'
  description = 'Dispatch a task involving non-text content (images, audio) to a multimodal agent. It infers required modalities from file extensions, finds a capable model from config, and runs a mini agent loop with file tools to complete the task.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to input files (images, audio). Modality is inferred from extension.',
      },
      task: { type: 'string', description: 'What to do with the files.' },
    },
    required: ['files', 'task'],
  }

  private config: MultimodalAgentConfig | null = null

  setConfig(config: MultimodalAgentConfig): void {
    this.config = config
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.files || !Array.isArray(input.files) || input.files.length === 0) {
      return 'files is required. Example: { "files": ["/path/to/image.png"], "task": "Extract text" }'
    }
    if (!input.task) return 'task is required. Describe what to do with the files.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (!this.config) return toolError('MultimodalAgent not configured.')

    const files = (input.files as string[]).map(String)
    const task = String(input.task)

    for (const f of files) {
      if (!existsSync(f)) return toolError(`file not found: ${f}`)
    }

    const required = this.detectModalities(files)
    if (required.length === 0) {
      return toolError('no recognizable modality in provided files. Supported: images (png/jpg/webp/gif), audio (mp3/wav/ogg/m4a).')
    }

    // Find a model that supports the primary modality
    const primaryModality = required[0]
    const llm = this.config.findLLMForModality(primaryModality)
    if (!llm) {
      return toolError(`no model with "${primaryModality}" capability found in config.\n\n` +
        `Add a model with capabilities.${primaryModality} = true in Settings > LLM.`)
    }

    const contentParts: ContentPart[] = [{ type: 'text', text: task }]
    for (const f of files) {
      const mod = this.fileModality(f)
      if (mod === 'vision') contentParts.push(this.loadImage(f))
      if (mod === 'audio') contentParts.push(this.loadAudio(f))
    }

    const systemPrompt = [
      'You are a Multimodal Agent — you analyze images/audio and complete tasks using available tools.',
      'Work step by step. Use tools when you need to read/write files or process data.',
      'When done, output your final answer as plain text.',
    ].join('\n')

    return await this.runAgentLoop(llm, systemPrompt, contentParts, task, ctx)
  }

  private async runAgentLoop(
    llm: LLMProvider,
    systemPrompt: string,
    initialContent: ContentPart[],
    task: string,
    ctx: ToolContext,
  ): Promise<string> {
    const messages: Message[] = [{
      role: Role.User,
      content: task,
      contentParts: initialContent,
      timestamp: new Date().toISOString(),
    }]

    const tools = this.config!.getAgentTools()
    const maxIterations = 10

    for (let i = 0; i < maxIterations; i++) {
      const textParts: string[] = []
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []

      const stream = llm.sendMessage(systemPrompt, messages, tools)
      for await (const ev of stream) {
        if (ev.type === 'text-delta') textParts.push(ev.text)
        if (ev.type === 'tool-call') toolCalls.push({ id: ev.id, name: ev.name, args: ev.arguments })
        if (ev.type === 'error') return toolError(`MultimodalAgent error: ${ev.message}`)
      }

      const text = textParts.join('')

      if (toolCalls.length === 0) {
        return `[MultimodalAgent]\n\n${text}`
      }

      messages.push({
        role: Role.Assistant,
        content: text,
        toolUses: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.args })),
        timestamp: new Date().toISOString(),
      })

      for (const tc of toolCalls) {
        try {
          const result = await this.config!.executeTool(tc.name, tc.args, ctx)
          messages.push({
            role: Role.Tool,
            content: '',
            toolResult: { toolUseId: tc.id, content: result, isError: looksLikeToolError(result) },
            timestamp: new Date().toISOString(),
          })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          messages.push({
            role: Role.Tool,
            content: '',
            toolResult: { toolUseId: tc.id, content: errMsg, isError: true },
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    return toolError('MultimodalAgent exceeded max iterations (10).')
  }

  private detectModalities(files: string[]): Modality[] {
    const modalities = new Set<Modality>()
    for (const f of files) {
      const m = this.fileModality(f)
      if (m) modalities.add(m)
    }
    return Array.from(modalities)
  }

  private fileModality(path: string): Modality | null {
    const ext = path.split('.').pop()?.toLowerCase()
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext ?? '')) return 'vision'
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'].includes(ext ?? '')) return 'audio'
    return null
  }

  private loadImage(path: string): ImageContent {
    const buffer = readFileSync(path)
    const ext = path.split('.').pop()?.toLowerCase() ?? 'png'
    const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/png'
    return {
      type: 'image',
      source: 'base64',
      data: buffer.toString('base64'),
      mediaType,
    }
  }

  private loadAudio(path: string): AudioContent {
    const buffer = readFileSync(path)
    const ext = path.split('.').pop()?.toLowerCase() ?? 'mp3'
    const format = (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext) ? ext : 'mp3') as AudioContent['format']
    return {
      type: 'audio',
      source: 'base64',
      data: buffer.toString('base64'),
      format,
    }
  }
}
