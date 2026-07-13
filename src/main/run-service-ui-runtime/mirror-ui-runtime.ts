import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";
import { MirrorRunServiceUiBackend } from "./mirror-ui-backend";
import type { RunServiceUiBackend } from "./ui-runtime-backend";
import type { RunServiceUiRuntimeRouter } from "./ui-runtime-router";

export class MirrorRunServiceUiRuntime implements RunServiceUiRuntime {
  readonly mode = "mirror" as const;

  get configured(): boolean {
    return Boolean(
      this.router && this.visibleBackend && this.createExecutionBackend,
    );
  }

  constructor(
    private readonly router?: RunServiceUiRuntimeRouter,
    private readonly visibleBackend?: RunServiceUiBackend,
    private readonly createExecutionBackend?: () => RunServiceUiBackend,
  ) {}

  async prepare(): Promise<RunServiceUiRuntimePreparation> {
    if (this.router && this.visibleBackend && this.createExecutionBackend) {
      const backend = new MirrorRunServiceUiBackend(
        this.createExecutionBackend(),
        this.visibleBackend,
      );
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
        "RUN_SERVICE_UI_RUNTIME_UNSUPPORTED: mirror requires a service-owned UI backend and visible projection; retry with uiRuntime visible",
      dispose: async () => {},
    };
  }
}
