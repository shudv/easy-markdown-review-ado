import { describe, expect, it } from "vitest";

import {
    COMMENT_FILTER_MODES,
    commentFilterLabel,
    commentFilterOptions,
    countCommentFilters,
    isMyThread,
    threadMatchesFilter,
    threadMatchesQuery,
    threadVisibleForCommentView,
    type CommentFilterMode,
} from "../src/shell/components/commentFilter";
import type { Comment, CommentThread, ThreadStatus } from "../src/types";

const ME = "user-me";
const OTHER = "user-other";

function comment(authorId: string, id = "c1"): Comment {
    return {
        id,
        author: { id: authorId, displayName: authorId, initials: "XX" },
        bodyMarkdown: "hi",
        createdAt: "2026-01-01T00:00:00Z",
    };
}

function thread(id: string, status: ThreadStatus, authorIds: string[]): CommentThread {
    return {
        id,
        filePath: "/doc.md",
        anchor: { exact: "x", prefix: "", suffix: "" },
        status,
        comments: authorIds.map((a, i) => comment(a, `${id}-c${i}`)),
    };
}

describe("isMyThread", () => {
    it("is true when the user authored any comment in the thread", () => {
        expect(isMyThread(thread("t", "active", [OTHER, ME]), ME)).toBe(true);
    });
    it("is false when the user authored none", () => {
        expect(isMyThread(thread("t", "active", [OTHER, OTHER]), ME)).toBe(false);
    });
});

describe("threadMatchesFilter", () => {
    const AUTHOR_IDS = { me: ME, "a teammate": OTHER };

    it.each([
        { mode: "all", status: "active", author: "a teammate", shown: true },
        { mode: "all", status: "closed", author: "a teammate", shown: true },
        { mode: "active", status: "active", author: "a teammate", shown: true },
        { mode: "active", status: "pending", author: "a teammate", shown: true },
        { mode: "active", status: "resolved", author: "a teammate", shown: false },
        { mode: "active", status: "closed", author: "a teammate", shown: false },
        { mode: "resolved", status: "resolved", author: "a teammate", shown: true },
        { mode: "resolved", status: "closed", author: "a teammate", shown: true },
        { mode: "resolved", status: "active", author: "a teammate", shown: false },
        { mode: "mine", status: "resolved", author: "me", shown: true },
        { mode: "mine", status: "active", author: "a teammate", shown: false },
    ] satisfies Array<{
        mode: CommentFilterMode;
        status: ThreadStatus;
        author: "me" | "a teammate";
        shown: boolean;
    }>)(
        "$mode filter shows a $status thread by $author: $shown",
        ({ mode, status, author, shown }) => {
            expect(threadMatchesFilter(thread("t", status, [AUTHOR_IDS[author]]), mode, ME)).toBe(
                shown,
            );
        },
    );
});

describe("comment search", () => {
    const resolved = thread("r", "resolved", [OTHER]);
    resolved.comments[0]!.bodyMarkdown = "Already addressed in the revision";
    resolved.comments[0]!.author.displayName = "Alex Rivera";

    it.each([
        {
            name: "a word from the body, ignoring case and padding",
            query: "  ADDRESSED ",
            hit: true,
        },
        { name: "the author's name", query: "alex rivera", hit: true },
        { name: "text that appears nowhere", query: "missing", hit: false },
        { name: "a blank query", query: "   ", hit: true },
    ])("matching $name: $hit", ({ query, hit }) => {
        expect(threadMatchesQuery(resolved, query)).toBe(hit);
    });

    it("finds a resolved thread while searching even though the Active filter hides it", () => {
        expect(threadVisibleForCommentView(resolved, "addressed", "active", ME)).toBe(true);
    });

    it("finds a thread when only a reply mentions the search term", () => {
        const discussion = thread("d", "active", [OTHER, ME]);
        discussion.comments[0]!.bodyMarkdown = "Looks good overall";
        discussion.comments[1]!.bodyMarkdown = "Please rename the helper first";

        expect(threadMatchesQuery(discussion, "rename")).toBe(true);
    });

    it.each([
        { name: "cleared", query: "" },
        { name: "left holding only spaces", query: "   " },
    ])("applies the Active filter again once the search is $name", ({ query }) => {
        expect(threadVisibleForCommentView(resolved, query, "active", ME)).toBe(false);
    });
});

describe("countCommentFilters", () => {
    it("counts each thread under every filter it appears in, as Azure DevOps does", () => {
        const threads = [
            thread("a", "active", [OTHER]),
            thread("p", "pending", [ME]),
            thread("r", "resolved", [OTHER]),
            thread("c", "closed", [ME]),
            thread("m", "active", [ME, OTHER]),
        ];

        expect(countCommentFilters(threads, ME)).toEqual({
            all: 5,
            active: 3, // a, p, m
            resolved: 2, // r, c
            mine: 3, // p, c, m
        });
    });

    it("returns zeroes for an empty population", () => {
        expect(countCommentFilters([], ME)).toEqual({
            all: 0,
            active: 0,
            resolved: 0,
            mine: 0,
        });
    });
});

describe("commentFilterOptions + labels", () => {
    it("builds ordered options carrying each bucket's count", () => {
        const counts = { all: 5, active: 3, resolved: 2, mine: 1 };
        const opts = commentFilterOptions(counts);
        expect(opts.map((o) => o.mode)).toEqual(COMMENT_FILTER_MODES);
        expect(opts.map((o) => o.count)).toEqual([5, 3, 2, 1]);
        expect(opts.map((o) => o.label)).toEqual([
            "All comments",
            "Active comments",
            "Resolved comments",
            "My comments",
        ]);
    });

    it("names the selected mode on the filter trigger", () => {
        expect(commentFilterLabel("mine")).toBe("My comments");
    });
});
