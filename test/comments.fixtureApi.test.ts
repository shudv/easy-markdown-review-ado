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

    expect(await api.searchWorkItems("")).toEqual([
      {
        kind: "workitem",
        id: "11612051",
        workItemType: "Scenario",
        title: "App caching scenarios",
        state: "In Progress",
        stateColor: "#cc6d00",
      },
      {
        kind: "workitem",
        id: "11612042",
        workItemType: "Bug",
        title: "Comment rail jitters on resize",
        state: "Active",
        stateColor: "#cc293d",
      },
      {
        kind: "workitem",
        id: "11611998",
        workItemType: "Task",
        title: "Wire up identity picker SDK service",
        state: "To Do",
        stateColor: "#b2b2b2",
      },
      {
        kind: "workitem",
        id: "11611820",
        workItemType: "User Story",
        title: "Reviewer can @mention teammates in a comment",
        state: "Resolved",
        stateColor: "#339933",
      },
      {
        kind: "workitem",
        id: "11611702",
        workItemType: "Feature",
        title: "Inline image attachments on PR comments",
        state: "In Progress",
        stateColor: "#cc6d00",
      },
    ]);
    expect(await api.searchWorkItems("Scenario")).toEqual([
      {
        kind: "workitem",
        id: "11612051",
        workItemType: "Scenario",
        title: "App caching scenarios",
        state: "In Progress",
        stateColor: "#cc6d00",
      },
    ]);

    // Fixture has no matching PR title; expect empty results.
    expect(await api.searchPullRequests("zzznotfound-xyz")).toEqual([]);

    const pullRequests = await api.searchPullRequests("OneTodo");
    expect(pullRequests).toHaveLength(4);
    expect([...pullRequests].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        kind: "pullrequest",
        id: "5057120",
        title: "Spike: replace markdown-it with unified pipeline",
        status: "abandoned",
        repository: "OneTodo",
      },
      {
        kind: "pullrequest",
        id: "5057914",
        title: "Bump @azure/identity to 4.4.1",
        status: "completed",
        repository: "OneTodo",
      },
      {
        kind: "pullrequest",
        id: "5058641",
        title: "[Comments] Surface unresolved threads in the file tree",
        status: "completed",
        repository: "OneTodo",
      },
      {
        kind: "pullrequest",
        id: "5058833",
        title:
          "[Grid] Implement add task in plan and myday, mytasks views using dom-based AddTaskRow instead of canvas",
        status: "active",
        repository: "OneTodo",
      },
    ]);
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
