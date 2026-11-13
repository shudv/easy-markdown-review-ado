import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { EVENT, events } from "../src/telemetry/events";
import {
    createAppInsightsSink,
    eventEnvelope,
    exceptionEnvelope,
    parseConnectionString,
} from "../src/telemetry/sinks/appInsightsSink";
import type { Transport } from "../src/telemetry/sinks/transport";
import type { TelemetryContext } from "../src/telemetry/types";

const CONNECTION =
    "InstrumentationKey=00000000-1111-2222-3333-444444444444;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/";

const TARGET = {
    instrumentationKey: "00000000-1111-2222-3333-444444444444",
    trackUrl: "https://westeurope-5.in.applicationinsights.azure.com/v2/track",
};

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

describe("parseConnectionString", () => {
    it("reads the instrumentation key and ingestion endpoint", () => {
        expect(parseConnectionString(CONNECTION)).toEqual(TARGET);
    });

    it("defaults the endpoint and ignores key case and malformed parts", () => {
        expect(parseConnectionString("instrumentationkey=abc;junk;=x")).toEqual({
            instrumentationKey: "abc",
            trackUrl: "https://dc.services.visualstudio.com/v2/track",
        });
    });

    it.each([
        ["no instrumentation key", "IngestionEndpoint=https://x.example/"],
        ["an http endpoint", "InstrumentationKey=abc;IngestionEndpoint=http://x.example/"],
        ["an empty string", ""],
    ])("rejects %s", (_, raw) => {
        expect(parseConnectionString(raw)).toBeNull();
    });
});

