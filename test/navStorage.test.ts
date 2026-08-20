import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  persistSectionState,
  readSectionState,
  buildFolderStorageKey,
  readCollapsedDirs,
  writeCollapsedDirs,
} from "../src/shell/components/navStorage";

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

  it("returns an empty set when stored JSON is malformed", () => {
    sessionStorage.setItem("emr.docnav.collapsedDirs.bad", "{not json");
    expect(readCollapsedDirs("bad")).toEqual(new Set());
  });

  it("returns an empty set when stored JSON is not an array", () => {
    sessionStorage.setItem("emr.docnav.collapsedDirs.obj", '{"a":1}');
    expect(readCollapsedDirs("obj")).toEqual(new Set());
  });
});

describe("storage failures are swallowed (private mode / quota)", () => {
  it("persistSectionState never throws when setItem fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => persistSectionState("doc", "sec", true)).not.toThrow();
  });

  it("persistSectionState never throws when removeItem fails", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => persistSectionState("doc", "sec", false)).not.toThrow();
  });

  it("readSectionState defaults to expanded when getItem fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSectionState("doc", "sec")).toBe(false);
  });

  it("writeCollapsedDirs never throws when setItem fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeCollapsedDirs("k", new Set(["a"]))).not.toThrow();
  });

  it("readCollapsedDirs returns an empty set when getItem fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readCollapsedDirs("k")).toEqual(new Set());
  });
});
