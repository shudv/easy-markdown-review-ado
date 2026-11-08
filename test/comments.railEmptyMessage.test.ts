import { describe, expect, it } from "vitest";

import { chooseRailEmptyMessage } from "../src/shell/components/CommentRail.helpers";

const base = {
    commentQuery: "",
    filterMode: "all" as const,
    fileThreadCount: 0,
    hasOtherSections: false,
    readOnly: false,
};

describe("chooseRailEmptyMessage", () => {
    it("prioritises the active search query", () => {
        expect(chooseRailEmptyMessage({ ...base, commentQuery: "needle" })).toBe(
            "No comments match \u201cneedle\u201d.",
        );
    });

    // The rail header already names the active filter, so an empty line adds nothing.
    it.each([
        { filterMode: "active", fileThreadCount: 2 },
        { filterMode: "resolved", fileThreadCount: 3 },
        { filterMode: "mine", fileThreadCount: 4 },
    ] as const)(
        "stays silent when the $filterMode filter hides every thread",
        ({ filterMode, fileThreadCount }) => {
            expect(chooseRailEmptyMessage({ ...base, filterMode, fileThreadCount })).toBeNull();
        },
    );

    it("does not blame the filter when it is showing everything", () => {
        // filterMode 'all' can't be hiding anything, so an empty rail falls through
        // to the starter invite rather than a filter explanation.
        expect(
            chooseRailEmptyMessage({
                ...base,
                filterMode: "all",
                fileThreadCount: 2,
            }),
        ).toBe("No comments on this file yet. Select any text to start a thread.");
    });

    it("stays silent when threads live in other trays", () => {
        expect(chooseRailEmptyMessage({ ...base, hasOtherSections: true })).toBeNull();
    });

    it("still invites a thread on a file with no comments while a narrowing filter is selected", () => {
        expect(chooseRailEmptyMessage({ ...base, filterMode: "active", fileThreadCount: 0 })).toBe(
            "No comments on this file yet. Select any text to start a thread.",
        );
    });

    it("invites a thread on a genuinely empty writable file", () => {
        expect(chooseRailEmptyMessage(base)).toBe(
            "No comments on this file yet. Select any text to start a thread.",
        );
    });

    it("uses a terse message on an empty read-only file", () => {
        expect(chooseRailEmptyMessage({ ...base, readOnly: true })).toBe(
            "No comments on this file.",
        );
    });
});
