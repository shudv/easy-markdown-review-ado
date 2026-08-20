// Tests for the shared telemetry error-shape extractor: HTTP status + ADO code
// extraction and the no-"[object Object]" message guarantee.

import { describe, expect, it } from "vitest";

import {
  adoErrorCodeOf,
  describeError,
  httpStatusOf,
} from "../src/telemetry/errorShape";

describe("httpStatusOf", () => {
  it("reads status / statusCode / httpStatusCode and nested serverError", () => {
    expect(httpStatusOf({ status: 401 })).toBe(401);
    expect(httpStatusOf({ statusCode: 403 })).toBe(403);
    expect(httpStatusOf({ httpStatusCode: 500 })).toBe(500);
    expect(httpStatusOf({ serverError: { status: 503 } })).toBe(503);
  });

  it("ignores out-of-range / missing / non-objects", () => {
    expect(httpStatusOf({ status: 42 })).toBeUndefined();
    expect(httpStatusOf({})).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
    expect(httpStatusOf("401")).toBeUndefined();
  });
});

describe("adoErrorCodeOf", () => {
  it("extracts a TF###### code from an Error message", () => {
    const err = Object.assign(
      new Error(
        "TF400813: The user 'x' is not authorized to access this resource.",
      ),
      { name: "TFS.WebApi.Exception" },
    );
    expect(adoErrorCodeOf(err)).toBe("TF400813");
  });

  it("extracts from responseText and from serverError.typeKey", () => {
    expect(
      adoErrorCodeOf({ responseText: '{"message":"TF401019: nope"}' }),
    ).toBe("TF401019");
    expect(
      adoErrorCodeOf({ serverError: { message: "boom TF400813 boom" } }),
    ).toBe("TF400813");
  });

  it("returns undefined when there is no code", () => {
    expect(adoErrorCodeOf(new Error("plain failure"))).toBeUndefined();
    expect(adoErrorCodeOf({ status: 500 })).toBeUndefined();
  });
});

describe("describeError", () => {
  it("captures message/name/stack/status/code for a TFS.WebApi.Exception", () => {
    const err = Object.assign(new Error("TF400813: not authorized"), {
      name: "TFS.WebApi.Exception",
      status: 403,
      responseText: '{"message":"TF400813: not authorized"}',
    });
    const shape = describeError(err);
    expect(shape).toMatchObject({
      name: "TFS.WebApi.Exception",
      httpStatus: 403,
      adoErrorCode: "TF400813",
    });
    expect(shape.message).toContain("TF400813");
    expect(typeof shape.stack).toBe("string");
  });

  it("omits status/code when absent", () => {
    const shape = describeError(new Error("plain"));
    expect(shape.httpStatus).toBeUndefined();
    expect(shape.adoErrorCode).toBeUndefined();
    expect(shape.message).toBe("plain");
  });

  it("never yields '[object Object]' for a non-Error object", () => {
    expect(describeError({ message: "hello" }).message).toBe("hello");
    expect(describeError({ a: 1 }).message).toBe('{"a":1}');
    expect(describeError({ a: 1 }).message).not.toContain("[object Object]");
  });

  it("never serializes responseText (identity GUID) into the message", () => {
    const err = {
      status: 403,
      responseText:
        '{"message":"TF400813: The user \'12345678-1234-1234-1234-123456789012\' is not authorized"}',
    };
    const shape = describeError(err);
    expect(shape.message).not.toContain("responseText");
    expect(shape.message).not.toContain("12345678-1234-1234-1234-123456789012");
    // The safe, structured signals are still captured.
    expect(shape.httpStatus).toBe(403);
    expect(shape.adoErrorCode).toBe("TF400813");
  });

  it("passes a string through", () => {
    expect(describeError("boom").message).toBe("boom");
  });
});
