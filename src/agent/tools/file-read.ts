import { readFile, stat } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import { extname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { loadHierarchicalInstructions } from '../instruction'
import { describeResolvedToolPath, describeToolPathContext, resolveToolPath } from './path-resolver'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export class FileReadTool implements Tool {
  name = 'Read'
  description = 'Read the contents of a file from the local filesystem. Supports text files and images (PNG/JPG/GIF/WEBP).'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to read' },
      offset: { type: 'number', description: 'Start line (1-indexed, default: 1)' },
      limit: { type: 'number', description: 'Max lines to read (default: 2000)' },
    },
    required: ['file_path'],
  }

  /** Listener called after every file read — used by magic docs. */
  static onFileRead: ((filePath: string, content: string) => void) | null = null

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.file_path || String(input.file_path).trim() === '') return 'file_path is required'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const rawPath = String(input.file_path)
    let filePath = resolveToolPath(rawPath, ctx)
    if (!existsSync(filePath)) {
      return toolError(rawPath !== filePath
        ? `file does not exist: ${describeResolvedToolPath(rawPath, filePath, ctx)}`
        : `file does not exist: ${filePath}`)
    }

    const fileStat = await stat(filePath)
    const ext = extname(filePath).toLowerCase()

    // Image file reading
    if (IMAGE_EXTENSIONS.has(ext)) {
      if (fileStat.size > 10 * 1024 * 1024) {
        return toolError(`image too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB, max 10MB).`)
      }
      const mediaType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png'
      const sizeKb = (fileStat.size / 1024).toFixed(1)
      ctx.readFileTimestamps.set(filePath, statSync(filePath).mtimeMs)
      return JSON.stringify({
        ok: true,
        content: `Image read: ${filePath} (${sizeKb}KB, ${mediaType}). If the active default model has vision enabled, the next provider turn receives this image directly for visual analysis.`,
        path: filePath,
        basePath: ctx.basePath,
        memoryDir: ctx.memoryDir,
        workDir: ctx.workDir,
        images: [{
          path: filePath,
          mediaType,
          sizeBytes: fileStat.size,
        }],
      })
    }

    if (fileStat.size > 256 * 1024) {
      return toolError(`file too large (${(fileStat.size / 1024).toFixed(0)}KB, max 256KB). Use offset/limit to read a portion.`)
    }

    const content = await readFile(filePath, 'utf-8')
    const lines = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    const offset = Math.max(0, Number(input.offset ?? 1) - 1)
    const limit = Number(input.limit ?? 2000)
    const selected = lines.slice(offset, offset + limit)
    const total = lines.length
    const showing = selected.length

    // Track read timestamp for write-before-read enforcement
    ctx.readFileTimestamps.set(filePath, statSync(filePath).mtimeMs)

    // Notify magic docs listener
    FileReadTool.onFileRead?.(filePath, content)

    let result = `${describeToolPathContext(rawPath, filePath, ctx)}\n\n`
    result += selected.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')

    if (showing < total) {
      result += `\n\n(Showing lines ${offset + 1}-${offset + showing} of ${total}. File size: ${(fileStat.size / 1024).toFixed(1)}KB. ${total - offset - showing} more lines below.)`
    }

    // Attach hierarchical instructions if found near this file
    const instructions = loadHierarchicalInstructions(filePath, ctx.basePath)
    if (instructions) {
      result += `\n\n${instructions}`
    }

    return result
  }
}
