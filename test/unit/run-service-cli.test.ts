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

  it("routes stdio JSONL run, events, and result methods", async () => {
    const writes: string[] = [];
    const stdin = Readable.from([
      JSON.stringify({ id: "1", method: "run", params: { prompt: "hello" } }) + "\n",
      JSON.stringify({ id: "2", method: "events", params: { runId: "run-1", after: 0 } }) + "\n",
      JSON.stringify({ id: "3", method: "result", params: { runId: "run-1" } }) + "\n",
    ]);
    const code = await runServiceCli(["serve", "--stdio"], {
      stdin,
      stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
      stderr: { write: () => true },
      postJson: async (_path, body) => ({
        runId: "run-1",
        status: body.prompt === "hello" ? "completed" : "failed",
      }),
      getJson: async (path) => ({
        path,
        ok: true,
      }),
    });
    expect(code).toBe(0);
    const messages = writes.map((line) => JSON.parse(line));
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ id: "1", ok: true });
    expect(messages[1]).toMatchObject({ id: "2", ok: true, result: { path: "/runs/run-1/events?after=0" } });
    expect(messages[2]).toMatchObject({ id: "3", ok: true, result: { path: "/runs/run-1/result" } });
  });
});
