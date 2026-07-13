#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import {
  RunServiceHttpClient,
  type RunServiceClient,
} from "./run-service-http-client";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type AdapterTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (
    client: RunServiceClient,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

export class RunServiceMcpAdapter {
  constructor(private readonly client: RunServiceClient) {}

  async handle(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
    const id = request.id ?? null;
    if (request.method === "notifications/initialized") return null;
    if (request.method === "initialize") {
      return success(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "finagent-run-service", version: "1.0.0" },
      });
    }
    if (request.method === "tools/list") {
      return success(id, {
        tools: adapterTools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    }
    if (request.method === "tools/call") {
      const params = record(request.params);
      const name = String(params.name ?? "");
      const tool = adapterTools.find((candidate) => candidate.name === name);
      if (!tool) return toolFailure(id, `MCP_TOOL_NOT_FOUND: ${name || "-"}`);
      try {
        const result = await tool.call(this.client, record(params.arguments));
        return success(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        return toolFailure(id, errorMessage(error));
      }
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    };
  }
}

const adapterTools: AdapterTool[] = [
  tool(
    "finagent.workflow.run",
    "Start a FinAgent run with explicit session and UI runtime semantics.",
    {
      prompt: stringProperty("User task or structured command prompt."),
      sessionMode: enumProperty(["new", "resume", "preload", "ephemeral", "attached"]),
      uiRuntime: enumProperty(["visible", "headless", "mirror"]),
      sessionId: stringProperty("Required for resume and preload."),
      timeoutMs: { type: "integer", minimum: 1 },
      payload: { type: "object" },
    },
    ["prompt"],
    (client, input) => client.post("/runs", input),
  ),
  tool(
    "finagent.workflow.list",
    "List recent run summaries, including frontend-created runs.",
    { limit: { type: "integer", minimum: 1, maximum: 100 } },
    [],
    (client, input) =>
      client.get(`/runs?limit=${positiveInteger(input.limit, 20)}`),
  ),
  runIdTool(
    "finagent.workflow.events",
    "Replay typed run events after a durable sequence cursor.",
    (client, input, runId) =>
      client.get(
        `/runs/${encodeURIComponent(runId)}/events?after=${positiveInteger(input.after, 0)}`,
      ),
    { after: { type: "integer", minimum: 0 } },
  ),
  runIdTool(
    "finagent.workflow.result",
    "Fetch the final run snapshot with trace and artifacts.",
    (client, _input, runId) =>
      client.get(`/runs/${encodeURIComponent(runId)}/result`),
  ),
  runIdTool(
    "finagent.workflow.state",
    "Inspect one typed run state snapshot without reading session files or logs.",
    (client, _input, runId) =>
      client.get(`/runs/${encodeURIComponent(runId)}/state`),
  ),
  runIdTool(
    "finagent.workflow.messages",
    "Read bounded run-scoped user, assistant, and tool message envelopes.",
    (client, input, runId) =>
      client.get(
        `/runs/${encodeURIComponent(runId)}/messages?after=${positiveInteger(input.after, 0)}`,
      ),
    { after: { type: "integer", minimum: 0 } },
  ),
  runIdTool(
    "finagent.workflow.wait",
    "Wait a bounded interval for typed events or terminal run state.",
    (client, input, runId) =>
      client.get(
        `/runs/${encodeURIComponent(runId)}/wait?after=${positiveInteger(input.after, 0)}&timeoutMs=${positiveInteger(input.timeoutMs, 5000)}`,
      ),
    {
      after: { type: "integer", minimum: 0 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 30000 },
    },
  ),
  runIdTool(
    "finagent.workflow.pending",
    "Inspect pending questions and permission requests.",
    (client, _input, runId) =>
      client.get(`/runs/${encodeURIComponent(runId)}/pending`),
  ),
  runIdTool(
    "finagent.workflow.answer",
    "Answer a pending AskUserQuestion with an explicit caller-selected value.",
    (client, input, runId) =>
      client.post(`/runs/${encodeURIComponent(runId)}/responses`, {
        answer: requiredString(input, "answer"),
        ...(input.requestId != null
          ? { requestId: String(input.requestId) }
          : {}),
        ...(input.timeoutMs != null
          ? { timeoutMs: positiveInteger(input.timeoutMs, 120_000) }
          : {}),
      }),
    {
      requestId: stringProperty("Pending interaction request id when available."),
      answer: stringProperty("Explicit option id, label, or caller answer."),
      timeoutMs: { type: "integer", minimum: 1 },
    },
    ["answer"],
  ),
  runIdTool(
    "finagent.workflow.permission",
    "Resolve a pending permission request explicitly.",
    (client, input, runId) =>
      client.post(`/runs/${encodeURIComponent(runId)}/permissions`, {
        approved: input.approved === true,
        alwaysAllow: input.alwaysAllow === true,
        ...(input.requestId != null
          ? { requestId: String(input.requestId) }
          : {}),
        ...(input.rejectReason != null
          ? { rejectReason: String(input.rejectReason) }
          : {}),
      }),
    {
      requestId: stringProperty("Pending permission request id when available."),
      approved: { type: "boolean" },
      alwaysAllow: { type: "boolean" },
      rejectReason: stringProperty("Reason supplied when denying permission."),
    },
    ["approved"],
  ),
  runIdTool(
    "finagent.workflow.interrupt",
    "Request idempotent cancellation of an active run.",
    (client, input, runId) =>
      client.post(`/runs/${encodeURIComponent(runId)}/interrupt`, {
        reason: String(input.reason ?? "mcp-adapter-interrupt"),
      }),
    { reason: stringProperty("Cancellation reason.") },
  ),
  tool(
    "finagent.session.current",
    "Inspect active session evidence.",
    {},
    [],
    (client) => client.get("/sessions/current"),
  ),
  tool(
    "finagent.session.list",
    "List durable sessions without switching context.",
    {},
    [],
    (client) => client.get("/sessions"),
  ),
  tool(
    "finagent.session.resume",
    "Start a run by resuming an explicit durable session id.",
    {
      sessionId: stringProperty("Durable session id."),
      prompt: stringProperty("Task to run in the resumed session."),
      uiRuntime: enumProperty(["visible", "headless", "mirror"]),
      timeoutMs: { type: "integer", minimum: 1 },
    },
    ["sessionId", "prompt"],
    (client, input) =>
      client.post("/runs", {
        prompt: requiredString(input, "prompt"),
        sessionMode: "resume",
        sessionId: requiredString(input, "sessionId"),
        uiRuntime: String(input.uiRuntime ?? "headless"),
        ...(input.timeoutMs != null
          ? { timeoutMs: positiveInteger(input.timeoutMs, 120_000) }
          : {}),
      }),
  ),
  tool(
    "finagent.artifact.list",
    "List durable workflow report artifacts.",
    { limit: { type: "integer", minimum: 1, maximum: 100 } },
    [],
    (client, input) =>
      client.get(`/artifacts?limit=${positiveInteger(input.limit, 20)}`),
  ),
  tool(
    "finagent.artifact.get",
    "Fetch a durable workflow artifact by id.",
    { artifactId: stringProperty("Artifact id from finagent.artifact.list.") },
    ["artifactId"],
    (client, input) =>
      client.get(
        `/artifacts/${encodeURIComponent(requiredString(input, "artifactId"))}`,
      ),
  ),
  tool(
    "finagent.capability.help",
    "Discover service routes, session/UI modes, reply flow, and adapter operations.",
    {},
    [],
    async (client) => ({
      service: await client.get("/runs/capabilities"),
      adapter: await client.get("/adapter/capabilities"),
    }),
  ),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  call: AdapterTool["call"],
): AdapterTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    call,
  };
}

