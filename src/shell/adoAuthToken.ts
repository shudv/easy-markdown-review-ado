// ADO extension access-token expiry inspection.
//
// The host (dev.azure.com / {org}.visualstudio.com) mints the token our iframe
// gets from `SDK.getAccessToken()`. That token is an AAD JWT that ALSO carries
// an embedded ADO extension grant under `xms_attr.<hostAttr>.ado_exp`. Crucially
// the ADO grant expires EARLIER than the AAD token itself (observed: a ~10 min
// gap — `ado_exp` at 65 min, AAD `exp` at 75 min). Because the host caches the
// token by its AAD `exp`, for that ~10 min "dead window" it keeps handing back a
// token whose ADO grant has already lapsed. ADO then rejects every REST call as
// the anonymous identity (`aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`) with
// `TF400813`, and — this is the sting — re-calling `SDK.getAccessToken()` just
// returns the SAME cached token, so a tight retry loop can never heal it.
//
// This module decodes those two expiries so callers can tell a genuinely
// transient blip (retry helps) apart from the dead window (retry is futile —
// the app must wait for the host to re-mint, which is guaranteed once the AAD
// `exp` passes). It is framework-free (no SDK / DOM beyond `atob`) so the whole
// classification is deterministically unit-testable.

import { extractStatus } from "./retryClassify";

/** Expiry timestamps (ms epoch) decoded from an ADO extension access token. */
export interface AdoTokenExpiry {
  /** AAD token expiry, from the top-level `exp` claim. `undefined` if absent. */
  expMs?: number;
  /**
   * Embedded ADO extension grant expiry, from `xms_attr.<host>.ado_exp`. When
   * several host attributes carry an `ado_exp`, the earliest wins (the one that
   * fails first). `undefined` when the token carries no ADO grant.
   */
  adoExpMs?: number;
}

/**
 * Liveness of the ADO grant embedded in a host-issued token:
 *   - `live`       — usable; fire requests normally.
 *   - `refreshing` — the dead window: the ADO grant lapsed but the AAD token
 *                    has not, so the host is still serving this (now useless)
 *                    token. A retry can't help until it re-mints.
 *   - `expired`    — the AAD token itself has (nearly) expired; the host will
 *                    re-mint imminently.
 *   - `unknown`    — the token couldn't be decoded; treat as live so normal
 *                    error handling still applies (never block on a parse miss).
 */
export type AdoGrantState = "live" | "refreshing" | "expired" | "unknown";

export interface AdoGrantClassification {
  state: AdoGrantState;
  /**
   * Earliest wall-clock time (ms epoch) the host is expected to be able to
   * serve a usable token again — the AAD `exp`, after which a brand-new token
   * (with a fresh ADO grant) is guaranteed. Set for `refreshing` / `expired`.
   */
  recoverAtMs?: number;
  expiry: AdoTokenExpiry;
}

/** Default clock skew tolerance: treat a grant as lapsed this early. */
export const DEFAULT_GRANT_SKEW_MS = 30_000;

/**
 * Base64url-decode a JWT segment into a UTF-8 string. Returns `null` on any
 * malformation (bad chars, unavailable `atob`). Handles multi-byte claims via
 * the standard percent-decode round-trip so non-ASCII values don't corrupt the
 * parse (we only read numeric claims, but robustness is cheap).
 */
function decodeSegment(segment: string): string | null {
  if (typeof atob !== "function") return null;
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    let out = "";
    for (let i = 0; i < binary.length; i++) {
      out += "%" + binary.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return decodeURIComponent(out);
  } catch {
    return null;
  }
}

