// Tests for boot-time measurement: markBootStart + markAppReady idempotency,
// the readyReason payload, and the "no-op outside a real boot" guard.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetTelemetryForTests } from "../src/telemetry/telemetry";
import {
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
    markBootStart();
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
    expect(event.properties).toEqual({ readyReason: "content" });
    expect(typeof event.measurements?.bootTimeMs).toBe("number");
    expect(event.measurements!.bootTimeMs).toBeGreaterThanOrEqual(0);
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
    expect(event.properties).toEqual({ readyReason: "content" });
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
    expect(event.properties).toEqual({ readyReason: "empty" });
  });
});
