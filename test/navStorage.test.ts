import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
    persistSectionState,
    readSectionState,
    buildFolderStorageKey,
    readCollapsedDirs,
    writeCollapsedDirs,
} from "../src/shell/components/navStorage";
import { failStorage } from "./readerStorageFailures";

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("section collapse state", () => {
    it("round-trips a collapsed flag", () => {
        expect(readSectionState("doc", "sec")).toBe(false);
        persistSectionState("doc", "sec", true);
        expect(readSectionState("doc", "sec")).toBe(true);
    });

    it("clears the flag when collapsed is false", () => {
        persistSectionState("doc", "sec", true);
        persistSectionState("doc", "sec", false);
        expect(readSectionState("doc", "sec")).toBe(false);
    });

    it("keys section state by both storageKey and sectionId", () => {
        persistSectionState("docA", "sec", true);
        expect(readSectionState("docB", "sec")).toBe(false);
        expect(readSectionState("docA", "other")).toBe(false);
    });
});

describe("buildFolderStorageKey", () => {
    it("returns 'empty' for no files", () => {
        expect(buildFolderStorageKey([])).toBe("empty");
    });

    it("is deterministic for the same file list", () => {
        const files = [{ path: "a/b.md" }, { path: "c.md" }];
        expect(buildFolderStorageKey(files)).toBe(buildFolderStorageKey(files));
    });

    it("is order-independent", () => {
        const a = buildFolderStorageKey([{ path: "a.md" }, { path: "b.md" }]);
        const b = buildFolderStorageKey([{ path: "b.md" }, { path: "a.md" }]);
        expect(a).toBe(b);
    });

    it("differs when the file list differs", () => {
        const a = buildFolderStorageKey([{ path: "a.md" }]);
        const b = buildFolderStorageKey([{ path: "b.md" }]);
        expect(a).not.toBe(b);
    });
});

describe("collapsed dirs set", () => {
    it("defaults to an empty set for an unknown key", () => {
        expect(readCollapsedDirs("k")).toEqual(new Set());
    });

    it("round-trips a set of directory paths", () => {
        const set = new Set(["src", "src/pr-tab", "test"]);
        writeCollapsedDirs("k", set);
        expect(readCollapsedDirs("k")).toEqual(set);
    });

    it("keeps separate state per key", () => {
        writeCollapsedDirs("k1", new Set(["a"]));
        writeCollapsedDirs("k2", new Set(["b"]));
        expect(readCollapsedDirs("k1")).toEqual(new Set(["a"]));
        expect(readCollapsedDirs("k2")).toEqual(new Set(["b"]));
    });

    it.each([
        { name: "malformed JSON", stored: "{not json" },
        { name: "JSON that is not a list", stored: '{"a":1}' },
    ])("shows every folder expanded when storage holds $name", ({ stored }) => {
        sessionStorage.setItem("emr.docnav.collapsedDirs.k", stored);

        expect(readCollapsedDirs("k")).toEqual(new Set());
    });
});

describe("when browser storage is unavailable (private mode / quota)", () => {
    it.each([
        {
            name: "collapsing a section",
            method: "setItem",
            save: () => persistSectionState("doc", "sec", true),
        },
        {
            name: "expanding a section",
            method: "removeItem",
            save: () => persistSectionState("doc", "sec", false),
        },
        {
            name: "collapsing a folder",
            method: "setItem",
            save: () => writeCollapsedDirs("k", new Set(["a"])),
        },
    ] as const)("$name still works without saving it", ({ method, save }) => {
        failStorage(method);

        expect(save).not.toThrow();
    });

    it("shows every section expanded", () => {
        failStorage("getItem");

        expect(readSectionState("doc", "sec")).toBe(false);
    });

    it("shows every folder expanded", () => {
        failStorage("getItem");

        expect(readCollapsedDirs("k")).toEqual(new Set());
    });
});
