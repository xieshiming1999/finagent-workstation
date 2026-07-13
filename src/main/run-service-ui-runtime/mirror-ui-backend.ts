import type {
  RunServicePanelSummary,
  RunServiceUiBackend,
} from "./ui-runtime-backend";

export class MirrorRunServiceUiBackend implements RunServiceUiBackend {
  constructor(
    private readonly executionBackend: RunServiceUiBackend,
    private readonly projectionBackend: RunServiceUiBackend,
  ) {}

  emit(event: Record<string, unknown>): void {
    this.executionBackend.emit(event);
    this.projectionBackend.emit({ ...event, mirrorProjection: true });
  }

  queryPanels(): Promise<RunServicePanelSummary[]> {
    return this.executionBackend.queryPanels();
  }

  async requestWebView(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.executionBackend.requestWebView(panelId, request);
    if (request.type !== "capturePage") await this.projectDom(panelId);
    return result;
  }

  async requestUi(request: Record<string, unknown>): Promise<string> {
    const result = await this.executionBackend.requestUi(request);
    await this.projectionBackend.requestUi({
      ...request,
      mirrorProjection: true,
    });
    return result;
  }

  query(key: string): Promise<string> {
    return this.executionBackend.query(key);
  }

  dispose(): Promise<void> {
    return this.executionBackend.dispose();
  }

  private async projectDom(panelId: string): Promise<void> {
    const snapshot = await this.executionBackend.requestWebView(panelId, {
      type: "executeJS",
      script:
        "JSON.stringify({html:document.documentElement.outerHTML,url:location.href,title:document.title})",
    });
    const payload = parseSnapshot(snapshot);
    if (!payload) return;
    await this.projectionBackend.requestWebView(panelId, {
      type: "executeJS",
      script: `(() => {
        const snapshot = ${JSON.stringify(payload)};
        document.open();
        document.write(snapshot.html);
        document.close();
        if (snapshot.title) document.title = snapshot.title;
        return JSON.stringify({ok:true,runtime:"mirror-projection",url:snapshot.url});
      })()`,
    });
  }
}

function parseSnapshot(
  value: string,
): { html: string; url?: string; title?: string } | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.html !== "string") return null;
    return {
      html: parsed.html,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
    };
  } catch {
    return null;
  }
}
