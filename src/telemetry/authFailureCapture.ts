// Auto-capture of ADO auth failures (401 / 403).
//
// Installs a light wrapper around the global `fetch` (which the ADO REST clients
// use internally) so every auth rejection emits a privacy-safe `auth.failure`
// event. This catches the failures that exception telemetry MISSES — the
// transient 401s that a retry heals a moment later never surface as an
// exception, yet they're exactly the "super puzzling" intermittent auth we're
// chasing. It also records whether the request hit a legacy
// `{org}.visualstudio.com` host, so the host-correlation hypothesis can be
// confirmed in aggregate instead of one incident at a time.
//
// It reads only the response STATUS + a few headers (never the body, so the
// response stream is untouched) and only for `/_apis/` calls that failed auth.
// Idempotent and defensive: it never throws and always returns the original
// response unchanged.

import { track } from "./telemetry";
import { events } from "./events";

/** True for an Azure DevOps REST API URL. */
export function isAdoApiUrl(url: string): boolean {
  return /\/_apis\//.test(url);
}

/** True when the URL targets a legacy `{org}.visualstudio.com` host. */
export function isLegacyHost(url: string): boolean {
  const host = /^https?:\/\/([^/]+)/.exec(url)?.[1]?.toLowerCase() ?? "";
  return host.endsWith(".visualstudio.com");
}

// A path segment that's a numeric id or a GUID — dropped so the API area never
// carries an identifier.
const ID_SEGMENT_RE =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// The SECOND `_apis` segment is kept only when it's a known ADO controller
// name. Otherwise it can be a user-defined project / repo / resource NAME
// (e.g. `/_apis/projects/{name}`) that must never reach telemetry. The first
// segment is always an ADO area name, so it is safe to emit on its own.
// (PR AI review — Security: Sensitive Data Handling.)
const SAFE_SUBAREAS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "git",
    new Set([
      "pullrequests",
      "repositories",
      "refs",
      "commits",
      "pushes",
      "threads",
    ]),
  ],
  ["wit", new Set(["workitems", "workitemtypes", "fields", "queries", "wiql"])],
  ["search", new Set(["codesearchresults", "workitemsearchresults"])],
  ["build", new Set(["builds", "definitions"])],
  ["policy", new Set(["configurations", "evaluations"])],
  ["core", new Set(["projects", "teams"])],
]);

/**
 * Coarse, id-free API area for grouping: `.../_apis/git/pullRequests/123` →
 * `"git.pullrequests"`. The second segment is appended only when it's an
 * allow-listed controller name (see {@link SAFE_SUBAREAS}); anything else
 * collapses to just the area (e.g. `/_apis/projects/{name}` → `"projects"`) so
 * a project / resource name can never leak. Dot-joined (never slashes) so the
 * value can't be mistaken for a path by the telemetry sanitizer.
 */
export function apiAreaOf(url: string): string | undefined {
  const m = /\/_apis\/([^?#]*)/.exec(url);
  if (!m || !m[1]) return undefined;
  const segs = m[1].split("/").filter((s) => s);
  const first = segs[0]?.toLowerCase();
  if (!first || ID_SEGMENT_RE.test(first)) return undefined;
  const secondRaw = segs[1];
  const second = secondRaw?.toLowerCase();
  if (
    second &&
    !ID_SEGMENT_RE.test(secondRaw) &&
    SAFE_SUBAREAS.get(first)?.has(second)
  ) {
    return `${first}.${second}`;
  }
  return first;
}

export interface AuthFailureInput {
  status: number;
  api?: string;
  legacyHost: boolean;
  fedAuthRedirect: boolean;
  serviceError: boolean;
  wwwAuthenticate: boolean;
}

/**
 * Build the event input from a URL, status, and a case-insensitive header
 * getter. Header values are reduced to booleans (presence only) — we never send
 * the values. Cross-origin CORS may hide some headers; that just yields `false`.
 */
export function authFailureInput(
  url: string,
  status: number,
  getHeader: (name: string) => string | null,
): AuthFailureInput {
  return {
    status,
    api: apiAreaOf(url),
    legacyHost: isLegacyHost(url),
    fedAuthRedirect: getHeader("X-TFS-FedAuthRedirect") !== null,
    serviceError: getHeader("X-TFS-ServiceError") !== null,
    wwwAuthenticate: getHeader("WWW-Authenticate") !== null,
  };
}

/**
 * A cooldown so a burst of identical failures emits once per key. Pure and
 * clock-injectable for tests.
 */
export function createThrottle(
  cooldownMs = 30_000,
  now: () => number = Date.now,
): (key: string) => boolean {
  const last = new Map<string, number>();
  return (key: string): boolean => {
    const t = now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < cooldownMs) return false;
    last.set(key, t);
    return true;
  };
}

let installed = false;

/** Wrap the global `fetch` to emit `auth.failure` on ADO 401/403 responses. */
export function installAuthFailureCapture(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  installed = true;
  const original = window.fetch.bind(window);
  const allow = createThrottle();
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      if ((res.status === 401 || res.status === 403) && isAdoApiUrl(res.url)) {
        const data = authFailureInput(res.url, res.status, (n) =>
          res.headers.get(n),
        );
        const key = `${data.status}:${data.api ?? "?"}:${data.legacyHost}`;
        if (allow(key)) track(events.authFailure(data));
      }
    } catch {
      /* diagnostics must never break a real fetch */
    }
    return res;
  }) as typeof window.fetch;
}
