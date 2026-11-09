import { describe, expect, it } from "vitest";

import {
    balloonClassName,
    balloonStatusLabel,
    balloonStyle,
} from "../src/shell/components/Balloon.helpers";
import {
    isRailTrayExpanded,
    railDraftY,
    railEmptyMessageFor,
    shouldShowRailHeader,
} from "../src/shell/components/CommentRail.layout";
import {
    commentLinkLabel,
    commentRowPermissions,
    formatFullTime,
    summarizeLikes,
} from "../src/shell/components/CommentRow.helpers";
import {
    selectionLinkButtonClass,
    selectionLinkResultLabel,
} from "../src/shell/components/SelectionBubble.helpers";
import type { CommentThread, TextQuoteAnchor } from "../src/types";

const anchor: TextQuoteAnchor = { exact: "quoted" } as TextQuoteAnchor;
const thread = (id: string) => ({ id }) as CommentThread;

describe("SelectionBubble helpers", () => {
    it.each([
        ["idle", null],
        ["pending", null],
        ["copied", "Link copied"],
        ["failed", "Couldn't copy link"],
    ] as const)("announces a %s copy as %j", (outcome, label) => {
        expect(selectionLinkResultLabel(outcome)).toBe(label);
    });

    it.each([
        ["idle", "emr-selection-bubble-link"],
        ["copied", "emr-selection-bubble-link is-copied"],
        ["failed", "emr-selection-bubble-link is-failed"],
    ] as const)("styles the link button after a %s copy as %s", (outcome, className) => {
        expect(selectionLinkButtonClass(outcome)).toBe(className);
    });
});

describe("Balloon helpers", () => {
    it.each([
        ["active", "Active"],
        ["resolved", "Resolved"],
        ["wontFix", "Won't fix"],
        ["closed", "Closed"],
        ["pending", "Pending"],
        ["orphaned", "Anchor missing"],
    ] as const)("labels a %s thread %s", (status, label) => {
        expect(balloonStatusLabel(status)).toBe(label);
    });

    it("styles a plain balloon with the base class only", () => {
        expect(balloonClassName({ isActive: false, resolved: false })).toBe("emr-balloon");
    });

    it("adds a class for each state of an inline, active, resolved, orphaned general balloon", () => {
        expect(
            balloonClassName({
                inline: true,
                isActive: true,
                resolved: true,
                isOrphaned: true,
                general: true,
            }),
        ).toBe("emr-balloon inline is-active is-resolved is-orphaned is-general");
    });

    it.each([
        { name: "an inline balloon flows with the text", inline: true, top: 40, style: {} },
        { name: "a rail balloon sits at its anchor", inline: false, top: 40, style: { top: 40 } },
        {
            name: "an unmeasured rail balloon sits at the top",
            inline: undefined,
            top: undefined,
            style: { top: 0 },
        },
    ])("$name", ({ inline, top, style }) => {
        expect(balloonStyle(inline, top)).toEqual(style);
    });
});

describe("CommentRail layout", () => {
    it("places the draft at its anchor while the rail is open", () => {
        expect(railDraftY(false, anchor, 12)).toBe(12);
    });

    it.each([
        { name: "the rail is collapsed", collapsed: true, draft: anchor, y: 12 },
        { name: "there is no draft", collapsed: false, draft: null, y: 12 },
        {
            name: "the draft's anchor is not measured yet",
            collapsed: false,
            draft: anchor,
            y: null,
        },
    ])("hides the draft when $name", ({ collapsed, draft, y }) => {
        expect(railDraftY(collapsed, draft, y)).toBeNull();
    });

    const tray = {
        collapsed: true,
        threads: [thread("a")],
        activeThreadId: null,
        searchActive: false,
    };

    it.each([
        { name: "stays closed by default", state: tray, expanded: false },
        {
            name: "opens when the user expands it",
            state: { ...tray, collapsed: false },
            expanded: true,
        },
        {
            name: "opens when it holds the active thread",
            state: { ...tray, activeThreadId: "a" },
            expanded: true,
        },
        {
            name: "stays closed when another thread is active",
            state: { ...tray, activeThreadId: "b" },
            expanded: false,
        },
        {
            name: "opens while a search matches its threads",
            state: { ...tray, searchActive: true },
            expanded: true,
        },
        {
            name: "stays closed during a search when it has no matches",
            state: { ...tray, threads: [], searchActive: true },
            expanded: false,
        },
    ])("a collapsed tray $name", ({ state, expanded }) => {
        expect(isRailTrayExpanded(state)).toBe(expanded);
    });

    const header = {
        readOnly: true,
        totalCommentCount: 0,
        orphanedFileThreadCount: 0,
        hasRoutedPr: false,
        hidePrPill: undefined,
    };

    it.each([
        { name: "hides for a reader of a file without comments", state: header, shown: false },
        {
            name: "shows for someone who can comment",
            state: { ...header, readOnly: false },
            shown: true,
        },
        {
            name: "shows when the file has comments",
            state: { ...header, totalCommentCount: 1 },
            shown: true,
        },
        {
            name: "shows when the file has orphaned threads",
            state: { ...header, orphanedFileThreadCount: 1 },
            shown: true,
        },
        { name: "shows for a routed PR", state: { ...header, hasRoutedPr: true }, shown: true },
        {
            name: "hides when the routed PR's pill is hidden",
            state: { ...header, hasRoutedPr: true, hidePrPill: true },
            shown: false,
        },
    ])("the rail header $name", ({ state, shown }) => {
        expect(shouldShowRailHeader(state)).toBe(shown);
    });

    const emptyRail = {
        orderedAnchoredIds: [] as string[],
        orphanedThreads: [] as CommentThread[],
        visibleGeneralThreads: [] as CommentThread[],
        visibleOrphanedFileThreads: [] as CommentThread[],
    };

    const emptyOpts = {
        hasDraft: false,
        commentQuery: "",
        filterMode: "all" as const,
        fileThreadCount: 0,
        readOnly: false,
    };

    it.each([
        {
            name: "anchored comments are shown",
            rail: { ...emptyRail, orderedAnchoredIds: ["a"] },
            opts: emptyOpts,
        },
        { name: "a draft is open", rail: emptyRail, opts: { ...emptyOpts, hasDraft: true } },
        {
            name: "general comments are shown below",
            rail: { ...emptyRail, visibleGeneralThreads: [thread("g")] },
            opts: emptyOpts,
        },
    ])("shows no empty-state copy when $name", ({ rail, opts }) => {
        expect(railEmptyMessageFor(rail, opts)).toBeNull();
    });

    it("says no comments match a search that found nothing", () => {
        expect(railEmptyMessageFor(emptyRail, { ...emptyOpts, commentQuery: "x" })).toBe(
            "No comments match \u201cx\u201d.",
        );
    });

    it("invites a new thread on a file without comments", () => {
        expect(railEmptyMessageFor(emptyRail, emptyOpts)).toBe(
            "No comments on this file yet. Select any text to start a thread.",
        );
    });
});

