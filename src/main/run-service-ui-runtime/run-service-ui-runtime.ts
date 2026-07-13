import type { RunServiceUiRuntimeMode } from "../../agent/run-service-contract";

export interface RunServiceUiRuntimePreparation {
  mode: RunServiceUiRuntimeMode;
  available: boolean;
  error?: string;
  dispose(): Promise<void>;
}

export interface RunServiceUiRuntime {
  readonly mode: RunServiceUiRuntimeMode;
  readonly configured: boolean;
  prepare(): Promise<RunServiceUiRuntimePreparation>;
}
