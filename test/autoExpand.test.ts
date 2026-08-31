import { describe, it, expect } from "vitest";

import { autoExpandKey, planRootAutoExpand } from "../src/hub/autoExpand";

describe("autoExpandKey", () => {
  it("strips leading slashes so the key is canonical", () => {
    expect(autoExpandKey("repo-1", "/docs")).toBe(
      autoExpandKey("repo-1", "docs"),
    );
    expect(autoExpandKey("repo-1", "///docs")).toBe("repo-1\u0000docs");
    expect(autoExpandKey("repo-1", "docs//nested")).toBe(
      "repo-1\u0000docs//nested",
    );
  });

  it("scopes the key by repo id", () => {
    expect(autoExpandKey("repo-1", "/docs")).not.toBe(
      autoExpandKey("repo-2", "/docs"),
    );
  });

  it("separates repo and folder with a NUL so prefixes never collide", () => {
    expect(autoExpandKey("a", "b")).toBe("a\u0000b");
  });
});

describe("planRootAutoExpand", () => {
  const base = {
    repoId: "repo-docsonly",
    expandedKeys: new Set<string>(),
    used: 0,
    max: 40,
  };

  it("plans every unloaded folder when the root has no files", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: ["/docs", "/guides"],
    });
    expect(plan.folders).toEqual(["/docs", "/guides"]);
    expect(plan.keys).toEqual([
      autoExpandKey("repo-docsonly", "/docs"),
      autoExpandKey("repo-docsonly", "/guides"),
    ]);
    expect(plan.used).toBe(2);
  });

  it("plans nothing once a document is already visible at the root", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 1,
      unloadedFolders: ["/docs"],
    });
    expect(plan.folders).toEqual([]);
    expect(plan.keys).toEqual([]);
    expect(plan.used).toBe(0);
  });

  it("skips folders already expanded so listings are never re-fetched", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: ["/docs", "/guides"],
      expandedKeys: new Set([autoExpandKey("repo-docsonly", "/docs")]),
    });
    expect(plan.folders).toEqual(["/guides"]);
    expect(plan.used).toBe(1);
  });

  it("respects the per-repo budget and reports the consumed total", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: ["/a", "/b", "/c"],
      used: 38,
      max: 40,
    });
    expect(plan.folders).toEqual(["/a", "/b"]);
    expect(plan.used).toBe(40);
  });

  it("plans nothing when the budget is already exhausted", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: ["/a"],
      used: 40,
      max: 40,
    });
    expect(plan.folders).toEqual([]);
    expect(plan.keys).toEqual([]);
    expect(plan.used).toBe(40);
  });

  it("plans nothing when usage has exceeded the budget", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: ["/a"],
      used: 41,
      max: 40,
    });
    expect(plan).toEqual({ folders: [], keys: [], used: 41 });
  });

  it("plans nothing when there are no unloaded folders", () => {
    const plan = planRootAutoExpand({
      ...base,
      fileCount: 0,
      unloadedFolders: [],
    });
    expect(plan.folders).toEqual([]);
    expect(plan.used).toBe(0);
  });
});
