#!/usr/bin/env node
import { stdout, stderr } from "node:process";
import { basename, extname } from "node:path";
import {
  RunServiceHttpClient,
  type RunServiceClient,
} from "./run-service-http-client";

export type HarnessRequest = {
  prompt?: string;
  runId?: string;
  sessionMode: "new" | "resume" | "preload" | "ephemeral" | "attached";
  uiRuntime: "visible" | "headless" | "mirror";
  sessionId?: string;
  timeoutMs?: number;
  requireTools?: string[];
  requireArtifactKinds?: string[];
};

export type HarnessVerdict = {
  ok: boolean;
  kind: "finagent.self-update-harness-verdict.v1";
  endpoint?: string;
  runId: string | null;
  status: string;
  checks: Array<{
    name: string;
    ok: boolean;
    expected?: unknown;
    actual?: unknown;
  }>;
  resultSummary: Record<string, unknown>;
  artifactIndexSummary: Record<string, unknown>;
  reportArtifactSummary?: Record<string, unknown>;
};

export class RunServiceHarness {
  constructor(
    private readonly client: RunServiceClient,
    private readonly endpoint?: string,
  ) {}

  async run(request: HarnessRequest): Promise<HarnessVerdict> {
    const capabilities = await this.client.get("/runs/capabilities");
    const adapter = await this.client.get("/adapter/capabilities");
    const result = request.runId
      ? await this.client.get(
          `/runs/${encodeURIComponent(request.runId)}/result`,
        )
      : await this.client.post("/runs", {
          prompt: request.prompt,
          sessionMode: request.sessionMode,
          uiRuntime: request.uiRuntime,
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
          payload: {
            harness: "finagent.self-update-harness.v1",
            requiredTools: request.requireTools ?? [],
            requiredArtifactKinds: request.requireArtifactKinds ?? [],
          },
        });
    const runId = optionalString(result.runId);
    const events = arrayOfRecords(result.events);
    const toolNames = new Set(
      events
        .filter((event) => event.type === "tool.call")
        .map((event) =>
          String(record(event.payload).toolName ?? record(event.payload).tool ?? ""),
        )
        .filter(Boolean),
    );
    const artifactKinds = new Set(
      events
        .filter(
          (event) =>
            event.type === "artifact.created" || event.type === "artifact.updated",
        )
        .map((event) => String(record(event.payload).kind ?? ""))
        .filter(Boolean),
    );
    const eventTypes = new Set(events.map((event) => String(event.type ?? "")));
    const terminalEvent = events.find((event) => event.type === "run.completed");
    const terminalProvenance = record(record(terminalEvent?.payload).provenance);
    const reportPath = optionalString(terminalProvenance.reportPath);
    const reportId = reportPath
      ? basename(reportPath, extname(reportPath))
      : null;
    const status = String(result.status ?? "unknown");
    const checks: HarnessVerdict["checks"] = [
      check("service.contract", capabilities.contract === "finagent.run-service.v1", "finagent.run-service.v1", capabilities.contract),
      check("adapter.contract", adapter.adapterContract === "finagent.service-adapter.v1", "finagent.service-adapter.v1", adapter.adapterContract),
      check("run.id", Boolean(runId), "non-empty", runId),
      check("run.completed", status === "completed", "completed", status),
      check("event.run.created", eventTypes.has("run.created"), true, [...eventTypes]),
      check("event.terminal", eventTypes.has("run.completed"), "run.completed", [...eventTypes]),
      check("result.finalAnswer", Boolean(optionalString(result.finalAnswer)), "non-empty", result.finalAnswer),
      check("result.sessionId", Boolean(optionalString(result.sessionId)), "non-empty", result.sessionId),
    ];
    for (const toolName of request.requireTools ?? []) {
      checks.push(
        check(`tool.${toolName}`, toolNames.has(toolName), toolName, [...toolNames]),
      );
    }
    for (const kind of request.requireArtifactKinds ?? []) {
      checks.push(
        check(
          `artifact.${kind}`,
          artifactKinds.has(kind),
          kind,
          [...artifactKinds],
        ),
      );
    }
    const artifactIndex = await this.client.get("/artifacts?limit=100");
    const artifact = arrayOfRecords(artifactIndex.artifacts).find(
      (candidate) =>
        String(candidate.id ?? "") === reportId ||
        String(candidate.runId ?? candidate.id ?? "") === runId ||
        String(candidate.id ?? "").includes(runId ?? "__missing__"),
    );
    checks.push(
      check(
        "artifact.report.indexed",
        Boolean(artifact),
        reportId ?? runId,
        artifact?.id ?? null,
      ),
    );
    let reportArtifactSummary: Record<string, unknown> | undefined;
    if (artifact?.id) {
      const reportArtifact = await this.client.get(
        `/artifacts/${encodeURIComponent(String(artifact.id))}`,
      );
      checks.push(
        check(
          "artifact.report.retrievable",
          reportArtifact.ok === true,
          true,
          reportArtifact.ok,
        ),
      );
      reportArtifactSummary = {
        ok: reportArtifact.ok,
        id: reportArtifact.id,
        path: reportArtifact.path,
        kind: reportArtifact.kind,
      };
    }
    return {
      ok: checks.every((item) => item.ok),
      kind: "finagent.self-update-harness-verdict.v1",
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      runId,
      status,
      checks,
      resultSummary: {
        runId,
        sessionId: result.sessionId,
        status,
        finalAnswerPreview: preview(result.finalAnswer, 1000),
        eventCount: events.length,
        eventTypes: [...eventTypes],
        toolNames: [...toolNames],
        artifactKinds: [...artifactKinds],
        provenance: terminalProvenance,
      },
      artifactIndexSummary: {
        ok: artifactIndex.ok,
        count: artifactIndex.count,
        matchedArtifactId: artifact?.id ?? null,
        expectedReportId: reportId,
      },
      ...(reportArtifactSummary ? { reportArtifactSummary } : {}),
    };
  }
}

