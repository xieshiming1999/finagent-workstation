import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface LLMModelConfig {
  id: string
  name?: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  endpoint?: string
  apiKey: string
  model: string
  maxTokens?: number
  contextWindow?: number
  compactThreshold?: number
  effort?: 'low' | 'medium' | 'high'
  thinking?: { type: 'enabled' | 'disabled' }
  extraHeaders?: Record<string, string>
  capabilities?: { vision?: boolean; audio?: boolean }
  isDefault?: boolean
}

export interface AppConfig {
  // LLM models list
  models: LLMModelConfig[]
  // Agent
  agentDepthLimit: number
  toolTimeout: number
  chatSkipPermissions: boolean
  systemPrompt: string
  // General
  workspacePath: string
  autoSaveSession: boolean
  language: 'system' | 'en' | 'zh-CN'
  // Finance
  apiKeys: Record<string, string>
  tdxServers: Array<{ host: string; port: number; name: string }>
}

const DEFAULT_MODELS: LLMModelConfig[] = []

const DEFAULT_CONFIG: AppConfig = {
  models: DEFAULT_MODELS,
  agentDepthLimit: 0,
  toolTimeout: 120000,
  chatSkipPermissions: true,
  systemPrompt: '',
  workspacePath: '',
  autoSaveSession: true,
  language: 'system',
  apiKeys: {},
  tdxServers: [],
}

export function getDefaultModel(config: AppConfig): LLMModelConfig | null {
  return config.models.find((m) => m.isDefault) ?? config.models[0] ?? null
}

export function findModelByCapability(config: AppConfig, capability: 'vision' | 'audio'): LLMModelConfig | null {
  return config.models.find((m) => m.capabilities?.[capability]) ?? null
}

export function loadConfig(basePath: string): AppConfig {
  // Try basePath first, then check global ~/.finagent-workstation/ path
  let filePath = join(basePath, 'config.json')
  if (!existsSync(filePath)) {
    // Try global path (basePath might be per-project)
    const { homedir } = require('os')
    const globalPath = join(homedir(), '.finagent-workstation', 'config.json')
    if (existsSync(globalPath)) filePath = globalPath
    else return { ...DEFAULT_CONFIG }
  }

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    // Migrate old flat config to models list
    if (!data.models && data.provider) {
      const migrated: LLMModelConfig = {
        id: 'default',
        provider: data.provider,
        baseURL: data.baseURL ?? '',
        apiKey: data.apiKey ?? '',
        model: data.model ?? 'gpt-4o-mini',
        maxTokens: data.maxTokens,
        contextWindow: data.contextWindow,
        effort: data.effort,
        extraHeaders: data.extraHeaders,
        capabilities: data.capabilities,
        isDefault: true,
      }
      data.models = [migrated]
    }
    return {
      ...DEFAULT_CONFIG,
      ...data,
      models: data.models ?? DEFAULT_MODELS,
      apiKeys: data.apiKeys ?? {},
      tdxServers: data.tdxServers ?? [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(basePath: string, config: AppConfig): void {
  const filePath = join(basePath, 'config.json')
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
}
