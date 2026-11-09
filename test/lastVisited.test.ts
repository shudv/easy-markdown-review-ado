import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    LAST_VISITED_KEY,
    readLastPath,
    readLastRepo,
    writeLastPath,
    writeLastRepo,
} from "../src/hub/lastVisited";
import { failStorage } from "./readerStorageFailures";

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

        expect(localStorage).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem("emr.docs.lastVisited")!)).toEqual({
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

    it.each([
        { name: "corrupt JSON", stored: "{not json" },
        { name: "a number", stored: "42" },
        { name: "null", stored: "null" },
        { name: "a string", stored: '"text"' },
        { name: "a boolean", stored: "false" },
    ])("remembers nothing when storage holds $name", ({ stored }) => {
        localStorage.setItem(LAST_VISITED_KEY, stored);

        expect(readLastRepo("proj")).toBeUndefined();
        expect(readLastPath("proj", "repo")).toBeUndefined();
    });

    it("returns no path when a stored project has no paths map", () => {
        localStorage.setItem(LAST_VISITED_KEY, JSON.stringify({ proj: { repo: "repoA" } }));

        expect(readLastPath("proj", "repoA")).toBeUndefined();
    });

    it("remembers nothing when storage cannot be read", () => {
        failStorage("getItem");

        expect(readLastRepo("proj")).toBeUndefined();
        expect(readLastPath("proj", "repo")).toBeUndefined();
    });

    it.each([
        { name: "repo", remember: () => writeLastRepo("proj", "repoA") },
        { name: "path", remember: () => writeLastPath("proj", "repo", "/x.md") },
    ])(
        "carries on without remembering the $name when storage cannot be written",
        ({ remember }) => {
            failStorage("setItem");

            expect(remember).not.toThrow();
        },
    );
});
