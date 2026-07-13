import { describe, expect, it } from "vitest";
import type { RunServiceClient } from "../../src/main/run-service-http-client";
import {
  parseHarnessArgs,
  RunServiceHarness,
} from "../../src/main/run-service-harness";

describe("RunServiceHarness", () => {
  it("returns an acceptable verdict from typed run and artifact evidence", async () => {
    const client = new HarnessClient();
    const verdict = await new RunServiceHarness(client, "http://service").run({
      prompt: "create dashboard",
      sessionMode: "new",
      uiRuntime: "headless",
      requireTools: ["Dashboard", "WebView"],
      requireArtifactKinds: ["dashboard"],
    });

    expect(verdict.ok).toBe(true);
    expect(verdict).toMatchObject({
      kind: "finagent.self-update-harness-verdict.v1",
      endpoint: "http://service",
      runId: "run-1",
      status: "completed",
      reportArtifactSummary: { ok: true, id: "workflow-run-1" },
    });
    expect(verdict.checks.every((check) => check.ok)).toBe(true);
    expect(client.posts[0]).toMatchObject({
      path: "/runs",
      body: {
        prompt: "create dashboard",
        sessionMode: "new",
        uiRuntime: "headless",
        payload: {
          harness: "finagent.self-update-harness.v1",
          requiredTools: ["Dashboard", "WebView"],
          requiredArtifactKinds: ["dashboard"],
        },
      },
    });
  });

  it("returns a rejected verdict when required evidence is absent", async () => {
    const client = new HarnessClient();
    client.runResult = {
      runId: "run-1",
      status: "failed",
      finalAnswer: "",
      events: [],
    };

    const verdict = await new RunServiceHarness(client).run({
      prompt: "planned failure",
      sessionMode: "new",
      uiRuntime: "headless",
      requireTools: ["WebView"],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "run.completed", ok: false }),
        expect.objectContaining({ name: "tool.WebView", ok: false }),
      ]),
    );
  });

  it("audits an existing run without starting another model turn", async () => {
    const client = new HarnessClient();

    const verdict = await new RunServiceHarness(client).run({
      runId: "run-1",
      sessionMode: "new",
      uiRuntime: "headless",
      requireTools: ["WebView"],
    });

    expect(verdict.ok).toBe(true);
    expect(client.posts).toHaveLength(0);
    expect(client.gets).toContain("/runs/run-1/result");
  });

  it("parses explicit runtime, session, and evidence requirements", () => {
    expect(
      parseHarnessArgs([
        "--endpoint",
        "http://127.0.0.1:4000",
        "--prompt",
        "inspect",
        "--session",
        "resume",
        "--session-id",
        "session-1",
        "--ui-runtime",
        "mirror",
        "--require-tool",
        "Dashboard",
        "--require-tool",
        "WebView",
        "--require-artifact",
        "dashboard",
      ]),
    ).toEqual({
      endpoint: "http://127.0.0.1:4000",
      prompt: "inspect",
      sessionMode: "resume",
      sessionId: "session-1",
      uiRuntime: "mirror",
      requireTools: ["Dashboard", "WebView"],
      requireArtifactKinds: ["dashboard"],
    });
  });
});

class HarnessClient implements RunServiceClient {
  readonly gets: string[] = [];
  readonly posts: Array<{
    path: string;
    body?: Record<string, unknown>;
  }> = [];
  runResult: Record<string, unknown> = {
    runId: "run-1",
    sessionId: "session-1",
    status: "completed",
    finalAnswer: "dashboard created",
    events: [
      { type: "run.created", payload: {} },
      { type: "tool.call", payload: { tool: "Dashboard" } },
      { type: "tool.call", payload: { toolName: "WebView" } },
      { type: "artifact.created", payload: { kind: "dashboard" } },
      {
        type: "run.completed",
        payload: {
          provenance: { reportPath: "/reports/workflow-run-1.json" },
        },
      },
    ],
  };

  async get(path: string): Promise<Record<string, unknown>> {
    this.gets.push(path);
    if (path === "/runs/capabilities") {
      return { contract: "finagent.run-service.v1" };
    }
    if (path === "/adapter/capabilities") {
      return { adapterContract: "finagent.service-adapter.v1" };
    }
    if (path === "/artifacts?limit=100") {
      return {
        ok: true,
        artifacts: [{ id: "workflow-run-1", runId: "workflow-run-1" }],
      };
    }
    if (path === "/artifacts/workflow-run-1") {
      return { ok: true, id: "workflow-run-1" };
    }
    if (path === "/runs/run-1/result") return this.runResult;
    throw new Error(`unexpected GET ${path}`);
  }

  async post(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.posts.push({ path, body });
    if (path === "/runs") return this.runResult;
    throw new Error(`unexpected POST ${path}`);
  }
}
