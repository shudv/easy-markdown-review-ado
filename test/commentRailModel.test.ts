import { describe, it, expect } from "vitest";

import { DRAFT_THREAD_ID } from "../src/shell/components/ArticleView.highlights";
import { buildRailModel, DRAFT_ID } from "../src/shell/components/CommentRail.helpers";
import type { CommentThread, ThreadStatus } from "../src/types";

/** Minimal CommentThread factory for the rail-model tests. */
function thread(
    id: string,
    createdAt: string,
    opts: { general?: boolean; status?: ThreadStatus; filePath?: string } = {},
): CommentThread {
    return {
        id,
        filePath: opts.filePath ?? "/doc.md",
        anchor: { exact: "x", prefix: "", suffix: "" },
        status: opts.status ?? "active",
        general: opts.general,
        comments: [
            {
                id: `${id}-c0`,
                author: { id: "u", displayName: "U", initials: "U" },
                bodyMarkdown: "hi",
                createdAt,
            },
        ],
    };
}

const noneHidden = new Set<string>();
const noneOrphaned = new Set<string>();

describe("buildRailModel", () => {
    it("orders anchored comments by document position, unanchored at the bottom", () => {
        const model = buildRailModel({
            currentThreads: [
                thread("low", "2020-01-01T00:00:00Z"),
                thread("high", "2020-01-01T00:00:00Z"),
            ],
            generalThreads: [thread("gen", "2020-01-01T00:00:00Z", { general: true })],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map([
                ["high", 100],
                ["low", 800],
            ]),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.orderedAnchoredIds).toEqual(["high", "low"]);
        expect(model.hasAnchoredThreads).toBe(true);
        // Cycle order: anchored (by position) then the general tray.
        expect(model.cycleThreadIds).toEqual(["high", "low", "gen"]);
    });

    it("places the draft at its anchor Y as the newest entry", () => {
        const model = buildRailModel({
            currentThreads: [thread("a", "2020-01-01T00:00:00Z")],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map([["a", 100]]),
            draftY: 100,
            onlyThisFile: false,
        });

        // Same Y as "a" → draft (newest) sorts first.
        expect(model.orderedAnchoredIds).toEqual([DRAFT_ID, "a"]);
        expect(model.kindById.get(DRAFT_ID)).toBe("draft");
        expect(model.kindById.get("a")).toBe("thread");
    });

    // The rail renders the draft balloon with this id, and the article marks the
    // draft's highlighted selection with the same one, so the two stay linked.
    it("lists the in-progress draft between threads at its anchor, under the article's draft id", () => {
        const model = buildRailModel({
            currentThreads: [
                thread("above", "2020-01-01T00:00:00Z"),
                thread("below", "2020-01-01T00:00:00Z"),
            ],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map([
                ["above", 100],
                ["below", 300],
            ]),
            draftY: 200,
            onlyThisFile: false,
        });

        expect(model.orderedAnchoredIds).toEqual(["above", DRAFT_THREAD_ID, "below"]);
        expect(model.kindById.get(DRAFT_THREAD_ID)).toBe("draft");
    });

    it("excludes hidden threads and unresolved-anchor threads from the anchored list", () => {
        const model = buildRailModel({
            currentThreads: [
                thread("shown", "2020-01-01T00:00:00Z"),
                thread("hidden", "2020-01-01T00:00:00Z"),
                thread("orphan", "2020-01-01T00:00:00Z"),
                thread("noY", "2020-01-01T00:00:00Z"),
            ],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: new Set(["hidden"]),
            orphanedThreadIds: new Set(["orphan"]),
            yByThreadId: new Map([
                ["shown", 10],
                ["hidden", 20],
                ["orphan", 30],
                // "noY" intentionally absent → not anchored, not shown in main list.
            ]),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.orderedAnchoredIds).toEqual(["shown"]);
        // The orphaned-anchor thread surfaces in its own tray.
        expect(model.orphanedThreads.map((t) => t.id)).toEqual(["orphan"]);
    });

    it("sorts the unanchored trays newest first", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [
                thread("old", "2020-01-01T00:00:00Z", { general: true }),
                thread("new", "2020-06-01T00:00:00Z", { general: true }),
                thread("mid", "2020-03-01T00:00:00Z", { general: true }),
            ],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.visibleGeneralThreads.map((t) => t.id)).toEqual(["new", "mid", "old"]);
    });

    it("drops the general and orphaned-file trays under 'only this file'", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [thread("gen", "2020-01-01T00:00:00Z", { general: true })],
            orphanedFileThreads: [thread("orf", "2020-01-01T00:00:00Z", { filePath: "/gone.md" })],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: true,
        });

        expect(model.visibleGeneralThreads).toEqual([]);
        expect(model.visibleOrphanedFileThreads).toEqual([]);
        expect(model.hasVisibleComments).toBe(false);
    });

    it("surfaces visible orphaned-file threads (newest first) outside 'only this file'", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [],
            orphanedFileThreads: [
                thread("of-old", "2020-01-01T00:00:00Z", {
                    filePath: "/gone.md",
                }),
                thread("of-new", "2020-05-01T00:00:00Z", {
                    filePath: "/gone.md",
                }),
            ],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.visibleOrphanedFileThreads.map((t) => t.id)).toEqual(["of-new", "of-old"]);
        expect(model.hasVisibleComments).toBe(true);
        expect(model.cycleThreadIds).toEqual(["of-new", "of-old"]);
    });

    it("reports no visible comments for an empty rail", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.hasVisibleComments).toBe(false);
    });

    it("still reports visible comments when the only thread's anchor no longer resolves", () => {
        const model = buildRailModel({
            currentThreads: [thread("o", "2020-01-01T00:00:00Z")],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: new Set(["o"]),
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.hasAnchoredThreads).toBe(false);
        expect(model.hasVisibleComments).toBe(true);
    });

    it("treats a thread with a missing/invalid timestamp as oldest", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [
                thread("dated", "2020-01-01T00:00:00Z", { general: true }),
                thread("undated", "", { general: true }),
            ],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        // No timestamp → epoch 0 → sorts below the dated thread.
        expect(model.visibleGeneralThreads.map((t) => t.id)).toEqual(["dated", "undated"]);
    });

    it("does not count a draft on its own as a comment to show or step through", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: 120,
            onlyThisFile: false,
        });

        expect(model.orderedAnchoredIds).toEqual([DRAFT_ID]);
        expect(model.hasAnchoredThreads).toBe(false);
        expect(model.hasVisibleComments).toBe(false);
        expect(model.cycleThreadIds).toEqual([]);
    });

    it("reports visible comments when only PR-level comments exist", () => {
        const model = buildRailModel({
            currentThreads: [],
            generalThreads: [thread("gen", "2020-01-01T00:00:00Z", { general: true })],
            orphanedFileThreads: [],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: noneOrphaned,
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.hasVisibleComments).toBe(true);
    });

    it("steps through anchored comments, then orphaned-anchor ones (newest first), then the trays", () => {
        const model = buildRailModel({
            currentThreads: [
                thread("anchored", "2020-01-01T00:00:00Z"),
                thread("orphan-old", "2020-01-01T00:00:00Z"),
                thread("orphan-new", "2020-04-01T00:00:00Z"),
            ],
            generalThreads: [thread("gen", "2020-01-01T00:00:00Z", { general: true })],
            orphanedFileThreads: [thread("gone", "2020-01-01T00:00:00Z", { filePath: "/gone.md" })],
            hiddenThreadIds: noneHidden,
            orphanedThreadIds: new Set(["orphan-old", "orphan-new"]),
            yByThreadId: new Map([["anchored", 40]]),
            draftY: 10,
            onlyThisFile: false,
        });

        expect(model.orphanedThreads.map((t) => t.id)).toEqual(["orphan-new", "orphan-old"]);
        expect(model.cycleThreadIds).toEqual([
            "anchored",
            "orphan-new",
            "orphan-old",
            "gen",
            "gone",
        ]);
    });

    it("keeps hidden threads out of every tray", () => {
        const model = buildRailModel({
            currentThreads: [thread("orphan", "2020-01-01T00:00:00Z")],
            generalThreads: [thread("gen", "2020-01-01T00:00:00Z", { general: true })],
            orphanedFileThreads: [thread("gone", "2020-01-01T00:00:00Z", { filePath: "/gone.md" })],
            hiddenThreadIds: new Set(["orphan", "gen", "gone"]),
            orphanedThreadIds: new Set(["orphan"]),
            yByThreadId: new Map(),
            draftY: null,
            onlyThisFile: false,
        });

        expect(model.orphanedThreads).toEqual([]);
        expect(model.visibleGeneralThreads).toEqual([]);
        expect(model.visibleOrphanedFileThreads).toEqual([]);
        expect(model.hasVisibleComments).toBe(false);
    });
});
