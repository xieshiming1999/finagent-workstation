import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { describeResolvedToolPath, describeToolPathContext, resolveToolPath } from './path-resolver'

const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', '__pycache__', '.DS_Store'])

function isMacroResearchContentPath(filePath: string): boolean {
  return filePath.replaceAll('\\', '/').includes('/data/macro_research_content')
}

export class LSTool implements Tool {
  name = 'LS'
  description = 'List directory contents as a recursive tree.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: working directory)' },
    },
  }

  validateInput(_input: Record<string, unknown>, _ctx: ToolContext): string | null {
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const raw = String(input.path ?? '.')
    const dirPath = resolveToolPath(raw, ctx)
    if (isMacroResearchContentPath(dirPath)) {
      return toolError('Macro research content artifact directories are diagnostic/source-maintenance storage. For normal macro analysis, use DataStore(action:"query_macro_research_content") and answer from contentEvidence instead of listing local artifact files.')
    }
    if (!existsSync(dirPath)) {
      return toolError(raw !== dirPath
        ? `directory does not exist: ${describeResolvedToolPath(raw, dirPath, ctx)}`
        : `directory does not exist: ${dirPath}`)
    }
    const lines: string[] = []
    let count = 0

    const walk = (dir: string, indent: string) => {
      if (count >= 1000) return
      let entries: string[]
      try { entries = readdirSync(dir).sort() } catch { return }

      for (const name of entries) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
        if (count >= 1000) break
        count++
        const fullPath = join(dir, name)
        try {
          const s = statSync(fullPath)
          if (s.isDirectory()) {
            lines.push(`${indent}${name}/`)
            walk(fullPath, indent + '  ')
          } else {
            lines.push(`${indent}${name}`)
          }
        } catch {
          lines.push(`${indent}${name}`)
        }
      }
    }

    walk(dirPath, '')

    if (count === 0) return `${describeToolPathContext(raw, dirPath, ctx)}\n\n(empty directory)`
    let result = `${describeToolPathContext(raw, dirPath, ctx)}\n\n`
    result += lines.join('\n')
    if (count >= 1000) result += `\n\n(truncated at 1000 entries)`
    result += `\n\n${count} entries`
    return result
  }
}
