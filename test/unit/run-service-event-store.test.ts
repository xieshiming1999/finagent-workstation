import { describe, expect, it } from "vitest";
import { RunServiceEventStore } from "../../src/agent/run-service-event-store";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("run service event store", () => {
  it("replays events after cursor and collects completed result", () => {
    const store = new RunServiceEventStore(
      () => new Date("2026-07-13T01:02:03.000Z"),
    );

    store.append({
      runId: "run-1",
      sessionId: "sess-1",
      type: "run.created",
    });
    const tool = store.append({
      runId: "run-1",
      sessionId: "sess-1",
      type: "tool.call",
      payload: { tool: "DataStore" },
    });
    store.append({
      runId: "run-1",
      sessionId: "sess-1",
      type: "run.completed",
      payload: { finalAnswer: "done" },
    });

    const replay = store.events({ runId: "run-1", after: tool.sequence });
    expect(replay).toHaveLength(1);
    expect(replay[0].type).toBe("run.completed");

    const result = store.result("run-1");
    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("done");
    expect(result.sessionId).toBe("sess-1");
    expect(result.events).toHaveLength(3);
  });

  it("reports waiting while interaction is unresolved", () => {
    const store = new RunServiceEventStore();
    store.append({ runId: "run-2", type: "run.created" });
    store.append({
      runId: "run-2",
      type: "interaction.required",
      payload: { requestId: "q1" },
    });

    expect(store.result("run-2").status).toBe("waiting");

    store.append({
      runId: "run-2",
      type: "interaction.resolved",
      payload: { requestId: "q1" },
    });

    expect(store.result("run-2").status).toBe("running");
  });

  it("keeps run streams isolated", () => {
    const store = new RunServiceEventStore();
    store.append({ runId: "run-a", type: "run.created" });
    store.append({ runId: "run-b", type: "run.created" });
    store.append({ runId: "run-a", type: "run.failed" });

    expect(store.events({ runId: "run-a" })).toHaveLength(2);
    expect(store.events({ runId: "run-b" })).toHaveLength(1);
    expect(store.result("run-a").status).toBe("failed");
    expect(store.result("run-b").status).toBe("running");
  });

  it("persists and reloads append-only event logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-service-events-"));
    const path = join(dir, "events.jsonl");
    const first = new RunServiceEventStore(
      () => new Date("2026-07-13T01:02:03.000Z"),
      { persistencePath: path },
    );
    first.append({ runId: "run-durable", type: "run.created" });
    first.append({
      runId: "run-durable",
      type: "run.completed",
      payload: { finalAnswer: "persisted" },
    });
    expect(readFileSync(path, "utf-8").trim().split("\n")).toHaveLength(2);

    const second = new RunServiceEventStore(
      () => new Date("2026-07-13T01:02:04.000Z"),
      { persistencePath: path },
    );
    expect(second.result("run-durable")).toMatchObject({
      status: "completed",
      finalAnswer: "persisted",
    });
    const next = second.append({ runId: "run-next", type: "run.created" });
    expect(next.sequence).toBe(3);
  });
});
