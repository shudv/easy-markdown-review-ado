// Tests for the pure deep-linking helpers. The React context plumbing
// (DeepLinkContext / useDeepLink) is exercised by the CommentRow, ArticleView,
// and PrShell stories; here we cover the URL read/write logic exhaustively.

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
    expect(out).toBe(
      "https://dev.azure.com/org/proj/_git/repo/pullrequest/4?comment=t-42",
    );
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
    const out = withDeepLinkTarget(
      "https://example.com/x#section",
      comment("t-1"),
    );
    expect(out).toBe("https://example.com/x?comment=t-1#section");
  });

  it("overwrites an existing comment param", () => {
    const out = withDeepLinkTarget(
      "https://example.com/x?comment=old",
      comment("new"),
    );
    expect(new URL(out!).searchParams.get("comment")).toBe("new");
  });

  it("drops a competing anchor param", () => {
    const out = withDeepLinkTarget(
      "https://example.com/x?anchor=goals",
      comment("t-2"),
    );
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

  it("returns undefined for an empty base URL", () => {
    expect(withDeepLinkTarget("", comment("t-1"))).toBeUndefined();
  });

  it("returns undefined for a blank thread id", () => {
    expect(
      withDeepLinkTarget("https://example.com/x", comment("   ")),
    ).toBeUndefined();
  });

  it("returns undefined for an unparseable base URL", () => {
    expect(withDeepLinkTarget("not a url", comment("t-1"))).toBeUndefined();
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
    const out = withDeepLinkTarget(
      "https://example.com/x?comment=t-1",
      heading("goals"),
    );
    const url = new URL(out!);
    expect(url.searchParams.has(COMMENT_LINK_PARAM)).toBe(false);
    expect(url.searchParams.get(ANCHOR_LINK_PARAM)).toBe("goals");
  });

  it("returns undefined for a blank anchor", () => {
    expect(
      withDeepLinkTarget("https://example.com/x", heading(" ")),
    ).toBeUndefined();
  });
});

describe("readCommentParam", () => {
  it("reads the comment param", () => {
    expect(readCommentParam({ comment: "t-42" })).toBe("t-42");
  });

  it("trims whitespace", () => {
    expect(readCommentParam({ comment: "  t-3  " })).toBe("t-3");
  });

  it("returns undefined when the param is absent", () => {
    expect(readCommentParam({ path: "docs/a.md" })).toBeUndefined();
  });

  it("returns undefined for a blank value", () => {
    expect(readCommentParam({ comment: "   " })).toBeUndefined();
  });

  it("returns undefined for a non-string value", () => {
    // The host can hand back odd shapes; guard defensively.
    expect(readCommentParam({ comment: undefined })).toBeUndefined();
  });

  it("returns undefined for null / undefined params", () => {
    expect(readCommentParam(null)).toBeUndefined();
    expect(readCommentParam(undefined)).toBeUndefined();
  });
});

describe("readAnchorParam", () => {
  it("reads the anchor param", () => {
    expect(readAnchorParam({ anchor: "classifiers-&-hashing" })).toBe(
      "classifiers-&-hashing",
    );
  });

  it("tolerates a leading # pasted from an in-page link", () => {
    expect(readAnchorParam({ anchor: "#goals" })).toBe("goals");
    expect(readAnchorParam({ anchor: "##goals" })).toBe("goals");
    // Only LEADING #s are stripped.
    expect(readAnchorParam({ anchor: "c#-notes" })).toBe("c#-notes");
  });

  it("returns undefined when absent, blank, or only #", () => {
    expect(readAnchorParam({})).toBeUndefined();
    expect(readAnchorParam({ anchor: "  " })).toBeUndefined();
    expect(readAnchorParam({ anchor: "#" })).toBeUndefined();
    expect(readAnchorParam(null)).toBeUndefined();
  });
});

describe("readPathParam", () => {
  it("normalises the slash-free hub form to a repo-rooted path", () => {
    expect(readPathParam({ path: "docs/a.md" })).toBe("/docs/a.md");
  });

  it("keeps ADO's leading-slash form (collapsing repeats)", () => {
    expect(readPathParam({ path: "/docs/a.md" })).toBe("/docs/a.md");
    expect(readPathParam({ path: "//docs/a.md" })).toBe("/docs/a.md");
  });

  it("returns undefined when absent, blank, or only slashes", () => {
    expect(readPathParam({})).toBeUndefined();
    expect(readPathParam({ path: " " })).toBeUndefined();
    expect(readPathParam({ path: "/" })).toBeUndefined();
    expect(readPathParam(undefined)).toBeUndefined();
  });
});

describe("withDeepLinkTarget — text", () => {
  const BASE =
    "https://dev.azure.com/o/p/_git/r/pullrequest/4?_a=x&comment=t-1&path=%2Fa.md";

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

  it("returns undefined for blank text", () => {
    expect(
      withDeepLinkTarget(BASE, { kind: "text", text: "  ", anchor: "goals" }),
    ).toBeUndefined();
  });

  it("drops a text param when linking a heading", () => {
    const url = new URL(
      withDeepLinkTarget(`${BASE}&text=x`, { kind: "heading", anchor: "g" })!,
    );
    expect(url.searchParams.has(TEXT_LINK_PARAM)).toBe(false);
  });
});

describe("readTextParam", () => {
  it("reads a trimmed text param", () => {
    expect(readTextParam({ text: " pre-,quote " })).toBe("pre-,quote");
  });

  it("returns undefined when absent or blank", () => {
    expect(readTextParam({})).toBeUndefined();
    expect(readTextParam({ text: "  " })).toBeUndefined();
    expect(readTextParam(null)).toBeUndefined();
  });
});
