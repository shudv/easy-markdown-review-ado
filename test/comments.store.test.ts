// Tests for the thread reducer in `src/comments/store.ts`. Pure
// state transitions — no DOM, no React — so we can exercise every
// branch without setting up a renderer.

import { describe, expect, it } from "vitest";

import {
  initialThreadState,
  makeNewThread,
  selectGeneralThreads,
  selectThreadsByFile,
  threadReducer,
  type ThreadAction,
  type ThreadState,
} from "../src/comments/store";
import type {
  Comment,
  CommentAuthor,
  CommentThread,
  Reaction,
  ReactionKind,
  TextQuoteAnchor,
} from "../src/types";

const AUTHOR: CommentAuthor = {
  id: "u1",
  displayName: "Alice Anderson",
  initials: "AA",
};
const OTHER_AUTHOR: CommentAuthor = {
  id: "u2",
  displayName: "Bob Brown",
  initials: "BB",
};

/** Compact reaction builder for tests (display name mirrors the id). */
function rx(kind: string, ...ids: string[]): Reaction {
  return {
    kind: kind as ReactionKind,
    users: ids.map((id) => ({ id, displayName: id })),
  };
}

function anchor(exact = "hello"): TextQuoteAnchor {
  return { exact, prefix: "", suffix: "" };
}

