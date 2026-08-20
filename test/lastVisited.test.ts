import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LAST_VISITED_KEY,
  readLastPath,
  readLastRepo,
  writeLastPath,
  writeLastRepo,
} from "../src/hub/lastVisited";

describe("lastVisited cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores everything under a single JSON key", () => {
    writeLastRepo("proj", "repoA");
    writeLastPath("proj", "repoA", "/docs/x.md");
    expect(localStorage.length).toBe(1);
    const raw = localStorage.getItem(LAST_VISITED_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      proj: { repo: "repoA", paths: { repoA: "/docs/x.md" } },
    });
  });

  it("round-trips the last-visited repo, scoped per project", () => {
    expect(readLastRepo("proj")).toBeUndefined(); // absent → undefined
    writeLastRepo("proj", "repoA");
    expect(readLastRepo("proj")).toBe("repoA");
    expect(readLastRepo("other")).toBeUndefined(); // a different project
  });

  it("round-trips the last-visited path, scoped per repo", () => {
    expect(readLastPath("proj", "repo")).toBeUndefined();
    writeLastPath("proj", "repo", "/docs/x.md");
    expect(readLastPath("proj", "repo")).toBe("/docs/x.md");
    expect(readLastPath("proj", "other")).toBeUndefined(); // a different repo
  });

  it("keeps independent per-repo path entries within a project", () => {
    writeLastPath("proj", "repoA", "/a.md");
    writeLastPath("proj", "repoB", "/b.md");
    writeLastRepo("proj", "repoB");
    expect(readLastPath("proj", "repoA")).toBe("/a.md");
    expect(readLastPath("proj", "repoB")).toBe("/b.md");
    expect(readLastRepo("proj")).toBe("repoB");
  });

  it("preserves the repo when updating a path and vice versa", () => {
    writeLastRepo("proj", "repoA");
    writeLastPath("proj", "repoA", "/a.md");
    // Writing a path must not wipe the stored repo.
    expect(readLastRepo("proj")).toBe("repoA");
    // Writing a repo must not wipe stored paths.
    writeLastRepo("proj", "repoB");
    expect(readLastPath("proj", "repoA")).toBe("/a.md");
  });

  it("degrades to no memory when the stored JSON is corrupt", () => {
    localStorage.setItem(LAST_VISITED_KEY, "{not json");
    expect(readLastRepo("proj")).toBeUndefined();
    expect(readLastPath("proj", "repo")).toBeUndefined();
  });

  it("ignores a non-object JSON payload", () => {
    localStorage.setItem(LAST_VISITED_KEY, "42");
    expect(readLastRepo("proj")).toBeUndefined();
  });

  it("swallows read failures and degrades to no memory", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readLastRepo("proj")).toBeUndefined();
    expect(readLastPath("proj", "repo")).toBeUndefined();
  });

  it("swallows write failures silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeLastRepo("proj", "repoA")).not.toThrow();
    expect(() => writeLastPath("proj", "repo", "/x.md")).not.toThrow();
  });
});
