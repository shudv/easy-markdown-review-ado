// Shell: posting new comments and replies.

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";

import type {
  CommentAuthor,
  CommentThread,
  MentionedIdentity,
  TextQuoteAnchor,
} from "../../types";
import type { CommentApi, CreatedThreadIds } from "../../comments/api";
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
  dispatch: Dispatch<ThreadAction>;
  currentUser: CommentAuthor;
  identityStore: IdentityStore;
  selectedPath: string;
  sourceByPath: Record<string, string>;
  draftAnchor: TextQuoteAnchor | null;
  activeDraftRef: MutableRefObject<DraftTarget | null>;
  draft: DraftPersistence;
  isStillPostedDraft: (
    postedTarget: DraftTarget | null,
    body: string,
  ) => boolean;
  setActiveDraft: Dispatch<SetStateAction<DraftTarget | null>>;
  setDraftY: Dispatch<SetStateAction<number | null>>;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
}

/** Posting the open composer: a new comment thread or a reply. */
export function useCommentPosting(opts: CommentPostingOptions) {
  const onSubmitDraft = useSubmitDraft(opts);
  const onReply = useReply(opts);
  return { onSubmitDraft, onReply };
}

/** Posts the open new-comment composer as a fresh thread. */
function useSubmitDraft(opts: CommentPostingOptions) {
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
  return useCallback(
    (body: string) => {
      // Anchor against the SAME source that produced the currently rendered
      // article so the comment can be located in it.
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
        if (!created) return;
        const thread = createdThread({
          created,
          filePath: selectedPath,
          anchor,
          author: currentUser,
          body,
          mentions,
        });
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
}

/** Posts the open reply composer onto its thread. */
function useReply(opts: CommentPostingOptions) {
  const {
    commentApi,
    persistWith,
    dispatch,
    currentUser,
    activeDraftRef,
    draft,
    isStillPostedDraft,
    setActiveDraft,
  } = opts;
  return useCallback(
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
}

/** The local thread for a just-created remote thread and its first comment. */
function createdThread(args: {
  created: CreatedThreadIds;
  filePath: string;
  anchor: TextQuoteAnchor;
  author: CommentAuthor;
  body: string;
  mentions: MentionedIdentity[];
}): CommentThread {
  const { created, filePath, anchor, author, body, mentions } = args;
  const thread = makeNewThread(
    { id: created.threadId, filePath, anchor },
    author,
    body,
    created.createdAt,
  );
  // `makeNewThread` mints exactly one comment; give it the server's id.
  thread.comments = thread.comments.map((c) => ({
    ...c,
    id: created.firstCommentId,
  }));
  if (mentions.length > 0) thread.mentionedIdentities = mentions;
  return thread;
}
