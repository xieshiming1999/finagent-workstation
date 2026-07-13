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

export class RunServiceEventStore {
  private nextSequence = 1;
  private readonly eventsByRun = new Map<string, RunServiceEventRecord[]>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

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

