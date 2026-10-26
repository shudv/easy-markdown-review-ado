import { describe, expect, it } from "vitest";

import {
  assembleHubDeepLinkUrl,
  buildHubDocUrl,
  formatError,
  initialsOf,
  orgUrlFromReferrer,
  routeUpdatesForPath,
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

describe("assembleHubDeepLinkUrl", () => {
  const EXT = { publisherId: "pub", extensionId: "ext" };
  const T = { kind: "comment" as const, threadId: "t" };

  it("returns undefined without an org or project", () => {
    expect(
      assembleHubDeepLinkUrl("", "Proj", EXT, "r", "/x.md", T),
    ).toBeUndefined();
    expect(
      assembleHubDeepLinkUrl(
        "https://dev.azure.com/org",
        "",
        EXT,
        "r",
        "/x.md",
        T,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the base URL is malformed", () => {
    expect(
      assembleHubDeepLinkUrl("not a url", "Proj", EXT, "r", "/x.md", T),
    ).toBeUndefined();
  });

  it("assembles a hub URL with repo, path and comment params", () => {
    const url = assembleHubDeepLinkUrl(
      "https://dev.azure.com/org/",
      "My Proj",
      EXT,
      "repo1",
      "/docs/a.md",
      { kind: "comment", threadId: "42" },
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

  it("assembles a hub URL with a heading anchor", () => {
    const parsed = new URL(
      assembleHubDeepLinkUrl(
        "https://dev.azure.com/org",
        "Proj",
        EXT,
        "repo1",
        "/docs/a.md",
        { kind: "heading", anchor: "goals" },
      )!,
    );
    expect(parsed.searchParams.get("path")).toBe("docs/a.md");
    expect(parsed.searchParams.get("anchor")).toBe("goals");
    expect(parsed.searchParams.has("comment")).toBe(false);
  });

  it("returns undefined for a blank thread", () => {
    expect(
      assembleHubDeepLinkUrl(
        "https://dev.azure.com/org",
        "Proj",
        EXT,
        "",
        "/",
        { kind: "comment", threadId: "" },
      ),
    ).toBeUndefined();
  });

  it("omits an empty repo and a root path on a valid target", () => {
    const url = new URL(
      assembleHubDeepLinkUrl(
        "https://dev.azure.com/org",
        "Proj",
        EXT,
        "",
        "/",
        {
          kind: "heading",
          anchor: "goals",
        },
      )!,
    );
    expect(url.searchParams.has("repo")).toBe(false);
    expect(url.searchParams.has("path")).toBe(false);
    expect(url.searchParams.get("anchor")).toBe("goals");
  });
});

describe("routeUpdatesForPath", () => {
  it("pins the repo and the slash-free path", () => {
    expect(routeUpdatesForPath({}, "r1", "/docs/a.md")).toEqual({
      repo: "r1",
      path: "docs/a.md",
      anchor: "",
      comment: "",
      text: "",
    });
    // Already slash-free: only leading slashes are ever stripped.
    expect(routeUpdatesForPath({}, "r1", "docs/a.md").path).toBe("docs/a.md");
  });

  it("keeps a deep link when re-publishing the same document", () => {
    // The hub publishes the deep-linked document on load; that must not wipe
    // the `?anchor=` / `?comment=` the recipient arrived with.
    expect(
      routeUpdatesForPath(
        { repo: "r1", path: "docs/a.md", anchor: "goals", comment: "42" },
        "r1",
        "/docs/a.md",
      ),
    ).toEqual({ repo: "r1", path: "docs/a.md" });
    // Leading slashes on either side don't make it a different document.
    expect(
      routeUpdatesForPath(
        { repo: "r1", path: "//docs/a.md", anchor: "goals" },
        "r1",
        "//docs/a.md",
      ),
    ).toEqual({ repo: "r1", path: "docs/a.md" });
  });

  it("drops the heading, text and comment when moving to a different document", () => {
    // A linked comment that never activated (deleted, or still loading) must
    // not ride along with the new path.
    expect(
      routeUpdatesForPath(
        { path: "docs/a.md", anchor: "goals", comment: "42" },
        "r1",
        "/docs/b.md",
      ),
    ).toEqual({
      repo: "r1",
      path: "docs/b.md",
      anchor: "",
      comment: "",
      text: "",
    });
  });

  it("drops the heading, text and comment when the same path opens in a different repo", () => {
    expect(
      routeUpdatesForPath(
        { repo: "r1", path: "README.md", anchor: "goals", comment: "42" },
        "r2",
        "/README.md",
      ),
    ).toEqual({
      repo: "r2",
      path: "README.md",
      anchor: "",
      comment: "",
      text: "",
    });
  });

  it("treats a link without ?repo= as naming the opened repo", () => {
    expect(
      routeUpdatesForPath(
        { path: "README.md", anchor: "goals" },
        "r2",
        "/README.md",
      ),
    ).toEqual({ repo: "r2", path: "README.md" });
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
