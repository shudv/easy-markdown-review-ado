// Azure Application Insights sink, on the official SDK's lean distribution
// (`applicationinsights-web-basic`: core + channel, no auto-collection). The
// channel batches, retries throttled/failed sends, keeps unsent items in
// sessionStorage so a reload re-sends them, and flushes with sendBeacon as the
// page goes away.
//
// Events land in `customEvents` (name = the catalog event name, e.g.
// `comment.created`; `customDimensions.table` = Engagement | Diagnostics) and
// exceptions in `exceptions`. Context ids ride on every item as dimensions,
// and the session / install ids also as the standard session and user tags so
// the portal's Users and Sessions views work.
//
// Loaded lazily (see ../telemetry.ts) and only when a connection string is
// injected at build time.

import { ApplicationInsights, type ITelemetryItem } from "@microsoft/applicationinsights-web-basic";

import { describeError } from "../errorShape";
import { EVENT } from "../events";
import { tableFor } from "../eventTables";
import { redactText } from "../sanitize";
import type {
    TelemetryContext,
    TelemetryEvent,
    TelemetryExceptionInfo,
    TelemetrySeverity,
    TelemetrySink,
} from "../types";
import { parseConnectionString } from "./credentials";

const CHANNEL_ID = "AppInsightsChannelPlugin";
/** Prefix for the channel's sessionStorage buffer keys. */
const NAME_PREFIX = "emr";

/** customDimensions are string-valued: keep strings and booleans, drop empty ones. */
function dimensions(values: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string" || typeof value === "boolean") out[key] = String(value);
    }

    return out;
}

/** Numeric values go to customMeasurements, so queries can sum and percentile them. */
function measurements(
    ...sources: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>
): Record<string, number> {
    const out: Record<string, number> = {};

    for (const source of sources) {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
        }
    }

    return out;
}

function contextDimensions(ctx: TelemetryContext): Record<string, unknown> {
    return {
        appName: ctx.appName,
        appVersion: ctx.appVersion,
        extensionVersion: ctx.extensionVersion,
        environment: ctx.environment,
        locale: ctx.locale,
        projectId: ctx.projectId,
        repositoryId: ctx.repositoryId,
        pullRequestId: ctx.pullRequestId,
        sessionId: ctx.sessionId,
        installId: ctx.installId,
    };
}

function tags(ctx: TelemetryContext): Record<string, string> {
    return dimensions({
        "ai.session.id": ctx.sessionId,
        "ai.user.id": ctx.installId,
        "ai.application.ver": ctx.extensionVersion ?? ctx.appVersion,
        "ai.cloud.role": ctx.appName,
    });
}

function nonEmpty(value: string | undefined): string | undefined {
    return value === "" ? undefined : value;
}

const SEVERITY_LEVEL: Record<TelemetrySeverity, number> = {
    info: 1,
    warning: 2,
    error: 3,
    critical: 4,
};

/** The telemetry item for one custom event. */
export function eventItem(event: TelemetryEvent, ctx: TelemetryContext, now: Date): ITelemetryItem {
    return {
        name: "Microsoft.ApplicationInsights.{0}.Event",
        time: now.toISOString(),
        tags: tags(ctx),
        baseType: "EventData",
        baseData: {
            name: event.name,
            // Context last so a stray property can't overwrite an authoritative id.
            properties: dimensions({
                ...event.properties,
                ...contextDimensions(ctx),
                table: tableFor(event.name),
            }),
            measurements: measurements(event.properties, event.measurements),
        },
    };
}

/** The telemetry item for one exception, with message and stack scrubbed of paths/URLs/emails. */
export function exceptionItem(
    info: TelemetryExceptionInfo,
    ctx: TelemetryContext,
    now: Date,
): ITelemetryItem {
    const shape = describeError(info.error);
    const severity = info.severity ?? "error";

    return {
        name: "Microsoft.ApplicationInsights.{0}.Exception",
        time: now.toISOString(),
        tags: tags(ctx),
        baseType: "ExceptionData",
        baseData: {
            // With `ver` the SDK takes this as prepared exception data, not a raw error.
            ver: 2,
            severityLevel: SEVERITY_LEVEL[severity],
            exceptions: [
                {
                    typeName: shape.name ?? "Error",
                    // Ingestion drops an exception whose message is empty.
                    message: nonEmpty(redactText(shape.message, 256)) ?? "not_specified",
                    hasFullStack: shape.stack !== undefined,
                    stack: redactText(shape.stack, 2048),
                },
            ],
            measurements: measurements(info.properties, { httpStatus: shape.httpStatus }),
            properties: dimensions({
                ...info.properties,
                ...contextDimensions(ctx),
                adoErrorCode: shape.adoErrorCode,
                severity,
                source: info.source,
                handled: info.handled ?? true,
                name: EVENT.AppException,
                table: tableFor(EVENT.AppException),
            }),
        },
    };
}

/** The channel's surface used to drop unsent data on opt-out. */
interface Channel {
    pause(): void;
    _buffer?: { clear(): void };
}

/** Remove the channel's sessionStorage copies of unsent items. */
function clearStoredBuffers(): void {
    try {
        for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
            const key = window.sessionStorage.key(i);

            if (key?.startsWith(`${NAME_PREFIX}_AI_`) === true) {
                window.sessionStorage.removeItem(key);
            }
        }
    } catch {
        /* storage blocked: nothing was persisted */
    }
}

/**
 * Build the sink, or null for an unusable connection string (the facade then
 * falls back to no telemetry rather than failing). `config` overrides SDK
 * settings (tests route sends through `httpXHROverride`).
 */
export function createAppInsightsSink(
    connectionString: string,
    deps: Readonly<{ now?: () => Date; config?: Readonly<Record<string, unknown>> }> = {},
): TelemetrySink | null {
    if (parseConnectionString(connectionString) === null) return null;

    const { now = () => new Date() } = deps;

    const channelConfig = {
        // Default is 15 s; a shorter wait means less is pending if the tab dies.
        maxBatchInterval: 5000,
        enableSessionStorageBuffer: true,
        namePrefix: NAME_PREFIX,
        ...deps.config,
    };

    let sdk: ApplicationInsights | null = new ApplicationInsights({
        connectionString,
        disableCookiesUsage: true,
        loggingLevelConsole: 0,
        ...channelConfig,
        extensionConfig: { [CHANNEL_ID]: channelConfig },
    } as ConstructorParameters<typeof ApplicationInsights>[0]);

    return {
        name: "appinsights",
        init() {},
        setContext() {
            // Context is attached per item.
        },
        trackEvent(event, ctx) {
            sdk?.track(eventItem(event, ctx, now()));
        },
        trackException(info, ctx) {
            sdk?.track(exceptionItem(info, ctx, now()));
        },
        flush() {
            sdk?.flush();
        },
        discard() {
            if (sdk === null) return;
            const channel = sdk.getPlugin(CHANNEL_ID).plugin as unknown as Channel;
            // Stop sending and drop the queue before unload would flush it.
            channel.pause();
            channel._buffer?.clear();
            void sdk.unload(false);
            sdk = null;
            clearStoredBuffers();
        },
    };
}
