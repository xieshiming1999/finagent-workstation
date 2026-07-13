import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { BrowserWindow } from "electron";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve } from "path";
import type { Agent } from "../agent/agent";
import type { AgentEvent } from "../agent/agent-event";
import type { Message } from "../agent/message";
import { ArtifactRegistry } from "../agent/artifact-registry";
import { promptForExternalFinanceOperation } from "../agent/external-finance-contract";
import {
  externalInterventionContract,
  externalReportRevisionContract,
  externalTaskBriefContract,
  promptForExternalIntervention,
  promptForExternalTaskBrief,
  validateExternalIntervention,
  validateExternalTaskBrief,
} from "../agent/external-orchestration-contract";
import { readPaperExecutionReceipt, readPaperExecutionState } from "../agent/paper-execution-readback";
import {
  RunServiceController,
  type RunServiceRunRequest,
} from "../agent/run-service-controller";
import {
  runServiceAdapterDescriptor,
  runServiceCapabilityDescriptor,
} from "../agent/run-service-contract";
import type { RunServiceResultSnapshot } from "../agent/run-service-event-store";
import { RunServiceEventStore } from "../agent/run-service-event-store";
import { queueStatusEvent } from "../agent/agent-background";
import { RunServiceAgentEventObserver } from "./run-service-agent-event-observer";
import {
  buildStrategyLibraryActionPrompt,
  findStrategyLibraryItem,
  readStrategyLibrary,
  type StrategyLibraryItem,
} from "./strategy-library";
import { strategyArtifactPaths } from "../domain/market/strategy-spec/strategy-artifact-contract";
import { RunServiceUiRuntimeCoordinator } from "./run-service-ui-runtime/ui-runtime-coordinator";
import { buildExternalStrategyServiceResult } from "../domain/finance/workflows/external-strategy-service-result";

export interface WorkflowAutomationControlDeps {
  getAgent: () => Agent | null;
  getBasePath: () => string;
  getPanelState?: () => Promise<unknown>;
  captureUiArtifact?: (runId: string) => Promise<Record<string, unknown> | null>;
  emitAgentEvent?: (event: AgentEvent) => void;
  answerUserQuestion?: (
    answer: string,
    options?: { timeoutMs?: number },
  ) => void | Promise<Record<string, unknown> | void>;
  resolvePermission?: (decision: {
    approved: boolean;
    alwaysAllow?: boolean;
    rejectReason?: string;
  }) => void | Promise<Record<string, unknown> | void>;
  getPendingUserQuestion?: () => unknown;
  triggerMonitor?: (
    monitorId: string,
    options?: { timeoutMs?: number },
  ) => Promise<Record<string, unknown>>;
  uiRuntimeCoordinator?: RunServiceUiRuntimeCoordinator;
}

export interface WorkflowAutomationRunResult {
  ok: boolean;
  queued?: boolean;
  runId: string;
  sessionId?: string;
  sessionPath?: string;
  rawSessionAvailable?: boolean;
  rawLineCount?: number;
  prompt: string;
  events: AgentEvent[];
  messages: WorkflowAutomationMessage[];
  partialAssistantText?: string;
  panelState?: unknown;
  uiEvidence?: Record<string, unknown>;
  uiArtifacts?: Array<Record<string, unknown>>;
  reportPath?: string;
  error?: string;
}

export interface WorkflowAutomationScenario {
  id: string;
  prompt: string;
  workflowState?: unknown;
  expectTools?: string[];
  expectToolActions?: string[];
  expectToolErrors?: string[];
  expectToolResultContains?: string[];
  expectFinalContains?: string[];
  expectSessionContains?: string[];
  expectPanelStateKeys?: string[];
  expectUiEvidencePaths?: string[];
  expectUiArtifactKinds?: string[];
  disallowTools?: string[];
  maxToolActionCounts?: Record<string, number>;
  minToolCalls?: number;
  maxToolCalls?: number;
  maxDataToolCalls?: number;
  timeoutMs?: number;
  disallowRawHtml?: boolean;
  expectNoToolErrors?: boolean;
  allowPendingUserQuestion?: boolean;
  autoAnswerUserQuestions?: string[];
}

export interface WorkflowAutomationScenarioTurn {
  id?: string;
  prompt: string;
  workflowState?: unknown;
  expectTools?: string[];
  expectToolActions?: string[];
  expectToolErrors?: string[];
  expectToolResultContains?: string[];
  expectFinalContains?: string[];
  expectSessionContains?: string[];
  expectPanelStateKeys?: string[];
  expectUiEvidencePaths?: string[];
  expectUiArtifactKinds?: string[];
  disallowTools?: string[];
  maxToolActionCounts?: Record<string, number>;
  minToolCalls?: number;
  maxToolCalls?: number;
  maxDataToolCalls?: number;
  timeoutMs?: number;
  disallowRawHtml?: boolean;
  expectNoToolErrors?: boolean;
  allowPendingUserQuestion?: boolean;
  autoAnswerUserQuestions?: string[];
}

export interface WorkflowAutomationScenarioResult {
  ok: boolean;
  scenarioId: string;
  run: WorkflowAutomationRunResult;
  assertions: Array<{
    name: string;
    ok: boolean;
    expected?: unknown;
    actual?: unknown;
  }>;
  scenarioReportPath?: string;
}

function promptWithWorkflowState(prompt: string, workflowState: unknown): string {
  if (!workflowState || typeof workflowState !== "object" || Array.isArray(workflowState)) {
    return prompt;
  }
  return `${prompt}\n\ndata: ${JSON.stringify({ workflowState })}`;
}

export interface WorkflowAutomationMultiTurnScenario {
  id: string;
  turns: WorkflowAutomationScenarioTurn[];
  expectSessionContains?: string[];
  expectToolActions?: string[];
  expectPanelStateKeys?: string[];
  expectUiEvidencePaths?: string[];
  expectUiArtifactKinds?: string[];
  disallowTools?: string[];
  maxToolActionCounts?: Record<string, number>;
  maxToolCalls?: number;
  maxDataToolCalls?: number;
  disallowRawHtml?: boolean;
  expectNoToolErrors?: boolean;
}

export interface WorkflowAutomationMultiTurnScenarioResult {
  ok: boolean;
  scenarioId: string;
  turns: Array<WorkflowAutomationScenarioResult & { turnId: string; turnIndex: number }>;
  assertions: WorkflowAutomationScenarioResult["assertions"];
  scenarioReportPath?: string;
}

export interface WorkflowAutomationMessage {
  role: string;
  content: string;
  timestamp?: string;
  toolUses?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  toolResult?: {
    toolUseId: string;
    content: string;
    isError: boolean;
    imagePaths?: string[];
  };
}

export interface WorkflowAutomationIdleResult {
  ok: boolean;
  idle: boolean;
  agentReady: boolean;
  agentRunning: boolean;
  waitedMs: number;
  timedOut: boolean;
}

export interface WorkflowAutomationCancelResult {
  ok: boolean;
  agentReady: boolean;
  runningBeforeCancel: boolean;
  cancelRequested: boolean;
  agentRunning: boolean;
  reason: string;
}

export interface WorkflowAutomationClearSessionResult {
  ok: boolean;
  agentReady: boolean;
  reason?: string;
  sessionId?: string;
  sessionPath?: string;
  rawSessionAvailable?: boolean;
  rawLineCount?: number;
  messageCount?: number;
}

export interface WorkflowAutomationStrategyLibraryActionResult
  extends WorkflowAutomationRunResult {
  action: string;
  strategy: StrategyLibraryItem;
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
  toolErrors: Array<{ toolUseId: string; content: string }>;
  finalAssistantText: string;
}

export class WorkflowAutomationControl {
  private readonly runService: RunServiceController;
  private readonly uiRuntimeCoordinator: RunServiceUiRuntimeCoordinator;
  private nextRunServiceFailure?: string;

  constructor(private readonly deps: WorkflowAutomationControlDeps) {
    this.uiRuntimeCoordinator =
      deps.uiRuntimeCoordinator ?? new RunServiceUiRuntimeCoordinator();
    this.runService = new RunServiceController(
      (request) => this.runServicePromptRunner(request),
      {
        eventStore: new RunServiceEventStore(undefined, {
          persistencePath: join(
            this.deps.getBasePath(),
            "data",
            "run-service",
            "events.jsonl",
          ),
        }),
      },
    );
  }

  enabled(): boolean {
    return process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION === "1";
  }

  armRunServiceFailure(mode: string): Record<string, unknown> {
    if (!this.enabled()) throw new Error("run-service failure injection requires workflow automation");
    if (mode !== "next-llm-call") throw new Error(`unsupported run-service failure mode: ${mode}`);
    this.nextRunServiceFailure = mode;
    return { ok: true, kind: "run.failure.armed", mode, oneShot: true };
  }

  health(): Record<string, unknown> {
    const agent = this.deps.getAgent();
    return {
      ok: true,
      enabled: this.enabled(),
      agentReady: Boolean(agent),
      agentRunning: agent?.isRunning ?? false,
      transport: "loopback-http",
      localOnly: true,
      rawSocketProtocol: false,
      webSocketCommandProtocol: false,
      providerEndpointBypass: false,
      serviceProcessMode: process.env.FINAGENT_WORKSTATION_SERVICE_MODE === "1",
      bootstrapWindowVisible: (BrowserWindow?.getAllWindows?.() ?? []).some((window) => window.isVisible()),
      basePath: this.deps.getBasePath(),
    };
  }

  paperExecutionState(market = "cn"): Record<string, unknown> {
    return readPaperExecutionState(this.deps.getBasePath(), market);
  }

  paperExecutionReceipt(idempotencyKey: string, market = "cn"): Record<string, unknown> {
    return readPaperExecutionReceipt(this.deps.getBasePath(), idempotencyKey, market);
  }

