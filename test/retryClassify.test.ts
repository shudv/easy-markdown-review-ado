// Tests for the retry error classifier. Pins the terminal-vs-retryable
// decision table for both read and write modes, plus status extraction and
// abort detection.

import { describe, expect, it } from "vitest";

import { extractStatus, isAbortError, isRetryable } from "../src/shell/retryClassify";

describe("extractStatus", () => {
    it.each([
        { name: "a numeric status", error: { status: 503 }, expected: 503 },
        { name: "a statusCode", error: { statusCode: 429 }, expected: 429 },
        { name: "an httpStatusCode", error: { httpStatusCode: 404 }, expected: 404 },
        {
            name: "a nested serverError.status",
            error: { serverError: { status: 500 } },
            expected: 500,
        },
    ])("reads $name", ({ error, expected }) => {
        expect(extractStatus(error)).toBe(expected);
    });

    it.each([
        { name: "a number below the HTTP range", error: { status: 99 } },
        { name: "a number above the HTTP range", error: { status: 600 } },
        { name: "a status given as a string", error: { status: "503" } },
        { name: "a nested status given as a string", error: { serverError: { status: "500" } } },
        { name: "an object without a status", error: {} },
        { name: "null", error: null },
        { name: "undefined", error: undefined },
        { name: "a thrown string", error: "boom" },
    ])("finds no status in $name", ({ error }) => {
        expect(extractStatus(error)).toBeUndefined();
    });
});

describe("isAbortError", () => {
    it.each([
        {
            name: "an Error named AbortError",
            error: Object.assign(new Error("x"), { name: "AbortError" }),
        },
        { name: "a DOMException with the abort code", error: { code: 20 } },
    ])("recognises $name as a cancellation", ({ error }) => {
        expect(isAbortError(error)).toBe(true);
    });

    it.each([
        { name: "an ordinary Error", error: new Error("nope") },
        { name: "null", error: null },
    ])("does not treat $name as a cancellation", ({ error }) => {
        expect(isAbortError(error)).toBe(false);
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

    it.each([408, 425, 429, 500, 502, 503, 504])("retries transient status %i", (status) => {
        expect(isRetryable({ status }, "read")).toBe(true);
    });

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

    it.each([400, 404, 409, 412, 422])("does not retry terminal status %i", (status) => {
        expect(isRetryable({ status }, "write")).toBe(false);
    });

    it("never retries an aborted write", () => {
        expect(isRetryable({ code: 20 }, "write")).toBe(false);
    });
});
