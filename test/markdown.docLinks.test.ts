// Unit tests for relative doc-link resolution + the Repos file-URL builder.

import { describe, expect, it } from "vitest";

import {
  buildReposFileUrl,
  resolveDocLink,
  routeDocLink,
  samePath,
  type DocLinkContext,
} from "../src/markdown/docLinks";

describe("resolveDocLink", () => {
  const from = "/docs/design.md";

  it("treats empty, scheme, and protocol-relative hrefs as external", () => {
    for (const href of [
      "",
      "   ",
      "https://example.com/x",
      "http://example.com",
      "mailto:a@b.com",
      "mention://user/ann",
      "tel:+15555550100",
      "//cdn.example.com/a",
    ]) {
      expect(resolveDocLink(from, href)).toEqual({ kind: "external" });
    }
  });

  it("returns a pure in-page fragment as an anchor", () => {
    expect(resolveDocLink(from, "#goals")).toEqual({
      kind: "anchor",
      hash: "goals",
    });
  });

  it("resolves a bare sibling filename against the current folder", () => {
    expect(resolveDocLink(from, "other.md")).toEqual({
      kind: "repo-file",
      path: "/docs/other.md",
      hash: "",
      isMarkdown: true,
    });
  });

  it("resolves a `./` sibling link", () => {
    expect(resolveDocLink(from, "./sibling.md")).toMatchObject({
      path: "/docs/sibling.md",
      isMarkdown: true,
    });
  });

  it("resolves `../` parent traversal", () => {
    expect(resolveDocLink(from, "../api/rest.md")).toMatchObject({
      path: "/api/rest.md",
    });
    // Extra `..` past the root simply clamps at the root.
    expect(resolveDocLink(from, "../../../x.md")).toMatchObject({
      path: "/x.md",
    });
  });

  it("resolves a repo-root-absolute link", () => {
    expect(resolveDocLink(from, "/team/onboarding/setup.md")).toMatchObject({
      path: "/team/onboarding/setup.md",
      isMarkdown: true,
    });
  });

  it("preserves a heading fragment", () => {
    expect(resolveDocLink(from, "./design.md#the-plan")).toEqual({
      kind: "repo-file",
      path: "/docs/design.md",
      hash: "the-plan",
      isMarkdown: true,
    });
  });

  it("strips a query string from the path", () => {
    expect(resolveDocLink(from, "./x.md?version=GBmain#h")).toMatchObject({
      path: "/docs/x.md",
      hash: "h",
    });
  });

  it("flags a non-Markdown target", () => {
    expect(resolveDocLink(from, "../assets/diagram.png")).toMatchObject({
      path: "/assets/diagram.png",
      isMarkdown: false,
    });
    expect(resolveDocLink(from, "/src/index.ts")).toMatchObject({
      isMarkdown: false,
    });
  });

  it("treats `.markdown` (any case) as Markdown", () => {
    expect(resolveDocLink(from, "./NOTES.MARKDOWN")).toMatchObject({
      isMarkdown: true,
    });
  });

  it("treats a lone `?query` href (no path) as external", () => {
    expect(resolveDocLink(from, "?tab=readme")).toEqual({ kind: "external" });
  });

  it("treats a `?query#frag` href with no path as an anchor", () => {
    expect(resolveDocLink(from, "?a=b#frag")).toEqual({
      kind: "anchor",
      hash: "frag",
    });
  });

  it("decodes percent-encoded paths, tolerating malformed encoding", () => {
    expect(resolveDocLink(from, "./my%20doc.md")).toMatchObject({
      path: "/docs/my doc.md",
    });
    // A malformed `%` sequence is kept verbatim rather than throwing.
    expect(resolveDocLink(from, "./bad%zz.md")).toMatchObject({
      path: "/docs/bad%zz.md",
    });
  });

  it("resolves relative to a root-level document (no folder)", () => {
    expect(resolveDocLink("/README.md", "docs/guide.md")).toMatchObject({
      path: "/docs/guide.md",
    });
  });

  it("only treats a scheme at the START of the href as external", () => {
    // A colon later in a relative path must NOT be read as a scheme: the
    // leading `./` keeps it an in-repo link, not an external URL.
    expect(resolveDocLink(from, "./notes:v2.md")).toMatchObject({
      kind: "repo-file",
      path: "/docs/notes:v2.md",
      isMarkdown: true,
    });
  });

  it("only treats a .md/.markdown suffix at the END as Markdown", () => {
    expect(resolveDocLink(from, "./archive.md.txt")).toMatchObject({
      kind: "repo-file",
      path: "/docs/archive.md.txt",
      isMarkdown: false,
    });
  });

  it("strips an empty trailing fragment, keeping the repo file", () => {
    expect(resolveDocLink(from, "guide#")).toMatchObject({
      kind: "repo-file",
      path: "/docs/guide",
      hash: "",
    });
  });
});

