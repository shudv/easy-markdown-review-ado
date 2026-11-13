// Shell: thread status, edit, delete and reaction actions.

import { type Dispatch, type SetStateAction, useCallback } from "react";

import type { CommentAuthor, ReactionKind } from "../../types";
import type { CommentApi } from "../../comments/api";
import type { ThreadAction, ThreadState } from "../../comments/store";
import { events, track, type ResolveVia } from "../../telemetry";
import { clearIfEquals } from "../shellHelpers";
import type { PersistWith } from "./useCommentWrites";

interface ThreadMutationsOptions {
    commentApi: CommentApi;
    persistWith: PersistWith;
    dispatch: Dispatch<ThreadAction>;
    currentUser: CommentAuthor;
    /** May lack a thread a stale rail callback still names. */
    threadsById: Partial<ThreadState["threadsById"]>;
    setActiveThreadId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Thread/comment mutations from the rail — status changes, edits, deletes and
 * reactions — persisted first, then applied to the store.
 */
export function useThreadMutations(opts: ThreadMutationsOptions) {
    const statusMutations = useStatusMutations(opts);
    const commentMutations = useCommentMutations(opts);
    const threadMutations = useThreadDeleteAndReaction(opts);

    return { ...statusMutations, ...commentMutations, ...threadMutations };
}

/**
 * Time since the thread's first comment was posted, for resolution-time
 * telemetry. `undefined` when the thread isn't loaded or its timestamp is
 * unreadable — the event is still sent, just without a duration.
 */
export function threadAgeMs(
    thread: ThreadState["threadsById"][string] | undefined,
    nowMs: number = Date.now(),
): number | undefined {
    const createdAt = thread?.comments[0]?.createdAt;
    if (createdAt === undefined) return undefined;
    const age = nowMs - Date.parse(createdAt);

    return Number.isFinite(age) && age >= 0 ? age : undefined;
}

/** Thread status changes: resolve, reopen, mark pending and close. */
function useStatusMutations(opts: ThreadMutationsOptions) {
    const { commentApi, persistWith, dispatch, threadsById } = opts;

    const onResolve = useCallback(
        (tid: string, via?: ResolveVia) => {
            void (async () => {
                const ok = await persistWith("Resolve thread", () =>
                    commentApi.setStatus(tid, "resolved"),
                );

                if (ok === null) return;
                dispatch({
                    type: "SET_STATUS",
                    threadId: tid,
                    status: "resolved",
                });
                track(
                    events.threadResolved({
                        durationMs: threadAgeMs(threadsById[tid]),
                        via: via ?? "menu",
                    }),
                );
            })();
        },
        [commentApi, persistWith, dispatch, threadsById],
    );

    const onReopen = useCallback(
        (tid: string) => {
            void (async () => {
                const ok = await persistWith("Reopen thread", () =>
                    commentApi.setStatus(tid, "active"),
                );

                if (ok === null) return;
                dispatch({
                    type: "SET_STATUS",
                    threadId: tid,
                    status: "active",
                });
                track(events.threadReopened());
            })();
        },
        [commentApi, persistWith, dispatch],
    );

    // Mark a thread as pending — a lightweight "revisit later" state that keeps
    // it open (still counted, still shown) but visually distinct.
    const onMarkPending = useCallback(
        (tid: string) => {
            void (async () => {
                const ok = await persistWith("Mark thread pending", () =>
                    commentApi.setStatus(tid, "pending"),
                );

                if (ok === null) return;
                dispatch({
                    type: "SET_STATUS",
                    threadId: tid,
                    status: "pending",
                });
                track(events.threadMarkedPending());
            })();
        },
        [commentApi, persistWith, dispatch],
    );

    // Close a thread — a terminal state (folded away with resolved) for threads
    // that are done but weren't a code-fix resolution.
    const onCloseThread = useCallback(
        (tid: string) => {
            void (async () => {
                const ok = await persistWith("Close thread", () =>
                    commentApi.setStatus(tid, "closed"),
                );

                if (ok === null) return;
                dispatch({
                    type: "SET_STATUS",
                    threadId: tid,
                    status: "closed",
                });
                track(events.threadClosed());
            })();
        },
        [commentApi, persistWith, dispatch],
    );

    return { onResolve, onReopen, onMarkPending, onCloseThread };
}

/** Comment edits and single-comment deletes. */
function useCommentMutations(opts: ThreadMutationsOptions) {
    const { commentApi, persistWith, dispatch, setActiveThreadId } = opts;

    const onEditComment = useCallback(
        async (threadId: string, commentId: string, newBodyMarkdown: string): Promise<boolean> => {
            const result = await persistWith(
                "Edit comment",
                () => commentApi.editComment(threadId, commentId, newBodyMarkdown),
                { fromComposer: true },
            );

            // A failed save leaves the editor open with the user's text (CommentRow).
            if (!result) return false;
            dispatch({
                type: "EDIT_COMMENT",
                threadId,
                commentId,
                newBodyMarkdown,
                updatedAt: result.updatedAt,
            });
            track(events.commentEdited());

            return true;
        },
        [commentApi, persistWith, dispatch],
    );

    const onDeleteComment = useCallback(
        (threadId: string, commentId: string) => {
            void (async () => {
                const ok = await persistWith("Delete comment", () =>
                    commentApi.deleteComment(threadId, commentId),
                );

                if (ok === null) return;
                dispatch({ type: "DELETE_COMMENT", threadId, commentId });
                track(events.commentDeleted());
                // Deleting the last comment removes the thread — clear active.
                setActiveThreadId(clearIfEquals(threadId));
            })();
        },
        [commentApi, persistWith, dispatch, setActiveThreadId],
    );

    return { onEditComment, onDeleteComment };
}

/** Whole-thread deletes and comment reaction toggles. */
function useThreadDeleteAndReaction(opts: ThreadMutationsOptions) {
    const { commentApi, persistWith, dispatch, currentUser, threadsById, setActiveThreadId } = opts;

    const onDeleteThread = useCallback(
        (threadId: string) => {
            const thread = threadsById[threadId]!;

            void (async () => {
                // Delete every comment server-side, then drop the thread locally even
                // on error to avoid stranding ghost UI.
                const ok = await persistWith("Delete thread", async () => {
                    // Replies first, root last: deleting the root may remove/invalidate
                    // the thread, which would make subsequent reply deletions fail.
                    for (const c of [...thread.comments].reverse()) {
                        await commentApi.deleteComment(threadId, c.id);
                    }
                });

                if (ok === null) return;
                dispatch({ type: "DELETE_THREAD", threadId });
                track(
                    events.threadDeleted({
                        commentCount: thread.comments.length,
                    }),
                );
                setActiveThreadId(clearIfEquals(threadId));
            })();
        },
        [threadsById, commentApi, persistWith, dispatch, setActiveThreadId],
    );

    const onToggleReaction = useCallback(
        (threadId: string, commentId: string, kind: ReactionKind) => {
            // Decide add vs remove before dispatch so persistence hits the right endpoint.
            const thread = threadsById[threadId];
            const comment = thread?.comments.find((c) => c.id === commentId);

            const hadIt =
                comment?.reactions?.some(
                    (r) =>
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ReactionKind has a single member today; matching by kind keeps the toggle per-kind once ADO kinds are added.
                        r.kind === kind && r.users.some((u) => u.id === currentUser.id),
                ) ?? false;

            const add = !hadIt;

            void (async () => {
                const ok = await persistWith("Toggle reaction", () =>
                    commentApi.toggleReaction(threadId, commentId, kind, add),
                );

                if (ok === null) return;
                dispatch({
                    type: "TOGGLE_REACTION",
                    threadId,
                    commentId,
                    kind,
                    userId: currentUser.id,
                    displayName: currentUser.displayName,
                });
                track(events.commentReacted({ active: add, kind }));
            })();
        },
        [threadsById, commentApi, persistWith, currentUser.id, currentUser.displayName, dispatch],
    );

    return { onDeleteThread, onToggleReaction };
}
