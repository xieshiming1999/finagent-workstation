import {
  type RunServiceSessionMode,
  type RunServiceUiRuntimeMode,
} from "./run-service-contract";
import {
  RunServiceEventStore,
  type RunServiceResultSnapshot,
} from "./run-service-event-store";

export interface RunServiceRunRequest {
  prompt: string;
  sessionMode?: RunServiceSessionMode;
  uiRuntime?: RunServiceUiRuntimeMode;
  sessionId?: string;
  timeoutMs?: number;
  payload?: Record<string, unknown>;
}

export interface RunServicePromptRunResult {
  ok: boolean;
  finalAnswer: string;
  sessionId?: string;
  turnId?: string;
  error?: string;
  toolCalls?: Array<Record<string, unknown>>;
  toolResults?: Array<Record<string, unknown>>;
  uiArtifacts?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown>;
}

export type RunServicePromptRunner = (
  request: Required<Pick<RunServiceRunRequest, "prompt">> & RunServiceRunRequest,
) => Promise<RunServicePromptRunResult>;

export class RunServiceController {
  readonly eventStore: RunServiceEventStore;

  constructor(
    private readonly promptRunner: RunServicePromptRunner,
    options: {
      eventStore?: RunServiceEventStore;
      clock?: () => Date;
    } = {},
  ) {
    this.eventStore = options.eventStore ?? new RunServiceEventStore(options.clock);
    this.clock = options.clock ?? (() => new Date());
  }

  private readonly clock: () => Date;

  async runPrompt(
    request: RunServiceRunRequest,
    options: { runId?: string } = {},
  ): Promise<RunServiceResultSnapshot> {
    const prompt = String(request.prompt ?? "").trim();
    if (!prompt) throw new Error("run service prompt is required");
    const runId = options.runId ?? this.newRunId();
    const sessionId = request.sessionId;
    const normalizedRequest = {
      ...request,
      prompt,
      sessionMode: request.sessionMode ?? "new",
      uiRuntime: request.uiRuntime ?? "visible",
    };
    this.eventStore.append({
      runId,
      type: "run.created",
      sessionId,
      payload: {
        sessionMode: normalizedRequest.sessionMode,
        uiRuntime: normalizedRequest.uiRuntime,
        ...(normalizedRequest.payload
          ? { requestPayload: normalizedRequest.payload }
          : {}),
      },
    });
    this.eventStore.append({
      runId,
      type: "run.status.changed",
      sessionId,
      payload: { status: "running" },
    });

    try {
      const result = await this.promptRunner(normalizedRequest);
      const finalSessionId = result.sessionId ?? sessionId;
      for (const call of result.toolCalls ?? []) {
        this.eventStore.append({
          runId,
          type: "tool.call",
          sessionId: finalSessionId,
          turnId: result.turnId,
          payload: call,
        });
      }
      for (const toolResult of result.toolResults ?? []) {
        this.eventStore.append({
          runId,
          type: "tool.result",
          sessionId: finalSessionId,
          turnId: result.turnId,
          payload: toolResult,
        });
      }
      for (const artifact of result.uiArtifacts ?? []) {
        this.eventStore.append({
          runId,
          type: "artifact.created",
          sessionId: finalSessionId,
          turnId: result.turnId,
          payload: artifact,
        });
      }
      this.eventStore.append({
        runId,
        type: result.ok ? "run.completed" : "run.failed",
        sessionId: finalSessionId,
        turnId: result.turnId,
        payload: {
          finalAnswer: result.finalAnswer,
          ...(result.error ? { error: result.error } : {}),
          ...(result.provenance ? { provenance: result.provenance } : {}),
        },
      });
    } catch (error) {
      this.eventStore.append({
        runId,
        type: "run.failed",
        sessionId,
        payload: { error: String(error) },
      });
    }
    return this.eventStore.result(runId);
  }

  private newRunId(): string {
    return `run-${this.clock().getTime()}`;
  }
}
