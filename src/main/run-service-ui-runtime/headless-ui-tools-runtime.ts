import type { HeadlessWebViewRuntime } from "./headless-webview-runtime";

export class HeadlessUiToolsRuntime {
  private readonly semanticItems: Array<Record<string, unknown>> = [];

  constructor(private readonly webviews: HeadlessWebViewRuntime) {}

  async request(request: Record<string, unknown>): Promise<string> {
    const type = String(request.type ?? "");
    if (type === "ui-widget" || type === "ui-notify") {
      this.semanticItems.push(structuredClone(request));
      return JSON.stringify({
        ok: true,
        action: String(request.action ?? type),
        rendered: true,
        runtime: "headless",
        artifactKind: "semantic-ui-state",
        index: this.semanticItems.length - 1,
      });
    }
    if (type === "ui-push-data") {
      const targetPanelIds = await this.webviews.pushData(
        String(request.id ?? ""),
        String(request.channel ?? ""),
        request.data,
      );
      return JSON.stringify({
        ok: true,
        action: "pushData",
        runtime: "headless",
        deliveredToPanels: targetPanelIds.length,
        targetPanelIds,
        rawHtmlModified: false,
      });
    }
    throw new Error(`UI_HEADLESS_UNSUPPORTED_REQUEST: ${type}`);
  }

  async query(key: string): Promise<string> {
    if (key === "activePanels" || key === "panels" || key === "webviews") {
      return JSON.stringify({
        runtime: "headless",
        webviews: await this.webviews.queryPanels(),
        semanticItems: this.semanticItems,
      });
    }
    if (key === "windowSize") {
      return JSON.stringify({ width: 1280, height: 900, runtime: "headless" });
    }
    if (key === "theme") return JSON.stringify({ theme: "system" });
    return JSON.stringify({
      error: `Unknown key: ${key}`,
      available: ["activePanels", "windowSize", "theme", "webviews"],
    });
  }
}
