// Draft-persistence glue for the PR shell. Keeps a SINGLE in-progress comment
// draft per experience — a new comment or a reply to an existing thread — in
// localStorage, restored on reload. The shell enforces "one active draft"
// (opening a second composer while a draft has text prompts a discard dialog);
// this hook just owns the persist/restore/snapshot primitives so its branches
// are unit-testable in jsdom (the shell only renders in the iframe/storybook
// harness).

import * as React from "react";

import {
  clearDraft,
  createThrottledDraftWriter,
  loadDraft,
  NEW_DRAFT_THREAD_ID,
  type DraftScope,
  type DraftTarget,
} from "./draftStorage";

export interface UseDraftPersistenceOptions {
  /** Experience the draft belongs to; `undefined` disables persistence. */
  scope: DraftScope | undefined;
  /** The composer currently open (its persistence target), or `null`. */
  activeDraft: DraftTarget | null;
  /** Adopt a restored draft on mount (sets the shell's active draft). */
  onRestore: (target: DraftTarget, body: string) => void;
}

export interface DraftPersistence {
  /**
   * Seed text for the composer when it (re)mounts — the live draft body. Read
   * at mount by the Composer, so a draft re-opened after a file switch or
   * reload comes back with its text intact.
   */
  initialBody: string;
  /** Feed composer text changes; throttle-persists, clears when emptied. */
  handleChange: (body: string) => void;
  /** Clear the persisted + in-memory draft (post / cancel / discard). */
  clear: () => void;
  /** Latest composer text — used for the "one active draft" checks + snippet. */
  getSnapshot: () => string;
}

/**
 * Persist and restore a single in-progress comment draft (new comment or reply)
 * for `scope`. Persistence keys off the passed `activeDraft`, so the same
 * handlers serve both the new-comment balloon and a thread's reply composer.
 */
export function useDraftPersistence(
  opts: UseDraftPersistenceOptions,
): DraftPersistence {
  const { scope, activeDraft, onRestore } = opts;

  const writer = React.useMemo(
    () => (scope ? createThrottledDraftWriter(scope) : null),
    [scope],
  );

  const activeDraftRef = React.useRef(activeDraft);
  activeDraftRef.current = activeDraft;
  const snapshotRef = React.useRef("");

  // Bump on restore/clear so a mounted composer re-reads `initialBody` from the
  // snapshot at the right moment (the value itself is read live during render).
  const [, forceSeed] = React.useReducer((n: number) => n + 1, 0);

  // Restore once on mount. The stored draft may target a different file than
  // the one on screen; we adopt it regardless so its lock is live and its
  // composer re-opens when the user navigates to (or is already on) its file.
  const restoredRef = React.useRef(false);
  const onRestoreRef = React.useRef(onRestore);
  onRestoreRef.current = onRestore;
  React.useEffect(() => {
    if (!scope || restoredRef.current) return;
    restoredRef.current = true;
    const stored = loadDraft(scope);
    if (!stored) return;
    snapshotRef.current = stored.body;
    forceSeed();
    onRestoreRef.current(
      {
        path: stored.path,
        threadId: stored.threadId,
        anchor: stored.anchor,
      },
      stored.body,
    );
  }, [scope]);

  // Flush a pending write on unmount so the last keystrokes survive a soft
  // teardown (host navigation away from the shell).
  React.useEffect(() => {
    return () => writer?.flush();
  }, [writer]);

  const handleChange = React.useCallback(
    (body: string) => {
      snapshotRef.current = body;
      if (!scope || !writer) return;
      const target = activeDraftRef.current;
      if (!target) return;
      if (body.trim().length > 0) {
        writer.schedule({
          path: target.path,
          threadId: target.threadId,
          anchor:
            target.threadId === NEW_DRAFT_THREAD_ID ? target.anchor : null,
          body,
        });
      } else {
        // Emptying the composer discards the persisted draft immediately.
        writer.cancel();
        clearDraft(scope);
      }
    },
    [scope, writer],
  );

  const clear = React.useCallback(() => {
    snapshotRef.current = "";
    forceSeed();
    writer?.cancel();
    if (scope) clearDraft(scope);
  }, [scope, writer]);

  const getSnapshot = React.useCallback(() => snapshotRef.current, []);

  return {
    initialBody: snapshotRef.current,
    handleChange,
    clear,
    getSnapshot,
  };
}
