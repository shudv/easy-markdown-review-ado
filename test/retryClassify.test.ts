// Tests for the retry error classifier. Pins the terminal-vs-retryable
// decision table for both read and write modes, plus status extraction and
// abort detection.

import { describe, expect, it } from "vitest";

import {
  extractStatus,
  isAbortError,
  isRetryable,
} from "../src/shell/retryClassify";

describe("extractStatus", () => {
  it("reads a numeric `status`", () => {
    expect(extractStatus({ status: 503 })).toBe(503);
  });

  it("reads `statusCode` / `httpStatusCode` fallbacks", () => {
    expect(extractStatus({ statusCode: 429 })).toBe(429);
    expect(extractStatus({ httpStatusCode: 404 })).toBe(404);
  });

  it("reads a nested `serverError.status`", () => {
    expect(extractStatus({ serverError: { status: 500 } })).toBe(500);
  });

  it("ignores a non-numeric nested serverError.status", () => {
    // `serverError` present but its status isn't a number → no status found
    // (guards the `typeof serverError.status === "number"` check).
    expect(extractStatus({ serverError: { status: "500" } })).toBeUndefined();
  });

  it("ignores out-of-range / non-numeric statuses", () => {
    expect(extractStatus({ status: 99 })).toBeUndefined();
    expect(extractStatus({ status: 600 })).toBeUndefined();
    expect(extractStatus({ status: "503" })).toBeUndefined();
  });

  it("accepts the inclusive range boundaries 100 and 599", () => {
    // Guards the `>= 100` / `<= 599` bounds against off-by-one mutations.
    expect(extractStatus({ status: 100 })).toBe(100);
    expect(extractStatus({ status: 599 })).toBe(599);
  });

  it("returns undefined for non-objects and nulls", () => {
    expect(extractStatus(null)).toBeUndefined();
    expect(extractStatus("boom")).toBeUndefined();
    expect(extractStatus(undefined)).toBeUndefined();
    expect(extractStatus({})).toBeUndefined();
  });
});

describe("isAbortError", () => {
  it("detects an AbortError by name", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });

  it("detects the DOMException abort code", () => {
    expect(isAbortError({ code: 20 })).toBe(true);
  });

  it("is false for ordinary errors", () => {
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("isRetryable — reads", () => {
  it("never retries an aborted request", () => {
    const e = new Error("x");
    e.name = "AbortError";
    expect(isRetryable(e, "read")).toBe(false);
  });

  it("retries a connection failure (no status)", () => {
    expect(isRetryable(new Error("network down"), "read")).toBe(true);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])(
    "retries transient status %i",
    (status) => {
      expect(isRetryable({ status }, "read")).toBe(true);
    },
  );

  it.each([401, 403])("retries transient auth status %i", (status) => {
    expect(isRetryable({ status }, "read")).toBe(true);
  });

  it.each([400, 404, 405, 409, 410, 412, 422, 501])(
    "does not retry terminal status %i",
    (status) => {
      expect(isRetryable({ status }, "read")).toBe(false);
    },
  );

  it("does not retry an unclassified concrete status", () => {
    expect(isRetryable({ status: 418 }, "read")).toBe(false);
  });
});

describe("isRetryable — writes", () => {
  it("does NOT retry a connection failure (ambiguous — write may have committed)", () => {
    // A lost connection / lost response is ambiguous: the mutation may have
    // applied server-side. Retrying could duplicate the write, so writes must
    // not retry when there is no status.
    expect(isRetryable(new Error("ECONNRESET"), "write")).toBe(false);
  });

  it.each([429, 503, 401, 403])(
    "retries write-safe status %i (rejected pre-processing)",
    (status) => {
      expect(isRetryable({ status }, "write")).toBe(true);
    },
  );

  it.each([500, 502, 504])(
    "does NOT retry ambiguous 5xx %i (write may have applied)",
    (status) => {
      expect(isRetryable({ status }, "write")).toBe(false);
    },
  );

  it.each([400, 404, 409, 412, 422])(
    "does not retry terminal status %i",
    (status) => {
      expect(isRetryable({ status }, "write")).toBe(false);
    },
  );

  it("never retries an aborted write", () => {
    expect(isRetryable({ code: 20 }, "write")).toBe(false);
  });
});
