// PrShell: the single open comment composer and its draft guard.

import * as React from "react";

import {
  NEW_DRAFT_THREAD_ID,
  addCommentDraftTarget,
  draftSnippet,
  type DraftScope,
  type DraftTarget,
} from "../draftStorage";
import { useDraftPersistence } from "../useDraftPersistence";
import { draftTargetsOnScreen, isSameDraftTarget } from "./derive";

interface DraftControllerOptions {
  draftScope: DraftScope | undefined;
  selectedPath: string;
  selectedPathRef: React.MutableRefObject<string>;
  revealComments: () => void;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * The single open comment composer for this experience (new comment or
 * reply), its locally-persisted text, and the one-active-draft guard.
 */
export function useDraftController(opts: DraftControllerOptions) {
  const { selectedPath, selectedPathRef, revealComments, setActiveThreadId } =
    opts;
  // The single open comment composer for this experience, or null. A
  // new-comment draft uses `threadId === NEW_DRAFT_THREAD_ID` (+ its selection
  // anchor); a reply draft carries the real thread id. Only one is ever open —
  // opening a second while this one has text prompts the discard dialog.
  const [activeDraft, setActiveDraft] = React.useState<DraftTarget | null>(
    null,
  );
  // Pending discard prompt: the composer the user asked to open plus the
  // existing draft's file + snippet to show in the dialog.
  const [draftGuard, setDraftGuard] = React.useState<{
    requested: DraftTarget;
    existingPath: string;
    snippet: string;
  } | null>(null);
  const [draftY, setDraftY] = React.useState<number | null>(null);

  // Locally-persisted draft (one per experience). `onRestore` adopts a stored
  // draft on mount so its lock is live and its composer re-opens on the right
  // file; ArticleView recomputes a new-comment draft's Y as it wraps the anchor.
  const restoreDraft = React.useCallback(
    (target: DraftTarget) => {
      setActiveDraft(target);
      revealComments();
      setActiveThreadId(
        target.threadId === NEW_DRAFT_THREAD_ID ? null : target.threadId,
      );
    },
    [revealComments, setActiveThreadId],
  );
  const draft = useDraftPersistence({
    scope: opts.draftScope,
    activeDraft,
    onRestore: restoreDraft,
  });

  const { draftAnchor, activeReplyThreadId } = draftTargetsOnScreen(
    activeDraft,
    selectedPath,
  );

  // Guarded open: adopt the requested composer unless a *different* draft still
  // holds text, in which case prompt to discard it first. An empty existing
  // draft is silently replaced (nothing to lose).
  const activeDraftRef = React.useRef(activeDraft);
  activeDraftRef.current = activeDraft;
  const requestDraft = React.useCallback(
    (target: DraftTarget) => {
      const current = activeDraftRef.current;
      const isSame = isSameDraftTarget(current, target);
      if (current === null || isSame || draft.getSnapshot().trim() === "") {
        if (!isSame) draft.clear();
        setActiveDraft(target);
        revealComments();
        if (target.threadId !== NEW_DRAFT_THREAD_ID) {
          setActiveThreadId(target.threadId);
        }
        return;
      }
      setDraftGuard({
        requested: target,
        existingPath: current.path,
        snippet: draftSnippet(draft.getSnapshot()),
      });
    },
    [draft, revealComments, setActiveThreadId],
  );
  // Stable ref for the document-level ESC / outside-click handlers so they can
  // dismiss an *empty* draft without re-subscribing on every draft change.
  // Assigned on every render below (before any handler can fire), so the
  // `null!` seed is never actually called.
  const dismissEmptyDraftRef = React.useRef<() => void>(null!);
  dismissEmptyDraftRef.current = () => {
    // Never discard text the user has typed — only tear down a bare composer
    // (a selection with no reply/comment written yet).
    if (activeDraftRef.current === null) return;
    if (draft.getSnapshot().trim() !== "") return;
    draft.clear();
    setActiveDraft(null);
    setDraftY(null);
  };

  const onAddImplicitComment = React.useCallback(() => {
    requestDraft(
      addCommentDraftTarget(activeDraftRef.current, selectedPathRef.current),
    );
  }, [requestDraft, selectedPathRef]);

  // A thread's "reply" trigger requests its reply composer, subject to the same
  // guard (an active draft elsewhere prompts the discard dialog first).
  const onRequestReply = React.useCallback(
    (threadId: string) => {
      requestDraft({
        path: selectedPathRef.current,
        threadId,
        anchor: null,
      });
    },
    [requestDraft, selectedPathRef],
  );

  const onCancelReply = React.useCallback(() => {
    draft.clear();
    setActiveDraft(null);
  }, [draft]);

  // Draft-guard dialog resolution. Discard drops the existing draft and opens
  // the composer the user asked for; keep-editing just dismisses the prompt.
  const onDiscardExistingDraft = React.useCallback(() => {
    const g = draftGuard;
    /* v8 ignore next -- the dialog only renders while draftGuard is set */
    if (!g) return;
    draft.clear();
    setDraftY(null);
    setActiveDraft(g.requested);
    revealComments();
    if (g.requested.threadId !== NEW_DRAFT_THREAD_ID) {
      setActiveThreadId(g.requested.threadId);
    }
    setDraftGuard(null);
  }, [draft, draftGuard, revealComments, setActiveThreadId]);
  const onKeepExistingDraft = React.useCallback(() => setDraftGuard(null), []);

  // A write can be held for minutes through the ADO session refresh. By the
  // time it lands the user may have cancelled this composer or started another
  // draft — only close and clear the composer still showing exactly what was
  // posted, never a newer draft.
  const isStillPostedDraft = React.useCallback(
    (postedTarget: DraftTarget | null, body: string): boolean =>
      activeDraftRef.current === postedTarget &&
      draft.getSnapshot().trim() === body,
    [draft],
  );

  const onCancelDraft = React.useCallback(() => {
    setActiveDraft(null);
    setDraftY(null);
    draft.clear();
  }, [draft]);

  return {
    activeDraft,
    setActiveDraft,
    activeDraftRef,
    draftGuard,
    draftY,
    setDraftY,
    draft,
    draftAnchor,
    activeReplyThreadId,
    requestDraft,
    dismissEmptyDraftRef,
    onAddImplicitComment,
    onRequestReply,
    onCancelReply,
    onDiscardExistingDraft,
    onKeepExistingDraft,
    isStillPostedDraft,
    onCancelDraft,
  };
}