/**
 * Decode the payload (middle segment) of a JWT into a plain object. Returns
 * `null` for anything that isn't a well-formed three-segment JWT with a JSON
 * object payload. Never throws.
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const json = decodeSegment(parts[1]!);
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Earliest `ado_exp` (seconds) across the token's `xms_attr` host entries. */
function readAdoExpSeconds(
  payload: Record<string, unknown>,
): number | undefined {
  const xms = payload["xms_attr"];
  if (typeof xms !== "object" || xms === null) return undefined;
  let earliest: number | undefined;
  for (const value of Object.values(xms as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const adoExp = (value as Record<string, unknown>)["ado_exp"];
    if (typeof adoExp === "number" && Number.isFinite(adoExp)) {
      earliest = earliest === undefined ? adoExp : Math.min(earliest, adoExp);
    }
  }
  return earliest;
}

/**
 * Read the AAD (`exp`) and embedded ADO grant (`xms_attr.*.ado_exp`) expiries
 * from a host-issued access token, in ms epoch. Missing/undecodable values come
 * back `undefined`.
 */
export function readAdoTokenExpiry(token: string): AdoTokenExpiry {
  const payload = parseJwtPayload(token);
  if (!payload) return {};
  const exp = payload["exp"];
  const expMs =
    typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  const adoExpSeconds = readAdoExpSeconds(payload);
  const adoExpMs =
    adoExpSeconds === undefined ? undefined : adoExpSeconds * 1000;
  return { expMs, adoExpMs };
}

/**
 * Classify the usability of a host-issued token's ADO grant at `nowMs`.
 *
 * `skewMs` treats a grant as lapsed slightly early so we don't fire a request
 * that will 401 by the time it lands. When the token can't be decoded at all we
 * return `unknown` (→ treated as live by callers) so a parse miss never blocks
 * a normal request or its ordinary error handling.
 */
export function classifyAdoGrant(
  token: string,
  nowMs: number,
  skewMs: number = DEFAULT_GRANT_SKEW_MS,
): AdoGrantClassification {
  const expiry = readAdoTokenExpiry(token);
  const { expMs, adoExpMs } = expiry;

  // Couldn't read the AAD expiry → we know nothing; don't disrupt normal flow.
  if (expMs === undefined) return { state: "unknown", expiry };

  // The AAD token itself has (nearly) expired — the host will re-mint next call.
  if (nowMs >= expMs - skewMs) {
    return { state: "expired", recoverAtMs: expMs, expiry };
  }

  // Dead window: the ADO grant lapsed while the AAD token is still valid, so the
  // host keeps serving this token until its AAD `exp`. Recovery is guaranteed at
  // `expMs` (a fresh grant), so surface that as the recover-at hint.
  if (adoExpMs !== undefined && nowMs >= adoExpMs - skewMs) {
    return { state: "refreshing", recoverAtMs: expMs, expiry };
  }

  return { state: "live", expiry };
}

/** True when the grant state means a request will fail auth (not `live`/`unknown`). */
export function isAdoGrantLapsed(state: AdoGrantState): boolean {
  return state === "refreshing" || state === "expired";
}

/**
 * True when an error looks like an ADO auth rejection — an HTTP 401/403, or a
 * `TF400813` (the anonymous-identity rejection ADO returns for a lapsed grant).
 * Used to decide whether a failure is worth re-inspecting the token for.
 */
export function isAdoAuthError(err: unknown): boolean {
  const status = extractStatus(err);
  if (status === 401 || status === 403) return true;
  let message = "";
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  } else if (typeof err === "object" && err !== null) {
    const raw = (err as { message?: unknown }).message;
    if (typeof raw === "string") message = raw;
  }
  return /\bTF400813\b/.test(message);
}

/**
 * Raised when a request can't proceed because the host is between an expired
 * ADO grant and its AAD token re-mint (the dead window). Distinct from a
 * generic failure so the UI can show an accurate "session refreshing" state and
 * schedule recovery for `recoverAtMs` rather than surfacing a raw error or
 * burning a futile tight-retry budget.
 */
export class SessionRefreshingError extends Error {
  readonly grantState: AdoGrantState;
  readonly recoverAtMs?: number;

  constructor(grantState: AdoGrantState, recoverAtMs?: number) {
    super(
      "Azure DevOps session is refreshing (access token grant expired); " +
        "waiting for the host to issue a new token.",
    );
    this.name = "SessionRefreshingError";
    this.grantState = grantState;
    this.recoverAtMs = recoverAtMs;
    // Restore the prototype chain for `instanceof` under transpiled targets.
    Object.setPrototypeOf(this, SessionRefreshingError.prototype);
  }
}

