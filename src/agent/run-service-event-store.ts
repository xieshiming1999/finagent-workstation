import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { dirname } from "path";
import type { RunServiceEventType } from "./run-service-contract";

export interface RunServiceEventRecord {
  sequence: number;
  runId: string;
  type: RunServiceEventType;
  createdAt: string;
  sessionId?: string;
  turnId?: string;
  payload?: Record<string, unknown>;
}

export interface RunServiceResultSnapshot {
  runId: string;
  status: "missing" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  turnId?: string;
  finalAnswer?: string;
  error?: string;
  events: RunServiceEventRecord[];
  trace: RunServiceEventRecord[];
  toolCalls: RunServiceEventRecord[];
  toolResults: RunServiceEventRecord[];
  interactions: RunServiceEventRecord[];
  permissions: RunServiceEventRecord[];
  uiArtifacts: RunServiceEventRecord[];
  errors: RunServiceEventRecord[];
  provenance: Record<string, unknown>;
}

export interface RunServicePendingState {
  runId: string;
  status: RunServiceResultSnapshot["status"];
  pendingInteractions: RunServiceEventRecord[];
  pendingPermissions: RunServiceEventRecord[];
  pendingCount: number;
}

export interface RunServiceWaitResult {
  ok: boolean;
  kind: "run.wait";
  runId: string;
  after: number;
  timedOut: boolean;
  status: RunServiceResultSnapshot["status"];
  terminal: boolean;
  count: number;
  events: RunServiceEventRecord[];
  lastSequence: number;
}

export class RunServiceEventStore {
  private nextSequence = 1;
  private readonly eventsByRun = new Map<string, RunServiceEventRecord[]>();
  private readonly persistencePath?: string;

  constructor(
    private readonly clock: () => Date = () => new Date(),
    options: { persistencePath?: string } = {},
  ) {
    this.persistencePath = options.persistencePath;
    if (this.persistencePath) this.loadPersistedEvents(this.persistencePath);
  }

  append(input: {
    runId: string;
    type: RunServiceEventType;
    sessionId?: string;
    turnId?: string;
    payload?: Record<string, unknown>;
  }): RunServiceEventRecord {
    const event: RunServiceEventRecord = {
      sequence: this.nextSequence++,
      runId: input.runId,
      type: input.type,
      createdAt: this.clock().toISOString(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.payload && Object.keys(input.payload).length > 0
        ? { payload: { ...input.payload } }
        : {}),
    };
    const events = this.eventsByRun.get(input.runId) ?? [];
    events.push(event);
    this.eventsByRun.set(input.runId, events);
    this.persistEvent(event);
    return event;
  }

  events(input: { runId: string; after?: number }): RunServiceEventRecord[] {
    const after = input.after ?? 0;
    return (this.eventsByRun.get(input.runId) ?? []).filter(
      (event) => event.sequence > after,
    );
  }

  results(limit = 20): RunServiceResultSnapshot[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return [...this.eventsByRun.entries()]
      .sort((left, right) =>
        (right[1].at(-1)?.sequence ?? 0) - (left[1].at(-1)?.sequence ?? 0))
      .slice(0, boundedLimit)
      .map(([runId]) => this.result(runId));
  }

  result(runId: string): RunServiceResultSnapshot {
    const events = this.events({ runId });
    if (events.length === 0) return resultSnapshot(runId, "missing", []);
    const terminal = [...events].reverse().find(isTerminal);
    const last = terminal ?? events[events.length - 1];
    const status = terminal
      ? terminalStatus(terminal.type)
      : hasPending(events)
        ? "waiting"
        : "running";
    return resultSnapshot(runId, status, events, {
      ...(last.sessionId ? { sessionId: last.sessionId } : {}),
      ...(last.turnId ? { turnId: last.turnId } : {}),
      ...(terminal?.payload?.finalAnswer != null
        ? { finalAnswer: String(terminal.payload.finalAnswer) }
        : {}),
      ...(terminal?.payload?.error != null ? { error: String(terminal.payload.error) } : {}),
    });
  }

