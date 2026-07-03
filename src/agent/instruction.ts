import { existsSync, readFileSync } from 'fs'
import { join, dirname, normalize } from 'path'

const INSTRUCTION_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']

/**
 * Walk up from filePath's directory toward basePath, collecting
 * instruction files (AGENTS.md, CLAUDE.md, CONTEXT.md) found along the way.
 * Returns concatenated content, closest directory first.
 * Matching finagent instruction.dart.
 */
export function loadHierarchicalInstructions(filePath: string, basePath: string): string | null {
  const resolvedBase = normalize(basePath)
  let dir = normalize(dirname(filePath))

  if (!dir.startsWith(resolvedBase)) return null

  const sections: string[] = []

  while (true) {
    for (const name of INSTRUCTION_FILE_NAMES) {
      const instrPath = join(dir, name)
      if (existsSync(instrPath)) {
        const content = readFileSync(instrPath, 'utf-8').trim()
        if (content) {
          const relative = dir.slice(resolvedBase.length + 1) || '.'
          sections.push(`# Instructions from ${relative}/${name}\n\n${content}`)
        }
      }
    }

    if (dir === resolvedBase) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

/**
 * Get instructions for a file being read (for FileReadTool magic docs integration).
 */
export function getInstructionsForFile(filePath: string, basePath: string): string | null {
  return loadHierarchicalInstructions(filePath, basePath)
}