  async sendPrompt(
    prompt: string,
    options: {
      timeoutMs?: number;
      timeoutReason?: string;
      minToolCalls?: number;
      maxToolCalls?: number;
      maxDataToolCalls?: number;
      maxToolActionCounts?: Record<string, number>;
      expectTools?: string[];
      expectToolActions?: string[];
      disallowTools?: string[];
      allowPendingUserQuestion?: boolean;
      autoAnswerUserQuestions?: string[];
      requireEnabled?: boolean;
      emitUserInput?: boolean;
      emitServiceEvent?: RunServiceRunRequest["emitServiceEvent"];
      requirePermissions?: boolean;
    } = {},
  ): Promise<WorkflowAutomationRunResult> {
    if (options.requireEnabled !== false && !this.enabled()) {
      throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    }
    const agent = this.deps.getAgent();
    if (!agent) throw new Error("WORKFLOW_AUTOMATION_AGENT_MISSING");
    const trimmed = String(prompt ?? "").trim();
    if (!trimmed) throw new Error("WORKFLOW_AUTOMATION_PROMPT_REQUIRED");

    const runId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const events: AgentEvent[] = [];
    let queued = false;
    let error: string | undefined;
    const messageStartIndex = agent.messages.length;

    try {
      const executablePrompt = buildWorkflowPrompt(trimmed, options);
      if (options.emitUserInput !== false) {
        this.deps.emitAgentEvent?.({ type: "user-input", text: trimmed });
      }
      if (agent.isRunning) {
        agent.enqueueUserInput(executablePrompt);
        const event = queueStatusEvent(agent.notifications, "Queued");
        events.push(event);
        this.deps.emitAgentEvent?.(event);
        queued = true;
      } else {
        await this.collectRunEventsWithTimeout(
          agent,
          executablePrompt,
          events,
          options.timeoutMs,
          options.timeoutReason ?? "workflow-send-timeout",
          {
            maxToolCalls: options.maxToolCalls,
            maxDataToolCalls: options.maxDataToolCalls,
            disallowTools: options.disallowTools,
            allowPendingUserQuestion: options.allowPendingUserQuestion,
            autoAnswerUserQuestions: options.autoAnswerUserQuestions,
            emitServiceEvent: options.emitServiceEvent,
            requirePermissions: options.requirePermissions,
          },
        );
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const event: AgentEvent = { type: "error", message: error };
      events.push(event);
      this.deps.emitAgentEvent?.(event);
    }

    const messages = serializeMessages(agent.messages.slice(messageStartIndex));
    const eventError = events.find((event) => event.type === "error");
    const finalAssistant =
      [...messages].reverse().find((message) => message.role === "assistant")
        ?.content ?? "";
    const partialAssistantText = collectPartialAssistantText(events);
    const runError =
      error ??
      (eventError?.type === "error" ? eventError.message : undefined) ??
      (queued || finalAssistant.trim().length > 0
        ? undefined
        : "WORKFLOW_AUTOMATION_EMPTY_FINAL");

    const result: WorkflowAutomationRunResult = {
      ok: !runError,
      queued,
      runId,
      sessionId: agent.session.id,
      sessionPath: this.currentSessionPath(),
      rawSessionAvailable: existsSync(this.currentSessionPath()),
      rawLineCount: countNonEmptyLines(this.currentSessionPath()),
      prompt: trimmed,
      events,
      messages,
      partialAssistantText,
      panelState: await this.safePanelState(),
      error: runError,
    };
    result.uiEvidence = mergeUiEvidence(
      buildUiEvidence(result.panelState),
      this.runtimeUiEvidence(),
    );
    result.uiArtifacts = mergeUiArtifacts(
      await this.safeUiArtifacts(runId, result.panelState),
      toolEvidenceArtifacts(result.messages),
    );
    result.reportPath = this.writeReport(result);
    return result;
  }

  async runServicePrompt(
    request: RunServiceRunRequest,
  ): Promise<RunServiceResultSnapshot> {
    const result = await this.runService.runPrompt(request);
    return result;
  }

  startRunServicePrompt(request: RunServiceRunRequest): Record<string, unknown> {
    const started = this.runService.startPrompt(request);
    void started.completion;
    return {
      ok: true,
      kind: "run.accepted",
      runId: started.runId,
      status: "running",
    };
  }

  runServiceEvents(input: {
    runId: string;
    after?: number;
  }): Record<string, unknown> {
    const events = this.runService.eventStore.events(input);
    return {
      ok: true,
      runId: input.runId,
      after: input.after ?? 0,
      count: events.length,
      events,
    };
  }

  runServiceResult(runId: string): RunServiceResultSnapshot {
    return this.runService.eventStore.result(runId);
  }

  runServiceState(runId: string): Record<string, unknown> {
    return this.runService.eventStore.state(runId);
  }

  runServiceMessages(runId: string, after = 0): Record<string, unknown> {
    return this.runService.eventStore.messages(runId, after);
  }

  waitForRunServiceEvents(input: { runId: string; after?: number; timeoutMs?: number }) {
    return this.runService.eventStore.wait(input);
  }

  runServiceRuns(limit = 20): Record<string, unknown> {
    const runs = this.runService.eventStore.results(limit).map(runServiceResultSummary);
    return { ok: true, kind: "runs.list", count: runs.length, runs };
  }

  runServicePending(runId: string): Record<string, unknown> {
    return {
      ok: true,
      kind: "run.pending",
      ...this.runService.eventStore.pending(runId),
    };
  }

  pendingRequestId(
    runId: string,
    kind: "interaction" | "permission",
    requestedId?: string,
  ): string | undefined {
    const pending = this.runService.eventStore.pending(runId);
    const events = kind === "interaction"
      ? pending.pendingInteractions
      : pending.pendingPermissions;
    const ids = events
      .map((event) => String(event.payload?.requestId ?? event.payload?.id ?? "").trim())
      .filter(Boolean);
    const requested = String(requestedId ?? "").trim();
    if (requested && !ids.includes(requested)) {
      throw new Error(`RUN_SERVICE_PENDING_REQUEST_MISMATCH: ${requested} is not pending for run ${runId}`);
    }
    if (requested) return requested;
    if (ids.length === 0) return undefined;
    if (ids.length !== 1) {
      throw new Error(`RUN_SERVICE_PENDING_REQUEST_REQUIRED: run ${runId} has ${ids.length} pending ${kind} requests`);
    }
    return ids[0];
  }

  supportsUiRuntime(mode: "visible" | "headless" | "mirror"): boolean {
    return this.uiRuntimeCoordinator.supports(mode);
  }

  private async runServicePromptRunner(
    request: Required<Pick<RunServiceRunRequest, "prompt">> & RunServiceRunRequest,
  ) {
    const uiRuntime = request.uiRuntime ?? "visible";
    return await this.uiRuntimeCoordinator.use(uiRuntime, async (uiPreparation) => {
      if (!uiPreparation.available) {
        return {
          ok: false,
          finalAnswer: "",
          sessionId: this.deps.getAgent()?.session.id,
          error: uiPreparation.error,
          provenance: { uiRuntime },
        };
      }
      const sessionError = this.prepareRunServiceSession(request);
      if (sessionError) {
        return {
          ok: false,
          finalAnswer: "",
          sessionId: this.deps.getAgent()?.session.id,
          error: sessionError,
          provenance: { uiRuntime },
        };
      }
      const injectedFailure = this.nextRunServiceFailure;
      if (injectedFailure) {
        this.nextRunServiceFailure = undefined;
        return {
          ok: false,
          finalAnswer: "",
          sessionId: this.deps.getAgent()?.session.id,
          error: `RUN_SERVICE_TEST_AGENT_FAILURE: deterministic ${injectedFailure} failure`,
          errorCategory: "agent.runtime",
          recovery: "Resume the same session after the one-shot failure is cleared.",
          provenance: { uiRuntime },
        };
      }
      const run = await this.sendPrompt(request.prompt, {
        timeoutMs: request.timeoutMs,
        timeoutReason: "run-service",
        requireEnabled: request.payload?.entryMode !== "frontend",
        emitUserInput: request.payload?.entryMode !== "frontend",
        emitServiceEvent: request.emitServiceEvent,
        requirePermissions: serviceRunRequiresPermissions(request),
      });
      const externalStrategyResult = buildExternalStrategyServiceResult({
        basePath: this.deps.getBasePath(),
        payload: request.payload,
        messages: this.deps.getAgent()?.messages ?? [],
      });
      return {
        ok: run.ok,
        finalAnswer: externalStrategyResult?.finalAnswer ?? assistantReviewText(run),
        sessionId: run.sessionId,
        error: run.error,
        toolCalls: run.messages.flatMap((message) =>
          message.toolUses?.map((tool) => ({
            id: tool.id,
            tool: tool.name,
            input: tool.input,
          })) ?? [],
        ),
        toolResults: run.messages
          .map((message) => message.toolResult)
          .filter((result): result is NonNullable<typeof result> => Boolean(result))
          .map((result) => ({
            toolUseId: result.toolUseId,
            isError: result.isError,
            contentPreview: previewText(result.content),
            imagePaths: result.imagePaths,
          })),
        uiArtifacts: [
          ...(externalStrategyResult ? [externalStrategyResult.artifact] : []),
          ...(run.uiArtifacts ?? []),
        ],
        provenance: {
          reportPath: run.reportPath,
          sessionPath: run.sessionPath,
          uiRuntime,
        },
      };
    });
  }

  private prepareRunServiceSession(request: RunServiceRunRequest): string | undefined {
    const agent = this.deps.getAgent();
    if (!agent) return "RUN_SERVICE_AGENT_MISSING: start the FinAgent runtime before creating a run";
    if (agent.isRunning) {
      return "RUN_SERVICE_SESSION_BUSY: wait for the active run or interrupt it before starting another run";
    }
    const mode = request.sessionMode ?? "new";
    if (mode === "new") {
      agent.clearSession();
      return undefined;
    }
    if (mode === "resume") {
      const requestedId = String(request.sessionId ?? "").trim();
      if (agent.session.id === requestedId) return undefined;
      const match = agent.listSessions().find((session) => session.id === requestedId);
      if (!match) {
        return `RUN_SERVICE_SESSION_NOT_FOUND: no durable session exists for sessionId ${requestedId}; use GET /sessions to discover resumable ids`;
      }
      agent.resumeSession(match.path);
      return undefined;
    }
    if (mode === "attached") {
      const requestedId = String(request.sessionId ?? "").trim();
      if (requestedId && requestedId !== agent.session.id) {
        return `RUN_SERVICE_SESSION_MISMATCH: attached sessionId ${requestedId} is not the active visible session; use resume or omit sessionId`;
      }
      return undefined;
    }
    if (mode === "preload") {
      const requestedId = String(request.sessionId ?? "").trim();
      if (agent.session.id === requestedId) {
        agent.preloadCurrentSession();
        return undefined;
      }
      const match = agent.listSessions().find((session) => session.id === requestedId);
      if (!match) {
        return `RUN_SERVICE_SESSION_NOT_FOUND: no durable session exists for sessionId ${requestedId}; use GET /sessions to discover preloadable ids`;
      }
      agent.preloadSession(match.path);
      return undefined;
    }
    return "RUN_SERVICE_SESSION_MODE_UNSUPPORTED: ephemeral requires isolated non-history persistence and is not implemented yet";
  }

  private async collectRunEventsWithTimeout(
    agent: Agent,
    prompt: string,
    events: AgentEvent[],
    timeoutMs: number | undefined,
    timeoutReason: string,
    limits: {
      maxToolCalls?: number;
      maxDataToolCalls?: number;
      disallowTools?: string[];
      allowPendingUserQuestion?: boolean;
      autoAnswerUserQuestions?: string[];
      emitServiceEvent?: RunServiceRunRequest["emitServiceEvent"];
      requirePermissions?: boolean;
    } = {},
  ): Promise<void> {
    const boundedTimeout = normalizeWorkflowTimeoutMs(timeoutMs);
    const maxToolCalls = normalizeWorkflowLimit(limits.maxToolCalls);
    const maxDataToolCalls = normalizeWorkflowLimit(limits.maxDataToolCalls);
    const disallowedTools = new Set(
      (limits.disallowTools ?? []).map((tool) => tool.trim()).filter(Boolean),
    );
    let toolCalls = 0;
    let dataToolCalls = 0;
    const dataToolCallNames: string[] = [];
    let timedOut = false;
    let limitError: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    const serviceEvents = new RunServiceAgentEventObserver(
      limits.emitServiceEvent,
    );
    if (boundedTimeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        agent.cancel();
      }, boundedTimeout);
    }
    try {
      for await (const event of agent.run(prompt, {
        disabledTools: limits.disallowTools,
        requirePermissions: limits.requirePermissions,
      })) {
        events.push(event);
        this.deps.emitAgentEvent?.(event);
        serviceEvents.observe(event);
        if (event.type === "tool-use-start") {
          const toolName = toolNameFromEvent(event);
          toolCalls += 1;
          if (toolName && isDataWorkflowTool(toolName)) {
            dataToolCalls += 1;
            dataToolCallNames.push(toolName);
          }
          if (toolName === "AskUserQuestion") {
            const answer = selectAskUserQuestionAnswer(
              event.input,
              limits.autoAnswerUserQuestions ?? [],
            );
            if (answer) {
              setTimeout(() => this.deps.answerUserQuestion?.(answer), 0);
            }
          }
          if (toolName && disallowedTools.has(toolName)) {
            limitError = `WORKFLOW_AUTOMATION_TOOL_LIMIT: ${timeoutReason} used disallowed tool ${toolName}`;
            agent.cancel();
          } else if (maxToolCalls != null && toolCalls > maxToolCalls) {
            limitError = `WORKFLOW_AUTOMATION_TOOL_LIMIT: ${timeoutReason} exceeded maxToolCalls ${maxToolCalls}`;
            agent.cancel();
          } else if (
            maxDataToolCalls != null &&
            dataToolCalls > maxDataToolCalls
          ) {
            const counted = dataToolCallNames.join(", ");
            limitError = `WORKFLOW_AUTOMATION_TOOL_LIMIT: ${timeoutReason} exceeded maxDataToolCalls ${maxDataToolCalls}; counted workflow data tools: ${counted}`;
            agent.cancel();
          }
        }
        if (limitError) break;
        if (timedOut) break;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (timedOut) {
      const message = `WORKFLOW_AUTOMATION_TIMEOUT: ${timeoutReason} exceeded ${boundedTimeout}ms`;
      const event: AgentEvent = { type: "error", message };
      events.push(event);
      this.deps.emitAgentEvent?.(event);
      throw new Error(message);
    }
    if (limitError) {
      const event: AgentEvent = { type: "error", message: limitError };
      events.push(event);
      this.deps.emitAgentEvent?.(event);
      throw new Error(limitError);
    }
  }

  async runScenario(
    scenario: WorkflowAutomationScenario,
  ): Promise<WorkflowAutomationScenarioResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const id = String(scenario.id ?? "").trim();
    if (!id) throw new Error("WORKFLOW_AUTOMATION_SCENARIO_ID_REQUIRED");
    const run = await this.sendPrompt(promptWithWorkflowState(scenario.prompt, scenario.workflowState), {
      timeoutMs: scenario.timeoutMs,
      timeoutReason: `scenario ${id}`,
      minToolCalls: scenario.minToolCalls,
      maxToolCalls: scenario.maxToolCalls,
      maxDataToolCalls: scenario.maxDataToolCalls,
      maxToolActionCounts: scenario.maxToolActionCounts,
      expectTools: scenario.expectTools,
      expectToolActions: scenario.expectToolActions,
      disallowTools: scenario.disallowTools,
      allowPendingUserQuestion: scenario.allowPendingUserQuestion,
      autoAnswerUserQuestions: scenario.autoAnswerUserQuestions,
    });
    const assertions = evaluateScenario(scenario, run);
    const result: WorkflowAutomationScenarioResult = {
      ok: run.ok && assertions.every((assertion) => assertion.ok),
      scenarioId: id,
      run,
      assertions,
    };
    result.scenarioReportPath = this.writeScenarioReport(result);
    return result;
  }