function buildThread(
  id: string,
  filePath = "docs/a.md",
  comments: Comment[] = [
    {
      id: `${id}-c1`,
      author: AUTHOR,
      bodyMarkdown: "first",
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ],
): CommentThread {
  return {
    id,
    filePath,
    anchor: anchor(),
    status: "active",
    comments,
  };
}

describe("initialThreadState", () => {
  it("returns an empty store when no seed is given", () => {
    const s = initialThreadState();
    expect(s.order).toEqual([]);
    expect(s.threadsById).toEqual({});
  });

  it("preserves seed order", () => {
    const t1 = buildThread("t1");
    const t2 = buildThread("t2", "docs/b.md");
    const s = initialThreadState([t1, t2]);
    expect(s.order).toEqual(["t1", "t2"]);
    expect(s.threadsById.t1).toBe(t1);
    expect(s.threadsById.t2).toBe(t2);
  });
});

describe("threadReducer ADD_THREAD", () => {
  it("prepends new threads (newest first)", () => {
    const t1 = buildThread("t1");
    const t2 = buildThread("t2");
    let s: ThreadState = initialThreadState();
    s = threadReducer(s, { type: "ADD_THREAD", thread: t1 });
    s = threadReducer(s, { type: "ADD_THREAD", thread: t2 });
    expect(s.order).toEqual(["t2", "t1"]);
  });

  it("is idempotent for an already-known thread id", () => {
    const t1 = buildThread("t1");
    const t1Dup = { ...t1, status: "resolved" as const };
    let s = initialThreadState([t1]);
    const before = s;
    s = threadReducer(s, { type: "ADD_THREAD", thread: t1Dup });
    expect(s).toBe(before);
  });
});

describe("threadReducer ADD_REPLY", () => {
  it("appends a reply to the existing thread", () => {
    const t = buildThread("t1");
    let s = initialThreadState([t]);
    const reply: Comment = {
      id: "t1-c2",
      author: OTHER_AUTHOR,
      bodyMarkdown: "reply",
      createdAt: "2024-01-02T00:00:00.000Z",
    };
    s = threadReducer(s, { type: "ADD_REPLY", threadId: "t1", comment: reply });
    expect(s.threadsById.t1?.comments.map((c) => c.id)).toEqual([
      "t1-c1",
      "t1-c2",
    ]);
  });

  it("is a no-op for unknown threads", () => {
    const t = buildThread("t1");
    const s = initialThreadState([t]);
    const next = threadReducer(s, {
      type: "ADD_REPLY",
      threadId: "missing",
      comment: { ...t.comments[0]!, id: "x" },
    });
    expect(next).toBe(s);
  });
});

describe("threadReducer EDIT_COMMENT", () => {
  it("rewrites just the target comment and stamps updatedAt", () => {
    const t = buildThread("t1");
    let s = initialThreadState([t]);
    s = threadReducer(s, {
      type: "EDIT_COMMENT",
      threadId: "t1",
      commentId: "t1-c1",
      newBodyMarkdown: "edited body",
      updatedAt: "2024-02-01T00:00:00.000Z",
    });
    const c = s.threadsById.t1!.comments[0]!;
    expect(c.bodyMarkdown).toBe("edited body");
    expect(c.updatedAt).toBe("2024-02-01T00:00:00.000Z");
  });

  it("is a no-op for unknown thread", () => {
    const s = initialThreadState([buildThread("t1")]);
    const next = threadReducer(s, {
      type: "EDIT_COMMENT",
      threadId: "missing",
      commentId: "x",
      newBodyMarkdown: "x",
      updatedAt: "x",
    });
    expect(next).toBe(s);
  });

  it("is a no-op for unknown comment id within a known thread", () => {
    const s = initialThreadState([buildThread("t1")]);
    const next = threadReducer(s, {
      type: "EDIT_COMMENT",
      threadId: "t1",
      commentId: "missing",
      newBodyMarkdown: "x",
      updatedAt: "y",
    });
    // The store object is rebuilt but the comment array contents are equivalent.
    expect(next.threadsById.t1!.comments).toEqual(s.threadsById.t1!.comments);
  });
});

describe("threadReducer DELETE_COMMENT", () => {
  it("removes a single comment when the thread has more than one", () => {
    const t = buildThread("t1", "f.md", [
      { id: "c1", author: AUTHOR, bodyMarkdown: "a", createdAt: "1" },
      { id: "c2", author: AUTHOR, bodyMarkdown: "b", createdAt: "2" },
    ]);
    let s = initialThreadState([t]);
    s = threadReducer(s, {
      type: "DELETE_COMMENT",
      threadId: "t1",
      commentId: "c1",
    });
    expect(s.threadsById.t1!.comments.map((c) => c.id)).toEqual(["c2"]);
  });

  it("removes the entire thread when the last comment is deleted", () => {
    let s = initialThreadState([buildThread("t1")]);
    s = threadReducer(s, {
      type: "DELETE_COMMENT",
      threadId: "t1",
      commentId: "t1-c1",
    });
    expect(s.threadsById.t1).toBeUndefined();
    expect(s.order).toEqual([]);
  });

  it("is a no-op for unknown thread", () => {
    const s = initialThreadState([buildThread("t1")]);
    expect(
      threadReducer(s, {
        type: "DELETE_COMMENT",
        threadId: "missing",
        commentId: "x",
      }),
    ).toBe(s);
  });
});

describe("threadReducer TOGGLE_REACTION", () => {
  function withReaction(): ThreadState {
    return initialThreadState([buildThread("t1")]);
  }

  it("adds a brand-new reaction entry on first toggle", () => {
    let s = withReaction();
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    const r = s.threadsById.t1!.comments[0]!.reactions!;
    expect(r).toEqual([
      { kind: "like", users: [{ id: "u1", displayName: "User One" }] },
    ]);
  });

  it("adds a new user to an existing reaction entry", () => {
    let s = withReaction();
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u2",
      displayName: "User Two",
    });
    const r = s.threadsById.t1!.comments[0]!.reactions!;
    expect(r).toEqual([
      {
        kind: "like",
        users: [
          { id: "u1", displayName: "User One" },
          { id: "u2", displayName: "User Two" },
        ],
      },
    ]);
  });

  it("removes the user and drops the entry when they were the last reactor", () => {
    let s = withReaction();
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    expect(s.threadsById.t1!.comments[0]!.reactions).toEqual([]);
  });

  it("removes one user but keeps the entry when others remain", () => {
    let s = withReaction();
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u2",
      displayName: "User Two",
    });
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    expect(s.threadsById.t1!.comments[0]!.reactions).toEqual([
      { kind: "like", users: [{ id: "u2", displayName: "User Two" }] },
    ]);
  });

  it("updates one reaction kind while leaving other kinds intact", () => {
    let s = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "first",
          createdAt: "2024-01-01T00:00:00.000Z",
          reactions: [
            { kind: "like", users: [{ id: "u1", displayName: "User One" }] },
            {
              kind: "celebrate" as ReactionKind,
              users: [{ id: "u2", displayName: "User Two" }],
            },
          ],
        },
      ]),
    ]);
    s = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "t1-c1",
      kind: "like",
      userId: "u3",
      displayName: "User Three",
    });
    // The non-matching `celebrate` entry is passed through untouched.
    expect(s.threadsById.t1!.comments[0]!.reactions).toEqual([
      {
        kind: "like",
        users: [
          { id: "u1", displayName: "User One" },
          { id: "u3", displayName: "User Three" },
        ],
      },
      {
        kind: "celebrate",
        users: [{ id: "u2", displayName: "User Two" }],
      },
    ]);
  });

  it("is a no-op for unknown thread or unknown comment", () => {
    const s = withReaction();
    expect(
      threadReducer(s, {
        type: "TOGGLE_REACTION",
        threadId: "missing",
        commentId: "x",
        kind: "like",
        userId: "u1",
        displayName: "User One",
      }),
    ).toBe(s);
    // Unknown comment id leaves comments untouched.
    const next = threadReducer(s, {
      type: "TOGGLE_REACTION",
      threadId: "t1",
      commentId: "missing",
      kind: "like",
      userId: "u1",
      displayName: "User One",
    });
    expect(next.threadsById.t1!.comments).toEqual(s.threadsById.t1!.comments);
  });
});

