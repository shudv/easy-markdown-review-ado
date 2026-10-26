// Dev-only fault injection — reproduces production failure conditions on
// demand inside the REAL Azure DevOps host, so the e2e suite (and a developer
// in `npm run dev:ado`) can check how the app behaves when things go wrong.
//
// NEVER shipped: entry points call `installDevFaults()` only behind the
// `__EMR_DEV_FAULTS__` build flag, which is `false` in production builds, and
// `scripts/check-no-dev-faults.mjs` fails the build if any of this survives.
//
// Faults (all optional, combinable):
//   - deadWindow  the ADO token dead window: ADO REST calls fail with 401
//                 TF400813 AND the host token reads as one whose ADO grant has
//                 lapsed, exactly like production. `healAfterBoots: n` lets
//                 it survive the next n page loads and clears it on the one
//                 after (a host reload that escapes the window); omit it and
//                 reloads never help.
//   - plain401    401s while the token is fine — must NOT look like the dead
//                 window (no "Reconnecting" banner).
//   - slowApiMs   delay ADO REST calls (a slow / throttled host) — all of
//                 them, or only the next `slowApiRemaining`.
//   - hiddenUntilMs  report the page as hidden (a background tab).
//   - failNextWrite  the next write request drops with a network error.
//
// The config lives in `sessionStorage` (the iframe's origin), so it survives
// a host-page reload — the next boot sees the same faults. Driven from the
// console / Playwright via `window.__emrFaults` (see `faultsApi`).

import { isAdoApiUrl } from "../telemetry/authFailureCapture";
import { setHostTokenOverride } from "../shell/hostToken";

export const FAULTS_STORAGE_KEY = "emr.devFaults";

export interface FaultConfig {
  deadWindow?: {
    untilMs: number;
    /**
     * Page loads that still land in the window before one escapes it: 0 =
     * the next load is healed, 1 = the next load still sees it but the one
     * after (e.g. our automatic reload) is healed. Omitted = never healed.
     */
    healAfterBoots?: number;
  };
  plain401?: { untilMs: number };
  slowApiMs?: number;
  /** Only this many more requests are delayed (omitted = all). */
  slowApiRemaining?: number;
  hiddenUntilMs?: number;
  failNextWrite?: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FaultDeps {
  storage: StorageLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function readFaults(storage: StorageLike): FaultConfig {
  try {
    const raw = storage.getItem(FAULTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as FaultConfig)
      : {};
  } catch {
    return {};
  }
}

export function writeFaults(storage: StorageLike, cfg: FaultConfig): void {
  if (Object.keys(cfg).length === 0) storage.removeItem(FAULTS_STORAGE_KEY);
  else storage.setItem(FAULTS_STORAGE_KEY, JSON.stringify(cfg));
}

function b64url(json: string): string {
  return btoa(json).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * A host token shaped like the production dead-window token: its embedded ADO
 * grant (`xms_attr.*.ado_exp`) lapsed a minute ago, while the AAD `exp` — when
 * the host will re-mint — is the end of the simulated window.
 */
export function deadWindowToken(nowMs: number, untilMs: number): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "none" }));
  const payload = b64url(
    JSON.stringify({
      exp: Math.floor(untilMs / 1000),
      xms_attr: {
        devFaults: { ado_exp: Math.floor((nowMs - 60_000) / 1000) },
      },
    }),
  );
  return `${header}.${payload}.dev-fault`;
}

/** The token override while a dead window is active, else `null`. */
export function activeDeadToken(
  cfg: FaultConfig,
  nowMs: number,
): string | null {
  const w = cfg.deadWindow;
  return w && nowMs < w.untilMs ? deadWindowToken(nowMs, w.untilMs) : null;
}

/**
 * Apply boot-time transitions: an expired window is dropped, and a window
 * with `healAfterBoots` counts this page load down — at 0 the load escapes it
 * (the reload "worked").
 */
export function onBoot(cfg: FaultConfig, nowMs: number): FaultConfig {
  const w = cfg.deadWindow;
  if (!w) return cfg;
  const { deadWindow: _dropped, ...rest } = cfg;
  if (nowMs >= w.untilMs) return rest;
  if (w.healAfterBoots === undefined) return cfg;
  if (w.healAfterBoots <= 0) return rest;
  return { ...cfg, deadWindow: { ...w, healAfterBoots: w.healAfterBoots - 1 } };
}

const TF400813_BODY = JSON.stringify({
  $id: "1",
  innerException: null,
  message:
    "TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not authorized to access this resource.",
  typeName:
    "Microsoft.TeamFoundation.Framework.Server.UnauthorizedRequestException, Microsoft.TeamFoundation.Framework.Server",
  typeKey: "UnauthorizedRequestException",
  errorCode: 0,
  eventId: 3000,
});

function unauthorized(url: string): Response {
  const res = new Response(TF400813_BODY, {
    status: 401,
    statusText: "Unauthorized",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": "Bearer",
    },
  });
  // A constructed Response has an empty `url`; real ones don't, and the auth
  // failure capture keys off it.
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromRequest = typeof input === "object" && "method" in input;
  return (init?.method ?? (fromRequest ? input.method : "GET")).toUpperCase();
}

