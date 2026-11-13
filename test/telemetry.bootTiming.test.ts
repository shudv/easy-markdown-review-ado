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
    noteBootCache,
    noteBootShape,
    __resetBootTimingForTests,
} from "../src/telemetry/bootTiming";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

/** The single `app.loaded` event a boot reported. */
function appLoaded() {
    expect(telemetry.current.eventNames()).toEqual(["app.loaded"]);

    return telemetry.current.events[0]!;
}

/** A boot clock; `navigationStartMs` set means it knows when the page started loading. */
function fakeEnvironment(initiallyVisible = true, navigationStartMs?: number) {
    let now = 0;
    let visible = initiallyVisible;
    let listener: (() => void) | null = null;

    const environment: BootTimingEnvironment = {
        now: () => now,
        ...(navigationStartMs === undefined ? {} : { navigationStart: () => navigationStartMs }),
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
            cache: "none",
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
            cache: "none",
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
            { readyReason: "content", bootHadHiddenInterval: false, cache: "none" },
            { readyReason: "empty", bootHadHiddenInterval: false, cache: "none" },
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
                cache: "none",
            },
            { readyReason: "content", bootHadHiddenInterval: false, cache: "none" },
        ]);
    });

    it("reports what the boot loaded, merged, and forgets it for the next boot", () => {
        noteBootShape({ mdFileCount: 9 }); // before any boot: ignored
        markBootStart();
        noteBootShape({ mdFileCount: 3 });
        noteBootShape({ docChars: 1200 });
        markAppReady("content");
        noteBootShape({ mdFileCount: 7 }); // after it fired: ignored
        markBootStart();
        markAppReady("content");

        const [first, second] = telemetry.current.events;
        expect(first!.measurements).toMatchObject({ mdFileCount: 3, docChars: 1200 });
        expect(second!.measurements).not.toHaveProperty("mdFileCount");
        expect(second!.measurements).not.toHaveProperty("docChars");
    });

    it.each([
        { hits: [], cache: "none" },
        { hits: [["doc", true]], cache: "doc" },
        { hits: [["pr", true]], cache: "pr" },
        {
            hits: [
                ["pr", true],
                ["doc", true],
            ],
            cache: "pr+doc",
        },
        // Shown from the cache, then reopened because it was pushed to: the
        // first view waited for ADO after all.
        {
            hits: [
                ["pr", true],
                ["doc", true],
                ["pr", false],
            ],
            cache: "doc",
        },
    ] as const)("reports which caches the first view came from: $cache", ({ hits, cache }) => {
        noteBootCache("pr", true); // before any boot: ignored
        markBootStart();
        for (const [part, hit] of hits) noteBootCache(part, hit);
        markAppReady("content");
        noteBootCache("doc", true); // after it fired: ignored

        expect(appLoaded().properties?.cache).toBe(cache);
    });

    it("forgets the caches a boot used for the next boot", () => {
        markBootStart();
        noteBootCache("pr", true);
        noteBootCache("doc", true);
        markAppReady("content");
        markBootStart();
        markAppReady("content");

        expect(telemetry.current.events.map((event) => event.properties?.cache)).toEqual([
            "pr+doc",
            "none",
        ]);
    });

    describe("timed from the host starting to load the iframe", () => {
        it("adds the page and bundle load before our code ran, phases summing to the total", () => {
            const clock = fakeEnvironment(true, 0);
            clock.advance(120); // our page and bundle load, then our code runs
            markBootStart(clock.environment);
            clock.advance(30);
            markBootPhase("sdk-ready");
            clock.advance(400);
            markBootPhase("context-ready");
            clock.advance(50);
            markAppReady("content");

            const m = appLoaded().measurements!;

            expect(m).toMatchObject({
                bootTimeMs: 600,
                activeBootTimeMs: 600,
                hiddenTimeMs: 0,
                bundleLoadMs: 120,
                sdkReadyMs: 30,
                contextReadyMs: 400,
                renderReadyMs: 50,
            });
            expect(m.bundleLoadMs! + m.sdkReadyMs! + m.contextReadyMs! + m.renderReadyMs!).toBe(
                m.bootTimeMs,
            );
        });

        it("counts the load before our code as hidden when the page was hidden then", () => {
            const clock = fakeEnvironment(false, 0);
            clock.advance(80);
            markBootStart(clock.environment);
            clock.setVisible(true);
            clock.advance(20);
            markAppReady("content");

            expect(appLoaded().measurements).toMatchObject({
                bootTimeMs: 100,
                activeBootTimeMs: 20,
                hiddenTimeMs: 80,
            });
        });

        it("never starts the clock after our code started", () => {
            const clock = fakeEnvironment(true, 500);
            clock.advance(100);
            markBootStart(clock.environment);
            clock.advance(10);
            markAppReady("content");

            expect(appLoaded().measurements).toMatchObject({ bootTimeMs: 10, bundleLoadMs: 0 });
        });

        it("times a real browser page from its navigation start", () => {
            markBootStart();
            markAppReady("content");

            const m = appLoaded().measurements!;

            expect(m.bundleLoadMs).toBeGreaterThan(0);
            expect(m.bootTimeMs).toBeGreaterThanOrEqual(m.bundleLoadMs!);
        });

        it("leaves bundleLoadMs out when the load start isn't known", () => {
            const clock = fakeEnvironment();
            markBootStart(clock.environment);
            markAppReady("content");

            expect(appLoaded().measurements).not.toHaveProperty("bundleLoadMs");
        });
    });
});
