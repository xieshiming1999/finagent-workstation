import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";

export class HeadlessRunServiceUiRuntime implements RunServiceUiRuntime {
  readonly mode = "headless" as const;

  async prepare(): Promise<RunServiceUiRuntimePreparation> {
    return {
      mode: this.mode,
      available: false,
      error:
        "RUN_SERVICE_UI_RUNTIME_UNSUPPORTED: headless requires a service-owned UI backend; retry with uiRuntime visible",
      dispose: async () => {},
    };
  }
}
