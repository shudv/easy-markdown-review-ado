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
  it("labels the copy outcome only once it's known", () => {
    expect(selectionLinkResultLabel("idle")).toBeNull();
    expect(selectionLinkResultLabel("pending")).toBeNull();
    expect(selectionLinkResultLabel("copied")).toBe("Link copied");
    expect(selectionLinkResultLabel("failed")).toBe("Couldn't copy link");
  });

  it("flags the outcome on the link button class", () => {
    expect(selectionLinkButtonClass("idle")).toBe("emr-selection-bubble-link");
    expect(selectionLinkButtonClass("copied")).toBe(
      "emr-selection-bubble-link is-copied",
    );
    expect(selectionLinkButtonClass("failed")).toBe(
      "emr-selection-bubble-link is-failed",
    );
  });
});

describe("Balloon helpers", () => {
  it("labels every display status", () => {
    expect(balloonStatusLabel("active")).toBe("Active");
    expect(balloonStatusLabel("resolved")).toBe("Resolved");
    expect(balloonStatusLabel("wontFix")).toBe("Won't fix");
    expect(balloonStatusLabel("closed")).toBe("Closed");
    expect(balloonStatusLabel("pending")).toBe("Pending");
    expect(balloonStatusLabel("orphaned")).toBe("Anchor missing");
  });

  it("builds the class list in a stable order", () => {
    expect(balloonClassName({ isActive: false, resolved: false })).toBe(
      "emr-balloon",
    );
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

  it("positions only non-inline balloons", () => {
    expect(balloonStyle(true, 40)).toEqual({});
    expect(balloonStyle(false, 40)).toEqual({ top: 40 });
    expect(balloonStyle(undefined, undefined)).toEqual({ top: 0 });
  });
});

describe("CommentRail layout", () => {
  it("places the draft only while it can be shown", () => {
    expect(railDraftY(false, anchor, 12)).toBe(12);
    expect(railDraftY(true, anchor, 12)).toBeNull();
    expect(railDraftY(false, null, 12)).toBeNull();
    expect(railDraftY(false, anchor, null)).toBeNull();
  });

  it("expands a tray when opened, active, or matched by search", () => {
    const threads = [thread("a")];
    const base = {
      collapsed: true,
      threads,
      activeThreadId: null,
      searchActive: false,
    };
    expect(isRailTrayExpanded(base)).toBe(false);
    expect(isRailTrayExpanded({ ...base, collapsed: false })).toBe(true);
    expect(isRailTrayExpanded({ ...base, activeThreadId: "a" })).toBe(true);
    expect(isRailTrayExpanded({ ...base, activeThreadId: "b" })).toBe(false);
    expect(isRailTrayExpanded({ ...base, searchActive: true })).toBe(true);
    expect(
      isRailTrayExpanded({ ...base, threads: [], searchActive: true }),
    ).toBe(false);
  });

  it("shows the header for writers, comments, or a visible routed PR", () => {
    const base = {
      readOnly: true,
      totalCommentCount: 0,
      orphanedFileThreadCount: 0,
      hasRoutedPr: false,
      hidePrPill: undefined,
    };
    expect(shouldShowRailHeader(base)).toBe(false);
    expect(shouldShowRailHeader({ ...base, readOnly: false })).toBe(true);
    expect(shouldShowRailHeader({ ...base, totalCommentCount: 1 })).toBe(true);
    expect(shouldShowRailHeader({ ...base, orphanedFileThreadCount: 1 })).toBe(
      true,
    );
    expect(shouldShowRailHeader({ ...base, hasRoutedPr: true })).toBe(true);
    expect(
      shouldShowRailHeader({ ...base, hasRoutedPr: true, hidePrPill: true }),
    ).toBe(false);
  });

  it("only offers empty-state copy when nothing is anchored and no draft", () => {
    const model = {
      orderedAnchoredIds: [] as string[],
      orphanedThreads: [] as CommentThread[],
      visibleGeneralThreads: [] as CommentThread[],
      visibleOrphanedFileThreads: [] as CommentThread[],
    };
    const opts = {
      hasDraft: false,
      commentQuery: "",
      filterMode: "all" as const,
      fileThreadCount: 0,
      readOnly: false,
    };
    expect(
      railEmptyMessageFor({ ...model, orderedAnchoredIds: ["a"] }, opts),
    ).toBeNull();
    expect(railEmptyMessageFor(model, { ...opts, hasDraft: true })).toBeNull();
    expect(railEmptyMessageFor(model, { ...opts, commentQuery: "x" })).toBe(
      "No comments match \u201cx\u201d.",
    );
    const withOther = railEmptyMessageFor(
      { ...model, visibleGeneralThreads: [thread("g")] },
      opts,
    );
    const withoutOther = railEmptyMessageFor(model, opts);
    expect(withOther).not.toBe(withoutOther);
  });
});

describe("CommentRow helpers", () => {
  it("gates edit/delete on own comments in interactive rows", () => {
    expect(
      commentRowPermissions({
        isOwn: true,
        interactive: true,
        isFirst: false,
        canLink: false,
      }),
    ).toEqual({
      canEdit: true,
      canDelete: true,
      canReact: true,
      hasMenuItems: true,
    });
    expect(
      commentRowPermissions({
        isOwn: true,
        interactive: false,
        isFirst: false,
        canLink: false,
      }),
    ).toEqual({
      canEdit: false,
      canDelete: false,
      canReact: false,
      hasMenuItems: false,
    });
  });

  it("has menu items for a link, or thread actions on the first comment", () => {
    const base = { isOwn: false, interactive: true, isFirst: false };
    expect(
      commentRowPermissions({ ...base, canLink: false }).hasMenuItems,
    ).toBe(false);
    expect(commentRowPermissions({ ...base, canLink: true }).hasMenuItems).toBe(
      true,
    );
    expect(
      commentRowPermissions({ ...base, isFirst: true, canLink: false })
        .hasMenuItems,
    ).toBe(true);
  });

  it("summarizes like reactions for the viewer", () => {
    expect(summarizeLikes(undefined, "me")).toMatchObject({
      likedByMe: false,
      likeCount: 0,
    });
    const users = [
      { id: "me", displayName: "Me" },
      { id: "you", displayName: "You" },
    ];
    expect(summarizeLikes([{ kind: "like", users }], "me")).toMatchObject({
      likedByMe: true,
      likeCount: 2,
    });
    expect(summarizeLikes([{ kind: "like", users }], "them")).toMatchObject({
      likedByMe: false,
      likeCount: 2,
    });
  });

  it("labels the link item by copy outcome", () => {
    expect(commentLinkLabel("idle")).toBe("Link to comment");
    expect(commentLinkLabel("copied")).toBe("Link copied");
    expect(commentLinkLabel("failed")).toBe("Couldn't copy link");
  });

  it("formats timestamps, passing invalid input through", () => {
    expect(formatFullTime("not a date")).toBe("not a date");
    expect(formatFullTime("2026-05-11T11:41:00Z")).toContain(" at ");
  });
});
