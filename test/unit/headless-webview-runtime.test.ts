import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  windows: [] as FakeBrowserWindow[],
}));

vi.mock("electron", () => ({
  BrowserWindow: class FakeElectronBrowserWindow {
    readonly webContents: FakeWebContents;
    destroyed = false;

    constructor(readonly options: Record<string, any>) {
      this.webContents = new FakeWebContents();
      electronState.windows.push(this as unknown as FakeBrowserWindow);
    }

    async loadURL(url: string): Promise<void> {
      this.webContents.url = url;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
    }
  },
}));

import { HeadlessWebViewRuntime } from "../../src/main/run-service-ui-runtime/headless-webview-runtime";

describe("HeadlessWebViewRuntime", () => {
  beforeEach(() => {
    electronState.windows.length = 0;
  });

  it("loads, executes, and captures through an invisible offscreen window", async () => {
    const runtime = new HeadlessWebViewRuntime();
    runtime.emit({
      type: "dashboard-open",
      id: "research",
      title: "Research",
      path: "/tmp/research.html",
    });

    const panels = await waitForPanels(runtime);
    expect(panels).toMatchObject([
      {
        id: "dash-research",
        title: "Research",
        type: "dashboard",
        isActive: true,
      },
    ]);
    expect(panels[0].url).toMatch(/^file:\/\/.*research\.html$/);

    const window = electronState.windows[0];
    expect(window.options.show).toBe(false);
    expect(window.options.webPreferences).toMatchObject({
      offscreen: true,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    });

    await expect(
      runtime.request("dash-research", {
        type: "executeJS",
        script: "document.title",
      }),
    ).resolves.toBe("Headless Research");

    const capture = JSON.parse(
      await runtime.request("dash-research", { type: "capturePage" }),
    );
    expect(capture).toMatchObject({
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      width: 1280,
      height: 900,
    });

    await runtime.dispose();
    expect(window.destroyed).toBe(true);
    expect(await runtime.queryPanels()).toEqual([]);
  });
});

class FakeWebContents {
  url = "";

  getURL(): string {
    return this.url;
  }

  reload(): void {}

  async executeJavaScript(script: string): Promise<unknown> {
    if (script === "document.title") return "Headless Research";
    return { ok: true };
  }

  async capturePage() {
    return {
      getSize: () => ({ width: 1280, height: 900 }),
      toDataURL: () => "data:image/png;base64,aGVhZGxlc3M=",
    };
  }
}

type FakeBrowserWindow = {
  options: Record<string, any>;
  webContents: FakeWebContents;
  destroyed: boolean;
};

async function waitForPanels(runtime: HeadlessWebViewRuntime) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const panels = await runtime.queryPanels();
    if (panels.length > 0 && panels[0].url) return panels;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("headless panel did not load");
}
