import { afterEach, describe, expect, it, vi } from "vitest";

import { EVENT, events } from "../src/telemetry/events";
import {
    createAppInsightsSink,
    eventItem,
    exceptionItem,
} from "../src/telemetry/sinks/appInsightsSink";
import type { TelemetryContext, TelemetrySink } from "../src/telemetry/types";

const INSTRUMENTATION_KEY = "00000000-1111-2222-3333-444444444444";

const CONNECTION = `InstrumentationKey=${INSTRUMENTATION_KEY};IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/`;

const NOW = new Date("2026-11-13T10:00:00.000Z");

const CTX: TelemetryContext = {
    appName: "pr-tab",
    appVersion: "1.5.0",
    extensionVersion: "1.5.0.1794000000",
    environment: "production",
    locale: "de",
    projectId: "p1",
    sessionId: "s-1",
    installId: "i-1",
};

describe("eventItem", () => {
    it("sends the catalog name, string dimensions with the table, and tags", () => {
        const item = eventItem(
            {
                name: EVENT.CommentCreated,
                properties: {
                    anchorKind: "line",
                    projectId: "spoofed",
                    draft: true,
                    gone: undefined,
                    resultCount: 3,
                    bogus: Number.NaN,
                },
                measurements: { bodyLength: 12 },
            },
            CTX,
            NOW,
        );

        expect(item).toEqual({
            name: "Microsoft.ApplicationInsights.{0}.Event",
            time: "2026-11-13T10:00:00.000Z",
            tags: {
                "ai.session.id": "s-1",
                "ai.user.id": "i-1",
                "ai.application.ver": "1.5.0.1794000000",
                "ai.cloud.role": "pr-tab",
            },
            baseType: "EventData",
            baseData: {
                name: "comment.created",
                properties: {
                    anchorKind: "line",
                    draft: "true",
                    appName: "pr-tab",
                    appVersion: "1.5.0",
                    extensionVersion: "1.5.0.1794000000",
                    environment: "production",
                    locale: "de",
                    // Context wins over a stray property of the same name.
                    projectId: "p1",
                    sessionId: "s-1",
                    installId: "i-1",
                    table: "Engagement",
                },
                // Numeric properties join the measurements; non-finite ones are dropped.
                measurements: { resultCount: 3, bodyLength: 12 },
            },
        });
    });

    it("falls back to the bundled version when the host gives none", () => {
        expect(eventItem(events.appLoaded(), { appVersion: "1.5.0" }, NOW).tags).toEqual({
            "ai.application.ver": "1.5.0",
        });
    });
});

describe("exceptionItem", () => {
    it("scrubs the message and stack, maps severity, and splits dimensions from numbers", () => {
        const error = Object.assign(
            new TypeError("failed for alice@contoso.com at https://dev.azure.com/org"),
            {
                stack: "TypeError: x\n    at f (https://dev.azure.com/org/a.js:1:2)",
                status: 503,
            },
        );

        const baseData = exceptionItem(
            {
                error,
                severity: "critical",
                source: "boot",
                handled: false,
                properties: { impact: "blocking" },
            },
            CTX,
            NOW,
        ).baseData as {
            severityLevel: number;
            exceptions: Array<Record<string, unknown>>;
            properties: Record<string, string>;
            measurements: Record<string, number>;
        };

        expect(baseData.severityLevel).toBe(4);
        expect(baseData.exceptions[0]).toMatchObject({ typeName: "TypeError", hasFullStack: true });
        expect(JSON.stringify(baseData.exceptions)).not.toMatch(/alice|dev\.azure\.com/);
        expect(baseData.measurements).toEqual({ httpStatus: 503 });
        expect(baseData.properties).toMatchObject({
            impact: "blocking",
            severity: "critical",
            source: "boot",
            handled: "false",
            name: "app.exception",
            table: "Diagnostics",
        });
    });

    it("defaults a bare thrown value to a handled Error at error level", () => {
        const baseData = exceptionItem({ error: "boom" }, {}, NOW).baseData as {
            severityLevel: number;
            exceptions: Array<Record<string, unknown>>;
            properties: Record<string, string>;
        };

        expect(baseData.severityLevel).toBe(3);
        expect(baseData.exceptions[0]).toMatchObject({
            typeName: "Error",
            message: "boom",
            hasFullStack: false,
        });
        expect(baseData.properties.handled).toBe("true");
    });

    it("gives an exception without a message a placeholder ingestion accepts", () => {
        const baseData = exceptionItem({ error: new Error("") }, {}, NOW).baseData as {
            exceptions: Array<Record<string, unknown>>;
        };

        expect(baseData.exceptions[0]!.message).toBe("not_specified");
    });
});

