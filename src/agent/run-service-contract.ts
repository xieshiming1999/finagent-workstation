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

export const runServiceCommandCategories: RunServiceCommandCategory[] = [
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

export const runServiceSessionModes: RunServiceSessionMode[] = [
  "new",
  "resume",
  "preload",
  "ephemeral",
  "attached",
];

export const runServiceUiRuntimeModes: RunServiceUiRuntimeMode[] = [
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
  "--session-id <id>, --ui-runtime <visible|headless|mirror>, --jsonl, " +
  "--ensure-service, --service-timeout-ms <ms>";

export function runServiceCapabilityDescriptor(input: {
  runtime: "mobile" | "workstation";
  transport?: string;
  routes?: string[];
  supportsCli?: boolean;
  supportsStdio?: boolean;
  supportsFrontendBridge?: boolean;
  supportsHeadlessUi?: boolean;
  supportsMirrorUi?: boolean;
  supportsPermissionResponse?: boolean;
  notes?: string[];
}): Record<string, unknown> {
  const routes = input.routes ?? [
    "POST /runs",
    "POST /runs/start",
    "GET /runs",
    "GET /runs/{runId}/events?after={sequence}",
    "GET /runs/{runId}/result",
    "GET /runs/{runId}/state",
    "GET /runs/{runId}/messages?after={sequence}",
    "GET /runs/{runId}/wait?after={sequence}&timeoutMs={bounded}",
    "GET /runs/{runId}/stream?after={sequence}",
    "GET /runs/{runId}/pending",
    "POST /runs/{runId}/responses",
    ...(input.supportsPermissionResponse
      ? ["POST /runs/{runId}/permissions"]
      : []),
    "POST /runs/{runId}/interrupt",
    "GET /runs/capabilities",
    "GET /sessions",
    "POST /sessions",
    "GET /sessions/current",
    "GET /artifacts",
    "GET /artifacts/{artifactId}",
  ];
  return {
    ok: true,
    contract: "finagent.run-service.v1",
    runtime: input.runtime,
    transport: input.transport ?? "loopback-http",
    commandHelp: runServiceCommandHelp,
    categories: runServiceCommandCategories,
    sessionModes: runServiceSessionModes,
    uiRuntimeModes: runServiceUiRuntimeModes,
    eventTypes: runServiceEventTypes,
    routes,
    transports: {
      http: true,
      cli: input.supportsCli ?? false,
      stdio: input.supportsStdio ?? false,
      frontendBridge: input.supportsFrontendBridge ?? false,
    },
    uiRuntime: {
      visible: true,
      headless: input.supportsHeadlessUi ?? false,
      mirror: input.supportsMirrorUi ?? false,
    },
    interaction: {
      userQuestionResponse: true,
      permissionResponse: input.supportsPermissionResponse ?? false,
      hiddenAutoAnswer: false,
    },
    notes: input.notes ?? [],
  };
}

export function runServiceAdapterDescriptor(input: {
  runtime: "mobile" | "workstation";
  supportsPermissionResponse?: boolean;
  supportsStdio?: boolean;
  supportsCli?: boolean;
  supportsFrontendBridge?: boolean;
}): Record<string, unknown> {
  const capability = runServiceCapabilityDescriptor(input);
  const operations = [
    operationDescriptor("finagent.workflow.run", "POST /runs", "Start a run with prompt, session mode, UI runtime, and optional structured payload."),
    operationDescriptor("finagent.workflow.start", "POST /runs/start", "Admit a run immediately and return its run id for streaming clients."),
    operationDescriptor("finagent.workflow.list", "GET /runs", "List recent run summaries, including frontend-created runs."),
    operationDescriptor("finagent.workflow.events", "GET /runs/{runId}/events?after={sequence}", "Replay typed run events after a sequence cursor."),
    operationDescriptor("finagent.workflow.result", "GET /runs/{runId}/result", "Fetch the final run snapshot with answer, trace, artifacts, and errors."),
    operationDescriptor("finagent.workflow.state", "GET /runs/{runId}/state", "Inspect one typed run state snapshot without reading session files or logs."),
    operationDescriptor("finagent.workflow.messages", "GET /runs/{runId}/messages?after={sequence}", "Read bounded run-scoped user, assistant, and tool message envelopes."),
    operationDescriptor("finagent.workflow.wait", "GET /runs/{runId}/wait?after={sequence}&timeoutMs={bounded}", "Wait a bounded interval for typed events or terminal run state."),
    operationDescriptor("finagent.workflow.stream", "GET /runs/{runId}/stream?after={sequence}", "Stream typed run events as NDJSON until the run reaches terminal state."),
    operationDescriptor("finagent.workflow.pending", "GET /runs/{runId}/pending", "Inspect pending AskUserQuestion and permission requests for a run."),
    operationDescriptor("finagent.workflow.answer", "POST /runs/{runId}/responses", "Answer a pending AskUserQuestion with an explicit caller-selected value."),
    ...(input.supportsPermissionResponse
      ? [operationDescriptor("finagent.workflow.permission", "POST /runs/{runId}/permissions", "Resolve a pending permission request with an explicit approve/deny decision.")]
      : []),
    operationDescriptor("finagent.workflow.interrupt", "POST /runs/{runId}/interrupt", "Request cancellation for a run."),
    operationDescriptor("finagent.session.current", "GET /sessions/current", "Inspect the active session evidence."),
    operationDescriptor("finagent.session.list", "GET /sessions", "List current and archived sessions without switching context."),
    operationDescriptor("finagent.session.create", "POST /sessions", "Archive the current session and create a fresh active session."),
    operationDescriptor("finagent.session.resume", "POST /runs", "Start a run by resuming an explicit durable session id."),
    operationDescriptor("finagent.artifact.list", "GET /artifacts", "List workflow artifacts available to external callers."),
    operationDescriptor("finagent.artifact.get", "GET /artifacts/{artifactId}", "Fetch a workflow artifact by id."),
    operationDescriptor("finagent.capability.help", "GET /runs/capabilities", "Inspect the run-service contract and supported routes."),
  ];
  return {
    ok: true,
    kind: "run-service-adapter",
    contract: "finagent.run-service.v1",
    adapterContract: "finagent.service-adapter.v1",
    runtime: input.runtime,
    transports: capability.transports,
    operations,
    notes: [
      "The packaged finagent-run-service-mcp stdio executable maps these operations to the run-service HTTP contract.",
      "Callers must handle AskUserQuestion and permission replies explicitly; no hidden answer selection is provided.",
    ],
  };
}

function operationDescriptor(id: string, route: string, description: string): Record<string, string> {
  return { id, route, description };
}

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

  if ((sessionMode === "resume" || sessionMode === "preload") && !sessionId) {
    throw new Error(`--session-id is required when --session ${sessionMode}`);
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
  if (runServiceCommandCategories.includes(normalized as RunServiceCommandCategory)) {
    return normalized as RunServiceCommandCategory;
  }
  throw new Error(`unsupported category ${value}; supported values: ${runServiceCommandCategories.join(", ")}`);
}

function parseSessionMode(value: string): RunServiceSessionMode {
  const normalized = value.trim().toLowerCase();
  if (runServiceSessionModes.includes(normalized as RunServiceSessionMode)) {
    return normalized as RunServiceSessionMode;
  }
  throw new Error(`unsupported session mode ${value}; supported values: ${runServiceSessionModes.join(", ")}`);
}

function parseUiRuntimeMode(value: string): RunServiceUiRuntimeMode {
  const normalized = value.trim().toLowerCase();
  if (runServiceUiRuntimeModes.includes(normalized as RunServiceUiRuntimeMode)) {
    return normalized as RunServiceUiRuntimeMode;
  }
  throw new Error(`unsupported UI runtime ${value}; supported values: ${runServiceUiRuntimeModes.join(", ")}`);
}

function takeValue(args: string[], index: number, flag: string): string {
  if (index >= args.length || args[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}
