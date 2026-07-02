import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * A file-defined slash command loaded from bundle/commands/ or memory/commands/.
 * Matching finagent command_loader.dart.
 */
export interface FileCommand {
  name: string
  description: string
  promptTemplate: string
  agent?: string
  source: string
}

/**
 * Discover file-based commands from bundle/commands/ and memory/commands/.
 * Memory commands override bundle commands with the same name.
 */
export function discoverCommands(basePath: string, projectLocalDir?: string, pluginCommandPaths?: string[]): FileCommand[] {
  const commands = new Map<string, FileCommand>()

  // 1. Bundle commands (lowest priority)
  const bundleDir = join(basePath, 'bundle', 'commands')
  if (existsSync(bundleDir)) {
    for (const cmd of loadCommandsFromDir(bundleDir, 'bundle')) {
      commands.set(cmd.name, cmd)
    }
  }

  // 2. Plugin commands (override bundle)
  if (pluginCommandPaths) {
    for (const dir of pluginCommandPaths) {
      if (existsSync(dir)) {
        for (const cmd of loadCommandsFromDir(dir, 'plugin')) {
          commands.set(cmd.name, cmd)
        }
      }
    }
  }

  // 3. Memory commands (override plugin + bundle)
  const memoryDir = join(basePath, 'memory', 'commands')
  if (existsSync(memoryDir)) {
    for (const cmd of loadCommandsFromDir(memoryDir, 'memory')) {
      commands.set(cmd.name, cmd)
    }
  }

  // 4. Project-local commands (highest priority — {cwd}/.finagent-workstation/commands/)
  if (projectLocalDir) {
    const localDir = join(projectLocalDir, 'commands')
    if (existsSync(localDir)) {
      for (const cmd of loadCommandsFromDir(localDir, 'project')) {
        commands.set(cmd.name, cmd)
      }
    }
  }

  return Array.from(commands.values())
}

function loadCommandsFromDir(dir: string, source: string): FileCommand[] {
  const commands: FileCommand[] = []
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue
      const content = readFileSync(join(dir, file), 'utf-8')
      const parsed = parseCommandFile(content, file.replace('.md', ''), source)
      if (parsed) commands.push(parsed)
    }
  } catch { /* */ }
  return commands
}

function parseCommandFile(content: string, defaultName: string, source: string): FileCommand | null {
  const lines = content.split('\n')
  let name = defaultName
  let description = ''
  let agent: string | undefined
  let bodyStart = 0

  // Parse frontmatter
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { bodyStart = i + 1; break }
      const [key, ...rest] = lines[i].split(':')
      const val = rest.join(':').trim()
      if (key.trim() === 'name') name = val
      else if (key.trim() === 'description') description = val
      else if (key.trim() === 'agent') agent = val
    }
  }

  const promptTemplate = lines.slice(bodyStart).join('\n').trim()
  if (!promptTemplate) return null

  return { name, description, promptTemplate, agent, source }
}

/**
 * Expand $ARGUMENTS in a command template.
 */
export function expandCommandTemplate(template: string, args: string): string {
  let result = template.replace(/\$ARGUMENTS/g, args)
  const parts = args.split(/\s+/)
  for (let i = 0; i < parts.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), parts[i])
  }
  return result
}
