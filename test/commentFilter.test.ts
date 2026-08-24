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

function thread(
  id: string,
  status: ThreadStatus,
  authorIds: string[],
): CommentThread {
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
  const active = thread("a", "active", [OTHER]);
  const pending = thread("p", "pending", [OTHER]);
  const resolved = thread("r", "resolved", [OTHER]);
  const closed = thread("c", "closed", [OTHER]);
  const mine = thread("m", "resolved", [ME]);

  it("all: matches every thread", () => {
    for (const t of [active, pending, resolved, closed, mine]) {
      expect(threadMatchesFilter(t, "all", ME)).toBe(true);
    }
  });

  it("active: matches non-resolved-like statuses only", () => {
    expect(threadMatchesFilter(active, "active", ME)).toBe(true);
    expect(threadMatchesFilter(pending, "active", ME)).toBe(true);
    expect(threadMatchesFilter(resolved, "active", ME)).toBe(false);
    expect(threadMatchesFilter(closed, "active", ME)).toBe(false);
  });

  it("resolved: matches resolved-like statuses only", () => {
    expect(threadMatchesFilter(resolved, "resolved", ME)).toBe(true);
    expect(threadMatchesFilter(closed, "resolved", ME)).toBe(true);
    expect(threadMatchesFilter(active, "resolved", ME)).toBe(false);
  });

  it("mine: matches threads the user participated in, regardless of status", () => {
    expect(threadMatchesFilter(mine, "mine", ME)).toBe(true);
    expect(threadMatchesFilter(active, "mine", ME)).toBe(false);
  });
});

describe("comment search", () => {
  const resolved = thread("r", "resolved", [OTHER]);
  resolved.comments[0]!.bodyMarkdown = "Already addressed in the revision";
  resolved.comments[0]!.author.displayName = "Alex Rivera";

  it("matches body and author without case sensitivity", () => {
    expect(threadMatchesQuery(resolved, "  ADDRESSED ")).toBe(true);
    expect(threadMatchesQuery(resolved, "alex rivera")).toBe(true);
    expect(threadMatchesQuery(resolved, "missing")).toBe(false);
    expect(threadMatchesQuery(resolved, "   ")).toBe(true);
  });

  it("searches every status while an empty query uses the active filter", () => {
    expect(
      threadVisibleForCommentView(resolved, "addressed", "active", ME),
    ).toBe(true);
    expect(threadVisibleForCommentView(resolved, "", "active", ME)).toBe(false);
  });
});

describe("countCommentFilters", () => {
  it("tallies overlapping buckets in one pass", () => {
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

  it("labels every mode", () => {
    const modes: CommentFilterMode[] = ["all", "active", "resolved", "mine"];
    for (const m of modes) {
      expect(commentFilterLabel(m).length).toBeGreaterThan(0);
    }
  });
});
