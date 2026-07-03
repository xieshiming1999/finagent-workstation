import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { snapshotBeforeWrite } from '../file-utils'
import { describeRisk } from '../security-scan'
import { describeResolvedToolPath, describeToolPathContext, resolveToolPath } from './path-resolver'

const MAX_EDIT_FILE_SIZE = 2 * 1024 * 1024

export class FileEditTool implements Tool {
  name = 'Edit'
  description = 'Perform exact string replacement in a file. Use empty old_string to create a new file.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or relative file path' },
      old_string: { type: 'string', description: 'Exact text to find (empty = create new file)' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    const filePath = String(input.file_path ?? '')
    return !filePath.includes('memory/')
  }

  validateInput(input: Record<string, unknown>, ctx: ToolContext): string | null {
    const filePath = input.file_path as string | undefined
    const oldString = String(input.old_string ?? '')
    const newString = String(input.new_string ?? '')
    const replaceAll = Boolean(input.replace_all ?? false)

    if (!filePath?.trim()) return 'file_path is required.'
    if (oldString === newString) return 'old_string and new_string are identical. No changes to make.'

    const resolved = resolveToolPath(filePath, ctx)

    if (!oldString) {
      if (existsSync(resolved)) {
        const content = readFileSync(resolved, 'utf-8')
        if (content.trim()) {
          return `Cannot create new file — file already exists at ${filePath}. To edit, provide old_string to match existing content.`
        }
      }
      return null
    }

    if (!existsSync(resolved)) {
      if (filePath !== resolved) return `file does not exist: ${describeResolvedToolPath(filePath, resolved, ctx)}`
      return `file does not exist: ${resolved}`
    }

    const stat = statSync(resolved)
    if (stat.size > MAX_EDIT_FILE_SIZE) {
      return `File is too large to edit (${stat.size} bytes, max ${MAX_EDIT_FILE_SIZE} bytes).`
    }

    if (!ctx.readFileTimestamps.has(resolved)) {
      return 'File has not been read yet. Read it first before editing.'
    }

    const readTimestamp = ctx.readFileTimestamps.get(resolved)!
    if (stat.mtimeMs > readTimestamp) {
      return 'File has been modified since it was last read. Read it again before editing.'
    }

    const fileContent = readFileSync(resolved, 'utf-8')
    const actualString = findActualString(fileContent, oldString)
    if (!actualString) {
      return 'old_string did not match the file content. Make sure it matches the file content exactly.'
    }

    if (!replaceAll) {
      const count = countOccurrences(fileContent, actualString)
      if (count > 1) {
        return `old_string appears ${count} times in the file. Add more surrounding context to make it unique, or set replace_all to true.`
      }
    }

    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = String(input.file_path)
    const oldString = String(input.old_string ?? '')
    const newString = String(input.new_string ?? '')
    const replaceAll = Boolean(input.replace_all ?? false)
    const resolved = resolveToolPath(filePath, ctx)

    try {
      if (!existsSync(resolved) && oldString) {
        return toolError(filePath !== resolved
          ? `file does not exist: ${describeResolvedToolPath(filePath, resolved, ctx)}`
          : `file does not exist: ${resolved}`)
      }

      if (!oldString) {
        mkdirSync(dirname(resolved), { recursive: true })
        writeFileSync(resolved, newString, 'utf-8')
        ctx.readFileTimestamps.set(resolved, statSync(resolved).mtimeMs)
        const lineCount = newString.split('\n').length
        const sizeKb = (Buffer.byteLength(newString, 'utf-8') / 1024).toFixed(1)
        return `File created: ${resolved} (${lineCount} lines, ${sizeKb}KB)\n${describeToolPathContext(filePath, resolved, ctx)}`
      }

      const originalContent = readFileSync(resolved, 'utf-8')
      snapshotBeforeWrite(resolved, ctx.basePath)

      const actualOldString = findActualString(originalContent, oldString) ?? oldString
      const updatedContent = replaceAll
        ? originalContent.replaceAll(actualOldString, newString)
        : originalContent.replace(actualOldString, newString)

      writeFileSync(resolved, updatedContent, 'utf-8')
      ctx.readFileTimestamps.set(resolved, statSync(resolved).mtimeMs)

      const lines = updatedContent.split('\n')
      const editIdx = updatedContent.indexOf(newString)
      const editLine = updatedContent.slice(0, editIdx).split('\n').length
      const contextStart = Math.max(0, editLine - 4)
      const contextEnd = Math.min(lines.length, editLine + newString.split('\n').length + 3)
      const snippet = lines.slice(contextStart, contextEnd).map((l, i) => `${contextStart + i + 1}\t${l}`).join('\n')

      const replaceCount = replaceAll ? countOccurrences(originalContent, actualOldString) : 1
      const totalLines = lines.length
      const lineDelta = newString.split('\n').length - actualOldString.split('\n').length
      const deltaStr = lineDelta > 0 ? `+${lineDelta}` : `${lineDelta}`
      const replaceNote = replaceAll ? ` (replaced ${replaceCount} occurrences)` : ''

      const securityWarning = describeRisk(newString)
      const warnSuffix = securityWarning ? `\n\n⚠️ Security warning: ${securityWarning}` : ''

      return `File updated: ${resolved}${replaceNote} (${totalLines} lines, ${deltaStr} lines changed).\n${describeToolPathContext(filePath, resolved, ctx)}\nSnippet:\n${snippet}${warnSuffix}`
    } catch (err) {
      return toolError(`editing file failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function findActualString(content: string, search: string): string | null {
  if (content.includes(search)) return search
  const variants = [
    search.replace(/‘|’/g, "'").replace(/“|”/g, '"'),
    search.replace(/'/g, "’").replace(/"/g, "”"),
  ]
  for (const v of variants) {
    if (content.includes(v)) return v
  }
  return null
}

function countOccurrences(text: string, search: string): number {
  let count = 0
  let pos = 0
  while ((pos = text.indexOf(search, pos)) !== -1) { count++; pos += search.length }
  return count
}
