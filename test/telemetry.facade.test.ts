// Tests for the telemetry facade — sink selection, context merging, PR-id
// hashing, and the sanitizer being applied before a sink is touched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    __resetTelemetryForTests,
    flushTelemetry,
    getTelemetryContext,
    initTelemetry,
    setTelemetryContext,
    track,
    trackException,
    trackUserFacingError,
} from "../src/telemetry/telemetry";
import { events } from "../src/telemetry/events";
import { hashId } from "../src/telemetry/sanitize";
import type { TelemetrySink } from "../src/telemetry/types";

function fakeSink() {
    const sink = {
        name: "fake",
        init: vi.fn(),
        setContext: vi.fn(),
        trackEvent: vi.fn(),
        trackException: vi.fn(),
        flush: vi.fn(),
    } satisfies TelemetrySink;

    return sink;
}

describe("telemetry facade", () => {
    beforeEach(() => {
        __resetTelemetryForTests();
    });
    afterEach(() => {
        __resetTelemetryForTests();
    });

    it("merges ambient context into events", () => {
        const sink = fakeSink();
        __resetTelemetryForTests(sink);
        setTelemetryContext({ projectId: "p1", repositoryId: "r1" });

        track(events.commentEdited());

        expect(sink.trackEvent).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ name: "comment.edited" }),
            expect.objectContaining({ projectId: "p1", repositoryId: "r1" }),
        );
    });

    it("hashes the raw pull-request id so it never ships verbatim", () => {
        setTelemetryContext({ pullRequestId: 98765 });

        expect(getTelemetryContext().pullRequestId).toBe(hashId(98765));
    });

    it("sanitizes event properties before handing them to the sink", () => {
        const sink = fakeSink();
        __resetTelemetryForTests(sink);

        track({
            name: "test.event",
            properties: { repoName: "secret-repo", anchorKind: "line" },
            measurements: { count: 3, bad: NaN },
        });

        expect(sink.trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                properties: { anchorKind: "line" },
                measurements: { count: 3 },
            }),
            expect.anything(),
        );
    });

    it("forwards exceptions with sanitized properties", () => {
        const sink = fakeSink();
        __resetTelemetryForTests(sink);

        trackException({
            error: new Error("boom"),
            source: "unit",
            properties: { repoName: "leak", phase: "save" },
        });

        expect(sink.trackException).toHaveBeenCalledWith(
            expect.objectContaining({ properties: { phase: "save" } }),
            expect.anything(),
        );
    });

    it.each([
        ["blocking", "error"],
        ["action-failed", "error"],
        ["degraded", "warning"],
    ] as const)(
        "reports a %s user-facing failure with reliability dimensions",
        (impact, severity) => {
            const sink = fakeSink();
            __resetTelemetryForTests(sink);
            const error = new Error("visible failure");

            trackUserFacingError({
                error,
                source: "Reader.load",
                operation: "document-load",
                impact,
            });

            expect(sink.trackException).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    error,
                    source: "Reader.load",
                    handled: true,
                    severity,
                    properties: { impact, operation: "document-load" },
                }),
                expect.anything(),
            );
        },
    );

    it("allows a critical severity override for boot failures", () => {
        const sink = fakeSink();
        __resetTelemetryForTests(sink);

        trackUserFacingError({
            error: new Error("boot failed"),
            source: "pr-tab.boot",
            operation: "boot",
            impact: "blocking",
            severity: "critical",
        });

        expect(sink.trackException).toHaveBeenCalledWith(
            expect.objectContaining({ severity: "critical" }),
            expect.anything(),
        );
    });
    it("never throws when a sink misbehaves", () => {
        const angry = fakeSink();
        angry.trackEvent = vi.fn(() => {
            throw new Error("sink failure");
        });
        __resetTelemetryForTests(angry);
        expect(() => track(events.appLoaded())).not.toThrow();
    });

    it("stamps slicing dimensions (version + environment) into context", () => {
        initTelemetry({ appName: "documents-hub" });

        // appVersion is build-stamped; under Vitest it falls back to the default.
        expect(getTelemetryContext()).toMatchObject({
            appName: "documents-hub",
            appVersion: expect.any(String),
            environment: "development",
            sessionId: expect.any(String),
        });
    });

    it("records the installed extension version passed by the entry point", () => {
        initTelemetry({
            appName: "pr-tab",
            extensionVersion: "0.0.1.1750000000",
        });
        expect(getTelemetryContext().extensionVersion).toBe("0.0.1.1750000000");
    });

    it("leaves extensionVersion unset when the host can't provide one", () => {
        initTelemetry({ appName: "pr-tab" });
        expect(getTelemetryContext().extensionVersion).toBeUndefined();
    });

    it("falls back to a no-op sink that accepts every call when no telemetry key is configured", () => {
        // __EMR_TELEMETRY_CONFIG__ is undefined under Vitest, as in a local
        // build without a key: nothing may be sent and nothing may throw.
        initTelemetry({ appName: "pr-tab" });
        expect(() => {
            setTelemetryContext({ projectId: "p1" });
            track(events.appLoaded());
            trackException({ error: new Error("x"), source: "unit" });
            void flushTelemetry();
        }).not.toThrow();
    });

    it("forces the console sink when debug is set in the build config", () => {
        (globalThis as Record<string, unknown>).__EMR_TELEMETRY_CONFIG__ = {
            debug: true,
        };
        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

        try {
            initTelemetry({ appName: "pr-tab" });
            track(events.appLoaded());
            expect(infoSpy).toHaveBeenCalled();
        } finally {
            infoSpy.mockRestore();
            delete (globalThis as Record<string, unknown>).__EMR_TELEMETRY_CONFIG__;
        }
    });

    it("never throws when the sink fails to flush", () => {
        const angry = fakeSink();
        angry.flush = vi.fn(() => {
            throw new Error("flush failure");
        });
        __resetTelemetryForTests(angry);
        expect(() => flushTelemetry()).not.toThrow();
    });

    it("is idempotent — a second initTelemetry call is ignored", () => {
        initTelemetry({ appName: "pr-tab" });
        initTelemetry({ appName: "documents-hub" });
        expect(getTelemetryContext().appName).toBe("pr-tab");
    });

    it("falls back to a non-crypto session id when randomUUID is unavailable", () => {
        const original = globalThis.crypto;
        Object.defineProperty(globalThis, "crypto", {
            value: {},
            configurable: true,
        });

        try {
            initTelemetry({ appName: "pr-tab" });
            expect(getTelemetryContext().sessionId).toMatch(/^s-/);
        } finally {
            Object.defineProperty(globalThis, "crypto", {
                value: original,
                configurable: true,
            });
        }
    });
});
