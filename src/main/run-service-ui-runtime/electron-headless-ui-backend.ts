import type {
  RunServicePanelSummary,
  RunServiceUiBackend,
} from "./ui-runtime-backend";
import { HeadlessUiToolsRuntime } from "./headless-ui-tools-runtime";
import { HeadlessWebViewRuntime } from "./headless-webview-runtime";

export class ElectronHeadlessUiBackend implements RunServiceUiBackend {
  private readonly webviews = new HeadlessWebViewRuntime();
  private readonly uiTools = new HeadlessUiToolsRuntime(this.webviews);

  emit(event: Record<string, unknown>): void {
    this.webviews.emit(event);
  }

  queryPanels(): Promise<RunServicePanelSummary[]> {
    return this.webviews.queryPanels();
  }

  requestWebView(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string> {
    return this.webviews.request(panelId, request);
  }

  requestUi(request: Record<string, unknown>): Promise<string> {
    return this.uiTools.request(request);
  }

  query(key: string): Promise<string> {
    return this.uiTools.query(key);
  }

  dispose(): Promise<void> {
    return this.webviews.dispose();
  }
}
