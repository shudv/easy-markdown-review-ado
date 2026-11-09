import { describe, it, expect } from "vitest";

import { autoExpandKey, planRootAutoExpand } from "../src/hub/autoExpand";

describe("autoExpandKey", () => {
    it.each(["/docs", "///docs"])("treats %s and docs as the same folder", (path) => {
        expect(autoExpandKey("repo-1", path)).toBe(autoExpandKey("repo-1", "docs"));
    });

    it("scopes the key by repo id", () => {
        expect(autoExpandKey("repo-1", "/docs")).not.toBe(autoExpandKey("repo-2", "/docs"));
    });

    it("never confuses a repo/folder pair with one split at a different point", () => {
        expect(autoExpandKey("a", "bc")).not.toBe(autoExpandKey("ab", "c"));
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

    it.each([
        { name: "used up", used: 40 },
        { name: "already overrun", used: 41 },
    ])("plans nothing when the budget is $name", ({ used }) => {
        const plan = planRootAutoExpand({
            ...base,
            fileCount: 0,
            unloadedFolders: ["/a"],
            used,
            max: 40,
        });

        expect(plan).toEqual({ folders: [], keys: [], used });
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
