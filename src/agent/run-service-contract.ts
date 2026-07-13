export type RunServiceSessionMode =
  | "new"
  | "resume"
  | "preload"
  | "ephemeral"
  | "attached";

export type RunServiceUiRuntimeMode = "visible" | "headless" | "mirror";

export type RunServiceCommandCategory =
  | "run"
  | "data"
  | "analysis"
  | "strategy"
  | "execution"
  | "workflow"
  | "artifact"
  | "session"
  | "service"
  | "capability";

export type RunServiceEventType =
  | "run.created"
  | "run.status.changed"
  | "assistant.delta"
  | "tool.call"
  | "tool.result"
  | "interaction.required"
  | "interaction.resolved"
  | "permission.required"
  | "permission.resolved"
  | "ui.operation.started"
  | "ui.operation.completed"
  | "artifact.created"
  | "artifact.updated"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

const commandCategories: RunServiceCommandCategory[] = [
  "run",
  "data",
  "analysis",
  "strategy",
  "execution",
  "workflow",
  "artifact",
  "session",
  "service",
  "capability",
];

const sessionModes: RunServiceSessionMode[] = [
  "new",
  "resume",
  "preload",
  "ephemeral",
  "attached",
];

const uiRuntimeModes: RunServiceUiRuntimeMode[] = [
  "visible",
  "headless",
  "mirror",
];

export const runServiceEventTypes: RunServiceEventType[] = [
  "run.created",
  "run.status.changed",
  "assistant.delta",
  "tool.call",
  "tool.result",
  "interaction.required",
  "interaction.resolved",
  "permission.required",
  "permission.resolved",
  "ui.operation.started",
  "ui.operation.completed",
  "artifact.created",
  "artifact.updated",
  "run.completed",
  "run.failed",
  "run.cancelled",
];

export interface RunServiceCommandPlan {
  category: RunServiceCommandCategory;
  operation: string;
  sessionMode: RunServiceSessionMode;
  uiRuntime: RunServiceUiRuntimeMode;
  jsonl: boolean;
  prompt?: string;
  sessionId?: string;
  payload: Record<string, string>;
}

export const runServiceCommandHelp =
  "Usage: finagent <run|data|analysis|strategy|execution|workflow|artifact|session|service|capability> [operation] [options]\n" +
  "Common options: --session <new|resume|preload|ephemeral|attached>, " +
  "--session-id <id>, --ui-runtime <visible|headless|mirror>, --jsonl";

export function parseRunServiceCommand(args: string[]): RunServiceCommandPlan {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    throw new Error(runServiceCommandHelp);
  }
  const category = parseCommandCategory(args[0]);
  const rest = args.slice(1);
  let operation = category === "run" ? "prompt" : "";
  let sessionMode: RunServiceSessionMode = category === "run" ? "new" : "ephemeral";
  let uiRuntime: RunServiceUiRuntimeMode = "visible";
  let jsonl = false;
  let sessionId: string | undefined;
  let prompt: string | undefined;
  const payload: Record<string, string> = {};

  let index = 0;
  if (category !== "run" && index < rest.length && !rest[index].startsWith("--")) {
    operation = rest[index++].trim();
  }
  if (category === "run") {
    const parts: string[] = [];
    while (index < rest.length && !rest[index].startsWith("--")) {
      parts.push(rest[index++]);
    }
    prompt = parts.join(" ").trim();
    if (!prompt) throw new Error("plain-text run requires a prompt");
  }
  if (category !== "run" && !operation) {
    throw new Error(`${category} requires an operation`);
  }

  while (index < rest.length) {
    const flag = rest[index++];
    switch (flag) {
      case "--jsonl":
        jsonl = true;
        break;
      case "--session":
        sessionMode = parseSessionMode(takeValue(rest, index++, flag));
        break;
      case "--session-id":
        sessionId = takeValue(rest, index++, flag);
        break;
      case "--ui-runtime":
        uiRuntime = parseUiRuntimeMode(takeValue(rest, index++, flag));
        break;
      default:
        if (!flag.startsWith("--")) {
          throw new Error(`unexpected positional argument: ${flag}`);
        }
        payload[flag.slice(2)] = takeValue(rest, index++, flag);
        break;
    }
  }

  if (sessionMode === "resume" && !sessionId) {
    throw new Error("--session-id is required when --session resume");
  }

  return {
    category,
    operation,
    sessionMode,
    uiRuntime,
    jsonl,
    ...(prompt ? { prompt } : {}),
    ...(sessionId ? { sessionId } : {}),
    payload,
  };
}

function parseCommandCategory(value: string): RunServiceCommandCategory {
  const normalized = value.trim().toLowerCase();
  if (commandCategories.includes(normalized as RunServiceCommandCategory)) {
    return normalized as RunServiceCommandCategory;
  }
  throw new Error(`unsupported category ${value}; supported values: ${commandCategories.join(", ")}`);
}

function parseSessionMode(value: string): RunServiceSessionMode {
  const normalized = value.trim().toLowerCase();
  if (sessionModes.includes(normalized as RunServiceSessionMode)) {
    return normalized as RunServiceSessionMode;
  }
  throw new Error(`unsupported session mode ${value}; supported values: ${sessionModes.join(", ")}`);
}

function parseUiRuntimeMode(value: string): RunServiceUiRuntimeMode {
  const normalized = value.trim().toLowerCase();
  if (uiRuntimeModes.includes(normalized as RunServiceUiRuntimeMode)) {
    return normalized as RunServiceUiRuntimeMode;
  }
  throw new Error(`unsupported UI runtime ${value}; supported values: ${uiRuntimeModes.join(", ")}`);
}

function takeValue(args: string[], index: number, flag: string): string {
  if (index >= args.length || args[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}

