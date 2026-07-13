import type {
  RunServicePanelSummary,
  RunServiceUiBackend,
} from "./ui-runtime-backend";

export class VisibleRunServiceUiBackend implements RunServiceUiBackend {
  constructor(
    private readonly handlers: {
      emit(event: Record<string, unknown>): void;
      queryPanels(): Promise<RunServicePanelSummary[]>;
      requestWebView(
        panelId: string,
        request: Record<string, unknown>,
      ): Promise<string>;
      requestUi(request: Record<string, unknown>): Promise<string>;
      query(key: string): Promise<string>;
    },
  ) {}

  emit(event: Record<string, unknown>): void {
    this.handlers.emit(event);
  }

  queryPanels(): Promise<RunServicePanelSummary[]> {
    return this.handlers.queryPanels();
  }

  requestWebView(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string> {
    return this.handlers.requestWebView(panelId, request);
  }

  requestUi(request: Record<string, unknown>): Promise<string> {
    return this.handlers.requestUi(request);
  }

  query(key: string): Promise<string> {
    return this.handlers.query(key);
  }

  async dispose(): Promise<void> {}
}
