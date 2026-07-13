import type { RunServiceUiRuntimeMode } from "../../agent/run-service-contract";
import { HeadlessRunServiceUiRuntime } from "./headless-ui-runtime";
import { MirrorRunServiceUiRuntime } from "./mirror-ui-runtime";
import type {
  RunServiceUiRuntime,
  RunServiceUiRuntimePreparation,
} from "./run-service-ui-runtime";
import { VisibleRunServiceUiRuntime } from "./visible-ui-runtime";

export class RunServiceUiRuntimeCoordinator {
  private readonly runtimes: Map<RunServiceUiRuntimeMode, RunServiceUiRuntime>;

  constructor(
    runtimes: RunServiceUiRuntime[] = [
      new VisibleRunServiceUiRuntime(),
      new HeadlessRunServiceUiRuntime(),
      new MirrorRunServiceUiRuntime(),
    ],
  ) {
    this.runtimes = new Map(runtimes.map((runtime) => [runtime.mode, runtime]));
  }

  async prepare(
    mode: RunServiceUiRuntimeMode,
  ): Promise<RunServiceUiRuntimePreparation> {
    const runtime = this.runtimes.get(mode);
    if (!runtime) {
      return {
        mode,
        available: false,
        error: `RUN_SERVICE_UI_RUNTIME_UNREGISTERED: no runtime is registered for ${mode}`,
        dispose: async () => {},
      };
    }
    return runtime.prepare();
  }

  async use<T>(
    mode: RunServiceUiRuntimeMode,
    action: (preparation: RunServiceUiRuntimePreparation) => Promise<T>,
  ): Promise<T> {
    const preparation = await this.prepare(mode);
    try {
      return await action(preparation);
    } finally {
      await preparation.dispose();
    }
  }
}
