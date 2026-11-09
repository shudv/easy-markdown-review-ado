// Tests for the pure deep-linking helpers. The React context plumbing
// (DeepLinkContext / useDeepLink) is exercised by the CommentRow, ArticleView,
// and Shell stories; here we cover the URL read/write logic exhaustively.

import { describe, expect, it } from "vitest";

import {
    ANCHOR_LINK_PARAM,
    COMMENT_LINK_PARAM,
    readAnchorParam,
    readCommentParam,
    readPathParam,
    readTextParam,
    TEXT_LINK_PARAM,
    withDeepLinkTarget,
} from "../src/shell/deepLink";

const comment = (threadId: string) => ({ kind: "comment" as const, threadId });
const heading = (anchor: string) => ({ kind: "heading" as const, anchor });

describe("withDeepLinkTarget — comment", () => {
    it("appends the comment param to a bare URL", () => {
        const out = withDeepLinkTarget(
            "https://dev.azure.com/org/proj/_git/repo/pullrequest/4",
            comment("t-42"),
        );

        expect(out).toBe("https://dev.azure.com/org/proj/_git/repo/pullrequest/4?comment=t-42");
    });

    it("preserves existing query params and appends comment", () => {
        const out = withDeepLinkTarget(
            "https://dev.azure.com/org/proj/_apps/hub/pub.ext.documents-hub?path=docs%2Fa.md",
            comment("t-7"),
        );

        const url = new URL(out!);
        expect(url.searchParams.get("path")).toBe("docs/a.md");
        expect(url.searchParams.get(COMMENT_LINK_PARAM)).toBe("t-7");
    });

    it("preserves the hash fragment", () => {
        const out = withDeepLinkTarget("https://example.com/x#section", comment("t-1"));

        expect(out).toBe("https://example.com/x?comment=t-1#section");
    });

    it("overwrites an existing comment param", () => {
        const out = withDeepLinkTarget("https://example.com/x?comment=old", comment("new"));

        expect(new URL(out!).searchParams.get("comment")).toBe("new");
    });

    it("drops a competing anchor param", () => {
        const out = withDeepLinkTarget("https://example.com/x?anchor=goals", comment("t-2"));

        const url = new URL(out!);
        expect(url.searchParams.has(ANCHOR_LINK_PARAM)).toBe(false);
        expect(url.searchParams.get(COMMENT_LINK_PARAM)).toBe("t-2");
    });

    it("url-encodes the thread id", () => {
        const out = withDeepLinkTarget("https://example.com/x", comment("t 4/2"));

        expect(new URL(out!).searchParams.get("comment")).toBe("t 4/2");
        expect(out).toContain("comment=t+4%2F2");
    });

    it("trims surrounding whitespace from the thread id", () => {
        const out = withDeepLinkTarget("https://example.com/x", comment("  t-9  "));

        expect(new URL(out!).searchParams.get("comment")).toBe("t-9");
    });

    it.each([
        { name: "an empty base URL", base: "", threadId: "t-1" },
        { name: "a blank thread id", base: "https://example.com/x", threadId: "   " },
        { name: "an unparseable base URL", base: "not a url", threadId: "t-1" },
    ])("offers no link for $name", ({ base, threadId }) => {
        expect(withDeepLinkTarget(base, comment(threadId))).toBeUndefined();
    });
});

describe("withDeepLinkTarget — heading", () => {
    it("sets the anchor param and keeps the document path", () => {
        const out = withDeepLinkTarget(
            "https://dev.azure.com/org/proj/_git/repo/pullrequest/4?_a=pub.ext.markdown-review-pr-tab&path=%2Fdocs%2Fglossary.md",
            heading("classifiers-hashing"),
        );

        const url = new URL(out!);
        expect(url.searchParams.get("_a")).toBe("pub.ext.markdown-review-pr-tab");
        expect(url.searchParams.get("path")).toBe("/docs/glossary.md");
        expect(url.searchParams.get(ANCHOR_LINK_PARAM)).toBe("classifiers-hashing");
    });

    it("drops a competing comment param", () => {
        const out = withDeepLinkTarget("https://example.com/x?comment=t-1", heading("goals"));

        const url = new URL(out!);
        expect(url.searchParams.has(COMMENT_LINK_PARAM)).toBe(false);
        expect(url.searchParams.get(ANCHOR_LINK_PARAM)).toBe("goals");
    });

    it("returns undefined for a blank anchor", () => {
        expect(withDeepLinkTarget("https://example.com/x", heading(" "))).toBeUndefined();
    });
});

describe("readCommentParam", () => {
    it("reads the comment param", () => {
        expect(readCommentParam({ comment: "t-42" })).toBe("t-42");
    });

    it("trims whitespace", () => {
        expect(readCommentParam({ comment: "  t-3  " })).toBe("t-3");
    });

    // The host can hand back odd shapes, so each of these must read as "no target".
    it.each([
        { name: "the param is absent", params: { path: "docs/a.md" } },
        { name: "the value is blank", params: { comment: "   " } },
        { name: "the value is not a string", params: { comment: undefined } },
        { name: "the params are null", params: null },
        { name: "there are no params", params: undefined },
    ])("finds no comment when $name", ({ params }) => {
        expect(readCommentParam(params)).toBeUndefined();
    });
});

