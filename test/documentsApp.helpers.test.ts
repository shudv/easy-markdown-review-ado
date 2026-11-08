import { describe, expect, it } from "vitest";

import {
    buildMentionLinks,
    buildRoutedPr,
    buildSyntheticPr,
    menuFocusTarget,
    mergeFolderListing,
    pickDeepLinkSeeds,
    pickSelectedRepo,
    resolveCommentGating,
    resolveShellTree,
    seedLazyTree,
    type LazyTreeState,
} from "../src/hub/documentsApp.helpers";
import { COMMENT_PERMISSION_DENIED_MESSAGE } from "../src/shell/commentPermission.helpers";
import type { DocRepo } from "../src/shell/types";
import type { FileInfo } from "../src/types";

function file(path: string): FileInfo {
    return { path } as FileInfo;
}

function repo(overrides: Partial<DocRepo> = {}): DocRepo {
    return {
        id: "r1",
        name: "Repo One",
        description: "",
        defaultBranch: "main",
        files: [],
        recentPr: null,
        ...overrides,
    };
}

const recentPr = {
    id: 7,
    title: "Docs update",
    author: "Ada",
    status: "completed" as const,
    url: "https://example/pr/7",
};

describe("seedLazyTree", () => {
    it("seeds files, the top-level folders to expand, and the root order", () => {
        const r = repo({
            files: [file("a.md")],
            topLevelFolders: ["docs"],
            rootOrder: ["a"],
        });

        expect(seedLazyTree(r)).toEqual({
            repoId: "r1",
            files: [file("a.md")],
            unloadedFolders: ["docs"],
            folderOrders: { "": ["a"] },
        });
    });

    it("defaults missing folders and order to empty", () => {
        expect(seedLazyTree(repo())).toEqual({
            repoId: "r1",
            files: [],
            unloadedFolders: [],
            folderOrders: {},
        });
    });
});

describe("mergeFolderListing", () => {
    const entry: LazyTreeState = {
        repoId: "r1",
        files: [file("z.md"), file("docs/b.md")],
        unloadedFolders: ["/docs", "other"],
        folderOrders: { "": ["z"] },
    };

    it("merges new files (deduped, sorted) and canonicalizes folders", () => {
        const next = mergeFolderListing(entry, "r1", "/docs", {
            files: [file("docs/b.md"), file("docs/a.md"), file("docs/a.md")],
            folders: ["/docs/sub", "docs/sub", "/other"],
        });

        expect(next.repoId).toBe("r1");
        expect(next.files.map((f) => f.path)).toEqual(["docs/a.md", "docs/b.md", "z.md"]);
        expect(next.unloadedFolders).toEqual(["docs/sub", "other"]);
        expect(next.folderOrders).toEqual({ "": ["z"] });
        // The input entry is untouched.
        expect(entry.files.map((f) => f.path)).toEqual(["z.md", "docs/b.md"]);
    });

    it("records the expanded folder's wiki order under its normalized path", () => {
        const next = mergeFolderListing(entry, "r1", "/docs/", {
            files: [],
            folders: [],
            order: ["b", "a"],
        });

        expect(next.folderOrders).toEqual({ "": ["z"], docs: ["b", "a"] });
    });
});

describe("pickSelectedRepo", () => {
    const a = repo({ id: "a" });
    const b = repo({ id: "b" });

    it("returns the matching repo from the list", () => {
        expect(pickSelectedRepo([a, b], "b", undefined)).toBe(b);
    });

    it("keeps the cached repo when it drops out of the list", () => {
        expect(pickSelectedRepo([a], "b", b)).toBe(b);
    });

    it.each([
        { name: "a different repo was open before", cached: b },
        { name: "no repo was open before", cached: undefined },
    ])("falls back to the first repo for an unknown id when $name", ({ cached }) => {
        expect(pickSelectedRepo([a], "x", cached)).toBe(a);
    });

    it("selects nothing in a project without repos", () => {
        expect(pickSelectedRepo([], "x", undefined)).toBeUndefined();
    });
});

describe("buildSyntheticPr", () => {
    it("uses the lazy tree's files and the recent PR's details", () => {
        const r = repo({ files: [file("root.md")], recentPr });

        const pr = buildSyntheticPr(r, {
            repoId: "r1",
            files: [file("b.md"), file("a.md")],
            unloadedFolders: [],
            folderOrders: {},
        });

        expect(pr).toEqual({
            prId: 7,
            title: "Documents in Repo One",
            authorName: "Ada",
            files: [file("b.md"), file("a.md")],
        });
    });

    it("falls back to repo files and placeholder PR fields", () => {
        const pr = buildSyntheticPr(repo({ files: [file("root.md")] }), undefined);

        expect(pr).toEqual({
            prId: 0,
            title: "Documents in Repo One",
            authorName: "\u2014",
            files: [file("root.md")],
        });
    });
});

describe("buildRoutedPr", () => {
    it("maps the recent PR to the rail pill payload", () => {
        expect(buildRoutedPr(repo({ recentPr }))).toEqual({
            prId: 7,
            title: "Docs update",
            status: "completed",
            url: "https://example/pr/7",
        });
    });

    it.each([
        { name: "no repo is selected", selected: undefined },
        { name: "the repo has no recent PR", selected: repo() },
    ])("shows no PR pill when $name", ({ selected }) => {
        expect(buildRoutedPr(selected)).toBeNull();
    });
});

