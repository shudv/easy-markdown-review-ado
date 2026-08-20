import { describe, expect, it } from "vitest";

import {
  assembleHubCommentUrl,
  buildHubDocUrl,
  formatError,
  initialsOf,
  orgUrlFromReferrer,
} from "../src/hub/documentsHub.helpers";

describe("initialsOf", () => {
  it("uses the first two letters of a single name", () => {
    expect(initialsOf("Alice")).toBe("AL");
  });
  it("uses first + last initials for multi-word names", () => {
    expect(initialsOf("Ada  Lovelace")).toBe("AL");
    expect(initialsOf("  Grace Brewster Hopper ")).toBe("GH");
  });
  it("returns an empty string for a blank name", () => {
    expect(initialsOf("   ")).toBe("");
  });
});

describe("formatError", () => {
  it("prefers an Error's stack", () => {
    const e = new Error("boom");
    expect(formatError(e)).toBe(e.stack);
  });
  it("falls back to the message when the stack is empty", () => {
    const e = new Error("boom");
    e.stack = "";
    expect(formatError(e)).toBe("boom");
  });
  it("pretty-prints non-null objects", () => {
    expect(formatError({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
  it("stringifies primitives and null", () => {
    expect(formatError("oops")).toBe("oops");
    expect(formatError(null)).toBe("null");
    expect(formatError(42)).toBe("42");
  });
});

describe("assembleHubCommentUrl", () => {
  const EXT = { publisherId: "pub", extensionId: "ext" };

  it("returns undefined without an org or project", () => {
    expect(
      assembleHubCommentUrl("", "Proj", EXT, "r", "/x.md", "t"),
    ).toBeUndefined();
    expect(
      assembleHubCommentUrl(
        "https://dev.azure.com/org",
        "",
        EXT,
        "r",
        "/x.md",
        "t",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the base URL is malformed", () => {
    expect(
      assembleHubCommentUrl("not a url", "Proj", EXT, "r", "/x.md", "t"),
    ).toBeUndefined();
  });

  it("assembles a hub URL with repo, path and comment params", () => {
    const url = assembleHubCommentUrl(
      "https://dev.azure.com/org/",
      "My Proj",
      EXT,
      "repo1",
      "/docs/a.md",
      "42",
    );
    expect(url).toBeDefined();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe(
      "/org/My%20Proj/_apps/hub/pub.ext.documents-hub",
    );
    expect(parsed.searchParams.get("repo")).toBe("repo1");
    expect(parsed.searchParams.get("path")).toBe("docs/a.md");
    expect(parsed.searchParams.get("comment")).toBe("42");
  });

  it("omits empty repo/path and returns undefined for a blank thread", () => {
    expect(
      assembleHubCommentUrl(
        "https://dev.azure.com/org",
        "Proj",
        EXT,
        "",
        "/",
        "",
      ),
    ).toBeUndefined();
  });
});

describe("orgUrlFromReferrer", () => {
  it("returns an empty string for an empty referrer", () => {
    expect(orgUrlFromReferrer("")).toBe("");
  });
  it("returns an empty string for an unparseable referrer", () => {
    expect(orgUrlFromReferrer("::::")).toBe("");
  });
  it("uses the first path segment (the org) when present", () => {
    expect(orgUrlFromReferrer("https://dev.azure.com/myorg/proj/_git")).toBe(
      "https://dev.azure.com/myorg",
    );
  });
  it("falls back to the origin when there is no path", () => {
    expect(orgUrlFromReferrer("https://dev.azure.com/")).toBe(
      "https://dev.azure.com",
    );
  });
});

describe("buildHubDocUrl", () => {
  const EXT = { publisherId: "pub", extensionId: "ext" };

  it("builds a hub URL with repo + path params (no comment)", () => {
    expect(
      buildHubDocUrl(
        "https://dev.azure.com/org",
        "Proj",
        EXT,
        "repo1",
        "/docs/x.md",
      ),
    ).toBe(
      "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=repo1&path=docs%2Fx.md",
    );
  });

  it("returns undefined without an org or project", () => {
    expect(buildHubDocUrl("", "Proj", EXT, "r", "/x.md")).toBeUndefined();
    expect(
      buildHubDocUrl("https://dev.azure.com/org", "", EXT, "r", "/x.md"),
    ).toBeUndefined();
  });

  it("returns undefined when the base URL is malformed", () => {
    expect(
      buildHubDocUrl("not a url", "Proj", EXT, "r", "/x.md"),
    ).toBeUndefined();
  });

  it("omits the repo param when no repo id is given", () => {
    expect(
      buildHubDocUrl("https://dev.azure.com/org", "Proj", EXT, "", "/x.md"),
    ).toBe(
      "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?path=x.md",
    );
  });

  it("collapses redundant slashes in the org URL and path", () => {
    expect(
      buildHubDocUrl(
        "https://dev.azure.com/org//",
        "Proj",
        EXT,
        "r",
        "//docs/x.md",
      ),
    ).toBe(
      "https://dev.azure.com/org/Proj/_apps/hub/pub.ext.documents-hub?repo=r&path=docs%2Fx.md",
    );
  });
});
