import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";

export class MirrorRunServiceUiRuntime implements RunServiceUiRuntime {
  readonly mode = "mirror" as const;

  async prepare(): Promise<RunServiceUiRuntimePreparation> {
    return {
      mode: this.mode,
      available: false,
      error:
        "RUN_SERVICE_UI_RUNTIME_UNSUPPORTED: mirror requires a service-owned UI backend and visible projection; retry with uiRuntime visible",
      dispose: async () => {},
    };
  }
}
