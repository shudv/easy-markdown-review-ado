// Sentry error reporter — a dependency-free client for Sentry's envelope API,
// for exceptions only (product events go to Application Insights).
//
// Privacy: the message is scrubbed like every other exception, and stack
// frames keep a file URL only when it is this extension's own bundle (needed to
// map minified frames back to source); any other URL becomes "<redacted>".
// Symbolication works through the debug ids `sentry-cli sourcemaps inject`
// stamps into the release bundles (`globalThis._sentryDebugIds`).

import { describeError } from "../errorShape";
import { redactText } from "../sanitize";
import type {
    TelemetryContext,
    TelemetryExceptionInfo,
    TelemetrySeverity,
    TelemetrySink,
} from "../types";
import { browserTransport, type Transport } from "./transport";

/** Reports per page load, so a render loop can't burn the monthly quota. */
const MAX_REPORTS_PER_LOAD = 20;

export interface SentryTarget {
    envelopeUrl: string;
    dsn: string;
}

/** Parse a DSN (`https://<key>@<host>/<project>`); null when unusable. */
export function parseDsn(dsn: string): SentryTarget | null {
    let url: URL;

    try {
        url = new URL(dsn);
    } catch {
        return null;
    }

    const segments = url.pathname.split("/").filter((s) => s !== "");
    const projectId = segments.pop();

    if (url.protocol !== "https:" || url.username === "" || projectId === undefined) return null;

    const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
    const query = `sentry_key=${url.username}&sentry_version=7&sentry_client=emr.breeze%2F1`;

    return { envelopeUrl: `https://${url.host}${prefix}/api/${projectId}/envelope/?${query}`, dsn };
}

export interface StackFrame {
    function?: string;
    filename: string;
    lineno: number;
    colno: number;
    in_app: boolean;
}

// Chromium:  "    at fn (https://x/a.js:1:2)" or "    at https://x/a.js:1:2"
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// Firefox / Safari (matched against the trimmed line):  "fn@https://x/a.js:1:2"
const GECKO_FRAME = /^([^@]*)@(.+):(\d+):(\d+)$/;

/**
 * Parse a stack into frames, oldest call first (Sentry's order). A frame keeps
 * its file URL only if `isOwnScript` accepts it.
 */
export function parseStack(stack: string, isOwnScript: (url: string) => boolean): StackFrame[] {
    const frames: StackFrame[] = [];

    for (const line of stack.split("\n")) {
        const m = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line.trim());
        if (m === null) continue;

        const own = isOwnScript(m[2]!);
        // The function group is optional in the V8 pattern.
        const fn = (m[1] as string | undefined) ?? "";

        frames.push({
            ...(fn === "" ? {} : { function: fn }),
            filename: own ? m[2]! : "<redacted>",
            lineno: Number(m[3]),
            colno: Number(m[4]),
            in_app: own,
        });
    }

    return frames.reverse();
}

/** Debug ids stamped into the bundles at release time, keyed by script URL. */
export function debugIdsByFile(
    stamps: Readonly<Record<string, string>> | undefined,
    isOwnScript: (url: string) => boolean,
): Map<string, string> {
    const byFile = new Map<string, string>();

    for (const [stack, debugId] of Object.entries(stamps ?? {})) {
        // The stamp's key is a stack captured inside that bundle; its newest frame
        // (last after parsing) names the bundle's URL.
        const file = parseStack(stack, isOwnScript).pop()?.filename;
        if (file !== undefined && file !== "<redacted>") byFile.set(file, debugId);
    }

    return byFile;
}

const SENTRY_LEVEL: Record<TelemetrySeverity, string> = {
    info: "info",
    warning: "warning",
    error: "error",
    critical: "fatal",
};

function randomHex32(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");
}

function stringTags(values: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            out[key] = String(value).slice(0, 200);
        }
    }

    return out;
}

/** The Sentry event for one exception. */
export function sentryEvent(
    info: TelemetryExceptionInfo,
    ctx: TelemetryContext,
    opts: Readonly<{
        eventId: string;
        now: Date;
        isOwnScript: (url: string) => boolean;
        debugIds: ReadonlyMap<string, string>;
    }>,
): object {
    const shape = describeError(info.error);
    const frames = shape.stack === undefined ? [] : parseStack(shape.stack, opts.isOwnScript);

    const images = [...new Set(frames.map((f) => f.filename))].flatMap((file) => {
        const debugId = opts.debugIds.get(file);

        return debugId === undefined
            ? []
            : [{ type: "sourcemap", code_file: file, debug_id: debugId }];
    });

    return {
        event_id: opts.eventId,
        timestamp: opts.now.getTime() / 1000,
        platform: "javascript",
        // Without this Sentry fills in the sender's IP address for JavaScript events.
        sdk: { name: "emr.breeze", version: "1.0.0", settings: { infer_ip: "never" } },
        level: SENTRY_LEVEL[info.severity ?? "error"],
        release: `easy-markdown-review@${ctx.appVersion ?? "0.0.0"}`,
        environment: ctx.environment,
        user: ctx.installId === undefined ? undefined : { id: ctx.installId },
        tags: stringTags({
            ...info.properties,
            appName: ctx.appName,
            extensionVersion: ctx.extensionVersion,
            locale: ctx.locale,
            source: info.source,
            handled: info.handled ?? true,
            httpStatus: shape.httpStatus,
            adoErrorCode: shape.adoErrorCode,
        }),
        exception: {
            values: [
                {
                    type: shape.name ?? "Error",
                    value: redactText(shape.message, 256),
                    ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
                    mechanism: { type: info.source ?? "generic", handled: info.handled ?? true },
                },
            ],
        },
        ...(images.length > 0 ? { debug_meta: { images } } : {}),
    };
}

declare global {
    var _sentryDebugIds: Record<string, string> | undefined;
}

/** Build the reporter, or null for an unusable DSN. */
export function createSentrySink(
    dsn: string,
    deps: Readonly<{
        transport?: Transport;
        now?: () => Date;
        isOwnScript?: (url: string) => boolean;
    }> = {},
): TelemetrySink | null {
    const target = parseDsn(dsn);
    if (target === null) return null;

    const {
        transport = browserTransport,
        now = () => new Date(),
        isOwnScript = (url: string) => url.startsWith(`${window.location.origin}/`),
    } = deps;

    let reports = 0;

    return {
        name: "sentry",
        init() {},
        setContext() {},
        trackEvent() {
            // Product events go to Application Insights.
        },
        trackException(info, ctx) {
            if (reports >= MAX_REPORTS_PER_LOAD) return;
            reports++;

            const eventId = randomHex32();
            const sentAt = now();

            const event = sentryEvent(info, ctx, {
                eventId,
                now: sentAt,
                isOwnScript,
                debugIds: debugIdsByFile(globalThis._sentryDebugIds, isOwnScript),
            });

            const header = { event_id: eventId, sent_at: sentAt.toISOString(), dsn: target.dsn };
            const body = `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;

            // keepalive so a report raised as the page leaves still arrives.
            transport.post(target.envelopeUrl, body, true);
        },
        flush() {
            // Reports are sent as they happen.
        },
    };
}