export function isSessionRefreshingError(
  err: unknown,
): err is SessionRefreshingError {
  return err instanceof SessionRefreshingError;
}

/**
 * Pre-flight a host access token. Throws a {@link SessionRefreshingError} when
 * its ADO grant has lapsed (the dead window) so callers can skip a doomed REST
 * call and schedule recovery instead of burning a futile retry budget. A token
 * that can't be decoded classifies as `unknown` → treated as live, so a parse
 * miss never blocks a normal request. `getToken` rejecting is swallowed (we let
 * the real REST call surface that failure). Injected `getToken` / `nowMs` keep
 * this SDK-free and unit-testable.
 */
export async function ensureAdoSessionLive(
  getToken: () => Promise<string>,
  nowMs: number = Date.now(),
): Promise<void> {
  let token: string;
  try {
    token = await getToken();
  } catch {
    return;
  }
  const { state, recoverAtMs } = classifyAdoGrant(token, nowMs);
  if (isAdoGrantLapsed(state)) {
    throw new SessionRefreshingError(state, recoverAtMs);
  }
}

/**
 * Map a caught failure to a {@link SessionRefreshingError} when it is (or looks
 * like) the dead-window rejection: a `SessionRefreshingError` passes through; an
 * auth-shaped failure (401 / 403 / TF400813) re-inspects the CURRENT token and
 * only converts when its grant is actually lapsed. Returns `null` otherwise, so
 * a genuine error is left to normal handling. Injected `getToken` / `nowMs` keep
 * this SDK-free and unit-testable.
 */
export async function detectSessionRefreshing(
  err: unknown,
  getToken: () => Promise<string>,
  nowMs: number = Date.now(),
): Promise<SessionRefreshingError | null> {
  if (isSessionRefreshingError(err)) return err;
  if (!isAdoAuthError(err)) return null;
  let token = "";
  try {
    token = await getToken();
  } catch {
    /* empty token → classifies as "unknown" (not lapsed) */
  }
  const { state, recoverAtMs } = classifyAdoGrant(token, nowMs);
  return isAdoGrantLapsed(state)
    ? new SessionRefreshingError(state, recoverAtMs)
    : null;
}

export interface SessionRetryPlan {
  /** Stop auto-retrying (fall back to a manual reload). */
  giveUp: boolean;
  /** Delay before the next auto-retry, in ms (meaningless when `giveUp`). */
  delayMs: number;
}

/**
 * Decide when to auto-retry after a {@link SessionRefreshingError}.
 *
 * When we know `recoverAtMs` (the AAD `exp`) we wait precisely until then — a
 * fresh token is guaranteed once it passes — plus a small buffer. Otherwise we
 * back off exponentially. The delay is clamped to `[minDelayMs, ceilingMs]` so
 * an already-past `recoverAtMs` (the `expired` case) doesn't spin, and a distant
 * one never waits absurdly long. After `maxAttempts` we give up and leave the
 * user with a manual reload.
 */
export function planSessionRefreshRetry(opts: {
  recoverAtMs?: number;
  nowMs: number;
  /** 1-based count of the auto-retry about to be scheduled. */
  attempt: number;
  maxAttempts?: number;
  minDelayMs?: number;
  bufferMs?: number;
  ceilingMs?: number;
}): SessionRetryPlan {
  const {
    recoverAtMs,
    nowMs,
    attempt,
    maxAttempts = 6,
    minDelayMs = 3_000,
    bufferMs = 2_000,
    // Slightly above the widest observed dead window (~10.5 min) so a wait
    // pinned to the AAD `exp` is never truncated below the recovery point.
    ceilingMs = 11 * 60_000,
  } = opts;

  if (attempt > maxAttempts) return { giveUp: true, delayMs: 0 };

  const raw =
    recoverAtMs !== undefined
      ? recoverAtMs + bufferMs - nowMs
      : minDelayMs * 2 ** (attempt - 1);
  const delayMs = Math.min(ceilingMs, Math.max(minDelayMs, raw));
  return { giveUp: false, delayMs };
}
