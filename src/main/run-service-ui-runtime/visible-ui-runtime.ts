import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";

export class VisibleRunServiceUiRuntime implements RunServiceUiRuntime {
  readonly mode = "visible" as const;

  async prepare(): Promise<RunServiceUiRuntimePreparation> {
    return { mode: this.mode, available: true, dispose: async () => {} };
  }
}