  async runMultiTurnScenario(
    scenario: WorkflowAutomationMultiTurnScenario,
  ): Promise<WorkflowAutomationMultiTurnScenarioResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const id = String(scenario.id ?? "").trim();
    if (!id) throw new Error("WORKFLOW_AUTOMATION_SCENARIO_ID_REQUIRED");
    if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) {
      throw new Error("WORKFLOW_AUTOMATION_SCENARIO_TURNS_REQUIRED");
    }
    const turns: WorkflowAutomationMultiTurnScenarioResult["turns"] = [];
    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      const turnId = String(turn.id ?? `turn-${i + 1}`);
      const run = await this.sendPrompt(promptWithWorkflowState(turn.prompt, turn.workflowState), {
        timeoutMs: turn.timeoutMs,
        timeoutReason: `scenario ${id}:${turnId}`,
        minToolCalls: turn.minToolCalls,
        maxToolCalls: turn.maxToolCalls,
        maxDataToolCalls: turn.maxDataToolCalls,
        maxToolActionCounts: turn.maxToolActionCounts,
        expectTools: turn.expectTools,
        expectToolActions: turn.expectToolActions,
        disallowTools: turn.disallowTools,
        allowPendingUserQuestion: turn.allowPendingUserQuestion,
        autoAnswerUserQuestions: turn.autoAnswerUserQuestions,
      });
      const assertions = evaluateScenario(
        {
          id: `${id}:${turnId}`,
          prompt: turn.prompt,
          expectTools: turn.expectTools,
          expectToolActions: turn.expectToolActions,
          expectToolErrors: turn.expectToolErrors,
          expectToolResultContains: turn.expectToolResultContains,
          expectFinalContains: turn.expectFinalContains,
          expectSessionContains: turn.expectSessionContains,
          expectPanelStateKeys: turn.expectPanelStateKeys,
          expectUiEvidencePaths: turn.expectUiEvidencePaths,
          expectUiArtifactKinds: turn.expectUiArtifactKinds,
          disallowTools: turn.disallowTools,
          maxToolActionCounts: turn.maxToolActionCounts,
          minToolCalls: turn.minToolCalls,
          maxToolCalls: turn.maxToolCalls,
          maxDataToolCalls: turn.maxDataToolCalls,
          disallowRawHtml: turn.disallowRawHtml,
          expectNoToolErrors: turn.expectNoToolErrors,
        },
        run,
      );
      turns.push({
        ok: run.ok && assertions.every((assertion) => assertion.ok),
        scenarioId: `${id}:${turnId}`,
        turnId,
        turnIndex: i,
        run,
        assertions,
        scenarioReportPath: this.writeScenarioReport({
          ok: run.ok && assertions.every((assertion) => assertion.ok),
          scenarioId: `${id}:${turnId}`,
          run,
          assertions,
        }),
      });
    }
    const finalRun = turns[turns.length - 1].run;
    const combinedRun: WorkflowAutomationRunResult = {
      ...finalRun,
      prompt: scenario.turns.map((turn) => turn.prompt).join("\n"),
      events: turns.flatMap((turn) => turn.run.events),
      messages: turns.flatMap((turn) => turn.run.messages),
      uiArtifacts: turns.flatMap((turn) => turn.run.uiArtifacts ?? []),
    };
    combinedRun.uiEvidence = mergeUiEvidence(
      buildUiEvidence(combinedRun.panelState),
      ...turns.map((turn) => turn.run.uiEvidence),
    );
    const aggregateAssertions = evaluateScenario(
      {
        id,
        prompt: scenario.turns.map((turn) => turn.prompt).join("\n"),
        expectSessionContains: scenario.expectSessionContains,
        expectToolActions: scenario.expectToolActions,
        expectPanelStateKeys: scenario.expectPanelStateKeys,
        expectUiEvidencePaths: scenario.expectUiEvidencePaths,
        expectUiArtifactKinds: scenario.expectUiArtifactKinds,
      },
      combinedRun,
    );
    aggregateAssertions.unshift({
      name: "turns.ok",
      ok: turns.every((turn) => turn.ok),
      expected: "all turns ok",
      actual: turns.map((turn) => ({ turnId: turn.turnId, ok: turn.ok })),
    });
    const result: WorkflowAutomationMultiTurnScenarioResult = {
      ok:
        turns.every((turn) => turn.ok) &&
        aggregateAssertions.every((assertion) => assertion.ok),
      scenarioId: id,
      turns,
      assertions: aggregateAssertions,
    };
    result.scenarioReportPath = this.writeMultiTurnScenarioReport(result);
    return result;
  }

  async sessionEvidence(): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const agent = this.deps.getAgent();
    if (!agent) throw new Error("WORKFLOW_AUTOMATION_AGENT_MISSING");
    const sessionPath = this.currentSessionPath();
    return {
      sessionId: agent.session.id,
      sessionPath,
      messages: serializeMessages(agent.messages),
      rawSessionAvailable: existsSync(sessionPath),
      rawLineCount: countNonEmptyLines(sessionPath),
    };
  }

  async listSessions(): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const agent = this.deps.getAgent();
    if (!agent) throw new Error("WORKFLOW_AUTOMATION_AGENT_MISSING");
    const sessions = agent.listSessions().map((session) => ({
      id: session.isCurrent === true ? agent.session.id : session.id,
      name: session.name,
      path: session.path,
      ...(session.title ? { title: session.title } : {}),
      ...(session.firstPrompt ? { firstPrompt: session.firstPrompt } : {}),
      ...(session.createdAt ? { createdAt: session.createdAt } : {}),
      isCurrent: session.isCurrent === true || session.id === agent.session.id,
    }));
    return {
      ok: true,
      kind: "sessions.list",
      currentSessionId: agent.session.id,
      count: sessions.length,
      sessions,
    };
  }

  async createSession(input: {
    reason?: string;
  } = {}): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const reason = input.reason?.trim() || "run-service";
    return {
      kind: "session.created",
      ...(await this.clearSession({ reason })),
    };
  }

  async panelState(): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const panelState = await this.safePanelState();
    return {
      ok: true,
      panelState,
      uiEvidence: mergeUiEvidence(
        buildUiEvidence(panelState),
        this.runtimeUiEvidence(),
      ),
    };
  }

  pendingUserQuestion(): Record<string, unknown> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    return {
      ok: true,
      pending: this.deps.getPendingUserQuestion?.() ?? null,
    };
  }

  async waitForIdle(timeoutMs = 5000): Promise<WorkflowAutomationIdleResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const startedAt = Date.now();
    const boundedTimeout = Math.max(0, Math.min(60_000, Math.floor(timeoutMs)));
    let agent = this.deps.getAgent();
    while (agent?.isRunning && Date.now() - startedAt < boundedTimeout) {
      await delay(50);
      agent = this.deps.getAgent();
    }
    const waitedMs = Date.now() - startedAt;
    const agentRunning = agent?.isRunning ?? false;
    const idle = Boolean(agent) && !agentRunning;
    return {
      ok: idle,
      idle,
      agentReady: Boolean(agent),
      agentRunning,
      waitedMs,
      timedOut: !idle && waitedMs >= boundedTimeout,
    };
  }

  async cancel(reason = "workflow-automation"): Promise<WorkflowAutomationCancelResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const agent = this.deps.getAgent();
    const runningBeforeCancel = agent?.isRunning ?? false;
    if (agent && runningBeforeCancel) agent.cancel();
    return {
      ok: true,
      agentReady: Boolean(agent),
      runningBeforeCancel,
      cancelRequested: Boolean(agent && runningBeforeCancel),
      agentRunning: agent?.isRunning ?? false,
      reason: String(reason || "workflow-automation"),
    };
  }

  async answerUserQuestion(
    answer: string,
    options: { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const normalized = String(answer ?? "").trim();
    if (!normalized) throw new Error("WORKFLOW_AUTOMATION_ANSWER_REQUIRED");
    const evidence = await this.deps.answerUserQuestion?.(normalized, {
      timeoutMs: options.timeoutMs,
    });
    return { ok: true, answer: normalized, ...(evidence ?? {}) };
  }

  async resolvePermission(input: {
    approved: boolean;
    alwaysAllow?: boolean;
    rejectReason?: string;
  }): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const evidence = await this.deps.resolvePermission?.({
      approved: input.approved,
      alwaysAllow: Boolean(input.alwaysAllow),
      rejectReason: input.rejectReason,
    });
    return {
      ok: true,
      approved: input.approved,
      alwaysAllow: Boolean(input.alwaysAllow),
      ...(input.rejectReason ? { rejectReason: input.rejectReason } : {}),
      ...(evidence ?? {}),
    };
  }

  async clearSession(input: {
    reason?: string;
  } = {}): Promise<WorkflowAutomationClearSessionResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const agent = this.deps.getAgent();
    if (!agent) {
      return { ok: false, agentReady: false };
    }
    if (agent.isRunning) throw new Error("WORKFLOW_AUTOMATION_AGENT_RUNNING");
    agent.clearSession();
    const event: AgentEvent = { type: "session-cleared" };
    this.deps.emitAgentEvent?.(event);
    return {
      ok: true,
      agentReady: true,
      reason: input.reason?.trim() || "workflow-automation",
      sessionId: agent.session.id,
      sessionPath: this.currentSessionPath(),
      rawSessionAvailable: existsSync(this.currentSessionPath()),
      rawLineCount: countNonEmptyLines(this.currentSessionPath()),
      messageCount: agent.messages.length,
    };
  }

  async strategyLibraryAction(input: {
    action: string;
    strategyId?: string;
    timeoutMs?: number;
    minToolCalls?: number;
    maxToolCalls?: number;
    maxDataToolCalls?: number;
    maxToolActionCounts?: Record<string, number>;
    expectTools?: string[];
    disallowTools?: string[];
    allowPendingUserQuestion?: boolean;
    autoAnswerUserQuestions?: string[];
  }): Promise<WorkflowAutomationStrategyLibraryActionResult> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const action = normalizeStrategyLibraryAction(input.action);
    const library = readStrategyLibrary(this.deps.getBasePath());
    if (!library.ok) {
      throw new Error(`WORKFLOW_STRATEGY_LIBRARY_UNREADABLE: ${library.error}`);
    }
    const strategy = findStrategyLibraryItem(library, input.strategyId);
    if (!strategy) {
      const suffix = input.strategyId ? `: ${input.strategyId}` : "";
      throw new Error(`WORKFLOW_STRATEGY_LIBRARY_ITEM_NOT_FOUND${suffix}`);
    }
    const prompt = buildStrategyLibraryActionPrompt(action, strategy);
    const run = await this.sendPrompt(prompt, {
      timeoutMs: input.timeoutMs,
      timeoutReason: `strategy-library-action:${action}`,
      minToolCalls: input.minToolCalls,
      maxToolCalls: input.maxToolCalls,
      maxDataToolCalls: input.maxDataToolCalls,
      expectTools: input.expectTools,
      disallowTools: input.disallowTools,
      allowPendingUserQuestion: input.allowPendingUserQuestion,
      autoAnswerUserQuestions: input.autoAnswerUserQuestions,
    });
    const toolCalls = run.messages.flatMap(
      (message) =>
        message.toolUses?.map((tool) => ({
          toolName: tool.name,
          input: tool.input,
        })) ?? [],
    );
    const toolErrors = run.messages
      .filter((message) => message.toolResult?.isError)
      .map((message) => ({
        toolUseId: message.toolResult?.toolUseId ?? "",
        content: message.toolResult?.content ?? "",
      }));
    return {
      ...run,
      action,
      strategy,
      toolCalls,
      toolErrors,
      finalAssistantText:
        [...run.messages]
          .reverse()
          .find((message) => message.role === "assistant")?.content ?? "",
    };
  }

  async triggerMonitor(input: {
    monitorId?: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const monitorId = String(input.monitorId ?? "").trim();
    if (!monitorId) throw new Error("WORKFLOW_MONITOR_ID_REQUIRED");
    if (!this.deps.triggerMonitor) {
      throw new Error("WORKFLOW_MONITOR_TRIGGER_UNAVAILABLE");
    }
    return await this.deps.triggerMonitor(monitorId, {
      timeoutMs: input.timeoutMs,
    });
  }

  reports(limit = 20): Record<string, unknown> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const dir = this.reportDir();
    if (!existsSync(dir)) {
      return { ok: true, reportDir: dir, count: 0, reports: [] };
    }
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    const reports = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const path = join(dir, name);
        const stat = statSync(path);
        return { name, path, modifiedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, boundedLimit)
      .map((file) =>
        summarizeReportFile(file.name, file.path, file.modifiedAt),
      );
    return { ok: true, reportDir: dir, count: reports.length, reports };
  }

  artifacts(limit = 20): Record<string, unknown> {
    const reports = this.reports(limit) as {
      ok: boolean;
      reportDir?: string;
      count?: number;
      reports?: Array<Record<string, unknown>>;
    };
    const registry = new ArtifactRegistry(this.deps.getBasePath())
      .list()
      .slice(0, Math.max(1, Math.min(100, Math.floor(limit) || 20)))
      .map((record) => ({
        ...record,
        artifactType: record.kind,
        sourceType: "artifact-registry",
      }));
    const workflow = (reports.reports ?? []).map((report) => ({
      ...report,
      id: String(report.runId ?? report.name ?? "").replace(/\.json$/, ""),
      artifactType: String(report.kind ?? "workflow-report"),
      sourceType: "workflow-report",
    }));
    const artifacts = [...registry, ...workflow].slice(0, Math.max(1, Math.min(100, Math.floor(limit) || 20)));
    return {
      ok: reports.ok,
      kind: "artifacts.list",
      source: "artifact-registry+workflow-reports",
      artifactDir: reports.reportDir,
      count: artifacts.length,
      artifacts,
    };
  }

  artifact(id: string): Record<string, unknown> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    const registryRecord = new ArtifactRegistry(this.deps.getBasePath())
      .list()
      .find((record) => record.id === id || record.stableRef === id);
    if (registryRecord) {
      const root = resolve(this.deps.getBasePath());
      const path = resolve(root, registryRecord.path);
      const relation = relative(root, path);
      if (relation.startsWith("..") || resolve(path) === root || !existsSync(path)) {
        throw new Error(`WORKFLOW_AUTOMATION_ARTIFACT_NOT_FOUND: ${id}`);
      }
      const raw = readFileSync(path, "utf-8");
      let content: unknown = raw;
      try { content = JSON.parse(raw); } catch { /* Text artifacts remain text. */ }
      return { ok: true, kind: "artifact", id: registryRecord.id, record: registryRecord, content };
    }
    const safeId = id.trim().replace(/[^A-Za-z0-9_.-]+/g, "");
    if (!safeId) throw new Error("WORKFLOW_AUTOMATION_ARTIFACT_ID_REQUIRED");
    const fileName = safeId.endsWith(".json") ? safeId : `${safeId}.json`;
    const path = join(this.reportDir(), fileName);
    if (!existsSync(path)) {
      throw new Error(`WORKFLOW_AUTOMATION_ARTIFACT_NOT_FOUND: ${safeId}`);
    }
    const content = JSON.parse(readFileSync(path, "utf-8"));
    return {
      ok: true,
      kind: "artifact",
      id: fileName.replace(/\.json$/, ""),
      path,
      content,
    };
  }

  createArtifactRevision(input: Record<string, unknown>): Record<string, unknown> {
    if (!this.enabled()) throw new Error("WORKFLOW_AUTOMATION_DISABLED");
    if (input.contract !== externalReportRevisionContract) {
      throw new Error(`contract must be ${externalReportRevisionContract}`);
    }
    if (!("content" in input) || input.content == null) throw new Error("content is required");
    if (JSON.stringify(input.content).length > 1_000_000) {
      throw new Error("content exceeds the 1000000 character limit");
    }
    const record = new ArtifactRegistry(this.deps.getBasePath()).registerReportRevision({
      logicalReportId: String(input.logicalReportId ?? ""),
      title: String(input.title ?? "").trim() || "FinAgent report revision",
      source: String(input.source ?? "code-agent-intervention"),
      content: input.content,
      changeSummary: String(input.changeSummary ?? ""),
      evidenceEntryIds: Array.isArray(input.evidenceEntryIds)
        ? input.evidenceEntryIds.map((value) => String(value))
        : [],
      sourceCoordinates: input.sourceCoordinates && typeof input.sourceCoordinates === "object" && !Array.isArray(input.sourceCoordinates)
        ? input.sourceCoordinates as Record<string, unknown>
        : {},
      parentArtifactId: input.parentArtifactId == null ? null : String(input.parentArtifactId),
    });
    return {
      ok: true,
      kind: "artifact.revision",
      contract: externalReportRevisionContract,
      artifact: record,
    };
  }

  private currentSessionPath(): string {
    return join(this.deps.getBasePath(), "sessions", "current.jsonl");
  }

  private reportDir(): string {
    return join(this.deps.getBasePath(), "data", "workflow-automation");
  }

  private async safePanelState(): Promise<unknown> {
    try {
      return await this.deps.getPanelState?.();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private runtimeUiEvidence(): Record<string, unknown> {
    const basePath = this.deps.getBasePath();
    const library = readStrategyLibrary(basePath);
    const paths = strategyArtifactPaths(basePath);
    return {
      paths: ["strategyLibraryPath", "strategyItemDir", "strategyLibraryCount"],
      strategyArtifactContract: "strategy-library-v1",
      strategyLibraryPath: paths.libraryPath,
      strategyItemDir: paths.itemDir,
      legacyStrategyLibraryPath: paths.legacyLibraryPath,
      strategyLibraryCount: Array.isArray(library.strategies)
        ? library.strategies.length
        : 0,
    };
  }

  private async safeUiArtifacts(runId: string, panelState?: unknown): Promise<Array<Record<string, unknown>>> {
    const artifacts = panelStateArtifacts(panelState);
    try {
      const artifact = await this.deps.captureUiArtifact?.(runId);
      return artifact ? [...artifacts, artifact] : artifacts;
    } catch (err) {
      return [
        ...artifacts,
        {
          kind: "ui-capture-error",
          error: err instanceof Error ? err.message : String(err),
        },
      ];
    }
  }

  private writeReport(result: WorkflowAutomationRunResult): string {
    const dir = this.reportDir();
    mkdirSync(dir, { recursive: true });
    const toolCalls = reportToolCalls(result);
    const toolResults = reportToolResults(result);
    const report = {
      runId: result.runId,
      createdAt: new Date().toISOString(),
      sessionId: result.sessionId,
      sessionPath: result.sessionPath,
      rawSessionAvailable: result.rawSessionAvailable,
      rawLineCount: result.rawLineCount,
      prompt: result.prompt,
      ok: result.ok,
      queued: result.queued,
      eventTypes: result.events.map((event) => event.type),
      toolCalls,
      toolResults,
      toolInteractions: reportToolInteractions(toolCalls, toolResults),
      toolErrors: result.messages
        .filter((message) => message.toolResult?.isError)
        .map((message) => ({
          toolUseId: message.toolResult?.toolUseId,
          content: message.toolResult?.content,
        })),
      agentReview: buildAgentReview(result),
      panelState: result.panelState,
      uiEvidence: result.uiEvidence,
      uiArtifacts: result.uiArtifacts ?? [],
      finalAssistant: assistantReviewText(result) || null,
      partialAssistantText: result.partialAssistantText,
      error: result.error,
    };
    const path = join(dir, `${result.runId}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
    return path;
  }

  private writeScenarioReport(
    result: WorkflowAutomationScenarioResult,
  ): string {
    const dir = this.reportDir();
    mkdirSync(dir, { recursive: true });
    const toolCalls = reportToolCalls(result.run);
    const toolResults = reportToolResults(result.run);
    const path = join(
      dir,
      `${result.run.runId}-${safeFilePart(result.scenarioId)}-scenario.json`,
    );
    writeFileSync(
      path,
      JSON.stringify(
        {
          scenarioId: result.scenarioId,
          ok: result.ok,
          runId: result.run.runId,
          runReportPath: result.run.reportPath,
          sessionId: result.run.sessionId,
          sessionPath: result.run.sessionPath,
          rawSessionAvailable: result.run.rawSessionAvailable,
          rawLineCount: result.run.rawLineCount,
          prompt: result.run.prompt,
          assertions: result.assertions,
          eventTypes: result.run.events.map((event) => event.type),
          toolCalls,
          toolResults,
          toolInteractions: reportToolInteractions(toolCalls, toolResults),
          toolErrors: result.run.messages
            .filter((message) => message.toolResult?.isError)
            .map((message) => ({
              toolUseId: message.toolResult?.toolUseId,
              content: message.toolResult?.content,
            })),
          agentReview: buildAgentReview(result.run),
          finalAssistant:
            [...result.run.messages]
              .reverse()
              .find((message) => message.role === "assistant")?.content ?? null,
          panelState: result.run.panelState,
          uiEvidence: result.run.uiEvidence,
          uiArtifacts: result.run.uiArtifacts ?? [],
        },
        null,
        2,
      ),
      "utf-8",
    );
    return path;
  }

  private writeMultiTurnScenarioReport(
    result: WorkflowAutomationMultiTurnScenarioResult,
  ): string {
    const dir = this.reportDir();
    mkdirSync(dir, { recursive: true });
    const path = join(
      dir,
      `${result.turns[result.turns.length - 1].run.runId}-${safeFilePart(result.scenarioId)}-multiturn-scenario.json`,
    );
    writeFileSync(
      path,
      JSON.stringify(
        {
          scenarioId: result.scenarioId,
          ok: result.ok,
          kind: "multiturn-scenario",
          turnCount: result.turns.length,
          runIds: result.turns.map((turn) => turn.run.runId),
          sessionId: result.turns[result.turns.length - 1]?.run.sessionId,
          sessionPath: result.turns[result.turns.length - 1]?.run.sessionPath,
          rawSessionAvailable:
            result.turns[result.turns.length - 1]?.run.rawSessionAvailable,
          rawLineCount: result.turns[result.turns.length - 1]?.run.rawLineCount,
          assertions: result.assertions,
          turns: result.turns.map((turn) => {
            const turnToolCalls = reportToolCalls(turn.run);
            const turnToolResults = reportToolResults(turn.run);
            return {
              turnId: turn.turnId,
              turnIndex: turn.turnIndex,
              scenarioId: turn.scenarioId,
              ok: turn.ok,
              prompt: turn.run.prompt,
              runId: turn.run.runId,
              runReportPath: turn.run.reportPath,
              scenarioReportPath: turn.scenarioReportPath,
              assertions: turn.assertions,
              toolCalls: turnToolCalls,
              toolResults: turnToolResults,
              toolInteractions: reportToolInteractions(turnToolCalls, turnToolResults),
              toolErrors: turn.run.messages
                .filter((message) => message.toolResult?.isError)
                .map((message) => ({
                  toolUseId: message.toolResult?.toolUseId,
                  content: message.toolResult?.content,
                })),
              agentReview: buildAgentReview(turn.run),
              finalAssistant:
                [...turn.run.messages]
                  .reverse()
                  .find((message) => message.role === "assistant")?.content ??
                null,
              panelState: turn.run.panelState,
              uiEvidence: turn.run.uiEvidence,
              uiArtifacts: turn.run.uiArtifacts ?? [],
            };
          }),
        },
        null,
        2,
      ),
      "utf-8",
    );
    return path;
  }
}

export interface WorkflowAutomationServer {
  port: number;
  close: () => Promise<void>;
}

export async function startWorkflowAutomationServer(
  control: WorkflowAutomationControl,
  requestedPort = Number(
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT || 0,
  ),
): Promise<WorkflowAutomationServer | null> {
  if (!control.enabled()) return null;

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(control, req, res);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Workflow automation is intentionally an app-owned loopback HTTP surface.
    // Do not replace this with a raw socket/WebSocket command protocol.
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : requestedPort;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handleRequest(
  control: WorkflowAutomationControl,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, control.health());
    return;
  }
  if (req.method === "GET" && req.url === "/runs/capabilities") {
    writeJson(
      res,
      200,
      runServiceCapabilityDescriptor({
        runtime: "workstation",
        supportsCli: true,
        supportsStdio: true,
        supportsFrontendBridge: true,
        supportsHeadlessUi: control.supportsUiRuntime("headless"),
        supportsMirrorUi: control.supportsUiRuntime("mirror"),
        supportsPermissionResponse: true,
        notes: [
          "CLI and stdio currently connect to an existing loopback HTTP host.",
          "Permission replies are exposed through structured run-service routes and stdio methods.",
          "Headless runs use service-owned hidden Electron webContents for DOM execution and capture without visible panels.",
          "Mirror executes once in the service-owned hidden backend and projects resulting DOM and semantic UI state into visible panels.",
        ],
      }),
    );
    return;
  }
  if (req.method === "GET" && req.url === "/adapter/capabilities") {
    writeJson(
      res,
      200,
      runServiceAdapterDescriptor({
        runtime: "workstation",
        supportsCli: true,
        supportsStdio: true,
        supportsFrontendBridge: true,
        supportsPermissionResponse: true,
      }),
    );
    return;
  }
  if (req.method === "GET" && req.url === "/workflow/session") {
    writeJson(res, 200, await control.sessionEvidence());
    return;
  }
  if (req.method === "GET" && req.url === "/sessions/current") {
    writeJson(
      res,
      200,
      {
        ok: true,
        kind: "session.current",
        ...(await control.sessionEvidence()),
      },
    );
    return;
  }
  if (req.method === "GET" && req.url === "/sessions") {
    writeJson(res, 200, await control.listSessions());
    return;
  }
  if (req.method === "POST" && req.url === "/sessions") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await control.createSession({
        reason: body.reason == null ? undefined : String(body.reason),
      }),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/test/run-service/failure") {
    const body = await readJsonBody(req);
    writeJson(res, 200, control.armRunServiceFailure(String(body.mode ?? "")));
    return;
  }
  if (req.method === "POST" && req.url === "/artifacts/revisions") {
    try {
      writeJson(res, 201, control.createArtifactRevision(await readJsonBody(req)));
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (req.method === "GET" && req.url === "/workflow/panels") {
    writeJson(res, 200, await control.panelState());
    return;
  }
  if (req.method === "GET" && req.url === "/workflow/pending_user_question") {
    writeJson(res, 200, control.pendingUserQuestion());
    return;
  }
  if (req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const runEventsMatch = url.pathname.match(/^\/runs\/([^/]+)\/events$/);
    if (runEventsMatch) {
      const after = Number(url.searchParams.get("after") ?? 0);
      writeJson(
        res,
        200,
        control.runServiceEvents({
          runId: decodeURIComponent(runEventsMatch[1]),
          after: Number.isFinite(after) ? after : 0,
        }),
      );
      return;
    }
    const runStreamMatch = url.pathname.match(/^\/runs\/([^/]+)\/stream$/);
    if (runStreamMatch) {
      const runId = decodeURIComponent(runStreamMatch[1]);
      let after = Number(url.searchParams.get("after") ?? 0);
      if (!Number.isFinite(after)) after = 0;
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      });
      while (!res.destroyed) {
        const waited = await control.waitForRunServiceEvents({
          runId,
          after,
          timeoutMs: 30_000,
        });
        const events = Array.isArray(waited.events) ? waited.events : [];
        for (const event of events) {
          const sequence = Number(event.sequence);
          if (Number.isFinite(sequence)) after = sequence;
          res.write(`${JSON.stringify({ type: "event", event })}\n`);
        }
        if (waited.terminal === true) {
          res.write(`${JSON.stringify({
            type: "terminal",
            runId,
            state: control.runServiceState(runId),
          })}\n`);
          res.end();
          return;
        }
      }
      return;
    }
    const runResultMatch = url.pathname.match(/^\/runs\/([^/]+)\/result$/);
    if (runResultMatch) {
      writeJson(
        res,
        200,
        control.runServiceResult(decodeURIComponent(runResultMatch[1])),
      );
      return;
    }
    const runPendingMatch = url.pathname.match(/^\/runs\/([^/]+)\/pending$/);
    if (runPendingMatch) {
      writeJson(
        res,
        200,
        control.runServicePending(decodeURIComponent(runPendingMatch[1])),
      );
      return;
    }
    const runStateMatch = url.pathname.match(/^\/runs\/([^/]+)\/state$/);
    if (runStateMatch) {
      writeJson(res, 200, control.runServiceState(decodeURIComponent(runStateMatch[1])));
      return;
    }
    const runMessagesMatch = url.pathname.match(/^\/runs\/([^/]+)\/messages$/);
    if (runMessagesMatch) {
      const after = Number(url.searchParams.get("after") ?? 0);
      writeJson(
        res,
        200,
        control.runServiceMessages(
          decodeURIComponent(runMessagesMatch[1]),
          Number.isFinite(after) ? after : 0,
        ),
      );
      return;
    }
    const runWaitMatch = url.pathname.match(/^\/runs\/([^/]+)\/wait$/);
    if (runWaitMatch) {
      const after = Number(url.searchParams.get("after") ?? 0);
      const timeoutMs = Number(url.searchParams.get("timeoutMs") ?? 5000);
      writeJson(
        res,
        200,
        await control.waitForRunServiceEvents({
          runId: decodeURIComponent(runWaitMatch[1]),
          after: Number.isFinite(after) ? after : 0,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
        }),
      );
      return;
    }
    if (url.pathname === "/workflow/idle") {
      const timeoutMs = Number(url.searchParams.get("timeoutMs") ?? 5000);
      writeJson(
        res,
        200,
        await control.waitForIdle(Number.isFinite(timeoutMs) ? timeoutMs : 5000),
      );
      return;
    }
    if (url.pathname === "/workflow/reports") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      writeJson(res, 200, control.reports(Number.isFinite(limit) ? limit : 20));
      return;
    }
    if (url.pathname === "/artifacts") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      writeJson(res, 200, control.artifacts(Number.isFinite(limit) ? limit : 20));
      return;
    }
    if (url.pathname === "/execution/paper/state") {
      writeJson(res, 200, control.paperExecutionState(url.searchParams.get("market") ?? "cn"));
      return;
    }
    const receiptMatch = url.pathname.match(/^\/execution\/receipts\/([^/]+)$/);
    if (receiptMatch) {
      writeJson(
        res,
        200,
        control.paperExecutionReceipt(
          decodeURIComponent(receiptMatch[1]),
          url.searchParams.get("market") ?? "cn",
        ),
      );
      return;
    }
    if (url.pathname === "/runs") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      writeJson(res, 200, control.runServiceRuns(Number.isFinite(limit) ? limit : 20));
      return;
    }
    const artifactMatch = url.pathname.match(/^\/artifacts\/([^/]+)$/);
    if (artifactMatch) {
      writeJson(res, 200, control.artifact(decodeURIComponent(artifactMatch[1])));
      return;
    }
  }
  if (req.method === "POST" && req.url === "/workflow/send") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await runCancellableWorkflow(
        control,
        req,
        res,
        () =>
          control.sendPrompt(String(body.prompt ?? ""), {
            timeoutMs: asOptionalNumber(body.timeoutMs),
            timeoutReason: "workflow-send",
          }),
        "workflow-send-client-disconnected",
      ),
    );
    return;
  }
  if (req.method === "POST" && (req.url === "/runs" || req.url === "/runs/start")) {
    const body = await readJsonBody(req);
    let prompt = String(body.prompt ?? "").trim();
    const contract = String(body.contract ?? "").trim();
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : {};
    let normalizedTaskBrief: ReturnType<typeof validateExternalTaskBrief> | undefined;
    let normalizedIntervention: ReturnType<typeof validateExternalIntervention> | undefined;
    if (contract === "finagent.finance-operation.v1") {
      payload.commandPlan = {
        category: String(body.category ?? "").trim(),
        operation: String(body.operation ?? "").trim(),
        payload: body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
          ? body.arguments as Record<string, unknown>
          : payload,
      };
      payload.externalOperationContract = contract;
    }
    if (contract === externalTaskBriefContract) {
      try {
        normalizedTaskBrief = validateExternalTaskBrief(body);
        payload.taskBrief = normalizedTaskBrief;
        payload.commandPlan = {
          category: normalizedTaskBrief.category,
          operation: normalizedTaskBrief.operation,
          payload: normalizedTaskBrief.arguments,
        };
        payload.externalOperationContract = contract;
        prompt = promptForExternalTaskBrief({ runtime: "workstation", brief: normalizedTaskBrief });
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    if (contract === externalInterventionContract) {
      try {
        normalizedIntervention = validateExternalIntervention(body);
        payload.intervention = normalizedIntervention;
        payload.externalOperationContract = contract;
        prompt = promptForExternalIntervention({ runtime: "workstation", intervention: normalizedIntervention });
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    if (!prompt && contract === "finagent.finance-operation.v1") {
      try {
        prompt = promptForExternalFinanceOperation({
          runtime: "workstation",
          category: String(body.category ?? "").trim(),
          operation: String(body.operation ?? "").trim(),
          arguments: body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
            ? body.arguments as Record<string, unknown>
            : payload,
        });
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    if (!prompt) {
      writeJson(res, 400, { error: "prompt is required" });
      return;
    }
    const runRequest: RunServiceRunRequest = {
      prompt,
      sessionMode:
        body.sessionMode == null
          ? undefined
          : String(body.sessionMode) as RunServiceRunRequest["sessionMode"],
      uiRuntime:
        body.uiRuntime == null && normalizedTaskBrief == null
          ? undefined
          : String(body.uiRuntime ?? normalizedTaskBrief?.uiRuntime) as RunServiceRunRequest["uiRuntime"],
      sessionId: body.sessionId == null ? undefined : String(body.sessionId),
      timeoutMs: asOptionalNumber(body.timeoutMs),
      payload,
    };
    if (normalizedTaskBrief && body.uiRuntime != null && String(body.uiRuntime) !== normalizedTaskBrief.uiRuntime) {
      writeJson(res, 400, { error: "uiRuntime must match the task brief" });
      return;
    }
    if (normalizedIntervention && (
      runRequest.sessionMode !== "resume" ||
      runRequest.sessionId !== normalizedIntervention.target.sessionId
    )) {
      writeJson(res, 400, {
        error: "intervention requires sessionMode resume and the exact target sessionId",
      });
      return;
    }
    if (req.url === "/runs/start") {
      writeJson(res, 202, control.startRunServicePrompt(runRequest));
      return;
    }
    writeJson(
      res,
      200,
      await runCancellableWorkflow(
        control,
        req,
        res,
        () => control.runServicePrompt(runRequest),
        "run-service-client-disconnected",
      ),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/workflow/cancel") {
    const body = await readJsonBody(req);
    writeJson(res, 200, await control.cancel(String(body.reason ?? "")));
    return;
  }
  {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const runInterruptMatch = url.pathname.match(/^\/runs\/([^/]+)\/interrupt$/);
    if (req.method === "POST" && runInterruptMatch) {
      const body = await readJsonBody(req);
      writeJson(
        res,
        200,
        {
          runId: decodeURIComponent(runInterruptMatch[1]),
          kind: "run.interrupt",
          ...(await control.cancel(String(body.reason ?? "run-service-interrupt"))),
        },
      );
      return;
    }
  }
  if (req.method === "POST" && req.url === "/workflow/answer_user_question") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await control.answerUserQuestion(String(body.answer ?? ""), {
        timeoutMs: asOptionalNumber(body.timeoutMs),
      }),
    );
    return;
  }
  {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const runResponseMatch = url.pathname.match(/^\/runs\/([^/]+)\/responses$/);
    if (req.method === "POST" && runResponseMatch) {
      const body = await readJsonBody(req);
      const runId = decodeURIComponent(runResponseMatch[1]);
      const requestId = control.pendingRequestId(
        runId,
        "interaction",
        body.requestId == null ? undefined : String(body.requestId),
      );
      writeJson(
        res,
        200,
        {
          runId,
          ...(requestId ? { requestId } : {}),
          kind: "interaction.response",
          ...(await control.answerUserQuestion(String(body.answer ?? ""), {
            timeoutMs: asOptionalNumber(body.timeoutMs),
          })),
        },
      );
      return;
    }
  }
  {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const runPermissionMatch = url.pathname.match(/^\/runs\/([^/]+)\/permissions$/);
    if (req.method === "POST" && runPermissionMatch) {
      const body = await readJsonBody(req);
      const runId = decodeURIComponent(runPermissionMatch[1]);
      const requestId = control.pendingRequestId(
        runId,
        "permission",
        body.requestId == null ? undefined : String(body.requestId),
      );
      writeJson(
        res,
        200,
        {
          runId,
          ...(requestId ? { requestId } : {}),
          kind: "permission.response",
          ...(await control.resolvePermission({
            approved: body.approved === true,
            alwaysAllow: body.alwaysAllow === true,
            rejectReason:
              body.rejectReason == null ? undefined : String(body.rejectReason),
          })),
        },
      );
      return;
    }
  }
  if (req.method === "POST" && req.url === "/workflow/clear_session") {
    writeJson(res, 200, await control.clearSession());
    return;
  }
  if (req.method === "POST" && req.url === "/workflow/strategy_library_action") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await runCancellableWorkflow(
        control,
        req,
        res,
        () =>
          control.strategyLibraryAction({
            action: String(body.action ?? ""),
            strategyId:
              body.strategyId == null ? undefined : String(body.strategyId),
            timeoutMs: asOptionalNumber(body.timeoutMs),
            minToolCalls: asOptionalNumber(body.minToolCalls),
            maxToolCalls: asOptionalNumber(body.maxToolCalls),
            maxDataToolCalls: asOptionalNumber(body.maxDataToolCalls),
            disallowTools: asStringArray(body.disallowTools),
            allowPendingUserQuestion: body.allowPendingUserQuestion === true,
            autoAnswerUserQuestions: asStringArray(body.autoAnswerUserQuestions),
          }),
        "workflow-strategy-library-action-client-disconnected",
      ),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/workflow/trigger_monitor") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await control.triggerMonitor({
        monitorId:
          body.monitorId == null && body.id == null
            ? undefined
            : String(body.monitorId ?? body.id),
        timeoutMs: asOptionalNumber(body.timeoutMs),
      }),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/workflow/scenario") {
    const body = await readJsonBody(req);
    writeJson(
      res,
      200,
      await runCancellableWorkflow(
        control,
        req,
        res,
        () => control.runScenario({
          id: String(body.id ?? ""),
          prompt: String(body.prompt ?? ""),
          workflowState: body.workflowState,
          expectTools: asStringArray(body.expectTools),
          expectToolActions: asStringArray(body.expectToolActions),
          expectToolErrors: asStringArray(body.expectToolErrors),
          expectToolResultContains: asStringArray(body.expectToolResultContains),
          expectFinalContains: asStringArray(body.expectFinalContains),
          expectSessionContains: asStringArray(body.expectSessionContains),
          expectPanelStateKeys: asStringArray(body.expectPanelStateKeys),
          expectUiEvidencePaths: asStringArray(body.expectUiEvidencePaths),
          expectUiArtifactKinds: asStringArray(body.expectUiArtifactKinds),
          disallowTools: asStringArray(body.disallowTools),
          maxToolActionCounts: asNumberMap(body.maxToolActionCounts),
          minToolCalls: asOptionalNumber(body.minToolCalls),
          maxToolCalls: asOptionalNumber(body.maxToolCalls),
          maxDataToolCalls: asOptionalNumber(body.maxDataToolCalls),
          timeoutMs: asOptionalNumber(body.timeoutMs),
          disallowRawHtml: body.disallowRawHtml === true,
          expectNoToolErrors: body.expectNoToolErrors === true,
          allowPendingUserQuestion: body.allowPendingUserQuestion === true,
          autoAnswerUserQuestions: asStringArray(body.autoAnswerUserQuestions),
        }),
        "workflow-scenario-client-disconnected",
      ),
    );
    return;
  }
  if (req.method === "POST" && req.url === "/workflow/scenario_sequence") {
    const body = await readJsonBody(req);
    const turns = Array.isArray(body.turns) ? body.turns : [];
    writeJson(
      res,
      200,
      await runCancellableWorkflow(
        control,
        req,
        res,
        () => control.runMultiTurnScenario({
          id: String(body.id ?? ""),
          turns: turns.map((turn: any) => ({
            id: turn.id != null ? String(turn.id) : undefined,
            prompt: String(turn.prompt ?? ""),
            workflowState: turn.workflowState,
            expectTools: asStringArray(turn.expectTools),
            expectToolActions: asStringArray(turn.expectToolActions),
            expectToolErrors: asStringArray(turn.expectToolErrors),
            expectToolResultContains: asStringArray(turn.expectToolResultContains),
            expectFinalContains: asStringArray(turn.expectFinalContains),
            expectSessionContains: asStringArray(turn.expectSessionContains),
            expectPanelStateKeys: asStringArray(turn.expectPanelStateKeys),
            expectUiEvidencePaths: asStringArray(turn.expectUiEvidencePaths),
            expectUiArtifactKinds: asStringArray(turn.expectUiArtifactKinds),
            disallowTools: asStringArray(turn.disallowTools),
            maxToolActionCounts: asNumberMap(turn.maxToolActionCounts),
            minToolCalls: asOptionalNumber(turn.minToolCalls),
            maxToolCalls: asOptionalNumber(turn.maxToolCalls),
            maxDataToolCalls: asOptionalNumber(turn.maxDataToolCalls),
            timeoutMs: asOptionalNumber(turn.timeoutMs),
            disallowRawHtml: turn.disallowRawHtml === true,
            expectNoToolErrors: turn.expectNoToolErrors === true,
            allowPendingUserQuestion: turn.allowPendingUserQuestion === true,
            autoAnswerUserQuestions: asStringArray(
              turn.autoAnswerUserQuestions,
            ),
          })),
          expectSessionContains: asStringArray(body.expectSessionContains),
          expectToolActions: asStringArray(body.expectToolActions),
          expectPanelStateKeys: asStringArray(body.expectPanelStateKeys),
          expectUiEvidencePaths: asStringArray(body.expectUiEvidencePaths),
          expectUiArtifactKinds: asStringArray(body.expectUiArtifactKinds),
          disallowTools: asStringArray(body.disallowTools),
          maxToolActionCounts: asNumberMap(body.maxToolActionCounts),
        }),
        "workflow-scenario-sequence-client-disconnected",
      ),
    );
    return;
  }
  writeJson(res, 404, {
    ok: false,
    error: "WORKFLOW_AUTOMATION_ROUTE_NOT_FOUND",
  });
}

async function runCancellableWorkflow<T>(
  control: WorkflowAutomationControl,
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<T>,
  reason: string,
): Promise<T> {
  let completed = false;
  let cancelRequested = false;
  const cancel = (): void => {
    if (completed || cancelRequested) return;
    cancelRequested = true;
    void control.cancel(reason).catch(() => undefined);
  };
  req.once("aborted", cancel);
  res.once("close", cancel);
  try {
    return await run();
  } finally {
    completed = true;
    req.off("aborted", cancel);
    res.off("close", cancel);
  }
}

function panelStateArtifacts(panelState: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(panelState)) return [];
  return panelState
    .filter((panel): panel is Record<string, unknown> => Boolean(panel) && typeof panel === "object" && !Array.isArray(panel))
    .filter((panel) => panel.type === "dashboard" && typeof panel.url === "string")
    .map((panel) => {
      const url = String(panel.url);
      const isDashboardFile = url.includes("/dashboards/");
      const isPageFile = url.includes("/memory/pages/") || url.includes("/pages/");
      return {
        kind: "dashboard",
        sourceKind: isDashboardFile ? "dashboard-file" : isPageFile ? "page-file" : "dashboard-panel",
        panelId: typeof panel.id === "string" ? panel.id : undefined,
        title: typeof panel.title === "string" ? panel.title : undefined,
        path: url,
        active: panel.isActive === true,
      };
    });
}

function toolEvidenceArtifacts(messages: WorkflowAutomationMessage[]): Array<Record<string, unknown>> {
  const artifacts: Array<Record<string, unknown>> = [];
  const toolById = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const message of messages) {
    for (const tool of message.toolUses ?? []) toolById.set(tool.id, tool);
    const result = message.toolResult;
    if (!result || result.isError) continue;
    const tool = toolById.get(result.toolUseId);
    if (!tool) continue;
    if (tool.name === "Dashboard") {
      artifacts.push({
        kind: "dashboard",
        sourceKind: "dashboard-tool",
        panelId: typeof tool.input.id === "string" ? `dash-${tool.input.id}` : undefined,
        title: typeof tool.input.title === "string" ? tool.input.title : undefined,
        verified: false,
      });
      continue;
    }
    if (tool.name === "ArtifactRegistry" && String(tool.input.kind ?? "") === "dashboard") {
      artifacts.push({
        kind: "dashboard",
        sourceKind: "artifact-registry",
        artifactId: typeof tool.input.id === "string" ? tool.input.id : undefined,
        title: typeof tool.input.title === "string" ? tool.input.title : undefined,
        verified: false,
      });
      continue;
    }
    if (tool.name === "WebView" && String(tool.input.action ?? "") === "verify_report") {
      const verification = parseJsonObject(result.content);
      if (verification && verification.rendered === true && verification.error == null) {
        artifacts.push({
          kind: "dashboard",
          sourceKind: "webview-verify-report",
          panelId: typeof verification.resolvedId === "string" ? verification.resolvedId : tool.input.id,
          title: typeof verification.title === "string" ? verification.title : undefined,
          sectionCount: verification.sectionCount,
          verified: true,
        });
      }
    }
  }
  return artifacts;
}

function mergeUiArtifacts(
  base: Array<Record<string, unknown>>,
  extras: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const artifact of [...base, ...extras]) {
    const key = [
      artifact.kind,
      artifact.sourceKind,
      artifact.panelId,
      artifact.artifactId,
      artifact.path,
    ].map((value) => String(value ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(artifact);
  }
  return merged;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function previewText(value: string, maxLength = 1000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function evaluateScenario(
  scenario: WorkflowAutomationScenario,
  run: WorkflowAutomationRunResult,
): WorkflowAutomationScenarioResult["assertions"] {
  const toolNames = run.messages.flatMap(
    (message) => message.toolUses?.map((tool) => tool.name) ?? [],
  );
  const skippedToolUseIds = new Set(
    run.messages
      .map((message) => message.toolResult)
      .filter((result) => result?.content.trim().startsWith("Skipped:"))
      .map((result) => result?.toolUseId)
      .filter((toolUseId): toolUseId is string => typeof toolUseId === "string"),
  );
  const executedToolNames = run.messages.flatMap(
    (message) =>
      message.toolUses
        ?.filter((tool) => !skippedToolUseIds.has(tool.id))
        .map((tool) => tool.name) ?? [],
  );
  const dataToolNames = executedToolNames.filter(isDataWorkflowTool);
  const toolErrors = run.messages
    .filter((message) => message.toolResult?.isError)
    .map((message) => message.toolResult?.content ?? "");
  const toolResults = run.messages
    .map((message) => message.toolResult?.content ?? "")
    .filter((content) => content.length > 0);
  const finalAssistant =
    assistantReviewText(run);
  const sessionText = JSON.stringify(run.messages);
  const panelState = run.panelState;
  const uiEvidencePaths = Array.isArray(run.uiEvidence?.paths)
    ? run.uiEvidence.paths.map((path) => String(path))
    : [];
  const uiArtifactKinds = Array.isArray(run.uiArtifacts)
    ? run.uiArtifacts
        .map((artifact) => artifact?.kind)
        .filter((kind): kind is string => typeof kind === "string")
    : [];
  const assertions: WorkflowAutomationScenarioResult["assertions"] = [
    { name: "run.ok", ok: run.ok, expected: true, actual: run.ok },
    {
      name: "session.messages",
      ok: run.messages.length > 0,
      expected: "non-empty",
      actual: run.messages.length,
    },
  ];
  for (const tool of scenario.expectTools ?? []) {
    assertions.push({
      name: `tool.${tool}`,
      ok: toolNames.includes(tool),
      expected: tool,
      actual: toolNames,
    });
  }
  const toolActions = run.messages.flatMap(
    (message) =>
      message.toolUses
        ?.filter((tool) => !skippedToolUseIds.has(tool.id))
        .map((tool) => {
          const input = tool.input && typeof tool.input === "object" && !Array.isArray(tool.input)
            ? tool.input as Record<string, unknown>
            : {};
          const action = input.action == null ? "" : String(input.action);
          return action ? `${tool.name}.${action}` : tool.name;
        }) ?? [],
  );
  for (const expected of scenario.expectToolActions ?? []) {
    const matched = toolActions.some((actual) => toolActionMatches(actual, expected));
    assertions.push({
      name: `toolAction.${expected}`,
      ok: matched,
      expected,
      actual: toolActions,
    });
  }
  for (const [action, maxCount] of Object.entries(scenario.maxToolActionCounts ?? {})) {
    if (!Number.isFinite(maxCount)) continue;
    const count = toolActions.filter((actual) => actual === action || actual.endsWith(`.${action}`)).length;
    assertions.push({
      name: `maxToolAction.${action}.${maxCount}`,
      ok: count <= maxCount,
      expected: `<= ${maxCount}`,
      actual: count,
    });
  }
  for (const tool of scenario.disallowTools ?? []) {
    assertions.push({
      name: `noTool.${tool}`,
      ok: !executedToolNames.includes(tool),
      expected: `no ${tool}`,
      actual: executedToolNames,
    });
  }
  for (const expected of scenario.expectToolErrors ?? []) {
    assertions.push({
      name: `toolError.${expected}`,
      ok: toolErrors.some((error) => error.includes(expected)),
      expected,
      actual: toolErrors,
    });
  }
  if (scenario.expectNoToolErrors) {
    assertions.push({
      name: "toolErrors.none",
      ok: toolErrors.length === 0,
      expected: "no tool errors",
      actual: toolErrors,
    });
  }
  for (const expected of scenario.expectToolResultContains ?? []) {
    assertions.push({
      name: `toolResultContains.${expected}`,
      ok: toolResults.some((content) => content.includes(expected)),
      expected,
      actual: toolResults,
    });
  }
  for (const expected of scenario.expectFinalContains ?? []) {
    assertions.push({
      name: `finalContains.${expected}`,
      ok: finalAssistant.includes(expected),
      expected,
      actual: finalAssistant,
    });
  }
  for (const expected of scenario.expectSessionContains ?? []) {
    assertions.push({
      name: `sessionContains.${expected}`,
      ok: sessionText.includes(expected),
      expected,
      actual: sessionText,
    });
  }
  for (const key of scenario.expectPanelStateKeys ?? []) {
    assertions.push({
      name: `panelState.${key}`,
      ok: hasPath(panelState, key),
      expected: key,
      actual: panelState,
    });
  }
  for (const key of scenario.expectUiEvidencePaths ?? []) {
    assertions.push({
      name: `uiEvidence.${key}`,
      ok: uiEvidencePaths.includes(key),
      expected: key,
      actual: uiEvidencePaths,
    });
  }
  for (const kind of scenario.expectUiArtifactKinds ?? []) {
    assertions.push({
      name: `uiArtifact.${kind}`,
      ok: uiArtifactKinds.includes(kind),
      expected: kind,
      actual: uiArtifactKinds,
    });
  }
  if (scenario.maxToolCalls != null) {
    assertions.push({
      name: `maxToolCalls.${scenario.maxToolCalls}`,
      ok: toolNames.length <= scenario.maxToolCalls,
      expected: `<= ${scenario.maxToolCalls}`,
      actual: toolNames.length,
    });
  }
  if (scenario.minToolCalls != null) {
    assertions.push({
      name: `minToolCalls.${scenario.minToolCalls}`,
      ok: toolNames.length >= scenario.minToolCalls,
      expected: `>= ${scenario.minToolCalls}`,
      actual: toolNames.length,
    });
  }
  if (scenario.maxDataToolCalls != null) {
    assertions.push({
      name: `maxDataToolCalls.${scenario.maxDataToolCalls}`,
      ok: dataToolNames.length <= scenario.maxDataToolCalls,
      expected: `<= ${scenario.maxDataToolCalls}`,
      actual: dataToolNames.length,
    });
  }
  if (scenario.disallowRawHtml) {
    assertions.push({
      name: "finalNoRawHtml",
      ok: !hasRawHtml(finalAssistant),
      expected: "no fenced html or raw dashboard HTML tags in final assistant answer",
      actual: finalAssistant,
    });
  }
  return assertions;
}

function toolActionMatches(actual: string, expected: string): boolean {
  if (actual === expected || actual.endsWith(`.${expected}`)) return true;
  const action = actual.includes('.') ? actual.slice(actual.lastIndexOf('.') + 1) : actual;
  if (expected === 'quote') return action === 'quote' || action === 'query_quote';
  if (expected === 'query_quote') return action === 'query_quote' || action === 'quote';
  return false;
}

export function selectAskUserQuestionAnswer(
  input: Record<string, unknown>,
  preferredAnswers: string[],
): string | null {
  const preferred = preferredAnswers
    .map((answer) => String(answer ?? "").trim())
    .filter(Boolean);
  const options = extractAskUserOptions(input);
  if (preferred.length === 0) return null;

  for (const requested of preferred) {
    if (isStructuredAskUserAnswer(requested)) return requested;
    const optionIndex = Number.parseInt(requested, 10);
    if (
      Number.isFinite(optionIndex) &&
      String(optionIndex) === requested &&
      optionIndex >= 1 &&
      optionIndex <= options.length
    ) {
      return options[optionIndex - 1];
    }
    if (options.includes(requested)) return requested;
  }
  return null;
}

function isStructuredAskUserAnswer(answer: string): boolean {
  if (!answer.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(answer) as Record<string, unknown>;
    return Boolean(parsed && typeof parsed === "object" && (
      typeof parsed.decision === "string" ||
      typeof parsed.action === "string" ||
      parsed.selectedOptionIndex != null ||
      parsed.optionIndex != null
    ));
  } catch {
    return false;
  }
}

function extractAskUserOptions(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.options)) {
    return input.options.map((option) => String(option)).filter(Boolean);
  }
  const questions = input.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    const first = questions[0] as Record<string, unknown>;
    if (Array.isArray(first.options)) {
      return first.options
        .map((option) =>
          typeof option === "string"
            ? option
            : String((option as Record<string, unknown>)?.label ?? ""),
        )
        .filter(Boolean);
    }
  }
  return [];
}

function hasRawHtml(content: string): boolean {
  return (
    /```html\b/i.test(content) ||
    /<\s*(?:article|body|div|html|script|section|span|style|table)\b/i.test(
      content,
    )
  );
}

function isDataWorkflowTool(name: string): boolean {
  return [
    "DataStore",
    "MarketData",
    "DataProcess",
    "Research",
    "WindMcp",
    "Tushare",
    "XueqiuTrade",
    "Portfolio",
    "Watchlist",
  ].includes(name);
}

function serializeMessages(messages: Message[]): WorkflowAutomationMessage[] {
  return messages
    .filter(
      (message) =>
        message.content || message.toolUses?.length || message.toolResult,
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolUses: message.toolUses?.map((tool) => ({
        id: tool.id,
        name: tool.name,
        input: trimObject(tool.input, 400),
      })),
      toolResult: message.toolResult
        ? {
            toolUseId: message.toolResult.toolUseId,
            content: trimString(message.toolResult.content, 4000),
            isError: message.toolResult.isError,
            imagePaths: message.toolResult.imagePaths,
          }
        : undefined,
    }));
}

