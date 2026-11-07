import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/telemetry/ErrorBoundary";
import {
    __resetBootTimingForTests,
    type BootTimingEnvironment,
    markBootStart,
} from "../src/telemetry/bootTiming";
import {
    __uninstallGlobalErrorHandlersForTests,
    claimUnhandledRejections,
    installGlobalErrorHandlers,
    rejectionTypeOf,
} from "../src/telemetry/errorHandlers";
import { __resetTelemetryForTests } from "../src/telemetry/telemetry";
import type { TelemetrySink } from "../src/telemetry/types";

function fakeSink() {
    const sink: TelemetrySink & {
        eventCalls: unknown[];
        exceptionCalls: unknown[];
    } = {
        name: "fake",
        eventCalls: [],
        exceptionCalls: [],
        init: vi.fn(),
        setContext: vi.fn(),
        trackEvent: vi.fn((event) => sink.eventCalls.push(event)),
        trackException: vi.fn((info) => sink.exceptionCalls.push(info)),
        flush: vi.fn(),
    };

    return sink;
}

const timingEnvironment: BootTimingEnvironment = {
    now: () => 10,
    isVisible: () => true,
    subscribeVisibilityChange: () => () => {},
};

function rejectWith(reason: unknown): Event {
    // Cancelable, like the browser's real PromiseRejectionEvent.
    const event = new Event("unhandledrejection", {
        cancelable: true,
    }) as PromiseRejectionEvent;

    Object.defineProperty(event, "reason", { value: reason });
    window.dispatchEvent(event);

    return event;
}

describe("error reliability denominator", () => {
    let sink: ReturnType<typeof fakeSink>;

    beforeEach(() => {
        sink = fakeSink();
        __resetTelemetryForTests(sink);
        __resetBootTimingForTests();
        __uninstallGlobalErrorHandlersForTests();
        markBootStart(timingEnvironment);
    });

    afterEach(() => {
        __uninstallGlobalErrorHandlersForTests();
        __resetBootTimingForTests();
        __resetTelemetryForTests();
    });

    it("keeps a React boundary failure in the loaded-session cohort", () => {
        const boundary = new ErrorBoundary({
            source: "unit",
            children: createElement("div"),
        });

        boundary.componentDidCatch(new Error("render failed"), {
            componentStack: "at Unit",
        });

        expect(sink.exceptionCalls).toHaveLength(1);
        expect(sink.eventCalls).toEqual([
            expect.objectContaining({
                name: "app.loaded",
                properties: expect.objectContaining({ readyReason: "error" }),
            }),
        ]);
    });

    it("keeps a global error in the loaded-session cohort", () => {
        installGlobalErrorHandlers();
        window.dispatchEvent(new ErrorEvent("error", { error: new Error("global failed") }));

        expect(sink.exceptionCalls).toHaveLength(1);
        expect(sink.eventCalls).toHaveLength(1);
    });

    it("keeps an unhandled rejection in the loaded-session cohort", () => {
        installGlobalErrorHandlers();
        const event = new Event("unhandledrejection") as PromiseRejectionEvent;
        Object.defineProperty(event, "reason", { value: "promise failed" });
        window.dispatchEvent(event);

        expect(sink.exceptionCalls).toHaveLength(1);
        expect(sink.eventCalls).toHaveLength(1);
    });
});

