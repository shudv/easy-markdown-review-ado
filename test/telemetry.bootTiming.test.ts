// Tests for boot-time measurement: markBootStart + markAppReady idempotency,
// the readyReason payload, and the "no-op outside a real boot" guard.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    type BootTimingEnvironment,
    markBootAfterAutoReload,
    markBootAuthWaitEnd,
    markBootAuthWaitStart,
    markBootPhase,
    markBootStart,
    markAppReady,
    __resetBootTimingForTests,
} from "../src/telemetry/bootTiming";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

/** The single `app.loaded` event a boot reported. */
function appLoaded() {
    expect(telemetry.current.eventNames()).toEqual(["app.loaded"]);

    return telemetry.current.events[0]!;
}

function fakeEnvironment(initiallyVisible = true) {
    let now = 0;
    let visible = initiallyVisible;
    let listener: (() => void) | null = null;

    const environment: BootTimingEnvironment = {
        now: () => now,
        isVisible: () => visible,
        subscribeVisibilityChange(nextListener) {
            listener = nextListener;

            return () => {
                listener = null;
            };
        },
    };

    return {
        environment,
        advance(ms: number) {
            now += ms;
        },
        setVisible(nextVisible: boolean) {
            visible = nextVisible;
            listener?.();
        },
        hasListener: () => listener !== null,
    };
}

describe("bootTiming", () => {
    beforeEach(() => {
        __resetBootTimingForTests();
    });

    afterEach(() => {
        __resetBootTimingForTests();
    });

    it("emits app.loaded once with a bootTimeMs measurement + readyReason", () => {
        const clock = fakeEnvironment();
        markBootStart(clock.environment);
        clock.advance(25);
        markAppReady("content");

        const event = appLoaded();

        expect(event.properties).toEqual({
            readyReason: "content",
            bootHadHiddenInterval: false,
        });
        expect(event.measurements).toEqual({
            bootTimeMs: 25,
            activeBootTimeMs: 25,
            hiddenTimeMs: 0,
            authRefreshWaitMs: 0,
            renderReadyMs: 25,
        });
    });

    it("stops watching page visibility once the app is ready", () => {
        const clock = fakeEnvironment();
        markBootStart(clock.environment);

        markAppReady("content");

        expect(clock.hasListener()).toBe(false);
    });

    it("subtracts every hidden interval from active boot time", () => {
        const clock = fakeEnvironment();
        markBootStart(clock.environment);
        clock.advance(20);
        clock.setVisible(false);
        clock.advance(30);
        clock.setVisible(true);
        clock.advance(50);
        markAppReady("content");

        const event = appLoaded();

        expect(event.properties).toMatchObject({ bootHadHiddenInterval: true });
        expect(event.measurements).toMatchObject({
            bootTimeMs: 100,
            activeBootTimeMs: 70,
            hiddenTimeMs: 30,
        });
    });

    it("treats a boot that starts hidden as inactive until it becomes visible", () => {
        const clock = fakeEnvironment(false);
        markBootStart(clock.environment);
        clock.advance(40);
        clock.setVisible(true);
        clock.advance(10);
        markAppReady("content");

        const event = appLoaded();

        expect(event.measurements).toMatchObject({
            bootTimeMs: 50,
            activeBootTimeMs: 10,
            hiddenTimeMs: 40,
        });
    });

    it("records auth wait and non-overlapping boot phase durations", () => {
        const clock = fakeEnvironment();
        markBootStart(clock.environment);
        clock.advance(10);
        markBootPhase("sdk-ready");
        clock.advance(5);
        markBootAuthWaitStart();
        clock.advance(20);
        markBootAuthWaitEnd();
        clock.advance(5);
        markBootPhase("context-ready");
        clock.advance(30);
        markAppReady("content");

        const event = appLoaded();

        expect(event.measurements).toEqual({
            bootTimeMs: 70,
            activeBootTimeMs: 70,
            hiddenTimeMs: 0,
            authRefreshWaitMs: 20,
            sdkReadyMs: 10,
            contextReadyMs: 30,
            renderReadyMs: 30,
        });
    });

    it("closes an in-progress auth wait when boot reaches a terminal state", () => {
        const clock = fakeEnvironment();
        markBootStart(clock.environment);
        markBootAuthWaitStart();
        clock.advance(12);
        markAppReady("error");

        const event = appLoaded();

        expect(event.measurements).toMatchObject({ authRefreshWaitMs: 12 });
    });

    it("reports a boot once — only the first markAppReady wins", () => {
        markBootStart();
        markAppReady("content");
        markAppReady("empty");
        markAppReady("error");

        expect(appLoaded().properties).toMatchObject({ readyReason: "content" });
    });

    it("defaults readyReason to 'content'", () => {
        markBootStart();
        markAppReady();

        expect(appLoaded().properties).toEqual({
            readyReason: "content",
            bootHadHiddenInterval: false,
        });
    });

    it("no-ops when boot was never started (e.g. Storybook / standalone)", () => {
        // No markBootStart() call.
        markAppReady("content");

        expect(telemetry.current.events).toEqual([]);
    });

    it("reports the next boot after a fresh markBootStart", () => {
        markBootStart();
        markAppReady("content");

        markBootStart();
        markAppReady("empty");

        expect(telemetry.current.events.map((event) => event.properties)).toEqual([
            { readyReason: "content", bootHadHiddenInterval: false },
            { readyReason: "empty", bootHadHiddenInterval: false },
        ]);
    });

    it("tags a boot that follows our automatic reload, until the next boot", () => {
        markBootAfterAutoReload(); // before any boot: ignored
        markBootStart();
        markBootAfterAutoReload();
        markAppReady("content");
        markBootAfterAutoReload(); // after it fired: ignored
        markBootStart();
        markAppReady("content");

        expect(telemetry.current.events.map((event) => event.properties)).toEqual([
            {
                readyReason: "content",
                bootHadHiddenInterval: false,
                afterAutoReload: true,
            },
            { readyReason: "content", bootHadHiddenInterval: false },
        ]);
    });
});
