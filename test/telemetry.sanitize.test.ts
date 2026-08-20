// Tests for the telemetry privacy guardrail — the runtime backstop that
// guarantees only de-identified data can reach a sink.

import { describe, expect, it } from "vitest";

import {
  hashId,
  redactText,
  sanitizeMeasurements,
  sanitizeProperties,
} from "../src/telemetry/sanitize";

describe("sanitizeProperties", () => {
  it("keeps id-shaped keys with scalar values", () => {
    const { clean, dropped } = sanitizeProperties({
      projectId: "abc-123",
      anchorKind: "text-quote",
      succeeded: true,
      count: 7,
    });
    expect(clean).toEqual({
      projectId: "abc-123",
      anchorKind: "text-quote",
      succeeded: true,
      count: 7,
    });
    expect(dropped).toEqual([]);
  });

  it("drops keys whose name implies human-readable content", () => {
    const { clean, dropped } = sanitizeProperties({
      repoName: "payments-service",
      filePath: "docs/x.md",
      authorEmail: "a@b.com",
      title: "My doc",
      commentBody: "looks good",
      searchQuery: "design",
    });
    expect(clean).toEqual({});
    expect(dropped.sort()).toEqual(
      [
        "authorEmail",
        "commentBody",
        "filePath",
        "repoName",
        "searchQuery",
        "title",
      ].sort(),
    );
  });

  it("drops values that look like PII even under a safe key", () => {
    const { clean, dropped } = sanitizeProperties({
      kind: "user@example.com", // email
      ref: "refs/heads/main", // path-like
      note: "two words", // whitespace
    });
    expect(clean).toEqual({});
    expect(dropped.sort()).toEqual(["kind", "note", "ref"].sort());
  });

  it("drops over-long string values", () => {
    const long = "x".repeat(65);
    const { clean, dropped } = sanitizeProperties({ token: long, ok: "short" });
    expect(clean).toEqual({ ok: "short" });
    expect(dropped).toContain("token");
  });

  it("ignores null/undefined and rejects invalid key shapes", () => {
    const { clean, dropped } = sanitizeProperties({
      a: null,
      b: undefined,
      "weird key": "v",
      "1leading": "v",
    });
    expect(clean).toEqual({});
    // null/undefined are skipped (not 'dropped'); invalid keys are dropped.
    expect(dropped.sort()).toEqual(["1leading", "weird key"].sort());
  });

  it("returns empty for undefined input", () => {
    expect(sanitizeProperties(undefined)).toEqual({ clean: {}, dropped: [] });
  });
});

describe("sanitizeProperties — domain-like values", () => {
  it("drops bare hostnames/domains that carry no slash", () => {
    const { clean, dropped } = sanitizeProperties({
      host: "example.com",
      enumish: "text-quote",
    });
    expect(clean).toEqual({ enumish: "text-quote" });
    expect(dropped).toEqual(["host"]);
  });
});

describe("sanitizeMeasurements", () => {
  it("keeps finite numbers and drops the rest", () => {
    expect(sanitizeMeasurements({ a: 1, b: 0, c: NaN, d: Infinity })).toEqual({
      a: 1,
      b: 0,
    });
  });

  it("keeps legitimate count/length metrics whose names contain deny words", () => {
    expect(
      sanitizeMeasurements({
        bodyLength: 12,
        commentCount: 3,
        queryLength: 8,
        durationMs: 40,
      }),
    ).toEqual({
      bodyLength: 12,
      commentCount: 3,
      queryLength: 8,
      durationMs: 40,
    });
  });

  it("drops identity-shaped metric keys and invalid key shapes", () => {
    expect(
      sanitizeMeasurements({
        resultCount: 5,
        "user.id": 9,
        phoneNumber: 1,
        "bad key": 2,
      }),
    ).toEqual({ resultCount: 5 });
  });

  it("returns empty for undefined input", () => {
    expect(sanitizeMeasurements(undefined)).toEqual({});
  });
});

describe("redactText", () => {
  it("passes undefined straight through", () => {
    expect(redactText(undefined)).toBeUndefined();
  });

  it("redacts e-mail addresses, URLs and filesystem paths", () => {
    expect(redactText("mail me at jane.doe@contoso.com now")).toBe(
      "mail me at [email] now",
    );
    expect(redactText("fetch https://api.example.com/v1/x failed")).toBe(
      "fetch [url] failed",
    );
    expect(redactText("open file:///C:/Users/jane/notes.md")).toBe(
      "open [url]",
    );
    expect(redactText("at C:\\Users\\jane\\app\\main.ts:10")).toBe(
      "at [path]:10",
    );
    expect(redactText("at /home/jane/app/main.ts:10")).toBe("at [path]:10");
  });

  it("keeps non-sensitive text and truncates past the cap", () => {
    expect(redactText("Cannot read property of undefined")).toBe(
      "Cannot read property of undefined",
    );
    const long = "x".repeat(20);
    expect(redactText(long, 8)).toBe("xxxxxxxx…");
  });
});

describe("hashId", () => {
  it("is deterministic and stable across number/string", () => {
    expect(hashId(42)).toBe(hashId("42"));
    expect(hashId("abc")).toBe(hashId("abc"));
  });

  it("differs for different inputs and never returns the raw value", () => {
    const h = hashId("12345");
    expect(h).not.toBe("12345");
    expect(h).not.toBe(hashId("12346"));
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});