type WorkflowReportToolCall = {
  id?: string;
  name: string;
  input: Record<string, unknown>;
};

type WorkflowReportToolResult = {
  toolUseId?: string;
  content?: string;
  isError?: boolean;
};

function reportToolCalls(result: WorkflowAutomationRunResult): WorkflowReportToolCall[] {
  return result.messages.flatMap(
    (message) =>
      message.toolUses?.map((tool) => ({
        id: tool.id,
        name: tool.name,
        input: tool.input,
      })) ?? [],
  );
}

function reportToolResults(result: WorkflowAutomationRunResult): WorkflowReportToolResult[] {
  return result.messages
    .filter((message) => message.toolResult)
    .map((message) => ({
      toolUseId: message.toolResult?.toolUseId,
      content: message.toolResult?.content,
      isError: message.toolResult?.isError,
    }));
}

function reportToolInteractions(
  toolCalls: WorkflowReportToolCall[],
  toolResults: WorkflowReportToolResult[],
): Array<WorkflowReportToolCall & { result: WorkflowReportToolResult | null; skipped: boolean }> {
  const resultById = new Map(
    toolResults
      .filter((result) => result.toolUseId)
      .map((result) => [result.toolUseId, result] as const),
  );
  return toolCalls.map((call) => {
    const result = call.id ? resultById.get(call.id) ?? null : null;
    return {
      ...call,
      result,
      skipped: isSkippedToolResult(result),
    };
  });
}

