import { describe, expect, it } from "vitest";

import {
  changedMarkdownFiles,
  commentAuthorFromUser,
  contentCommitForPath,
  prBranchVersion,
  splitFileDiffs,
} from "../src/pr-tab/prContext.helpers";
import { identityAvatarUrl } from "../src/shell/adoGitData.helpers";
import type { FileInfo } from "../src/types";

describe("changedMarkdownFiles", () => {
  it("keeps only Markdown changes, maps change types, and sorts by path", () => {
    expect(
      changedMarkdownFiles([
        { item: { path: "/docs/z.md" }, changeType: 2 },
        { item: { path: "/src/app.ts" }, changeType: 2 },
        { item: { path: "" }, originalPath: "/docs/gone.md", changeType: 16 },
        { item: { path: "/docs/a.MD" }, changeType: 1 },
      ]),
    ).toEqual([
      {
        path: "/docs/a.MD",
        changeType: "added",
        linesAdded: 0,
        linesDeleted: 0,
      },
      {
        path: "/docs/gone.md",
        changeType: "deleted",
        linesAdded: 0,
        linesDeleted: 0,
      },
      {
        path: "/docs/z.md",
        changeType: "modified",
        linesAdded: 0,
        linesDeleted: 0,
      },
    ]);
  });

  it("returns an empty list when nothing changed", () => {
    expect(changedMarkdownFiles([])).toEqual([]);
  });
});

describe("contentCommitForPath", () => {
  const files: FileInfo[] = [
    { path: "/a.md", changeType: "modified", linesAdded: 0, linesDeleted: 0 },
    { path: "/b.md", changeType: "deleted", linesAdded: 0, linesDeleted: 0 },
  ];

  const pr = {
    lastMergeTargetCommit: { commitId: "pr-target" },
    lastMergeSourceCommit: { commitId: "pr-source" },
  } as Parameters<typeof contentCommitForPath>[0]["pr"];

  it("reads changed files from the diff target and deleted ones from the base", () => {
    const ctx = {
      changedMdFiles: files,
      baseCommit: "base",
      targetCommit: "target",
      pr,
    };

    expect(contentCommitForPath(ctx, "/a.md")).toBe("target");
    expect(contentCommitForPath(ctx, "/b.md")).toBe("base");
    expect(contentCommitForPath(ctx, "/unknown.md")).toBe("target");
  });

  it("falls back to the PR's last-merge commits", () => {
    const ctx = { changedMdFiles: files, pr };
    expect(contentCommitForPath(ctx, "/a.md")).toBe("pr-source");
    expect(contentCommitForPath(ctx, "/b.md")).toBe("pr-target");
  });

  it("is undefined when no commit is known", () => {
    const ctx = {
      changedMdFiles: files,
      pr: {} as typeof pr,
    };

    expect(contentCommitForPath(ctx, "/a.md")).toBeUndefined();
    expect(contentCommitForPath(ctx, "/b.md")).toBeUndefined();
  });
});

describe("splitFileDiffs", () => {
  it("keeps non-empty ranges and present original sources", () => {
    const range = { startLine: 1, endLine: 2, kind: "added" } as never;
    expect(
      splitFileDiffs({
        "/a.md": { ranges: [range], originalSource: "old a" },
        "/b.md": { ranges: [] },
        "/c.md": { ranges: [], originalSource: "" },
      }),
    ).toEqual({
      diffs: { "/a.md": [range] },
      originalSources: { "/a.md": "old a", "/c.md": "" },
    });
  });
});

describe("commentAuthorFromUser", () => {
  it("maps the SDK user to a comment author", () => {
    const user = {
      id: "u1",
      displayName: "Ada Lovelace",
      imageUrl: "https://dev.azure.com/org/_api/_common/identityImage?id=u1",
    };

    expect(commentAuthorFromUser(user)).toEqual({
      id: "u1",
      displayName: "Ada Lovelace",
      initials: "AL",
      avatarUrl: identityAvatarUrl(user),
    });
  });
});

describe("prBranchVersion", () => {
  it("names the PR source branch as a Files version", () => {
    expect(prBranchVersion({ sourceRefName: "refs/heads/feature/x" })).toBe(
      "GBfeature/x",
    );
    expect(prBranchVersion({ sourceRefName: "topic" })).toBe("GBtopic");
  });

  it("is undefined without a source branch", () => {
    expect(prBranchVersion({})).toBeUndefined();
  });
});
