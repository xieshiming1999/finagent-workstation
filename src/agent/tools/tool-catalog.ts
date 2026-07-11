import type { Tool, ToolCapabilitySummary, ToolContext } from '../tool'

export class ToolCatalogTool implements Tool {
  name = 'ToolCatalog'
  description = 'Inspect the runtime tool catalog and capability summaries. Use list first, then detail for a specific tool.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'list', 'detail', 'modules', 'module'],
        description: 'help, list all tool capabilities, detail one tool, list capability modules, or detail one module',
      },
      tool: { type: 'string', description: 'Tool name for detail action' },
      module: { type: 'string', description: 'Module id for module action' },
    },
  }

  constructor(private readonly capabilitiesProvider: () => ToolCapabilitySummary[]) {}

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'list')
    if (action === 'help') return helpText()
    if (!['list', 'detail', 'modules', 'module'].includes(action)) {
      throw new Error(`Invalid ToolCatalog action "${action}". Use action="help" for supported actions.`)
    }
    const capabilities = this.capabilitiesProvider().sort((a, b) => a.name.localeCompare(b.name))
    if (action === 'modules' || action === 'module') {
      const modules = moduleDescriptors(capabilities)
      if (action === 'module') {
        const moduleId = String(input.module ?? '').trim()
        if (!moduleId) throw new Error('ToolCatalog(action:"module") requires module. Use action="modules" first.')
        const found = modules.find((module) => module.id === moduleId)
        if (!found) {
          throw new Error(`Capability module "${moduleId}" is not registered. Use ToolCatalog(action:"modules") for available modules.`)
        }
        return JSON.stringify({
          contract: 'capability-module-result-v1',
          action,
          module: found,
        })
      }
      return JSON.stringify({
        contract: 'capability-module-result-v1',
        action,
        count: modules.length,
        modules: modules.map((module) => ({
          id: module.id,
          title: module.title,
          permissionClass: module.permissionClass,
          agentPaths: module.agentPaths,
          toolCount: module.tools.length,
        })),
      })
    }
    if (action === 'detail') {
      const name = String(input.tool ?? '').trim()
      if (!name) throw new Error('ToolCatalog detail requires "tool". Use action="list" to inspect tool names.')
      const found = capabilities.find((capability) => capability.name === name)
      if (!found) {
        throw new Error(`Tool "${name}" is not registered. Use ToolCatalog(action:"list") for available tools.`)
      }
      return JSON.stringify({
        contract: 'tool-catalog-result-v1',
        action,
        tool: found,
      })
    }
    return JSON.stringify({
      contract: 'tool-catalog-result-v1',
      action,
      count: capabilities.length,
      tools: capabilities.map((capability) => ({
        name: capability.name,
        permission: capability.permission,
        readOnly: capability.readOnly,
        canParallel: capability.canParallel,
        requiresUserInteraction: capability.requiresUserInteraction,
        actions: capability.schema.actionValues,
      })),
    })
  }
}

function helpText(): string {
  return JSON.stringify({
    contract: 'tool-catalog-help-v1',
    actions: ['list', 'detail', 'modules', 'module'],
    guidance: 'Use list/detail for individual tools. Use modules/module to inspect provider modules, cache/permission behavior, health dependencies, and runtime limitations before broad or unfamiliar work.',
  })
}

interface CapabilityModuleDescriptor {
  id: string
  title: string
  schema: 'provider-module-descriptor-v1'
  runtime: 'finagent-workstation'
  agentPaths: Array<'chat' | 'event'>
  usability: string
  permissionClass: string
  cacheDataContract: string
  healthEvidence: string
  limitations: string
  discovery: string
  tools: ToolCapabilitySummary[]
}

function moduleDescriptors(capabilities: ToolCapabilitySummary[]): CapabilityModuleDescriptor[] {
  const groups = new Map<string, ToolCapabilitySummary[]>()
  for (const capability of capabilities) {
    const moduleId = moduleIdForTool(capability.name)
    groups.set(moduleId, [...(groups.get(moduleId) ?? []), capability])
  }
  const modules = [...groups.entries()]
    .map(([id, tools]) => ({ ...moduleTemplate(id), runtime: 'finagent-workstation' as const, tools }))
  const marketData = capabilities.filter((item) => item.name === 'MarketData')
  if (marketData.length > 0) {
    modules.push({ ...moduleTemplate('strategy-runtime'), runtime: 'finagent-workstation' as const, tools: marketData })
  }
  return modules.sort((a, b) => a.id.localeCompare(b.id))
}

