import { existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync, readdirSync, rmSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

export class FileManageTool implements Tool {
  name = 'FileManage'
  description = 'File management: copy, move, delete files/directories, create directories.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['copy', 'move', 'delete', 'mkdir'], description: 'File operation' },
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path (for copy/move)' },
      path: { type: 'string', description: 'Path (for delete/mkdir)' },
      recursive: { type: 'boolean', description: 'Recursive delete (default: false)' },
    },
    required: ['action'],
  }


  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) return 'action is required. Available: copy, move, delete, mkdir'
    return null
  }

    async call(_id: string, input: Record<string, unknown>): Promise<string> {
    const action = String(input.action)
    switch (action) {
      case 'copy': {
        const src = String(input.source ?? '')
        const dst = String(input.destination ?? '')
        if (!src || !dst) return toolError('source and destination required')
        if (!existsSync(src)) return toolError(`Source not found: ${src}`)
        mkdirSync(dirname(dst), { recursive: true })
        copyFileSync(src, dst)
        return `Copied ${src} → ${dst}`
      }
      case 'move': {
        const src = String(input.source ?? '')
        const dst = String(input.destination ?? '')
        if (!src || !dst) return toolError('source and destination required')
        if (!existsSync(src)) return toolError(`Source not found: ${src}`)
        mkdirSync(dirname(dst), { recursive: true })
        renameSync(src, dst)
        return `Moved ${src} → ${dst}`
      }
      case 'delete': {
        const path = String(input.path ?? input.source ?? '')
        if (!path) return toolError('path required')
        if (!existsSync(path)) return toolError(`Not found: ${path}`)
        if (Boolean(input.recursive)) {
          rmSync(path, { recursive: true, force: true })
        } else {
          unlinkSync(path)
        }
        return `Deleted ${path}`
      }
      case 'mkdir': {
        const path = String(input.path ?? '')
        if (!path) return toolError('path required')
        mkdirSync(path, { recursive: true })
        return `Directory created: ${path}`
      }
      default:
        return toolError(`Unknown action: ${action}`)
    }
  }
}