describe("threadReducer SET_STATUS", () => {
  it("updates the thread status", () => {
    let s = initialThreadState([buildThread("t1")]);
    s = threadReducer(s, {
      type: "SET_STATUS",
      threadId: "t1",
      status: "resolved",
    });
    expect(s.threadsById.t1!.status).toBe("resolved");
  });

  it("is a no-op for unknown threads", () => {
    const s = initialThreadState([buildThread("t1")]);
    expect(
      threadReducer(s, {
        type: "SET_STATUS",
        threadId: "missing",
        status: "resolved",
      }),
    ).toBe(s);
  });
});

describe("threadReducer DELETE_THREAD", () => {
  it("removes the thread + drops it from order", () => {
    let s = initialThreadState([buildThread("t1"), buildThread("t2")]);
    s = threadReducer(s, { type: "DELETE_THREAD", threadId: "t1" });
    expect(s.threadsById.t1).toBeUndefined();
    expect(s.order).toEqual(["t2"]);
  });

  it("is a no-op for unknown threads", () => {
    const s = initialThreadState([buildThread("t1")]);
    expect(
      threadReducer(s, { type: "DELETE_THREAD", threadId: "missing" }),
    ).toBe(s);
  });
});

describe("selectThreadsByFile", () => {
  it("returns just the threads for the requested file, in `order`", () => {
    const a1 = buildThread("a1", "a.md");
    const b1 = buildThread("b1", "b.md");
    const a2 = buildThread("a2", "a.md");
    const s = initialThreadState([a1, b1, a2]);
    const result = selectThreadsByFile(s, "a.md");
    expect(result.map((t) => t.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty list when nothing matches", () => {
    const s = initialThreadState([buildThread("a1", "a.md")]);
    expect(selectThreadsByFile(s, "missing.md")).toEqual([]);
  });
});

describe("selectGeneralThreads", () => {
  it("returns only threads flagged general, in `order`", () => {
    const a1 = buildThread("a1", "a.md");
    const g1: CommentThread = { ...buildThread("g1", ""), general: true };
    const g2: CommentThread = { ...buildThread("g2", ""), general: true };
    const s = initialThreadState([a1, g1, g2]);
    expect(selectGeneralThreads(s).map((t) => t.id)).toEqual(["g1", "g2"]);
  });

  it("returns an empty list when no general threads exist", () => {
    const s = initialThreadState([buildThread("a1", "a.md")]);
    expect(selectGeneralThreads(s)).toEqual([]);
  });
});

describe("makeNewThread", () => {
  it("constructs an active thread with a single root comment", () => {
    const t = makeNewThread(
      "id1",
      "doc.md",
      anchor("body"),
      AUTHOR,
      "Looks good!",
      "2024-03-01T00:00:00.000Z",
    );
    expect(t).toEqual({
      id: "id1",
      filePath: "doc.md",
      anchor: { exact: "body", prefix: "", suffix: "" },
      status: "active",
      comments: [
        {
          id: "id1-c1",
          author: AUTHOR,
          bodyMarkdown: "Looks good!",
          createdAt: "2024-03-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("falls back to current time when none is supplied", () => {
    const t = makeNewThread("id1", "doc.md", anchor(), AUTHOR, "x");
    expect(Number.isFinite(Date.parse(t.comments[0]!.createdAt))).toBe(true);
  });
});

// Sanity check the exhaustive-default branch by feeding an action whose
// `type` is unknown — the reducer's `never` branch should fall through and
// hand back the same state.
describe("threadReducer (defensive)", () => {
  it("returns state unchanged for an unrecognized action shape", () => {
    const s = initialThreadState([buildThread("t1")]);
    // Cast to bypass the discriminated-union exhaustiveness check.
    const bogus = { type: "UNKNOWN_ACTION" } as unknown as ThreadAction;
    expect(threadReducer(s, bogus)).toBe(s);
  });
});

// Refresh-feed reducer (MERGE_REMOTE_THREADS). Covers the polling pipe:
// the server snapshot is folded into local state without disturbing UI
// ordering or local optimistic state. Reference-equal fast path keeps
// React from re-rendering when nothing diffs.
describe("threadReducer MERGE_REMOTE_THREADS", () => {
  it("appends unknown threads to the END of order (preserves existing ordering)", () => {
    const state = initialThreadState([buildThread("t1")]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1"), buildThread("t2")],
    });
    expect(next.order).toEqual(["t1", "t2"]);
  });

  it("returns same reference when nothing changes (no re-render)", () => {
    const state = initialThreadState([buildThread("t1")]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1")],
    });
    expect(next).toBe(state);
  });

  it("preserves local-only (optimistic) threads not present in remote snapshot", () => {
    const local = buildThread("local-tmp-1");
    const state = initialThreadState([buildThread("t1"), local]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1")],
    });
    expect(next.threadsById["local-tmp-1"]).toBe(local);
    expect(next.order).toContain("local-tmp-1");
  });

  it("appends remote replies that aren't in our local copy yet", () => {
    const state = initialThreadState([buildThread("t1")]);
    const remoteWithReply = buildThread("t1", "docs/a.md", [
      {
        id: "t1-c1",
        author: AUTHOR,
        bodyMarkdown: "first",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "t1-c2",
        author: OTHER_AUTHOR,
        bodyMarkdown: "nice point",
        createdAt: "2024-01-02T00:00:00.000Z",
      },
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [remoteWithReply],
    });
    expect(next.threadsById.t1!.comments).toHaveLength(2);
    expect(next.threadsById.t1!.comments[1]!.bodyMarkdown).toBe("nice point");
  });

  it("updates status when the server resolves a thread", () => {
    const state = initialThreadState([buildThread("t1")]);
    const resolvedRemote: CommentThread = {
      ...buildThread("t1"),
      status: "resolved",
    };
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [resolvedRemote],
    });
    expect(next.threadsById.t1!.status).toBe("resolved");
  });

  it("only overwrites comment body when remote updatedAt is newer", () => {
    // Local: edited at 11:00 → newer than remote's 10:30 → should win.
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "local edit",
          createdAt: "2024-01-01T10:00:00.000Z",
          updatedAt: "2024-01-01T11:00:00.000Z",
        },
      ]),
    ]);
    const staleRemote = buildThread("t1", "docs/a.md", [
      {
        id: "t1-c1",
        author: AUTHOR,
        bodyMarkdown: "stale remote",
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "2024-01-01T10:30:00.000Z",
      },
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [staleRemote],
    });
    expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe("local edit");
  });

  it("does NOT delete threads that disappear from the remote snapshot", () => {
    // Avoids racing optimistic creates whose server-assigned ids haven't
    // landed yet. False positive: a genuinely deleted thread will linger
    // until the next user action — acceptable trade-off.
    const state = initialThreadState([buildThread("t1"), buildThread("t2")]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1")],
    });
    expect(next.threadsById.t2).toBeDefined();
    expect(next.order).toEqual(["t1", "t2"]);
  });

  it("merges threads on multiple files (selectThreadsByFile filters)", () => {
    const state = initialThreadState([buildThread("t1", "a.md")]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1", "a.md"), buildThread("t2", "b.md")],
    });
    expect(selectThreadsByFile(next, "a.md").map((t) => t.id)).toEqual(["t1"]);
    expect(selectThreadsByFile(next, "b.md").map((t) => t.id)).toEqual(["t2"]);
  });

  it("compares updatedAt numerically — lexical order would pick the wrong winner", () => {
    // Adversarial timestamps where lexical (string) comparison
    // disagrees with chronological order:
    //   * remote: "2024-01-01T12:00:00+05:00"  →  07:00:00Z (OLDER)
    //   * local:  "2024-01-01T09:00:00Z"       →  09:00:00Z (NEWER)
    // Lexically "12:00:00+05:00" > "09:00:00Z" (because '1' > '0' at
    // the hour digit), so the old string-compare wrongly treats the
    // stale remote as newer and clobbers the local edit. Numeric
    // comparison via Date.parse keeps the newer local body.
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "newer local edit",
          createdAt: "2024-01-01T08:00:00.000Z",
          updatedAt: "2024-01-01T09:00:00Z",
        },
      ]),
    ]);
    const staleRemote = buildThread("t1", "docs/a.md", [
      {
        id: "t1-c1",
        author: AUTHOR,
        bodyMarkdown: "stale remote edit",
        createdAt: "2024-01-01T08:00:00.000Z",
        updatedAt: "2024-01-01T12:00:00+05:00",
      },
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [staleRemote],
    });
    // Local is chronologically newer → its body must survive.
    expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe(
      "newer local edit",
    );
  });

  it("ignores remote bodies whose updatedAt is unparseable", () => {
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "local",
          createdAt: "2024-01-01T10:00:00.000Z",
          updatedAt: "2024-01-01T11:00:00.000Z",
        },
      ]),
    ]);
    const garbageRemote = buildThread("t1", "docs/a.md", [
      {
        id: "t1-c1",
        author: AUTHOR,
        bodyMarkdown: "remote body",
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "not a date",
      },
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [garbageRemote],
    });
    expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe("local");
  });

  it("overwrites the local body when the remote edit is newer", () => {
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "old local",
          createdAt: "2024-01-01T10:00:00.000Z",
          updatedAt: "2024-01-01T10:00:00.000Z",
        },
      ]),
    ]);
    const fresherRemote = buildThread("t1", "docs/a.md", [
      {
        id: "t1-c1",
        author: AUTHOR,
        bodyMarkdown: "fresh remote",
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "2024-01-01T12:00:00.000Z",
      },
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [fresherRemote],
    });
    expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe("fresh remote");
    expect(next.threadsById.t1!.comments[0]!.updatedAt).toBe(
      "2024-01-01T12:00:00.000Z",
    );
  });

  it("keeps a local comment that has no remote counterpart", () => {
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [
        {
          id: "t1-c1",
          author: AUTHOR,
          bodyMarkdown: "first",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "t1-c2",
          author: OTHER_AUTHOR,
          bodyMarkdown: "local only",
          createdAt: "2024-01-01T00:01:00.000Z",
        },
      ]),
    ]);
    // Remote feed only carries the first comment; the second has no match and
    // must be passed through untouched.
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [
        buildThread("t1", "docs/a.md", [
          {
            id: "t1-c1",
            author: AUTHOR,
            bodyMarkdown: "first",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ]),
      ],
    });
    const merged = next.threadsById.t1!.comments;
    expect(merged.map((c) => c.id)).toEqual(["t1-c1", "t1-c2"]);
    expect(merged[1]!.bodyMarkdown).toBe("local only");
  });
});

