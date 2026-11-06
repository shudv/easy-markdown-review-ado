// Shell: the single open comment composer and its draft guard.

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  NEW_DRAFT_THREAD_ID,
  addCommentDraftTarget,
  draftSnippet,
  type DraftScope,
  type DraftTarget,
} from "../draftStorage";
import {
  useDraftPersistence,
  type DraftPersistence,
} from "../useDraftPersistence";
import { draftTargetsOnScreen, isSameDraftTarget } from "./derive";

interface DraftControllerOptions {
  draftScope: DraftScope | undefined;
  selectedPath: string;
  selectedPathRef: MutableRefObject<string>;
  revealComments: () => void;
  setActiveThreadId: Dispatch<SetStateAction<string | null>>;
}

/**
 * The single open comment composer for this experience (new comment or
 * reply), its locally-persisted text, and the one-active-draft guard.
 */
export function useDraftController(opts: DraftControllerOptions) {
  const { selectedPath, revealComments, setActiveThreadId } = opts;
  // The single open comment composer for this experience, or null. A
  // new-comment draft uses `threadId === NEW_DRAFT_THREAD_ID` (+ its selection
  // anchor); a reply draft carries the real thread id. Only one is ever open —
  // opening a second while this one has text prompts the discard dialog.
  const [activeDraft, setActiveDraft] = useState<DraftTarget | null>(null);
  // Pending discard prompt: the composer the user asked to open plus the
  // existing draft's file + snippet to show in the dialog.
  const [draftGuard, setDraftGuard] = useState<DraftGuard | null>(null);
  const [draftY, setDraftY] = useState<number | null>(null);

  // Locally-persisted draft (one per experience). `onRestore` adopts a stored
  // draft on mount so its lock is live and its composer re-opens on the right
  // file; ArticleView recomputes a new-comment draft's Y as it wraps the anchor.
  const restoreDraft = useCallback(
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

  const requests = useDraftRequests({
    ...opts,
    draft,
    activeDraft,
    setActiveDraft,
    setDraftGuard,
    setDraftY,
  });

  const resolutions = useDraftResolutions({
    ...opts,
    draft,
    draftGuard,
    activeDraftRef: requests.activeDraftRef,
    setActiveDraft,
    setDraftGuard,
    setDraftY,
  });

  return {
    activeDraft,
    setActiveDraft,
    activeDraftRef: requests.activeDraftRef,
    draftGuard,
    draftY,
    setDraftY,
    draft,
    draftAnchor,
    activeReplyThreadId,
    requestDraft: requests.requestDraft,
    dismissEmptyDraftRef: requests.dismissEmptyDraftRef,
    onAddImplicitComment: requests.onAddImplicitComment,
    onRequestReply: requests.onRequestReply,
    ...resolutions,
  };
}

/** Pending discard prompt for a requested composer while another holds text. */
interface DraftGuard {
  requested: DraftTarget;
  existingPath: string;
  snippet: string;
}

interface DraftSetters {
  setActiveDraft: Dispatch<SetStateAction<DraftTarget | null>>;
  setDraftGuard: Dispatch<SetStateAction<DraftGuard | null>>;
  setDraftY: Dispatch<SetStateAction<number | null>>;
}

interface DraftRequestsOptions extends DraftControllerOptions, DraftSetters {
  draft: DraftPersistence;
  activeDraft: DraftTarget | null;
}

/** Opening a composer (guarded) and dismissing an empty one. */
function useDraftRequests(opts: DraftRequestsOptions) {
  const {
    selectedPathRef,
    revealComments,
    setActiveThreadId,
    draft,
    activeDraft,
    setActiveDraft,
    setDraftGuard,
    setDraftY,
  } = opts;

  // Guarded open: adopt the requested composer unless a *different* draft still
  // holds text, in which case prompt to discard it first. An empty existing
  // draft is silently replaced (nothing to lose).
  const activeDraftRef = useRef(activeDraft);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref read by the stable requestDraft/dismiss/post callbacks; written in render so a callback fired by a child's layout effect or handler in this commit already sees this render's draft.
  activeDraftRef.current = activeDraft;

  const requestDraft = useCallback(
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
    [draft, revealComments, setActiveThreadId, setActiveDraft, setDraftGuard],
  );

  // Stable ref for the document-level ESC / outside-click handlers so they can
  // dismiss an *empty* draft without re-subscribing on every draft change.
  // Assigned on every render below (before any handler can fire), so the
  // `null!` seed is never actually called.
  const dismissEmptyDraftRef = useRef<() => void>(null!);

  // eslint-disable-next-line react-hooks/refs -- latest-value ref for stable document listeners and callbacks; written in render so the `null!` seed is never observable, even from a child's layout effect on mount.
  dismissEmptyDraftRef.current = () => {
    // Never discard text the user has typed — only tear down a bare composer
    // (a selection with no reply/comment written yet).
    if (activeDraftRef.current === null) return;
    if (draft.getSnapshot().trim() !== "") return;
    draft.clear();
    setActiveDraft(null);
    setDraftY(null);
  };

  const onAddImplicitComment = useCallback(() => {
    requestDraft(
      addCommentDraftTarget(activeDraftRef.current, selectedPathRef.current),
    );
  }, [requestDraft, selectedPathRef]);

  // A thread's "reply" trigger requests its reply composer, subject to the same
  // guard (an active draft elsewhere prompts the discard dialog first).
  const onRequestReply = useCallback(
    (threadId: string) => {
      requestDraft({
        path: selectedPathRef.current,
        threadId,
        anchor: null,
      });
    },
    [requestDraft, selectedPathRef],
  );

  return {
    activeDraftRef,
    requestDraft,
    dismissEmptyDraftRef,
    onAddImplicitComment,
    onRequestReply,
  };
}

interface DraftResolutionsOptions extends DraftControllerOptions, DraftSetters {
  draft: DraftPersistence;
  draftGuard: DraftGuard | null;
  activeDraftRef: MutableRefObject<DraftTarget | null>;
}

/** Cancelling, posting and the draft-guard dialog's outcomes. */
function useDraftResolutions(opts: DraftResolutionsOptions) {
  const {
    revealComments,
    setActiveThreadId,
    draft,
    draftGuard,
    activeDraftRef,
    setActiveDraft,
    setDraftGuard,
    setDraftY,
  } = opts;

  const onCancelReply = useCallback(() => {
    draft.clear();
    setActiveDraft(null);
  }, [draft, setActiveDraft]);

  // Draft-guard dialog resolution. Discard drops the existing draft and opens
  // the composer the user asked for; keep-editing just dismisses the prompt.
  const onDiscardExistingDraft = useCallback(() => {
    const g = draftGuard;
    if (!g) return;
    draft.clear();
    setDraftY(null);
    setActiveDraft(g.requested);
    revealComments();

    if (g.requested.threadId !== NEW_DRAFT_THREAD_ID) {
      setActiveThreadId(g.requested.threadId);
    }

    setDraftGuard(null);
  }, [
    draft,
    draftGuard,
    revealComments,
    setActiveThreadId,
    setActiveDraft,
    setDraftGuard,
    setDraftY,
  ]);

  const onKeepExistingDraft = useCallback(
    () => setDraftGuard(null),
    [setDraftGuard],
  );

  // A write can be held for minutes through the ADO session refresh. By the
  // time it lands the user may have cancelled this composer or started another
  // draft — only close and clear the composer still showing exactly what was
  // posted, never a newer draft.
  const isStillPostedDraft = useCallback(
    (postedTarget: DraftTarget | null, body: string): boolean =>
      activeDraftRef.current === postedTarget &&
      draft.getSnapshot().trim() === body,
    [draft, activeDraftRef],
  );

  const onCancelDraft = useCallback(() => {
    setActiveDraft(null);
    setDraftY(null);
    draft.clear();
  }, [draft, setActiveDraft, setDraftY]);

  return {
    onCancelReply,
    onDiscardExistingDraft,
    onKeepExistingDraft,
    isStillPostedDraft,
    onCancelDraft,
  };
}