function moduleIdForTool(toolName: string): string {
  const exact: Record<string, string> = {
    MarketData: 'finance-data',
    DataStore: 'finance-data',
    ProviderRouter: 'finance-data',
    BudgetGovernor: 'finance-data',
    Research: 'research-source',
    WebFetch: 'research-source',
    SourceReader: 'research-source',
    Runbook: 'workflow-harness',
    WorkflowVerifier: 'workflow-harness',
    WorkflowEvidence: 'workflow-harness',
    FinanceWorkflowState: 'workflow-harness',
    RecoveryPlanner: 'workflow-harness',
    AgentSelfDebug: 'workflow-harness',
    InteractionEvidence: 'workflow-harness',
    ArtifactRegistry: 'artifact',
    UIControl: 'ui-artifact',
    UIQuery: 'ui-artifact',
    WebView: 'ui-artifact',
    XueqiuTrade: 'trading',
    Portfolio: 'trading',
    Agent: 'sub-agent',
    TaskOutput: 'sub-agent',
    AskUserQuestion: 'interaction',
  }
  return exact[toolName] ?? 'runtime-tool'
}

function moduleTemplate(id: string): Omit<CapabilityModuleDescriptor, 'runtime' | 'tools'> {
  const templates: Record<string, Omit<CapabilityModuleDescriptor, 'runtime' | 'tools'>> = {
    'finance-data': {
      id: 'finance-data',
      title: 'Finance data providers, sidecars, and cache',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Available to chat and event agents through ToolCatalog/ProviderRouter. Event usage should stay bounded for scheduled refresh, watchlist, monitor, probe, and recovery workflows.',
      permissionClass: 'read-only provider/cache',
      cacheDataContract: 'Use local reusable data first when freshness and coverage are sufficient; provider paths must expose source/as-of/fetched-at when available.',
      healthEvidence: 'ProviderRouter, BudgetGovernor, API stats, sidecar health, and data provenance rows explain provider order, gates, and skips.',
      limitations: 'Workstation may use Python/gotdx sidecars and richer provider matrices; availability depends on config, runtime processes, credentials, network, and quotas.',
      discovery: 'Call ProviderRouter(action:"tasks"), BudgetGovernor(action:"status"), and ToolCatalog(action:"detail", tool:"DataStore") before broad provider calls.',
    },
    'research-source': {
      id: 'research-source',
      title: 'Research, web, macro, and source ingestion',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Available to chat and event agents. Event usage should prefer bounded source refresh or macro update tasks, not broad unattended browsing.',
      permissionClass: 'read-only network',
      cacheDataContract: 'Persist durable source evidence or artifact records when content is reused in analysis.',
      healthEvidence: 'BudgetGovernor, source-reader evidence, and tool errors expose quota/network/source failures.',
      limitations: 'Some sites require browser interaction, provider-specific access, or source-specific extraction.',
      discovery: 'Use tool help before fetching broad source collections.',
    },
    'workflow-harness': {
      id: 'workflow-harness',
      title: 'Workflow state, runbooks, verification, recovery, and debugging',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Available to chat and event agents for typed state, verification, recovery, and debugging. Do not replace this with prompt-text parsing.',
      permissionClass: 'read-only plus state writes',
      cacheDataContract: 'Workflow state and evidence live under runtime memory; do not infer intent from prompt text.',
      healthEvidence: 'Runtime state, pending interactions, repeated failures, and verifier output are agent-visible.',
      limitations: 'Verifier coverage is contract-based; domain-specific checks must be added per workflow family.',
      discovery: 'Start with Runbook, FinanceWorkflowState, WorkflowVerifier, AgentSelfDebug, and RecoveryPlanner.',
    },
    artifact: {
      id: 'artifact',
      title: 'Durable artifacts',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Available to chat and event agents for durable outputs. Event-created artifacts must remain inspectable from later chat sessions.',
      permissionClass: 'state write',
      cacheDataContract: 'Artifacts record kind, path, provenance, freshness, verification status, links, and owner task.',
      healthEvidence: 'ArtifactRegistry list/get shows reusable outputs and verification state.',
      limitations: 'Structural UI rendering depends on artifact kind and app surface.',
      discovery: 'Use ArtifactRegistry(action:"help").',
    },
    'ui-artifact': {
      id: 'ui-artifact',
      title: 'UI pages, dashboards, full views, and visual observation',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Chat can create and inspect UI artifacts. Event agent may update or queue UI artifacts only when the runtime has a valid UI bridge.',
      permissionClass: 'UI interaction',
      cacheDataContract: 'Generated pages should be linked as dashboard/report artifacts when reused.',
      healthEvidence: 'UI tool results and workflow evidence show created/opened artifacts.',
      limitations: 'Workstation can expose full views and tables, but WebView display success still needs observable UI evidence.',
      discovery: 'Use UI tool help and ArtifactRegistry links.',
    },
    trading: {
      id: 'trading',
      title: 'Trade preparation and simulated trading',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Chat handles trade preparation and user approval. Event agent may monitor or review, but must not execute trade side effects without explicit approval state.',
      permissionClass: 'approval/side-effect boundary',
      cacheDataContract: 'Trade-preparation artifacts must separate analysis, sizing, approval, and execution evidence.',
      healthEvidence: 'Workflow state, pending approval, and broker/provider status must be visible before action.',
      limitations: 'Real side effects require explicit approval and configured provider state.',
      discovery: 'Use Runbook and FinanceWorkflowState before trade tools.',
    },
    'strategy-runtime': {
      id: 'strategy-runtime',
      title: 'StrategySpec validation, backtest, save, read, and rerun',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Chat can design, validate, backtest, save, and rerun strategies. Event agent can monitor saved strategy conditions and recovery state when configured.',
      permissionClass: 'read-only computation plus strategy artifact writes',
      cacheDataContract: 'Agent-created strategies must flow through StrategySpec, validation report, data coverage, backtest or fund observation evidence, saved artifact, and readback/run evidence before reuse.',
      healthEvidence: 'WorkflowVerifier(strategy_backtest), ArtifactRegistry, FinanceWorkflowState, and MarketData custom_strategy_* results expose lifecycle status, unsupported parts, assumptions, and data coverage.',
      limitations: 'Workstation strategy execution can use richer local data and views, but unsupported indicators, macro prose, news sentiment, arbitrary code, or broker actions must remain rejected unless the StrategySpec contract explicitly supports them.',
      discovery: 'Call Runbook(action:"get", workflow:"strategy_backtest"), ToolCatalog(action:"detail", tool:"MarketData"), then MarketData(action:"custom_strategy_help") before validate/backtest/save/run.',
    },
    'sub-agent': {
      id: 'sub-agent',
      title: 'Sub-agent tasks and handoff',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat'],
      usability: 'Primary use is chat-agent decomposition. Event-agent sub-agent use must be explicit and bounded to avoid unattended recursion.',
      permissionClass: 'runtime task',
      cacheDataContract: 'Task output should become structured evidence or an artifact before parent completion.',
      healthEvidence: 'Task state and TaskOutput determine whether dependent work is complete.',
      limitations: 'Output validation depends on task contract.',
      discovery: 'Use Agent/TaskOutput help and workflow verifier.',
    },
    interaction: {
      id: 'interaction',
      title: 'User questions and approvals',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Both paths can expose pending user questions or approvals. Test automation should inspect and answer deliberately instead of hidden fixed-choice parsing.',
      permissionClass: 'requires user input',
      cacheDataContract: 'Pending interaction state is evidence; do not hide answers in test code.',
      healthEvidence: 'InteractionEvidence and runtimeState expose pending user input.',
      limitations: 'Requires deliberate operator/user answer.',
      discovery: 'Use InteractionEvidence and AgentSelfDebug.',
    },
    'runtime-tool': {
      id: 'runtime-tool',
      title: 'General runtime tools',
      schema: 'provider-module-descriptor-v1',
      agentPaths: ['chat', 'event'],
      usability: 'Availability is tool-specific. Inspect detail and module metadata before use.',
      permissionClass: 'tool-specific',
      cacheDataContract: 'Inspect each tool detail before use.',
      healthEvidence: 'Tool result errors and CapabilityStatus summarize failures.',
      limitations: 'Behavior is tool-specific.',
      discovery: 'Use ToolCatalog(action:"detail").',
    },
  }
  return templates[id] ?? templates['runtime-tool']
}
