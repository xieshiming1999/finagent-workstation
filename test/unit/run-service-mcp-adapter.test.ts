import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { RunServiceClient } from "../../src/main/run-service-http-client";
import {
  RunServiceMcpAdapter,
  runRunServiceMcpAdapter,
} from "../../src/main/run-service-mcp-adapter";

describe("RunServiceMcpAdapter", () => {
  it("advertises stable run-service operations", async () => {
    const adapter = new RunServiceMcpAdapter(new RecordingClient());

    const initialized = await adapter.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    const listed = await adapter.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(initialized).toMatchObject({
      result: { serverInfo: { name: "finagent-run-service" } },
    });
    const tools = (listed?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "finagent.workflow.run",
        "finagent.workflow.pending",
        "finagent.workflow.answer",
        "finagent.workflow.permission",
        "finagent.session.resume",
        "finagent.artifact.get",
        "finagent.capability.help",
      ]),
    );
  });

  it("maps run and answer tools to the common HTTP contract", async () => {
    const client = new RecordingClient();
    const adapter = new RunServiceMcpAdapter(client);

    const run = await callTool(adapter, "finagent.workflow.run", {
      prompt: "inspect market",
      sessionMode: "new",
      uiRuntime: "headless",
    });
    const answer = await callTool(adapter, "finagent.workflow.answer", {
      runId: "run-1",
      requestId: "question-1",
      answer: "large-cap",
    });

    expect(run).toMatchObject({ result: { isError: false } });
    expect(answer).toMatchObject({ result: { isError: false } });
    expect(client.posts).toEqual([
      {
        path: "/runs",
        body: {
          prompt: "inspect market",
          sessionMode: "new",
          uiRuntime: "headless",
        },
      },
      {
        path: "/runs/run-1/responses",
        body: { requestId: "question-1", answer: "large-cap" },
      },
    ]);
  });

  it("returns transport failures through MCP tool error results", async () => {
    const client = new RecordingClient();
    client.failure = new Error("RUN_SERVICE_HTTP_503: unavailable");
    const adapter = new RunServiceMcpAdapter(client);

    const result = await callTool(
      adapter,
      "finagent.workflow.result",
      { runId: "run-2" },
    );

    expect(result).toMatchObject({
      result: {
        isError: true,
        content: [{ text: "RUN_SERVICE_HTTP_503: unavailable" }],
      },
    });
  });

  it("serves multiple JSON-RPC requests on one structured stdio stream", async () => {
    const client = new RecordingClient();
    const adapter = new RunServiceMcpAdapter(client);
    const input = Readable.from([
      `${JSON.stringify({ jsonrpc: "2.0", id: "a", method: "tools/list" })}\n`,
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "b",
        method: "tools/call",
        params: { name: "finagent.capability.help", arguments: {} },
      })}\n`,
    ]);
    let output = "";
    let errors = "";

    await runRunServiceMcpAdapter({
      input,
      output: { write: (chunk) => ((output += String(chunk)), true) },
      errors: { write: (chunk) => ((errors += String(chunk)), true) },
      adapter,
    });

    const messages = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "a" });
    expect(messages[1]).toMatchObject({ id: "b", result: { isError: false } });
    expect(client.gets).toEqual([
      "/runs/capabilities",
      "/adapter/capabilities",
    ]);
    expect(errors).toBe("");
  });
});

async function callTool(
  adapter: RunServiceMcpAdapter,
  name: string,
  args: Record<string, unknown>,
) {
  return adapter.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

class RecordingClient implements RunServiceClient {
  readonly gets: string[] = [];
  readonly posts: Array<{
    path: string;
    body: Record<string, unknown> | undefined;
  }> = [];
  failure?: Error;

  async get(path: string): Promise<Record<string, unknown>> {
    this.gets.push(path);
    if (this.failure) throw this.failure;
    return { ok: true, path };
  }

  async post(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.posts.push({ path, body });
    if (this.failure) throw this.failure;
    return { ok: true, path };
  }
}
