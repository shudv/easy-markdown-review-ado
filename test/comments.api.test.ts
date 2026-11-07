// Tests for the LocalOnly CommentApi and the filterByQuery matcher behind the
// dev preview's mention pickers.

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

    const many: Row[] = Array.from({ length: 20 }, (_, i) => ({
        name: `match-${i}`,
        tags: "",
    }));

    it.each([
        { name: "an empty", query: "" },
        { name: "a blank", query: "   " },
    ])("suggests the first eight items for $name query", ({ query }) => {
        expect(filterByQuery(many, query, keys)).toEqual(many.slice(0, 8));
    });

    it("matches case-insensitively across every searchable field", () => {
        const r = filterByQuery(items, "ALPHA", keys);
        expect(r.map((x) => x.name).sort()).toEqual(["alpha", "gamma"]);
    });

    it("ranks suggestions whose match starts earlier first, regardless of input order", () => {
        const rows = [{ name: "wx" }, { name: "x" }, { name: "wwx" }];

        const ranked = filterByQuery(rows, "x", (r) => [r.name]);
        expect(ranked.map((r) => r.name)).toEqual(["x", "wx", "wwx"]);
    });

    it("matches a query that runs from one field into the next, like a work item id and title", () => {
        const workItems = [{ id: "11612", title: "Fix login" }];

        expect(filterByQuery(workItems, "11612 fix", (w) => [w.id, w.title])).toEqual(workItems);
    });

    it("returns at most eight matches", () => {
        expect(filterByQuery(many, "match", (r) => [r.name])).toHaveLength(8);
    });

    it("returns no suggestions when nothing matches", () => {
        expect(filterByQuery(items, "missing-xyz", keys)).toEqual([]);
    });
});

describe("LocalOnlyCommentApi", () => {
    it("gives each new thread a distinct id and a first comment id derived from it", async () => {
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

    it("gives each reply a distinct comment id", async () => {
        const api = new LocalOnlyCommentApi();
        const r1 = await api.addReply("t1", "hi");
        const r2 = await api.addReply("t1", "there");
        expect(r1.commentId).not.toBe(r2.commentId);
    });

    it("stamps an edited comment with the time of the edit", async () => {
        const api = new LocalOnlyCommentApi();

        const { updatedAt } = await api.editComment("t", "c", "new");

        expect(Number.isFinite(Date.parse(updatedAt))).toBe(true);
    });

    it.each([
        {
            name: "deleting a comment",
            act: (api: LocalOnlyCommentApi) => api.deleteComment("t", "c"),
        },
        {
            name: "changing a thread's status",
            act: (api: LocalOnlyCommentApi) => api.setStatus("t", "resolved"),
        },
        {
            name: "liking a comment",
            act: (api: LocalOnlyCommentApi) => api.toggleReaction("t", "c", "like", true),
        },
    ])("accepts $name without a server", async ({ act }) => {
        await expect(act(new LocalOnlyCommentApi())).resolves.toBeUndefined();
    });

    it.each([
        {
            name: "people",
            search: (api: LocalOnlyCommentApi) => api.searchUsers("Alex"),
            empty: [],
        },
        {
            name: "work items",
            search: (api: LocalOnlyCommentApi) => api.searchWorkItems("comment"),
            empty: [],
        },
        {
            name: "pull requests",
            search: (api: LocalOnlyCommentApi) => api.searchPullRequests("OneTodo"),
            empty: [],
        },
        {
            name: "identity names",
            search: (api: LocalOnlyCommentApi) => api.resolveIdentities(["u-alex"]),
            empty: {},
        },
    ])("has no $name to offer without a directory to search", async ({ search, empty }) => {
        await expect(search(new LocalOnlyCommentApi())).resolves.toEqual(empty);
    });
});
