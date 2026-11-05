export type FailureReason =
  | "rate_limited"
  | "quota_exhausted"
  | "provider_unavailable"
  | "timeout"
  | "provider_auth"
  | "provider_request"
  | "provider_blocked"
  | "invalid_output";

export class ProviderError extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly retryable = false,
  ) {
    super(reason);
  }
}

export type AnalysisRequest = { system: string; input: string; schema: object; signal: AbortSignal };

// An adapter only sends the request. It returns raw text, or throws a ProviderError.
export interface AnalysisProvider {
  readonly name: string;
  readonly model: string;
  analyze(request: AnalysisRequest): Promise<string>;
}

// Maps from the numeric status. A provider detail only refines a 429 or 400.
export function errorFromStatus(status: number | undefined, detail = ""): ProviderError {
  if (status === undefined) return new ProviderError("provider_unavailable", true);
  if (status === 429) {
    return /quota_exceeded|exceeded your current quota/i.test(detail)
      ? new ProviderError("quota_exhausted")
      : new ProviderError("rate_limited", true);
  }
  if (status === 504) return new ProviderError("timeout");
  if (status === 500 || status === 502 || status === 503) return new ProviderError("provider_unavailable", true);
  if (status > 500) return new ProviderError("provider_unavailable");
  if (status === 401 || status === 403 || (status === 400 && detail.includes("API_KEY_INVALID"))) {
    return new ProviderError("provider_auth");
  }
  return new ProviderError("provider_request");
}

const BACKOFF_MS = 1_000;

// At most one retry, and only if it fits inside the time limit.
export async function analyzeWithRetry(
  provider: AnalysisProvider,
  request: Omit<AnalysisRequest, "signal">,
  timeoutMs: number,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () => provider.analyze({ ...request, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });

  try {
    return await attempt();
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("provider_unavailable", true);
    if (!failure.retryable || Date.now() + BACKOFF_MS >= deadline) throw failure;
  }

  await wait(BACKOFF_MS);
  try {
    return await attempt();
  } catch (error) {
    throw error instanceof ProviderError ? error : new ProviderError("provider_unavailable");
  }
}
