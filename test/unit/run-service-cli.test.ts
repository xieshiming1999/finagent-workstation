import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { requestFromPlan, runServiceCli } from "../../src/main/run-service-cli";
import { parseRunServiceCommand } from "../../src/agent/run-service-contract";

describe("run service CLI", () => {
  it("builds a plain-text one-shot run request", async () => {
    const writes: string[] = [];
    const code = await runServiceCli(
      ["run", "今天市场怎么样？", "--jsonl", "--session", "new", "--ui-runtime", "headless"],
      {
        stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
        stderr: { write: () => true },
        postJson: async (_path, body) => {
          expect(body).toMatchObject({
            prompt: "今天市场怎么样？",
            sessionMode: "new",
            uiRuntime: "headless",
          });
          return {
            runId: "run-1",
            status: "completed",
            events: [{ type: "run.created" }, { type: "run.completed" }],
          };
        },
      },
    );
    expect(code).toBe(0);
    expect(writes.join("")).toContain('"type":"event"');
    expect(writes.join("")).toContain('"type":"result"');
  });

  it("can ensure the service host before a one-shot run", async () => {
    const writes: string[] = [];
    const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    let healthChecks = 0;
    const code = await runServiceCli(
      [
        "run",
        "今天市场怎么样？",
        "--jsonl",
        "--ensure-service",
        "--service-timeout-ms",
        "1000",
        "--endpoint",
        "http://127.0.0.1:39233",
      ],
      {
        stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
        stderr: { write: () => true },
        spawnProcess: (command, args, options) => {
          spawned.push({ command, args, env: options.env });
          return { pid: 23456, unref: () => undefined };
        },
        getJson: async (path) => {
          expect(path).toBe("/health");
          healthChecks++;
          if (healthChecks === 1) throw new Error("not running");
          return { ok: true, enabled: true };
        },
        postJson: async (path, body) => {
          expect(path).toBe("/runs");
          expect(body.prompt).toBe("今天市场怎么样？");
          return {
            runId: "run-ensure",
            status: "completed",
            events: [{ type: "run.completed" }],
          };
        },
      },
    );

    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT).toBe("39233");
    expect(healthChecks).toBeGreaterThanOrEqual(2);
    expect(writes.join("")).toContain('"run-ensure"');
  });

  it("preserves structured category commands as request payload", () => {
    const plan = parseRunServiceCommand([
      "analysis",
      "run",
      "--asset",
      "stock:300059",
      "--kind",
      "stock_research",
      "--jsonl",
    ]);
    const request = requestFromPlan(plan);
    expect(request.prompt).toContain("analysis.run");
    expect(request.payload).toMatchObject({
      commandPlan: {
        category: "analysis",
        operation: "run",
        payload: {
          asset: "stock:300059",
          kind: "stock_research",
        },
      },
    });
  });

  it("queries capabilities without starting a prompt run", async () => {
    const writes: string[] = [];
    const code = await runServiceCli(["capability", "help", "--jsonl"], {
      stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
      stderr: { write: () => true },
      getJson: async (path) => ({
        path,
        contract: "finagent.run-service.v1",
      }),
      postJson: async () => {
        throw new Error("capability should not post /runs");
      },
    });
    expect(code).toBe(0);
    expect(writes.join("")).toContain('"path":"/runs/capabilities"');
  });

  it("starts the workstation service host with workflow automation enabled", async () => {
    const writes: string[] = [];
    const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const code = await runServiceCli(
      ["service", "start", "--port", "39222", "--ui-runtime", "visible", "--jsonl"],
      {
        stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
        stderr: { write: () => true },
        spawnProcess: (command, args, options) => {
          spawned.push({ command, args, env: options.env });
          return { pid: 12345, unref: () => undefined };
        },
        postJson: async () => {
          throw new Error("service start should not post /runs");
        },
      },
    );
    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      command: "pnpm",
      args: ["exec", "electron-vite", "dev"],
    });
    expect(spawned[0].env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION).toBe("1");
    expect(spawned[0].env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT).toBe("39222");
    expect(spawned[0].env.FINAGENT_WORKSTATION_SERVICE_MODE).toBe("1");
    expect(JSON.parse(writes[0])).toMatchObject({
      type: "result",
      result: {
        kind: "service.started",
        endpoint: "http://127.0.0.1:39222",
        pid: 12345,
      },
    });
  });

  it("checks workstation service health without starting a prompt run", async () => {
    const writes: string[] = [];
    const code = await runServiceCli(["service", "status", "--jsonl"], {
      stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
      stderr: { write: () => true },
      getJson: async (path) => ({ path, enabled: true }),
      postJson: async () => {
        throw new Error("service status should not post /runs");
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(writes[0])).toMatchObject({
      type: "result",
      result: { path: "/health", enabled: true },
    });
  });

  it("routes stdio JSONL run, events, and result methods", async () => {
    const writes: string[] = [];
    const stdin = Readable.from([
      JSON.stringify({ id: "1", method: "run", params: { prompt: "hello" } }) + "\n",
      JSON.stringify({ id: "2", method: "events", params: { runId: "run-1", after: 0 } }) + "\n",
      JSON.stringify({ id: "3", method: "result", params: { runId: "run-1" } }) + "\n",
      JSON.stringify({ id: "4", method: "pending", params: { runId: "run-1" } }) + "\n",
      JSON.stringify({ id: "5", method: "respond", params: { runId: "run-1", answer: "1" } }) + "\n",
      JSON.stringify({ id: "6", method: "permission", params: { runId: "run-1", approved: true, alwaysAllow: true } }) + "\n",
      JSON.stringify({ id: "7", method: "interrupt", params: { runId: "run-1", reason: "stop" } }) + "\n",
      JSON.stringify({ id: "8", method: "capability", params: {} }) + "\n",
      JSON.stringify({ id: "9", method: "session.current", params: {} }) + "\n",
      JSON.stringify({ id: "10", method: "session.list", params: {} }) + "\n",
      JSON.stringify({ id: "11", method: "session.create", params: { reason: "new context" } }) + "\n",
      JSON.stringify({ id: "12", method: "artifact.list", params: { limit: 3 } }) + "\n",
      JSON.stringify({ id: "13", method: "artifact.get", params: { artifactId: "run-1" } }) + "\n",
      JSON.stringify({ id: "14", method: "adapter.capability", params: {} }) + "\n",
    ]);
    const code = await runServiceCli(["serve", "--stdio"], {
      stdin,
      stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
      stderr: { write: () => true },
      postJson: async (_path, body) => ({
        runId: _path.includes("/responses")
          ? "run-1-response"
          : _path.includes("/permissions")
            ? "run-1-permission"
          : _path.includes("/interrupt")
            ? "run-1-interrupt"
            : "run-1",
        status: body.prompt === "hello" ? "completed" : "failed",
        answer: body.answer,
        approved: body.approved,
        alwaysAllow: body.alwaysAllow,
        reason: body.reason,
      }),
      getJson: async (path) => ({
        path,
        ok: true,
      }),
    });
    expect(code).toBe(0);
    const messages = writes.map((line) => JSON.parse(line));
    expect(messages).toHaveLength(14);
    expect(messages[0]).toMatchObject({ id: "1", ok: true });
    expect(messages[1]).toMatchObject({ id: "2", ok: true, result: { path: "/runs/run-1/events?after=0" } });
    expect(messages[2]).toMatchObject({ id: "3", ok: true, result: { path: "/runs/run-1/result" } });
    expect(messages[3]).toMatchObject({ id: "4", ok: true, result: { path: "/runs/run-1/pending" } });
    expect(messages[4]).toMatchObject({ id: "5", ok: true, result: { runId: "run-1-response", answer: "1" } });
    expect(messages[5]).toMatchObject({ id: "6", ok: true, result: { runId: "run-1-permission", approved: true, alwaysAllow: true } });
    expect(messages[6]).toMatchObject({ id: "7", ok: true, result: { runId: "run-1-interrupt", reason: "stop" } });
    expect(messages[7]).toMatchObject({ id: "8", ok: true, result: { path: "/runs/capabilities" } });
    expect(messages[8]).toMatchObject({ id: "9", ok: true, result: { path: "/sessions/current" } });
    expect(messages[9]).toMatchObject({ id: "10", ok: true, result: { path: "/sessions" } });
    expect(messages[10]).toMatchObject({ id: "11", ok: true, result: { runId: "run-1" } });
    expect(messages[11]).toMatchObject({ id: "12", ok: true, result: { path: "/artifacts?limit=3" } });
    expect(messages[12]).toMatchObject({ id: "13", ok: true, result: { path: "/artifacts/run-1" } });
    expect(messages[13]).toMatchObject({ id: "14", ok: true, result: { path: "/adapter/capabilities" } });
  });

  it("keeps reading stdio replies while a run request is waiting", async () => {
    const writes: string[] = [];
    const postPaths: string[] = [];
    let finishRun!: (value: Record<string, unknown>) => void;
    const waitingRun = new Promise<Record<string, unknown>>((resolve) => {
      finishRun = resolve;
    });
    const stdin = Readable.from([
      JSON.stringify({ id: "run", method: "run", params: { prompt: "fund selection" } }) + "\n",
      JSON.stringify({
        id: "answer",
        method: "respond",
        params: { runId: "run-fund", requestId: "ask-fund", answer: "long term" },
      }) + "\n",
    ]);

    const code = await runServiceCli(["serve", "--stdio"], {
      stdin,
      stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
      stderr: { write: () => true },
      postJson: async (path) => {
        postPaths.push(path);
        if (path === "/runs") return waitingRun;
        expect(path).toBe("/runs/run-fund/responses");
        finishRun({ runId: "run-fund", status: "completed" });
        return { runId: "run-fund", answered: true };
      },
      getJson: async () => ({}),
    });

    expect(code).toBe(0);
    const messages = writes.map((line) => JSON.parse(line));
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "answer", ok: true }),
      expect.objectContaining({ id: "run", ok: true, result: { runId: "run-fund", status: "completed" } }),
    ]));
    expect(postPaths).toEqual(["/runs", "/runs/run-fund/responses"]);
  });
});
