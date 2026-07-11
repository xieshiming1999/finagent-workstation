import { describe, it, expect, beforeEach } from 'vitest'
import { Agent } from '../../src/agent/agent'
import { ToolRegistry } from '../../src/agent/tool'
import type { Tool, ToolContext } from '../../src/agent/tool'
import { EchoTool } from '../../src/agent/tools/echo'
import { FileWriteTool } from '../../src/agent/tools/file-write'
import { AgentTool, setAgentFactory } from '../../src/agent/tools/agent-tools'
import { MockLLM } from '../mocks/mock-llm'
import type { AgentEvent } from '../../src/agent/agent-event'
import type { LLMProvider } from '../../src/agent/llm-provider'
import type { Message } from '../../src/agent/message'
import type { SSEEvent } from '../../src/agent/sse-event'
import { FallbackLLMProvider } from '../../src/agent/fallback-llm'
import { detectDoomLoop } from '../../src/agent/agent-helpers'
import { financeWorkflowHooks } from '../../src/domain/finance/workflows/finance-workflow-hooks'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  return (async () => {
    const events: AgentEvent[] = []
    for await (const ev of gen) events.push(ev)
    return events
  })()
}

function strategyWorkflowPrompt(
  text: string,
  intentMode: 'validate' | 'backtest' | 'save' | 'rerun',
  subject = '600519',
): string {
  return `${text}\n` +
    `data: ${JSON.stringify({
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'strategy_design',
        assetClass: 'stock',
        intentMode,
        executionMode: 'preview_only',
        safetyBoundary: intentMode === 'save' ? 'save strategy artifact only' : 'strategy evidence only',
        evidenceRefs: ['StrategySpec'],
        confirmationState: 'none',
        subject,
        subjects: [subject],
        source: 'test-structured-workflow-state',
      },
    })}`
}

class DelayedTool implements Tool {
  name = 'Delayed'
  description = 'Delayed test tool'
  inputSchema = { type: 'object', properties: {} }
  isReadOnly = true

  async call(_id: string, _input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return 'delayed result'
  }
}

class FakeImageTool implements Tool {
  name = 'FakeImage'
  description = 'Fake image-producing tool'
  inputSchema = { type: 'object', properties: {} }
  isReadOnly = true

  async call(_id: string, _input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    return JSON.stringify({
      ok: true,
      content: 'Image saved: /tmp/fake.png',
      images: [{ path: '/tmp/fake.png', mediaType: 'image/png', width: 10, height: 20, sizeBytes: 30 }],
    })
  }
}

