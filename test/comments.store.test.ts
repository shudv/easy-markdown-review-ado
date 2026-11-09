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

    it("keeps the seeded threads in the order given", () => {
        const t1 = buildThread("t1");
        const t2 = buildThread("t2", "docs/b.md");
        const s = initialThreadState([t1, t2]);
        expect(s.order).toEqual(["t1", "t2"]);
        expect(s.threadsById).toEqual({ t1, t2 });
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

    it("keeps the threads already there when another is added", () => {
        const t1 = buildThread("t1");
        const t2 = buildThread("t2");

        const s = threadReducer(initialThreadState([t1]), { type: "ADD_THREAD", thread: t2 });

        expect(s.threadsById).toEqual({ t1, t2 });
    });

    it("keeps the existing thread when a thread with the same id is added again", () => {
        const t1 = buildThread("t1");
        const before = initialThreadState([t1]);

        const after = threadReducer(before, {
            type: "ADD_THREAD",
            thread: { ...t1, status: "resolved" },
        });

        expect(after).toEqual(before);
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

        s = threadReducer(s, {
            type: "ADD_REPLY",
            threadId: "t1",
            comment: reply,
        });
        expect(s.threadsById.t1!.comments.map((c) => c.id)).toEqual(["t1-c1", "t1-c2"]);
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
        expect(r).toEqual([{ kind: "like", users: [{ id: "u1", displayName: "User One" }] }]);
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
                        {
                            kind: "celebrate" as ReactionKind,
                            users: [{ id: "u2", displayName: "User Two" }],
                        },
                        {
                            kind: "like",
                            users: [{ id: "u1", displayName: "User One" }],
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
                kind: "celebrate",
                users: [{ id: "u2", displayName: "User Two" }],
            },
            {
                kind: "like",
                users: [
                    { id: "u1", displayName: "User One" },
                    { id: "u3", displayName: "User Three" },
                ],
            },
        ]);
    });

    it("keeps other reaction kinds when the last liker un-likes", () => {
        let s = initialThreadState([
            buildThread("t1", "docs/a.md", [
                {
                    id: "t1-c1",
                    author: AUTHOR,
                    bodyMarkdown: "first",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    reactions: [rx("like", "u1"), rx("celebrate", "u2")],
                },
            ]),
        ]);

        s = threadReducer(s, {
            type: "TOGGLE_REACTION",
            threadId: "t1",
            commentId: "t1-c1",
            kind: "like",
            userId: "u1",
            displayName: "u1",
        });

        expect(s.threadsById.t1!.comments[0]!.reactions).toEqual([rx("celebrate", "u2")]);
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
});

describe("threadReducer DELETE_THREAD", () => {
    it("removes the thread + drops it from order", () => {
        let s = initialThreadState([buildThread("t1"), buildThread("t2")]);
        s = threadReducer(s, { type: "DELETE_THREAD", threadId: "t1" });
        expect(s.threadsById.t1).toBeUndefined();
        expect(s.order).toEqual(["t2"]);
    });
});

// Production: an action can arrive for a thread or comment that is already gone,
// e.g. a reply finishing after another tab deleted the thread. The store must
// drop it rather than resurrect or corrupt anything.
describe("threadReducer actions on a thread or comment that no longer exists", () => {
    const comment: Comment = {
        id: "x",
        author: AUTHOR,
        bodyMarkdown: "late reply",
        createdAt: "2024-01-02T00:00:00.000Z",
    };

    it.each<{ name: string; action: ThreadAction }>([
        { name: "a reply", action: { type: "ADD_REPLY", threadId: "missing", comment } },
        {
            name: "an edit",
            action: {
                type: "EDIT_COMMENT",
                threadId: "missing",
                commentId: "x",
                newBodyMarkdown: "x",
                updatedAt: "2024-02-01T00:00:00.000Z",
            },
        },
        {
            name: "a comment deletion",
            action: { type: "DELETE_COMMENT", threadId: "missing", commentId: "x" },
        },
        {
            name: "a like",
            action: {
                type: "TOGGLE_REACTION",
                threadId: "missing",
                commentId: "x",
                kind: "like",
                userId: "u1",
                displayName: "User One",
            },
        },
        {
            name: "a status change",
            action: { type: "SET_STATUS", threadId: "missing", status: "resolved" },
        },
        { name: "a thread deletion", action: { type: "DELETE_THREAD", threadId: "missing" } },
    ])("ignores $name for a thread that no longer exists", ({ action }) => {
        const before = initialThreadState([buildThread("t1")]);

        // The very same state comes back, so nothing re-renders.
        expect(threadReducer(before, action)).toBe(before);
    });

    it.each<{ name: string; action: ThreadAction }>([
        {
            name: "an edit",
            action: {
                type: "EDIT_COMMENT",
                threadId: "t1",
                commentId: "missing",
                newBodyMarkdown: "x",
                updatedAt: "2024-02-01T00:00:00.000Z",
            },
        },
        {
            name: "a like",
            action: {
                type: "TOGGLE_REACTION",
                threadId: "t1",
                commentId: "missing",
                kind: "like",
                userId: "u1",
                displayName: "User One",
            },
        },
    ])("leaves the thread's comments unchanged for $name of a deleted comment", ({ action }) => {
        const before = initialThreadState([buildThread("t1")]);

        expect(threadReducer(before, action).threadsById.t1!.comments).toEqual(
            before.threadsById.t1!.comments,
        );
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
            { id: "id1", filePath: "doc.md", anchor: anchor("body") },
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
        const t = makeNewThread({ id: "id1", filePath: "doc.md", anchor: anchor() }, AUTHOR, "x");

        expect(Number.isFinite(Date.parse(t.comments[0]!.createdAt))).toBe(true);
    });
});