describe("buildReposFileUrl", () => {
  it("builds an absolute Files URL with an encoded path", () => {
    expect(
      buildReposFileUrl(
        "https://dev.azure.com/org",
        "My Proj",
        "My Repo",
        "/docs/x.md",
      ),
    ).toBe(
      "https://dev.azure.com/org/My%20Proj/_git/My%20Repo?path=%2Fdocs%2Fx.md",
    );
  });

  it("adds a version when supplied and trims a trailing slash from orgUrl", () => {
    expect(
      buildReposFileUrl(
        "https://dev.azure.com/org/",
        "Proj",
        "Repo",
        "/a.md",
        "GBmain",
      ),
    ).toBe(
      "https://dev.azure.com/org/Proj/_git/Repo?path=%2Fa.md&version=GBmain",
    );
  });

  it("collapses multiple trailing slashes on the org URL", () => {
    expect(
      buildReposFileUrl("https://dev.azure.com/org//", "Proj", "Repo", "/a.md"),
    ).toBe("https://dev.azure.com/org/Proj/_git/Repo?path=%2Fa.md");
  });
});

describe("samePath", () => {
  it("ignores leading slashes and case", () => {
    expect(samePath("/docs/X.md", "docs/x.md")).toBe(true);
    expect(samePath("/a.md", "/b.md")).toBe(false);
    // All leading slashes are stripped before comparing, not just the first.
    expect(samePath("//docs/x.md", "/docs/x.md")).toBe(true);
  });
});

describe("routeDocLink", () => {
  const ctx = (over: Partial<DocLinkContext> = {}): DocLinkContext => ({
    isHub: false,
    currentPath: "/docs/design.md",
    isInReader: () => false,
    ...over,
  });
  const md = (path: string, hash = "") =>
    ({ kind: "repo-file", path, hash, isMarkdown: true }) as const;

  it("passes external links through", () => {
    expect(routeDocLink({ kind: "external" }, ctx())).toEqual({
      type: "external",
    });
  });

  it("scrolls for an in-page anchor", () => {
    expect(routeDocLink({ kind: "anchor", hash: "goals" }, ctx())).toEqual({
      type: "scroll",
      hash: "goals",
    });
  });

  it("opens a non-Markdown file in native Files", () => {
    expect(
      routeDocLink(
        { kind: "repo-file", path: "/a.png", hash: "", isMarkdown: false },
        ctx(),
      ),
    ).toEqual({ type: "open-file", path: "/a.png" });
  });

  it("scrolls when a Markdown link points back at the current doc", () => {
    expect(routeDocLink(md("/docs/DESIGN.md", "sec"), ctx())).toEqual({
      type: "scroll",
      hash: "sec",
    });
  });

  it("selects a PR file in place", () => {
    expect(
      routeDocLink(
        md("/docs/other.md", "h"),
        ctx({ isInReader: (p) => p === "/docs/other.md" }),
      ),
    ).toEqual({ type: "select", path: "/docs/other.md", hash: "h" });
  });

  it("always selects in the hub, even for a file not yet in the tree", () => {
    expect(routeDocLink(md("/deep/x.md"), ctx({ isHub: true }))).toEqual({
      type: "select",
      path: "/deep/x.md",
      hash: "",
    });
  });

  it("opens the hub for a Markdown file outside the PR", () => {
    expect(routeDocLink(md("/elsewhere/y.md", "z"), ctx())).toEqual({
      type: "open-hub",
      path: "/elsewhere/y.md",
      hash: "z",
    });
  });
});