class FakeCustomStrategyMarketDataTool implements Tool {
  name = 'MarketData'
  description = 'Fake custom strategy market-data tool'
  inputSchema = { type: 'object', properties: { action: { type: 'string' } } }
  isReadOnly = true
  callCount = 0

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    this.callCount += 1
    if (input.action === 'custom_strategy_validate' && (input.strategySpec as any)?.id === 'sentiment_tape_v1') {
      return JSON.stringify({
        action: 'custom_strategy_validate',
        status: 'rejected',
        strategyId: 'sentiment_tape_v1',
        version: 1,
        spec: { id: 'sentiment_tape_v1', name: 'news and tape' },
        accepted: [],
        warnings: ['news sentiment is not executable'],
        errors: ['unsupported indicator "news_sentiment"', 'unsupported executable rule source "main_fund_flow"'],
        workflowAdvice: 'This validation failed. Report the unsupported executable parts directly.',
      })
    }
    if (input.action === 'custom_strategy_validate' && (input.strategySpec as any)?.id === 'bad_exit_v1') {
      return JSON.stringify({
        action: 'custom_strategy_validate',
        status: 'rejected',
        strategyId: 'bad_exit_v1',
        version: 1,
        spec: { id: 'bad_exit_v1', name: 'bad exit' },
        accepted: [],
        warnings: [],
        errors: ['unsupported exit operator ""', 'exit rule "14" has no executable right-hand value'],
      })
    }
    if (input.action === 'custom_strategy_validate') {
      return JSON.stringify({
        action: 'custom_strategy_validate',
        status: 'validated',
        strategyId: 'custom_rsi_volume_rebound_v1',
        version: 1,
        spec: { id: 'custom_rsi_volume_rebound_v1', name: 'RSI volume rebound', symbol: '600519' },
        accepted: ['entry:rsi14:<', 'exit:rsi14:>', 'exit:stop_loss_pct'],
        warnings: [],
        errors: [],
      })
    }
    if (input.action === 'custom_strategy_backtest') {
      return JSON.stringify({
        action: 'custom_strategy_backtest',
        status: 'backtested',
        symbol: '600519',
        strategyId: 'custom_rsi_volume_rebound_v1',
        actualStartDate: '2025-06-30',
        actualEndDate: '2026-06-26',
        bars: 241,
        metrics: { trades: 0, totalReturn: 0, maxDrawdown: 0, winRate: 0 },
        assumptions: { commissionPct: 0.1, slippagePct: 0.05, positionSizing: 'fixed_fraction 10%' },
        validation: {
          spec: {
            id: 'custom_rsi_volume_rebound_v1',
            name: 'RSI volume rebound',
            symbol: '600519',
            exit: {
              any: [
                { left: 'rsi14', op: '>', right: 60 },
                { type: 'stop_loss_pct', value: 8 },
              ],
            },
          },
        },
      })
    }
    if (input.action === 'custom_strategy_save') {
      return JSON.stringify({
        action: 'custom_strategy_save',
        strategyId: 'custom_rsi_volume_rebound_v1',
        version: 1,
        status: 'backtested',
        spec: { id: 'custom_rsi_volume_rebound_v1', name: 'RSI volume rebound', symbol: '600519' },
        validation: { strategyId: 'custom_rsi_volume_rebound_v1', version: 1 },
        evidence: {
          status: 'backtested',
          actualStartDate: '2025-06-30',
          actualEndDate: '2026-06-26',
          bars: 241,
        },
      })
    }
    if (input.action === 'custom_strategy_run') {
      return JSON.stringify({
        action: 'custom_strategy_run',
        status: 'backtested',
        symbol: '600519',
        strategyId: 'custom_rsi_volume_rebound_v1',
        actualStartDate: '2025-06-30',
        actualEndDate: '2026-06-26',
        bars: 241,
        metrics: { trades: 0, totalReturn: 0, maxDrawdown: 0, winRate: 0 },
      })
    }
    return 'unexpected-market-data-call'
  }
}

class FakeDataProcessTool implements Tool {
  name = 'DataProcess'
  description = 'Fake data-process tool'
  inputSchema = { type: 'object', properties: { action: { type: 'string' } } }
  isReadOnly = true
  callCount = 0

  async call(_id: string, _input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    this.callCount += 1
    return 'data-process-ran'
  }
}

class FakeScriptTool implements Tool {
  name = 'Script'
  description = 'Fake script tool'
  inputSchema = { type: 'object', properties: { code: { type: 'string' } } }
  isReadOnly = false
  callCount = 0

  async call(_id: string, _input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    this.callCount += 1
    return 'script-ran'
  }
}

class SlowTextLLM implements LLMProvider {
  readonly model = 'slow-mock-model'
  readonly contextWindow = 128_000
  cancelled = false
  calls: Array<{ messages: Message[]; toolCount: number }> = []

  clone(): LLMProvider { return this }
  cancel(): void { this.cancelled = true }

  async *sendMessage(_systemPrompt: string, messages: Message[], tools: unknown[]): AsyncGenerator<SSEEvent> {
    this.calls.push({ messages: [...messages], toolCount: tools.length })
    yield { type: 'text-delta', text: 'partial' }
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (this.cancelled) return
    yield { type: 'text-delta', text: 'late' }
    yield { type: 'done', finishReason: 'stop' }
  }
}

class ErrorThenTextLLM implements LLMProvider {
  readonly model = 'error-then-text-mock'
  readonly contextWindow = 128_000
  calls: Array<{ messages: Message[]; toolCount: number }> = []
  private callIndex = 0

  clone(): LLMProvider { return this }
  cancel(): void {}

