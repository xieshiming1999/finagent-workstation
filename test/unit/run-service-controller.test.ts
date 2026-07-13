import { describe, expect, it } from "vitest";
import { RunServiceController } from "../../src/agent/run-service-controller";

describe("run service controller", () => {
  it("wraps prompt runner with service events and final result", async () => {
    const controller = new RunServiceController(
      async (request) => {
        expect(request.uiRuntime).toBe("headless");
        expect(request.serviceRunId).toBe("run-1");
        expect(request.serviceTurnId).toBe("run-1:turn-1");
        return {
          ok: true,
          sessionId: "sess-1",
          turnId: "turn-1",
          finalAnswer: "done",
          toolCalls: [{ tool: "DataStore", action: "query_quote" }],
          toolResults: [{ tool: "DataStore", isError: false }],
          uiArtifacts: [{ artifactId: "dash-1", kind: "dashboard" }],
        };
      },
      { clock: () => new Date("2026-07-13T00:00:00.000Z") },
    );

    const result = await controller.runPrompt(
      { prompt: "今天市场怎么样？", uiRuntime: "headless" },
      { runId: "run-1" },
    );

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("done");
    expect(result.sessionId).toBe("sess-1");
    expect(result.turnId).toBe("run-1:turn-1");
    expect(new Set(result.events.map((event) => event.turnId))).toEqual(
      new Set(["run-1:turn-1"]),
    );
    expect(result.events[0].payload?.acceptedMessage).toBe("今天市场怎么样？");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.created",
      "run.status.changed",
      "tool.call",
      "tool.result",
      "artifact.created",
      "run.completed",
    ]);
  });

  it("records failed prompt runner through service error result", async () => {
    const controller = new RunServiceController(async () => {
      throw new Error("provider unavailable");
    });

    const result = await controller.runPrompt(
      { prompt: "test" },
      { runId: "run-failed" },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("provider unavailable");
    expect(result.events.at(-1)?.payload).toMatchObject({
      category: "agent.runtime",
      recovery: expect.any(String),
    });
  });

  it("rejects resume and preload without session id before running prompt", async () => {
    let called = false;
    const controller = new RunServiceController(async () => {
      called = true;
      return { ok: true, finalAnswer: "unexpected" };
    });

    const result = await controller.runPrompt(
      { prompt: "continue", sessionMode: "preload" },
      { runId: "run-missing-session" },
    );

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("sessionId is required");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.created",
      "run.failed",
    ]);
  });
});
