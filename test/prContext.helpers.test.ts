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
                {
                    item: { path: "" },
                    originalPath: "/docs/gone.md",
                    changeType: 16,
                },
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

    it("keeps the blob each file shows: the new one, or a deleted file's last one", () => {
        const files = changedMarkdownFiles([
            { item: { path: "/a.md", objectId: "NEW1", originalObjectId: "OLD1" }, changeType: 2 },
            {
                item: { path: "", originalObjectId: "OLD2" },
                originalPath: "/gone.md",
                changeType: 16,
            },
            { item: { path: "/c.md", objectId: "" }, changeType: 1 },
        ]);

        expect(files.map((f) => [f.path, f.objectId])).toEqual([
            ["/a.md", "NEW1"],
            ["/c.md", undefined],
            ["/gone.md", "OLD2"],
        ]);
        expect(files[1]).not.toHaveProperty("objectId");
    });
});

describe("contentCommitForPath", () => {
    const files: FileInfo[] = [
        {
            path: "/a.md",
            changeType: "modified",
            linesAdded: 0,
            linesDeleted: 0,
        },
        {
            path: "/b.md",
            changeType: "deleted",
            linesAdded: 0,
            linesDeleted: 0,
        },
    ];

    const pr = {
        lastMergeTargetCommit: { commitId: "pr-target" },
        lastMergeSourceCommit: { commitId: "pr-source" },
    } as Parameters<typeof contentCommitForPath>[0]["pr"];

    it.each([
        { name: "a changed file from the diff target", path: "/a.md", expected: "target" },
        { name: "a deleted file from the diff base", path: "/b.md", expected: "base" },
        { name: "an unchanged file from the diff target", path: "/unknown.md", expected: "target" },
    ])("reads $name", ({ path, expected }) => {
        const ctx = { changedMdFiles: files, baseCommit: "base", targetCommit: "target", pr };

        expect(contentCommitForPath(ctx, path)).toBe(expected);
    });

    it.each([
        { name: "a changed file from the PR's source", path: "/a.md", expected: "pr-source" },
        { name: "a deleted file from the PR's target", path: "/b.md", expected: "pr-target" },
    ])("without diff commits, reads $name", ({ path, expected }) => {
        expect(contentCommitForPath({ changedMdFiles: files, pr }, path)).toBe(expected);
    });

    it.each(["/a.md", "/b.md"])("has no commit for %s when none is known", (path) => {
        const ctx = { changedMdFiles: files, pr: {} as typeof pr };

        expect(contentCommitForPath(ctx, path)).toBeUndefined();
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
    it.each([
        ["refs/heads/feature/x", "GBfeature/x"],
        ["topic", "GBtopic"],
    ])("names the PR source branch %s as the Files version %s", (sourceRefName, expected) => {
        expect(prBranchVersion({ sourceRefName })).toBe(expected);
    });

    it("is undefined without a source branch", () => {
        expect(prBranchVersion({} as Parameters<typeof prBranchVersion>[0])).toBeUndefined();
    });
});
