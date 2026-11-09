// Tests for the shared telemetry error-shape extractor: HTTP status + ADO code
// extraction and the no-"[object Object]" message guarantee.

import { describe, expect, it } from "vitest";

import { adoErrorCodeOf, describeError, httpStatusOf } from "../src/telemetry/errorShape";

describe("httpStatusOf", () => {
    it.each([
        { name: "status", error: { status: 401 }, expected: 401 },
        { name: "statusCode", error: { statusCode: 403 }, expected: 403 },
        { name: "httpStatusCode", error: { httpStatusCode: 500 }, expected: 500 },
        {
            name: "a nested serverError.status",
            error: { serverError: { status: 503 } },
            expected: 503,
        },
    ])("reads the HTTP status from $name", ({ error, expected }) => {
        expect(httpStatusOf(error)).toBe(expected);
    });

    it.each([
        { name: "a number that is not an HTTP status", error: { status: 42 } },
        { name: "an object without a status", error: {} },
        { name: "null", error: null },
        { name: "a string", error: "401" },
    ])("finds no HTTP status in $name", ({ error }) => {
        expect(httpStatusOf(error)).toBeUndefined();
    });
});

describe("adoErrorCodeOf", () => {
    it.each([
        {
            name: "a TFS.WebApi.Exception message",
            error: Object.assign(
                new Error("TF400813: The user 'x' is not authorized to access this resource."),
                { name: "TFS.WebApi.Exception" },
            ),
            expected: "TF400813",
        },
        {
            name: "the raw response body",
            error: { responseText: '{"message":"TF401019: nope"}' },
            expected: "TF401019",
        },
        {
            name: "a nested serverError message",
            error: { serverError: { message: "boom TF400813 boom" } },
            expected: "TF400813",
        },
        {
            name: "a plain-object SDK rejection",
            error: {
                message: "TF400893: Unable to contact the server. Please check your network.",
            },
            expected: "TF400893",
        },
        {
            name: "a thrown string",
            error: "TF400893: Unable to contact the server.",
            expected: "TF400893",
        },
    ])("extracts the TF code from $name", ({ error, expected }) => {
        expect(adoErrorCodeOf(error)).toBe(expected);
    });

    it.each([
        { name: "an Error without a code", error: new Error("plain failure") },
        { name: "a bare status object", error: { status: 500 } },
    ])("finds no code in $name", ({ error }) => {
        expect(adoErrorCodeOf(error)).toBeUndefined();
    });
});

describe("describeError", () => {
    it("captures message, name, stack, status and code for a TFS.WebApi.Exception", () => {
        const err = Object.assign(new Error("TF400813: not authorized"), {
            name: "TFS.WebApi.Exception",
            status: 403,
            responseText: '{"message":"TF400813: not authorized"}',
        });

        expect(describeError(err)).toEqual({
            message: "TF400813: not authorized",
            name: "TFS.WebApi.Exception",
            stack: expect.any(String),
            httpStatus: 403,
            adoErrorCode: "TF400813",
        });
    });

    it("omits status and code for a plain Error", () => {
        expect(describeError(new Error("plain"))).toEqual({
            message: "plain",
            name: "Error",
            stack: expect.any(String),
        });
    });

    it.each([
        {
            name: "a plain-object rejection's message",
            error: { message: "hello" },
            expected: "hello",
        },
        { name: "a message-less object, serialized", error: { a: 1 }, expected: '{"a":1}' },
        { name: "a thrown string", error: "boom", expected: "boom" },
    ])("reports $name instead of '[object Object]'", ({ error, expected }) => {
        expect(describeError(error).message).toBe(expected);
    });

    it("never serializes responseText (identity GUID) into the message", () => {
        const err = {
            status: 403,
            responseText:
                '{"message":"TF400813: The user \'12345678-1234-1234-1234-123456789012\' is not authorized"}',
        };

        const shape = describeError(err);

        expect(shape.message).not.toContain("12345678-1234-1234-1234-123456789012");
        // The safe, structured signals are still captured.
        expect(shape).toMatchObject({ httpStatus: 403, adoErrorCode: "TF400813" });
    });

    it("carries the ADO code for a plain-object SDK rejection", () => {
        expect(describeError({ message: "TF400893: Unable to contact the server." })).toEqual({
            message: "TF400893: Unable to contact the server.",
            adoErrorCode: "TF400893",
        });
    });

    it("does not throw when the rejection cannot be converted to a string", () => {
        const hostile = { toString: () => ({}), valueOf: () => ({}) };

        expect(describeError(hostile).message).toBe("[object Object]");
    });
});