describe("createAppInsightsSink (on the SDK)", () => {
    let sink: TelemetrySink | null = null;

    afterEach(() => {
        sink?.discard?.();
        sink = null;
        window.sessionStorage.clear();
    });

    /** A sink whose sends are captured instead of hitting the network. */
    function captured(config: Record<string, unknown> = {}) {
        const batches: Array<Array<Record<string, unknown>>> = [];

        sink = createAppInsightsSink(CONNECTION, {
            now: () => NOW,
            config: {
                alwaysUseXhrOverride: true,
                httpXHROverride: {
                    sendPOST: (
                        payload: { data: string | Uint8Array },
                        done: (status: number, headers: Record<string, string>) => void,
                    ) => {
                        const text =
                            typeof payload.data === "string"
                                ? payload.data
                                : new TextDecoder().decode(payload.data);

                        batches.push(JSON.parse(text) as Array<Record<string, unknown>>);
                        done(200, {});
                    },
                },
                ...config,
            },
        })!;

        return { sink, batches };
    }

    it("is null for an unusable connection string", () => {
        expect(createAppInsightsSink("nonsense")).toBeNull();
    });

    it("sends events and exceptions as App Insights envelopes", async () => {
        const { sink, batches } = captured();
        sink.init(CTX);
        sink.setContext(CTX);
        sink.trackEvent(events.appLoaded(), CTX);
        sink.trackException({ error: new Error("x") }, CTX);
        void sink.flush();

        await vi.waitFor(() => expect(batches.flat()).toHaveLength(2));
        const [event, exception] = batches.flat();

        expect(event).toMatchObject({
            name: `Microsoft.ApplicationInsights.${INSTRUMENTATION_KEY.replaceAll("-", "")}.Event`,
            iKey: INSTRUMENTATION_KEY,
            tags: { "ai.user.id": "i-1", "ai.session.id": "s-1" },
            data: {
                baseType: "EventData",
                baseData: { name: "app.loaded", properties: { table: "Diagnostics" } },
            },
        });
        expect(exception).toMatchObject({
            data: {
                baseType: "ExceptionData",
                baseData: { exceptions: [{ typeName: "Error", message: "x" }] },
            },
        });
    });

    it("drops queued items, stored copies included, and stops when discarded", async () => {
        const { sink, batches } = captured();
        sink.trackEvent(events.appLoaded(), CTX);
        expect(Object.keys(window.sessionStorage).some((k) => k.startsWith("emr_AI_"))).toBe(true);
        window.sessionStorage.setItem("other", "kept");

        sink.discard?.();
        sink.discard?.();
        sink.trackEvent(events.appLoaded(), CTX);
        sink.trackException({ error: new Error("x") }, CTX);
        void sink.flush();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(batches).toEqual([]);
        expect(Object.keys(window.sessionStorage)).toEqual(["other"]);
    });

    it("tolerates blocked storage when discarding", () => {
        const { sink } = captured({ enableSessionStorageBuffer: false });
        vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
            throw new DOMException("blocked", "SecurityError");
        });

        expect(() => sink.discard?.()).not.toThrow();
        vi.restoreAllMocks();
    });
});