// An action from a newer build (or a typo in a dispatch) must not wipe state.
describe("threadReducer (defensive)", () => {
    it("leaves the store unchanged for an action it does not recognise", () => {
        const s = initialThreadState([buildThread("t1")]);
        // Cast to bypass the discriminated-union exhaustiveness check.
        const bogus = { type: "UNKNOWN_ACTION" } as unknown as ThreadAction;
        expect(threadReducer(s, bogus)).toEqual(s);
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

    it("keeps local threads missing from the server snapshot", () => {
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
        expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe("newer local edit");
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
        expect(next.threadsById.t1!.comments[0]!.updatedAt).toBe("2024-01-01T12:00:00.000Z");
    });

    it("keeps the local body when the server reports the same edit time", () => {
        const edited = "2024-01-01T11:00:00.000Z";

        const state = initialThreadState([
            buildThread("t1", "docs/a.md", [
                {
                    id: "t1-c1",
                    author: AUTHOR,
                    bodyMarkdown: "local wording",
                    createdAt: "2024-01-01T10:00:00.000Z",
                    updatedAt: edited,
                },
            ]),
        ]);

        const next = threadReducer(state, {
            type: "MERGE_REMOTE_THREADS",
            threads: [
                buildThread("t1", "docs/a.md", [
                    {
                        id: "t1-c1",
                        author: AUTHOR,
                        bodyMarkdown: "server wording",
                        createdAt: "2024-01-01T10:00:00.000Z",
                        updatedAt: edited,
                    },
                ]),
            ],
        });

        expect(next.threadsById.t1!.comments[0]!.bodyMarkdown).toBe("local wording");
    });

    it("does not re-render when the server re-sends the same text with a newer edit time", () => {
        const state = initialThreadState([
            buildThread("t1", "docs/a.md", [
                {
                    id: "t1-c1",
                    author: AUTHOR,
                    bodyMarkdown: "same text",
                    createdAt: "2024-01-01T10:00:00.000Z",
                    updatedAt: "2024-01-01T10:00:00.000Z",
                },
            ]),
        ]);

        const next = threadReducer(state, {
            type: "MERGE_REMOTE_THREADS",
            threads: [
                buildThread("t1", "docs/a.md", [
                    {
                        id: "t1-c1",
                        author: AUTHOR,
                        bodyMarkdown: "same text",
                        createdAt: "2024-01-01T10:00:00.000Z",
                        updatedAt: "2024-01-01T12:00:00.000Z",
                    },
                ]),
            ],
        });

        expect(next).toBe(state);
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
        {
            name: "an empty remote list after everyone un-liked clears the set",
            local: [rx("like", "u1")],
            remote: [],
            outcome: "adopt",
        },
        {
            name: "a liker who un-liked while others remain is dropped",
            local: [rx("like", "u1", "u2")],
            remote: [rx("like", "u2")],
            outcome: "adopt",
        },
    ];

    const merge = (
        local: Reaction[] | undefined,
        remote: Reaction[] | undefined,
    ): { state: ThreadState; next: ThreadState } => {
        const state = initialThreadState([buildThread("t1", "docs/a.md", [commentWith(local)])]);

        const next = threadReducer(state, {
            type: "MERGE_REMOTE_THREADS",
            threads: [buildThread("t1", "docs/a.md", [commentWith(remote)])],
        });

        return { state, next };
    };

    it.each(cases.filter((c) => c.outcome === "unchanged"))("$name", ({ local, remote }) => {
        const { state, next } = merge(local, remote);
        expect(next).toBe(state);
    });

    it.each(cases.filter((c) => c.outcome === "adopt"))("$name", ({ local, remote }) => {
        const { state, next } = merge(local, remote);
        expect(next).not.toBe(state);
        expect(next.threadsById.t1!.comments[0]!.reactions).toEqual(remote);
    });
});