function isSkippedToolResult(result: WorkflowReportToolResult | null | undefined): boolean {
  return typeof result?.content === "string" &&
    result.content.trim().startsWith("Skipped:");
}

function buildAgentReview(
  result: WorkflowAutomationRunResult,
): Record<string, unknown> {
  const finalAssistant =
    assistantReviewText(result);
  const toolCalls = reportToolCalls(result);
  const toolResults = reportToolResults(result);
  const toolInteractions = reportToolInteractions(toolCalls, toolResults);
  const skippedToolCallCount = toolInteractions.filter((interaction) => interaction.skipped).length;
  const toolErrors = result.messages
    .filter((message) => message.toolResult?.isError)
    .map((message) => ({
      toolUseId: message.toolResult?.toolUseId,
      content: message.toolResult?.content,
    }));
  const uiArtifactKinds = Array.isArray(result.uiArtifacts)
    ? result.uiArtifacts
        .map((artifact) => artifact?.kind)
        .filter((kind): kind is string => typeof kind === "string")
    : [];
  return {
    reviewRequired: true,
    prompt: result.prompt,
    finalAssistant,
    finalAssistantPresent: finalAssistant.trim().length > 0,
    toolCallCount: toolCalls.length,
    executedToolCallCount: toolCalls.length - skippedToolCallCount,
    skippedToolCallCount,
    toolNames: [...new Set(toolCalls.map((tool) => tool.name))],
    toolCalls,
    toolInteractions,
    toolErrorCount: toolErrors.length,
    toolErrors,
    panelEvidenceAvailable: result.panelState != null,
    uiEvidence: result.uiEvidence,
    uiArtifactKinds,
    rawSessionAvailable: result.rawSessionAvailable,
    rawLineCount: result.rawLineCount,
    reviewerChecklist: [
      "Does the final answer address the user's actual finance intent?",
      "Are facts, inference, recommendation, assumptions, and unavailable evidence separated?",
      "Do tool calls and environment interactions match the user intent?",
      "Are provider/API failures visible instead of hidden?",
      "When UI output is expected, does the panel/screenshot/dashboard evidence match the answer?",
    ],
  };
}