describe("eventEnvelope", () => {
    it("sends the catalog name, string dimensions with the table, and tags", () => {
        const envelope = eventEnvelope(
            TARGET,
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

        expect(envelope).toEqual({
            name: "Microsoft.ApplicationInsights.Event",
            time: "2026-11-13T10:00:00.000Z",
            iKey: TARGET.instrumentationKey,
            tags: {
                "ai.session.id": "s-1",
                "ai.user.id": "i-1",
                "ai.application.ver": "1.5.0.1794000000",
                "ai.cloud.role": "pr-tab",
                "ai.internal.sdkVersion": "emr-breeze:1",
            },
            data: {
                baseType: "EventData",
                baseData: {
                    ver: 2,
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
            },
        });
    });

    it("falls back to the bundled version when the host gives none", () => {
        const envelope = eventEnvelope(
            TARGET,
            events.appLoaded(),
            { appVersion: "1.5.0" },
            NOW,
        ) as {
            tags: Record<string, string>;
        };

        expect(envelope.tags).toEqual({
            "ai.application.ver": "1.5.0",
            "ai.internal.sdkVersion": "emr-breeze:1",
        });
    });
});

describe("exceptionEnvelope", () => {
    it("scrubs the message and stack and maps severity", () => {
        const error = Object.assign(
            new TypeError("failed for alice@contoso.com at C:\\Users\\alice\\x"),
            {
                status: 503,
            },
        );

        const envelope = exceptionEnvelope(
            TARGET,
            {
                error,
                severity: "critical",
                source: "boot",
                handled: false,
                properties: { impact: "blocking" },
            },
            CTX,
            NOW,
        ) as {
            data: {
                baseData: {
                    severityLevel: number;
                    exceptions: Array<Record<string, unknown>>;
                    properties: Record<string, string>;
                    measurements: Record<string, number>;
                };
            };
        };

        const { baseData } = envelope.data;

        expect(baseData.severityLevel).toBe(4);
        expect(baseData.exceptions[0]).toMatchObject({ typeName: "TypeError", hasFullStack: true });
        expect(baseData.exceptions[0]!.message).not.toContain("alice");
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
        const envelope = exceptionEnvelope(TARGET, { error: "boom" }, {}, NOW) as {
            data: {
                baseData: {
                    severityLevel: number;
                    exceptions: Array<Record<string, unknown>>;
                    properties: Record<string, string>;
                };
            };
        };

        expect(envelope.data.baseData.severityLevel).toBe(3);
        expect(envelope.data.baseData.exceptions[0]).toMatchObject({
            typeName: "Error",
            message: "boom",
            hasFullStack: false,
        });
        expect(envelope.data.baseData.properties.handled).toBe("true");
    });

    it("gives an exception without a message a placeholder ingestion accepts", () => {
        const envelope = exceptionEnvelope(TARGET, { error: new Error("") }, {}, NOW) as {
            data: { baseData: { exceptions: Array<Record<string, unknown>> } };
        };

        expect(envelope.data.baseData.exceptions[0]!.message).toBe("not_specified");
    });
});

describe("createAppInsightsSink", () => {
    let post: Mock<Transport["post"]>;
    let beacon: Mock<Transport["beacon"]>;
    let transport: Transport;

    beforeEach(() => {
        vi.useFakeTimers();
        post = vi.fn<Transport["post"]>();
        beacon = vi.fn<Transport["beacon"]>(() => true);
        transport = { post, beacon };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const sentItems = (call: unknown[]) => JSON.parse(call[1] as string) as unknown[];

    it("is null for an unusable connection string", () => {
        expect(createAppInsightsSink("nonsense")).toBeNull();
    });

    it("batches items and sends them a few seconds after the first", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport, now: () => NOW })!;
        sink.init({});
        sink.setContext({});
        sink.trackEvent(events.appLoaded(), CTX);
        sink.trackException({ error: new Error("x") }, CTX);
        expect(post).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);

        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0]![0]).toBe(TARGET.trackUrl);
        expect(sentItems(post.mock.calls[0]!)).toHaveLength(2);
        sink.discard?.();
    });

    it("sends at once when the batch is full", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport })!;

        for (let i = 0; i < 20; i++) sink.trackEvent(events.appLoaded(), CTX);

        expect(post).toHaveBeenCalledTimes(1);
        expect(sentItems(post.mock.calls[0]!)).toHaveLength(20);
    });

    it("flushes on demand, and does nothing with an empty queue", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport })!;
        void sink.flush();
        expect(post).not.toHaveBeenCalled();

        sink.trackEvent(events.appLoaded(), CTX);
        void sink.flush();

        expect(post).toHaveBeenCalledTimes(1);
    });

    it("beacons the queue when the page hides or unloads, falling back to a POST", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport })!;
        sink.init(CTX);
        sink.init(CTX);

        sink.trackEvent(events.appLoaded(), CTX);
        Object.defineProperty(document, "visibilityState", {
            value: "visible",
            configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(beacon).not.toHaveBeenCalled();

        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(beacon).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();

        beacon.mockReturnValue(false);
        sink.trackEvent(events.appLoaded(), CTX);
        window.dispatchEvent(new Event("pagehide"));
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0]![2]).toBe(true);
        sink.discard?.();
    });

    it("sends items emitted after pagehide at once, until the page is shown again", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport })!;
        sink.init(CTX);

        window.dispatchEvent(new Event("pagehide"));
        sink.trackEvent(events.appLoaded(), CTX);
        expect(beacon).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event("pageshow"));
        sink.trackEvent(events.appLoaded(), CTX);
        expect(beacon).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);
        expect(post).toHaveBeenCalledWith(TARGET.trackUrl, expect.any(String), false);
        sink.discard?.();
    });

    it("drops the queue and stops listening once discarded", () => {
        const sink = createAppInsightsSink(CONNECTION, { transport })!;
        sink.init(CTX);
        sink.trackEvent(events.appLoaded(), CTX);

        sink.discard?.();
        vi.advanceTimersByTime(10_000);
        window.dispatchEvent(new Event("pagehide"));

        expect(post).not.toHaveBeenCalled();
        expect(beacon).not.toHaveBeenCalled();
    });
});
