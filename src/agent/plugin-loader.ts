import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import type { Tool, ToolContext } from './tool'

/**
 * Plugin system for finagent_workstation.
 *
 * A plugin is a directory containing:
 *   manifest.json — metadata + component declarations
 *   skills/       — skill .md files (loaded via SkillTool)
 *   commands/     — slash command .md files (loaded via CommandLoader)
 *   hooks.json    — hook definitions (loaded via HookRegistry)
 *   mcp.json      — MCP server configs (loaded via McpManager)
 *   tools/        — custom tool .js files (loaded in VM sandbox)
 *
 * Installation:
 *   /plugin install <git-url>    — clones repo to ~/.finagent-workstation/plugins/
 *   /plugin install <local-path> — symlinks local dir
 *   /plugin remove <name>        — removes plugin
 *   /plugin list                 — list all plugins
 *   /plugin enable/disable <name>
 *
 * Three-tier discovery: bundled < global < project-local
 *
 * Reference: claude-code-best/src/types/plugin.ts
 */

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name: string; url?: string }
  homepage?: string
  repository?: string
  skills?: string | string[]
  commands?: string | string[]
  hooks?: string | Record<string, unknown>
  mcpServers?: Record<string, { command?: string; args?: string[]; url?: string; type?: string }>
  tools?: string[]
  defaultEnabled?: boolean
}

export interface LoadedPlugin {
  name: string
  manifest: PluginManifest
  path: string
  source: 'global' | 'project' | 'builtin'
  enabled: boolean
  skillPaths: string[]
  commandPaths: string[]
  hooksConfig: Record<string, unknown> | null
  mcpServers: Record<string, unknown>
  toolFiles: string[]
}

interface PluginStore {
  enabled: Record<string, boolean>
  installed: Array<{ name: string; source: string; repository?: string; installedAt: string }>
}

// --- Discovery ---

export function discoverPlugins(globalBasePath: string, assetsPath: string, projectLocalDir?: string): LoadedPlugin[] {
  const plugins: LoadedPlugin[] = []
  const store = loadPluginStore(globalBasePath)

  const dirs: Array<{ dir: string; source: 'builtin' | 'global' | 'project' }> = [
    { dir: join(assetsPath, 'plugins'), source: 'builtin' },
    { dir: join(globalBasePath, 'plugins'), source: 'global' },
    ...(projectLocalDir ? [{ dir: join(projectLocalDir, 'plugins'), source: 'project' as const }] : []),
  ]

  for (const { dir, source } of dirs) {
    if (!existsSync(dir)) continue
    for (const name of safeReaddir(dir)) {
      const existing = plugins.findIndex((p) => p.name === name)
      const plugin = loadPlugin(join(dir, name), source, store)
      if (plugin) {
        if (existing >= 0) plugins[existing] = plugin
        else plugins.push(plugin)
      }
    }
  }

  return plugins.filter((p) => p.enabled)
}

function loadPlugin(pluginDir: string, source: 'global' | 'project' | 'builtin', store: PluginStore): LoadedPlugin | null {
  const manifestPath = join(pluginDir, 'manifest.json')
  if (!existsSync(manifestPath)) return null

  try {
    const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const name = manifest.name || basename(pluginDir)
    const enabled = store.enabled[name] ?? manifest.defaultEnabled ?? true

    const skillPaths = resolvePaths(pluginDir, manifest.skills)
    const commandPaths = resolvePaths(pluginDir, manifest.commands)
    const toolFiles = (manifest.tools ?? []).map((t) => join(pluginDir, t)).filter(existsSync)

    let hooksConfig: Record<string, unknown> | null = null
    if (typeof manifest.hooks === 'string') {
      const p = join(pluginDir, manifest.hooks)
      if (existsSync(p)) try { hooksConfig = JSON.parse(readFileSync(p, 'utf-8')) } catch { /* */ }
    } else if (manifest.hooks && typeof manifest.hooks === 'object') {
      hooksConfig = manifest.hooks as Record<string, unknown>
    }

    return { name, manifest, path: pluginDir, source, enabled, skillPaths, commandPaths, hooksConfig, mcpServers: manifest.mcpServers ?? {}, toolFiles }
  } catch (e) {
    console.error(`[Plugin] Failed to load ${pluginDir}:`, e)
    return null
  }
}

// --- Installation ---