function summarizeReportFile(
  name: string,
  path: string,
  modifiedAt: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<
      string,
      unknown
    >;
    const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
    const toolErrors = Array.isArray(parsed.toolErrors)
      ? parsed.toolErrors
      : [];
    const assertions = Array.isArray(parsed.assertions)
      ? parsed.assertions
      : [];
    const failedAssertions = assertions
      .filter(
        (assertion): assertion is Record<string, unknown> =>
          typeof assertion === "object" &&
          assertion !== null &&
          (assertion as Record<string, unknown>).ok !== true,
      )
      .map((assertion) =>
        typeof assertion.name === "string" ? assertion.name : "unknown",
      )
      .filter((name) => name.length > 0)
      .slice(0, 20);
    const kind =
      name.endsWith("-scenario.json") || typeof parsed.scenarioId === "string"
        ? "scenario"
        : "run";
    return {
      file: name,
      path,
      kind,
      modifiedAt,
      runId: parsed.runId,
      scenarioId: parsed.scenarioId,
      ok: parsed.ok,
      createdAt: parsed.createdAt,
      startedAt: parsed.startedAt,
      finishedAt: parsed.finishedAt,
      prompt: parsed.prompt,
      sessionId: parsed.sessionId,
      rawSessionAvailable: parsed.rawSessionAvailable,
      rawLineCount: parsed.rawLineCount,
      toolCallCount: toolCalls.length,
      toolErrorCount: toolErrors.length,
      assertionCount: assertions.length,
      assertionPassCount: assertions.filter(
        (assertion) =>
          typeof assertion === "object" &&
          assertion !== null &&
          (assertion as Record<string, unknown>).ok === true,
      ).length,
      assertionFailCount: failedAssertions.length,
      failedAssertions,
      uiEvidence: parsed.uiEvidence,
      uiArtifacts: Array.isArray(parsed.uiArtifacts)
        ? parsed.uiArtifacts.slice(0, 20)
        : [],
      uiArtifactCount: Array.isArray(parsed.uiArtifacts)
        ? parsed.uiArtifacts.length
        : 0,
      finalAssistantPresent:
        typeof parsed.finalAssistant === "string"
          ? parsed.finalAssistant.length > 0
          : typeof parsed.finalAssistantText === "string" &&
            parsed.finalAssistantText.length > 0,
    };
  } catch (err) {
    return {
      file: name,
      path,
      kind: "unknown",
      modifiedAt,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

function assistantReviewText(result: WorkflowAutomationRunResult): string {
  return (
    [...result.messages]
      .reverse()
      .find((message) => message.role === "assistant")?.content ??
    result.partialAssistantText ??
    ""
  );
}

function collectPartialAssistantText(events: AgentEvent[]): string {
  return events
    .filter(
      (event): event is Extract<AgentEvent, { type: "text-delta" }> =>
        event.type === "text-delta",
    )
    .map((event) => event.text)
    .join("");
}

function buildUiEvidence(panelState: unknown): Record<string, unknown> {
  const paths: string[] = [];
  collectUiPaths(panelState, paths);
  return {
    available: panelState != null,
    kind: panelState == null ? "none" : "state",
    pathCount: paths.length,
    paths,
    snapshotAvailable: panelState != null,
  };
}

function mergeUiEvidence(
  primary: Record<string, unknown>,
  ...items: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const paths = new Set<string>(
    Array.isArray(primary.paths) ? primary.paths.map(String) : [],
  );
  for (const item of items) {
    const itemPaths = item?.paths;
    if (!Array.isArray(itemPaths)) continue;
    for (const path of itemPaths) paths.add(String(path));
  }
  return {
    ...primary,
    pathCount: paths.size,
    paths: [...paths].sort(),
  };
}

function countNonEmptyLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim()).length;
}

