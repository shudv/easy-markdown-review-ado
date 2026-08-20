// Global error handlers — the catch-all net for failures that escape the
// React tree and component-level try/catch. Registered once per app load by
// `initTelemetry` callers (the entry points).

import { trackException } from "./telemetry";

let installed = false;

function onError(event: ErrorEvent): void {
  trackException({
    error: event.error ?? new Error(event.message || "Unknown error"),
    severity: "error",
    source: "window.onerror",
    handled: false,
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  trackException({
    error: reason instanceof Error ? reason : new Error(String(reason)),
    severity: "error",
    source: "unhandledrejection",
    handled: false,
  });
}

/** Attach global listeners. Idempotent; safe to call from each entry point. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}

/** Test-only teardown. */
export function __uninstallGlobalErrorHandlersForTests(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
  installed = false;
}