describe("CommentRow helpers", () => {
    it("lets the author edit, delete and react in an interactive row", () => {
        expect(
            commentRowPermissions({
                isOwn: true,
                interactive: true,
                isFirst: false,
                canLink: false,
            }),
        ).toEqual({ canEdit: true, canDelete: true, canReact: true, hasMenuItems: true });
    });

    it("offers nothing in a non-interactive row, even to the author", () => {
        expect(
            commentRowPermissions({
                isOwn: true,
                interactive: false,
                isFirst: false,
                canLink: false,
            }),
        ).toEqual({ canEdit: false, canDelete: false, canReact: false, hasMenuItems: false });
    });

    const someoneElses = { isOwn: false, interactive: true, isFirst: false, canLink: false };

    it.each([
        { name: "has no menu for a reply without a link", row: someoneElses, hasMenu: false },
        {
            name: "has a menu to copy the comment's link",
            row: { ...someoneElses, canLink: true },
            hasMenu: true,
        },
        {
            name: "has a menu with thread actions on the first comment",
            row: { ...someoneElses, isFirst: true },
            hasMenu: true,
        },
    ])("another user's comment $name", ({ row, hasMenu }) => {
        expect(commentRowPermissions(row).hasMenuItems).toBe(hasMenu);
    });

    const likers = [
        { id: "me", displayName: "Me" },
        { id: "you", displayName: "You" },
    ];

    it.each([
        { name: "nobody liked", reactions: undefined, viewer: "me", liked: false, count: 0 },
        {
            name: "the viewer liked",
            reactions: [{ kind: "like" as const, users: likers }],
            viewer: "me",
            liked: true,
            count: 2,
        },
        {
            name: "others liked",
            reactions: [{ kind: "like" as const, users: likers }],
            viewer: "them",
            liked: false,
            count: 2,
        },
    ])("summarizes likes when $name", ({ reactions, viewer, liked, count }) => {
        expect(summarizeLikes(reactions, viewer)).toMatchObject({
            likedByMe: liked,
            likeCount: count,
        });
    });

    it.each([
        ["idle", "Link to comment"],
        ["copied", "Link copied"],
        ["failed", "Couldn't copy link"],
    ] as const)("labels the link item after a %s copy as %s", (outcome, label) => {
        expect(commentLinkLabel(outcome)).toBe(label);
    });

    it("formats a timestamp as a full date and time", () => {
        expect(formatFullTime("2026-05-11T11:41:00Z")).toContain(" at ");
    });

    it("names the month and leaves out the seconds, like the rail's other timestamps", () => {
        const out = formatFullTime(new Date(2026, 4, 11, 11, 41, 30).toISOString());
        expect(out).toContain("2026");
        expect(out).not.toMatch(/\d\/\d/);
        expect(out).not.toMatch(/\d:\d\d:\d\d/);
    });

    it("shows an unparseable timestamp as-is", () => {
        expect(formatFullTime("not a date")).toBe("not a date");
    });
});