/** Wrap `fetch` so ADO REST calls honour the active faults. */
export function createFaultyFetch(
  original: typeof fetch,
  deps: FaultDeps,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isAdoApiUrl(url)) return original(input, init);
    const cfg = readFaults(deps.storage);
    if (cfg.slowApiMs) {
      if (cfg.slowApiRemaining !== undefined) {
        const { slowApiMs: _ms, slowApiRemaining: left, ...rest } = cfg;
        writeFaults(
          deps.storage,
          left > 1 ? { ...cfg, slowApiRemaining: left - 1 } : rest,
        );
      }
      await deps.sleep(cfg.slowApiMs);
    }
    if (cfg.failNextWrite && requestMethod(input, init) !== "GET") {
      const { failNextWrite: _used, ...rest } = cfg;
      writeFaults(deps.storage, rest);
      throw new TypeError("Failed to fetch");
    }
    const now = deps.now();
    const deadActive = !!cfg.deadWindow && now < cfg.deadWindow.untilMs;
    const plainActive = !!cfg.plain401 && now < cfg.plain401.untilMs;
    if (deadActive || plainActive) return unauthorized(url);
    return original(input, init);
  }) as typeof fetch;
}

/** The `window.__emrFaults` control surface (console / Playwright). */
export function faultsApi(deps: FaultDeps) {
  const update = (patch: (cfg: FaultConfig) => FaultConfig): FaultConfig => {
    const next = patch(readFaults(deps.storage));
    writeFaults(deps.storage, next);
    return next;
  };
  return {
    /**
     * Start a dead window now, lasting `seconds` (default 120). With
     * `healAfterBoots`, a later page load escapes it (see FaultConfig).
     */
    deadWindow: (opts: { seconds?: number; healAfterBoots?: number } = {}) =>
      update((cfg) => ({
        ...cfg,
        deadWindow: {
          untilMs: deps.now() + (opts.seconds ?? 120) * 1000,
          ...(opts.healAfterBoots !== undefined
            ? { healAfterBoots: opts.healAfterBoots }
            : {}),
        },
      })),
    /** 401s with a perfectly good token, for `seconds` (default 60). */
    plain401: (seconds = 60) =>
      update((cfg) => ({
        ...cfg,
        plain401: { untilMs: deps.now() + seconds * 1000 },
      })),
    /** Delay ADO REST calls by `ms` — all, or just the next `times` (0 ms stops). */
    slowApi: (ms: number, times?: number) =>
      update(({ slowApiMs: _old, slowApiRemaining: _left, ...cfg }) =>
        ms > 0
          ? {
              ...cfg,
              slowApiMs: ms,
              ...(times !== undefined ? { slowApiRemaining: times } : {}),
            }
          : cfg,
      ),
    /** Report the page as hidden for `seconds` (survives a reload). */
    hidden: (seconds: number) =>
      update((cfg) => ({
        ...cfg,
        hiddenUntilMs: deps.now() + seconds * 1000,
      })),
    /** Make the next write request fail with a network error. */
    failNextWrite: () => update((cfg) => ({ ...cfg, failNextWrite: true })),
    /** Remove every fault. */
    clear: () => update(() => ({})),
    /** The current fault config. */
    status: () => readFaults(deps.storage),
  };
}

/**
 * Report the document as hidden until `untilMs`, then visible again — the
 * background-tab case. Fires `visibilitychange` on both transitions.
 */
export function simulateHidden(
  doc: Document,
  untilMs: number,
  now: () => number,
  schedule: (fn: () => void, ms: number) => void,
): void {
  const remaining = untilMs - now();
  if (remaining <= 0) return;
  Object.defineProperty(doc, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  doc.dispatchEvent(new Event("visibilitychange"));
  schedule(() => {
    delete (doc as { visibilityState?: unknown }).visibilityState;
    doc.dispatchEvent(new Event("visibilitychange"));
  }, remaining);
}

const BROWSER_DEPS = (): FaultDeps => ({
  storage: window.sessionStorage,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** Wire everything up. Call first thing in an entry point (dev builds only). */
export function installDevFaults(deps: FaultDeps = BROWSER_DEPS()): void {
  const booted = onBoot(readFaults(deps.storage), deps.now());
  writeFaults(deps.storage, booted);
  window.fetch = createFaultyFetch(window.fetch.bind(window), deps);
  setHostTokenOverride(() =>
    activeDeadToken(readFaults(deps.storage), deps.now()),
  );
  if (booted.hiddenUntilMs !== undefined) {
    simulateHidden(document, booted.hiddenUntilMs, deps.now, (fn, ms) => {
      setTimeout(fn, ms);
    });
  }
  (window as unknown as { __emrFaults: unknown }).__emrFaults = faultsApi(deps);
  if (Object.keys(booted).length > 0) {
    console.warn("[dev faults] active:", booted);
  }
}
