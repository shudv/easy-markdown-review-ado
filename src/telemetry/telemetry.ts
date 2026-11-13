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
import { errorTagsOf } from "./errorTags";
import { hashId, sanitizeMeasurements, sanitizeProperties } from "./sanitize";
import type {
    TelemetryContext,
    TelemetryEvent,
    TelemetryExceptionInfo,
    TelemetrySeverity,
    TelemetrySink,
} from "./types";
import { readUsageDataEnabled, writeUsageDataEnabled } from "./consent";
import { consoleSink } from "./sinks/consoleSink";
import { isUsableDsn, parseConnectionString } from "./sinks/credentials";
import { deferredSink } from "./sinks/deferredSink";

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
let buildConfig: TelemetryBuildConfig | undefined;

function makeRandomId(): string {
    const cryptoObj = globalThis.crypto as Crypto | undefined;

    if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();

    // randomUUID needs a secure context; getRandomValues doesn't.
    if (typeof cryptoObj?.getRandomValues === "function") {
        const bytes = cryptoObj.getRandomValues(new Uint8Array(8));

        return `s-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }

    // No Web Crypto at all: the id only groups this load's events.
    return `s-${Date.now().toString(36)}`;
}

export const INSTALL_ID_STORAGE_KEY = "emr.installId";
const INSTALL_ID_RE = /^[\w-]{1,64}$/;

/**
 * This browser's persisted install id, created on first use. `undefined` when
 * localStorage is unavailable (private mode, blocked storage): a per-load id
 * would masquerade as a new install on every visit and skew return usage.
 */
function readInstallId(): string | undefined {
    try {
        const stored = window.localStorage.getItem(INSTALL_ID_STORAGE_KEY);
        if (stored !== null && INSTALL_ID_RE.test(stored)) return stored;
        const created = makeRandomId();
        window.localStorage.setItem(INSTALL_ID_STORAGE_KEY, created);

        return created;
    } catch {
        return undefined;
    }
}

/** One sink that forwards to several, isolating each from the others' failures. */
function fanOut(sinks: readonly TelemetrySink[]): TelemetrySink {
    const each = (call: (s: TelemetrySink) => void) => {
        for (const s of sinks) {
            try {
                call(s);
            } catch {
                /* one backend failing must not starve the others */
            }
        }
    };

    return {
        name: sinks.map((s) => s.name).join("+"),
        init: (ctx) => each((s) => s.init(ctx)),
        setContext: (ctx) => each((s) => s.setContext(ctx)),
        trackEvent: (event, ctx) => each((s) => s.trackEvent(event, ctx)),
        trackException: (info, ctx) => each((s) => s.trackException(info, ctx)),
        flush: () => each((s) => void s.flush()),
        discard: () => each((s) => s.discard?.()),
    };
}

function selectSink(cfg: TelemetryBuildConfig): TelemetrySink {
    const fallback = cfg.debug ? consoleSink : NOOP_SINK;
    if (!cfg.enabled) return fallback;

    // Usage events (and exceptions) go to Application Insights; exceptions also
    // go to Sentry for symbolicated stacks. Either can be configured alone. The
    // SDKs load in their own chunks, after boot has started, never blocking it.
    const sinks: TelemetrySink[] = [];

    if (parseConnectionString(cfg.key) !== null) {
        sinks.push(
            deferredSink("appinsights", () =>
                import(
                    /* webpackChunkName: "telemetry-appinsights" */ "./sinks/appInsightsSink"
                ).then((m) => m.createAppInsightsSink(cfg.key)),
            ),
        );
    }

    if (isUsableDsn(cfg.errorDsn)) {
        sinks.push(
            deferredSink("sentry", () =>
                import(/* webpackChunkName: "telemetry-sentry" */ "./sinks/sentrySink").then((m) =>
                    m.createSentrySink(cfg.errorDsn),
                ),
            ),
        );
    }

    if (sinks.length === 0) {
        console.warn(
            "[telemetry] the configured connection string / DSN is invalid; telemetry is off.",
        );

        return fallback;
    }

    return sinks.length === 1 ? sinks[0]! : fanOut(sinks);
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
        // Honour "Send usage data" before anything is sent or persisted.
        const allowed = readUsageDataEnabled();
        buildConfig = cfg;
        context = {
            appName: opts.appName,
            appVersion: cfg.appVersion,
            extensionVersion: opts.extensionVersion,
            environment: cfg.environment,
            sessionId: makeRandomId(),
            installId: allowed ? readInstallId() : undefined,
        };
        sink = allowed ? selectSink(cfg) : NOOP_SINK;
        sink.init(context);
    } catch {
        // Defensive: telemetry setup must never break app boot.
        sink = NOOP_SINK;
    }
}

/**
 * Whether this build sends telemetry at all (a connection string or DSN was
 * injected), i.e. whether the "Send usage data" choice means anything.
 */
export function isTelemetryConfigured(): boolean {
    return readBuildConfig().enabled;
}

/**
 * Apply the user's "Send usage data" choice now and for future loads. Turning
 * it off drops anything still queued unsent and forgets the install id;
 * turning it back on resumes telemetry for this load.
 */
export function setUsageDataEnabled(enabled: boolean): void {
    writeUsageDataEnabled(enabled);

    try {
        if (!enabled) {
            sink.discard?.();
            sink = NOOP_SINK;
            context = { ...context, installId: undefined };
            window.localStorage.removeItem(INSTALL_ID_STORAGE_KEY);

            return;
        }

        if (!initialised || sink !== NOOP_SINK || buildConfig === undefined) return;

        context = { ...context, installId: readInstallId() };
        sink = selectSink(buildConfig);
        sink.init(context);
    } catch {
        /* telemetry must never break the app */
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
        const { clean } = sanitizeProperties({
            ...errorTagsOf(info.error),
            ...info.properties,
        });

        sink.trackException({ ...info, properties: clean }, context);
    } catch {
        /* swallow */
    }
}

export type UserFacingErrorImpact = "blocking" | "action-failed" | "degraded";

/**
 * Count a handled, user-visible failure against reliability with stable,
 * privacy-safe dimensions. Call only where the UI surfaces the failure or a
 * requested workflow visibly degrades; silent best-effort enrichment stays out.
 */
export function trackUserFacingError(input: {
    error: unknown;
    source: string;
    operation: string;
    impact: UserFacingErrorImpact;
    severity?: TelemetrySeverity;
}): void {
    trackException({
        error: input.error,
        severity: input.severity ?? (input.impact === "degraded" ? "warning" : "error"),
        source: input.source,
        handled: true,
        properties: {
            impact: input.impact,
            operation: input.operation,
        },
    });
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
    sink.discard?.();
    initialised = false;
    context = {};
    buildConfig = undefined;
    sink = replacement ?? NOOP_SINK;
}
