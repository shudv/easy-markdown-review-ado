// Boot-time measurement — "how long until the experience is actually usable".
//
// The clock starts when the host starts loading our iframe — the iframe
// document's navigation start, `performance.now()` 0. ADO creates the iframe
// when the user opens our tab or hub (~50ms after the click, measured), so
// boot time covers what the user waits for: our page and bundle loading, the
// SDK handshake, REST fetches and the first Markdown render. The few ms before
// the iframe exists are the host's and invisible from inside it.
//
// The entry point calls `markBootStart()` as early as possible — its time is
// when our code started running, which ends the `bundleLoadMs` phase — and
// the app signals `markAppReady()` at the moment the first document's Markdown
// has been committed to the DOM (see Shell). Terminal no-content states
// (no Markdown files, a boot error) call `markAppReady("empty" | "error")` so a
// boot event still fires. `markAppReady` is idempotent — only the first call
// per boot wins — so multiple render passes / call sites are safe.
//
// `activeBootTimeMs` is foreground-visible elapsed time, accumulated from the
// monotonic clock across each interval where `document.visibilityState` is
// `visible`; the stretch before our code ran counts as whatever the page was
// when it did. It is not CPU time: browser APIs cannot perfectly distinguish a
// visible page whose machine slept from one whose main thread was busy. Keep
// `bootTimeMs`, `hiddenTimeMs`, and `bootHadHiddenInterval` alongside it so
// dashboards can identify suspended/preloaded sessions instead of clamping
// away the evidence.

import { track } from "./telemetry";
import { events, type AppReadyReason, type BootCache } from "./events";

export type BootPhase = "sdk-ready" | "context-ready";

export interface BootTimingEnvironment {
    now(): number;
    /**
     * When the host started loading this document, on the `now()` clock. Left
     * out, boot is timed from `markBootStart` and `bundleLoadMs` isn't sent.
     */
    navigationStart?(): number;
    isVisible(): boolean;
    subscribeVisibilityChange(listener: () => void): () => void;
}

const BROWSER_ENVIRONMENT: BootTimingEnvironment = {
    now: () => performance.now(),
    // `performance.now()` counts from this document's navigation start.
    navigationStart: () => 0,
    isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
    subscribeVisibilityChange(listener) {
        if (typeof document === "undefined") return () => {};
        document.addEventListener("visibilitychange", listener);

        return () => document.removeEventListener("visibilitychange", listener);
    },
};

let startMs: number | null = null;
// When our code started (`markBootStart`); read only while a boot is running.
let scriptStartMs = 0;
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
let afterAutoReload = false;
let bootShape: BootShape = {};
let cacheHits: Record<BootCachePart, boolean> = { pr: false, doc: false };
let unsubscribeVisibility: (() => void) | null = null;

/**
 * What this boot loaded, sent with `app.loaded` so boot time can be sliced by
 * size. Counts only — never names or content.
 */
export interface BootShape {
    /** Markdown files the PR changes (PR tab). */
    mdFileCount?: number;
    /** Characters of Markdown in the first rendered document. */
    docChars?: number;
}

/** A part of the first view that this browser can cache (see `BootCache`). */
export type BootCachePart = "pr" | "doc";

/** `cacheHits` as sent: which of this browser's caches the first view came from. */
function bootCache(): BootCache {
    if (cacheHits.pr) return cacheHits.doc ? "pr+doc" : "pr";

    return cacheHits.doc ? "doc" : "none";
}

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
 * Record that our code started. Call this at the very top of an entry module,
 * before the SDK handshake. Boot is timed from the host starting to load this
 * document (see the header), so this marks the end of `bundleLoadMs`.
 */
export function markBootStart(
    timingEnvironment: BootTimingEnvironment = BROWSER_ENVIRONMENT,
): void {
    clearVisibilitySubscription();
    environment = timingEnvironment;
    scriptStartMs = environment.now();
    startMs = Math.min(environment.navigationStart?.() ?? scriptStartMs, scriptStartMs);
    fired = false;
    activeElapsedMs = 0;
    hiddenElapsedMs = 0;
    authRefreshWaitMs = 0;
    authWaitStartMs = null;
    sdkReadyAtMs = null;
    contextReadyAtMs = null;
    afterAutoReload = false;
    bootShape = {};
    cacheHits = { pr: false, doc: false };
    wasHiddenDuringBoot = !environment.isVisible();
    activeStartMs = wasHiddenDuringBoot ? null : startMs;
    hiddenStartMs = wasHiddenDuringBoot ? startMs : null;
    unsubscribeVisibility = environment.subscribeVisibilityChange(captureVisibilityTransition);
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
 * Flag this boot as the reload we triggered to escape the token dead window,
 * so `app.loaded` can show whether the reload actually got the user in
 * (`authRefreshWaitMs == 0`) or landed back in the window.
 */
export function markBootAfterAutoReload(): void {
    if (fired || startMs === null) return;
    afterAutoReload = true;
}

/** Record what this boot is loading (merged); ignored outside a running boot. */
export function noteBootShape(shape: BootShape): void {
    if (fired || startMs === null) return;
    bootShape = { ...bootShape, ...shape };
}

/**
 * Record whether `part` of the first view came from this browser's cache; the
 * latest call wins (a PR shown from the cache, then reloaded because it was
 * pushed to, isn't a hit). Ignored outside a running boot.
 */
export function noteBootCache(part: BootCachePart, hit: boolean): void {
    if (fired || startMs === null) return;
    cacheHits = { ...cacheHits, [part]: hit };
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

    const codeStartMs = scriptStartMs;
    const lastPhaseAtMs = contextReadyAtMs ?? sdkReadyAtMs ?? codeStartMs;
    track(
        events.appLoaded({
            bootTimeMs: Math.round(elapsed(startMs, now)),
            activeBootTimeMs: Math.round(activeElapsedMs),
            hiddenTimeMs: Math.round(hiddenElapsedMs),
            authRefreshWaitMs: Math.round(authRefreshWaitMs),
            bundleLoadMs:
                environment.navigationStart === undefined
                    ? undefined
                    : Math.round(elapsed(startMs, codeStartMs)),
            sdkReadyMs:
                sdkReadyAtMs === null ? undefined : Math.round(elapsed(codeStartMs, sdkReadyAtMs)),
            contextReadyMs:
                contextReadyAtMs === null
                    ? undefined
                    : Math.round(elapsed(sdkReadyAtMs ?? codeStartMs, contextReadyAtMs)),
            renderReadyMs: Math.round(elapsed(lastPhaseAtMs, now)),
            readyReason: reason,
            bootHadHiddenInterval: wasHiddenDuringBoot,
            afterAutoReload,
            mdFileCount: bootShape.mdFileCount,
            docChars: bootShape.docChars,
            cache: bootCache(),
        }),
    );
}

/** Test-only: reset module state between cases. */
export function __resetBootTimingForTests(): void {
    clearVisibilitySubscription();
    startMs = null;
    scriptStartMs = 0;
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
    afterAutoReload = false;
    bootShape = {};
    cacheHits = { pr: false, doc: false };
}
