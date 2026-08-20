// Typed wrapper for the ADO ALM Code Search REST API.
//
// `azure-devops-extension-api@4.270.0` ships no typed `SearchRestClient`, so
// we hit the REST surface directly via `fetch` behind a stable typed
// interface (`AlmSearchClient`) — if the SDK adds a typed client later we can
// swap implementations without touching callers. Failure modes are
// discriminated (404 ≠ auth ≠ network) so DocNav can show a meaningful
// "Code Search unavailable" hint. Framework-free for isolated unit testing.

import { withRetry } from "./retry";

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

/**
 * Code Search query payload for
 * `POST /_apis/search/codesearchresults?api-version=7.1-preview.1`.
 * `searchText` uses ADO's query language (e.g. `file:foo`, `ext:md`).
 */
export interface CodeSearchRequest {
  searchText: string;
  filters?: {
    Project?: string[];
    Repository?: string[];
    Branch?: string[];
    Path?: string[];
    CodeElement?: string[];
  };
  /** Page size. The endpoint caps this at 1000. We typically use 25. */
  $top?: number;
  $skip?: number;
  $orderBy?: Array<{ field: string; sortOrder: "ASC" | "DESC" }>;
  includeFacets?: boolean;
}

export interface CodeSearchResultRepository {
  id?: string;
  name?: string;
}

export interface CodeSearchResultProject {
  id?: string;
  name?: string;
}

export interface CodeSearchResultItem {
  fileName?: string;
  path?: string;
  contentId?: string;
  repository?: CodeSearchResultRepository;
  project?: CodeSearchResultProject;
  matches?: unknown;
}

export interface CodeSearchResponse {
  count?: number;
  results?: CodeSearchResultItem[];
  infoCode?: number;
  facets?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/**
 * Discriminated failure modes. DocNav uses `kind` to pick a message; tests
 * pin to the kind rather than the HTTP status.
 * - `extension-missing`: 404 — Code Search (`ms.vss-code-search`) not
 *   installed or not accessible.
 * - `auth`: 401/403 or token acquisition failed.
 * - `network`: `fetch` itself threw (offline, DNS, CORS).
 * - `bad-request`: 400 — usually a malformed query.
 * - `no-config`: couldn't attempt a call (no org/token). Standalone preview.
 * - `unknown`: any other non-2xx or JSON parse failure.
 */
export type AlmSearchErrorKind =
  | "extension-missing"
  | "auth"
  | "network"
  | "bad-request"
  | "no-config"
  | "unknown";

export interface AlmSearchError {
  kind: AlmSearchErrorKind;
  status?: number;
  message?: string;
}

export function isAlmSearchError(e: unknown): e is AlmSearchError {
  return (
    !!e &&
    typeof e === "object" &&
    "kind" in (e as Record<string, unknown>) &&
    typeof (e as AlmSearchError).kind === "string"
  );
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

// ---------------------------------------------------------------------------
// Client interface + REST implementation
// ---------------------------------------------------------------------------

/**
 * Minimal interface every ALM Search backend must satisfy, so a future
 * SDK-shipped client can implement it directly without changing callers.
 */
export interface AlmSearchClient {
  /**
   * Issue a Code Search query against a single project. Throws an
   * `AlmSearchError` on any failure (network, HTTP non-2xx, parse).
   */
  searchCode(
    req: CodeSearchRequest,
    project: string,
    signal?: AbortSignal,
  ): Promise<CodeSearchResponse>;
}

/**
 * REST-backed implementation. Talks to
 * `https://almsearch.dev.azure.com/{org}/{project}/_apis/search/codesearchresults`.
 */
export class AlmSearchRestClient implements AlmSearchClient {
  constructor(
    private readonly orgName: string,
    private readonly getToken: () => Promise<string>,
    /* v8 ignore start -- default delegates to the real fetch; tests inject a fake */
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
    /* v8 ignore stop */
    /**
     * Injectable backoff sleep for the internal retry loop. Defaults to the
     * real timer (via `withRetry`); tests pass a no-op to run retries instantly.
     */
    private readonly sleepImpl?: (ms: number) => Promise<void>,
  ) {}

  async searchCode(
    req: CodeSearchRequest,
    project: string,
    signal?: AbortSignal,
  ): Promise<CodeSearchResponse> {
    const url =
      `https://almsearch.dev.azure.com/${encodeURIComponent(this.orgName)}` +
      `/${encodeURIComponent(project)}` +
      `/_apis/search/codesearchresults?api-version=7.1-preview.1`;

    let res: Response;
    try {
      res = await withRetry(
        async () => {
          // Re-acquire the token inside the retried closure. `SDK.getAccessToken()`
          // is a fresh IPC round-trip, but the HOST caches the token it mints — so
          // a retry only heals a TRUE transient blip (e.g. an SPS race), NOT the
          // `ado_exp` dead window, where the host replays the same lapsed token
          // and TF400813 persists. That window is detected + recovered at app
          // boot (shell/adoAuthToken.ts); search itself just degrades when it
          // can't authenticate.
          let token: string;
          try {
            token = await this.getToken();
          } catch (err) {
            throw mkError("auth", undefined, errMsg(err));
          }
          if (!token) {
            throw mkError("auth", undefined, "empty access token");
          }
          const r = await this.fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(req),
            signal,
          });
          // Throw a status-bearing AlmSearchError on non-2xx so the retry
          // classifier can distinguish transient (retry) from terminal
          // (extension-missing / bad-request) failures.
          if (!r.ok) {
            throw mkError(statusToKind(r.status), r.status, r.statusText);
          }
          return r;
        },
        {
          mode: "read",
          label: "almSearch.searchCode",
          signal,
          sleep: this.sleepImpl,
        },
      );
    } catch (err) {
      // Preserve caller-driven cancellation: an AbortError must stay an abort,
      // not be reported as an unavailable-network failure.
      if (
        signal?.aborted ||
        (typeof err === "object" &&
          err !== null &&
          (err as { name?: unknown }).name === "AbortError")
      ) {
        throw err;
      }
      // A shaped AlmSearchError (from a non-2xx / auth throw above) propagates
      // as-is; a raw throw from fetch itself is a network failure.
      if (isAlmSearchError(err)) throw err;
      throw mkError("network", undefined, errMsg(err));
    }

    try {
      return (await res.json()) as CodeSearchResponse;
    } catch (err) {
      throw mkError("unknown", res.status, errMsg(err));
    }
  }
}