function check(
  name: string,
  ok: boolean,
  expected?: unknown,
  actual?: unknown,
): HarnessVerdict["checks"][number] {
  return { name, ok, expected, actual };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function optionalString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function preview(value: unknown, maxLength: number): string {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

export function parseHarnessArgs(argv: string[]): HarnessRequest & {
  endpoint: string;
} {
  const endpoint =
    flag(argv, "--endpoint") ??
    process.env.FINAGENT_RUN_SERVICE_ENDPOINT ??
    "http://127.0.0.1:39173";
  const runId = flag(argv, "--run-id");
  const prompt = flag(argv, "--prompt") ?? positionalPrompt(argv);
  if (!prompt && !runId) throw new Error("--prompt or --run-id is required");
  const sessionMode = (flag(argv, "--session") ?? "new") as HarnessRequest["sessionMode"];
  const uiRuntime = (flag(argv, "--ui-runtime") ?? "headless") as HarnessRequest["uiRuntime"];
  if (!(["new", "resume", "preload", "ephemeral", "attached"] as string[]).includes(sessionMode)) {
    throw new Error(`unsupported --session ${sessionMode}`);
  }
  if (!(["visible", "headless", "mirror"] as string[]).includes(uiRuntime)) {
    throw new Error(`unsupported --ui-runtime ${uiRuntime}`);
  }
  const sessionId = flag(argv, "--session-id");
  if ((sessionMode === "resume" || sessionMode === "preload") && !sessionId) {
    throw new Error(`--session-id is required for ${sessionMode}`);
  }
  return {
    endpoint,
    ...(prompt ? { prompt } : {}),
    ...(runId ? { runId } : {}),
    sessionMode,
    uiRuntime,
    ...(sessionId ? { sessionId } : {}),
    ...(flag(argv, "--timeout-ms")
      ? { timeoutMs: Number(flag(argv, "--timeout-ms")) }
      : {}),
    requireTools: flags(argv, "--require-tool"),
    requireArtifactKinds: flags(argv, "--require-artifact"),
  };
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function flags(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function positionalPrompt(argv: string[]): string | undefined {
  const valueFlags = new Set([
    "--endpoint",
    "--prompt",
    "--run-id",
    "--session",
    "--session-id",
    "--ui-runtime",
    "--timeout-ms",
    "--require-tool",
    "--require-artifact",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    if (valueFlags.has(argv[index])) {
      index += 1;
      continue;
    }
    if (!argv[index].startsWith("--")) return argv[index];
  }
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const request = parseHarnessArgs(process.argv.slice(2));
    const client = new RunServiceHttpClient(
      request.endpoint,
      request.timeoutMs ?? 120_000,
    );
    const verdict = await new RunServiceHarness(client, request.endpoint).run(
      request,
    );
    stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exitCode = verdict.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
