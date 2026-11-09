// React-hook tests for useThreadViews: which threads the article, the rail and
// the file list show for the open document, the history stop and the filter.

import { afterEach, describe, expect, it } from "vitest";

import type { ThreadState } from "../src/comments/store";
import type { CommentThread, FileInfo, ThreadStatus } from "../src/types";
import { useThreadViews } from "../src/shell/shell/useThreadViews";
import { mountTracked, unmountAll } from "./shellHarness";

type Options = Parameters<typeof useThreadViews>[0];

afterEach(unmountAll);

function thread(
    id: string,
    filePath: string,
    extra: { status?: ThreadStatus; general?: boolean; body?: string } = {},
): CommentThread {
    return {
        id,
        filePath,
        anchor: { exact: "quoted", prefix: "", suffix: "" },
        status: extra.status ?? "active",
        ...(extra.general ? { general: true } : {}),
        comments: [
            {
                id: `${id}-c1`,
                author: { id: "ada", displayName: "Ada", initials: "AD" },
                bodyMarkdown: extra.body ?? `comment on ${filePath}`,
                createdAt: "2024-01-01T00:00:00Z",
            },
        ],
    } as CommentThread;
}

function stateOf(...threads: CommentThread[]): ThreadState {
    return {
        threadsById: Object.fromEntries(threads.map((t) => [t.id, t])),
        order: threads.map((t) => t.id),
    };
}

const files = (...paths: string[]): FileInfo[] => paths.map((path) => ({ path }) as FileInfo);

const onA = thread("a1", "docs/a.md");
const resolvedOnA = thread("a2", "docs/a.md", { status: "resolved", body: "fixed typo" });
const onB = thread("b1", "docs/b.md");
const overview = thread("g1", "", { general: true });
const onRemoved = thread("r1", "docs/removed.md");

function options(overrides: Partial<Options> = {}): Options {
    return {
        threadState: stateOf(onA, resolvedOnA, onB, overview, onRemoved),
        selectedPath: "docs/a.md",
        files: files("docs/a.md", "docs/b.md"),
        isHub: false,
        viewingHistorical: false,
        nativeIterationMode: false,
        activeStopPrId: null,
        historicalThreadsByKey: {},
        commentQuery: "",
        commentFilter: "all",
        currentUserId: "me",
        ...overrides,
    };
}

const ids = (threads: readonly CommentThread[]) => threads.map((t) => t.id);

describe("useThreadViews: the open document's comments", () => {
    it("shows only the open document's comments", async () => {
        const hook = await mountTracked(useThreadViews, options());
        expect(ids(hook.current.currentThreadsRaw)).toEqual(["a1", "a2"]);
    });

    it("shows the newly opened document's comments after switching documents", async () => {
        const hook = await mountTracked(useThreadViews, options());
        await hook.rerender(options({ selectedPath: "docs/b.md" }));
        expect(ids(hook.current.currentThreadsRaw)).toEqual(["b1"]);
    });

    it("shows a newly arrived comment on the open document", async () => {
        const hook = await mountTracked(useThreadViews, options());
        const fresh = thread("a3", "docs/a.md");
        await hook.rerender(options({ threadState: stateOf(onA, fresh) }));
        expect(ids(hook.current.currentThreadsRaw)).toEqual(["a1", "a3"]);
    });

    it("shows a past PR's comments while that PR's stop is viewed", async () => {
        const past = thread("p1", "docs/a.md");

        const hook = await mountTracked(
            useThreadViews,
            options({
                viewingHistorical: true,
                activeStopPrId: 7,
                historicalThreadsByKey: { "docs/a.md\u00007": [past] },
            }),
        );

        expect(ids(hook.current.currentThreadsRaw)).toEqual(["p1"]);
    });

    it("shows the past PR's comments once they finish loading", async () => {
        const past = thread("p1", "docs/a.md");
        const viewing = options({ viewingHistorical: true, activeStopPrId: 7 });
        const hook = await mountTracked(useThreadViews, viewing);
        expect(hook.current.currentThreadsRaw).toEqual([]);
        await hook.rerender({ ...viewing, historicalThreadsByKey: { "docs/a.md\u00007": [past] } });
        expect(ids(hook.current.currentThreadsRaw)).toEqual(["p1"]);
    });

    it("shows no comments for a past stop that has no PR", async () => {
        const hook = await mountTracked(
            useThreadViews,
            options({ viewingHistorical: true, activeStopPrId: null }),
        );

        expect(hook.current.currentThreadsRaw).toEqual([]);
    });

    it("keeps showing the live comments while PR updates are compared", async () => {
        const hook = await mountTracked(
            useThreadViews,
            options({ viewingHistorical: true, nativeIterationMode: true, activeStopPrId: 7 }),
        );

        expect(ids(hook.current.currentThreadsRaw)).toEqual(["a1", "a2"]);
    });
});

