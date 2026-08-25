import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/telemetry/ErrorBoundary";
import {
  __resetBootTimingForTests,
  type BootTimingEnvironment,
  markBootStart,
} from "../src/telemetry/bootTiming";
import {
  __uninstallGlobalErrorHandlersForTests,
  installGlobalErrorHandlers,
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
      children: React.createElement("div"),
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
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("global failed") }),
    );

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
