// Tests for the LocalOnly CommentApi and the filterByQuery scorer.

import { describe, expect, it } from "vitest";

import { filterByQuery, LocalOnlyCommentApi } from "../src/comments/api";

describe("filterByQuery", () => {
  type Row = { name: string; tags: string };
  const items: Row[] = [
    { name: "alpha", tags: "first" },
    { name: "beta", tags: "second" },
    { name: "gamma", tags: "alpha-prefix" },
    { name: "delta", tags: "" },
  ];
  const keys = (r: Row): string[] => [r.name, r.tags];

  it("returns the first 8 items when the query is empty", () => {
    expect(filterByQuery(items, "", keys).length).toBeLessThanOrEqual(8);
    expect(filterByQuery(items, "   ", keys).length).toBe(items.length);
  });

  it("matches case-insensitively across all key fields", () => {
    const r = filterByQuery(items, "ALPHA", keys);
    expect(r.map((x) => x.name).sort()).toEqual(["alpha", "gamma"]);
  });

  it("ranks earlier hits before later hits", () => {
    const r = filterByQuery(items, "alpha", keys);
    // `alpha`'s name starts at offset 0 — it should sort before `gamma`
    // whose match is in the `tags` field after a "gamma " prefix.
    expect(r[0]!.name).toBe("alpha");
  });

  it("sorts strictly by match offset even when insertion order disagrees", () => {
    // Insertion order is deliberately NOT the ranked order, so a removed or
    // sign-flipped sort comparator produces a different sequence.
    const rows = [
      { name: "wx" }, // "x" at offset 1
      { name: "x" }, //  "x" at offset 0
      { name: "wwx" }, // "x" at offset 2
    ];
    const ranked = filterByQuery(rows, "x", (r) => [r.name]);
    expect(ranked.map((r) => r.name)).toEqual(["x", "wx", "wwx"]);
  });

  it("joins key fields with a space so matches don't bridge field boundaries", () => {
    // "foo bar" only matches when the key separator is a space; a mutated
    // empty separator would yield "foobar" and miss this query.
    const rows = [{ a: "foo", b: "bar" }];
    const hit = filterByQuery(rows, "foo bar", (r) => [r.a, r.b]);
    expect(hit).toHaveLength(1);
  });

  it("returns at most 8 ranked matches", () => {
    const many: Row[] = Array.from({ length: 20 }, (_, i) => ({
      name: `match-${i}`,
      tags: "",
    }));
    expect(filterByQuery(many, "match", (r) => [r.name]).length).toBe(8);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterByQuery(items, "missing-xyz", keys)).toEqual([]);
  });
});

describe("LocalOnlyCommentApi", () => {
  it("mints unique thread ids on each createThread call", async () => {
    const api = new LocalOnlyCommentApi();
    const a = await api.createThread({
      filePath: "f.md",
      anchor: { exact: "x", prefix: "", suffix: "" },
      bodyMarkdown: "hi",
    });
    const b = await api.createThread({
      filePath: "f.md",
      anchor: { exact: "y", prefix: "", suffix: "" },
      bodyMarkdown: "bye",
    });
    expect(a.threadId).not.toBe(b.threadId);
    expect(a.firstCommentId).toBe(`${a.threadId}-c1`);
    expect(Number.isFinite(Date.parse(a.createdAt))).toBe(true);
  });

  it("numbers thread and comment ids from 1 with a pre-increment counter", async () => {
    const api = new LocalOnlyCommentApi();
    const t1 = await api.createThread({
      filePath: "f.md",
      anchor: { exact: "x", prefix: "", suffix: "" },
      bodyMarkdown: "hi",
    });
    const t2 = await api.createThread({
      filePath: "f.md",
      anchor: { exact: "y", prefix: "", suffix: "" },
      bodyMarkdown: "bye",
    });
    // Exact ids pin the pre-increment (first call yields 1, not 0).
    expect(t1.threadId).toBe("t-local-1");
    expect(t2.threadId).toBe("t-local-2");
    const r1 = await api.addReply("t1", "hi");
    const r2 = await api.addReply("t1", "there");
    expect(r1.commentId).toBe("c-local-1");
    expect(r2.commentId).toBe("c-local-2");
  });

  it("mints unique reply comment ids", async () => {
    const api = new LocalOnlyCommentApi();
    const r1 = await api.addReply("t1", "hi");
    const r2 = await api.addReply("t1", "there");
    expect(r1.commentId).not.toBe(r2.commentId);
  });

  it("editComment / deleteComment / setStatus / toggleReaction are no-op promises", async () => {
    const api = new LocalOnlyCommentApi();
    await expect(api.editComment("t", "c", "new")).resolves.toEqual(
      expect.objectContaining({ updatedAt: expect.any(String) }),
    );
    await expect(api.deleteComment("t", "c")).resolves.toBeUndefined();
    await expect(api.setStatus("t", "resolved")).resolves.toBeUndefined();
    await expect(
      api.toggleReaction("t", "c", "like", true),
    ).resolves.toBeUndefined();
  });

  it("returns empty mention-search results (no directory to search)", async () => {
    const api = new LocalOnlyCommentApi();
    expect(await api.searchUsers("")).toEqual([]);
    expect(await api.searchUsers("Alex")).toEqual([]);
    expect(await api.searchWorkItems("comment")).toEqual([]);
    expect(await api.searchPullRequests("OneTodo")).toEqual([]);
    expect(await api.resolveIdentities(["u-alex"])).toEqual({});
  });
});
