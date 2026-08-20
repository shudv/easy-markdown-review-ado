// Telemetry facade — the ONLY telemetry surface the application imports.
//
// Responsibilities:
//   - Select a concrete sink at boot based on build config.
//   - Hold the ambient (de-identified) context and merge it into every signal.
//   - Run every payload through the sanitizer before it reaches a sink.
//   - Guarantee best-effort semantics: no telemetry call may ever throw into
//     application code.

import { readBuildConfig } from "./config";
import type { TelemetryBuildConfig } from "./buildConfig";
import { hashId, sanitizeMeasurements, sanitizeProperties } from "./sanitize";
import type {
  TelemetryContext,
  TelemetryEvent,
  TelemetryExceptionInfo,
  TelemetrySink,
} from "./types";
import { consoleSink } from "./sinks/consoleSink";
import { createOneDsSink } from "./sinks/oneDsSink";

// No-op sink — the safe default. Selected whenever no ingestion key is
// configured (local dev, standalone preview, Storybook, unit tests) and used as
// the fallback if setup fails, so the app never performs egress unless
// explicitly provisioned. Inlined here because it is the facade's own default
// state, not a selectable backend.
const NOOP_SINK: TelemetrySink = {
  name: "noop",
  init() {},
  setContext() {},
  trackEvent() {},
  trackException() {},
  flush() {},
};

let sink: TelemetrySink = NOOP_SINK;
let context: TelemetryContext = {};
let initialised = false;

function makeSessionId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function selectSink(cfg: TelemetryBuildConfig): TelemetrySink {
  /* v8 ignore start */
  // The enabled branch constructs the 1DS SDK sink, which only runs in a real
  // browser build with a provisioned key. Neither successful construction nor
  // the SDK-init-failure fallback is reproducible under jsdom, so it is verified
  // via manual/e2e telemetry checks. See src/telemetry/sinks/oneDsSink.ts.
  if (cfg.enabled) {
    const oneds = createOneDsSink(cfg);
    if (oneds) return oneds;
    // A key is configured but the 1DS SDK failed to initialise; fall back so
    // the app keeps working without telemetry.

    console.warn(
      "[telemetry] ingestion key present but 1DS sink failed to initialise; " +
        "falling back (see src/telemetry/sinks/oneDsSink.ts).",
    );
    return cfg.debug ? consoleSink : NOOP_SINK;
  }
  /* v8 ignore stop */
  return cfg.debug ? consoleSink : NOOP_SINK;
}

/** Normalise raw context input — hashes the PR id so the raw value never ships. */
function normaliseContext(
  patch: Omit<Partial<TelemetryContext>, "pullRequestId"> & {
    pullRequestId?: string | number;
  },
): Partial<TelemetryContext> {
  const { pullRequestId, ...rest } = patch;
  const next: Partial<TelemetryContext> = { ...rest };
  if (pullRequestId !== undefined && pullRequestId !== "") {
    next.pullRequestId = hashId(pullRequestId);
  }
  return next;
}

/**
 * Initialise telemetry once per app load. Safe to call repeatedly (later calls
 * are ignored). Registers the selected sink and seeds session context.
 */
export function initTelemetry(opts: {
  appName: string;
  /**
   * Installed extension version from `SDK.getExtensionContext().version`,
   * read by the (SDK-aware) entry point and threaded in so this module stays
   * SDK-free. Optional — absent under tests / when the host can't provide it.
   */
  extensionVersion?: string;
}): void {
  if (initialised) return;
  initialised = true;
  try {
    const cfg = readBuildConfig();
    context = {
      appName: opts.appName,
      appVersion: cfg.appVersion,
      extensionVersion: opts.extensionVersion,
      environment: cfg.environment,
      sessionId: makeSessionId(),
    };
    sink = selectSink(cfg);
    sink.init(context);
  } catch {
    // Defensive: telemetry setup must never break app boot.
    /* v8 ignore next */
    sink = NOOP_SINK;
  }
}

/**
 * Update ambient context (project/repo/PR). Pass the RAW pull-request id; it is
 * hashed here. Only de-identified ids should ever be passed.
 */
export function setTelemetryContext(
  patch: Omit<Partial<TelemetryContext>, "pullRequestId"> & {
    pullRequestId?: string | number;
  },
): void {
  try {
    context = { ...context, ...normaliseContext(patch) };
    sink.setContext(context);
  } catch {
    /* swallow */
  }
}

export function getTelemetryContext(): Readonly<TelemetryContext> {
  return context;
}

/** Emit an engagement event. Accepts the output of an `events.*` builder. */
export function track(event: TelemetryEvent): void {
  try {
    const { clean } = sanitizeProperties(event.properties);
    sink.trackEvent(
      {
        name: event.name,
        properties: clean,
        measurements: sanitizeMeasurements(event.measurements),
      },
      context,
    );
  } catch {
    /* swallow */
  }
}

/** Report an error/exception (handled or uncaught). */
export function trackException(info: TelemetryExceptionInfo): void {
  try {
    const { clean } = sanitizeProperties(info.properties);
    sink.trackException({ ...info, properties: clean }, context);
  } catch {
    /* swallow */
  }
}

export function flushTelemetry(): void | Promise<void> {
  try {
    return sink.flush();
  } catch {
    /* swallow */
  }
}

/** Test-only: reset module singletons between cases. */
export function __resetTelemetryForTests(replacement?: TelemetrySink): void {
  initialised = false;
  context = {};
  sink = replacement ?? NOOP_SINK;
}
