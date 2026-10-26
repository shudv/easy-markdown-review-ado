// Global error handlers — the catch-all net for failures that escape the
// React tree and component-level try/catch. Registered once per app load by
// `initTelemetry` callers (the entry points).

import { markAppReady } from "./bootTiming";
import { trackException } from "./telemetry";

let installed = false;

function onError(event: ErrorEvent): void {
  trackException({
    error: event.error ?? new Error(event.message || "Unknown error"),
    severity: "error",
    source: "window.onerror",
    handled: false,
  });
  markAppReady("error");
}

/**
 * Coarse, privacy-safe description of a rejection reason's type, e.g.
 * `"string"`, `"object:Object"`, `"object:null-prototype"`. Never throws, even
 * for exotic objects (null prototype, cross-frame proxies, throwing getters).
 */
export function rejectionTypeOf(reason: unknown): string {
  if (reason === null) return "null";
  const kind = typeof reason;
  if (kind !== "object" && kind !== "function") return kind;
  try {
    const proto: unknown = Object.getPrototypeOf(reason);
    if (proto === null) return `${kind}:null-prototype`;
    const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
    const name = ctor?.name;
    return typeof name === "string" && name ? `${kind}:${name}` : kind;
  } catch {
    return `${kind}:opaque`;
  }
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  // Must never throw: an exception here escapes to `window.onerror` and hides
  // the real rejection. The old `new Error(String(reason))` did exactly that
  // for reasons with no primitive conversion ("Cannot convert object to
  // primitive value"). The sink's `describeError` handles any value safely,
  // so the reason is passed through as-is (keeping its HTTP status / TF code).
  try {
    const reason: unknown = event.reason;
    trackException({
      error: reason,
      severity: "error",
      source: "unhandledrejection",
      handled: false,
      ...(reason instanceof Error
        ? {}
        : { properties: { rejectionType: rejectionTypeOf(reason) } }),
    });
  } catch {
    /* diagnostics must never throw from a global handler */
  }
  markAppReady("error");
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