function collectUiPaths(value: unknown, paths: string[], prefix = ""): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 20); i++) {
      const path = `${prefix}[${i}]`;
      paths.push(path);
      collectUiPaths(value[i], paths, path);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.push(path);
      collectUiPaths((value as Record<string, unknown>)[key], paths, path);
    }
  }
}

function trimObject(
  input: Record<string, unknown>,
  maxStringLength: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    result[key] =
      typeof value === "string" ? trimString(value, maxStringLength) : value;
  }
  return result;
}

function trimString(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("WORKFLOW_AUTOMATION_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item)).filter((item) => item.trim());
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asNumberMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [String(key).trim(), Number(raw)] as const)
    .filter(([key, number]) => key.length > 0 && Number.isFinite(number));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeWorkflowTimeoutMs(value: unknown): number {
  if (value == null) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(1_000, Math.min(10 * 60_000, Math.floor(number)));
}

function normalizeWorkflowLimit(value: unknown): number | undefined {
  if (value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.floor(number);
}

function normalizeStrategyLibraryAction(
  action: string,
): "rerun" | "watch" | "monitor" | "read" {
  const normalized = String(action ?? "").trim().toLowerCase();
  if (
    normalized === "rerun" ||
    normalized === "watch" ||
    normalized === "monitor" ||
    normalized === "read"
  ) {
    return normalized;
  }
  throw new Error(`WORKFLOW_STRATEGY_LIBRARY_ACTION_UNSUPPORTED: ${action}`);
}

function buildWorkflowPrompt(
  prompt: string,
  options: {
    minToolCalls?: number;
    maxToolCalls?: number;
    maxDataToolCalls?: number;
    maxToolActionCounts?: Record<string, number>;
    expectTools?: string[];
    expectToolActions?: string[];
    disallowTools?: string[];
    allowPendingUserQuestion?: boolean;
  },
): string {
  const expected = (options.expectTools ?? [])
    .map((tool) => String(tool).trim())
    .filter(Boolean);
  const expectedActions = (options.expectToolActions ?? [])
    .map((action) => String(action).trim())
    .filter(Boolean);
  const disallowed = (options.disallowTools ?? [])
    .map((tool) => String(tool).trim())
    .filter(Boolean);
  const lines: string[] = [];
  const hasControls =
    expected.length > 0 ||
    expectedActions.length > 0 ||
    disallowed.length > 0 ||
    options.maxToolCalls != null ||
    options.minToolCalls != null ||
    options.maxDataToolCalls != null ||
    Object.keys(options.maxToolActionCounts ?? {}).length > 0 ||
    options.allowPendingUserQuestion;
  if (hasControls) {
    lines.push("This workflow-test-control block applies only to the current user request and supersedes earlier workflow-test-control blocks.");
  }
  if (expected.length > 0) {
    lines.push(`This workflow requires these observable tools before the final answer: ${expected.join(", ")}.`);
  }
  if (expectedActions.length > 0) {
    lines.push(`This workflow requires these observable tool actions before the final answer: ${expectedActions.join(", ")}.`);
  }
  if (disallowed.length > 0) {
    lines.push(`Do not call these tools in this workflow test: ${disallowed.join(", ")}.`);
  }
  if (options.maxToolCalls != null) {
    lines.push(`Keep the workflow within ${options.maxToolCalls} total tool calls.`);
  }
  if (options.minToolCalls != null) {
    lines.push(`This workflow requires at least ${options.minToolCalls} observable tool calls before the final answer.`);
  }
  if (options.maxDataToolCalls != null) {
    lines.push(`Keep the workflow within ${options.maxDataToolCalls} finance/data workflow tool calls.`);
  }
  const actionLimits = Object.entries(options.maxToolActionCounts ?? {})
    .filter(([, limit]) => Number.isFinite(limit))
    .map(([action, limit]) => `${action}<=${limit}`);
  if (actionLimits.length > 0) {
    lines.push(`Keep these tool-action counts within limits: ${actionLimits.join(", ")}.`);
  }
  if (disallowed.includes("Write") || disallowed.includes("FileWrite")) {
    lines.push(
      "If the user asks for a dashboard or report surface, use the app Dashboard/WebView contract instead of creating a custom file or raw HTML page.",
    );
  }
  if (options.allowPendingUserQuestion) {
    lines.push("If user confirmation is genuinely required, ask one clear question and stop instead of guessing.");
  }
  if (lines.length === 0) return prompt;
  return [
    "<workflow-test-control>",
    ...lines,
    "</workflow-test-control>",
    "",
    prompt,
  ].join("\n");
}

function toolNameFromEvent(event: AgentEvent): string | null {
  const value = event as Record<string, unknown>;
  for (const key of ["tool", "name", "toolName"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const toolUse = value.toolUse;
  if (toolUse && typeof toolUse === "object") {
    const name = (toolUse as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function serviceRunRequiresPermissions(request: RunServiceRunRequest): boolean {
  if (request.payload?.permissionMode === "require") return true;
  const commandPlan = request.payload?.commandPlan;
  if (!commandPlan || typeof commandPlan !== "object") return false;
  return (commandPlan as Record<string, unknown>).category === "execution";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPath(value: unknown, path: string): boolean {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (current == null) return false;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length)
        return false;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function safeFilePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "scenario"
  );
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function runServiceResultSummary(
  result: RunServiceResultSnapshot,
): Record<string, unknown> {
  const created = result.events[0];
  const requestPayload = created?.payload?.requestPayload;
  const entryMode = requestPayload && typeof requestPayload === "object"
    ? (requestPayload as Record<string, unknown>).entryMode
    : undefined;
  return {
    runId: result.runId,
    status: result.status,
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    ...(result.turnId ? { turnId: result.turnId } : {}),
    ...(created?.createdAt ? { createdAt: created.createdAt } : {}),
    ...(created?.payload?.sessionMode != null
      ? { sessionMode: String(created.payload.sessionMode) }
      : {}),
    ...(created?.payload?.uiRuntime != null
      ? { uiRuntime: String(created.payload.uiRuntime) }
      : {}),
    ...(requestPayload && typeof requestPayload === "object" &&
      (requestPayload as Record<string, unknown>).scenarioId != null
      ? { correlationId: String((requestPayload as Record<string, unknown>).scenarioId) }
      : {}),
    ...(entryMode != null ? { entryMode: String(entryMode) } : {}),
    ...(result.finalAnswer != null ? { finalAnswer: result.finalAnswer } : {}),
    ...(result.error != null ? { error: result.error } : {}),
  };
}
