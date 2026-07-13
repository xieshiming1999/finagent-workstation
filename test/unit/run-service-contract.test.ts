import { describe, expect, it } from "vitest";
import {
  parseRunServiceCommand,
  runServiceCapabilityDescriptor,
  runServiceEventTypes,
} from "../../src/agent/run-service-contract";

describe("run service contract", () => {
  it("parses plain text run command with explicit service options", () => {
    const plan = parseRunServiceCommand([
      "run",
      "今天市场怎么样？",
      "--session",
      "resume",
      "--session-id",
      "sess-1",
      "--ui-runtime",
      "headless",
      "--jsonl",
    ]);

    expect(plan).toMatchObject({
      category: "run",
      operation: "prompt",
      prompt: "今天市场怎么样？",
      sessionMode: "resume",
      sessionId: "sess-1",
      uiRuntime: "headless",
      jsonl: true,
    });
  });

  it("parses structured category command without prompt text inference", () => {
    const plan = parseRunServiceCommand([
      "strategy",
      "backtest",
      "--strategy-id",
      "s_123",
      "--symbols",
      "300059,600519",
      "--session",
      "ephemeral",
      "--ui-runtime",
      "mirror",
    ]);

    expect(plan).toEqual({
      category: "strategy",
      operation: "backtest",
      sessionMode: "ephemeral",
      uiRuntime: "mirror",
      jsonl: false,
      payload: {
        "strategy-id": "s_123",
        symbols: "300059,600519",
      },
    });
  });

  it("requires session id for resume mode", () => {
    expect(() =>
      parseRunServiceCommand(["analysis", "run", "--session", "resume"]),
    ).toThrow("--session-id is required");
  });

  it("exposes canonical event wire names", () => {
    expect(runServiceEventTypes).toContain("tool.call");
    expect(runServiceEventTypes).toContain("interaction.required");
    expect(runServiceEventTypes).toContain("ui.operation.completed");
  });

  it("describes service capabilities for discovery clients", () => {
    const descriptor = runServiceCapabilityDescriptor({
      runtime: "workstation",
      supportsCli: true,
      supportsStdio: true,
      supportsPermissionResponse: true,
    });
    expect(descriptor).toMatchObject({
      ok: true,
      contract: "finagent.run-service.v1",
      runtime: "workstation",
      transports: {
        http: true,
        cli: true,
        stdio: true,
      },
      interaction: {
        userQuestionResponse: true,
        permissionResponse: true,
        hiddenAutoAnswer: false,
      },
    });
    expect(descriptor.categories).toContain("strategy");
    expect(descriptor.routes).toContain("GET /runs/capabilities");
    expect(descriptor.routes).toContain("GET /sessions");
    expect(descriptor.routes).toContain("POST /sessions");
    expect(descriptor.routes).toContain("GET /sessions/current");
    expect(descriptor.routes).toContain("GET /artifacts");
    expect(descriptor.routes).toContain("GET /artifacts/{artifactId}");
    expect(descriptor.routes).toContain("POST /runs/{runId}/permissions");
  });
});
