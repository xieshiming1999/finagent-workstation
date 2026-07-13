import { describe, expect, it } from "vitest";
import { RunServiceController } from "../../src/agent/run-service-controller";

describe("run service controller", () => {
  it("wraps prompt runner with service events and final result", async () => {
    const controller = new RunServiceController(
      async (request) => {
        expect(request.uiRuntime).toBe("headless");
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
  });
});

