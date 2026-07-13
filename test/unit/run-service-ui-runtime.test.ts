import { describe, expect, it } from "vitest";
import { RunServiceUiRuntimeCoordinator } from "../../src/main/run-service-ui-runtime/ui-runtime-coordinator";
import type { RunServiceUiRuntime } from "../../src/main/run-service-ui-runtime/run-service-ui-runtime";
import { HeadlessRunServiceUiRuntime } from "../../src/main/run-service-ui-runtime/headless-ui-runtime";
import { MirrorRunServiceUiRuntime } from "../../src/main/run-service-ui-runtime/mirror-ui-runtime";
import type {
  RunServicePanelSummary,
  RunServiceUiBackend,
} from "../../src/main/run-service-ui-runtime/ui-runtime-backend";
import { RunServiceUiRuntimeRouter } from "../../src/main/run-service-ui-runtime/ui-runtime-router";

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
      configured: true,
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
      configured: true,
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

  it("routes the stable tool contract to headless and restores visible", async () => {
    const visible = new RecordingBackend("visible");
    const headless = new RecordingBackend("headless");
    const router = new RunServiceUiRuntimeRouter(visible);
    const runtime = new HeadlessRunServiceUiRuntime(router, () => headless);
    const coordinator = new RunServiceUiRuntimeCoordinator([runtime]);

    expect(await router.requestUi({ type: "ui-widget" })).toContain("visible");
    await coordinator.use("headless", async (preparation) => {
      expect(preparation.available).toBe(true);
      router.emit({ type: "dashboard-open", id: "research" });
      expect(await router.requestWebView("dash-research", { type: "capturePage" }))
        .toContain("headless");
      expect(await router.requestUi({ type: "ui-widget" })).toContain("headless");
    });

    expect(headless.events).toHaveLength(1);
    expect(headless.disposeCount).toBe(1);
    expect(await router.requestUi({ type: "ui-widget" })).toContain("visible");
  });

  it("executes mirror WebView requests once and projects the resulting DOM", async () => {
    const visible = new RecordingBackend("visible");
    const execution = new RecordingBackend("headless");
    execution.webViewResult = JSON.stringify({
      html: "<html><body>Projected report</body></html>",
      url: "file:///report.html",
      title: "Report",
    });
    const router = new RunServiceUiRuntimeRouter(visible);
    const runtime = new MirrorRunServiceUiRuntime(
      router,
      visible,
      () => execution,
    );
    const coordinator = new RunServiceUiRuntimeCoordinator([runtime]);

    expect(coordinator.supports("mirror")).toBe(true);
    await coordinator.use("mirror", async (preparation) => {
      expect(preparation.available).toBe(true);
      router.emit({ type: "webview-open", id: "report" });
      await router.requestWebView("report", {
        type: "executeJS",
        script: "document.body.dataset.ready = 'true'",
      });
      await router.requestUi({ type: "ui-widget", action: "showTable" });
    });

    expect(execution.events).toHaveLength(1);
    expect(visible.events).toHaveLength(1);
    expect(visible.events[0]).toMatchObject({ mirrorProjection: true });
    expect(execution.webViewRequests[0]?.request).toMatchObject({
      script: "document.body.dataset.ready = 'true'",
    });
    expect(execution.webViewRequests).toHaveLength(2);
    expect(visible.webViewRequests).toHaveLength(1);
    expect(visible.webViewRequests[0]?.request.script).toContain(
      "Projected report",
    );
    expect(execution.uiRequests).toHaveLength(1);
    expect(visible.uiRequests).toHaveLength(1);
    expect(execution.disposeCount).toBe(1);
  });
});

class RecordingBackend implements RunServiceUiBackend {
  readonly events: Array<Record<string, unknown>> = [];
  readonly webViewRequests: Array<{
    panelId: string;
    request: Record<string, unknown>;
  }> = [];
  readonly uiRequests: Array<Record<string, unknown>> = [];
  webViewResult: string | undefined;
  disposeCount = 0;

  constructor(private readonly name: string) {}

  emit(event: Record<string, unknown>): void {
    this.events.push(event);
  }

  async queryPanels(): Promise<RunServicePanelSummary[]> {
    return [];
  }

  async requestWebView(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string> {
    this.webViewRequests.push({ panelId, request });
    return this.webViewResult ?? JSON.stringify({ runtime: this.name });
  }

  async requestUi(request: Record<string, unknown>): Promise<string> {
    this.uiRequests.push(request);
    return JSON.stringify({ runtime: this.name });
  }

  async query(): Promise<string> {
    return JSON.stringify({ runtime: this.name });
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}
