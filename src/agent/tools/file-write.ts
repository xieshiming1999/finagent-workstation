import { writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { dirname, relative } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { snapshotBeforeWrite } from '../file-utils'
import { describeRisk } from '../security-scan'
import { describeToolPathContext, resolveToolPath } from './path-resolver'

export class FileWriteTool implements Tool {
  name = 'Write'
  description = 'Write content to a file. Creates the file if it does not exist, overwrites if it does.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or relative file path' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['file_path', 'content'],
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    const filePath = String(input.file_path ?? '')
    return !filePath.includes('memory/')
  }

  validateInput(input: Record<string, unknown>, ctx: ToolContext): string | null {
    const filePath = input.file_path as string | undefined
    if (!filePath?.trim()) return 'file_path is required.'
    if (input.content === undefined) return 'content is required.'

    const resolved = resolveToolPath(filePath, ctx)

    if (existsSync(resolved) && !isGeneratedRuntimeArtifact(resolved, ctx)) {
      if (!ctx.readFileTimestamps.has(resolved)) {
        return 'File has not been read yet. Read it first before writing to it.'
      }
      const readTimestamp = ctx.readFileTimestamps.get(resolved)!
      const currentMtime = statSync(resolved).mtimeMs
      if (currentMtime > readTimestamp) {
        return 'File has been modified since it was last read. Read it again before writing.'
      }
    }

    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = String(input.file_path)
    const content = String(input.content ?? '')
    const resolved = resolveToolPath(filePath, ctx)

    try {
      const isNewFile = !existsSync(resolved)

      if (!isNewFile) {
        snapshotBeforeWrite(resolved, ctx.basePath)
      }

      mkdirSync(dirname(resolved), { recursive: true })
      writeFileSync(resolved, content, 'utf-8')

      ctx.readFileTimestamps.set(resolved, statSync(resolved).mtimeMs)

      const lineCount = content.split('\n').length
      const sizeKb = (Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1)
      const securityWarning = describeRisk(content)
      const warnSuffix = securityWarning ? `\n\n⚠️ Security warning: ${securityWarning}` : ''

      const context = describeToolPathContext(filePath, resolved, ctx)
      return isNewFile
        ? `File created: ${resolved} (${lineCount} lines, ${sizeKb}KB)\n${context}${warnSuffix}`
        : `File updated: ${resolved} (${lineCount} lines, ${sizeKb}KB)\n${context}${warnSuffix}`
    } catch (err) {
      return toolError(`Write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function isGeneratedRuntimeArtifact(resolvedPath: string, ctx: ToolContext): boolean {
  const relativeToMemory = relative(ctx.memoryDir, resolvedPath).replace(/\\/g, '/')
  return relativeToMemory.startsWith('pages/') || relativeToMemory.startsWith('dashboards/')
}
