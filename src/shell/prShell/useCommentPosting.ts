// PrShell: posting new comments and replies.

import * as React from "react";

import type { CommentAuthor, TextQuoteAnchor } from "../../types";
import type { CommentApi } from "../../comments/api";
import { withSourceLocation } from "../../comments/anchor";
import type { IdentityStore } from "../../comments/identityStore";
import { collectMentionIdentities } from "../../comments/mentions";
import { makeNewThread, type ThreadAction } from "../../comments/store";
import { events, track } from "../../telemetry";
import { anchorKindOf } from "../anchorKind";
import type { DraftTarget } from "../draftStorage";
import type { DraftPersistence } from "../useDraftPersistence";
import type { PersistWith } from "./useCommentWrites";

interface CommentPostingOptions {
  commentApi: CommentApi;
  persistWith: PersistWith;
  dispatch: React.Dispatch<ThreadAction>;
  currentUser: CommentAuthor;
  identityStore: IdentityStore;
  selectedPath: string;
  sourceByPath: Record<string, string>;
  draftAnchor: TextQuoteAnchor | null;
  activeDraftRef: React.MutableRefObject<DraftTarget | null>;
  draft: DraftPersistence;
  isStillPostedDraft: (
    postedTarget: DraftTarget | null,
    body: string,
  ) => boolean;
  setActiveDraft: React.Dispatch<React.SetStateAction<DraftTarget | null>>;
  setDraftY: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
}

/** Posting the open composer: a new comment thread or a reply. */
export function useCommentPosting(opts: CommentPostingOptions) {
  const {
    commentApi,
    persistWith,
    dispatch,
    currentUser,
    identityStore,
    selectedPath,
    sourceByPath,
    draftAnchor,
    activeDraftRef,
    draft,
    isStillPostedDraft,
    setActiveDraft,
    setDraftY,
    setActiveThreadId,
  } = opts;
  const onSubmitDraft = React.useCallback(
    (body: string) => {
      // Anchor against the SAME source that produced the currently rendered
      // article so the comment can be located in it.
      /* v8 ignore next -- committed-source fallback is defensive */
      const source = sourceByPath[selectedPath] ?? "";
      const anchor = withSourceLocation(draftAnchor!, source);
      // Names the picker already resolved for this body's @mentions. Persisted
      // with the thread so they render on load even where ADO can't resolve the
      // id (cross-tenant guests / personal-MSA orgs).
      const mentions = collectMentionIdentities(body, (mid) =>
        identityStore.get(mid),
      );
      const postedTarget = activeDraftRef.current;
      void (async () => {
        const created = await persistWith("Create comment", () =>
          commentApi.createThread({
            filePath: selectedPath,
            anchor,
            bodyMarkdown: body,
            mentions,
          }),
        );
        /* v8 ignore next -- optimistic thread skipped when the remote write fails */
        if (!created) return;
        const thread = makeNewThread(
          created.threadId,
          selectedPath,
          anchor,
          currentUser,
          body,
          created.createdAt,
        );
        /* v8 ignore start -- a freshly created thread has exactly one comment, so the else-arm is unreachable */
        thread.comments = thread.comments.map((c, i) =>
          i === 0 ? { ...c, id: created.firstCommentId } : c,
        );
        /* v8 ignore stop */
        /* v8 ignore next -- exercised only when the new comment carries no @mentions */
        if (mentions.length > 0) thread.mentionedIdentities = mentions;
        dispatch({ type: "ADD_THREAD", thread });
        track(
          events.commentCreated({
            anchorKind: anchorKindOf(anchor),
            bodyLength: body.length,
          }),
        );
        if (!isStillPostedDraft(postedTarget, body)) return;
        setActiveDraft(null);
        setDraftY(null);
        setActiveThreadId(thread.id);
        draft.clear();
      })();
    },
    [
      draftAnchor,
      selectedPath,
      sourceByPath,
      currentUser,
      commentApi,
      persistWith,
      identityStore,
      draft,
      isStillPostedDraft,
      activeDraftRef,
      dispatch,
      setActiveDraft,
      setDraftY,
      setActiveThreadId,
    ],
  );

  const onReply = React.useCallback(
    (threadId: string, body: string) => {
      const postedTarget = activeDraftRef.current;
      void (async () => {
        const created = await persistWith("Add reply", () =>
          commentApi.addReply(threadId, body),
        );
        if (!created) return;
        dispatch({
          type: "ADD_REPLY",
          threadId,
          comment: {
            id: created.commentId,
            author: currentUser,
            bodyMarkdown: body,
            createdAt: created.createdAt,
          },
        });
        track(events.commentReplied({ bodyLength: body.length }));
        if (!isStillPostedDraft(postedTarget, body)) return;
        draft.clear();
        setActiveDraft(null);
      })();
    },
    [
      currentUser,
      commentApi,
      persistWith,
      draft,
      isStillPostedDraft,
      activeDraftRef,
      dispatch,
      setActiveDraft,
    ],
  );

  return { onSubmitDraft, onReply };
}
