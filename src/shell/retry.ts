// withRetry — the network-resiliency engine.
//
// Runs an async operation and, on failure, decides via `isRetryable` whether
// to try again. Retries use exponential backoff with full jitter and honor a
// server `Retry-After` hint when present. Aborted operations (via
// `AbortSignal`) never retry.
//
// Policy summary (see `retryClassify.ts` for the classification rules):
//   - Reads  (`mode: "read"`)  retry the full transient set incl. 401/403.
//   - Writes (`mode: "write"`) retry only failures that provably did not
//     mutate server state, so a retry can never produce a duplicate write.
//
// Framework-free apart from an injectable `sleep`, so the whole backoff loop is
// deterministically unit-testable with fake timers.

import { extractStatus, isRetryable, type RetryMode } from "./retryClassify";

export interface RetryOptions {
  /** `"read"` (idempotent) or `"write"` (dedup-safe). */
  mode: RetryMode;
  /**
   * Total number of attempts (initial try + retries). Defaults: 3 for reads,
   * 4 for writes. Must be >= 1.
   */
  attempts?: number;
  /** Base backoff delay in ms (grows exponentially). Default 300. */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms (ceiling for the exponential term). Default 4000. */
  maxDelayMs?: number;
  /** Abort signal — when aborted, no further attempts are made. */
  signal?: AbortSignal;
  /** Label for diagnostics / logging. */
  label?: string;
  /** Injectable sleep (tests pass a fake). Default: real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG in [0,1) for jitter (tests pass a deterministic fn). */
  random?: () => number;
  /** Optional hook fired before each retry (diagnostics / telemetry). */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

const DEFAULT_READ_ATTEMPTS = 3;
// Writes only ever retry failures the server PROVABLY rejected before acting
// (429/503 throttling, 401/403 auth blips — see retryClassify), so extra
// attempts can't duplicate a mutation. Four gives a transient legacy-host auth
// blip several chances to clear before the user sees an error.
const DEFAULT_WRITE_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 4000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(): Error {
  const err = new Error("Retry aborted");
  err.name = "AbortError";
  return err;
}

/**
 * Sleep for `ms`, but settle early (rejecting with an `AbortError`) if `signal`
 * fires. Without this, a long backoff / server `Retry-After` delay would keep
 * `withRetry` pending for the full delay even after the caller cancelled — the
 * abort would only be observed when the next attempt begins.
 */
function abortableSleep(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return sleep(ms);
  // Defensive: the retry loop already checks `signal.aborted` before sleeping,
  // so this guard is not reachable from `withRetry`; it keeps the helper safe
  // if reused standalone.
  /* v8 ignore next */
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    sleep(ms).then(
      () => {
        cleanup();
        resolve();
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
  });
}

/**
 * Parse a `Retry-After` value (seconds or an HTTP-date) into milliseconds from
 * now. Returns `undefined` when absent or unparseable. Exposed for tests.
 */
export function parseRetryAfterMs(
  err: unknown,
  now: number = Date.now(),
): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  // A raw header bag on the error, or a `Response`-like `.headers`.
  let raw: string | undefined;
  const headers = e.headers as
    | { get?: (name: string) => string | null }
    | undefined;
  if (headers && typeof headers.get === "function") {
    raw = headers.get("Retry-After") ?? headers.get("retry-after") ?? undefined;
  }
  if (raw === undefined && typeof e.retryAfter === "string") {
    raw = e.retryAfter;
  }
  if (raw === undefined) return undefined;

  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - now);
  return undefined;
}

/**
 * Compute the backoff delay for a given zero-based retry index using
 * exponential growth with full jitter, capped at `maxDelayMs`.
 */
export function computeBackoffMs(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  // Full jitter: pick a random point in [0, exp].
  return Math.floor(random() * exp);
}

/**
 * Run `fn` with ret/backoff per the resiliency policy. `fn` receives the
 * 1-based attempt number. The last error is rethrown once attempts are
 * exhausted or the failure is classified non-retryable.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    mode,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    signal,
    sleep = realSleep,
    random = Math.random,
    onRetry,
  } = opts;
  const attempts =
    opts.attempts ??
    (mode === "write" ? DEFAULT_WRITE_ATTEMPTS : DEFAULT_READ_ATTEMPTS);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt >= attempts;
      if (isLast || signal?.aborted || !isRetryable(err, mode)) {
        throw err;
      }
      // Prefer a server-provided Retry-After; otherwise jittered backoff.
      const retryAfter = parseRetryAfterMs(err);
      const delayMs =
        retryAfter ??
        computeBackoffMs(attempt - 1, baseDelayMs, maxDelayMs, random);
      onRetry?.({ attempt, delayMs, error: err });
      await abortableSleep(sleep, delayMs, signal);
    }
  }
  // Unreachable: the loop either returns or throws. Rethrow defensively.
  /* v8 ignore next 2 */
  throw lastError;
}

// Re-export classification helpers so callers import the whole resiliency
// surface from one place.
export { extractStatus, isRetryable, type RetryMode };