function mkError(
  kind: AlmSearchErrorKind,
  status?: number,
  message?: string,
): AlmSearchError {
  return { kind, status, message };
}

/**
 * Map a non-2xx HTTP status to a discriminated error kind. Exported for tests.
 */
export function statusToKind(status: number): AlmSearchErrorKind {
  if (status === 404) return "extension-missing";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "bad-request";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Outcome of instantiating a client. Success carries the impl + a label;
 * failure carries a shaped reason so callers can render an "unavailable" hint
 * before any query runs.
 */
export type AlmSearchClientResult =
  | { ok: true; client: AlmSearchClient; source: "rest" | "sdk" }
  | { ok: false; reason: "no-config"; message?: string };

/**
 * Build an `AlmSearchClient` for the current host, or
 * `{ ok: false, reason: "no-config" }` when org/token are missing (outside the
 * ADO iframe, in tests, or in the standalone preview).
 */
export function createAlmSearchClient(opts: {
  orgName?: string;
  getToken?: () => Promise<string>;
}): AlmSearchClientResult {
  if (!opts.orgName || !opts.getToken) {
    return {
      ok: false,
      reason: "no-config",
      message: "missing org name or token provider",
    };
  }
  return {
    ok: true,
    source: "rest",
    client: new AlmSearchRestClient(opts.orgName, opts.getToken),
  };
}

// ---------------------------------------------------------------------------
// High-level filename-search outcome
// ---------------------------------------------------------------------------
//
// `searchRepoFiles` (in `./adoGitData`) and the fixture equivalent both
// return this discriminated union so the DocNav can tell apart
// "0 results because of an empty repo" from "0 results because Code
// Search is not installed". The latter shows a hint banner; the former
// shows the standard "no matches" message.

import type { FileInfo } from "../types";

export type FileSearchOutcome =
  | { kind: "ok"; files: FileInfo[] }
  | {
      kind: "unavailable";
      reason: AlmSearchErrorKind;
      message?: string;
    };

/** Convert an `AlmSearchError` into a public `FileSearchOutcome`. */
export function outcomeFromError(err: unknown): FileSearchOutcome {
  if (isAlmSearchError(err)) {
    return { kind: "unavailable", reason: err.kind, message: err.message };
  }
  return { kind: "unavailable", reason: "unknown", message: errMsg(err) };
}
