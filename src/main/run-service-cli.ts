#!/usr/bin/env node
import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from "node:process";
import { parseRunServiceCommand, type RunServiceCommandPlan } from "../agent/run-service-contract";
import type { RunServiceRunRequest } from "../agent/run-service-controller";

export interface RunServiceCliDeps {
  postJson?: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getJson?: (path: string) => Promise<Record<string, unknown>>;
  stdin?: NodeJS.ReadableStream;
  stdout?: Pick<NodeJS.WritableStream, "write">;
  stderr?: Pick<NodeJS.WritableStream, "write">;
  endpoint?: string;
}

export async function runServiceCli(
  argv: string[],
  deps: RunServiceCliDeps = {},
): Promise<number> {
  const normalizedArgv = normalizeAliases(argv);
  const endpoint = String(readFlag(normalizedArgv, "--endpoint") ?? deps.endpoint ?? process.env.FINAGENT_RUN_SERVICE_ENDPOINT ?? "http://127.0.0.1:39173");
  const args = stripFlag(normalizedArgv, "--endpoint");
  const stdio = args.includes("--stdio");
  const commandArgs = args.filter((arg) => arg !== "--stdio");
  const stdout = deps.stdout ?? defaultStdout;
  const stderr = deps.stderr ?? defaultStderr;
  const postJson = deps.postJson ?? ((path, body) => httpJson(endpoint, "POST", path, body));
  const getJson = deps.getJson ?? ((path) => httpJson(endpoint, "GET", path));

  if (stdio) {
    await runStdioLoop({
      stdin: deps.stdin ?? defaultStdin,
      stdout,
      stderr,
      postJson,
      getJson,
    });
    return 0;
  }

  let plan: RunServiceCommandPlan;
  try {
    plan = parseRunServiceCommand(commandArgs);
  } catch (error) {
    stderr.write(`${String(error)}\n`);
    return 2;
  }
  if (plan.category === "capability") {
    const result = await getJson("/runs/capabilities");
    stdout.write(plan.jsonl
      ? `${JSON.stringify({ type: "result", result })}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const request = requestFromPlan(plan);
  const result = await postJson("/runs", request as unknown as Record<string, unknown>);
  if (plan.jsonl) {
    for (const event of Array.isArray(result.events) ? result.events : []) {
      stdout.write(`${JSON.stringify({ type: "event", event })}\n`);
    }
    stdout.write(`${JSON.stringify({ type: "result", result })}\n`);
  } else {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return result.status === "failed" ? 1 : 0;
}

export function requestFromPlan(plan: RunServiceCommandPlan): RunServiceRunRequest {
  const payload = {
    commandPlan: {
      category: plan.category,
      operation: plan.operation,
      payload: plan.payload,
    },
  };
  return {
    prompt: plan.prompt ?? controlPromptForPlan(plan),
    sessionMode: plan.sessionMode,
    uiRuntime: plan.uiRuntime,
    ...(plan.sessionId ? { sessionId: plan.sessionId } : {}),
    payload,
  };
}

function controlPromptForPlan(plan: RunServiceCommandPlan): string {
  const payload = JSON.stringify(plan.payload);
  return [
    `Execute FinAgent structured command ${plan.category}.${plan.operation}.`,
    "Use the request payload as structured control data; do not infer intent from this sentence.",
    `payload: ${payload}`,
  ].join("\n");
}

async function runStdioLoop(input: {
  stdin: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WritableStream, "write">;
  stderr: Pick<NodeJS.WritableStream, "write">;
  postJson: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getJson: (path: string) => Promise<Record<string, unknown>>;
}): Promise<void> {
  input.stdin.setEncoding("utf-8");
  let buffer = "";
  for await (const chunk of input.stdin) {
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await handleStdioLine(line, input);
      newline = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail) await handleStdioLine(tail, input);
}

async function handleStdioLine(
  line: string,
  input: {
    stdout: Pick<NodeJS.WritableStream, "write">;
    stderr: Pick<NodeJS.WritableStream, "write">;
    postJson: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getJson: (path: string) => Promise<Record<string, unknown>>;
  },
): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(line);
  } catch (error) {
    input.stdout.write(`${JSON.stringify({ ok: false, error: `invalid json: ${String(error)}` })}\n`);
    return;
  }
  const id = message.id;
  const method = String(message.method ?? "");
  const params = isRecord(message.params) ? message.params : {};
  try {
    if (method === "run") {
      const result = await input.postJson("/runs", params);
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "events") {
      const runId = String(params.runId ?? "");
      const after = Number(params.after ?? 0);
      if (!runId) throw new Error("events requires params.runId");
      const result = await input.getJson(`/runs/${encodeURIComponent(runId)}/events?after=${Number.isFinite(after) ? after : 0}`);
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "result") {
      const runId = String(params.runId ?? "");
      if (!runId) throw new Error("result requires params.runId");
      const result = await input.getJson(`/runs/${encodeURIComponent(runId)}/result`);
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "capability") {
      const result = await input.getJson("/runs/capabilities");
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "session.current") {
      const result = await input.getJson("/sessions/current");
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "session.list") {
      const result = await input.getJson("/sessions");
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "session.create") {
      const result = await input.postJson("/sessions", {
        ...(params.reason != null ? { reason: String(params.reason) } : {}),
      });
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "respond") {
      const runId = String(params.runId ?? "");
      const answer = String(params.answer ?? "");
      if (!runId) throw new Error("respond requires params.runId");
      if (!answer.trim()) throw new Error("respond requires params.answer");
      const result = await input.postJson(`/runs/${encodeURIComponent(runId)}/responses`, {
        answer,
        ...(Number.isFinite(Number(params.timeoutMs))
          ? { timeoutMs: Number(params.timeoutMs) }
          : {}),
      });
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "permission") {
      const runId = String(params.runId ?? "");
      if (!runId) throw new Error("permission requires params.runId");
      const result = await input.postJson(`/runs/${encodeURIComponent(runId)}/permissions`, {
        approved: params.approved === true,
        alwaysAllow: params.alwaysAllow === true,
        ...(params.rejectReason != null
          ? { rejectReason: String(params.rejectReason) }
          : {}),
      });
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    if (method === "interrupt") {
      const runId = String(params.runId ?? "");
      if (!runId) throw new Error("interrupt requires params.runId");
      const result = await input.postJson(`/runs/${encodeURIComponent(runId)}/interrupt`, {
        reason: String(params.reason ?? "stdio-interrupt"),
      });
      input.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      return;
    }
    throw new Error(`unsupported method: ${method || "-"}`);
  } catch (error) {
    input.stdout.write(`${JSON.stringify({ id, ok: false, error: String(error) })}\n`);
  }
}

async function httpJson(
  endpoint: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = new URL(path, endpoint);
  const response = await fetch(url, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await response.text();
  const parsed = text.trim() ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return parsed;
}

function normalizeAliases(argv: string[]): string[] {
  if (argv[0] === "serve") return ["service", "serve", ...argv.slice(1)];
  return argv;
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function stripFlag(argv: string[], flag: string): string[] {
  const index = argv.indexOf(flag);
  if (index < 0) return argv;
  return argv.filter((_, itemIndex) => itemIndex !== index && itemIndex !== index + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServiceCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    defaultStderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
