// Tests for the pure comment deep-linking helpers. The React context plumbing
// (CommentLinkContext / useCommentLink) is exercised by the CommentRow and
// PrShell stories; here we cover the URL read/write logic exhaustively.

import { describe, expect, it } from "vitest";

import {
  COMMENT_LINK_PARAM,
  readCommentParam,
  withCommentParam,
} from "../src/comments/commentLink";

describe("withCommentParam", () => {
  it("appends the comment param to a bare URL", () => {
    const out = withCommentParam(
      "https://dev.azure.com/org/proj/_git/repo/pullrequest/4",
      "t-42",
    );
    expect(out).toBe(
      "https://dev.azure.com/org/proj/_git/repo/pullrequest/4?comment=t-42",
    );
  });

  it("preserves existing query params and appends comment", () => {
    const out = withCommentParam(
      "https://dev.azure.com/org/proj/_apps/hub/pub.ext.documents-hub?path=docs%2Fa.md",
      "t-7",
    );
    const url = new URL(out!);
    expect(url.searchParams.get("path")).toBe("docs/a.md");
    expect(url.searchParams.get(COMMENT_LINK_PARAM)).toBe("t-7");
  });

  it("preserves the hash fragment", () => {
    const out = withCommentParam("https://example.com/x#section", "t-1");
    expect(out).toBe("https://example.com/x?comment=t-1#section");
  });

  it("overwrites an existing comment param", () => {
    const out = withCommentParam("https://example.com/x?comment=old", "new");
    expect(new URL(out!).searchParams.get("comment")).toBe("new");
  });

  it("url-encodes the thread id", () => {
    const out = withCommentParam("https://example.com/x", "t 4/2");
    expect(new URL(out!).searchParams.get("comment")).toBe("t 4/2");
    expect(out).toContain("comment=t+4%2F2");
  });

  it("trims surrounding whitespace from the thread id", () => {
    const out = withCommentParam("https://example.com/x", "  t-9  ");
    expect(new URL(out!).searchParams.get("comment")).toBe("t-9");
  });

  it("returns undefined for an empty base URL", () => {
    expect(withCommentParam("", "t-1")).toBeUndefined();
  });

  it("returns undefined for a blank thread id", () => {
    expect(withCommentParam("https://example.com/x", "   ")).toBeUndefined();
  });

  it("returns undefined for an unparseable base URL", () => {
    expect(withCommentParam("not a url", "t-1")).toBeUndefined();
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
