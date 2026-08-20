// Telemetry abstraction — vendor-neutral contracts.
//
// Nothing in the application imports a concrete telemetry vendor. App code
// talks to the facade in `telemetry.ts`, which delegates to whichever
// `TelemetrySink` is selected at boot. This lets us swap the backend (1DS,
// Application Insights, a custom collector, or a no-op) without touching a
// single call site.

/** Scalar values permitted on an event. Objects/arrays are intentionally
 * excluded so structured PII cannot be smuggled into a property bag. */
export type TelemetryValue = string | number | boolean | null | undefined;

/** Free-form, sanitised string/scalar properties attached to an event. */
export type TelemetryProperties = Record<string, TelemetryValue>;

/** Numeric metrics (durations, counts) attached to an event. */
export type TelemetryMeasurements = Record<string, number>;

export type TelemetrySeverity = "info" | "warning" | "error" | "critical";

/**
 * Ambient context merged into every event/exception. Holds ONLY de-identified
 * identifiers — never names, paths, emails, or free text. Populated once at
 * boot by the entry point and updated when the active repo/PR changes.
 */
export interface TelemetryContext {
  /** Logical surface emitting the event, e.g. "pr-tab" | "documents-hub". */
  appName?: string;
  /** Extension version (from the build). */
  appVersion?: string;
  /**
   * Installed extension version as reported by the host at runtime
   * (`SDK.getExtensionContext().version`), e.g. `0.0.1.<timestamp>`. Unlike
   * {@link appVersion} — the base version baked into the bundle at build time
   * (always `0.0.1`) — this is the actual Marketplace build the user is running,
   * so triage can tell a report on a stale deployment from one on the current
   * build. The trailing segment is a Unix publish timestamp.
   */
  extensionVersion?: string;
  /** Deployment ring: "production" | "development". For prod/dev slicing. */
  environment?: string;
  /** ADO project GUID. Never the project name. */
  projectId?: string;
  /** ADO repository GUID. Never the repo name. */
  repositoryId?: string;
  /** Pseudonymised pull-request id (hashed, not the raw integer). */
  pullRequestId?: string;
  /** Random per-load id correlating a single session's events. Not a user id. */
  sessionId?: string;
}

export interface TelemetryEvent {
  /** Dotted event name from the catalog in `events.ts`. */
  name: string;
  properties?: TelemetryProperties;
  measurements?: TelemetryMeasurements;
}

export interface TelemetryExceptionInfo {
  /** The thrown value. Stack/message are extracted; never sent verbatim as a property. */
  error: unknown;
  severity?: TelemetrySeverity;
  /** Where the error was observed, e.g. "global.onerror" or "Create comment". */
  source?: string;
  /** Whether the app caught and recovered from this (true) or it was uncaught (false). */
  handled?: boolean;
  properties?: TelemetryProperties;
}

/**
 * A concrete telemetry backend. Implementations live in `sinks/`. All methods
 * must be safe to call before `init` and must never throw — telemetry failures
 * may never break the host app.
 */
export interface TelemetrySink {
  readonly name: string;
  init(context: TelemetryContext): void;
  setContext(context: TelemetryContext): void;
  trackEvent(event: TelemetryEvent, context: TelemetryContext): void;
  trackException(info: TelemetryExceptionInfo, context: TelemetryContext): void;
  flush(): void | Promise<void>;
}
