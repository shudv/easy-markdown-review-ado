// Azure Application Insights sink — a dependency-free sender for the Breeze
// ingestion API (the same `v2/track` endpoint the official SDK posts to).
//
// Events land in `customEvents` (name = the catalog event name, e.g.
// `comment.created`; `customDimensions.table` = Engagement | Diagnostics) and
// exceptions in `exceptions`. Context ids ride on every item as dimensions,
// and the session / install ids also as the standard session and user tags so
// the portal's Users and Sessions views work.
//
// Enabled only when a connection string is injected at build time (see
// ../config.ts); the facade never constructs this sink otherwise.

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
import { browserTransport, type Transport } from "./transport";

const DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com";
/** Send once this many items are queued… */
const MAX_BATCH = 20;
/** …or this long after the first one was. */
const FLUSH_DELAY_MS = 5000;

export interface AppInsightsTarget {
    instrumentationKey: string;
    /** Full track URL, e.g. `https://westeurope-5.in.applicationinsights.azure.com/v2/track`. */
    trackUrl: string;
}

/**
 * Parse an Application Insights connection string
 * (`InstrumentationKey=…;IngestionEndpoint=https://…/;…`). Returns null when it
 * has no instrumentation key or the endpoint isn't https.
 */
export function parseConnectionString(raw: string): AppInsightsTarget | null {
    const fields = new Map<string, string>();

    for (const part of raw.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }

    const instrumentationKey = fields.get("instrumentationkey") ?? "";

    const endpoint = (fields.get("ingestionendpoint") ?? DEFAULT_INGESTION_ENDPOINT).replace(
        /\/+$/,
        "",
    );

    if (instrumentationKey === "" || !endpoint.startsWith("https://")) return null;

    return { instrumentationKey, trackUrl: `${endpoint}/v2/track` };
}

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
        "ai.internal.sdkVersion": "emr-breeze:1",
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

/** The envelope for one custom event. */
export function eventEnvelope(
    target: AppInsightsTarget,
    event: TelemetryEvent,
    ctx: TelemetryContext,
    now: Date,
): object {
    return {
        name: "Microsoft.ApplicationInsights.Event",
        time: now.toISOString(),
        iKey: target.instrumentationKey,
        tags: tags(ctx),
        data: {
            baseType: "EventData",
            baseData: {
                ver: 2,
                name: event.name,
                // Context last so a stray property can't overwrite an authoritative id.
                properties: dimensions({
                    ...event.properties,
                    ...contextDimensions(ctx),
                    table: tableFor(event.name),
                }),
                measurements: measurements(event.properties, event.measurements),
            },
        },
    };
}

/** The envelope for one exception, with message and stack scrubbed of paths/URLs/emails. */
export function exceptionEnvelope(
    target: AppInsightsTarget,
    info: TelemetryExceptionInfo,
    ctx: TelemetryContext,
    now: Date,
): object {
    const shape = describeError(info.error);
    const severity = info.severity ?? "error";

    return {
        name: "Microsoft.ApplicationInsights.Exception",
        time: now.toISOString(),
        iKey: target.instrumentationKey,
        tags: tags(ctx),
        data: {
            baseType: "ExceptionData",
            baseData: {
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
        },
    };
}

/**
 * Build the sink, or null for an unusable connection string (the facade then
 * falls back to no telemetry rather than failing).
 */
export function createAppInsightsSink(
    connectionString: string,
    deps: Readonly<{ transport?: Transport; now?: () => Date }> = {},
): TelemetrySink | null {
    const target = parseConnectionString(connectionString);
    if (target === null) return null;

    const { transport = browserTransport, now = () => new Date() } = deps;
    const queue: object[] = [];
    let timer: number | undefined;
    let listening = false;
    // Set from `pagehide` until `pageshow`: items emitted while the page goes
    // away (e.g. by later pagehide listeners) are sent at once, not timed.
    let unloading = false;

    const send = (leaving: boolean) => {
        window.clearTimeout(timer);
        timer = undefined;
        if (queue.length === 0) return;

        const body = JSON.stringify(queue.splice(0));

        if (!leaving || !transport.beacon(target.trackUrl, body)) {
            transport.post(target.trackUrl, body, leaving);
        }
    };

    const enqueue = (item: object) => {
        queue.push(item);
        if (unloading) send(true);
        else if (queue.length >= MAX_BATCH) send(false);
        else timer ??= window.setTimeout(() => send(false), FLUSH_DELAY_MS);
    };

    const onHidden = () => {
        if (document.visibilityState === "hidden") send(true);
    };

    const onPageHide = () => {
        unloading = true;
        send(true);
    };

    const onPageShow = () => {
        unloading = false;
    };

    return {
        name: "appinsights",
        init() {
            if (listening) return;
            listening = true;
            document.addEventListener("visibilitychange", onHidden);
            window.addEventListener("pagehide", onPageHide);
            window.addEventListener("pageshow", onPageShow);
        },
        setContext() {
            // Context is attached per item.
        },
        trackEvent(event, ctx) {
            enqueue(eventEnvelope(target, event, ctx, now()));
        },
        trackException(info, ctx) {
            enqueue(exceptionEnvelope(target, info, ctx, now()));
        },
        flush() {
            send(false);
        },
        discard() {
            window.clearTimeout(timer);
            timer = undefined;
            queue.length = 0;
            document.removeEventListener("visibilitychange", onHidden);
            window.removeEventListener("pagehide", onPageHide);
            window.removeEventListener("pageshow", onPageShow);
            listening = false;
            unloading = false;
        },
    };
}