  async *sendMessage(_systemPrompt: string, messages: Message[], tools: unknown[]): AsyncGenerator<SSEEvent> {
    this.calls.push({ messages: [...messages], toolCount: tools.length })
    this.callIndex += 1
    if (this.callIndex === 1) {
      yield { type: 'error', message: 'provider failed once' }
      return
    }
    yield { type: 'text-delta', text: 'second notification handled' }
    yield { type: 'done', finishReason: 'stop' }
  }
}

class ErrorOnlyLLM implements LLMProvider {
  readonly contextWindow = 128_000
  callCount = 0

  constructor(readonly model: string, private readonly message: string) {}

  clone(): LLMProvider { return this }
  cancel(): void {}

  async *sendMessage(_systemPrompt: string, _messages: Message[], _tools: unknown[]): AsyncGenerator<SSEEvent> {
    this.callCount += 1
    yield { type: 'error', message: this.message }
  }
}

class TextOnlyLLM implements LLMProvider {
  readonly contextWindow = 128_000
  callCount = 0

  constructor(readonly model: string, private readonly text: string) {}

  clone(): LLMProvider { return this }
  cancel(): void {}

  async *sendMessage(_systemPrompt: string, _messages: Message[], _tools: unknown[]): AsyncGenerator<SSEEvent> {
    this.callCount += 1
    yield { type: 'text-delta', text: this.text }
    yield { type: 'done', finishReason: 'stop' }
  }
}