  state(runId: string): Record<string, unknown> {
    const snapshot = this.result(runId);
    const created = [...snapshot.events].reverse().find((event) => event.type === "run.created");
    const pending = this.pending(runId);
    return {
      ok: snapshot.status !== "missing",
      kind: "run.state",
      runId,
      status: snapshot.status,
      terminal: isTerminalStatus(snapshot.status),
      ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
      ...(snapshot.turnId ? { turnId: snapshot.turnId } : {}),
      ...(created?.payload?.sessionMode != null ? { sessionMode: created.payload.sessionMode } : {}),
      ...(created?.payload?.uiRuntime != null ? { uiRuntime: created.payload.uiRuntime } : {}),
      lastSequence: snapshot.events.at(-1)?.sequence ?? 0,
      pendingInteractionCount: pending.pendingInteractions.length,
      pendingPermissionCount: pending.pendingPermissions.length,
      ...(snapshot.error ? { error: snapshot.error } : {}),
    };
  }

  messages(runId: string, after = 0): Record<string, unknown> {
    const messages = this.events({ runId, after })
      .map(messageFromEvent)
      .filter((message): message is Record<string, unknown> => message != null);
    return {
      ok: this.result(runId).status !== "missing",
      kind: "run.messages",
      runId,
      after,
      count: messages.length,
      messages,
    };
  }

  async wait(input: { runId: string; after?: number; timeoutMs?: number }): Promise<RunServiceWaitResult> {
    const after = input.after ?? 0;
    const timeoutMs = Math.max(1, Math.min(30000, Math.floor(input.timeoutMs ?? 5000)));
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const events = this.events({ runId: input.runId, after });
      const snapshot = this.result(input.runId);
      if (events.length > 0 || isTerminalStatus(snapshot.status) || snapshot.status === "missing") {
        return waitResult(input.runId, after, events, snapshot, false);
      }
      if (Date.now() >= deadline) return waitResult(input.runId, after, events, snapshot, true);
      await new Promise((resolve) => setTimeout(resolve, Math.min(20, deadline - Date.now())));
    }
  }

  pending(runId: string): RunServicePendingState {
    const events = this.events({ runId });
    const result = this.result(runId);
    const pendingInteractions = unresolvedEvents(
      events,
      "interaction.required",
      "interaction.resolved",
    );
    const pendingPermissions = unresolvedEvents(
      events,
      "permission.required",
      "permission.resolved",
    );
    return {
      runId,
      status: result.status,
      pendingInteractions,
      pendingPermissions,
      pendingCount: pendingInteractions.length + pendingPermissions.length,
    };
  }

  private persistEvent(event: RunServiceEventRecord): void {
    if (!this.persistencePath) return;
    mkdirSync(dirname(this.persistencePath), { recursive: true });
    appendFileSync(this.persistencePath, `${JSON.stringify(event)}\n`, "utf-8");
  }

  private loadPersistedEvents(filePath: string): void {
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parsePersistedEvent(line);
      if (!parsed) continue;
      const events = this.eventsByRun.get(parsed.runId) ?? [];
      events.push(parsed);
      this.eventsByRun.set(parsed.runId, events);
      this.nextSequence = Math.max(this.nextSequence, parsed.sequence + 1);
    }
  }
}

function messageFromEvent(event: RunServiceEventRecord): Record<string, unknown> | null {
  if (event.type === "run.created") {
    const content = String(event.payload?.acceptedMessage ?? "").trim();
    return content ? messageEnvelope(event, "user", "user.message", content) : null;
  }
  if (event.type === "assistant.delta") {
    const content = event.payload?.delta ?? event.payload?.text ?? event.payload?.content ?? "";
    return messageEnvelope(event, "assistant", "assistant.delta", content);
  }
  if (event.type === "tool.call") return messageEnvelope(event, "assistant", "tool.call", event.payload ?? {});
  if (event.type === "tool.result") return messageEnvelope(event, "tool", "tool.result", event.payload ?? {});
  return null;
}

function messageEnvelope(
  event: RunServiceEventRecord,
  role: "user" | "assistant" | "tool",
  kind: string,
  content: unknown,
): Record<string, unknown> {
  return {
    sequence: event.sequence,
    runId: event.runId,
    role,
    kind,
    content,
    createdAt: event.createdAt,
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
  };
}

