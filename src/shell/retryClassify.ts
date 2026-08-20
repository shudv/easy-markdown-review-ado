// Error classification for the network-resiliency layer.
//
// The retry engine (`withRetry`) asks two questions of every failure:
//   1. Is it *provably terminal*? — a definitive server verdict that another
//      identical request cannot change (bad request, not found, conflict…).
//      These never retry.
//   2. Otherwise, is it *retryable*? — transient by nature (connection
//      failure, throttling, gateway/backentd blips) OR unclassifiable. Per our
//      resiliency policy we **retry by default**, so anything we can't prove
//      terminal is treated as retryable.
//
// This module is framework-free (no SDK / DOM assumptions beyond the `Response`
// shape) so it can be exhaustively unit-tested under node/vitest.

/**
 * Best-effort extraction of an HTTP status code from the many error shapes the
 * app sees:
 *   - a raw `Response` (our `fetch` wrappers throw these indirectly),
 *   - an `AlmSearchError` (`{ kind, status }`),
 *   - an SDK `RestClientBase` rejection (carries `.status`, and often a
 *     `.responseText` / `.serverError`),
 *   - a plain object with a numeric `status` / `statusCode`.
 * Returns `undefined` when no status can be found (e.g. a `fetch` that threw
 * before any response — a pure connection failure).
 */
export function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  const candidates = [e.status, e.statusCode, e.httpStatusCode];
  for (const c of candidates) {
    if (typeof c === "number" && c >= 100 && c <= 599) return c;
  }
  // Some SDK errors nest the status inside a `serverError` payload.
  const serverError = e.serverError as Record<string, unknown> | undefined;
  if (serverError && typeof serverError.status === "number") {
    return serverError.status;
  }
  return undefined;
}

/**
 * True when the failure is an aborted request (caller cancelled via
 * `AbortSignal`). Aborts are never retried — the caller no longer wants the
 * result.
 */
export function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return e.name === "AbortError" || e.code === 20 /* DOMException.ABORT_ERR */;
}

/**
 * HTTP statuses that represent a *definitive* server verdict: reissuing the
 * exact same request will get the exact same answer, so retrying is pointless
 * (and, for writes, potentially harmful). Deliberately does NOT include 401 /
 * 403: in ADO those are frequently transient (token refresh races, SPS auth
 * blips — the intermittent `TF400813` this work targets), so they are treated
 * as retryable.
 */
const TERMINAL_STATUSES = new Set<number>([
  400, // Bad Request
  404, // Not Found
  405, // Method Not Allowed
  409, // Conflict
  410, // Gone
  412, // Precondition Failed
  422, // Unprocessable Entity
  501, // Not Implemented
]);

/**
 * HTTP statuses that are explicitly transient and safe to retry even for
 * writes that may have started server-side processing, because the server
 * signals it did NOT act on the request (throttled / temporarily unavailable).
 */
const TRANSIENT_STATUSES = new Set<number>([
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Statuses safe to retry for a *write* without risking a duplicate mutation.
 * The server tells us it rejected the request before acting on it, so a retry
 * cannot produce a second write.
 */
const WRITE_SAFE_TRANSIENT_STATUSES = new Set<number>([
  429, // Too Many Requests — rejected pre-processing
  503, // Service Unavailable — rejected pre-processing
]);

export type RetryMode = "read" | "write";

/**
 * Decide whether a failed attempt should be retried.
 *
 * @param err  The thrown error / rejection.
 * @param mode `"read"` (idempotent — retry the full transient set) or
 *             `"write"` (non-idempotent — only retry failures that provably
 *             did not mutate server state, to avoid duplicate writes).
 */
export function isRetryable(err: unknown, mode: RetryMode): boolean {
  // Caller cancelled — never retry.
  if (isAbortError(err)) return false;

  const status = extractStatus(err);

  if (mode === "write") {
    // Writes are non-idempotent, so we only retry when the server PROVABLY did
    // not act on the request — otherwise a retry risks a duplicate mutation:
    //   - 429 / 503: throttled / unavailable, rejected pre-processing.
    //   - 401 / 403: rejected at the auth layer before any handler ran (the
    //     transient `TF400813` case). Reissuing is safe.
    // Everything else is refused, including:
    //   - `status === undefined` (connection reset / lost response): AMBIGUOUS.
    //     The write may have committed server-side with only the response lost,
    //     so retrying could duplicate it.
    //   - ambiguous 5xx (500/502/504) after the request was sent.
    //   - terminal 4xx verdicts.
    if (status === undefined) return false;
    if (TERMINAL_STATUSES.has(status)) return false;
    if (WRITE_SAFE_TRANSIENT_STATUSES.has(status)) return true;
    return status === 401 || status === 403;
  }

  // Reads are idempotent — safe to retry broadly.

  // No status at all → the request never got a response (connection reset,
  // DNS, offline, CORS preflight failure). Safe to retry for a read.
  if (status === undefined) return true;

  // Definitive server verdict — never retry.
  if (TERMINAL_STATUSES.has(status)) return false;

  // Reads: retry the explicit transient set…
  if (TRANSIENT_STATUSES.has(status)) return true;
  // …plus transient auth blips (401/403) that motivated this work.
  if (status === 401 || status === 403) return true;

  // Any other classified status (e.g. a 3xx that surfaced as an error, or an
  // unusual 4xx we didn't enumerate) is treated as terminal for reads: we only
  // retry things we have positive reason to believe are transient once a
  // concrete status is present.
  return false;
}
