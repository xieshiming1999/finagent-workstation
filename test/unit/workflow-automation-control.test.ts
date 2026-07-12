import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { request as httpRequest } from "http";
import { Agent } from "../../src/agent/agent";
import type { LLMProvider } from "../../src/agent/llm-provider";
import type { Message } from "../../src/agent/message";
import type { SSEEvent } from "../../src/agent/sse-event";
import {
  ToolRegistry,
  type Tool,
  type ToolContext,
} from "../../src/agent/tool";
import { EchoTool } from "../../src/agent/tools/echo";
import { DataStoreTool } from "../../src/agent/tools/data-store-tool";
import { DataStore } from "../../src/agent/data/store/data-store";
import { UIControlTool } from "../../src/agent/tools/ui-tools";
import { WebViewTool } from "../../src/agent/tools/webview";
import { ResearchTool } from "../../src/agent/tools/research";
import { WatchlistTool } from "../../src/agent/tools/watchlist";
import { PortfolioTool } from "../../src/agent/tools/portfolio";
import { AskUserQuestionTool } from "../../src/agent/tools/ask-user";
import { ArtifactRegistryTool } from "../../src/agent/tools/artifact-registry";
import { FinanceWorkflowStateTool } from "../../src/agent/tools/finance-workflow-state";
import { RunbookTool } from "../../src/agent/tools/runbook";
import { ToolCatalogTool } from "../../src/agent/tools/tool-catalog";
import { WorkflowVerifierTool } from "../../src/agent/tools/workflow-verifier";
import {
  SessionSearchTool,
  setSessionIndex,
} from "../../src/agent/tools/session-search";
import { SessionIndex } from "../../src/agent/session-index";
import { MockLLM } from "../mocks/mock-llm";
import {
  WorkflowAutomationControl,
  selectAskUserQuestionAnswer,
  startWorkflowAutomationServer,
  type WorkflowAutomationServer,
} from "../../src/main/workflow-automation-control";
import { financeWorkflowHooks } from "../../src/domain/finance/workflows/finance-workflow-hooks";

class HangingLLM implements LLMProvider {
  readonly model = "hanging-mock";
  readonly contextWindow = 128_000;
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  async *sendMessage(
    _systemPrompt: string,
    _messages: Message[],
    _tools: unknown[],
  ): AsyncGenerator<SSEEvent> {
    while (!this.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    yield { type: "done", finishReason: "stop" };
  }
}

class ErrorEventLLM implements LLMProvider {
  readonly model = "error-event-mock";
  readonly contextWindow = 128_000;

  cancel(): void {}

  async *sendMessage(
    _systemPrompt: string,
    _messages: Message[],
    _tools: unknown[],
  ): AsyncGenerator<SSEEvent> {
    yield { type: "error", message: "network unavailable" };
    yield { type: "done", finishReason: "stop" };
  }
}

class FailingTool implements Tool {
  name = "FailingTool";
  description = "Always fails for workflow automation evidence tests";
  inputSchema = { type: "object", properties: {} };
  isReadOnly = true;

  async call(
    _id: string,
    _input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<string> {
    throw new Error("planned tool failure");
  }
}

class NamedTool implements Tool {
  description: string;
  inputSchema = { type: "object", properties: {} };
  isReadOnly = true;

  constructor(readonly name: string) {
    this.description = `${name} test tool`;
  }

  async call(
    _id: string,
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<string> {
    return `${this.name} ok ${JSON.stringify(input)}`;
  }
}

class DelayedNamedTool extends NamedTool {
  async call(
    _id: string,
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<string> {
    const delayMs = Number(input.delayMs ?? 0);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return `${this.name} result ${String(input.label ?? "")}`;
  }
}

function makeControl(
  basePath: string,
  llm = new MockLLM([{ text: "hello" }]),
  extraTools: Tool[] = [],
  getPanelState: () => Promise<unknown> = async () => [
    { id: "api-health", type: "api-health", isActive: true },
  ],
  captureUiArtifact?: (runId: string) => Promise<Record<string, unknown> | null>,
  triggerMonitor?: (
    monitorId: string,
    options?: { timeoutMs?: number },
  ) => Promise<Record<string, unknown>>,
  answerUserQuestion?: (
    answer: string,
    options?: { timeoutMs?: number },
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
) {
  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  for (const tool of extraTools) registry.register(tool);
  const agent = new Agent({
    llm,
    tools: registry,
    basePath,
    skipPermissions: true,
  });
  const control = new WorkflowAutomationControl({
    getAgent: () => agent,
    getBasePath: () => basePath,
    getPanelState,
    captureUiArtifact,
    triggerMonitor,
    answerUserQuestion,
  });
  return { agent, control, llm };
}

function makeFinanceControl(
  basePath: string,
  llm = new MockLLM([{ text: "hello" }]),
  extraTools: Tool[] = [],
) {
  const registry = new ToolRegistry();
  for (const tool of extraTools) registry.register(tool);
  const agent = new Agent({
    llm,
    tools: registry,
    basePath,
    skipPermissions: true,
    domainWorkflowHooks: financeWorkflowHooks,
  });
  const control = new WorkflowAutomationControl({
    getAgent: () => agent,
    getBasePath: () => basePath,
    getPanelState: async () => [
      { id: "api-health", type: "api-health", isActive: true },
    ],
  });
  return { agent, control, llm };
}

function makeStrategyHarnessControl(
  basePath: string,
  llm = new MockLLM([{ text: "hello" }]),
) {
  const registry = new ToolRegistry();
  registry.register(new NamedTool("MarketData"));
  registry.register(new RunbookTool());
  registry.register(new FinanceWorkflowStateTool());
  registry.register(new ArtifactRegistryTool());
  registry.register(new WorkflowVerifierTool());
  registry.register(new ToolCatalogTool(() => registry.capabilities()));
  const agent = new Agent({
    llm,
    tools: registry,
    basePath,
    skipPermissions: true,
  });
  const control = new WorkflowAutomationControl({
    getAgent: () => agent,
    getBasePath: () => basePath,
    getPanelState: async () => [
      { id: "trace", type: "workflow-trace", isActive: true },
    ],
  });
  return { agent, control, llm };
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const payload = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port,
        path,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            json: data ? JSON.parse(data) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getJson(
  port: number,
  path: string,
): Promise<{ status: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      { method: "GET", hostname: "127.0.0.1", port, path },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            json: data ? JSON.parse(data) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitUntil timed out");
}

describe("WorkflowAutomationControl", () => {
  let basePath: string;
  let oldEnabled: string | undefined;
  let oldPort: string | undefined;
  let oldRuntimeProbeFixture: string | undefined;
  let server: WorkflowAutomationServer | null = null;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), "fin-workflow-control-"));
    oldEnabled = process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION;
    oldPort = process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT;
    oldRuntimeProbeFixture = process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
    delete process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION;
    delete process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT;
    delete process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (oldEnabled === undefined)
      delete process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION;
    else process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = oldEnabled;
    if (oldPort === undefined)
      delete process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT;
    else process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT = oldPort;
    if (oldRuntimeProbeFixture === undefined)
      delete process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
    else
      process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = oldRuntimeProbeFixture;
  });

  it("is disabled unless the explicit workflow automation flag is set", async () => {
    const { control } = makeControl(basePath);

    expect(control.health()).toMatchObject({
      enabled: false,
      agentReady: true,
      rawSocketProtocol: false,
      webSocketCommandProtocol: false,
      providerEndpointBypass: false,
    });
    await expect(control.sendPrompt("hello")).rejects.toThrow(
      "WORKFLOW_AUTOMATION_DISABLED",
    );
    await expect(startWorkflowAutomationServer(control)).resolves.toBeNull();
  });

