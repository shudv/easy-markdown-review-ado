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

    it.each([
        { name: "an empty href", href: "" },
        { name: "a whitespace-only href", href: "   " },
        { name: "an https URL", href: "https://example.com/x" },
        { name: "an http URL", href: "http://example.com" },
        { name: "a mailto: link", href: "mailto:a@b.com" },
        { name: "a mention link", href: "mention://user/ann" },
        { name: "a tel: link", href: "tel:+15555550100" },
        { name: "a protocol-relative URL", href: "//cdn.example.com/a" },
    ])("treats $name as external", ({ href }) => {
        expect(resolveDocLink(from, href)).toEqual({ kind: "external" });
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
    });

    it("stops `../` traversal at the repository root", () => {
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

    it.each([
        { name: "an image", href: "../assets/diagram.png", path: "/assets/diagram.png" },
        { name: "a source file", href: "/src/index.ts", path: "/src/index.ts" },
        {
            name: "a file whose name only contains `.md`",
            href: "./archive.md.txt",
            path: "/docs/archive.md.txt",
        },
    ])("flags $name as a non-Markdown repo file", ({ href, path }) => {
        expect(resolveDocLink(from, href)).toEqual({
            kind: "repo-file",
            path,
            hash: "",
            isMarkdown: false,
        });
    });

    it("treats `.markdown` (any case) as Markdown", () => {
        expect(resolveDocLink(from, "./NOTES.MARKDOWN")).toMatchObject({
            isMarkdown: true,
        });
    });

    it("treats a lone `?query` href (no path) as external", () => {
        expect(resolveDocLink(from, "?tab=readme")).toEqual({
            kind: "external",
        });
    });

    it("treats a `?query#frag` href with no path as an anchor", () => {
        expect(resolveDocLink(from, "?a=b#frag")).toEqual({
            kind: "anchor",
            hash: "frag",
        });
    });

    it("decodes percent-encoded paths", () => {
        expect(resolveDocLink(from, "./my%20doc.md")).toMatchObject({
            path: "/docs/my doc.md",
        });
    });

    it("keeps a malformed percent sequence verbatim instead of failing", () => {
        expect(resolveDocLink(from, "./bad%zz.md")).toMatchObject({
            path: "/docs/bad%zz.md",
        });
    });

    it("resolves relative to a root-level document (no folder)", () => {
        expect(resolveDocLink("/README.md", "docs/guide.md")).toMatchObject({
            path: "/docs/guide.md",
        });
    });

    it("keeps a relative file name containing a colon as an in-repo link", () => {
        expect(resolveDocLink(from, "./notes:v2.md")).toMatchObject({
            kind: "repo-file",
            path: "/docs/notes:v2.md",
            isMarkdown: true,
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
                {
                    orgUrl: "https://dev.azure.com/org",
                    project: "My Proj",
                    repoName: "My Repo",
                },
                "/docs/x.md",
            ),
        ).toBe("https://dev.azure.com/org/My%20Proj/_git/My%20Repo?path=%2Fdocs%2Fx.md");
    });

    it("adds a version when supplied and trims a trailing slash from orgUrl", () => {
        expect(
            buildReposFileUrl(
                {
                    orgUrl: "https://dev.azure.com/org/",
                    project: "Proj",
                    repoName: "Repo",
                },
                "/a.md",
                "GBmain",
            ),
        ).toBe("https://dev.azure.com/org/Proj/_git/Repo?path=%2Fa.md&version=GBmain");
    });

    it("collapses multiple trailing slashes on the org URL", () => {
        expect(
            buildReposFileUrl(
                {
                    orgUrl: "https://dev.azure.com/org//",
                    project: "Proj",
                    repoName: "Repo",
                },
                "/a.md",
            ),
        ).toBe("https://dev.azure.com/org/Proj/_git/Repo?path=%2Fa.md");
    });
});

describe("samePath", () => {
    it.each([
        { name: "differ only in letter case", a: "/docs/X.md", b: "/docs/x.md", expected: true },
        { name: "differ only by a leading slash", a: "/docs/x.md", b: "docs/x.md", expected: true },
        {
            name: "differ by several leading slashes",
            a: "//docs/x.md",
            b: "/docs/x.md",
            expected: true,
        },
        { name: "name different files", a: "/a.md", b: "/b.md", expected: false },
    ])("returns $expected for paths that $name", ({ a, b, expected }) => {
        expect(samePath(a, b)).toBe(expected);
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
                {
                    kind: "repo-file",
                    path: "/a.png",
                    hash: "",
                    isMarkdown: false,
                },
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
