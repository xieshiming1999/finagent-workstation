import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { AnthropicLLMClient } from '../agent/anthropic-llm-client'
import { FallbackLLMProvider } from '../agent/fallback-llm'
import { LLMClient } from '../agent/llm-client'
import type { LLMProvider } from '../agent/llm-provider'
import type { Message } from '../agent/message'
import type { SSEEvent } from '../agent/sse-event'
import { getDefaultModel, loadConfig, type AppConfig, type LLMModelConfig } from './config'

export function globalConfigPath(): string {
  return join(homedir(), '.finagent-workstation')
}

export function registerSession(projectPath: string): void {
  const { writeFileSync, mkdirSync, unlinkSync } = require('fs')
  const sessionsDir = join(homedir(), '.finagent-workstation', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  const pidFile = join(sessionsDir, `${process.pid}.json`)
  writeFileSync(pidFile, JSON.stringify({
    pid: process.pid,
    cwd: process.cwd(),
    projectPath,
    startedAt: new Date().toISOString(),
  }), 'utf-8')

  app.on('will-quit', () => {
    try { unlinkSync(pidFile) } catch { /* ignore */ }
  })
}

export async function executeRendererJavaScript<T = unknown>(mainWindow: BrowserWindow | null, script: string, timeoutMs = 5000): Promise<T> {
  if (!mainWindow) throw new Error('UI_WINDOW_MISSING: main window is not available')
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      mainWindow.webContents.executeJavaScript(script, true) as Promise<T>,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`UI_RENDERER_TIMEOUT: renderer JavaScript did not settle within ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  globalShortcut.register('CommandOrControl+R', () => {
    mainWindow.webContents.reload()
  })
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    mainWindow.webContents.reloadIgnoringCache()
  })

  return mainWindow
}

export function createLLMProvider(cfg?: AppConfig): LLMProvider {
  const scriptedProvider = createTestScriptedLLMProvider()
  if (scriptedProvider) return scriptedProvider

  const config = cfg ?? loadConfig(globalConfigPath())
  const modelCfg = getDefaultModel(config)
  if (!modelCfg) {
    return new LLMClient({ baseURL: process.env.LLM_BASE_URL ?? '', apiKey: process.env.LLM_API_KEY ?? '', model: process.env.LLM_MODEL ?? '' })
  }

  if (config.models.length > 1) {
    const orderedModels = [modelCfg, ...config.models.filter((m) => m.id !== modelCfg.id)]
    return new FallbackLLMProvider(orderedModels.map(createLLMFromModelConfig))
  }

  return createLLMFromModelConfig(modelCfg)
}

interface TestScriptedLLMResponse {
  text?: string
  toolCalls?: Array<{
    id?: string
    name: string
    arguments?: Record<string, unknown>
  }>
}

class TestScriptedLLMProvider implements LLMProvider {
  readonly model = 'test-scripted-llm'
  readonly contextWindow = 128_000
  private callIndex = 0
  private cancelled = false

  constructor(private readonly script: TestScriptedLLMResponse[]) {}

  clone(): LLMProvider {
    return new TestScriptedLLMProvider([...this.script])
  }

  cancel(): void {
    this.cancelled = true
  }

  async *sendMessage(
    _systemPrompt: string,
    _messages: Message[],
    _tools: unknown[],
  ): AsyncGenerator<SSEEvent> {
    if (this.cancelled) {
      yield { type: 'done', finishReason: 'stop' }
      return
    }
    const response = this.script[this.callIndex++] ?? {
      text: '(test scripted LLM has no more responses)',
    }
    if (response.text) {
      yield { type: 'text-delta', text: response.text }
    }
    if (response.toolCalls?.length) {
      for (const [index, toolCall] of response.toolCalls.entries()) {
        const id = toolCall.id ?? `test-tool-${this.callIndex}-${index}`
        yield { type: 'tool-call-start', id, name: toolCall.name }
        yield {
          type: 'tool-call',
          id,
          name: toolCall.name,
          arguments: toolCall.arguments ?? {},
        }
      }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }
    yield { type: 'done', finishReason: 'stop' }
  }
}

function createTestScriptedLLMProvider(): LLMProvider | null {
  if (process.env.NODE_ENV !== 'test') return null
  const raw = process.env.FINAGENT_WORKSTATION_TEST_LLM_SCRIPT
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('script root must be an array')
    }
    return new TestScriptedLLMProvider(
      parsed.map((entry) => ({
        text: typeof entry?.text === 'string' ? entry.text : undefined,
        toolCalls: Array.isArray(entry?.toolCalls)
          ? entry.toolCalls.map((tool: Record<string, unknown>) => ({
              id: typeof tool.id === 'string' ? tool.id : undefined,
              name: String(tool.name ?? ''),
              arguments:
                tool.arguments &&
                typeof tool.arguments === 'object' &&
                !Array.isArray(tool.arguments)
                  ? (tool.arguments as Record<string, unknown>)
                  : {},
            }))
          : undefined,
      })),
    )
  } catch (error) {
    throw new Error(
      `FINAGENT_WORKSTATION_TEST_LLM_SCRIPT invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function createLLMFromModelConfig(m: LLMModelConfig): LLMProvider {
  const envProvider = process.env.LLM_PROVIDER
  const envBaseURL = process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL
  const envApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY
  const envModel = process.env.LLM_MODEL ?? process.env.OPENAI_MODEL

  const provider = envProvider ?? m.provider
  const apiKey = m.apiKey || envApiKey || ''
  const model = m.model || envModel || ''
  const rawBase = m.baseURL || envBaseURL || ''
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase

  if (provider === 'anthropic' || model.startsWith('claude')) {
    const endpoint = m.endpoint || '/v1/messages'
    return new AnthropicLLMClient({
      baseURL: (base || 'https://api.anthropic.com') + endpoint,
      apiKey,
      model: model || 'claude-sonnet-4-20250514',
      maxTokens: m.maxTokens,
      contextWindow: m.contextWindow,
      effort: m.effort,
      extraHeaders: m.extraHeaders,
      capabilities: m.capabilities,
    })
  }

  const endpoint = m.endpoint || '/v1/chat/completions'
  return new LLMClient({
    baseURL: (base || 'https://api.openai.com') + endpoint,
    apiKey,
    model: model || 'gpt-4o-mini',
    maxTokens: m.maxTokens,
    contextWindow: m.contextWindow,
    reasoningEffort: m.effort,
    thinking: m.thinking,
    extraHeaders: m.extraHeaders,
    capabilities: m.capabilities,
  })
}
