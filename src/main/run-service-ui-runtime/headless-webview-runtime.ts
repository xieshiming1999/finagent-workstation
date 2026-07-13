import { BrowserWindow } from "electron";
import { pathToFileURL } from "url";
import type { RunServicePanelSummary } from "./ui-runtime-backend";

type HeadlessPanel = {
  id: string;
  title: string;
  type: "webview" | "dashboard";
  window: BrowserWindow;
};

export class HeadlessWebViewRuntime {
  private readonly panels = new Map<string, HeadlessPanel>();
  private disposed = false;

  emit(event: Record<string, unknown>): void {
    void this.handleEvent(event);
  }

  async queryPanels(): Promise<RunServicePanelSummary[]> {
    const panels = [...this.panels.values()].filter(
      (panel) => !panel.window.isDestroyed(),
    );
    return panels.map((panel, index) => ({
      id: panel.id,
      title: panel.title,
      url: panel.window.webContents.getURL(),
      type: panel.type,
      isActive: index === panels.length - 1,
    }));
  }

  async request(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string> {
    const panel =
      this.panels.get(panelId) ?? this.panels.get(normalizePanelId(panelId));
    if (!panel || panel.window.isDestroyed()) {
      throw new Error(
        `WEBVIEW_PANEL_MISSING: no headless WebView panel with id "${panelId}"`,
      );
    }
    if (request.type === "executeJS") {
      const script = String(request.script ?? "");
      if (!script) throw new Error("WEBVIEW_SCRIPT_MISSING: script is required");
      const value = await panel.window.webContents.executeJavaScript(script, true);
      if (typeof value === "string") return value;
      if (value === undefined) return "undefined";
      return JSON.stringify(value);
    }
    if (request.type === "capturePage") {
      const waitMs = Math.max(0, Math.min(Number(request.waitMs ?? 0), 10_000));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const image = await panel.window.webContents.capturePage();
      const size = image.getSize();
      return JSON.stringify({
        dataUrl: image.toDataURL(),
        width: size.width,
        height: size.height,
      });
    }
    throw new Error(`WEBVIEW_UNSUPPORTED_REQUEST: ${String(request.type)}`);
  }

  async pushData(
    targetId: string,
    channel: string,
    data: unknown,
  ): Promise<string[]> {
    const targets = targetId
      ? [...this.panels.values()].filter(
          (panel) => panel.id === targetId || panel.id === normalizePanelId(targetId),
        )
      : [...this.panels.values()];
    await Promise.all(
      targets.map((panel) =>
        panel.window.webContents.executeJavaScript(
          `window.__onPush__ && window.__onPush__(${JSON.stringify(channel)}, ${JSON.stringify(data ?? {})})`,
          true,
        ),
      ),
    );
    return targets.map((panel) => panel.id);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const panel of this.panels.values()) {
      if (!panel.window.isDestroyed()) panel.window.destroy();
    }
    this.panels.clear();
  }

  private async handleEvent(event: Record<string, unknown>): Promise<void> {
    if (this.disposed) return;
    const type = String(event.type ?? "");
    if (type === "webview-open" || type === "dashboard-open") {
      const rawId = String(event.id ?? "headless-page");
      const panelType = type === "dashboard-open" ? "dashboard" : "webview";
      const id = panelType === "dashboard" ? `dash-${rawId}` : rawId;
      const source = String(event.url ?? event.path ?? "about:blank");
      await this.openPanel(id, String(event.title ?? rawId), panelType, source);
      return;
    }
    if (type === "webview-navigate") {
      const panel = this.panels.get(String(event.id ?? ""));
      if (panel) await this.load(panel.window, String(event.url ?? "about:blank"));
      return;
    }
    if (type === "webview-refresh") {
      this.panels.get(String(event.id ?? ""))?.window.webContents.reload();
      return;
    }
    if (type === "ui-close-panel") {
      const id = String(event.id ?? "");
      const panel = this.panels.get(id);
      if (panel && !panel.window.isDestroyed()) panel.window.destroy();
      this.panels.delete(id);
    }
  }

  private async openPanel(
    id: string,
    title: string,
    type: "webview" | "dashboard",
    source: string,
  ): Promise<void> {
    const existing = this.panels.get(id);
    if (existing && !existing.window.isDestroyed()) existing.window.destroy();
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
      },
    });
    this.panels.set(id, { id, title, type, window });
    await this.load(window, source);
  }

  private async load(window: BrowserWindow, source: string): Promise<void> {
    if (source === "about:blank" || /^[a-z]+:\/\//i.test(source)) {
      await window.loadURL(source);
    } else {
      await window.loadURL(pathToFileURL(source).toString());
    }
  }
}

function normalizePanelId(id: string): string {
  return id.startsWith("dash-") ? id : `dash-${id}`;
}