  it("preserves structured AskUserQuestion auto answers", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const structuredAnswer =
      '{"decision":"allow_preview","selectedOptionIndex":3,"selectedOptionLabel":"允许模拟执行"}';
    let observedAnswer = "";
    const askUserQuestionTool = new AskUserQuestionTool();
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "ask",
              name: "AskUserQuestion",
              arguments: {
                questions: [
                  {
                    header: "交易确认",
                    question: "是否允许预览？",
                    options: [
                      { label: "触发时再确认" },
                      { label: "只计算不下单" },
                      { label: "允许模拟执行" },
                    ],
                  },
                ],
              },
            },
          ],
        },
        { text: "done" },
      ]),
      [askUserQuestionTool],
      async () => [],
      undefined,
      undefined,
      (answer) => {
        observedAnswer = answer;
        askUserQuestionTool.respondToQuestion(answer);
      },
    );

    const result = await control.runScenario({
      id: "structured-ask-user-answer",
      prompt: "ask",
      autoAnswerUserQuestions: [structuredAnswer],
      expectTools: ["AskUserQuestion"],
    });

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(observedAnswer).toBe(structuredAnswer);
  });

  it("selects AskUserQuestion answers only by structured answer, exact label, or index", () => {
    const input = {
      questions: [
        {
          header: "交易确认",
          question: "是否允许预览？",
          options: [
            { label: "触发时再确认" },
            { label: "只计算不下单" },
            { label: "允许模拟执行" },
          ],
        },
      ],
    };
    const structuredAnswer =
      '{"decision":"allow_preview","selectedOptionIndex":3,"selectedOptionLabel":"允许模拟执行"}';

    expect(selectAskUserQuestionAnswer(input, [structuredAnswer])).toBe(
      structuredAnswer,
    );
    expect(selectAskUserQuestionAnswer(input, ["3"])).toBe("允许模拟执行");
    expect(selectAskUserQuestionAnswer(input, ["允许模拟执行"])).toBe(
      "允许模拟执行",
    );
    expect(selectAskUserQuestionAnswer(input, ["模拟执行"])).toBeNull();
  });

  it("runs a prompt through the real agent path and writes durable evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { agent, control, llm } = makeControl(
      basePath,
      new MockLLM([{ text: "workflow ok" }]),
    );

    const result = await control.sendPrompt("check interface availability");

    expect(result.ok).toBe(true);
    expect(result.prompt).toBe("check interface availability");
    expect(result.events.map((event) => event.type)).toContain("text-delta");
    expect(
      result.messages.some(
        (message) =>
          message.role === "user" &&
          message.content === "check interface availability",
      ),
    ).toBe(true);
    expect(
      result.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.includes("workflow ok"),
      ),
    ).toBe(true);
    expect(result.panelState).toEqual([
      { id: "api-health", type: "api-health", isActive: true },
    ]);
    expect(result.uiEvidence).toMatchObject({
      available: true,
      kind: "state",
      snapshotAvailable: true,
    });
    expect(result.uiEvidence?.paths).toContain("[0].id");
    expect(
      llm.calls[0]?.messages.some(
        (message) =>
          message.role === "user" &&
          message.content === "check interface availability",
      ),
    ).toBe(true);

    const sessionPath = join(basePath, "sessions", "current.jsonl");
    expect(readFileSync(sessionPath, "utf-8")).toContain(
      "check interface availability",
    );
    expect(result.rawSessionAvailable).toBe(true);
    expect(result.rawLineCount).toBeGreaterThan(0);
    expect(result.reportPath && existsSync(result.reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(result.reportPath!, "utf-8"));
    expect(report).toMatchObject({
      runId: result.runId,
      sessionId: agent.session.id,
      prompt: "check interface availability",
      ok: true,
      rawSessionAvailable: true,
    });
    expect(report.rawLineCount).toBeGreaterThan(0);
    expect(report.uiEvidence.paths).toContain("[0].id");
  });

  it("runs strategy-runtime discovery and verifier through workflow automation", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeStrategyHarnessControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "catalog",
              name: "ToolCatalog",
              arguments: { action: "module", module: "strategy-runtime" },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "runbook",
              name: "Runbook",
              arguments: { action: "get", workflow: "strategy_backtest" },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "state",
              name: "FinanceWorkflowState",
              arguments: {
                action: "save",
                id: "workstation-strategy-workflow-state",
                status: "active",
                workflowState: {
                  workflowKind: "strategy_review",
                  assetClass: "stock",
                  intentMode: "backtest",
                  executionMode: "preview_only",
                  confirmationState: "none",
                  safetyBoundary: "read-only strategy validation",
                  evidenceRefs: ["StrategySpec", "validation_report"],
                  subject: "600519",
                },
                requiredEvidence: ["StrategySpec", "validation_report"],
                completedSteps: ["runbook", "capability_discovery"],
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "artifact",
              name: "ArtifactRegistry",
              arguments: {
                action: "register",
                kind: "strategy",
                path: "memory/strategies/workstation_strategy_runtime.json",
                title: "Workstation strategy runtime smoke",
                source: "workflow-automation",
                verificationStatus: "verified",
                provenance: {
                  contract: "StrategySpec",
                  evidence: "custom_strategy_help",
                },
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "verifier",
              name: "WorkflowVerifier",
              arguments: {
                action: "check",
                workflow: "strategy_backtest",
                requireWorkflowState: true,
                providerHealth: [{ provider: "local", status: "healthy" }],
              },
            },
          ],
        },
        {
          text: "Strategy runtime discovery, typed workflow state, artifact registration, and WorkflowVerifier all passed before finalizing.",
        },
      ]),
    );

    const result = await control.runScenario({
      id: "workstation-strategy-runtime-contract-smoke",
      prompt:
        "Discover the strategy runtime contract, save typed workflow state, register the strategy artifact, and verify before final answer.",
      expectTools: [
        "ToolCatalog",
        "Runbook",
        "FinanceWorkflowState",
        "ArtifactRegistry",
        "WorkflowVerifier",
      ],
      expectToolResultContains: [
        "strategy-runtime",
        "strategy_backtest",
        "workflow-state-record-v1",
        "artifact-registry-record-v1",
        "workflow-verifier-check-v1",
      ],
      expectFinalContains: ["Strategy runtime discovery", "WorkflowVerifier"],
      expectNoToolErrors: true,
      expectUiStateKeys: ["[0].id"],
      allowPendingUserQuestion: false,
    });

    expect(result.ok).toBe(true);
    expect(result.scenarioReportPath && existsSync(result.scenarioReportPath)).toBe(true);
    const report = JSON.parse(readFileSync(result.scenarioReportPath!, "utf-8"));
    expect(report.toolCalls.map((call: { name: string }) => call.name))
      .toEqual(expect.arrayContaining([
        "ToolCatalog",
        "Runbook",
        "FinanceWorkflowState",
        "ArtifactRegistry",
        "WorkflowVerifier",
      ]));
  });

  it("captures optional UI screenshot artifacts into workflow reports", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "workflow screenshot ok" }]),
      [],
      async () => [{ id: "dashboard", type: "dashboard", isActive: true }],
      async (runId) => {
        const dir = join(basePath, "data", "workflow-automation", "screenshots");
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${runId}.png`);
        writeFileSync(path, "png");
        return {
          kind: "main-window-screenshot",
          path,
          bytes: 3,
          capturedAt: "2026-06-25T00:00:00.000Z",
        };
      },
    );

    const result = await control.sendPrompt("capture the dashboard evidence");

    expect(result.uiArtifacts).toEqual([
      expect.objectContaining({
        kind: "main-window-screenshot",
        bytes: 3,
      }),
    ]);
    const artifactPath = String(result.uiArtifacts?.[0]?.path);
    expect(existsSync(artifactPath)).toBe(true);
    const report = JSON.parse(readFileSync(result.reportPath!, "utf-8"));
    expect(report.uiArtifacts).toEqual([
      expect.objectContaining({
        kind: "main-window-screenshot",
        path: artifactPath,
      }),
    ]);
  });

  it("records tool-call and tool-error evidence from the session", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "failing-tool", name: "FailingTool", arguments: {} },
          ],
        },
        { text: "handled error" },
      ]),
      [new FailingTool()],
    );

    const result = await control.sendPrompt("trigger a tool validation error");

    expect(result.ok).toBe(true);
    expect(
      result.messages.some((message) =>
        message.toolUses?.some((tool) => tool.name === "FailingTool"),
      ),
    ).toBe(true);
    expect(result.messages.some((message) => message.toolResult?.isError)).toBe(
      true,
    );
    const report = JSON.parse(readFileSync(result.reportPath!, "utf-8"));
    expect(report.toolErrors.length).toBeGreaterThan(0);
  });

  it("fails scenario assertions when no tool errors are expected", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "failing-tool", name: "FailingTool", arguments: {} },
          ],
        },
        { text: "handled error" },
      ]),
      [new FailingTool()],
    );

    const result = await control.runScenario({
      id: "no-tool-errors-required",
      prompt: "trigger a tool validation error",
      expectTools: ["FailingTool"],
      expectNoToolErrors: true,
    });

    expect(result.ok).toBe(false);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "toolErrors.none",
        ok: false,
        expected: "no tool errors",
      }),
    );
  });

  it("runs bounded scenarios with assertion evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "echo-tool",
              name: "Echo",
              arguments: { message: "scenario data" },
            },
          ],
        },
        { text: "scenario complete" },
      ]),
    );

    const result = await control.runScenario({
      id: "interface-readback-smoke",
      prompt: "use echo as a stand-in for an interface readback workflow",
      expectTools: ["Echo"],
      expectToolResultContains: ["scenario data"],
      expectFinalContains: ["scenario complete"],
      expectPanelStateKeys: ["0.id"],
      expectUiEvidencePaths: ["[0].id", "[0].type"],
    });

    expect(result.ok).toBe(true);
    expect(result.assertions.every((assertion) => assertion.ok)).toBe(true);
    expect(
      result.assertions.some(
        (assertion) => assertion.name === "toolResultContains.scenario data",
      ),
    ).toBe(true);
    expect(
      result.scenarioReportPath && existsSync(result.scenarioReportPath),
    ).toBe(true);
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(report).toMatchObject({
      scenarioId: "interface-readback-smoke",
      ok: true,
      runId: result.run.runId,
    });
    expect(
      report.toolResults.some((entry: { content?: string }) =>
        entry.content?.includes("scenario data"),
      ),
    ).toBe(true);
    const runReport = JSON.parse(readFileSync(result.run.reportPath!, "utf-8"));
    expect(
      runReport.toolResults.some((entry: { content?: string }) =>
        entry.content?.includes("scenario data"),
      ),
    ).toBe(true);
  });

  it("accepts unqualified expected tool actions", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "market-help",
              name: "MarketData",
              arguments: { action: "custom_strategy_help" },
            },
          ],
        },
        { text: "strategy help loaded" },
      ]),
      [new NamedTool("MarketData")],
    );

    const result = await control.runScenario({
      id: "unqualified-tool-action-smoke",
      prompt: "load strategy help",
      expectTools: ["MarketData"],
      expectToolActions: ["custom_strategy_help"],
    });

    expect(result.ok).toBe(true);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "toolAction.custom_strategy_help",
        ok: true,
      }),
    );
  });

  it("pairs workflow report tool results by tool-use id instead of array order", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "slow-call",
              name: "DelayedTool",
              arguments: { label: "slow", delayMs: 20 },
            },
            {
              id: "fast-call",
              name: "DelayedTool",
              arguments: { label: "fast", delayMs: 0 },
            },
          ],
        },
        { text: "paired complete" },
      ]),
      [new DelayedNamedTool("DelayedTool")],
    );

    const result = await control.runScenario({
      id: "tool-interaction-pairing-smoke",
      prompt: "run two delayed tool calls",
      expectTools: ["DelayedTool"],
      expectFinalContains: ["paired complete"],
    });

    expect(result.ok).toBe(true);
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(report.toolCalls.map((call: { id?: string }) => call.id)).toEqual([
      "slow-call",
      "fast-call",
    ]);
    expect(
      report.toolResults.map((item: { toolUseId?: string }) => item.toolUseId),
    ).toEqual(expect.arrayContaining(["slow-call", "fast-call"]));
    const interactions = report.toolInteractions as Array<{
      id: string;
      result?: { content?: string } | null;
    }>;
    expect(interactions.find((item) => item.id === "slow-call")?.result?.content).toContain(
      "slow",
    );
    expect(interactions.find((item) => item.id === "fast-call")?.result?.content).toContain(
      "fast",
    );
    expect(report.agentReview.toolInteractions.length).toBe(2);
  });

  it("does not classify the current proposed finance call as a duplicate of itself", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeFinanceControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "first-kline",
              name: "MarketData",
              arguments: { action: "kline", code: "300059", period: "daily" },
            },
          ],
        },
        { text: "kline evidence collected" },
      ]),
      [new NamedTool("MarketData")],
    );

    const result = await control.runScenario({
      id: "finance-dedup-self-comparison",
      prompt: "Collect one kline evidence item for 300059.",
      expectTools: ["MarketData"],
      maxDataToolCalls: 1,
      expectFinalContains: ["kline evidence collected"],
    });

    expect(result.ok).toBe(true);
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(report.agentReview.executedToolCallCount).toBe(1);
    expect(report.agentReview.skippedToolCallCount).toBe(0);
    expect(report.agentReview.toolInteractions).toContainEqual(
      expect.objectContaining({
        id: "first-kline",
        skipped: false,
      }),
    );
    expect(JSON.stringify(report.agentReview.toolInteractions)).not.toContain(
      "Skipped: duplicate finance evidence call",
    );
  });

  it("counts UI evidence tools separately from data workflow tools", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "data-tool", name: "DataStore", arguments: { action: "query_quote" } },
            { id: "dashboard-tool", name: "Dashboard", arguments: { id: "dash" } },
            { id: "webview-tool", name: "WebView", arguments: { action: "screenshot" } },
          ],
        },
        { text: "dashboard checked" },
      ]),
      [new NamedTool("DataStore"), new NamedTool("Dashboard"), new NamedTool("WebView")],
    );

    const result = await control.runScenario({
      id: "dashboard-data-budget-smoke",
      prompt: "build and inspect a dashboard",
      maxToolCalls: 3,
      maxDataToolCalls: 1,
      expectFinalContains: ["dashboard checked"],
    });

    expect(result.ok).toBe(true);
    expect(
      result.assertions.find((assertion) => assertion.name === "maxDataToolCalls.1"),
    ).toMatchObject({ ok: true, actual: 1 });
  });

  it("fails scenario assertions when a tool action exceeds its configured count", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "validate-1", name: "MarketData", arguments: { action: "custom_strategy_validate" } },
            { id: "validate-2", name: "MarketData", arguments: { action: "custom_strategy_validate" } },
          ],
        },
        { text: "validated twice" },
      ]),
      [new NamedTool("MarketData")],
    );

    const result = await control.runScenario({
      id: "strategy-action-budget-smoke",
      prompt: "validate strategy",
      maxToolActionCounts: { custom_strategy_validate: 1 },
    });

    expect(result.ok).toBe(false);
    expect(
      result.assertions.find((assertion) => assertion.name === "maxToolAction.custom_strategy_validate.1"),
    ).toMatchObject({ ok: false, actual: 2 });
  });

  it("fails scenario assertions when a disallowed tool is used", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "read-tool", name: "Read", arguments: { file_path: "generated.html" } },
          ],
        },
        { text: "read complete" },
      ]),
      [new NamedTool("Read")],
    );

    const result = await control.runScenario({
      id: "dashboard-no-read-smoke",
      prompt: "inspect dashboard without reading files",
      disallowTools: ["Read"],
    });

    expect(result.ok).toBe(false);
    expect(
      result.assertions.find((assertion) => assertion.name === "noTool.Read"),
    ).toMatchObject({ ok: false });
  });

  it("serves local HTTP control endpoints when explicitly enabled", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "served" }]),
    );
    server = await startWorkflowAutomationServer(control);

    expect(server?.port).toBeGreaterThan(0);
    const health = await getJson(server!.port, "/health");
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({
      enabled: true,
      agentReady: true,
      transport: "loopback-http",
      localOnly: true,
      rawSocketProtocol: false,
      webSocketCommandProtocol: false,
      providerEndpointBypass: false,
    });

    const sent = await postJson(server!.port, "/workflow/send", {
      prompt: "use the app path",
    });
    expect(sent.status).toBe(200);
    expect(sent.json.ok).toBe(true);
    expect(
      sent.json.messages.some(
        (message: any) =>
          message.role === "user" && message.content === "use the app path",
      ),
    ).toBe(true);

    const idle = await getJson(server!.port, "/workflow/idle?timeoutMs=25");
    expect(idle.status).toBe(200);
    expect(idle.json).toMatchObject({
      ok: true,
      idle: true,
      agentReady: true,
      agentRunning: false,
      timedOut: false,
    });
    expect(idle.json.waitedMs).toBeGreaterThanOrEqual(0);

    const cancel = await postJson(server!.port, "/workflow/cancel", {
      reason: "cleanup",
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json).toMatchObject({
      ok: true,
      agentReady: true,
      runningBeforeCancel: false,
      cancelRequested: false,
      agentRunning: false,
      reason: "cleanup",
    });

    const answered = await postJson(
      server!.port,
      "/workflow/answer_user_question",
      {
        answer: "1",
      },
    );
    expect(answered.status).toBe(200);
    expect(answered.json).toEqual({ ok: true, answer: "1" });

    const session = await getJson(server!.port, "/workflow/session");
    expect(session.status).toBe(200);
    expect(session.json.rawSessionAvailable).toBe(true);
    expect(session.json.rawLineCount).toBeGreaterThan(0);

    const reports = await getJson(server!.port, "/workflow/reports?limit=5");
    expect(reports.status).toBe(200);
    expect(reports.json.count).toBeGreaterThan(0);
    expect(
      reports.json.reports.some(
        (report: any) =>
          report.kind === "run" &&
          report.runId === sent.json.runId &&
          report.prompt === "use the app path" &&
          report.rawSessionAvailable === true &&
          report.rawLineCount > 0,
      ),
    ).toBe(true);

    const cleared = await postJson(server!.port, "/workflow/clear_session", {});
    expect(cleared.status).toBe(200);
    expect(cleared.json).toMatchObject({
      ok: true,
      agentReady: true,
      messageCount: 0,
      rawSessionAvailable: true,
    });
    expect(cleared.json.sessionId).toBeTruthy();
    expect(cleared.json.sessionPath).toContain("sessions/current.jsonl");

    const afterClear = await getJson(server!.port, "/workflow/session");
    expect(afterClear.status).toBe(200);
    expect(afterClear.json.messages).toEqual([]);
  });

  it("serves strategy library action endpoint through real agent intake", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    mkdirSync(join(basePath, "data"), { recursive: true });
    writeFileSync(
      join(basePath, "data", "custom-strategies.json"),
      JSON.stringify([
        {
          strategyId: "custom_20_v1",
          status: "backtested",
          updatedAt: "2026-07-02T00:00:00.000Z",
          spec: {
            id: "custom_20_v1",
            name: "Moutai SMA20 volume strategy",
            symbol: "600519",
            assetClass: "stock",
          },
          evidence: { action: "custom_strategy_backtest" },
        },
      ]),
    );
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "watch-add",
              name: "Watchlist",
              arguments: {
                action: "add",
                symbol: "600519",
                strategyId: "custom_20_v1",
                strategyRules: { id: "custom_20_v1" },
              },
            },
          ],
        },
        { text: "Watchlist readback confirmed for custom_20_v1." },
      ]),
      [new NamedTool("Watchlist")],
    );
    server = await startWorkflowAutomationServer(control);

    const result = await postJson(
      server!.port,
      "/workflow/strategy_library_action",
      {
        action: "watch",
        strategyId: "custom_20_v1",
        timeoutMs: 30_000,
      },
    );

    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(result.json.action).toBe("watch");
    expect(result.json.strategy.strategyId).toBe("custom_20_v1");
    expect(result.json.prompt).toContain('Watchlist(action:"add")');
    expect(result.json.prompt).toContain("strategyId=custom_20_v1");
    expect(result.json.toolCalls).toEqual([
      {
        toolName: "Watchlist",
        input: {
          action: "add",
          symbol: "600519",
          strategyId: "custom_20_v1",
          strategyRules: { id: "custom_20_v1" },
        },
      },
    ]);
    expect(result.json.toolErrors).toEqual([]);
    expect(result.json.finalAssistantText).toContain("custom_20_v1");
  });

  it("cancels active workflow agent work when the HTTP client disconnects", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const llm = new HangingLLM();
    const { agent, control } = makeControl(basePath, llm as any);
    server = await startWorkflowAutomationServer(control);

    const payload = JSON.stringify({ prompt: "start a long dashboard workflow" });
    const req = httpRequest({
      method: "POST",
      hostname: "127.0.0.1",
      port: server!.port,
      path: "/workflow/send",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    });
    req.on("error", () => undefined);
    req.write(payload);
    req.end();

    await waitUntil(() => agent.isRunning, 500);
    req.destroy();
    await waitUntil(() => llm.cancelled && !agent.isRunning, 1000);

    expect(llm.cancelled).toBe(true);
    expect(agent.isRunning).toBe(false);
  });

  it("cancels active workflow agent work when a request timeout is reached", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const llm = new HangingLLM();
    const { agent, control } = makeControl(basePath, llm as any);
    server = await startWorkflowAutomationServer(control);

    const result = await postJson(server!.port, "/workflow/send", {
      prompt: "start a bounded long dashboard workflow",
      timeoutMs: 1000,
    });

    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(false);
    expect(result.json.error).toContain("WORKFLOW_AUTOMATION_TIMEOUT");
    await waitUntil(() => llm.cancelled && !agent.isRunning, 1000);
    expect(llm.cancelled).toBe(true);
    expect(agent.isRunning).toBe(false);
    expect(
      result.json.events.some(
        (event: any) =>
          event.type === "error" &&
          String(event.message).includes("WORKFLOW_AUTOMATION_TIMEOUT"),
      ),
    ).toBe(true);
  });

  it("returns post-answer event-agent evidence from answer_user_question", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "unused" }]),
      [],
      undefined,
      undefined,
      undefined,
      async (answer, options) => ({
        eventAgent: {
          messageCount: 2,
          finalAssistantText: `review complete after ${answer}`,
          toolErrorCount: 0,
        },
        eventAgentWait: {
          completed: true,
          reason: "idle",
          waitedMs: Math.min(options?.timeoutMs ?? 0, 25),
        },
        pendingUserQuestion: null,
        eventQueueLength: 0,
      }),
    );
    server = await startWorkflowAutomationServer(control, 0);
    expect(server).not.toBeNull();

    const answered = await postJson(
      server!.port,
      "/workflow/answer_user_question",
      {
        answer: "1",
        timeoutMs: 2500,
      },
    );

    expect(answered.status).toBe(200);
    expect(answered.json).toMatchObject({
      ok: true,
      answer: "1",
      eventAgent: {
        messageCount: 2,
        finalAssistantText: "review complete after 1",
        toolErrorCount: 0,
      },
      eventAgentWait: {
        completed: true,
        reason: "idle",
      },
      pendingUserQuestion: null,
      eventQueueLength: 0,
    });
  });

  it("serves local scenario endpoint when explicitly enabled", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "scenario via http" }]),
      [],
      async () => [{ id: "api-health", type: "api-health", isActive: true }],
      async (runId) => ({
        kind: "main-window-screenshot",
        path: join(basePath, "data", "workflow-automation", `${runId}.png`),
        bytes: 10,
      }),
    );
    server = await startWorkflowAutomationServer(control);

    const result = await postJson(server!.port, "/workflow/scenario", {
      id: "http-scenario",
      prompt: "run scenario through http",
      expectFinalContains: ["scenario via http"],
      expectPanelStateKeys: ["0.type"],
      expectUiEvidencePaths: ["[0].id", "[0].type"],
      expectUiArtifactKinds: ["main-window-screenshot"],
    });

    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(result.json.assertions.every((assertion: any) => assertion.ok)).toBe(
      true,
    );
    expect(result.json.scenarioReportPath).toContain("http-scenario");

    const reports = await getJson(server!.port, "/workflow/reports?limit=5");
    const scenarioSummary = reports.json.reports.find(
      (report: any) => report.scenarioId === "http-scenario",
    );
    expect(scenarioSummary).toMatchObject({
      kind: "scenario",
      assertionFailCount: 0,
      failedAssertions: [],
    });
    expect(scenarioSummary.assertionCount).toBeGreaterThan(0);
    expect(
      result.json.assertions.some(
        (assertion: any) =>
          assertion.name === "uiArtifact.main-window-screenshot" &&
          assertion.ok === true,
      ),
    ).toBe(true);
    expect(scenarioSummary.uiArtifactCount).toBe(1);
  });

  it("runs current session persistence workflow scenario with session evidence assertions", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          text: "I recorded this workflow in durable session evidence before ending the turn.",
        },
      ]),
      [],
      async () => ({
        activePanel: "session",
        sessionEvidenceVisible: true,
      }),
    );

    const result = await control.runScenario({
      id: "electron-session-persistence-smoke",
      prompt:
        "Record a session persistence checkpoint for the workflow automation harness.",
      expectFinalContains: ["durable session evidence"],
      expectSessionContains: [
        "Record a session persistence checkpoint",
        "durable session evidence",
      ],
      expectPanelStateKeys: ["activePanel", "sessionEvidenceVisible"],
    });

    expect(result.ok).toBe(true);
    expect(result.run.sessionPath && existsSync(result.run.sessionPath)).toBe(
      true,
    );
    expect(result.run.rawSessionAvailable).toBe(true);
    expect(result.run.rawLineCount).toBeGreaterThan(0);
    const sessionText = readFileSync(result.run.sessionPath!, "utf-8");
    expect(sessionText).toContain("Record a session persistence checkpoint");
    expect(sessionText).toContain("durable session evidence");
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(
      report.assertions.some(
        (assertion: { name: string; ok: boolean }) =>
          assertion.name.startsWith("sessionContains.") && assertion.ok,
      ),
    ).toBe(true);
    expect(report.rawSessionAvailable).toBe(true);
    expect(report.rawLineCount).toBeGreaterThan(0);
  });

  it("marks expected tools as allowed for the current workflow-control block", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const llm = new MockLLM([{ text: "ready" }]);
    const { control } = makeControl(basePath, llm);

    const result = await control.runScenario({
      id: "expected-tool-control-smoke",
      prompt: "Create a signal-only monitor from the saved strategy.",
      expectTools: ["Watchlist", "MonitorCreate"],
      disallowTools: ["Bash", "Portfolio"],
      maxToolCalls: 4,
      allowPendingUserQuestion: true,
    });

    expect(result.run.ok).toBe(true);
    const firstCall = llm.calls[0];
    const userMessage = firstCall.messages.find((message) => message.role === "user");
    expect(userMessage?.content).toContain(
      "This workflow-test-control block applies only to the current user request and supersedes earlier workflow-test-control blocks.",
    );
    expect(userMessage?.content).toContain(
      "This workflow requires these observable tools before the final answer: Watchlist, MonitorCreate.",
    );
    expect(userMessage?.content).toContain(
      "Do not call these tools in this workflow test: Bash, Portfolio.",
    );
    expect(userMessage?.content).not.toContain(
      "Do not call these tools in this workflow test: Watchlist",
    );
    expect(userMessage?.content).not.toContain(
      "Do not call these tools in this workflow test: MonitorCreate",
    );
  });

  it("runs current DataStore interface-discovery workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "describe-stock-quote",
              name: "DataStore",
              arguments: {
                action: "interface_describe",
                interfaceId: "stock.quote",
              },
            },
          ],
        },
        {
          text: "I checked stock.quote through the governed interface contract before any provider refresh.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-interface-discovery-smoke",
      prompt:
        "Explain the governed stock quote data interface before fetching live data.",
      expectTools: ["DataStore"],
      expectFinalContains: ["governed interface contract"],
      expectPanelStateKeys: ["0.id"],
    });

    expect(result.ok).toBe(true);
    expect(
      result.run.messages.some((message) =>
        message.toolResult?.content.includes("interface_describe"),
      ),
    ).toBe(true);
  });

  it("runs current DataStore data-health workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "data-health-summary",
              name: "DataStore",
              arguments: {
                action: "data_health",
                section: "summary",
                limit: 3,
              },
            },
          ],
        },
        {
          text: "I checked data health before deciding whether provider retry is appropriate.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-data-health-smoke",
      prompt: "Check data health before retrying a provider route.",
      expectTools: ["DataStore"],
      expectFinalContains: ["data health"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    expect(
      result.run.messages.some((message) =>
        message.toolResult?.content.includes("data_health"),
      ),
    ).toBe(true);
    expect(
      result.run.messages.some((message) =>
        message.toolResult?.content.includes('"cacheDecision"'),
      ),
    ).toBe(true);
  });

  it("runs current DataStore finance-doctor workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "finance-doctor-summary",
              name: "DataStore",
              arguments: { action: "finance_doctor" },
            },
          ],
        },
        {
          text: "I checked Finance Doctor runtime and session history readiness before continuing the workflow.",
        },
      ]),
      [tool],
      async () => ({ activePanel: "api-health", doctorVisible: true }),
    );

    const result = await control.runScenario({
      id: "electron-finance-doctor-session-health-smoke",
      prompt:
        "Check Finance Doctor runtime and session history readiness before continuing.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"action": "finance_doctor"',
        '"interfaceId": "data.health"',
        '"capabilityId": "local.finance_doctor"',
        '"id": "session_history"',
      ],
      expectFinalContains: ["Finance Doctor runtime"],
      expectSessionContains: ["Finance Doctor runtime", "session history"],
      expectPanelStateKeys: ["activePanel", "doctorVisible"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore interface-availability gated-provider workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "wind-bond-availability",
              name: "DataStore",
              arguments: {
                action: "interface_availability",
                interfaceId: "bond.issuer_financials",
                provider: "wind",
                providerMode: "strict",
              },
            },
          ],
        },
        {
          text: "I checked Wind bond.issuer_financials availability and kept the provider gated before any live refresh.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-interface-availability-gated-provider-smoke",
      prompt:
        "Check Wind bond issuer financial availability before any live provider refresh.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"action": "interface_availability"',
        '"interfaceId": "bond.issuer_financials"',
        '"provider": "wind"',
        '"providerMode": "strict"',
        '"status": "credential-gated"',
        '"routeReadiness": "blocked"',
        '"blockedCapabilities"',
      ],
      expectFinalContains: ["provider gated"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore Tencent global quote availability workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "tencent-global-quote-availability",
              name: "DataStore",
              arguments: {
                action: "interface_availability",
                interfaceId: "stock.quote",
                provider: "tencent",
                providerMode: "strict",
              },
            },
          ],
        },
        {
          text: "I checked strict Tencent stock.quote availability and saw the global-only HK/US quote capability before any live refresh.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-interface-availability-tencent-global-quote-smoke",
      prompt:
        "Check strict Tencent stock quote availability before any live provider refresh.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"action": "interface_availability"',
        '"interfaceId": "stock.quote"',
        '"provider": "tencent"',
        '"providerMode": "strict"',
        '"status": "global-only"',
        '"capabilityId": "tencent.global.stock_quote"',
        '"routeReadiness": "degraded"',
        '"routeState": "allowed-unvalidated"',
      ],
      expectFinalContains: ["global-only HK/US quote capability"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore data-feed status workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "data-feed-status",
              name: "DataStore",
              arguments: { action: "data_feeds", feedId: "fund_nav" },
            },
          ],
        },
        {
          text: "I inspected Data Manager feed status before deciding whether to run a prefetch.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-data-feed-status-smoke",
      prompt:
        "Inspect configured Data Manager feed status before running any prefetch.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"action": "data_feeds"',
        '"canonicalTable": "data_feed_config"',
        '"targetEvidence"',
      ],
      expectFinalContains: ["Data Manager feed status"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes('"action": "data_feeds"'),
    );
    expect(toolResult?.toolResult?.content).toContain('"feedId": "fund_nav"');
    expect(toolResult?.toolResult?.content).toContain(
      '"readbackAction": "data_feeds"',
    );
    expect(toolResult?.toolResult?.content).toContain('"targetEvidence"');
    expect(toolResult?.toolResult?.content).toContain(
      "Read-only Data Manager feed status",
    );
  });

  it("runs current DataStore fetch-status workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    const taskId = dataStore.createTask(
      "kline_daily",
      "600519",
      { start: "2026-06-01" },
      2,
    );
    const actionableId = dataStore.createTask(
      "screen_advanced",
      null,
      { symbols: ["600519"] },
      4,
    );
    dataStore.updateTaskStatus(
      actionableId,
      "failed",
      { progress: 100 },
      "provider timeout",
    );
    const missingCodeId = dataStore.createTask("fund_holding", null, {}, 5);
    dataStore.updateTaskStatus(
      missingCodeId,
      "failed",
      { progress: 100 },
      "code required",
    );
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "fetch-status",
              name: "DataStore",
              arguments: { action: "fetch_status", status: "all", limit: 10 },
            },
          ],
        },
        {
          text: "I inspected provider.fetch_task_queue and separated actionable failures from non-actionable evidence before deciding whether any fetch retry is needed.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-fetch-status-smoke",
      prompt:
        "Inspect the durable fetch task queue before retrying provider fetch work.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"interfaceId": "provider.fetch_task_queue"',
        '"capabilityId": "local.provider.fetch_task_queue"',
        '"canonicalSchema": "fetch_task_queue"',
        '"canonicalTable": "fetch_tasks"',
        '"readbackAction": "fetch_status"',
        '"actionableFailures": 1',
        '"nonActionableEvidence": 1',
        '"type": "kline_daily"',
        '"status": "pending"',
        '"type": "screen_advanced"',
        "data_health failureActionQueue",
        '"type": "fund_holding"',
        "Add task scope/code parameters",
      ],
      expectFinalContains: ["provider.fetch_task_queue", "actionable failures"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes("provider.fetch_task_queue"),
    );
    expect(toolResult?.toolResult?.content).toContain(`"id": ${taskId}`);
    expect(toolResult?.toolResult?.content).toContain(`"id": ${actionableId}`);
    expect(toolResult?.toolResult?.content).toContain(`"id": ${missingCodeId}`);
  });

  it("runs current DataStore cache-readback workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveQuoteSnapshots([
      {
        code: "600519",
        timestamp: "2026-06-25T09:30:00.000Z",
        fetched_at: "2026-06-25T09:31:00.000Z",
        source: "tdx",
        name: "贵州茅台",
        price: 1215,
        change_pct: 1.23,
        volume: 1000,
        amount: 1215000,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-quote",
              name: "DataStore",
              arguments: { action: "query_quote", code: "600519", limit: 1 },
            },
          ],
        },
        {
          text: "I reused local quote_snapshot cache for stock.quote before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-quote-smoke",
      prompt: "Reuse cached stock quote data before any live provider call.",
      expectTools: ["DataStore"],
      expectFinalContains: ["quote_snapshot cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find(
      (message) => message.toolResult,
    );
    expect(toolResult?.toolResult?.content).toContain("cacheStatus");
    expect(toolResult?.toolResult?.content).toContain("local-hit");
    expect(toolResult?.toolResult?.content).toContain("tdx");
  });

  it("runs current DataStore readback validation-error workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-quote-missing-code",
              name: "DataStore",
              arguments: { action: "query_quote", limit: 1 },
            },
          ],
        },
        {
          text: "I saw query_quote validation fail and will ask for a stock code before retrying the cache readback workflow.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-validation-error-smoke",
      prompt:
        "Try to reuse cached stock quote data without a stock code, then explain the validation error before retrying.",
      expectTools: ["DataStore"],
      expectToolErrors: ["code or codes required for query_quote"],
      expectFinalContains: ["validation fail", "stock code"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolError = result.run.messages.find(
      (message) => message.toolResult?.isError,
    );
    expect(toolError?.toolResult?.content).toContain(
      "code or codes required for query_quote",
    );
  });

  it("runs current DataStore finance news cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFinanceNews([
      {
        news_id: "workflow-news-1",
        title: "央行流动性工具维持市场稳定",
        summary: "公开市场操作保持资金面平稳。",
        publisher: "Workflow News",
        published_at: "2026-06-25T09:00:00.000Z",
        url: "https://example.test/news/workflow-news-1",
        source: "sina",
        fetched_at: "2026-06-25T09:02:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-finance-news",
              name: "DataStore",
              arguments: {
                action: "query_finance_news",
                keyword: "央行",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused local finance_news cache for news.finance_feed before considering any live news provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-finance-news-smoke",
      prompt: "Reuse cached finance news before any live news provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "news.finance_feed",
        "table:finance_news",
        "readback:query_finance_news",
        "sina",
        "央行流动性工具",
      ],
      expectFinalContains: ["finance_news cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore money-flow cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveMoneyFlow([
      {
        code: "600519",
        date: "2026-06-24",
        main_net: 123456789,
        small_net: -12000000,
        medium_net: 23000000,
        large_net: 45000000,
        super_large_net: 67456789,
        close_price: 1215.5,
        change_pct: 1.23,
        source: "eastmoney",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-money-flow",
              name: "DataStore",
              arguments: {
                action: "query_money_flow",
                code: "600519",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local money_flow cache for stock.money_flow before considering any live money-flow provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-money-flow-smoke",
      prompt:
        "Reuse cached stock money-flow data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.money_flow",
        "table:money_flow",
        "readback:query_money_flow",
        "cacheStatus:local-hit",
        "2026-06-24 Main:123456789 Large:45000000 Super:67456789",
      ],
      expectFinalContains: ["money_flow cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore chip-distribution cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveChipDistribution([
      {
        code: "600519",
        trade_date: "2026-06-24",
        avg_cost: 1176.5,
        profit_ratio: 0.684,
        concentration70: 12.3,
        concentration90: 18.9,
        current_price: 1215.5,
        method: "eastmoney-chip",
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-chip-distribution",
              name: "DataStore",
              arguments: {
                action: "query_chip",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local chip_distribution cache for stock.chip_distribution before considering any live chip provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-chip-distribution-smoke",
      prompt:
        "Reuse cached stock chip-distribution data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.chip_distribution",
        "table:chip_distribution",
        "readback:query_chip",
        "cacheStatus:local-hit",
        "2026-06-24 avg:1176.5 profit:0.684 conc70:12.3 conc90:18.9 price:1215.5",
      ],
      expectFinalContains: ["chip_distribution cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore unusual-activity cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveUnusualActivity([
      {
        event_date: "2026-06-24",
        code: "600519",
        event_time: "10:31:00",
        event_type: "大笔买入",
        name: "贵州茅台",
        info: "主力资金异动",
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-unusual-activity",
              name: "DataStore",
              arguments: {
                action: "query_unusual",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local unusual_activity cache for market.unusual_activity before considering any live unusual provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-unusual-activity-smoke",
      prompt:
        "Reuse cached unusual-activity data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.unusual_activity",
        "table:unusual_activity",
        "readback:query_unusual",
        "cacheStatus:local-hit",
        "2026-06-24 10:31:00 600519 贵州茅台 大笔买入 主力资金异动",
      ],
      expectFinalContains: ["unusual_activity cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore flow-rank cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFlowRank([
      {
        trade_date: "2026-06-24",
        period: "today",
        code: "600519",
        name: "贵州茅台",
        main_net: 123456789,
        main_pct: 3.21,
        super_large_net: 67456789,
        large_net: 45000000,
        medium_net: 23000000,
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-flow-rank",
              name: "DataStore",
              arguments: {
                action: "query_flow_rank",
                period: "today",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local flow_rank cache for market.flow_rank before considering any live flow-rank provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-flow-rank-smoke",
      prompt:
        "Reuse cached market flow-rank data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.flow_rank",
        "table:flow_rank",
        "readback:query_flow_rank",
        "cacheStatus:local-hit",
        "2026-06-24 today 600519 贵州茅台 main:123456789 mainPct:3.21 super:67456789 large:45000000 medium:23000000",
      ],
      expectFinalContains: ["flow_rank cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("routes broad DataStore money-flow readback to flow-rank cache when code is omitted", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFlowRank([
      {
        trade_date: "2026-06-24",
        period: "today",
        code: "600519",
        name: "贵州茅台",
        main_net: 123456789,
        main_pct: 3.21,
        super_large_net: 67456789,
        large_net: 45000000,
        medium_net: 23000000,
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-broad-money-flow",
              name: "DataStore",
              arguments: {
                action: "query_money_flow",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local flow_rank cache for the broad money-flow question.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-broad-money-flow-readback-routes-flow-rank-smoke",
      prompt:
        "Answer a broad market money-flow question from reusable local data.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.flow_rank",
        "table:flow_rank",
        "readback:query_flow_rank",
        "cacheStatus:local-hit",
        "2026-06-24 today 600519 贵州茅台 main:123456789 mainPct:3.21 super:67456789 large:45000000 medium:23000000",
      ],
      expectFinalContains: ["flow_rank cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore tick-chart cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveTickChartIntraday([
      {
        code: "600519",
        trade_date: "2026-06-24",
        time: "09:31:00",
        price: 1215.5,
        avg_price: 1214.8,
        volume: 3600,
        amount: 4375800,
        source: "tdx",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-tick-chart",
              name: "DataStore",
              arguments: {
                action: "query_tick_chart",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local tick_chart_intraday cache for stock.tick_chart_intraday before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-tick-chart-smoke",
      prompt: "Reuse cached TDX tick-chart data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.tick_chart_intraday",
        "table:tick_chart_intraday",
        "readback:query_tick_chart",
        "cacheStatus:local-hit",
        "2026-06-24 09:31:00 price:1215.5 avg:1214.8 vol:3600 amount:4375800",
      ],
      expectFinalContains: ["tick_chart_intraday cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore transactions cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveTransactions([
      {
        code: "600519",
        trade_date: "2026-06-24",
        time: "09:32:15",
        price: 1216,
        volume: 500,
        amount: 608000,
        direction: "B",
        source: "tdx",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-transactions",
              name: "DataStore",
              arguments: {
                action: "query_transactions",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local transactions cache for stock.transactions before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-transactions-smoke",
      prompt:
        "Reuse cached TDX transaction data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.transactions",
        "table:transactions",
        "readback:query_transactions",
        "cacheStatus:local-hit",
        "2026-06-24 09:32:15 price:1216 vol:500 dir:B amount:608000",
      ],
      expectFinalContains: ["transactions cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore volume-profile cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveVolumeProfile([
      {
        code: "600519",
        trade_date: "2026-06-24",
        price: 1215.5,
        volume: 3600,
        pct: 12.5,
        source: "tdx",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-volume-profile",
              name: "DataStore",
              arguments: {
                action: "query_volume_profile",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local volume_profile cache for stock.volume_profile before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-volume-profile-smoke",
      prompt:
        "Reuse cached TDX volume-profile data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.volume_profile",
        "table:volume_profile",
        "readback:query_volume_profile",
        "cacheStatus:local-hit",
        "2026-06-24 price:1215.5 vol:3600 pct:12.5",
      ],
      expectFinalContains: ["volume_profile cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore XDXR cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveXdxrEvents([
      {
        code: "600519",
        event_date: "2026-06-20",
        category: 1,
        category_name: "除权除息",
        a: 1.2,
        b: 0.5,
        c: 0,
        d: 0,
        source: "tdx",
        fetched_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-xdxr",
              name: "DataStore",
              arguments: {
                action: "query_xdxr",
                code: "600519",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local xdxr_event cache for stock.xdxr_events before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-xdxr-smoke",
      prompt: "Reuse cached XDXR data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.xdxr_events",
        "table:xdxr_event",
        "readback:query_xdxr",
        "cacheStatus:local-hit",
        "2026-06-20 cat:1 除权除息 a:1.2 b:0.5 c:0 d:0",
      ],
      expectFinalContains: ["xdxr_event cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore auction cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveAuctionSnapshots([
      {
        code: "600519",
        trade_date: "2026-06-24",
        time: "09:25:00",
        sequence: 1,
        price: 1210.5,
        volume: 1200,
        source: "tdx",
        fetched_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-auction",
              name: "DataStore",
              arguments: {
                action: "query_auction",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local auction_snapshot cache for stock.auction_snapshot before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-auction-smoke",
      prompt: "Reuse cached auction data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.auction_snapshot",
        "table:auction_snapshot",
        "readback:query_auction",
        "cacheStatus:local-hit",
        "2026-06-24 09:25:00 price:1210.5 volume:1200 seq:1",
      ],
      expectFinalContains: ["auction_snapshot cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore index-momentum cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveIndexMomentumRows([
      {
        code: "000001",
        trade_date: "2026-06-24",
        sequence: 1,
        value: 12.34,
        source: "tdx",
        fetched_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-momentum",
              name: "DataStore",
              arguments: {
                action: "query_momentum",
                code: "000001",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local tdx_index_momentum cache for index.momentum before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-momentum-smoke",
      prompt: "Reuse cached TDX index momentum before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "index.momentum",
        "table:tdx_index_momentum",
        "readback:query_momentum",
        "cacheStatus:local-hit",
        "2026-06-24 seq:1 value:12.34",
      ],
      expectFinalContains: ["tdx_index_momentum cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore TDX top-board cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveTopBoardRows([
      {
        board_date: "2026-06-24",
        category: "0",
        side: "increase",
        rank: 1,
        code: "600519",
        market: 1,
        price: 1218.5,
        value: 9.87,
        source: "tdx",
        fetched_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-top-board",
              name: "DataStore",
              arguments: {
                action: "query_top_board",
                code: "600519",
                category: "0",
                side: "increase",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local tdx_top_board cache for market.tdx_top_board before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-top-board-smoke",
      prompt: "Reuse cached TDX top-board data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.tdx_top_board",
        "table:tdx_top_board",
        "readback:query_top_board",
        "cacheStatus:local-hit",
        "2026-06-24 0 increase #1 600519 price:1218.5 value:9.87 market:1",
      ],
      expectFinalContains: ["tdx_top_board cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore TDX block-member cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveTdxBlockMembers([
      {
        block_code: "block_zs.dat:白酒",
        block_name: "白酒",
        code: "600519",
        name: "贵州茅台",
        block_type: "custom",
        source: "tdx",
        updated_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-block-member",
              name: "DataStore",
              arguments: {
                action: "query_tdx_block_member",
                code: "600519",
                block_code: "block_zs.dat:白酒",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local tdx_block_member cache for market.tdx_block_member before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-tdx-block-member-smoke",
      prompt:
        "Reuse cached TDX block-member data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.tdx_block_member",
        "table:tdx_block_member",
        "readback:query_tdx_block_member",
        "cacheStatus:local-hit",
        "block_zs.dat:白酒 白酒 -> 600519 贵州茅台 [custom]",
      ],
      expectFinalContains: ["tdx_block_member cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore stock company-info cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveStockCompanyInfo([
      {
        code: "600519",
        info_type: "company_info",
        title: "公司简介",
        content: "贵州茅台主营高端白酒生产销售。",
        source: "tdx",
        updated_at: "2026-06-24T07:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-stock-company-info",
              name: "DataStore",
              arguments: {
                action: "query_stock_company_info",
                code: "600519",
                type: "company_info",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local stock_company_info cache for stock.company_info before considering any live TDX provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-stock-company-info-smoke",
      prompt:
        "Reuse cached stock company-info data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.company_info",
        "table:stock_company_info",
        "readback:query_stock_company_info",
        "cacheStatus:local-hit",
        "company_info 公司简介: 贵州茅台主营高端白酒生产销售。",
      ],
      expectFinalContains: ["stock_company_info cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore trade-calendar cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveCalendar([
      {
        date: "2026-06-24",
        market: "CN",
        is_trading_day: 1,
        year: 2026,
        month: 6,
      },
      {
        date: "2026-06-25",
        market: "CN",
        is_trading_day: 1,
        year: 2026,
        month: 6,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-trade-calendar",
              name: "DataStore",
              arguments: {
                action: "query_trade_calendar",
                market: "CN",
                start: "2026-06-24",
                end: "2026-06-25",
                limit: 2,
              },
            },
          ],
        },
        {
          text: "I reused local trade_calendar cache for calendar.trade_days before considering any live calendar provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-trade-calendar-smoke",
      prompt:
        "Reuse cached trade calendar data before any live calendar provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "calendar.trade_days",
        "table:trade_calendar",
        "readback:query_trade_calendar",
        "cacheStatus:local-hit",
        "2026-06-25 CN open",
      ],
      expectFinalContains: ["trade_calendar cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore index-constituents cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveIndexConstituents([
      {
        index_code: "000300",
        stock_code: "600519",
        stock_name: "贵州茅台",
        weight: 5.12,
        as_of_date: "2026-06-18",
        provider: "akshare",
        capability_id: "akshare.index.constituents",
        source_action: "index_stock_cons",
        fetched_at: "2026-06-18T08:00:00.000Z",
        raw_json: null,
      },
      {
        index_code: "000300",
        stock_code: "000001",
        stock_name: "平安银行",
        weight: 0.56,
        as_of_date: "2026-06-18",
        provider: "akshare",
        capability_id: "akshare.index.constituents",
        source_action: "index_stock_cons",
        fetched_at: "2026-06-18T08:00:00.000Z",
        raw_json: null,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-index-constituents",
              name: "DataStore",
              arguments: {
                action: "query_index_constituents",
                indexCode: "000300",
                stockCode: "600519",
                provider: "akshare",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local index_constituent cache for index.constituents before considering any live index provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-index-constituents-smoke",
      prompt:
        "Reuse cached CSI300 constituent data before any live index provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "index.constituents",
        "table:index_constituent",
        "readback:query_index_constituents",
        "akshare",
        "600519 贵州茅台",
      ],
      expectFinalContains: ["index_constituent cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore stock-identity cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveStockList([
      {
        code: "600519",
        name: "贵州茅台",
        market: "SH",
        industry: "白酒",
        list_date: "2001-08-27",
        delist_date: null,
        stock_type: "stock",
        updated_at: "2026-06-18T08:00:00.000Z",
      },
      {
        code: "000001",
        name: "平安银行",
        market: "SZ",
        industry: "银行",
        list_date: "1991-04-03",
        delist_date: null,
        stock_type: "stock",
        updated_at: "2026-06-18T08:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-stock-identity",
              name: "DataStore",
              arguments: {
                action: "stock_list",
                market: "SH",
                industry: "白酒",
              },
            },
          ],
        },
        {
          text: "I reused local stock_list cache for stock.identity_list before considering any live stock identity provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-stock-identity-smoke",
      prompt:
        "Reuse cached stock identity data before any live stock-list provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.identity_list",
        "table:stock_list",
        "readback:stock_list",
        "600519 贵州茅台",
      ],
      expectFinalContains: ["stock_list cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore sector-ranking cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveSectorRanking("2026-06-24", "industry", [
      {
        code: "BK0475",
        name: "白酒",
        change_pct: 2.34,
        turnover_rate: 1.2,
        up_count: 18,
        down_count: 3,
        leading_stock: "贵州茅台",
        leading_pct: 5.6,
        rank: 1,
        source: "eastmoney",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-sector-ranking",
              name: "DataStore",
              arguments: {
                action: "query_sector_ranking",
                type: "industry",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local sector_ranking cache for market.sector_ranking before considering any live sector provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-sector-ranking-smoke",
      prompt:
        "Reuse cached sector ranking data before any live sector provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.sector_ranking",
        "table:sector_ranking",
        "readback:query_sector_ranking",
        "白酒",
        "cacheStatus:local-hit",
      ],
      expectFinalContains: ["sector_ranking cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore limit-pool cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveLimitPool([
      {
        date: "2026-06-24",
        code: "600519",
        name: "贵州茅台",
        limit_type: "limit_up",
        change_pct: 10.01,
        first_limit_time: "09:45:00",
        last_limit_time: "14:55:00",
        open_count: 1,
        limit_reason: "白酒涨停",
        continuous_days: 1,
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-limit-pool",
              name: "DataStore",
              arguments: {
                action: "query_limit_pool",
                date: "2026-06-24",
                type: "limit_up",
              },
            },
          ],
        },
        {
          text: "I reused local limit_pool cache for market.limit_pool before considering any live limit-pool provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-limit-pool-smoke",
      prompt:
        "Reuse cached limit-pool data before any live limit-pool provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.limit_pool",
        "table:limit_pool",
        "readback:query_limit_pool",
        "cacheStatus:local-hit",
        "600519 贵州茅台 limit_up 10.01% 白酒涨停",
      ],
      expectFinalContains: ["limit_pool cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore hot-rank cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveHotRank([
      {
        date: "2026-06-24",
        code: "600519",
        name: "贵州茅台",
        rank: 1,
        heat: 987654,
        rank_change: 3,
        source: "eastmoney",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-hot-rank",
              name: "DataStore",
              arguments: {
                action: "query_hot_rank",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local hot_rank cache for market.hot_rank before considering any live hot-rank provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-hot-rank-smoke",
      prompt:
        "Reuse cached hot-rank data before any live hot-rank provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.hot_rank",
        "table:hot_rank",
        "readback:query_hot_rank",
        "cacheStatus:local-hit",
        "600519 贵州茅台 heat:987654 change:3",
      ],
      expectFinalContains: ["hot_rank cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore dragon-tiger cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveDragonTiger([
      {
        date: "2026-06-24",
        code: "600519",
        name: "贵州茅台",
        reason: "日涨幅偏离值达7%",
        buy_amt: 125000000,
        sell_amt: 64000000,
        net_amt: 61000000,
        accum_amount: 189000000,
        source: "eastmoney",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-dragon-tiger",
              name: "DataStore",
              arguments: {
                action: "query_dragon_tiger",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local dragon_tiger cache for market.dragon_tiger before considering any live dragon-tiger provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-dragon-tiger-smoke",
      prompt:
        "Reuse cached dragon-tiger data before any live dragon-tiger provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.dragon_tiger",
        "table:dragon_tiger",
        "readback:query_dragon_tiger",
        "cacheStatus:local-hit",
        "600519 贵州茅台 日涨幅偏离值达7% net:61000000",
      ],
      expectFinalContains: ["dragon_tiger cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore northbound-flow cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveNorthboundFlow([
      {
        trade_date: "2026-06-24",
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
        mutual_type: "northbound",
        buy_amount: 1200000000,
        sell_amount: 850000000,
        net_buy: 350000000,
        hold_market_cap: 234500000000,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-northbound-flow",
              name: "DataStore",
              arguments: {
                action: "query_northbound_flow",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local northbound_flow cache for market.northbound_flow before considering any live northbound provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-northbound-flow-smoke",
      prompt:
        "Reuse cached northbound-flow data before any live northbound provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.northbound_flow",
        "table:northbound_flow",
        "readback:query_northbound_flow",
        "cacheStatus:local-hit",
        "2026-06-24 northbound buy:1200000000 sell:850000000 net:350000000",
      ],
      expectFinalContains: ["northbound_flow cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore northbound-holding cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveNorthboundHolding([
      {
        trade_date: "2026-06-24",
        code: "600519",
        name: "贵州茅台",
        hold_market_cap: 23450000000,
        hold_ratio: 7.89,
        source: "eastmoney",
        fetched_at: "2026-06-24T07:00:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-northbound-holding",
              name: "DataStore",
              arguments: {
                action: "query_northbound_holding",
                code: "600519",
                date: "2026-06-24",
                limit: 5,
              },
            },
          ],
        },
        {
          text: "I reused local northbound_holding cache for market.northbound_holding before considering any live northbound provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-northbound-holding-smoke",
      prompt:
        "Reuse cached northbound-holding data before any live northbound provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "market.northbound_holding",
        "table:northbound_holding",
        "readback:query_northbound_holding",
        "cacheStatus:local-hit",
        "2026-06-24 600519 贵州茅台 holdMCap:23450000000 holdRatio:7.89%",
      ],
      expectFinalContains: ["northbound_holding cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore fund NAV cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFundNav([
      {
        code: "110022",
        date: "2026-06-24",
        nav: 1.2345,
        acc_nav: 2.3456,
        daily_return: 0.12,
        source: "eastmoney",
        fetched_at: "2026-06-24T15:31:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-fund-nav",
              name: "DataStore",
              arguments: {
                action: "query_fund_nav",
                code: "110022",
                start: "2026-06-24",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused local fund_nav cache for fund.nav_history before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-fund-nav-smoke",
      prompt: "Reuse cached fund NAV data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "fund.nav_history",
        "table:fund_nav",
        "readback:query_fund_nav",
        "eastmoney",
        "110022 fund NAV",
      ],
      expectFinalContains: ["fund_nav cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore money-fund yield cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFundMoneyYield([
      {
        code: "000009",
        date: "2026-06-24",
        million_copies_income: 0.4567,
        seven_day_annualized_yield: 1.89,
        source: "eastmoney",
        fetched_at: "2026-06-24T15:32:00.000Z",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-money-yield",
              name: "DataStore",
              arguments: {
                action: "query_fund_money_yield",
                code: "000009",
                start: "2026-06-24",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused local fund_money_yield cache for fund.money_yield_history before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-fund-money-yield-smoke",
      prompt:
        "Reuse cached money-fund yield data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "fund.money_yield_history",
        "table:fund_money_yield",
        "readback:query_fund_money_yield",
        "eastmoney",
        "000009 money fund yield",
      ],
      expectFinalContains: ["fund_money_yield cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore fund holding cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveFundHolding([
      {
        fund_code: "110022",
        report_date: "2026-03-31",
        stock_code: "600519",
        stock_name: "贵州茅台",
        hold_shares: 1200,
        hold_value: 1458000,
        hold_pct: 8.91,
        rank: 1,
        source: "eastmoney",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-local-fund-holding",
              name: "DataStore",
              arguments: {
                action: "query_fund_holding",
                fundCode: "110022",
                reportDate: "2026-03-31",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused local fund_holding cache for fund.holding before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-cache-readback-fund-holding-smoke",
      prompt: "Reuse cached fund holding data before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "fund.holding",
        "table:fund_holding",
        "readback:query_fund_holding",
        "eastmoney",
        "600519",
      ],
      expectFinalContains: ["fund_holding cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore strict-provider cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveQuoteSnapshots([
      {
        code: "600519",
        timestamp: "2026-06-25T09:30:00.000Z",
        fetched_at: "2026-06-25T09:31:00.000Z",
        source: "tdx",
        name: "贵州茅台",
        price: 1215,
        change_pct: 1.23,
        volume: 1000,
        amount: 1215000,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-strict-local-quote",
              name: "DataStore",
              arguments: {
                action: "query_quote",
                code: "600519",
                provider: "tdx",
                providerMode: "strict",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused strict tdx quote_snapshot cache before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-strict-cache-readback-quote-smoke",
      prompt:
        "Reuse cached TDX stock quote data under strict provider mode before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "providerFilter:tdx",
        "providerMode:strict",
        "cacheSourceFilter:tdx",
        "sourceProviders:tdx",
        "cacheStatus:local-hit",
      ],
      expectFinalContains: ["strict tdx quote_snapshot cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore strict Tencent global quote workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveQuoteSnapshots([
      {
        code: "hk00700",
        timestamp: "2026-06-25T09:30:00.000Z",
        fetched_at: "2026-06-25T09:31:00.000Z",
        source: "tencent",
        name: "腾讯控股",
        price: 421.4,
        change_pct: -1.73,
        volume: 1000,
        amount: 421400,
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-strict-tencent-global-quote",
              name: "DataStore",
              arguments: {
                action: "query_quote",
                code: "hk00700",
                provider: "tencent",
                providerMode: "strict",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused strict Tencent global quote_snapshot cache for stock.quote before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-strict-cache-readback-tencent-global-quote-smoke",
      prompt:
        "Reuse cached Tencent HK quote data under strict provider mode before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "providerFilter:tencent",
        "providerMode:strict",
        "cacheSourceFilter:tencent",
        "sourceProviders:tencent",
        "cacheStatus:local-hit",
        "hk00700",
      ],
      expectFinalContains: ["strict Tencent global quote_snapshot cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current DataStore strict-provider K-line cache-readback workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveKline([
      {
        code: "600519",
        date: "2026-06-25",
        open: 1200,
        high: 1220,
        low: 1198,
        close: 1215,
        volume: 1000,
        amount: 1215000,
        change_pct: 1.23,
        turnover_rate: null,
        adjust: "none",
        source: "tdx",
      },
    ]);
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "query-strict-local-kline",
              name: "DataStore",
              arguments: {
                action: "query_kline",
                code: "600519",
                adjust: "none",
                provider: "tdx",
                providerMode: "strict",
                limit: 1,
              },
            },
          ],
        },
        {
          text: "I reused strict tdx kline_daily cache before considering any live provider refresh.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-strict-cache-readback-kline-smoke",
      prompt:
        "Reuse cached TDX daily K-line data under strict provider mode before any live provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"providerFilter": "tdx"',
        '"providerMode": "strict"',
        '"cacheSourceFilter": "tdx"',
        '"sourceProviders": [',
        '"cacheStatus": "local-hit"',
      ],
      expectFinalContains: ["strict tdx kline_daily cache"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("runs current DataStore runtime-probe status workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "runtime-probe-status",
              name: "DataStore",
              arguments: { action: "runtime_probe", probeAction: "status" },
            },
          ],
        },
        {
          text: "I inspected runtime probe status before deciding whether a bounded live probe is needed.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-runtime-probe-status-smoke",
      prompt:
        "Inspect controlled runtime probe status before running any provider probe.",
      expectTools: ["DataStore"],
      expectFinalContains: ["runtime probe status"],
      expectPanelStateKeys: ["0.id"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes('"action": "runtime_probe"'),
    );
    expect(toolResult?.toolResult?.content).toContain(
      '"probeAction": "status"',
    );
    expect(toolResult?.toolResult?.content).toContain('"availableModes"');
    expect(toolResult?.toolResult?.content).toContain('"recommendedTargets"');
    expect(toolResult?.toolResult?.content).toContain('"sourceQueue"');
  });

  it("runs current DataStore runtime-probe empty execution workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "runtime-probe-empty-run",
              name: "DataStore",
              arguments: {
                action: "runtime_probe",
                probeAction: "run",
                probeMode: "failures",
              },
            },
          ],
        },
        {
          text: "I ran the bounded runtime probe workflow and found no selected provider probe targets.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-runtime-probe-empty-run-smoke",
      prompt:
        "Run a bounded runtime probe check only when current health has selected targets.",
      expectTools: ["DataStore"],
      expectToolResultContains: ['"probeAction": "run"', '"selectedCount": 0'],
      expectFinalContains: ["bounded runtime probe workflow"],
      expectPanelStateKeys: ["0.id"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes('"probeAction": "run"'),
    );
    expect(toolResult?.toolResult?.content).toContain('"selectedProbeIds": []');
    expect(toolResult?.toolResult?.content).toContain('"summary": {');
    expect(toolResult?.toolResult?.content).toContain('"total": 0');
  });

  it("runs current DataStore runtime-probe positive fixture workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "runtime-probe-fixture-run",
              name: "DataStore",
              arguments: {
                action: "runtime_probe",
                probeAction: "run",
                probeMode: "all",
                probeIds: ["fixture.positive_probe"],
              },
            },
          ],
        },
        {
          text: "I ran one bounded runtime probe fixture and persisted positive probe evidence.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-runtime-probe-fixture-run-smoke",
      prompt:
        "Run one explicit bounded runtime probe fixture and inspect persisted evidence.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"probeAction": "run"',
        '"selectedCount": 1',
        '"fixture.positive_probe"',
        '"passed": 1',
      ],
      expectFinalContains: ["positive probe evidence"],
      expectPanelStateKeys: ["0.id"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes("fixture.positive_probe"),
    );
    expect(toolResult?.toolResult?.content).toContain('"liveStatusPath"');
    const liveStatusPath = join(
      basePath,
      "data",
      "runtime-probes",
      "live-status",
      "latest.json",
    );
    expect(existsSync(liveStatusPath)).toBe(true);
    expect(readFileSync(liveStatusPath, "utf-8")).toContain('"fixture": true');
  });

  it("runs current DataStore explicit blocked runtime-probe workflow without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = "1";
    const liveStatusDir = join(
      basePath,
      "data",
      "runtime-probes",
      "live-status",
    );
    mkdirSync(liveStatusDir, { recursive: true });
    writeFileSync(
      join(liveStatusDir, "latest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: { total: 1, passed: 0, failed: 1, blocked: 0 },
          passedApis: [],
          failures: [
            {
              id: "tushare.permission_probe",
              provider: "tushare",
              status: "failed",
              validationState: "credential-gated",
              failureClass: "credential-or-permission",
              error: "endpoint permission denied",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "runtime-probe-explicit-blocked-run",
              name: "DataStore",
              arguments: {
                action: "runtime_probe",
                probeAction: "run",
                probeMode: "all",
                probeIds: ["tushare.permission_probe"],
              },
            },
          ],
        },
        {
          text: "I ran the explicitly selected blocked runtime probe as a bounded diagnostic and preserved its blocked target context.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-runtime-probe-explicit-blocked-smoke",
      prompt:
        "Run the explicitly selected blocked Tushare runtime probe as a bounded diagnostic and preserve blocked context.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        '"probeAction": "run"',
        '"selectedCount": 1',
        '"tushare.permission_probe"',
        '"sourceQueue": "failureActionQueue"',
        "Blocked from runtime_probe retry selection",
        "credential or permission",
      ],
      expectFinalContains: ["blocked target context"],
      expectPanelStateKeys: ["0.id"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes("tushare.permission_probe"),
    );
    expect(toolResult?.toolResult?.content).toContain('"selectedTargets"');
    expect(toolResult?.toolResult?.content).toContain(
      '"expectedExitCondition"',
    );
    expect(toolResult?.toolResult?.content).toContain('"riskPolicy"');
  });

  it("runs current DataStore API-health failure workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dataStore = new DataStore(basePath);
    await dataStore.init();
    dataStore.saveApiCall({
      source: "eastmoney",
      provider: "eastmoney",
      interface_id: "market.hot_rank",
      capability_id: "eastmoney.market.hot_rank",
      tool: "DataStore",
      action: "hot_rank",
      endpoint: "/api/qt/clist/get",
      status: 0,
      success: false,
      duration_ms: 120000,
      error: "The operation was aborted due to timeout",
    });
    const tool = new DataStoreTool();
    tool.setDataStore(dataStore);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "data-health-failures",
              name: "DataStore",
              arguments: {
                action: "data_health",
                section: "failures",
                limit: 2,
              },
            },
          ],
        },
        {
          text: "I inspected API Health failure actions before deciding whether retry or probe is appropriate.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-api-health-failure-smoke",
      prompt:
        "Inspect API Health failure actions before retrying a provider route.",
      expectTools: ["DataStore"],
      expectFinalContains: ["API Health failure actions"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolResult = result.run.messages.find((message) =>
      message.toolResult?.content.includes('"failureActionQueue"'),
    );
    expect(toolResult?.toolResult?.content).toContain('"failureClass"');
    expect(toolResult?.toolResult?.content).toContain('"cacheDecision"');
  });

  it("runs current DataStore runtime provider block workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const liveStatusDir = join(
      basePath,
      "data",
      "runtime-probes",
      "live-status",
    );
    mkdirSync(liveStatusDir, { recursive: true });
    writeFileSync(
      join(liveStatusDir, "latest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: { total: 1, passed: 0, failed: 1, blocked: 0 },
          passedApis: [],
          failures: [
            {
              id: "electron_tdx_quote",
              provider: "tdx",
              status: "failed",
              validationState: "runtime-blocked",
              failureClass: "transport",
              temporaryBlockUntil: future,
              routeBlockScope: "capability",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
    const tool = new DataStoreTool();
    tool.setDataStore(new DataStore(basePath));
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "interface-availability-temporary-block",
              name: "DataStore",
              arguments: {
                action: "interface_availability",
                interfaceId: "stock.quote",
                provider: "tdx",
                providerMode: "strict",
              },
            },
          ],
        },
        {
          text: "I inspected interface availability and saw runtime evidence temporarily blocks the requested provider route.",
        },
      ]),
      [tool],
    );

    const result = await control.runScenario({
      id: "electron-runtime-provider-block-smoke",
      prompt:
        "Check whether strict TDX stock.quote routing is temporarily blocked before any provider call.",
      expectTools: ["DataStore"],
      expectToolResultContains: [
        "stock.quote",
        "temporarily-blocked",
        "temporaryBlockUntil",
        "runtime-blocked",
      ],
      expectFinalContains: ["temporarily blocks"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current Watchlist summary workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    writeFileSync(
      join(basePath, "watchlists.json"),
      JSON.stringify(
        {
          groups: [{ id: "stock-watch", name: "Stock Watch", type: "stock" }],
          items: [
            {
              id: "watch-600519",
              groupId: "stock-watch",
              symbol: "SH600519",
              name: "Kweichow Moutai",
              type: "stock",
              status: "watching",
              source: "workflow-fixture",
              tags: ["core-holding"],
              priceAtAdd: 1200,
              addedAt: "2026-06-25T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "watchlist-summary",
              name: "Watchlist",
              arguments: { action: "summary" },
            },
          ],
        },
        {
          text: "I inspected the Watchlist summary before deciding whether any refresh or mutation is needed.",
        },
      ]),
      [new WatchlistTool()],
      async () => ({
        activePanel: "watchlist",
        watchlistVisible: true,
        watchlistItemCount: 1,
      }),
    );

    const result = await control.runScenario({
      id: "electron-watchlist-summary-smoke",
      prompt:
        "Inspect the current watchlist before deciding whether to refresh or mutate it.",
      expectTools: ["Watchlist"],
      expectToolResultContains: ['"total": 1', '"watching": 1'],
      expectFinalContains: ["Watchlist summary"],
      expectPanelStateKeys: [
        "activePanel",
        "watchlistVisible",
        "watchlistItemCount",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "watchlist",
      watchlistVisible: true,
      watchlistItemCount: 1,
    });
  });

  it("runs current Watchlist add validation-error workflow scenario without mutation", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    writeFileSync(
      join(basePath, "watchlists.json"),
      JSON.stringify(
        {
          groups: [{ id: "stock-watch", name: "Stock Watch", type: "stock" }],
          items: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "watchlist-add-missing-symbol",
              name: "Watchlist",
              arguments: { action: "add", groupId: "stock-watch" },
            },
          ],
        },
        {
          text: "I saw Watchlist(add) validation fail and will ask for a symbol before mutating the watchlist.",
        },
      ]),
      [new WatchlistTool()],
      async () => ({
        activePanel: "watchlist",
        watchlistVisible: true,
        watchlistItemCount: 0,
      }),
    );

    const result = await control.runScenario({
      id: "electron-watchlist-add-validation-error-smoke",
      prompt:
        "Try to add a watchlist item without a symbol, then explain the validation error before changing the watchlist.",
      expectTools: ["Watchlist"],
      expectToolErrors: ["symbol required"],
      expectFinalContains: ["validation fail", "symbol", "watchlist"],
      expectPanelStateKeys: [
        "activePanel",
        "watchlistVisible",
        "watchlistItemCount",
      ],
    });

    expect(result.ok).toBe(true);
    const toolError = result.run.messages.find(
      (message) => message.toolResult?.isError,
    );
    expect(toolError?.toolResult?.content).toContain("symbol required");
    const persisted = JSON.parse(
      readFileSync(join(basePath, "watchlists.json"), "utf-8"),
    );
    expect(persisted.items).toHaveLength(0);
  });

  it("runs current Portfolio paper-trade workflow scenario without broker side effects", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "portfolio-paper-buy",
              name: "Portfolio",
              arguments: {
                action: "trade",
                market: "cn",
                symbol: "600519",
                side: "buy",
                shares: 100,
                price: 1200,
              },
            },
          ],
        },
        {
          text: "I recorded a paper portfolio trade only; no Xueqiu or real broker order was sent.",
        },
      ]),
      [new PortfolioTool()],
      async () => ({
        activePanel: "portfolio",
        portfolioMode: "paper",
        brokerSideEffect: false,
      }),
    );

    const result = await control.runScenario({
      id: "electron-portfolio-paper-trade-smoke",
      prompt:
        "Record a local paper portfolio buy and confirm no real broker or Xueqiu order is sent.",
      expectTools: ["Portfolio"],
      expectToolResultContains: ["600519", "1200"],
      expectFinalContains: ["paper portfolio trade", "no Xueqiu"],
      expectPanelStateKeys: [
        "activePanel",
        "portfolioMode",
        "brokerSideEffect",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "portfolio",
      portfolioMode: "paper",
      brokerSideEffect: false,
    });
    const portfolioPath = join(basePath, "memory", ".portfolio_cn.json");
    expect(existsSync(portfolioPath)).toBe(true);
    const portfolio = JSON.parse(readFileSync(portfolioPath, "utf-8"));
    expect(portfolio.positions["600519"].shares).toBe(100);
    expect(portfolio.trades).toHaveLength(1);
  });

  it("runs current UIControl panel workflow scenario with session and panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const uiState = {
      activePanel: "chat",
      lastUiAction: null as null | string,
      provenancePanelVisible: false,
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "ui-open-panel") {
        uiState.activePanel = String(event.id ?? "unknown");
        uiState.provenancePanelVisible = true;
      }
    });
    uiTool.setPanelQuery(async () => [
      {
        id: uiState.activePanel,
        title: "API Health",
        url: "app://api-health",
        type: "api-health",
        isActive: uiState.provenancePanelVisible,
      },
    ]);
    uiTool.setRequestHandler(async (request) => {
      uiState.lastUiAction = String(
        request.action ?? request.type ?? "renderer-request",
      );
      return JSON.stringify({
        ok: true,
        handled: request.action ?? request.type,
      });
    });
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-api-health-panel",
              name: "UIControl",
              arguments: {
                action: "openPanel",
                params: {
                  id: "api-health",
                  panelType: "api-health",
                  title: "API Health",
                  url: "app://api-health",
                },
              },
            },
          ],
        },
        {
          text: "I opened the API Health panel and checked the panel evidence before explaining provenance.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-api-health-panel-smoke",
      prompt: "Open API Health before explaining data provenance status.",
      expectTools: ["UIControl"],
      expectFinalContains: ["API Health panel"],
      expectPanelStateKeys: ["activePanel", "provenancePanelVisible"],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "api-health",
      provenancePanelVisible: true,
    });
    const toolResult = result.run.messages.find(
      (message) =>
        message.toolResult?.content.includes('"action":"openPanel"') ||
        message.toolResult?.content.includes('"action": "openPanel"'),
    );
    expect(toolResult?.toolResult?.content).toContain('"observed":true');
  });

  it("runs current UIControl Data Manager panel workflow scenario with panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const uiState = {
      activePanel: "chat",
      lastUiAction: null as null | string,
      dataManagerVisible: false,
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "ui-open-panel") {
        uiState.activePanel = String(event.id ?? "unknown");
        uiState.dataManagerVisible = true;
      }
    });
    uiTool.setPanelQuery(async () => [
      {
        id: uiState.activePanel,
        title: "Data Manager",
        url: "app://data-manager",
        type: "data",
        isActive: uiState.dataManagerVisible,
      },
    ]);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-data-manager-panel",
              name: "UIControl",
              arguments: {
                action: "openPanel",
                params: {
                  id: "data",
                  panelType: "data",
                  title: "Data Manager",
                  url: "app://data-manager",
                },
              },
            },
          ],
        },
        {
          text: "I opened the Data Manager panel before deciding whether a prefetch or cache readback is needed.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-data-manager-panel-smoke",
      prompt:
        "Open Data Manager before deciding whether to prefetch or reuse cache.",
      expectTools: ["UIControl"],
      expectToolResultContains: ['"action":"openPanel"', '"observed":true'],
      expectFinalContains: ["Data Manager panel"],
      expectPanelStateKeys: ["activePanel", "dataManagerVisible"],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "data",
      dataManagerVisible: true,
    });
  });

  it("runs current UIControl Market Pulse panel workflow scenario with panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const uiState = {
      activePanel: "chat",
      lastUiAction: null as null | string,
      marketPulseVisible: false,
      dataQualityBlockVisible: false,
      cacheStatus: "local-first",
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "ui-open-panel") {
        uiState.activePanel = String(event.id ?? "unknown");
        uiState.marketPulseVisible = true;
        uiState.dataQualityBlockVisible = true;
      }
    });
    uiTool.setPanelQuery(async () => [
      {
        id: uiState.activePanel,
        title: "Stock Market Pulse",
        url: "app://market-pulse",
        type: "pulse",
        isActive: uiState.marketPulseVisible,
        cacheStatus: uiState.cacheStatus,
        dataQualityBlockVisible: uiState.dataQualityBlockVisible,
      },
    ]);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-market-pulse-panel",
              name: "UIControl",
              arguments: {
                action: "openPanel",
                params: {
                  id: "pulse",
                  panelType: "pulse",
                  title: "Stock Market Pulse",
                  url: "app://market-pulse",
                },
              },
            },
          ],
        },
        {
          text: "I opened the Market Pulse panel and checked cached data-quality evidence before any live refresh.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-market-pulse-panel-smoke",
      prompt:
        "Open Market Pulse and inspect panel provenance before any live refresh.",
      expectTools: ["UIControl"],
      expectToolResultContains: ['"action":"openPanel"', '"observed":true'],
      expectFinalContains: ["Market Pulse panel"],
      expectPanelStateKeys: [
        "activePanel",
        "marketPulseVisible",
        "dataQualityBlockVisible",
        "cacheStatus",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "pulse",
      marketPulseVisible: true,
      dataQualityBlockVisible: true,
      cacheStatus: "local-first",
    });
  });

  it("runs current UIControl Fund Pulse panel workflow scenario with panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const uiState = {
      activePanel: "chat",
      lastUiAction: null as null | string,
      fundPulseVisible: false,
      fundDataQualityVisible: false,
      cacheStatus: "local-first",
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "ui-open-panel") {
        uiState.activePanel = String(event.id ?? "unknown");
        uiState.fundPulseVisible = true;
        uiState.fundDataQualityVisible = true;
      }
    });
    uiTool.setPanelQuery(async () => [
      {
        id: uiState.activePanel,
        title: "Fund Pulse",
        url: "app://fund-pulse",
        type: "fund-pulse",
        isActive: uiState.fundPulseVisible,
        cacheStatus: uiState.cacheStatus,
        dataQualityVisible: uiState.fundDataQualityVisible,
      },
    ]);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-fund-pulse-panel",
              name: "UIControl",
              arguments: {
                action: "openPanel",
                params: {
                  id: "fund-pulse",
                  panelType: "fund-pulse",
                  title: "Fund Pulse",
                  url: "app://fund-pulse",
                },
              },
            },
          ],
        },
        {
          text: "I opened the Fund Pulse panel and checked cached fund data-quality evidence before any live refresh.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-fund-pulse-panel-smoke",
      prompt:
        "Open Fund Pulse and inspect fund panel provenance before any live refresh.",
      expectTools: ["UIControl"],
      expectToolResultContains: ['"action":"openPanel"', '"observed":true'],
      expectFinalContains: ["Fund Pulse panel"],
      expectPanelStateKeys: [
        "activePanel",
        "fundPulseVisible",
        "fundDataQualityVisible",
        "cacheStatus",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "fund-pulse",
      fundPulseVisible: true,
      fundDataQualityVisible: true,
      cacheStatus: "local-first",
    });
  });

  it("runs current UIControl News panel workflow scenario with panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const uiState = {
      activePanel: "chat",
      lastUiAction: null as null | string,
      newsPanelVisible: false,
      routeProvenanceVisible: false,
      newsTimestampTooltipReady: false,
      newsExpandCollapseReady: false,
      cacheStatus: "cache-first",
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "ui-open-panel") {
        uiState.activePanel = String(event.id ?? "unknown");
        uiState.newsPanelVisible = true;
        uiState.routeProvenanceVisible = true;
        uiState.newsTimestampTooltipReady = true;
        uiState.newsExpandCollapseReady = true;
      }
    });
    uiTool.setPanelQuery(async () => [
      {
        id: uiState.activePanel,
        title: "News",
        url: "app://news",
        type: "news",
        isActive: uiState.newsPanelVisible,
        cacheStatus: uiState.cacheStatus,
        routeProvenanceVisible: uiState.routeProvenanceVisible,
        timestampTooltipReady: uiState.newsTimestampTooltipReady,
        expandCollapseReady: uiState.newsExpandCollapseReady,
      },
    ]);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-news-panel",
              name: "UIControl",
              arguments: {
                action: "openPanel",
                params: {
                  id: "news",
                  panelType: "news",
                  title: "News",
                  url: "app://news",
                },
              },
            },
          ],
        },
        {
          text: "I opened the News panel and checked route provenance, timestamps, and expand/collapse readiness before any live news refresh.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-news-panel-smoke",
      prompt:
        "Open News and inspect route provenance before any live news refresh.",
      expectTools: ["UIControl"],
      expectToolResultContains: ['"action":"openPanel"', '"observed":true'],
      expectFinalContains: ["News panel"],
      expectPanelStateKeys: [
        "activePanel",
        "newsPanelVisible",
        "routeProvenanceVisible",
        "newsTimestampTooltipReady",
        "newsExpandCollapseReady",
        "cacheStatus",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activePanel: "news",
      newsPanelVisible: true,
      routeProvenanceVisible: true,
      newsTimestampTooltipReady: true,
      newsExpandCollapseReady: true,
      cacheStatus: "cache-first",
    });
  });

  it("runs current dashboard open workflow scenario with local artifact evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dashboardsDir = join(basePath, "memory", "pages");
    mkdirSync(dashboardsDir, { recursive: true });
    const dashboardPath = join(dashboardsDir, "workflow-dashboard.html");
    writeFileSync(
      dashboardPath,
      "<!doctype html><html><body><h1>Workflow Dashboard</h1><p>provenance fixture</p></body></html>",
      "utf-8",
    );
    const uiState = {
      activePanel: "chat",
      activeDashboard: null as null | string,
      dashboardReady: false,
      lastUiAction: null as null | string,
    };
    const uiTool = new UIControlTool();
    uiTool.setEventEmitter((event) => {
      uiState.lastUiAction = String(event.type ?? "event");
      if (event.type === "dashboard-open") {
        uiState.activeDashboard = String(
          event.title ?? event.id ?? "dashboard",
        );
        uiState.activePanel = `dash-${event.id}`;
        uiState.dashboardReady = true;
      }
    });
    uiTool.setPanelQuery(async () =>
      uiState.dashboardReady
        ? [
            {
              id: uiState.activePanel,
              title: uiState.activeDashboard ?? "Workflow Dashboard",
              url: dashboardPath,
              type: "dashboard",
              isActive: true,
            },
          ]
        : [],
    );
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "open-dashboard-page",
              name: "UIControl",
              arguments: {
                action: "openPage",
                params: {
                  path: dashboardPath,
                  title: "Workflow Dashboard",
                },
              },
            },
          ],
        },
        {
          text: "I opened the workflow dashboard from the local artifact and verified dashboard panel evidence.",
        },
      ]),
      [uiTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-dashboard-open-smoke",
      prompt:
        "Open the local workflow dashboard and verify panel evidence before summarizing.",
      expectTools: ["UIControl"],
      expectToolResultContains: ['"action":"openPage"', '"observed":true'],
      expectFinalContains: ["workflow dashboard"],
      expectPanelStateKeys: ["activeDashboard", "dashboardReady"],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      activeDashboard: "Workflow Dashboard",
      dashboardReady: true,
    });
    expect(result.run.uiEvidence?.paths).toContain("activeDashboard");
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(report.uiEvidence.paths).toContain("dashboardReady");
    expect(
      report.toolResults.some((entry: { content?: string }) =>
        entry.content?.includes(dashboardPath),
      ),
    ).toBe(true);
  });

  it("runs current WebView dashboard refresh workflow scenario with panel evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const dashboardsDir = join(basePath, "memory", "pages");
    mkdirSync(dashboardsDir, { recursive: true });
    const dashboardPath = join(dashboardsDir, "workflow-dashboard.html");
    writeFileSync(
      dashboardPath,
      "<!doctype html><html><body><h1>Workflow Dashboard</h1><p>provenance fixture</p></body></html>",
      "utf-8",
    );
    const uiState = {
      activeDashboard: "Workflow Dashboard",
      dashboardReady: true,
      refreshCount: 0,
    };
    const panels = [
      {
        id: "dash-workflow-dashboard",
        title: "Workflow Dashboard",
        url: dashboardPath,
        type: "dashboard",
        isActive: true,
      },
    ];
    const webViewTool = new WebViewTool();
    webViewTool.setEventEmitter((event) => {
      if (event.type === "webview-refresh") {
        uiState.refreshCount += 1;
      }
    });
    webViewTool.setPanelQuery(async () => panels as any);
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "refresh-dashboard-page",
              name: "WebView",
              arguments: {
                action: "refresh",
                id: "workflow-dashboard",
              },
            },
          ],
        },
        {
          text: "I refreshed the workflow dashboard panel and verified panel evidence before summarizing.",
        },
      ]),
      [webViewTool],
      async () => ({ ...uiState }),
    );

    const result = await control.runScenario({
      id: "electron-ui-dashboard-refresh-smoke",
      prompt:
        "Refresh the already-open workflow dashboard and verify panel evidence before summarizing.",
      expectTools: ["WebView"],
      expectToolResultContains: [
        '"action": "refresh"',
        '"observed": true',
        '"resolvedId": "dash-workflow-dashboard"',
        '"match": "id-without-dash-prefix"',
      ],
      expectFinalContains: ["refreshed the workflow dashboard"],
      expectPanelStateKeys: [
        "activeDashboard",
        "dashboardReady",
        "refreshCount",
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.run.panelState).toMatchObject({
      dashboardReady: true,
      refreshCount: 1,
    });
  });

  it("runs current Research provider-discovery workflow scenario without live search calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "research-providers",
              name: "Research",
              arguments: { action: "providers" },
            },
          ],
        },
        {
          text: "I checked Research provider availability before spending any search quota.",
        },
      ]),
      [new ResearchTool()],
      async () => ({ activePanel: "research", providerDiscoveryVisible: true }),
    );

    const result = await control.runScenario({
      id: "electron-research-provider-discovery-smoke",
      prompt:
        "Inspect Research search-engine availability before running any web search.",
      expectTools: ["Research"],
      expectToolResultContains: [
        '"action": "providers"',
        '"provider": "brave"',
        '"provider": "tavily"',
        '"kind": "search-engine"',
        '"quotaClass": "paid-monthly-limited"',
      ],
      expectFinalContains: ["provider availability"],
      expectPanelStateKeys: ["activePanel", "providerDiscoveryVisible"],
    });

    expect(result.ok).toBe(true);
    expect(
      result.run.messages.some((message) =>
        message.toolResult?.content.includes('"searchEngines"'),
      ),
    ).toBe(true);
  });

  it("runs current session-search workflow scenario with indexed history evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const sessionsDir = join(basePath, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const index = new SessionIndex(sessionsDir);
    index.indexMessage({
      sessionId: "session-search-fixture",
      sessionFile: "history/session-search-fixture.jsonl",
      role: "assistant",
      content:
        "The finance workflow decision used interface-first cache/readback before provider refresh.",
      timestamp: "2026-06-25T06:00:00.000Z",
      sessionTitle: "Finance workflow decision",
    });
    index.flush();
    setSessionIndex(index);

    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "session-search",
              name: "SessionSearch",
              arguments: { query: "interface-first", limit: 5 },
            },
          ],
        },
        {
          text: "I searched session history before continuing the provenance workflow.",
        },
      ]),
      [new SessionSearchTool()],
      async () => ({ activePanel: "sessions", sessionSearchVisible: true }),
    );

    const result = await control.runScenario({
      id: "electron-session-search-history-smoke",
      prompt:
        "Search session history for the prior interface-first provenance decision before continuing.",
      expectTools: ["SessionSearch"],
      expectToolResultContains: [
        "Finance workflow decision",
        "interface-first cache/readback",
      ],
      expectFinalContains: ["session history"],
      expectPanelStateKeys: ["activePanel", "sessionSearchVisible"],
    });

    expect(result.ok).toBe(true);
  });

  it("runs current Research news validation-error workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "research-news-missing-query",
              name: "Research",
              arguments: { action: "news" },
            },
          ],
        },
        {
          text: "I saw Research(news) validation fail and will ask for a query before running any news provider.",
        },
      ]),
      [new ResearchTool()],
    );

    const result = await control.runScenario({
      id: "electron-research-news-validation-error-smoke",
      prompt:
        "Try to inspect finance news without a query, then explain the validation error before using any news provider.",
      expectTools: ["Research"],
      expectToolErrors: ["query required"],
      expectFinalContains: ["validation fail", "query", "news provider"],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolError = result.run.messages.find(
      (message) => message.toolResult?.isError,
    );
    expect(toolError?.toolResult?.content).toContain("query required");
  });

  it("runs a multi-turn workflow scenario through one agent session with reviewable evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { agent, control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "turn1-echo",
              name: "Echo",
              arguments: { message: "dashboard draft evidence" },
            },
          ],
        },
        {
          text: "Turn 1 complete: I created the dashboard draft evidence and recorded source time.",
        },
        {
          toolCalls: [
            {
              id: "turn2-echo",
              name: "Echo",
              arguments: { message: "refresh dashboard evidence" },
            },
          ],
        },
        {
          text: "Turn 2 complete: I refreshed the dashboard evidence and checked visible panel state.",
        },
      ]),
      [],
      async () => ({
        activePanel: "dashboard",
        dashboardReady: true,
        visibleTitle: "茅台分析看板",
      }),
      async (runId) => ({
        kind: "main-window-screenshot",
        path: join(basePath, "data", "workflow-automation", `${runId}.png`),
        bytes: 10,
      }),
    );

    const result = await control.runMultiTurnScenario({
      id: "electron-multiturn-dashboard-smoke",
      turns: [
        {
          id: "create",
          prompt: "帮我做一个茅台分析看板",
          expectTools: ["Echo"],
          expectFinalContains: ["dashboard draft evidence"],
          expectPanelStateKeys: ["activePanel", "dashboardReady"],
          expectUiArtifactKinds: ["main-window-screenshot"],
        },
        {
          id: "refresh",
          prompt: "刷新这个看板的数据，并告诉我哪些 API 失败了",
          expectTools: ["Echo"],
          expectFinalContains: ["refreshed the dashboard evidence"],
          expectPanelStateKeys: ["activePanel", "visibleTitle"],
          expectUiArtifactKinds: ["main-window-screenshot"],
        },
      ],
      expectSessionContains: ["茅台分析看板", "刷新这个看板的数据"],
      expectPanelStateKeys: ["activePanel", "dashboardReady", "visibleTitle"],
      expectUiArtifactKinds: ["main-window-screenshot"],
    });

    expect(result.ok).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(new Set(result.turns.map((turn) => turn.run.sessionId))).toEqual(
      new Set([agent.session.id]),
    );
    expect(result.turns[0].run.messages.some((message) =>
      message.toolUses?.some((tool) => tool.name === "Echo"),
    )).toBe(true);
    expect(result.turns[1].run.messages.some((message) =>
      message.content.includes("refreshed the dashboard evidence"),
    )).toBe(true);
    expect(result.scenarioReportPath && existsSync(result.scenarioReportPath)).toBe(
      true,
    );
    const report = JSON.parse(
      readFileSync(result.scenarioReportPath!, "utf-8"),
    );
    expect(report).toMatchObject({
      kind: "multiturn-scenario",
      scenarioId: "electron-multiturn-dashboard-smoke",
      ok: true,
      turnCount: 2,
    });
    expect(report.turns[0].agentReview).toMatchObject({
      reviewRequired: true,
      finalAssistantPresent: true,
      panelEvidenceAvailable: true,
    });
    expect(report.turns[1].agentReview.toolNames).toContain("Echo");
    expect(report.turns[1].agentReview.reviewerChecklist.length).toBeGreaterThan(
      0,
    );
  });

  it("exposes the multi-turn workflow scenario over loopback http", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        { text: "First turn has durable agent content." },
        { text: "Second turn has refreshed visible result." },
      ]),
      [],
      async () => ({ activePanel: "dashboard", visibleResult: true }),
    );
    server = await startWorkflowAutomationServer(control);

    const result = await postJson(server!.port, "/workflow/scenario_sequence", {
      id: "http-multiturn",
      turns: [
        {
          id: "first",
          prompt: "Create dashboard",
          expectFinalContains: ["durable agent content"],
        },
        {
          id: "second",
          prompt: "Refresh dashboard",
          expectFinalContains: ["refreshed visible result"],
        },
      ],
      expectSessionContains: ["Create dashboard", "Refresh dashboard"],
      expectPanelStateKeys: ["activePanel", "visibleResult"],
    });

    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(result.json.turns).toHaveLength(2);
    expect(result.json.scenarioReportPath).toContain("multiturn");
    const reports = await getJson(server!.port, "/workflow/reports?limit=10");
    const summary = reports.json.reports.find(
      (report: any) => report.scenarioId === "http-multiturn",
    );
    expect(summary).toMatchObject({
      kind: "scenario",
      ok: true,
      assertionFailCount: 0,
    });
  });

  it("asserts configured max tool-call limits for workflow scenarios", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "echo-1", name: "Echo", arguments: { message: "one" } },
            { id: "echo-2", name: "Echo", arguments: { message: "two" } },
          ],
        },
        { text: "done" },
      ]),
    );

    const result = await control.runScenario({
      id: "max-tool-call-check",
      prompt: "Use too many tools",
      maxToolCalls: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "maxToolCalls.1",
        ok: false,
        actual: 2,
      }),
    );
    expect(result.run.error ?? "").toContain("WORKFLOW_AUTOMATION_TOOL_LIMIT");
  });

  it("cancels workflow scenarios when the data-tool budget is exceeded", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            { id: "data-tool", name: "DataStore", arguments: { action: "query_quote" } },
            { id: "dashboard-tool", name: "Dashboard", arguments: { id: "dash" } },
          ],
        },
        { text: "done" },
      ]),
      [new NamedTool("DataStore"), new NamedTool("Dashboard")],
    );

    const result = await control.runScenario({
      id: "max-data-tool-call-check",
      prompt: "Use too many data tools",
      maxDataToolCalls: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "maxDataToolCalls.0",
        ok: false,
        actual: 1,
      }),
    );
    expect(result.run.error ?? "").toContain("WORKFLOW_AUTOMATION_TOOL_LIMIT");
    expect(result.run.error ?? "").toContain(
      "counted workflow data tools: DataStore",
    );
    expect(result.run.error ?? "").not.toContain("Dashboard");
  });

  it("fails workflow scenarios when the agent emits an error event without a final answer", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(basePath, new ErrorEventLLM());

    const result = await control.runScenario({
      id: "agent-error-event-check",
      prompt: "Trigger an agent transport error",
    });

    expect(result.ok).toBe(false);
    expect(result.run.ok).toBe(false);
    expect(result.run.error).toContain("network unavailable");
    expect(result.assertions).toContainEqual(
      expect.objectContaining({
        name: "run.ok",
        ok: false,
      }),
    );
  });

  it("fails workflow scenarios when the agent finishes with no assistant text", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(basePath, new MockLLM([{ text: "" }]));

    const result = await control.runScenario({
      id: "empty-final-check",
      prompt: "Finish without text",
    });

    expect(result.ok).toBe(false);
    expect(result.run.ok).toBe(false);
    expect(result.run.error).toBe("WORKFLOW_AUTOMATION_EMPTY_FINAL");
  });

  it("runs current provider-diagnostic boundary workflow scenario without live provider calls", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([
        {
          toolCalls: [
            {
              id: "provider-diagnostic-missing-provider",
              name: "DataStore",
              arguments: { action: "provider_diagnostic" },
            },
          ],
        },
        {
          text: "I saw provider_diagnostic validation fail before any provider call and will use governed interfaces or bounded diagnostics only.",
        },
      ]),
      [new DataStoreTool()],
    );

    const result = await control.runScenario({
      id: "electron-provider-diagnostic-boundary-smoke",
      prompt:
        "Try provider diagnostics without a provider, then explain why diagnostics are not normal data workflow.",
      expectTools: ["DataStore"],
      expectToolErrors: ["provider required for provider_diagnostic"],
      expectFinalContains: [
        "provider_diagnostic validation fail",
        "governed interfaces",
        "bounded diagnostics",
      ],
      expectPanelStateKeys: ["0.type"],
    });

    expect(result.ok).toBe(true);
    const toolError = result.run.messages.find(
      (message) => message.toolResult?.isError,
    );
    expect(toolError?.toolResult?.content).toContain(
      "provider required for provider_diagnostic",
    );
  });

  it("triggers a monitor through workflow automation and returns agent-message evidence", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "unused" }]),
      [],
      undefined,
      undefined,
      async (monitorId, options) => ({
        ok: true,
        monitorId,
        timeoutMs: options?.timeoutMs,
        result: { signal: "entry" },
        agentMessageCount: 1,
        agentMessages: [
          {
            monitorName: "Strategy signal monitor",
            message: "策略信号已触发：请先计算可以买多少和风险",
            data: {
              strategyId: "custom_20_v1",
              confirmationRequired: true,
            },
          },
        ],
      }),
    );

    const result = await control.triggerMonitor({
      monitorId: "m-strategy",
      timeoutMs: 45000,
    });

    expect(result).toMatchObject({
      ok: true,
      monitorId: "m-strategy",
      timeoutMs: 45000,
      agentMessageCount: 1,
    });
    expect(JSON.stringify(result)).toContain("custom_20_v1");
  });

  it("exposes trigger_monitor through the workflow automation server", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "unused" }]),
      [],
      undefined,
      undefined,
      async (monitorId, options) => ({
        ok: true,
        monitorId,
        timeoutMs: options?.timeoutMs,
        agentMessageCount: 1,
      }),
    );
    server = await startWorkflowAutomationServer(control, 0);
    expect(server).not.toBeNull();

    const response = await postJson(server!.port, "/workflow/trigger_monitor", {
      monitorId: "m-strategy",
      timeoutMs: 60000,
    });

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      monitorId: "m-strategy",
      timeoutMs: 60000,
      agentMessageCount: 1,
    });
  });

  it("preserves portfolio rebalance evidence through trigger_monitor", async () => {
    process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION = "1";
    const { control } = makeControl(
      basePath,
      new MockLLM([{ text: "unused" }]),
      [],
      undefined,
      undefined,
      async (monitorId, options) => ({
        ok: true,
        monitorId,
        timeoutMs: options?.timeoutMs,
        agentMessageCount: 1,
        agentMessages: [
          {
            monitorName: "Portfolio rebalance monitor",
            message: "组合策略复核触发：strategyId=portfolio_rank_v1",
            data: {
              template: "portfolio_rebalance_monitor",
              strategyId: "portfolio_rank_v1",
              portfolioEvidence: {
                selectedCount: 2,
                aggregateMetrics: {
                  selectedSymbols: ["600519", "000858"],
                },
              },
              rebalanceDraft: {
                rebalanceInterval: "monthly",
                positions: [
                  { symbol: "600519", targetWeight: 0.4 },
                  { symbol: "000858", targetWeight: 0.4 },
                ],
              },
              confirmationRequired: true,
            },
          },
        ],
      }),
    );

    const result = await control.triggerMonitor({
      monitorId: "m-portfolio",
      timeoutMs: 45000,
    });

    expect(result).toMatchObject({
      ok: true,
      monitorId: "m-portfolio",
      timeoutMs: 45000,
      agentMessageCount: 1,
    });
    const encoded = JSON.stringify(result);
    expect(encoded).toContain("portfolio_rebalance_monitor");
    expect(encoded).toContain("portfolio_rank_v1");
    expect(encoded).toContain("rebalanceDraft");
    expect(encoded).toContain("600519");
  });
});
