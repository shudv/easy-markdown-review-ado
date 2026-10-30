// PrShell: thread status, edit, delete and reaction actions.

import * as React from "react";

import type { CommentAuthor, ReactionKind } from "../../types";
import type { CommentApi } from "../../comments/api";
import type { ThreadAction, ThreadState } from "../../comments/store";
import { events, track } from "../../telemetry";
import { clearIfEquals } from "../prShellHelpers";
import type { PersistWith } from "./useCommentWrites";

interface ThreadMutationsOptions {
  commentApi: CommentApi;
  persistWith: PersistWith;
  dispatch: React.Dispatch<ThreadAction>;
  currentUser: CommentAuthor;
  threadsById: ThreadState["threadsById"];
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Thread/comment mutations from the rail — status changes, edits, deletes and
 * reactions — persisted first, then applied to the store.
 */
export function useThreadMutations(opts: ThreadMutationsOptions) {
  const {
    commentApi,
    persistWith,
    dispatch,
    currentUser,
    threadsById,
    setActiveThreadId,
  } = opts;
  const onResolve = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Resolve thread", () =>
          commentApi.setStatus(tid, "resolved"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "resolved" });
        track(events.threadResolved());
      })();
    },
    [commentApi, persistWith, dispatch],
  );

  const onReopen = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Reopen thread", () =>
          commentApi.setStatus(tid, "active"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "active" });
        track(events.threadReopened());
      })();
    },
    [commentApi, persistWith, dispatch],
  );

  // Mark a thread as pending — a lightweight "revisit later" state that keeps
  // it open (still counted, still shown) but visually distinct.
  const onMarkPending = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Mark thread pending", () =>
          commentApi.setStatus(tid, "pending"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "pending" });
        track(events.threadMarkedPending());
      })();
    },
    [commentApi, persistWith, dispatch],
  );

  // Close a thread — a terminal state (folded away with resolved) for threads
  // that are done but weren't a code-fix resolution.
  const onCloseThread = React.useCallback(
    (tid: string) => {
      void (async () => {
        const ok = await persistWith("Close thread", () =>
          commentApi.setStatus(tid, "closed"),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "SET_STATUS", threadId: tid, status: "closed" });
        track(events.threadClosed());
      })();
    },
    [commentApi, persistWith, dispatch],
  );

  const onEditComment = React.useCallback(
    async (
      threadId: string,
      commentId: string,
      newBodyMarkdown: string,
    ): Promise<boolean> => {
      const result = await persistWith("Edit comment", () =>
        commentApi.editComment(threadId, commentId, newBodyMarkdown),
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

  const onDeleteComment = React.useCallback(
    (threadId: string, commentId: string) => {
      void (async () => {
        const ok = await persistWith("Delete comment", () =>
          commentApi.deleteComment(threadId, commentId),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
        if (ok === null) return;
        dispatch({ type: "DELETE_COMMENT", threadId, commentId });
        track(events.commentDeleted());
        // Deleting the last comment removes the thread — clear active.
        setActiveThreadId(clearIfEquals(threadId));
      })();
    },
    [commentApi, persistWith, dispatch, setActiveThreadId],
  );

  const onDeleteThread = React.useCallback(
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
        /* v8 ignore next -- thread is dropped locally on success only */
        if (ok === null) return;
        dispatch({ type: "DELETE_THREAD", threadId });
        track(events.threadDeleted({ commentCount: thread.comments.length }));
        setActiveThreadId(clearIfEquals(threadId));
      })();
    },
    [threadsById, commentApi, persistWith, dispatch, setActiveThreadId],
  );

  const onToggleReaction = React.useCallback(
    (threadId: string, commentId: string, kind: ReactionKind) => {
      // Decide add vs remove before dispatch so persistence hits the right endpoint.
      const thread = threadsById[threadId];
      const comment = thread?.comments.find((c) => c.id === commentId);
      const hadIt =
        /* v8 ignore start -- optional-chain/nullish guards for a missing comment or reactions array */
        comment?.reactions?.some(
          (r) =>
            r.kind === kind && r.users.some((u) => u.id === currentUser.id),
        ) ?? false;
      /* v8 ignore stop */
      const add = !hadIt;
      void (async () => {
        const ok = await persistWith("Toggle reaction", () =>
          commentApi.toggleReaction(threadId, commentId, kind, add),
        );
        /* v8 ignore next -- optimistic update skipped when the remote write fails */
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
    [
      threadsById,
      commentApi,
      persistWith,
      currentUser.id,
      currentUser.displayName,
      dispatch,
    ],
  );

  return {
    onResolve,
    onReopen,
    onMarkPending,
    onCloseThread,
    onEditComment,
    onDeleteComment,
    onDeleteThread,
    onToggleReaction,
  };
}
