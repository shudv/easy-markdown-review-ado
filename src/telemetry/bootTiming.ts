// Boot-time measurement — "how long until the experience is actually usable".
//
// The naive approach (timestamp right after `createRoot().render()`) only
// measures how long it took to *kick off* React, not how long until the user
// sees rendered Markdown. That reads as ~200-300ms while the real
// time-to-content is dominated by the SDK handshake + REST fetches + the first
// Markdown render that happen afterwards.
//
// Instead, the entry point calls `markBootStart()` as early as possible, and
// the app signals `markAppReady()` at the moment the first document's Markdown
// has been committed to the DOM (see PrShell). Terminal no-content states
// (no Markdown files, a boot error) call `markAppReady("empty" | "error")` so a
// boot event still fires. `markAppReady` is idempotent — only the first call
// per boot wins — so multiple render passes / call sites are safe.
//
// `activeBootTimeMs` is foreground-visible elapsed time, accumulated from the
// monotonic clock across each interval where `document.visibilityState` is
// `visible`. It is not CPU time: browser APIs cannot perfectly distinguish a
// visible page whose machine slept from one whose main thread was busy. Keep
// `bootTimeMs`, `hiddenTimeMs`, and `bootHadHiddenInterval` alongside it so
// dashboards can identify suspended/preloaded sessions instead of clamping
// away the evidence.

import { track } from "./telemetry";
import { events, type AppReadyReason } from "./events";

export type BootPhase = "sdk-ready" | "context-ready";

export interface BootTimingEnvironment {
  now(): number;
  isVisible(): boolean;
  subscribeVisibilityChange(listener: () => void): () => void;
}

const BROWSER_ENVIRONMENT: BootTimingEnvironment = {
  now: () => performance.now(),
  isVisible: () =>
    typeof document === "undefined" || document.visibilityState === "visible",
  subscribeVisibilityChange(listener) {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

let startMs: number | null = null;
let fired = false;
let environment = BROWSER_ENVIRONMENT;
let activeStartMs: number | null = null;
let hiddenStartMs: number | null = null;
let activeElapsedMs = 0;
let hiddenElapsedMs = 0;
let wasHiddenDuringBoot = false;
let authWaitStartMs: number | null = null;
let authRefreshWaitMs = 0;
let sdkReadyAtMs: number | null = null;
let contextReadyAtMs: number | null = null;
let unsubscribeVisibility: (() => void) | null = null;

function elapsed(from: number, to: number): number {
  return Math.max(0, to - from);
}

function clearVisibilitySubscription(): void {
  unsubscribeVisibility?.();
  unsubscribeVisibility = null;
}

function captureVisibilityTransition(): void {
  if (startMs === null || fired) return;
  const now = environment.now();
  if (environment.isVisible()) {
    if (hiddenStartMs !== null) {
      hiddenElapsedMs += elapsed(hiddenStartMs, now);
      hiddenStartMs = null;
    }
    activeStartMs ??= now;
  } else {
    wasHiddenDuringBoot = true;
    if (activeStartMs !== null) {
      activeElapsedMs += elapsed(activeStartMs, now);
      activeStartMs = null;
    }
    hiddenStartMs ??= now;
  }
}

/**
 * Record the boot start. Call this at the very top of an entry module, before
 * the SDK handshake, so the measurement spans the whole path to first content.
 */
export function markBootStart(
  timingEnvironment: BootTimingEnvironment = BROWSER_ENVIRONMENT,
): void {
  clearVisibilitySubscription();
  environment = timingEnvironment;
  startMs = environment.now();
  fired = false;
  activeElapsedMs = 0;
  hiddenElapsedMs = 0;
  authRefreshWaitMs = 0;
  authWaitStartMs = null;
  sdkReadyAtMs = null;
  contextReadyAtMs = null;
  wasHiddenDuringBoot = !environment.isVisible();
  activeStartMs = wasHiddenDuringBoot ? null : startMs;
  hiddenStartMs = wasHiddenDuringBoot ? startMs : null;
  unsubscribeVisibility = environment.subscribeVisibilityChange(
    captureVisibilityTransition,
  );
}

/** Record the first completion of a boot phase. Duplicate marks are ignored. */
export function markBootPhase(phase: BootPhase): void {
  if (fired || startMs === null) return;
  const now = environment.now();
  if (phase === "sdk-ready") sdkReadyAtMs ??= now;
  else contextReadyAtMs ??= now;
}

/** Begin an interval spent waiting for the host to refresh its ADO grant. */
export function markBootAuthWaitStart(): void {
  if (fired || startMs === null || authWaitStartMs !== null) return;
  authWaitStartMs = environment.now();
}

/** End the current ADO-grant wait, if one is active. */
export function markBootAuthWaitEnd(): void {
  if (authWaitStartMs === null) return;
  authRefreshWaitMs += elapsed(authWaitStartMs, environment.now());
  authWaitStartMs = null;
}

/**
 * Emit the one-shot `app.loaded` boot-time event. No-ops if boot was never
 * started (e.g. Storybook / standalone, where `markBootStart` isn't called) or
 * if it already fired. `reason` records what completed boot.
 */
export function markAppReady(reason: AppReadyReason = "content"): void {
  if (fired || startMs === null) return;
  const now = environment.now();
  if (activeStartMs !== null) {
    activeElapsedMs += elapsed(activeStartMs, now);
    activeStartMs = null;
  }
  if (hiddenStartMs !== null) {
    hiddenElapsedMs += elapsed(hiddenStartMs, now);
    hiddenStartMs = null;
  }
  if (authWaitStartMs !== null) {
    authRefreshWaitMs += elapsed(authWaitStartMs, now);
    authWaitStartMs = null;
  }
  fired = true;
  clearVisibilitySubscription();

  const lastPhaseAtMs = contextReadyAtMs ?? sdkReadyAtMs ?? startMs;
  track(
    events.appLoaded({
      bootTimeMs: Math.round(elapsed(startMs, now)),
      activeBootTimeMs: Math.round(activeElapsedMs),
      hiddenTimeMs: Math.round(hiddenElapsedMs),
      authRefreshWaitMs: Math.round(authRefreshWaitMs),
      sdkReadyMs:
        sdkReadyAtMs === null
          ? undefined
          : Math.round(elapsed(startMs, sdkReadyAtMs)),
      contextReadyMs:
        contextReadyAtMs === null
          ? undefined
          : Math.round(elapsed(sdkReadyAtMs ?? startMs, contextReadyAtMs)),
      renderReadyMs: Math.round(elapsed(lastPhaseAtMs, now)),
      readyReason: reason,
      bootHadHiddenInterval: wasHiddenDuringBoot,
    }),
  );
}

/** Test-only: reset module state between cases. */
export function __resetBootTimingForTests(): void {
  clearVisibilitySubscription();
  startMs = null;
  fired = false;
  environment = BROWSER_ENVIRONMENT;
  activeStartMs = null;
  hiddenStartMs = null;
  activeElapsedMs = 0;
  hiddenElapsedMs = 0;
  wasHiddenDuringBoot = false;
  authWaitStartMs = null;
  authRefreshWaitMs = 0;
  sdkReadyAtMs = null;
  contextReadyAtMs = null;
}
