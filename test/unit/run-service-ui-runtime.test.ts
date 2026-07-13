import { describe, expect, it } from "vitest";
import { RunServiceUiRuntimeCoordinator } from "../../src/main/run-service-ui-runtime/ui-runtime-coordinator";
import type { RunServiceUiRuntime } from "../../src/main/run-service-ui-runtime/run-service-ui-runtime";

describe("RunServiceUiRuntimeCoordinator", () => {
  it("selects the dedicated visible runtime", async () => {
    const result = await new RunServiceUiRuntimeCoordinator().prepare("visible");

    expect(result).toMatchObject({ mode: "visible", available: true });
  });

  it("keeps headless and mirror failures owned by their mode files", async () => {
    const coordinator = new RunServiceUiRuntimeCoordinator();

    const headless = await coordinator.prepare("headless");
    const mirror = await coordinator.prepare("mirror");

    expect(headless.available).toBe(false);
    expect(headless.error).toContain("headless requires");
    expect(mirror.available).toBe(false);
    expect(mirror.error).toContain("visible projection");
  });

  it("supports injected platform runtime implementations", async () => {
    const runtime: RunServiceUiRuntime = {
      mode: "headless",
      prepare: async () => ({
        mode: "headless",
        available: true,
        dispose: async () => {},
      }),
    };

    const result = await new RunServiceUiRuntimeCoordinator([runtime]).prepare(
      "headless",
    );
    expect(result.available).toBe(true);
  });

  it("use disposes a prepared runtime after success and failure", async () => {
    let disposeCount = 0;
    const runtime: RunServiceUiRuntime = {
      mode: "visible",
      prepare: async () => ({
        mode: "visible",
        available: true,
        dispose: async () => {
          disposeCount += 1;
        },
      }),
    };
    const coordinator = new RunServiceUiRuntimeCoordinator([runtime]);

    await expect(
      coordinator.use("visible", async () => "done"),
    ).resolves.toBe("done");
    expect(disposeCount).toBe(1);

    await expect(
      coordinator.use("visible", async () => {
        throw new Error("planned");
      }),
    ).rejects.toThrow("planned");
    expect(disposeCount).toBe(2);
  });
});
