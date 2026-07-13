export type RunServicePanelSummary = {
  id: string;
  title: string;
  url: string;
  type: string;
  isActive: boolean;
};

export interface RunServiceUiBackend {
  emit(event: Record<string, unknown>): void;
  queryPanels(): Promise<RunServicePanelSummary[]>;
  requestWebView(
    panelId: string,
    request: Record<string, unknown>,
  ): Promise<string>;
  requestUi(request: Record<string, unknown>): Promise<string>;
  query(key: string): Promise<string>;
  dispose(): Promise<void>;
}
