import type { RunServiceUiBackend } from "./ui-runtime-backend";

export class RunServiceUiRuntimeRouter {
  private activeBackend: RunServiceUiBackend;

  constructor(private readonly visibleBackend: RunServiceUiBackend) {
    this.activeBackend = visibleBackend;
  }

  activate(backend: RunServiceUiBackend): () => void {
    const previous = this.activeBackend;
    this.activeBackend = backend;
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (this.activeBackend === backend) this.activeBackend = previous;
    };
  }

  emit = (event: Record<string, unknown>): void => {
    this.activeBackend.emit(event);
  };

  queryPanels = () => this.activeBackend.queryPanels();

  requestWebView = (panelId: string, request: Record<string, unknown>) =>
    this.activeBackend.requestWebView(panelId, request);

  requestUi = (request: Record<string, unknown>) =>
    this.activeBackend.requestUi(request);

  query = (key: string) => this.activeBackend.query(key);
}
