// Sentry error reporter, on the official browser SDK, for exceptions only
// (product events go to Application Insights; here they become breadcrumbs).
//
// It runs as an isolated client + scope rather than `Sentry.init`, so it hooks
// no global handlers and instruments nothing: the telemetry facade decides what
// is reported. The SDK supplies stack parsing, de-duplication, `cause` chains,
// rate-limit handling and debug-id symbolication (the ids `sentry-cli
// sourcemaps inject` stamps into release bundles).
//
// Privacy: messages are scrubbed like every other exception, stack frames keep
// a file URL only when it is this extension's own bundle (needed to map
// minified frames to source), non-Error values are reduced to name + message,
// and the client asks Sentry not to infer the sender's IP address.

import {
    BrowserClient,
    dedupeIntegration,
    defaultStackParser,
    linkedErrorsIntegration,
    makeFetchTransport,
    Scope,
    type ErrorEvent,
} from "@sentry/browser";

import { describeError } from "../errorShape";
import { redactText } from "../sanitize";
import type { TelemetryContext, TelemetrySeverity, TelemetrySink } from "../types";
import { isUsableDsn } from "./credentials";

/** Reports per page load, so a render loop can't burn the monthly quota. */
const MAX_REPORTS_PER_LOAD = 20;
const REDACTED = "<redacted>";

type BrowserClientOptions = ConstructorParameters<typeof BrowserClient>[0];

const SENTRY_LEVEL = {
    info: "info",
    warning: "warning",
    error: "error",
    critical: "fatal",
} as const satisfies Record<TelemetrySeverity, string>;

function stringTags(values: Readonly<Record<string, unknown>>): Record<string, string> {
    const out: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            out[key] = String(value).slice(0, 200);
        }
    }

    return out;
}

/** Errors go as-is (their own stack); anything else as just a name and scrubbed message. */
function reportable(error: unknown): Error {
    if (error instanceof Error) return error;
    const shape = describeError(error);
    const out = new Error(redactText(shape.message, 256));
    out.name = shape.name ?? "Error";
    // No frames: this stack would point at the reporter, not the failure.
    out.stack = `${out.name}: ${out.message}`;

    return out;
}

/** Scrub an outgoing event: messages, foreign script URLs, request data. */
export function scrubEvent(event: ErrorEvent, isOwnScript: (url: string) => boolean): ErrorEvent {
    for (const value of event.exception?.values ?? []) {
        value.value = redactText(value.value, 256);

        for (const frame of value.stacktrace?.frames ?? []) {
            if (frame.filename !== undefined && !isOwnScript(frame.filename)) {
                frame.filename = REDACTED;
                delete frame.abs_path;
                frame.in_app = false;
            }
        }
    }

    if (event.message !== undefined) event.message = redactText(event.message, 256);
    delete event.request;

    return event;
}

function scopeContext(scope: Scope, ctx: TelemetryContext): void {
    scope.setUser(ctx.installId === undefined ? null : { id: ctx.installId });
    scope.setTags(
        stringTags({
            appName: ctx.appName,
            extensionVersion: ctx.extensionVersion,
            locale: ctx.locale,
        }),
    );
}

function clientOptions(
    dsn: string,
    ctx: TelemetryContext,
    transport: BrowserClientOptions["transport"],
    isOwnScript: (url: string) => boolean,
): BrowserClientOptions {
    return {
        dsn,
        release: `easy-markdown-review@${ctx.appVersion ?? "0.0.0"}`,
        environment: ctx.environment,
        transport,
        stackParser: defaultStackParser,
        integrations: [dedupeIntegration(), linkedErrorsIntegration()],
        sendClientReports: false,
        // Collect nothing implicitly; above all, no IP address (`userInfo`).
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            stackFrameVariables: false,
            frameContextLines: 0,
        },
        maxBreadcrumbs: 30,
        beforeSend: (event) => scrubEvent(event, isOwnScript),
    };
}

/**
 * Build the reporter, or null for an unusable DSN. `transport` and
 * `isOwnScript` are injectable for tests.
 */
export function createSentrySink(
    dsn: string,
    deps: Readonly<{
        transport?: BrowserClientOptions["transport"];
        isOwnScript?: (url: string) => boolean;
    }> = {},
): TelemetrySink | null {
    if (!isUsableDsn(dsn)) return null;

    const {
        transport = makeFetchTransport,
        isOwnScript = (url: string) => url.startsWith(`${window.location.origin}/`),
    } = deps;

    let client: BrowserClient | null = null;
    let scope: Scope | null = null;
    let reports = 0;

    return {
        name: "sentry",
        init(ctx) {
            if (client !== null) return;

            client = new BrowserClient(clientOptions(dsn, ctx, transport, isOwnScript));

            scope = new Scope();
            scope.setClient(client);
            client.init();
            scopeContext(scope, ctx);
        },
        setContext(ctx) {
            if (scope !== null) scopeContext(scope, ctx);
        },
        trackEvent(event) {
            // The catalog name only: what the user did before an error.
            scope?.addBreadcrumb({ category: "event", message: event.name, level: "info" });
        },
        trackException(info) {
            if (scope === null || reports >= MAX_REPORTS_PER_LOAD) return;
            reports++;

            const shape = describeError(info.error);
            const report = scope.clone();
            report.setLevel(SENTRY_LEVEL[info.severity ?? "error"]);

            report.setTags(
                stringTags({
                    ...info.properties,
                    source: info.source,
                    handled: info.handled ?? true,
                    httpStatus: shape.httpStatus,
                    adoErrorCode: shape.adoErrorCode,
                }),
            );

            report.captureException(reportable(info.error), {
                mechanism: { type: info.source ?? "generic", handled: info.handled ?? true },
            });
        },
        async flush() {
            await client?.flush(2000);
        },
        discard() {
            if (client === null) return;
            // Stop at once; anything already handed to the network can't be recalled.
            client.getOptions().enabled = false;
            void client.close(0);
            client = null;
            scope = null;
        },
    };
}