describe("threadReducer MERGE_REMOTE_THREADS — reaction sync", () => {
  // A remote snapshot's reactions replace the local (optimistic) set only when
  // they actually differ. Assert the OBSERVABLE outcome per case: the merge is
  // either a no-op (same state ref) or the remote reaction set is adopted.
  const named = (id: string, displayName: string): Reaction => ({
    kind: "like",
    users: [{ id, displayName }],
  });

  const commentWith = (reactions: Reaction[] | undefined): Comment => ({
    id: "t1-c1",
    author: AUTHOR,
    bodyMarkdown: "first",
    createdAt: "2024-01-01T00:00:00.000Z",
    reactions,
  });

  const cases: Array<{
    name: string;
    local: Reaction[] | undefined;
    remote: Reaction[] | undefined;
    outcome: "unchanged" | "adopt";
  }> = [
    {
      name: "identical set (members reordered) is a no-op",
      local: [rx("like", "u1", "u2")],
      remote: [rx("like", "u2", "u1")],
      outcome: "unchanged",
    },
    {
      name: "empty local + missing remote is a no-op",
      local: [],
      remote: undefined,
      outcome: "unchanged",
    },
    {
      name: "missing local adopts the remote likes",
      local: undefined,
      remote: [rx("like", "u1")],
      outcome: "adopt",
    },
    {
      name: "an added reaction kind is adopted",
      local: [rx("like", "u1")],
      remote: [rx("like", "u1"), rx("celebrate", "u2")],
      outcome: "adopt",
    },
    {
      name: "an added liker on the same kind is adopted",
      local: [rx("like", "u1")],
      remote: [rx("like", "u1", "u2")],
      outcome: "adopt",
    },
    {
      name: "a changed reaction kind is adopted",
      local: [rx("like", "u1")],
      remote: [rx("celebrate", "u1")],
      outcome: "adopt",
    },
    {
      name: "a renamed liker (same id) is adopted",
      local: [named("u1", "Old Name")],
      remote: [named("u1", "New Name")],
      outcome: "adopt",
    },
    {
      name: "a swapped liker at equal size is adopted",
      local: [rx("like", "u1")],
      remote: [rx("like", "u2")],
      outcome: "adopt",
    },
    {
      name: "removing the last liker clears the set",
      local: [rx("like", "u1")],
      remote: undefined,
      outcome: "adopt",
    },
  ];

  it.each(cases)("$name", ({ local, remote, outcome }) => {
    const state = initialThreadState([
      buildThread("t1", "docs/a.md", [commentWith(local)]),
    ]);
    const next = threadReducer(state, {
      type: "MERGE_REMOTE_THREADS",
      threads: [buildThread("t1", "docs/a.md", [commentWith(remote)])],
    });
    if (outcome === "unchanged") {
      expect(next).toBe(state);
    } else {
      expect(next).not.toBe(state);
      expect(next.threadsById.t1!.comments[0]!.reactions).toEqual(remote);
    }
  });
});
