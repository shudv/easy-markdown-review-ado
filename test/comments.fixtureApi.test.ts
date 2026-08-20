// Tests for FixtureCommentApi — the dev/stories-only subclass that layers
// fixture-backed mention search onto LocalOnlyCommentApi. Kept out of the
// shipped bundles (only stories import it), but its search behaviour is
// exercised here.

import { describe, expect, it } from "vitest";

import { FixtureCommentApi } from "../src/comments/fixtureCommentApi";

describe("FixtureCommentApi", () => {
  it("returns fixture-backed user / workitem / PR results, ranked by query", async () => {
    const api = new FixtureCommentApi();

    // Each list should return at most 8 items, and empty query returns a
    // recency-window list.
    const users = await api.searchUsers("");
    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBeLessThanOrEqual(8);

    // A non-empty query exercises the per-item key extractor + ranking
    // (the empty-query path returns the recency window without scoring).
    const namedUsers = await api.searchUsers("Alex");
    expect(namedUsers.some((u) => u.displayName.includes("Alex"))).toBe(true);

    // resolveIdentities maps fixture user ids to names (case-insensitive) and
    // omits unknown ids.
    const someUser = namedUsers[0]!;
    const resolved = await api.resolveIdentities([
      someUser.id.toUpperCase(),
      "not-a-real-id",
    ]);
    expect(resolved[someUser.id]?.displayName).toBe(someUser.displayName);
    expect(resolved["not-a-real-id"]).toBeUndefined();

    // A single requested id must resolve to exactly ONE author.
    const onlyOne = await api.resolveIdentities([someUser.id]);
    expect(Object.keys(onlyOne)).toEqual([someUser.id]);

    const wis = await api.searchWorkItems("comment");
    expect(wis.some((w) => w.title.toLowerCase().includes("comment"))).toBe(
      true,
    );

    // Fixture has no matching PR title; expect empty results.
    expect(await api.searchPullRequests("zzznotfound-xyz")).toEqual([]);

    // A query that matches PR key fields returns results.
    const prHits = await api.searchPullRequests("OneTodo");
    expect(prHits.length).toBeGreaterThan(0);
  });

  it("still mints session-local write ids (inherited from LocalOnly)", async () => {
    const api = new FixtureCommentApi();
    const t = await api.createThread({
      filePath: "f.md",
      anchor: { exact: "x", prefix: "", suffix: "" },
      bodyMarkdown: "hi",
    });
    expect(t.threadId).toBe("t-local-1");
  });
});
