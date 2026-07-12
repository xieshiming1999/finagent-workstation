import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Agent } from '../../src/agent/agent'
import type { AgentEvent } from '../../src/agent/agent-event'
import { ToolRegistry } from '../../src/agent/tool'
import { AgentSelfDebugTool } from '../../src/agent/tools/agent-self-debug'
import { ArtifactRegistryTool } from '../../src/agent/tools/artifact-registry'
import { BudgetGovernorTool } from '../../src/agent/tools/budget-governor'
import { CapabilityStatusTool } from '../../src/agent/tools/capability-status'
import { FinanceWorkflowStateTool } from '../../src/agent/tools/finance-workflow-state'
import { ProviderRouterTool } from '../../src/agent/tools/provider-router'
import { RecoveryPlannerTool } from '../../src/agent/tools/recovery-planner'
import { RunbookTool } from '../../src/agent/tools/runbook'
import { SourceReaderTool } from '../../src/agent/tools/source-reader'
import { ToolCatalogTool } from '../../src/agent/tools/tool-catalog'
import { WorkflowEvidenceTool } from '../../src/agent/tools/workflow-evidence'
import { WorkflowVerifierTool } from '../../src/agent/tools/workflow-verifier'
import { MockLLM } from '../mocks/mock-llm'

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const ev of gen) events.push(ev)
  return events
}

function harnessRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(new ProviderRouterTool())
  registry.register(new RecoveryPlannerTool())
  registry.register(new RunbookTool())
  registry.register(new WorkflowEvidenceTool())
  registry.register(new WorkflowVerifierTool())
  registry.register(new FinanceWorkflowStateTool())
  registry.register(new ArtifactRegistryTool())
  registry.register(new BudgetGovernorTool())
  registry.register(new SourceReaderTool())
  registry.register(new CapabilityStatusTool(() => registry.capabilities()))
  registry.register(new AgentSelfDebugTool(() => registry.capabilities()))
  registry.register(new ToolCatalogTool(() => registry.capabilities()))
  return registry
}

describe('agent harness reachability', () => {
  it('exposes provider and workflow harness modules through ToolCatalog', async () => {
    const registry = harnessRegistry()
    const catalog = registry.get('ToolCatalog')
    expect(catalog).toBeTruthy()

    const modules = JSON.parse(await catalog!.call('catalog-modules', {
      action: 'modules',
    }, tempContext()))

    expect(modules.contract).toBe('capability-module-result-v1')
    expect(modules.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'finance-data', agentPaths: ['chat', 'event'] }),
      expect.objectContaining({ id: 'workflow-harness', agentPaths: ['chat', 'event'] }),
      expect.objectContaining({ id: 'artifact', agentPaths: ['chat', 'event'] }),
    ]))
    const workflowModule = JSON.parse(await catalog!.call('catalog-workflow', {
      action: 'module',
      module: 'workflow-harness',
    }, tempContext()))
    expect(workflowModule.module.usability).toContain('chat and event agents')
    expect(workflowModule.module.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
      'WorkflowVerifier',
      'FinanceWorkflowState',
      'RecoveryPlanner',
    ]))

    const providerModules = JSON.parse(await catalog!.call('catalog-provider-modules', {
      action: 'providerModules',
    }, tempContext()))
    expect(providerModules.contract).toBe('provider-module-matrix-v2')
    expect(providerModules.runtime).toBe('finagent-workstation')
    expect(providerModules.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'eastmoney',
        statusCounts: expect.objectContaining({ supported: expect.any(Number) }),
        descriptorStatus: 'registered',
      }),
      expect.objectContaining({
        provider: 'macro-official',
        descriptor: expect.objectContaining({
          category: 'macro-official-api-provider',
          agentPaths: ['chat', 'event'],
        }),
      }),
      expect.objectContaining({
        provider: 'ui-artifact',
        descriptor: expect.objectContaining({
          category: 'ui-artifact-provider',
        }),
      }),
    ]))
  })

  it('lets chat and event agents invoke provider routing and workflow discovery tools', async () => {
    for (const agentRole of ['chat', 'event'] as const) {
      const basePath = mkdtempSync(join(tmpdir(), `fin-harness-${agentRole}-`))
      const registry = harnessRegistry()
      const agent = new Agent({
        llm: new MockLLM([
          {
            toolCalls: [
              {
                id: `${agentRole}-catalog`,
                name: 'ToolCatalog',
                arguments: { action: 'module', module: 'workflow-harness' },
              },
              {
                id: `${agentRole}-route`,
                name: 'ProviderRouter',
                arguments: {
                  action: 'route',
                  task: 'quote',
                  providerHealth: [
                    {
                      provider: 'tdx',
                      status: 'runtime_unavailable',
                      reason: 'test unavailable',
                    },
                  ],
                },
              },
            ],
          },
          { text: `${agentRole} path can discover and route.` },
        ]),
        tools: registry,
        basePath,
        sessionBasePath: join(basePath, agentRole),
        skipPermissions: true,
        agentRole,
      })

      const events = await collectEvents(agent.run(`verify ${agentRole} harness reachability`))

      expect(events.some((event) =>
        event.type === 'tool-result' &&
        event.name === 'ToolCatalog' &&
        event.result.includes('workflow-harness')
      )).toBe(true)
      expect(events.some((event) =>
        event.type === 'tool-result' &&
        event.name === 'ProviderRouter' &&
        event.result.includes('runtime_unavailable')
      )).toBe(true)
      expect(events.some((event) =>
        event.type === 'text-delta' &&
        event.text.includes(`${agentRole} path can discover and route`)
      )).toBe(true)
    }
  })
})

function tempContext() {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-harness-context-'))
  return {
    basePath,
    workDir: basePath,
    memoryDir: join(basePath, 'memory'),
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set<string>(),
    planMode: false,
    readFileTimestamps: new Map<string, number>(),
    taskRegistry: null as never,
    teamRegistry: null as never,
  }
}
