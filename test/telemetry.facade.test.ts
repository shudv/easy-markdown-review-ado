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
} from "../src/telemetry/telemetry";
import { events } from "../src/telemetry/events";
import { hashId } from "../src/telemetry/sanitize";
import type { TelemetrySink } from "../src/telemetry/types";

function fakeSink() {
  const sink: TelemetrySink & {
    eventCalls: Array<{ event: unknown; ctx: unknown }>;
    exceptionCalls: Array<{ info: unknown; ctx: unknown }>;
  } = {
    name: "fake",
    eventCalls: [],
    exceptionCalls: [],
    init: vi.fn(),
    setContext: vi.fn(),
    trackEvent: vi.fn((event, ctx) => sink.eventCalls.push({ event, ctx })),
    trackException: vi.fn((info, ctx) =>
      sink.exceptionCalls.push({ info, ctx }),
    ),
    flush: vi.fn(),
  };
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

    expect(sink.eventCalls).toHaveLength(1);
    const { event, ctx } = sink.eventCalls[0]!;
    expect((event as { name: string }).name).toBe("comment.edited");
    expect(ctx).toMatchObject({ projectId: "p1", repositoryId: "r1" });
  });

  it("hashes the raw pull-request id so it never ships verbatim", () => {
    const sink = fakeSink();
    __resetTelemetryForTests(sink);
    setTelemetryContext({ pullRequestId: 98765 });

    expect(getTelemetryContext().pullRequestId).toBe(hashId(98765));
    expect(getTelemetryContext().pullRequestId).not.toBe("98765");
  });

  it("sanitizes event properties before handing them to the sink", () => {
    const sink = fakeSink();
    __resetTelemetryForTests(sink);
    // Construct an event with a deliberately unsafe property bag.
    track({
      name: "test.event",
      properties: { repoName: "secret-repo", anchorKind: "line" },
      measurements: { count: 3, bad: NaN },
    });

    const { event } = sink.eventCalls[0]!;
    const e = event as {
      properties: Record<string, unknown>;
      measurements: Record<string, number>;
    };
    expect(e.properties).toEqual({ anchorKind: "line" });
    expect(e.properties).not.toHaveProperty("repoName");
    expect(e.measurements).toEqual({ count: 3 });
  });

  it("forwards exceptions with sanitized properties", () => {
    const sink = fakeSink();
    __resetTelemetryForTests(sink);
    trackException({
      error: new Error("boom"),
      source: "unit",
      properties: { repoName: "leak", phase: "save" },
    });

    const { info } = sink.exceptionCalls[0]!;
    const i = info as { properties: Record<string, unknown> };
    expect(i.properties).toEqual({ phase: "save" });
  });

  it("never throws when a sink misbehaves", () => {
    const angry = fakeSink();
    angry.trackEvent = vi.fn(() => {
      throw new Error("sink failure");
    });
    __resetTelemetryForTests(angry);
    expect(() => track(events.appLoaded())).not.toThrow();
  });

  it("defaults to a no-op sink (no key configured in tests)", () => {
    // __EMR_TELEMETRY_CONFIG__ is undefined under Vitest, so init must not
    // throw and must not attempt egress.
    expect(() => initTelemetry({ appName: "pr-tab" })).not.toThrow();
    expect(getTelemetryContext().appName).toBe("pr-tab");
  });

  it("stamps slicing dimensions (version + environment) into context", () => {
    initTelemetry({ appName: "documents-hub" });
    const ctx = getTelemetryContext();
    expect(ctx.appName).toBe("documents-hub");
    // appVersion is build-stamped; under Vitest it falls back to the default.
    expect(typeof ctx.appVersion).toBe("string");
    expect(ctx.environment).toBe("development");
    expect(typeof ctx.sessionId).toBe("string");
  });

  it("records the installed extension version passed by the entry point", () => {
    initTelemetry({ appName: "pr-tab", extensionVersion: "0.0.1.1750000000" });
    expect(getTelemetryContext().extensionVersion).toBe("0.0.1.1750000000");
  });

  it("leaves extensionVersion unset when the host can't provide one", () => {
    initTelemetry({ appName: "pr-tab" });
    expect(getTelemetryContext().extensionVersion).toBeUndefined();
  });

  it("defaults to a no-op sink that swallows every call", () => {
    // No key configured under Vitest, so initTelemetry installs the inlined
    // NOOP_SINK. Every public call must be a safe no-op.
    initTelemetry({ appName: "pr-tab" });
    expect(() => {
      setTelemetryContext({ projectId: "p1" });
      track(events.appLoaded());
      trackException({ error: new Error("x"), source: "unit" });
      flushTelemetry();
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

  it("swallows a throwing sink.flush()", () => {
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