describe("useThreadViews: comments highlighted in the article", () => {
    it.each([
        ["all comments", { commentFilter: "all" }, ["a1", "a2"]],
        ["resolved comments", { commentFilter: "resolved" }, ["a2"]],
        ["comments matching a search", { commentQuery: "typo" }, ["a2"]],
    ] as const)("highlights only %s", async (_view, overrides, expected) => {
        const hook = await mountTracked(useThreadViews, options(overrides));
        expect(ids(hook.current.visibleForArticle)).toEqual(expected);
    });

    it("updates the highlights when the reader changes the comment filter", async () => {
        const hook = await mountTracked(useThreadViews, options());
        await hook.rerender(options({ commentFilter: "resolved" }));
        expect(ids(hook.current.visibleForArticle)).toEqual(["a2"]);
    });
});

describe("useThreadViews: PR-wide and orphaned comments", () => {
    it("lists PR-wide comments in a pull request", async () => {
        const hook = await mountTracked(useThreadViews, options());
        expect(ids(hook.current.generalThreads)).toEqual(["g1"]);
    });

    it("lists comments on files no longer in the pull request", async () => {
        const hook = await mountTracked(useThreadViews, options());
        expect(ids(hook.current.orphanedFileThreads)).toEqual(["r1"]);
    });

    it("shows neither PR-wide nor orphaned comments in the documents hub", async () => {
        const hook = await mountTracked(useThreadViews, options({ isHub: true }));
        expect(hook.current.generalThreads).toEqual([]);
        expect(hook.current.orphanedFileThreads).toEqual([]);
    });

    it("shows a newly posted PR-wide comment", async () => {
        const hook = await mountTracked(useThreadViews, options());
        const another = thread("g2", "", { general: true });
        await hook.rerender(options({ threadState: stateOf(overview, another) }));
        expect(ids(hook.current.generalThreads)).toEqual(["g1", "g2"]);
    });

    it("stops listing a file's comments as orphaned once the file is back in the pull request", async () => {
        const hook = await mountTracked(useThreadViews, options());
        await hook.rerender(options({ files: files("docs/a.md", "docs/b.md", "docs/removed.md") }));
        expect(hook.current.orphanedFileThreads).toEqual([]);
    });
});

describe("useThreadViews: open comment counts in the file list", () => {
    it("counts each file's unresolved comments", async () => {
        const second = thread("a3", "docs/a.md");

        const hook = await mountTracked(
            useThreadViews,
            options({ threadState: stateOf(onA, second, resolvedOnA, onB) }),
        );

        expect(hook.current.threadCountsByPath).toEqual({ "docs/a.md": 2, "docs/b.md": 1 });
    });

    it("updates a file's count when a comment arrives", async () => {
        const hook = await mountTracked(useThreadViews, options({ threadState: stateOf(onA) }));
        await hook.rerender(options({ threadState: stateOf(onA, onB) }));
        expect(hook.current.threadCountsByPath).toEqual({ "docs/a.md": 1, "docs/b.md": 1 });
    });
});