function runIdTool(
  name: string,
  description: string,
  call: (
    client: RunServiceClient,
    input: Record<string, unknown>,
    runId: string,
  ) => Promise<Record<string, unknown>>,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): AdapterTool {
  return tool(
    name,
    description,
    { runId: stringProperty("Run id."), ...properties },
    ["runId", ...required],
    (client, input) => call(client, input, requiredString(input, "runId")),
  );
}

function success(
  id: string | number | null,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function toolFailure(
  id: string | number | null,
  message: string,
): Record<string, unknown> {
  return success(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function stringProperty(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function enumProperty(values: string[]): Record<string, unknown> {
  return { type: "string", enum: values };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = String(input[key] ?? "").trim();
  if (!value) throw new Error(`MCP_INVALID_ARGUMENT: ${key} is required`);
  return value;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runRunServiceMcpAdapter(input: {
  input?: NodeJS.ReadableStream;
  output?: Pick<NodeJS.WritableStream, "write">;
  errors?: Pick<NodeJS.WritableStream, "write">;
  adapter?: RunServiceMcpAdapter;
} = {}): Promise<void> {
  const source = input.input ?? stdin;
  const sink = input.output ?? stdout;
  const errors = input.errors ?? stderr;
  const endpoint =
    process.env.FINAGENT_RUN_SERVICE_ENDPOINT ?? "http://127.0.0.1:39173";
  const adapter =
    input.adapter ??
    new RunServiceMcpAdapter(new RunServiceHttpClient(endpoint));
  source.setEncoding("utf-8");
  let buffer = "";
  for await (const chunk of source) {
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await handleLine(line, adapter, sink, errors);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) await handleLine(buffer.trim(), adapter, sink, errors);
}

async function handleLine(
  line: string,
  adapter: RunServiceMcpAdapter,
  output: Pick<NodeJS.WritableStream, "write">,
  errors: Pick<NodeJS.WritableStream, "write">,
): Promise<void> {
  try {
    const response = await adapter.handle(JSON.parse(line) as JsonRpcRequest);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    errors.write(`run-service-mcp: ${errorMessage(error)}\n`);
    output.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRunServiceMcpAdapter().catch((error) => {
    stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
