import type { ToolRegistry } from './tool'

export function providerHintForModel(model: string): 'anthropic' | 'openai' | null {
  if (model.includes('claude') || model.includes('anthropic')) return 'anthropic'
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai'
  return null
}

export function buildAgentDefaultPrompt(tools: ToolRegistry, basePath: string): string {
  const toolList = tools
    .list()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n')

  return [
    'You are FinAgent, an AI-powered finance assistant running on a desktop workstation.',
    'You have access to the local filesystem, shell commands, and financial data tools.',
    '',
    '## Available Tools',
    toolList,
    '',
    '## Environment',
    `- Platform: ${process.platform}`,
    `- Date: ${new Date().toISOString().split('T')[0]}`,
    `- Base path: ${basePath}`,
  ].join('\n')
}

export function maybePersistResult(basePath: string, result: string): string {
  const maxChars = 30000
  if (result.length <= maxChars) return result
  try {
    const { writeFileSync, mkdirSync } = require('fs')
    const { join } = require('path')
    const dir = join(basePath, 'memory', '.tool_outputs')
    mkdirSync(dir, { recursive: true })
    const filename = `tool_output_${Date.now()}.txt`
    const filepath = join(dir, filename)
    writeFileSync(filepath, result, 'utf-8')
    return `${result.slice(0, 2000)}\n\n... (${result.length} chars total, full output saved to ${filepath} — use Read to access)`
  } catch {
    return result.slice(0, maxChars) + `\n... (truncated from ${result.length} chars)`
  }
}

export function parseStructuredToolResult(result: string): {
  content: string
  extras?: {
    imagePaths?: string[]
    imageMetadata?: Array<{ path: string; mediaType?: string; width?: number; height?: number; sizeBytes?: number }>
  }
} {
  const trimmed = result.trim()
  if (!trimmed.startsWith('{')) return { content: result }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const images = Array.isArray(parsed.images) ? parsed.images : []
    const imageMetadata = images
      .filter((img): img is Record<string, unknown> => !!img && typeof img === 'object')
      .map((img) => ({
        path: String(img.path ?? img.filePath ?? img.screenshotPath ?? ''),
        mediaType: img.mediaType ? String(img.mediaType) : undefined,
        width: typeof img.width === 'number' ? img.width : undefined,
        height: typeof img.height === 'number' ? img.height : undefined,
        sizeBytes: typeof img.sizeBytes === 'number' ? img.sizeBytes : undefined,
      }))
      .filter((img) => img.path)
    if (imageMetadata.length === 0) return { content: result }
    const imagePaths = imageMetadata.map((img) => img.path)
    const content = typeof parsed.content === 'string' ? parsed.content : result
    return { content, extras: { imagePaths, imageMetadata } }
  } catch {
    return { content: result }
  }
}
