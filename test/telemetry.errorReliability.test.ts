import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

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

beforeEach(() => {
    __resetBootTimingForTests();
    __uninstallGlobalErrorHandlersForTests();
    markBootStart(timingEnvironment);
});

afterEach(() => {
    __uninstallGlobalErrorHandlersForTests();
    __resetBootTimingForTests();
});

describe("error reliability denominator", () => {
    // A session that crashes during boot still counts as loaded (with
    // readyReason "error"), so error rates are measured against every session.
    it.each([
        {
            name: "a React boundary failure",
            fail: () =>
                new ErrorBoundary({
                    source: "unit",
                    children: createElement("div"),
                }).componentDidCatch(new Error("render failed"), { componentStack: "at Unit" }),
        },
        {
            name: "a global error",
            fail: () => {
                installGlobalErrorHandlers();
                window.dispatchEvent(
                    new ErrorEvent("error", { error: new Error("global failed") }),
                );
            },
        },
        {
            name: "an unhandled rejection",
            fail: () => {
                installGlobalErrorHandlers();
                rejectWith("promise failed");
            },
        },
    ])("keeps $name in the loaded-session cohort", ({ fail }) => {
        fail();

        expect(telemetry.current.exceptions).toHaveLength(1);
        expect(telemetry.current.events).toEqual([
            expect.objectContaining({
                name: "app.loaded",
                properties: expect.objectContaining({ readyReason: "error" }),
            }),
        ]);
    });
});

describe("unhandled rejection reasons with no primitive conversion", () => {
    beforeEach(() => {
        installGlobalErrorHandlers();
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

        expect(telemetry.current.exceptions).toEqual([
            expect.objectContaining({
                source: "unhandledrejection",
                handled: false,
                error: reason,
                properties: { rejectionType },
            }),
        ]);
        expect(telemetry.current.eventNames()).toEqual(["app.loaded"]);
    });

    it("passes an ADO-style error object through so its status survives", () => {
        const reason = { status: 401, message: "TF400813: not authorized" };

        rejectWith(reason);

        expect(telemetry.current.exceptions).toEqual([
            expect.objectContaining({ error: reason, source: "unhandledrejection" }),
        ]);
    });

    it("does not attach a rejection type for a real Error", () => {
        const reason = new TypeError("boom");

        rejectWith(reason);

        expect(telemetry.current.exceptions).toEqual([expect.objectContaining({ error: reason })]);
        expect(telemetry.current.exceptions[0]).not.toHaveProperty("properties.rejectionType");
    });
});

describe("claimed unhandled rejections", () => {
    beforeEach(() => {
        installGlobalErrorHandlers();
    });

    // The owner recovers (e.g. re-sends the SDK handshake) and reports only if
    // that fails, so the global net must neither report nor end boot.
    it("skips a claimed rejection entirely, and keeps the browser from logging it", () => {
        const release = claimUnhandledRejections((r) => r === "owned");

        expect(rejectWith("owned").defaultPrevented).toBe(true);
        expect(telemetry.current.exceptions).toEqual([]);
        expect(telemetry.current.events).toEqual([]);

        release();
    });

    it("reports the rejection again once the claim is released", () => {
        const release = claimUnhandledRejections((r) => r === "owned");

        release();

        expect(rejectWith("owned").defaultPrevented).toBe(false);
        expect(telemetry.current.exceptions).toHaveLength(1);
    });

    it("still reports rejections the claim doesn't recognise", () => {
        const release = claimUnhandledRejections((r) => r === "owned");

        rejectWith("other");

        expect(telemetry.current.exceptions).toHaveLength(1);
        release();
    });

    it("never lets a throwing predicate hide a rejection", () => {
        const release = claimUnhandledRejections(() => {
            throw new Error("bad predicate");
        });

        rejectWith("anything");

        expect(telemetry.current.exceptions).toHaveLength(1);
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
