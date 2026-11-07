// Tests for FixtureCommentApi — the dev/stories-only subclass that layers
// fixture-backed mention search onto LocalOnlyCommentApi. Kept out of the
// shipped bundles (only stories import it), but its search behaviour is
// exercised here.

import { describe, expect, it } from "vitest";

import { FixtureCommentApi } from "../src/comments/fixtureCommentApi";
import { FIXTURE_WORK_ITEMS } from "../src/comments/fixtures";

describe("FixtureCommentApi", () => {
    it("suggests up to eight sample people before anything is typed after @", async () => {
        const users = await new FixtureCommentApi().searchUsers("");

        expect(users.length).toBeGreaterThan(0);
        expect(users.length).toBeLessThanOrEqual(8);
    });

    it("suggests the sample people whose name matches what was typed", async () => {
        const users = await new FixtureCommentApi().searchUsers("Alex");

        expect(users.length).toBeGreaterThan(0);
        expect(users.every((u) => u.displayName.includes("Alex"))).toBe(true);
    });

    it("resolves only the requested sample people, matching ids case-insensitively", async () => {
        const api = new FixtureCommentApi();
        const [someone] = await api.searchUsers("Alex");

        const resolved = await api.resolveIdentities([someone!.id.toUpperCase(), "not-a-real-id"]);

        expect(resolved).toEqual({
            [someone!.id]: { displayName: someone!.displayName, avatarUrl: someone!.avatarUrl },
        });
    });

    it("suggests the sample work items before anything is typed after #", async () => {
        expect(await new FixtureCommentApi().searchWorkItems("")).toEqual(
            FIXTURE_WORK_ITEMS.slice(0, 8),
        );
    });

    it("finds a sample work item by its type", async () => {
        expect(await new FixtureCommentApi().searchWorkItems("Scenario")).toEqual([
            expect.objectContaining({ id: "11612051", workItemType: "Scenario" }),
        ]);
    });

    it("finds the sample pull requests of a repository by its name", async () => {
        const pullRequests = await new FixtureCommentApi().searchPullRequests("OneTodo");

        expect(pullRequests.map((p) => p.repository)).toEqual([
            "OneTodo",
            "OneTodo",
            "OneTodo",
            "OneTodo",
        ]);
    });

    it("suggests no pull requests when nothing matches", async () => {
        expect(await new FixtureCommentApi().searchPullRequests("zzznotfound-xyz")).toEqual([]);
    });

    it("still creates threads locally without a server", async () => {
        const created = await new FixtureCommentApi().createThread({
            filePath: "f.md",
            anchor: { exact: "x", prefix: "", suffix: "" },
            bodyMarkdown: "hi",
        });

        expect(created.threadId).toMatch(/^t-local-/);
    });
});