describe("readAnchorParam", () => {
    it("reads the anchor param", () => {
        expect(readAnchorParam({ anchor: "classifiers-&-hashing" })).toBe("classifiers-&-hashing");
    });

    it.each([
        { name: "a leading # pasted from an in-page link", anchor: "#goals", expected: "goals" },
        { name: "repeated leading #s", anchor: "##goals", expected: "goals" },
        { name: "a # inside the anchor, kept", anchor: "c#-notes", expected: "c#-notes" },
    ])("tolerates $name", ({ anchor, expected }) => {
        expect(readAnchorParam({ anchor })).toBe(expected);
    });

    it.each([
        { name: "the param is absent", params: {} },
        { name: "the value is blank", params: { anchor: "  " } },
        { name: "the value is only #", params: { anchor: "#" } },
        { name: "the params are null", params: null },
    ])("finds no anchor when $name", ({ params }) => {
        expect(readAnchorParam(params)).toBeUndefined();
    });
});

describe("readPathParam", () => {
    it("normalises the slash-free hub form to a repo-rooted path", () => {
        expect(readPathParam({ path: "docs/a.md" })).toBe("/docs/a.md");
    });

    it.each([
        { name: "keeps ADO's leading-slash form", path: "/docs/a.md" },
        { name: "collapses repeated leading slashes", path: "//docs/a.md" },
    ])("$name", ({ path }) => {
        expect(readPathParam({ path })).toBe("/docs/a.md");
    });

    it.each([
        { name: "the param is absent", params: {} },
        { name: "the value is blank", params: { path: " " } },
        { name: "the value is only a slash", params: { path: "/" } },
        { name: "there are no params", params: undefined },
    ])("finds no path when $name", ({ params }) => {
        expect(readPathParam(params)).toBeUndefined();
    });
});

describe("withDeepLinkTarget — text", () => {
    const BASE = "https://dev.azure.com/o/p/_git/r/pullrequest/4?_a=x&comment=t-1&path=%2Fa.md";

    it("sets text plus its section fallback, dropping a competing comment", () => {
        const url = new URL(
            withDeepLinkTarget(BASE, {
                kind: "text",
                text: " blocks deploys ",
                anchor: " goals ",
            })!,
        );

        expect(url.searchParams.get(TEXT_LINK_PARAM)).toBe("blocks deploys");
        expect(url.searchParams.get(ANCHOR_LINK_PARAM)).toBe("goals");
        expect(url.searchParams.has(COMMENT_LINK_PARAM)).toBe(false);
        expect(url.searchParams.get("path")).toBe("/a.md");
        // Spaces are percent-encoded, never form-style `+`; a literal `+` survives.
        expect(url.search).toContain("text=blocks%20deploys");
        expect(url.search).not.toContain("+");
    });

    it("omits a blank section fallback and keeps a literal +", () => {
        const url = new URL(
            withDeepLinkTarget(`${BASE}&anchor=old`, {
                kind: "text",
                text: "a + b",
                anchor: "  ",
            })!,
        );

        expect(url.searchParams.get(TEXT_LINK_PARAM)).toBe("a + b");
        expect(url.searchParams.has(ANCHOR_LINK_PARAM)).toBe(false);
    });

    it("links text that sits before any heading, with no section fallback", () => {
        const url = new URL(
            withDeepLinkTarget(`${BASE}&anchor=old`, {
                kind: "text",
                text: "opening words",
            })!,
        );

        expect(url.searchParams.get(TEXT_LINK_PARAM)).toBe("opening words");
        expect(url.searchParams.has(ANCHOR_LINK_PARAM)).toBe(false);
    });

    it("returns undefined for blank text", () => {
        expect(
            withDeepLinkTarget(BASE, {
                kind: "text",
                text: "  ",
                anchor: "goals",
            }),
        ).toBeUndefined();
    });

    it("drops a text param when linking a heading", () => {
        const url = new URL(
            withDeepLinkTarget(`${BASE}&text=x`, {
                kind: "heading",
                anchor: "g",
            })!,
        );

        expect(url.searchParams.has(TEXT_LINK_PARAM)).toBe(false);
    });
});

describe("readTextParam", () => {
    it("reads a trimmed text param", () => {
        expect(readTextParam({ text: " pre-,quote " })).toBe("pre-,quote");
    });

    it.each([
        { name: "the param is absent", params: {} },
        { name: "the value is blank", params: { text: "  " } },
        { name: "the params are null", params: null },
    ])("finds no text when $name", ({ params }) => {
        expect(readTextParam(params)).toBeUndefined();
    });
});
