// Tests for the withRetry engine: attempt budgets, backoff/jitter math,
// Retry-After handling, abort behavior, and the read/write dedup policy.
// Uses an injected `sleep` + deterministic `random` so no real timers run.

import { describe, expect, it, vi } from "vitest";

import {
  computeBackoffMs,
  parseRetryAfterMs,
  withRetry,
} from "../src/shell/retry";

/** A sleep spy that resolves immediately but records the requested delays. */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

describe("computeBackoffMs", () => {
  it("grows exponentially and applies full jitter", () => {
    // random() = 1 (well, <1) → returns floor(random * exp). Use 0.5.
    expect(computeBackoffMs(0, 300, 4000, () => 0.5)).toBe(150);
    expect(computeBackoffMs(1, 300, 4000, () => 0.5)).toBe(300);
    expect(computeBackoffMs(2, 300, 4000, () => 0.5)).toBe(600);
  });

  it("caps the exponential term at maxDelayMs", () => {
    expect(computeBackoffMs(10, 300, 4000, () => 1)).toBe(4000);
  });

  it("can return 0 with a zero random draw", () => {
    expect(computeBackoffMs(3, 300, 4000, () => 0)).toBe(0);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses a delta-seconds header from a Response-like error", () => {
    const headers = new Headers({ "Retry-After": "2" });
    expect(parseRetryAfterMs({ headers })).toBe(2000);
  });

  it("parses an HTTP-date header relative to now", () => {
    const now = 1_000_000;
    const when = new Date(now + 5000).toUTCString();
    const headers = new Headers({ "Retry-After": when });
    // toUTCString truncates to whole seconds, so allow a <1s slack.
    const ms = parseRetryAfterMs({ headers }, now)!;
    expect(ms).toBeGreaterThanOrEqual(4000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("reads a plain `retryAfter` string field", () => {
    expect(parseRetryAfterMs({ retryAfter: "3" })).toBe(3000);
  });

  it("falls back to a lowercase `retry-after` header", () => {
    // A header bag whose `get` only answers the lowercase name, exercising the
    // `?? headers.get("retry-after")` fallback.
    const headers = {
      get: (name: string) => (name === "retry-after" ? "4" : null),
    };
    expect(parseRetryAfterMs({ headers })).toBe(4000);
  });

  it("returns undefined when the header bag yields no value", () => {
    const headers = { get: () => null };
    expect(parseRetryAfterMs({ headers })).toBeUndefined();
  });

  it("returns undefined when absent or unparseable", () => {
    expect(parseRetryAfterMs({})).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    const headers = new Headers({ "Retry-After": "not-a-date" });
    expect(parseRetryAfterMs({ headers })).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const { sleep, delays } = fakeSleep();
    const fn = vi.fn().mockResolvedValue("ok");
    const out = await withRetry(fn, { mode: "read", sleep });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("retries a transient read failure then succeeds", async () => {
    const { sleep, delays } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("recovered");
    const out = await withRetry(fn, {
      mode: "read",
      sleep,
      random: () => 0.5,
    });
    expect(out).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it("exhausts the read attempt budget (default 3) then throws", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(
      withRetry(fn, { mode: "read", sleep, random: () => 0 }),
    ).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a terminal failure", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue({ status: 404 });
    await expect(withRetry(fn, { mode: "read", sleep })).rejects.toEqual({
      status: 404,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("write mode retries up to four times by default", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(
      withRetry(fn, { mode: "write", sleep, random: () => 0 }),
    ).rejects.toEqual({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("write mode does not retry an ambiguous 500 (no duplicate write)", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, { mode: "write", sleep })).rejects.toEqual({
      status: 500,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("write mode does not retry a connection failure (ambiguous — no duplicate write)", async () => {
    // The single most important dedup guarantee: a lost connection / lost
    // response could mean the write already committed server-side, so writes
    // must fail fast rather than risk a second mutation.
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(withRetry(fn, { mode: "write", sleep })).rejects.toThrow(
      "ECONNRESET",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("read mode DOES retry a connection failure (idempotent)", async () => {
    const { sleep } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce("ok");
    await expect(
      withRetry(fn, { mode: "read", sleep, random: () => 0 }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honors a Retry-After hint over computed backoff", async () => {
    const { sleep, delays } = fakeSleep();
    const headers = new Headers({ "Retry-After": "2" });
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, headers })
      .mockResolvedValueOnce("ok");
    await withRetry(fn, { mode: "read", sleep, random: () => 0.5 });
    expect(delays).toEqual([2000]);
  });

  it("fires the onRetry hook before each retry", async () => {
    const { sleep } = fakeSleep();
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    await withRetry(fn, { mode: "read", sleep, random: () => 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1 });
  });

  it("does not retry once the signal is aborted", async () => {
    const { sleep } = fakeSleep();
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject({ status: 503 });
    });
    await expect(
      withRetry(fn, { mode: "read", sleep, signal: controller.signal }),
    ).rejects.toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("settles the backoff sleep early with an AbortError when aborted mid-wait", async () => {
    // A sleep that only resolves when we manually fire it, so the abort must be
    // what settles withRetry — not the sleep completing.
    let releaseSleep: (() => void) | undefined;
    const neverEndingSleep = () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      });
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    const p = withRetry(fn, {
      mode: "read",
      sleep: neverEndingSleep,
      random: () => 1,
      signal: controller.signal,
    });
    // Let the first attempt fail and enter the backoff sleep.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // Only the first attempt ran; the abort cut the wait short.
    expect(fn).toHaveBeenCalledTimes(1);
    // Releasing the stuck sleep afterwards must not throw or double-settle.
    releaseSleep?.();
  });

  it("propagates a sleep rejection during backoff (with a signal present)", async () => {
    // Exercises the abortable-sleep path where the injected sleep itself
    // rejects (not the signal). The rejection must surface from withRetry.
    const controller = new AbortController();
    const rejectingSleep = () => Promise.reject(new Error("sleep boom"));
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(
      withRetry(fn, {
        mode: "read",
        sleep: rejectingSleep,
        random: () => 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow("sleep boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately if already aborted before the first attempt", async () => {
    const { sleep } = fakeSleep();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue("unused");
    await expect(
      withRetry(fn, { mode: "read", sleep, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes the 1-based attempt number to fn", async () => {
    const { sleep } = fakeSleep();
    const seen: number[] = [];
    const fn = vi.fn().mockImplementation((attempt: number) => {
      seen.push(attempt);
      if (attempt < 3) return Promise.reject({ status: 503 });
      return Promise.resolve("done");
    });
    await withRetry(fn, { mode: "read", sleep, random: () => 0 });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("uses the real setTimeout path when no sleep is injected", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce("ok");
      const p = withRetry(fn, { mode: "read", random: () => 0 });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
