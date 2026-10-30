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
  it("seeds files, a copy of the top-level folders, and the root order", () => {
    const folders = ["docs"];
    const r = repo({
      files: [file("a.md")],
      topLevelFolders: folders,
      rootOrder: ["a"],
    });
    const tree = seedLazyTree(r);
    expect(tree).toEqual({
      repoId: "r1",
      files: [file("a.md")],
      unloadedFolders: ["docs"],
      folderOrders: { "": ["a"] },
    });
    expect(tree.unloadedFolders).not.toBe(folders);
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
    expect(next.files.map((f) => f.path)).toEqual([
      "docs/a.md",
      "docs/b.md",
      "z.md",
    ]);
    expect(next.unloadedFolders).toEqual(["docs/sub", "other"]);
    expect(next.folderOrders).toBe(entry.folderOrders);
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

  it("falls back to the first repo otherwise", () => {
    expect(pickSelectedRepo([a], "x", b)).toBe(a);
    expect(pickSelectedRepo([a], "x", undefined)).toBe(a);
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

  it("returns null without a repo or recent PR", () => {
    expect(buildRoutedPr(undefined)).toBeNull();
    expect(buildRoutedPr(repo())).toBeNull();
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

  it("gates per-document mode only on an explicit Contribute denial", () => {
    expect(resolveCommentGating(true, repo({ canComment: false }))).toEqual({
      readOnly: true,
      shellReadOnly: true,
      shellReadOnlyMessage: COMMENT_PERMISSION_DENIED_MESSAGE,
    });
    expect(resolveCommentGating(true, repo())).toEqual({
      readOnly: true,
      shellReadOnly: false,
      shellReadOnlyMessage: undefined,
    });
    expect(resolveCommentGating(true, undefined)).toEqual({
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

  it("returns null when org or project is missing", () => {
    expect(buildMentionLinks(undefined, "Proj", "Repo")).toBeNull();
    expect(buildMentionLinks("https://org", undefined, "Repo")).toBeNull();
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
      prShellMounting: true,
    });
  });

  it("falls back to the repo's top-level folders", () => {
    expect(
      resolveShellTree(repo({ topLevelFolders: ["x"] }), undefined, 0),
    ).toEqual({
      unloadedFolders: ["x"],
      isEmptyRepo: false,
      prShellMounting: true,
    });
  });

  it("flags a loaded repo with no files or folders as empty", () => {
    expect(resolveShellTree(repo(), undefined, 0)).toEqual({
      unloadedFolders: [],
      isEmptyRepo: true,
      prShellMounting: false,
    });
  });

  it("does not mount or flag empty while the repo is a skeleton", () => {
    expect(
      resolveShellTree(repo({ detailsLoaded: false }), undefined, 0),
    ).toEqual({
      unloadedFolders: [],
      isEmptyRepo: false,
      prShellMounting: false,
    });
  });

  it("mounts when the repo has files", () => {
    expect(resolveShellTree(repo(), undefined, 2).prShellMounting).toBe(true);
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
    expect(pickDeepLinkSeeds(true, { ...seeds, extra: 1 } as never)).toEqual(
      seeds,
    );
  });

  it("drops every seed once inactive", () => {
    expect(pickDeepLinkSeeds(false, seeds)).toEqual({});
  });
});

describe("menuFocusTarget", () => {
  it("enters the list from outside with the arrow keys", () => {
    expect(menuFocusTarget("ArrowDown", -1, 3)).toBe(0);
    expect(menuFocusTarget("ArrowUp", -1, 3)).toBe(2);
  });

  it("wraps arrow navigation within the list", () => {
    expect(menuFocusTarget("ArrowDown", 2, 3)).toBe(0);
    expect(menuFocusTarget("ArrowUp", 0, 3)).toBe(2);
    expect(menuFocusTarget("ArrowDown", 0, 3)).toBe(1);
  });

  it("jumps to the ends with Home / End", () => {
    expect(menuFocusTarget("Home", 1, 3)).toBe(0);
    expect(menuFocusTarget("End", 1, 3)).toBe(2);
  });

  it("ignores other keys", () => {
    expect(menuFocusTarget("a", 1, 3)).toBeUndefined();
  });
});