function isTerminalStatus(status: RunServiceResultSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function waitResult(
  runId: string,
  after: number,
  events: RunServiceEventRecord[],
  snapshot: RunServiceResultSnapshot,
  timedOut: boolean,
): RunServiceWaitResult {
  return {
    ok: snapshot.status !== "missing",
    kind: "run.wait",
    runId,
    after,
    timedOut,
    status: snapshot.status,
    terminal: isTerminalStatus(snapshot.status),
    count: events.length,
    events,
    lastSequence: events.at(-1)?.sequence ?? after,
  };
}

function resultSnapshot(
  runId: string,
  status: RunServiceResultSnapshot["status"],
  events: RunServiceEventRecord[],
  fields: Pick<RunServiceResultSnapshot, "sessionId" | "turnId" | "finalAnswer" | "error"> = {},
): RunServiceResultSnapshot {
  const ofType = (...types: RunServiceEventType[]) =>
    events.filter((event) => types.includes(event.type));
  const created = ofType("run.created").at(-1);
  return {
    runId,
    status,
    ...fields,
    events,
    trace: events,
    toolCalls: ofType("tool.call"),
    toolResults: ofType("tool.result"),
    interactions: ofType("interaction.required", "interaction.resolved"),
    permissions: ofType("permission.required", "permission.resolved"),
    uiArtifacts: ofType(
      "ui.operation.started",
      "ui.operation.completed",
      "artifact.created",
      "artifact.updated",
    ),
    errors: events.filter((event) =>
      event.type === "run.failed" ||
      (event.type === "tool.result" && event.payload?.isError === true)),
    provenance: {
      source: "run-service-events",
      runId,
      ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
      ...(fields.turnId ? { turnId: fields.turnId } : {}),
      ...(created?.payload ? { request: created.payload } : {}),
      firstSequence: events.at(0)?.sequence ?? null,
      lastSequence: events.at(-1)?.sequence ?? null,
    },
  };
}

function unresolvedEvents(
  events: RunServiceEventRecord[],
  requiredType: RunServiceEventType,
  resolvedType: RunServiceEventType,
): RunServiceEventRecord[] {
  const resolvedIds = new Set<string>();
  let resolvedWithoutId = 0;
  for (const event of events) {
    if (event.type !== resolvedType) continue;
    const id = requestId(event);
    if (id) resolvedIds.add(id);
    else resolvedWithoutId++;
  }
  const pending: RunServiceEventRecord[] = [];
  for (const event of events) {
    if (event.type !== requiredType) continue;
    const id = requestId(event);
    if (id) {
      if (!resolvedIds.has(id)) pending.push(event);
      continue;
    }
    if (resolvedWithoutId > 0) {
      resolvedWithoutId--;
      continue;
    }
    pending.push(event);
  }
  return pending;
}

function requestId(event: RunServiceEventRecord): string {
  const value = event.payload?.requestId ?? event.payload?.id;
  return value == null ? "" : String(value).trim();
}

function parsePersistedEvent(line: string): RunServiceEventRecord | null {
  try {
    const decoded = JSON.parse(line);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const sequence = Number(decoded.sequence);
    const runId = String(decoded.runId ?? "");
    const type = String(decoded.type ?? "") as RunServiceEventType;
    const createdAt = String(decoded.createdAt ?? "");
    if (!Number.isFinite(sequence) || sequence <= 0 || !runId || !type || !createdAt) {
      return null;
    }
    return {
      sequence,
      runId,
      type,
      createdAt,
      ...(decoded.sessionId ? { sessionId: String(decoded.sessionId) } : {}),
      ...(decoded.turnId ? { turnId: String(decoded.turnId) } : {}),
      ...(decoded.payload && typeof decoded.payload === "object" && !Array.isArray(decoded.payload)
        ? { payload: decoded.payload as Record<string, unknown> }
        : {}),
    };
  } catch {
    return null;
  }
}

function isTerminal(event: RunServiceEventRecord): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
  );
}

function terminalStatus(
  type: RunServiceEventType,
): RunServiceResultSnapshot["status"] {
  if (type === "run.completed") return "completed";
  if (type === "run.failed") return "failed";
  if (type === "run.cancelled") return "cancelled";
  return "running";
}

function hasPending(events: RunServiceEventRecord[]): boolean {
  const pendingInteraction = events.filter(
    (event) => event.type === "interaction.required",
  ).length;
  const resolvedInteraction = events.filter(
    (event) => event.type === "interaction.resolved",
  ).length;
  const pendingPermission = events.filter(
    (event) => event.type === "permission.required",
  ).length;
  const resolvedPermission = events.filter(
    (event) => event.type === "permission.resolved",
  ).length;
  return (
    pendingInteraction > resolvedInteraction ||
    pendingPermission > resolvedPermission
  );
}
