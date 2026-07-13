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
}

export interface RunServicePendingState {
  runId: string;
  status: RunServiceResultSnapshot["status"];
  pendingInteractions: RunServiceEventRecord[];
  pendingPermissions: RunServiceEventRecord[];
  pendingCount: number;
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

  result(runId: string): RunServiceResultSnapshot {
    const events = this.events({ runId });
    if (events.length === 0) return { runId, status: "missing", events: [] };
    const terminal = [...events].reverse().find(isTerminal);
    const last = terminal ?? events[events.length - 1];
    const status = terminal
      ? terminalStatus(terminal.type)
      : hasPending(events)
        ? "waiting"
        : "running";
    return {
      runId,
      status,
      ...(last.sessionId ? { sessionId: last.sessionId } : {}),
      ...(last.turnId ? { turnId: last.turnId } : {}),
      ...(terminal?.payload?.finalAnswer != null
        ? { finalAnswer: String(terminal.payload.finalAnswer) }
        : {}),
      ...(terminal?.payload?.error != null ? { error: String(terminal.payload.error) } : {}),
      events,
    };
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
