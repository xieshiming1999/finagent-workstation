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

  it("projects state, messages, and bounded wait from run events", async () => {
    const store = new RunServiceEventStore();
    store.append({
      runId: "run-inspect",
      sessionId: "session-1",
      type: "run.created",
      payload: {
        acceptedMessage: "Inspect the market",
        sessionMode: "new",
        uiRuntime: "headless",
      },
    });
    store.append({
      runId: "run-inspect",
      type: "assistant.delta",
      payload: { delta: "Working" },
    });

    expect(store.state("run-inspect")).toMatchObject({
      status: "running",
      uiRuntime: "headless",
      sessionMode: "new",
    });
    expect(store.messages("run-inspect")).toMatchObject({
      count: 2,
      messages: [
        { role: "user", content: "Inspect the market" },
        { role: "assistant", content: "Working" },
      ],
    });
    await expect(store.wait({ runId: "run-inspect", after: 1 })).resolves.toMatchObject({
      timedOut: false,
      count: 1,
    });
    await expect(
      store.wait({ runId: "run-inspect", after: 2, timeoutMs: 5 }),
    ).resolves.toMatchObject({ timedOut: true, status: "running" });
  });

  it("projects typed final-result evidence from the event trace", () => {
    const store = new RunServiceEventStore();
    const add = (type: Parameters<typeof store.append>[0]["type"], payload = {}) =>
      store.append({ runId: "run-evidence", type, payload });

    add("run.created", { category: "strategy" });
    add("tool.call", { tool: "DataStore" });
    add("tool.result", { tool: "DataStore" });
    add("interaction.required", { requestId: "ask-1" });
    add("interaction.resolved", { requestId: "ask-1" });
    add("permission.required", { requestId: "perm-1" });
    add("permission.resolved", { requestId: "perm-1" });
    add("ui.operation.completed", { operation: "capture" });
    add("artifact.created", { artifactId: "shot-1" });
    add("tool.result", { tool: "Bash", isError: true });
    add("run.completed", { finalAnswer: "done" });

    const result = store.result("run-evidence");
    expect(result.trace).toHaveLength(11);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults).toHaveLength(2);
    expect(result.interactions).toHaveLength(2);
    expect(result.permissions).toHaveLength(2);
    expect(result.uiArtifacts).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.provenance).toMatchObject({
      source: "run-service-events",
      request: { category: "strategy" },
    });
  });

  it("exposes unresolved interaction and permission requests", () => {
    const store = new RunServiceEventStore();
    store.append({ runId: "run-pending", type: "run.created" });
    store.append({
      runId: "run-pending",
      type: "interaction.required",
      payload: { requestId: "ask-1", question: "Proceed?" },
    });
    store.append({
      runId: "run-pending",
      type: "permission.required",
      payload: { requestId: "perm-1", tool: "Bash" },
    });
    store.append({
      runId: "run-pending",
      type: "interaction.resolved",
      payload: { requestId: "ask-1" },
    });

    const pending = store.pending("run-pending");
    expect(pending.status).toBe("waiting");
    expect(pending.pendingInteractions).toHaveLength(0);
    expect(pending.pendingPermissions).toHaveLength(1);
    expect(pending.pendingPermissions[0].payload?.requestId).toBe("perm-1");
    expect(pending.pendingCount).toBe(1);
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
