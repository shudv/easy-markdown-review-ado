// SDK-independent boot orchestration.
//
// Both iframe entry points (`pr-tab.tsx`, `markdownReviewHub.tsx`) follow the
// same lifecycle: initialise the SDK, wait until the host is ready, run the
// app-specific startup (telemetry, theme, render), then tell the host we
// loaded — and on ANY failure, notify the host of the failure (best-effort,
// since the SDK may not have initialised). That ordering is the contract the
// host relies on; getting it wrong (e.g. rendering before `ready`, or skipping
// `notifyLoadSucceeded`) produces timing-dependent startup bugs that don't show
// up in a component test.
//
// This module owns the ordering + failure handling as an injectable, SDK-free
// function so it can be unit-tested without loading the AMD Azure DevOps SDK.
// The entry points supply thin adapters that close over the real `SDK.*` calls.

export interface BootDeps {
  /** `SDK.init(...)` — establish the host connection. */
  init: () => Promise<void>;
  /** `SDK.ready()` — resolve once the host has finished handshaking. */
  ready: () => Promise<void>;
  /**
   * App-specific startup that must run only AFTER `ready` resolves: bring up
   * telemetry, sync theme, resolve services, and render. Reject to trigger the
   * failure path.
   */
  run: () => Promise<void>;
  /** `SDK.notifyLoadSucceeded()` — clears the host's loading spinner. */
  notifySucceeded: () => void;
  /** `SDK.notifyLoadFailed(err)` — best-effort; may throw if init never ran. */
  notifyFailed: (err: Error) => void;
  /**
   * Side-effect error sink (logging, telemetry, in-iframe error UI). Runs
   * before `notifyFailed`. Never throws in a way that should mask the failure
   * notification.
   */
  onError?: (err: unknown) => void;
}

/**
 * Drive the boot lifecycle in strict order: `init` → `ready` → `run` →
 * `notifySucceeded`. If any step rejects, `run`/`notifySucceeded` are skipped,
 * `onError` is invoked, and `notifyFailed` is called (its own throw is
 * swallowed — the host API may be unavailable when init failed). Never rejects.
 */
export async function orchestrateBoot(deps: BootDeps): Promise<void> {
  try {
    await deps.init();
    await deps.ready();
    await deps.run();
    deps.notifySucceeded();
  } catch (err: unknown) {
    try {
      deps.onError?.(err);
    } catch {
      // An error sink must never prevent the host from being notified.
    }
    try {
      deps.notifyFailed(err instanceof Error ? err : new Error(String(err)));
    } catch {
      // init never completed or the host API is unavailable — nothing else to do.
    }
  }
}