describe('Agent Loop', () => {
  let basePath: string

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'fin-test-'))
  })

  it('handles simple text response', async () => {
    const llm = new MockLLM([{ text: 'Hello!' }])
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('hi'))
    expect(events.some((e) => e.type === 'text-delta')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(llm.calls.length).toBe(1)
  })

  it('falls back immediately when the active model emits a quota error event', async () => {
    const quotaModel = new ErrorOnlyLLM('quota-model', 'Anthropic API error 403: permission_error usage limit for this billing cycle')
    const backupModel = new TextOnlyLLM('backup-model', 'fallback handled the request')
    const llm = new FallbackLLMProvider([quotaModel, backupModel])
    const registry = new ToolRegistry()
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('hi'))
    const text = events.filter((e) => e.type === 'text-delta').map((e: any) => e.text).join('')

    expect(quotaModel.callCount).toBe(1)
    expect(backupModel.callCount).toBe(1)
    expect(text).toContain('fallback handled the request')
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('handles tool call → result → final text', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'Echo', arguments: { message: 'test' } }] },
      { text: 'Done!' },
    ])
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('echo test'))
    const types = events.map((e) => e.type)
    expect(types).toContain('tool-use-start')
    expect(types).toContain('tool-result')
    expect(types).toContain('text-delta')
    expect(types).toContain('done')
    expect(llm.calls.length).toBe(2)
  })

  it('returns error for unknown tool', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'NonExistent', arguments: {} }] },
      { text: 'OK' },
    ])
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('do something'))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('validates tool input before execution', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'Echo', arguments: {} }] },
      { text: 'OK' },
    ])
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('test'))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('saves session after run', async () => {
    const llm = new MockLLM([{ text: 'saved' }])
    const registry = new ToolRegistry()
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    await collectEvents(agent.run('test'))
    expect(agent.messages.length).toBeGreaterThan(0)
  })

  it('does not retain full generated Write payloads in active session context', async () => {
    const html = `<html>${'payload-marker'.repeat(1000)}</html>`
    const outputPath = join(basePath, 'memory', 'pages', 'large.html')
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-write', name: 'Write', arguments: { file_path: outputPath, content: html } }] },
      { text: 'written' },
    ])
    const registry = new ToolRegistry()
    registry.register(new FileWriteTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    await collectEvents(agent.run('write a large page'))

    expect(existsSync(outputPath)).toBe(true)
    expect(readFileSync(outputPath, 'utf-8')).toBe(html)
    const activeContext = JSON.stringify(agent.messages)
    expect(activeContext).toContain('content_summary')
    expect(activeContext).not.toContain('payload-marker'.repeat(100))
  })

  it('preserves structured image metadata from tool results', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-img', name: 'FakeImage', arguments: {} }] },
      { text: 'seen' },
    ])
    const registry = new ToolRegistry()
    registry.register(new FakeImageTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    await collectEvents(agent.run('make image'))

    const result = agent.messages.find((m) => m.toolResult?.toolUseId === 'tc-img')?.toolResult
    expect(result?.content).toBe('Image saved: /tmp/fake.png')
    expect(result?.imagePaths).toEqual(['/tmp/fake.png'])
    expect(result?.imageMetadata?.[0]?.height).toBe(20)
  })

  it('stops custom strategy backtest turns after executable evidence', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-backtest', name: 'MarketData', arguments: { action: 'custom_strategy_backtest', strategySpec: { name: 'RSI volume rebound', symbol: '600519' } } }] },
      {
        toolCalls: [
          { id: 'tc-process', name: 'DataProcess', arguments: { action: 'indicators', symbol: '600519' } },
          { id: 'tc-script', name: 'Script', arguments: { code: 'console.log("extra")' } },
        ],
      },
      { text: 'This response should not be requested.' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    const dataProcess = new FakeDataProcessTool()
    const script = new FakeScriptTool()
    registry.register(marketData)
    registry.register(dataProcess)
    registry.register(script)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    const events = await collectEvents(agent.run(
      strategyWorkflowPrompt('用刚才这个自定义策略回测贵州茅台最近一年表现。', 'backtest'),
    ))

    expect(marketData.callCount).toBeGreaterThanOrEqual(1)
    expect(dataProcess.callCount).toBe(0)
    expect(script.callCount).toBe(0)
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('已完成自定义策略回测'))).toBe(true)
    expect(agent.messages[agent.messages.length - 1].content).toContain('custom_strategy_backtest')
    expect(agent.messages[agent.messages.length - 1].content).toContain('600519')
    expect(llm.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('reports custom strategy save evidence after saving', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-save', name: 'MarketData', arguments: { action: 'custom_strategy_save', strategySpec: { name: 'RSI volume rebound', symbol: '600519' }, evidence: { status: 'backtested' } } }] },
      { toolCalls: [{ id: 'tc-query', name: 'MarketData', arguments: { action: 'query_kline', symbols: ['600519'] } }] },
      { text: 'This response should not be requested.' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    registry.register(marketData)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    const events = await collectEvents(agent.run(
      strategyWorkflowPrompt('创建、回测并保存这个茅台自定义策略，之后可以复用。', 'save'),
    ))

    expect(marketData.callCount).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => e.type === 'text-delta')).toBe(true)
    expect(agent.messages[agent.messages.length - 1].content).toContain('custom_strategy_save')
    expect(agent.messages[agent.messages.length - 1].content).not.toContain('未保存策略')
    expect(llm.calls.length).toBe(1)
  })

  it('redirects save-intent custom strategy drift to save after backtest evidence', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-backtest', name: 'MarketData', arguments: { action: 'custom_strategy_backtest', strategySpec: { name: 'RSI volume rebound', symbol: '600519' } } }] },
      { toolCalls: [{ id: 'tc-kline', name: 'MarketData', arguments: { action: 'kline', code: '600519', range: '5y' } }] },
      { toolCalls: [{ id: 'tc-query', name: 'MarketData', arguments: { action: 'query_kline', symbols: ['600519'] } }] },
      { text: 'This response should not be requested.' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    registry.register(marketData)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    const events = await collectEvents(agent.run(
      strategyWorkflowPrompt('创建、回测并保存这个茅台自定义策略，之后可以复用。', 'save'),
    ))

    expect(marketData.callCount).toBeGreaterThanOrEqual(1)
    const marketActions = agent.messages
      .flatMap((message) => message.toolUses ?? [])
      .filter((call) => call.name === 'MarketData')
      .map((call) => call.input.action)
    expect(marketActions).toContain('custom_strategy_backtest')
    const saveToolUse = agent.messages
      .flatMap((message) => message.toolUses ?? [])
      .find((call) => call.name === 'MarketData' && call.input.action === 'custom_strategy_save')
    expect(saveToolUse?.id).toContain('auto-custom-strategy-save')
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('自定义策略已保存'))).toBe(true)
    expect(agent.messages[agent.messages.length - 1].content).toContain('custom_strategy_save')
    expect(llm.calls.length).toBe(2)
  })

  it('stops a rejected custom strategy validation before drafting another spec in the same turn', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-bad', name: 'MarketData', arguments: { action: 'custom_strategy_validate', strategySpec: { id: 'bad_exit_v1', name: 'bad exit' } } }] },
      { toolCalls: [{ id: 'tc-good', name: 'MarketData', arguments: { action: 'custom_strategy_validate', strategySpec: { id: 'custom_rsi_volume_rebound_v1', name: 'RSI volume rebound', symbol: '600519' } } }] },
      { toolCalls: [{ id: 'tc-backtest', name: 'MarketData', arguments: { action: 'custom_strategy_backtest', strategySpec: { name: 'RSI volume rebound', symbol: '600519' } } }] },
      { toolCalls: [{ id: 'tc-kline', name: 'MarketData', arguments: { action: 'kline', code: '600519', range: '5y' } }] },
      { text: 'This response should not be requested.' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    registry.register(marketData)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    const events = await collectEvents(agent.run(
      strategyWorkflowPrompt('创建、回测并保存这个茅台自定义策略，之后可以复用。', 'save'),
    ))

    expect(marketData.callCount).toBeGreaterThanOrEqual(1)
    const marketActions = agent.messages
      .flatMap((message) => message.toolUses ?? [])
      .filter((call) => call.name === 'MarketData')
      .map((call) => call.input.action)
    expect(marketActions).toContain('custom_strategy_validate')
    expect(marketActions).not.toContain('custom_strategy_backtest')
    expect(marketActions).not.toContain('custom_strategy_save')
    expect(events.some((e) => e.type === 'text-delta')).toBe(true)
    expect(agent.messages[agent.messages.length - 1].content).toContain('未调用 `custom_strategy_backtest`')
  })

  it('does not skip custom strategy run in save and rerun turns', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-save', name: 'MarketData', arguments: { action: 'custom_strategy_save', strategySpec: { name: 'RSI volume rebound', symbol: '600519' }, evidence: { status: 'backtested' } } }] },
      { toolCalls: [{ id: 'tc-run', name: 'MarketData', arguments: { action: 'custom_strategy_run', strategyId: 'custom_rsi_volume_rebound_v1', symbols: ['600519'] } }] },
      { text: '已用保存的 strategyId 重新运行。' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    registry.register(marketData)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    await collectEvents(agent.run(
      strategyWorkflowPrompt('保存这个策略，保存成功后立刻用刚才保存的 strategyId 再跑一次茅台。', 'rerun'),
    ))

    expect(marketData.callCount).toBeGreaterThanOrEqual(2)
    expect(agent.messages[agent.messages.length - 1].content).toContain('重跑')
    expect(llm.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('stops unsupported custom strategy rejection before proxy backtest', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc-validate', name: 'MarketData', arguments: { action: 'custom_strategy_validate', strategySpec: { id: 'sentiment_tape_v1', name: 'news and tape' } } }] },
      { toolCalls: [{ id: 'tc-proxy', name: 'MarketData', arguments: { action: 'custom_strategy_backtest', strategySpec: { name: 'proxy strategy' } } }] },
      { text: 'This response should not be requested.' },
    ])
    const registry = new ToolRegistry()
    const marketData = new FakeCustomStrategyMarketDataTool()
    registry.register(marketData)
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true, domainWorkflowHooks: financeWorkflowHooks })

    await collectEvents(agent.run('创建一个用新闻情绪和主力资金实时盘口决定买卖的策略并回测。'))

    expect(marketData.callCount).toBe(1)
    expect(agent.messages[agent.messages.length - 1].content).toContain('验证状态：rejected')
    expect(agent.messages[agent.messages.length - 1].content).toContain('未调用 `custom_strategy_backtest`')
    expect(agent.messages[agent.messages.length - 1].content).toContain('news_sentiment')
    expect(llm.calls.length).toBe(1)
  })

  it('warns but does not stop non-capture repeated tool loops', async () => {
    const llm = new MockLLM(
      Array(20).fill({ toolCalls: [{ id: 'tc1', name: 'Echo', arguments: { message: 'loop' } }] })
    )
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events = await collectEvents(agent.run('loop'))
    const hasError = events.some((e) => e.type === 'error' && 'message' in e && (e as any).message.includes('loop'))
    expect(hasError).toBe(false)
  })

  it('still stops repeated screenshot loops', () => {
    let warningCount = 0
    let result: 'warn' | 'stop' | false = false
    const calls = Array(9).fill('WebView:{"action":"screenshot","id":"main"}')

    for (let i = 0; i < calls.length; i++) {
      const checked = detectDoomLoop(calls.slice(0, i + 1), warningCount)
      result = checked.result
      warningCount = checked.newWarningCount
    }

    expect(result).toBe('stop')
  })

  it('resets repeated tool-call loop history for a new user turn', async () => {
    const llm = new MockLLM([
      ...Array(8).fill({ toolCalls: [{ id: 'tc1', name: 'Echo', arguments: { message: 'loop' } }] }),
      { text: 'first turn done' },
      { toolCalls: [{ id: 'tc2', name: 'Echo', arguments: { message: 'loop' } }] },
      { text: 'second turn done' },
    ])
    const registry = new ToolRegistry()
    registry.register(new EchoTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    await collectEvents(agent.run('loop'))
    const secondEvents = await collectEvents(agent.run('continue'))
    const hasLoopStop = secondEvents.some((e) =>
      e.type === 'error' && 'message' in e && (e as any).message.includes('stuck in a loop')
    )

    expect(hasLoopStop).toBe(false)
  })

  it('injects queued chat input with the next tool-result loop', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'Delayed', arguments: {} }] },
      { text: 'Done!' },
    ])
    const registry = new ToolRegistry()
    registry.register(new DelayedTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events: AgentEvent[] = []
    for await (const ev of agent.run('start')) {
      events.push(ev)
      if (ev.type === 'tool-use-start') {
        agent.enqueueUserInput('queued follow-up')
      }
    }

    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(llm.calls.length).toBe(2)
    const secondCallContents = llm.calls[1].messages.map((m) => m.content)
    expect(secondCallContents).toContain('queued follow-up')
    expect(llm.calls[1].messages.some((m) => m.toolResult?.content === 'delayed result')).toBe(true)
  })

  it('does not drain queued input mid-loop for event-style agents', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'Delayed', arguments: {} }] },
      { text: 'Done!' },
    ])
    const registry = new ToolRegistry()
    registry.register(new DelayedTool())
    const agent = new Agent({
      llm,
      tools: registry,
      basePath,
      skipPermissions: true,
      drainNotificationsInLoop: false,
    })

    for await (const ev of agent.run('start')) {
      if (ev.type === 'tool-use-start') {
        agent.enqueueUserInput('queued event input')
      }
    }

    expect(llm.calls.length).toBe(2)
    const secondCallContents = llm.calls[1].messages.map((m) => m.content)
    expect(secondCallContents).not.toContain('queued event input')
    expect(agent.notifications.length).toBe(1)
  })

  it('emits a typed cancellation event and does not persist partial assistant output as a completed turn', async () => {
    const llm = new SlowTextLLM()
    const registry = new ToolRegistry()
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    const events: AgentEvent[] = []
    for await (const ev of agent.run('cancel this turn')) {
      events.push(ev)
      if (ev.type === 'text-delta') {
        agent.cancel()
      }
    }

    expect(events.some((e) => e.type === 'cancelled')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(agent.messages.some((m) => m.role === 'assistant' && m.content.includes('partial'))).toBe(false)
  })

  it('delivers scheduled prompts through event-agent queue and persists scheduled-task session content', async () => {
    const llm = new MockLLM([{ text: 'scheduled task handled' }])
    const registry = new ToolRegistry()
    const agent = new Agent({
      llm,
      tools: registry,
      basePath,
      skipPermissions: true,
      drainNotificationsInLoop: false,
    })
    const events: AgentEvent[] = []
    agent.startAutoProcessing((ev) => events.push(ev))

    agent.notifications.enqueue('cron', 'review watchlist risk', 'now')

    for (let i = 0; i < 30 && !events.some((e) => e.type === 'done'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    agent.stopAutoProcessing()

    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('scheduled task handled'))).toBe(true)
    const sessionPath = join(basePath, 'sessions', 'current.jsonl')
    expect(existsSync(sessionPath)).toBe(true)
    const sessionText = readFileSync(sessionPath, 'utf-8')
    expect(sessionText).toContain('<scheduled-task>')
    expect(sessionText).toContain('review watchlist risk')
  })

  it('processes dashboard notifications through event-agent pump in an isolated event session', async () => {
    const llm = new MockLLM([{ text: 'dashboard request handled' }])
    const registry = new ToolRegistry()
    const eventSessionBasePath = join(basePath, 'event-agent')
    const agent = new Agent({
      llm,
      tools: registry,
      basePath,
      sessionBasePath: eventSessionBasePath,
      skipPermissions: true,
      agentRole: 'event',
      drainNotificationsInLoop: false,
    })
    const events: AgentEvent[] = []
    agent.startAutoProcessing((ev) => events.push(ev))

    const prompt = '[Dashboard 通知 from FinAgent 选股推荐 - 2026年6月] ai_analysis_request\n' +
      'data: {"file":"stock-picks-2026-06-01.html","stocks":[{"code":"601919.SH"}]}'
    agent.notifications.enqueue('dashboard', prompt, 'now')

    for (let i = 0; i < 30 && !events.some((e) => e.type === 'done'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    agent.stopAutoProcessing()

    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('[dashboard] Processing notification'))).toBe(true)
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('dashboard request handled'))).toBe(true)
    expect(llm.calls.length).toBe(1)
    expect(llm.calls[0].messages.some((m) => m.content.includes('ai_analysis_request'))).toBe(true)

    const eventSessionPath = join(eventSessionBasePath, 'sessions', 'current.jsonl')
    expect(existsSync(eventSessionPath)).toBe(true)
    const eventSessionText = readFileSync(eventSessionPath, 'utf-8')
    expect(eventSessionText).toContain('ai_analysis_request')
    expect(eventSessionText).toContain('stock-picks-2026-06-01.html')

    const chatSessionPath = join(basePath, 'sessions', 'current.jsonl')
    expect(existsSync(chatSessionPath)).toBe(false)
  })

  it('marks event-agent pump failures without blind retry and continues queued work', async () => {
    const llm = new ErrorThenTextLLM()
    const registry = new ToolRegistry()
    const agent = new Agent({
      llm,
      tools: registry,
      basePath,
      skipPermissions: true,
      agentRole: 'event',
      drainNotificationsInLoop: false,
    })
    const events: AgentEvent[] = []
    agent.startAutoProcessing((ev) => events.push(ev))

    agent.notifications.enqueue('dashboard', 'first notification fails', 'now')
    agent.notifications.enqueue('user_input', 'second notification succeeds', 'next')

    for (let i = 0; i < 50 && llm.calls.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    for (let i = 0; i < 20 && !events.some((e) => e.type === 'text-delta' && e.text.includes('second notification handled')); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    agent.stopAutoProcessing()

    expect(llm.calls).toHaveLength(2)
    expect(events.some((e) => e.type === 'error' && e.message === 'provider failed once')).toBe(true)
    expect(events.some((e) => e.type === 'queue-status' && e.status === 'Queued after failure')).toBe(true)
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('Notification completed with no text output'))).toBe(false)
    expect(events.some((e) => e.type === 'text-delta' && e.text.includes('second notification handled'))).toBe(true)
    expect(agent.notifications.length).toBe(0)
  })

  it('registers the current foreground turn when moved to background', async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: 'tc1', name: 'Delayed', arguments: {} }] },
      { text: 'background result' },
    ])
    const registry = new ToolRegistry()
    registry.register(new DelayedTool())
    const agent = new Agent({ llm, tools: registry, basePath, skipPermissions: true })

    let taskId: string | null = null
    for await (const ev of agent.run('long task')) {
      if (ev.type === 'tool-use-start') {
        taskId = agent.backgroundCurrentTask()
      }
    }

    expect(taskId).toMatch(/^agent-/)
    const task = agent.taskRegistry.get(taskId!)
    expect(task?.status).toBe('completed')
    expect(agent.taskRegistry.readOutput(taskId!)).toContain('background result')
  })

  it('runs Agent tool sub-agents in sidechain sessions recorded on the background task', async () => {
    const parentLlm = new MockLLM([{ text: 'parent idle' }])
    const subLlm = new MockLLM([{ text: 'sub-agent result' }])
    const registry = new ToolRegistry()
    const agentTool = new AgentTool()
    registry.register(agentTool)
    const parent = new Agent({ llm: parentLlm, tools: registry, basePath, skipPermissions: true })
    agentTool.setParentAgent(parent)
    setAgentFactory({
      createLLM: () => subLlm,
      getToolRegistry: () => registry,
      basePath,
      assetsPath: basePath,
    })

    const result = await agentTool.call('tc-agent', {
      description: 'research',
      prompt: 'research this',
      run_in_background: true,
      isolation: 'independent',
    }, {
      basePath,
      workDir: basePath,
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, '.finagent-workstation'),
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: parent.taskRegistry,
      teamRegistry: parent.teamRegistry,
    })

    expect(result).toContain('Task ID: agent-1')
    expect(result).toContain('Ownership: parent-owned-background')
    expect(result).toContain('Parent session:')
    expect(result).toContain('Sidechain:')
    for (let i = 0; i < 20 && parent.taskRegistry.get('agent-1')?.status !== 'completed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const task = parent.taskRegistry.get('agent-1')
    expect(task?.status).toBe('completed')
    expect(task?.sidechainPath).toContain(join('sessions', parent.session.id, 'subagents', 'agent-1'))
    expect(existsSync(join(task!.sidechainPath!, 'sessions', 'current.jsonl'))).toBe(true)
    expect(readFileSync(join(task!.sidechainPath!, 'sessions', 'current.jsonl'), 'utf-8')).toContain('research this')
  })

  it('marks background sub-agents failed when the sidechain agent emits an error event', async () => {
    const parentLlm = new MockLLM([{ text: 'parent idle' }])
    const subLlm = new ErrorThenTextLLM()
    const registry = new ToolRegistry()
    const agentTool = new AgentTool()
    registry.register(agentTool)
    const parent = new Agent({ llm: parentLlm, tools: registry, basePath, skipPermissions: true })
    agentTool.setParentAgent(parent)
    setAgentFactory({
      createLLM: () => subLlm,
      getToolRegistry: () => registry,
      basePath,
      assetsPath: basePath,
    })

    const result = await agentTool.call('tc-agent-fail', {
      description: 'failing research',
      prompt: 'research this and fail',
      run_in_background: true,
      isolation: 'independent',
    }, {
      basePath,
      workDir: basePath,
      memoryDir: join(basePath, 'memory'),
      bundleDir: join(basePath, 'bundle'),
      projectLocalDir: join(basePath, '.finagent-workstation'),
      pluginSkillPaths: [],
      skipPermissions: true,
      approvedTools: new Set(),
      planMode: false,
      readFileTimestamps: new Map(),
      taskRegistry: parent.taskRegistry,
      teamRegistry: parent.teamRegistry,
    })

    expect(result).toContain('Task ID: agent-1')
    for (let i = 0; i < 20 && parent.taskRegistry.get('agent-1')?.status !== 'failed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const task = parent.taskRegistry.get('agent-1')
    expect(task?.status).toBe('failed')
    expect(task?.error).toContain('provider failed once')
    expect(task?.sidechainPath).toContain(join('sessions', parent.session.id, 'subagents', 'agent-1'))
    expect(parent.taskRegistry.readOutput('agent-1')).toContain('provider failed once')
    expect(readFileSync(join(task!.sidechainPath!, 'sessions', 'current.jsonl'), 'utf-8')).toContain('research this and fail')
  })
})