describe("resolveCommentGating", () => {
    it("is writable in repo mode when a routing PR exists", () => {
        expect(resolveCommentGating(false, repo({ recentPr }))).toEqual({
            readOnly: false,
            shellReadOnly: false,
            shellReadOnlyMessage: undefined,
        });
    });

    it("is read-only with a message in repo mode without a routing PR", () => {
        expect(resolveCommentGating(false, repo())).toEqual({
            readOnly: true,
            shellReadOnly: true,
            shellReadOnlyMessage:
                "Repo One has no completed pull request — commenting is disabled until one is completed.",
        });
    });

    it("omits the message in repo mode without a repo", () => {
        expect(resolveCommentGating(false, undefined)).toEqual({
            readOnly: true,
            shellReadOnly: true,
            shellReadOnlyMessage: undefined,
        });
    });

    it("locks per-document mode with a message on an explicit Contribute denial", () => {
        expect(resolveCommentGating(true, repo({ canComment: false }))).toEqual({
            readOnly: true,
            shellReadOnly: true,
            shellReadOnlyMessage: COMMENT_PERMISSION_DENIED_MESSAGE,
        });
    });

    it.each([
        { name: "the permission is unknown", selected: repo() },
        { name: "no repo is selected", selected: undefined },
    ])("leaves per-document mode to each document when $name", ({ selected }) => {
        expect(resolveCommentGating(true, selected)).toEqual({
            readOnly: true,
            shellReadOnly: false,
            shellReadOnlyMessage: undefined,
        });
    });
});

describe("buildMentionLinks", () => {
    it("builds the context when org and project are known", () => {
        expect(buildMentionLinks("https://org", "Proj", "Repo")).toEqual({
            orgUrl: "https://org",
            projectName: "Proj",
            defaultRepoName: "Repo",
        });
    });

    it.each([
        { name: "the org", org: undefined, project: "Proj" },
        { name: "the project", org: "https://org", project: undefined },
        { name: "an org URL", org: "", project: "Proj" },
        { name: "a project name", org: "https://org", project: "" },
    ])("can't link mentions without $name", ({ org, project }) => {
        expect(buildMentionLinks(org, project, "Repo")).toBeNull();
    });
});

describe("resolveShellTree", () => {
    const tree: LazyTreeState = {
        repoId: "r1",
        files: [],
        unloadedFolders: ["docs"],
        folderOrders: {},
    };

    it("prefers the lazy tree's unloaded folders", () => {
        expect(resolveShellTree(repo(), tree, 0)).toEqual({
            unloadedFolders: ["docs"],
            isEmptyRepo: false,
            shellMounting: true,
        });
    });

    it("falls back to the repo's top-level folders", () => {
        expect(resolveShellTree(repo({ topLevelFolders: ["x"] }), undefined, 0)).toEqual({
            unloadedFolders: ["x"],
            isEmptyRepo: false,
            shellMounting: true,
        });
    });

    it("flags a loaded repo with no files or folders as empty", () => {
        expect(resolveShellTree(repo(), undefined, 0)).toEqual({
            unloadedFolders: [],
            isEmptyRepo: true,
            shellMounting: false,
        });
    });

    it("does not mount or flag empty while the repo is a skeleton", () => {
        expect(resolveShellTree(repo({ detailsLoaded: false }), undefined, 0)).toEqual({
            unloadedFolders: [],
            isEmptyRepo: false,
            shellMounting: false,
        });
    });

    it("mounts when the repo has files", () => {
        expect(resolveShellTree(repo(), undefined, 2).shellMounting).toBe(true);
    });
});

describe("pickDeepLinkSeeds", () => {
    const seeds = {
        initialSelectedPath: "/a.md",
        initialActiveThreadId: "t1",
        initialAnchor: "h",
        initialTextFragment: "txt",
    };

    it("forwards only the seed fields while active", () => {
        expect(pickDeepLinkSeeds(true, { ...seeds, extra: 1 } as never)).toEqual(seeds);
    });

    it("drops every seed once inactive", () => {
        expect(pickDeepLinkSeeds(false, seeds)).toEqual({});
    });
});

describe("menuFocusTarget", () => {
    it.each([
        {
            name: "ArrowDown from outside enters at the first item",
            key: "ArrowDown",
            from: -1,
            to: 0,
        },
        { name: "ArrowUp from outside enters at the last item", key: "ArrowUp", from: -1, to: 2 },
        { name: "ArrowDown moves to the next item", key: "ArrowDown", from: 0, to: 1 },
        { name: "ArrowDown on the last item wraps to the first", key: "ArrowDown", from: 2, to: 0 },
        { name: "ArrowUp on the first item wraps to the last", key: "ArrowUp", from: 0, to: 2 },
        { name: "Home jumps to the first item", key: "Home", from: 1, to: 0 },
        { name: "End jumps to the last item", key: "End", from: 1, to: 2 },
    ])("$name", ({ key, from, to }) => {
        expect(menuFocusTarget(key, from, 3)).toBe(to);
    });

    it("ignores other keys", () => {
        expect(menuFocusTarget("a", 1, 3)).toBeUndefined();
    });
});
