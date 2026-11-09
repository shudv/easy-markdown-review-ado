// Comment rail layout decisions (src/shell/components/CommentRail.layout.ts):
// cross-file trays and the empty-state copy, beyond the basics covered with
// the other rail helpers.

import { describe, expect, it } from "vitest";

import {
    isRailTrayExpanded,
    railEmptyMessageFor,
} from "../src/shell/components/CommentRail.layout";
import type { CommentThread } from "../src/types";

const thread = (id: string) => ({ id }) as CommentThread;

describe("a collapsed cross-file tray", () => {
    it("opens when the active thread is one of several it holds", () => {
        expect(
            isRailTrayExpanded({
                collapsed: true,
                threads: [thread("a"), thread("b"), thread("c")],
                activeThreadId: "b",
                searchActive: false,
            }),
        ).toBe(true);
    });
});

describe("the rail's empty-state copy", () => {
    const emptyRail = {
        orderedAnchoredIds: [] as string[],
        orphanedThreads: [] as CommentThread[],
        visibleGeneralThreads: [] as CommentThread[],
        visibleOrphanedFileThreads: [] as CommentThread[],
    };

    const opts = {
        hasDraft: false,
        commentQuery: "",
        filterMode: "all" as const,
        readOnly: false,
    };

    it.each([
        {
            name: "threads whose quoted text is gone are listed below",
            rail: { ...emptyRail, orphanedThreads: [thread("o")] },
            fileThreadCount: 1,
        },
        {
            name: "threads on files removed from the PR are listed below",
            rail: { ...emptyRail, visibleOrphanedFileThreads: [thread("f")] },
            fileThreadCount: 0,
        },
    ])("is not shown when $name", ({ rail, fileThreadCount }) => {
        expect(railEmptyMessageFor(rail, { ...opts, fileThreadCount })).toBeNull();
    });
});
