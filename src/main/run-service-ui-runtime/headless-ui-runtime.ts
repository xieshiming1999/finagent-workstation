import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";
import type { RunServiceUiBackend } from "./ui-runtime-backend";
import type { RunServiceUiRuntimeRouter } from "./ui-runtime-router";

export class HeadlessRunServiceUiRuntime implements RunServiceUiRuntime {
  readonly mode = "headless" as const;

  get configured(): boolean {
    return Boolean(this.router && this.createBackend);
  }

  constructor(
    private readonly router?: RunServiceUiRuntimeRouter,
    private readonly createBackend?: () => RunServiceUiBackend,
  ) {}

  async prepare(): Promise<RunServiceUiRuntimePreparation> {
    if (this.router && this.createBackend) {
      const backend = this.createBackend();
      const restore = this.router.activate(backend);
      return {
        mode: this.mode,
        available: true,
        dispose: async () => {
          restore();
          await backend.dispose();
        },
      };
    }
    return {
      mode: this.mode,
      available: false,
      error:
        "RUN_SERVICE_UI_RUNTIME_UNSUPPORTED: headless requires a service-owned UI backend; retry with uiRuntime visible",
      dispose: async () => {},
    };
  }
}
