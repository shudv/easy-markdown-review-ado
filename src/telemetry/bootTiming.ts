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

import { track } from "./telemetry";
import { events, type AppReadyReason } from "./events";

let startMs: number | null = null;
let fired = false;

/**
 * Record the boot start. Call this at the very top of an entry module, before
 * the SDK handshake, so the measurement spans the whole path to first content.
 */
export function markBootStart(): void {
  startMs = performance.now();
  fired = false;
}

/**
 * Emit the one-shot `app.loaded` boot-time event. No-ops if boot was never
 * started (e.g. Storybook / standalone, where `markBootStart` isn't called) or
 * if it already fired. `reason` records what completed boot.
 */
export function markAppReady(reason: AppReadyReason = "content"): void {
  if (fired || startMs === null) return;
  fired = true;
  const bootTimeMs = Math.round(performance.now() - startMs);
  track(events.appLoaded({ bootTimeMs, readyReason: reason }));
}

/** Test-only: reset module state between cases. */
export function __resetBootTimingForTests(): void {
  startMs = null;
  fired = false;
}