describe("unhandled rejection reasons with no primitive conversion", () => {
    let sink: ReturnType<typeof fakeSink>;

    beforeEach(() => {
        sink = fakeSink();
        __resetTelemetryForTests(sink);
        __resetBootTimingForTests();
        __uninstallGlobalErrorHandlersForTests();
        markBootStart(timingEnvironment);
        installGlobalErrorHandlers();
    });

    afterEach(() => {
        __uninstallGlobalErrorHandlersForTests();
        __resetBootTimingForTests();
        __resetTelemetryForTests();
    });

    // Production regression: `String(reason)` threw "Cannot convert object to
    // primitive value" inside the listener, so the real rejection was replaced
    // by a `window.onerror` TypeError and never reported.
    it.each([
        ["a null-prototype object", Object.create(null) as unknown, "object:null-prototype"],
        [
            "an object whose toString/valueOf return objects",
            { toString: () => ({}), valueOf: () => ({}) },
            "object:Object",
        ],
    ])("reports %s as the rejection itself", (_label, reason, rejectionType) => {
        rejectWith(reason);

        expect(sink.exceptionCalls).toEqual([
            expect.objectContaining({
                source: "unhandledrejection",
                handled: false,
                error: reason,
                properties: { rejectionType },
            }),
        ]);
        expect(sink.eventCalls).toEqual([
            expect.objectContaining({
                name: "app.loaded",
                properties: expect.objectContaining({
                    readyReason: "error",
                }),
            }),
        ]);
    });

    it("passes an ADO-style error object through so its status survives", () => {
        const reason = { status: 401, message: "TF400813: not authorized" };
        rejectWith(reason);

        expect(sink.exceptionCalls).toEqual([
            expect.objectContaining({
                error: reason,
                source: "unhandledrejection",
            }),
        ]);
    });

    it("does not attach a rejection type for a real Error", () => {
        const reason = new TypeError("boom");
        rejectWith(reason);

        const [info] = sink.exceptionCalls as { properties?: object }[];
        expect(info).toBeDefined();
        expect(info.properties ?? {}).not.toHaveProperty("rejectionType");
    });
});

describe("claimed unhandled rejections", () => {
    let sink: ReturnType<typeof fakeSink>;

    beforeEach(() => {
        sink = fakeSink();
        __resetTelemetryForTests(sink);
        __resetBootTimingForTests();
        __uninstallGlobalErrorHandlersForTests();
        markBootStart(timingEnvironment);
        installGlobalErrorHandlers();
    });

    afterEach(() => {
        __uninstallGlobalErrorHandlersForTests();
        __resetBootTimingForTests();
        __resetTelemetryForTests();
    });

    // The owner recovers (e.g. re-sends the SDK handshake) and reports only if
    // that fails, so the global net must neither report nor end boot.
    it("skips a claimed rejection entirely, and reports it again once released", () => {
        const release = claimUnhandledRejections((r) => r === "owned");
        // Handled by its owner, so the browser mustn't log it as uncaught either.
        expect(rejectWith("owned").defaultPrevented).toBe(true);
        expect(sink.exceptionCalls).toHaveLength(0);
        expect(sink.eventCalls).toHaveLength(0);

        release();
        expect(rejectWith("owned").defaultPrevented).toBe(false);
        expect(sink.exceptionCalls).toHaveLength(1);
    });

    it("still reports rejections the claim doesn't recognise", () => {
        const release = claimUnhandledRejections((r) => r === "owned");
        rejectWith("other");
        expect(sink.exceptionCalls).toHaveLength(1);
        release();
    });

    it("never lets a throwing predicate hide a rejection", () => {
        const release = claimUnhandledRejections(() => {
            throw new Error("bad predicate");
        });

        rejectWith("anything");
        expect(sink.exceptionCalls).toHaveLength(1);
        release();
    });
});

describe("rejectionTypeOf", () => {
    it.each<[string, unknown, string]>([
        ["null", null, "null"],
        ["undefined", undefined, "undefined"],
        ["a string", "text", "string"],
        ["a number", 42, "number"],
        ["a symbol", Symbol("s"), "symbol"],
        ["a function", () => 1, "function:Function"],
        ["a Map", new Map(), "object:Map"],
        ["a null-prototype object", Object.create(null), "object:null-prototype"],
        ["a constructor-less object", Object.create({ constructor: undefined }), "object"],
    ])("describes %s", (_label, value, expected) => {
        expect(rejectionTypeOf(value)).toBe(expected);
    });

    it("never throws, even when prototype access throws", () => {
        const hostile = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw new Error("no access");
                },
            },
        );

        expect(rejectionTypeOf(hostile)).toBe("object:opaque");
    });
});