export function installPlugin(source: string, globalBasePath: string): string {
  const pluginsDir = join(globalBasePath, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })

  if (source.startsWith('http') || source.startsWith('git@') || source.includes('github.com')) {
    const repoName = basename(source).replace('.git', '')
    const targetDir = join(pluginsDir, repoName)
    if (existsSync(targetDir)) return `Plugin "${repoName}" already installed.`

    try {
      execSync(`git clone --depth 1 ${source} ${targetDir}`, { stdio: 'pipe', timeout: 60_000 })
      const manifest = existsSync(join(targetDir, 'manifest.json'))
        ? JSON.parse(readFileSync(join(targetDir, 'manifest.json'), 'utf-8'))
        : { name: repoName }
      const store = loadPluginStore(globalBasePath)
      store.installed.push({ name: manifest.name ?? repoName, source, repository: source, installedAt: new Date().toISOString() })
      savePluginStore(globalBasePath, store)
      return `Installed plugin "${manifest.name ?? repoName}" from ${source}`
    } catch (e) {
      return `Failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // Local path
  const name = basename(source)
  const targetDir = join(pluginsDir, name)
  if (existsSync(targetDir)) return `Plugin "${name}" already exists.`
  if (!existsSync(source) || !existsSync(join(source, 'manifest.json'))) return `Invalid plugin path: ${source}`

  try {
    require('fs').symlinkSync(source, targetDir, 'dir')
    const store = loadPluginStore(globalBasePath)
    store.installed.push({ name, source, installedAt: new Date().toISOString() })
    savePluginStore(globalBasePath, store)
    return `Installed plugin "${name}" (symlinked from ${source})`
  } catch (e) {
    return `Failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

export function uninstallPlugin(name: string, globalBasePath: string): string {
  const pluginDir = join(globalBasePath, 'plugins', name)
  if (!existsSync(pluginDir)) return `Plugin "${name}" not found.`
  try {
    rmSync(pluginDir, { recursive: true })
    const store = loadPluginStore(globalBasePath)
    store.installed = store.installed.filter((p) => p.name !== name)
    savePluginStore(globalBasePath, store)
    return `Uninstalled "${name}"`
  } catch (e) {
    return `Failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

export function setPluginEnabled(name: string, enabled: boolean, globalBasePath: string): void {
  const store = loadPluginStore(globalBasePath)
  store.enabled[name] = enabled
  savePluginStore(globalBasePath, store)
}

// --- Registration ---

export function registerPluginTools(plugins: LoadedPlugin[], registry: { register: (tool: Tool) => void }): number {
  let count = 0
  for (const plugin of plugins) {
    for (const toolFile of plugin.toolFiles) {
      const tool = loadToolFromFile(toolFile, plugin.name)
      if (tool) { registry.register(tool); count++ }
    }
  }
  return count
}

/** Get all skill discovery paths from loaded plugins */
export function getPluginSkillPaths(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => p.skillPaths)
}

/** Get all command discovery paths from loaded plugins */
export function getPluginCommandPaths(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => p.commandPaths)
}

/** Get MCP server configs from all enabled plugins */
export function getPluginMcpConfigs(plugins: LoadedPlugin[]): Array<{ name: string; type: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; env?: Record<string, string> }> {
  const configs: Array<{ name: string; type: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; env?: Record<string, string> }> = []
  for (const p of plugins) {
    if (!p.enabled || !p.mcpServers || typeof p.mcpServers !== 'object') continue
    for (const [serverName, cfg] of Object.entries(p.mcpServers)) {
      if (!cfg || typeof cfg !== 'object') continue
      const entry = cfg as Record<string, unknown>
      const type = (entry.type as string) === 'http' ? 'http' : 'stdio'
      configs.push({
        name: `${p.name}/${serverName}`,
        type,
        command: entry.command as string | undefined,
        args: entry.args as string[] | undefined,
        url: entry.url as string | undefined,
        env: entry.env as Record<string, string> | undefined,
      })
    }
  }
  return configs
}

// --- Helpers ---

function resolvePaths(baseDir: string, paths: string | string[] | undefined): string[] {
  if (!paths) return []
  return (Array.isArray(paths) ? paths : [paths]).map((p) => join(baseDir, p)).filter(existsSync)
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir).filter((n) => !n.startsWith('.')) } catch { return [] }
}

function loadPluginStore(globalBasePath: string): PluginStore {
  const p = join(globalBasePath, 'plugin-store.json')
  if (!existsSync(p)) return { enabled: {}, installed: [] }
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return { enabled: {}, installed: [] } }
}

function savePluginStore(globalBasePath: string, store: PluginStore): void {
  mkdirSync(globalBasePath, { recursive: true })
  writeFileSync(join(globalBasePath, 'plugin-store.json'), JSON.stringify(store, null, 2), 'utf-8')
}

function loadToolFromFile(toolPath: string, pluginName: string): Tool | null {
  const vm = require('vm')
  try {
    const code = readFileSync(toolPath, 'utf-8')
    const exports: Record<string, unknown> = {}
    const context = vm.createContext({
      module: { exports }, exports,
      require: (mod: string) => { if (['fs','path','crypto'].includes(mod)) return require(mod); throw new Error(`Cannot require '${mod}'`) },
      console, JSON, Math, Date, Buffer, setTimeout, clearTimeout, fetch,
    })
    vm.runInContext(code, context, { timeout: 5000, filename: toolPath })
    const def = (exports as any).default ?? exports
    if (!def.name || !def.call) return null
    return {
      name: `plugin__${pluginName}__${def.name}`,
      description: `[Plugin:${pluginName}] ${def.description ?? ''}`,
      inputSchema: def.inputSchema ?? { type: 'object', properties: {} },
      isReadOnly: def.isReadOnly ?? false, canParallel: def.canParallel ?? false,
      async call(id: string, input: Record<string, unknown>, ctx: ToolContext) { return await def.call(id, input, ctx) },
    }
  } catch { return null }
}
