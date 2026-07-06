import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const INITIAL_MEMORY_FILES: Array<{ path: string; content: string }> = [
  {
    path: 'memory/MEMORY.md',
    content: '# Memory Index\n\nNo memories saved yet.\n',
  },
  {
    path: 'memory/ai_reflections.md',
    content: '# AI Reflections\n\nNo analysis reflections recorded yet.\n',
  },
]

export function ensureRuntimeMemoryScaffold(basePath: string, agentRole = 'chat'): void {
  mkdirSync(join(basePath, 'memory'), { recursive: true })
  mkdirSync(join(basePath, 'memory', 'skills'), { recursive: true })
  mkdirSync(join(basePath, 'memory', 'pages'), { recursive: true })

  const role = agentRole.trim() || 'chat'
  INITIAL_MEMORY_FILES
    .concat({
      path: `memory/${role}/soul.md`,
      content: '# Soul\n\nNot configured yet.\n',
    })
    .forEach((entry) => {
      const file = join(basePath, entry.path)
      if (existsSync(file)) return
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, entry.content, 'utf-8')
    })
}
