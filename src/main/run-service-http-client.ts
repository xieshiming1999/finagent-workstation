export interface RunServiceClient {
  get(path: string): Promise<Record<string, unknown>>;
  post(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export class RunServiceHttpClient implements RunServiceClient {
  constructor(
    readonly endpoint: string,
    private readonly timeoutMs = 120_000,
  ) {}

  get(path: string): Promise<Record<string, unknown>> {
    return this.request("GET", path);
  }

  post(
    path: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.request("POST", path, body);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.endpoint), {
        method,
        signal: controller.signal,
        headers:
          method === "POST" ? { "content-type": "application/json" } : {},
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
      const text = await response.text();
      const parsed = text.trim() ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`RUN_SERVICE_HTTP_${response.status}: ${text}`);
      }
      if (!isRecord(parsed)) {
        throw new Error("RUN_SERVICE_PROTOCOL_ERROR: response must be an object");
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `RUN_SERVICE_TIMEOUT: ${method} ${path} exceeded ${this.timeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
