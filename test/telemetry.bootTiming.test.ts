// Tests for boot-time measurement: markBootStart + markAppReady idempotency,
// the readyReason payload, and the "no-op outside a real boot" guard.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetTelemetryForTests } from "../src/telemetry/telemetry";
import {
  type BootTimingEnvironment,
  markBootAuthWaitEnd,
  markBootAuthWaitStart,
  markBootPhase,
  markBootStart,
  markAppReady,
  __resetBootTimingForTests,
} from "../src/telemetry/bootTiming";
import type { TelemetrySink } from "../src/telemetry/types";

function fakeSink() {
  const sink: TelemetrySink & {
    eventCalls: Array<{ event: unknown; ctx: unknown }>;
  } = {
    name: "fake",
    eventCalls: [],
    init: vi.fn(),
    setContext: vi.fn(),
    trackEvent: vi.fn((event, ctx) => sink.eventCalls.push({ event, ctx })),
    trackException: vi.fn(),
    flush: vi.fn(),
  };
  return sink;
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
  let sink: ReturnType<typeof fakeSink>;

  beforeEach(() => {
    sink = fakeSink();
    __resetTelemetryForTests(sink);
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

    expect(sink.eventCalls).toHaveLength(1);
    const { event } = sink.eventCalls[0]! as {
      event: {
        name: string;
        properties?: Record<string, unknown>;
        measurements?: Record<string, number>;
      };
    };
    expect(event.name).toBe("app.loaded");
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

    const { event } = sink.eventCalls[0]! as {
      event: {
        properties: Record<string, unknown>;
        measurements: Record<string, number>;
      };
    };
    expect(event.properties.bootHadHiddenInterval).toBe(true);
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

    const { event } = sink.eventCalls[0]! as {
      event: { measurements: Record<string, number> };
    };
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

    const { event } = sink.eventCalls[0]! as {
      event: { measurements: Record<string, number> };
    };
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

    const { event } = sink.eventCalls[0]! as {
      event: { measurements: Record<string, number> };
    };
    expect(event.measurements.authRefreshWaitMs).toBe(12);
  });

  it("is idempotent — only the first markAppReady wins", () => {
    markBootStart();
    markAppReady("content");
    markAppReady("empty");
    markAppReady("error");
    expect(sink.eventCalls).toHaveLength(1);
  });

  it("defaults readyReason to 'content'", () => {
    markBootStart();
    markAppReady();
    const { event } = sink.eventCalls[0]! as {
      event: { properties?: Record<string, unknown> };
    };
    expect(event.properties).toEqual({
      readyReason: "content",
      bootHadHiddenInterval: false,
    });
  });

  it("no-ops when boot was never started (e.g. Storybook / standalone)", () => {
    // No markBootStart() call.
    markAppReady("content");
    expect(sink.eventCalls).toHaveLength(0);
  });

  it("re-arms after a fresh markBootStart", () => {
    markBootStart();
    markAppReady("content");
    expect(sink.eventCalls).toHaveLength(1);

    markBootStart();
    markAppReady("empty");
    expect(sink.eventCalls).toHaveLength(2);
    const { event } = sink.eventCalls[1]! as {
      event: { properties?: Record<string, unknown> };
    };
    expect(event.properties).toEqual({
      readyReason: "empty",
      bootHadHiddenInterval: false,
    });
  });
});
