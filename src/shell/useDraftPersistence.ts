// Draft-persistence glue for the Shell. Keeps a SINGLE in-progress comment
// draft per experience — a new comment or a reply to an existing thread — in
// localStorage, restored on reload. The shell enforces "one active draft"
// (opening a second composer while a draft has text prompts a discard dialog);
// this hook just owns the persist/restore/snapshot primitives so its branches
// are unit-testable in jsdom (the shell only renders in the iframe/storybook
// harness).

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";

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
export function useDraftPersistence(opts: UseDraftPersistenceOptions): DraftPersistence {
    const { scope, activeDraft, onRestore } = opts;

    const writer = useMemo(() => (scope ? createThrottledDraftWriter(scope) : null), [scope]);

    const activeDraftRef = useRef(activeDraft);
    // Layout effect: runs before any passive effect in the same commit, so a
    // composer emitting its text from a mount effect already sees the new target.
    useLayoutEffect(() => {
        activeDraftRef.current = activeDraft;
    });
    const snapshotRef = useRef("");

    // Bump on restore/clear so a mounted composer re-reads `initialBody` from the
    // snapshot at the right moment (the value itself is read live during render).
    const [, forceSeed] = useReducer((n: number) => n + 1, 0);

    // Restore once on mount. The stored draft may target a different file than
    // the one on screen; we adopt it regardless so its lock is live and its
    // composer re-opens when the user navigates to (or is already on) its file.
    const restoredRef = useRef(false);
    const onRestoreRef = useRef(onRestore);
    useLayoutEffect(() => {
        onRestoreRef.current = onRestore;
    });
    useEffect(() => {
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
    useEffect(() => () => writer?.flush(), [writer]);

    const handleChange = useCallback(
        (body: string) => {
            snapshotRef.current = body;
            if (!scope || !writer) return;
            const target = activeDraftRef.current;
            if (!target) return;

            if (body.trim().length > 0) {
                writer.schedule({
                    path: target.path,
                    threadId: target.threadId,
                    anchor: target.threadId === NEW_DRAFT_THREAD_ID ? target.anchor : null,
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

    const clear = useCallback(() => {
        snapshotRef.current = "";
        forceSeed();
        writer?.cancel();
        if (scope) clearDraft(scope);
    }, [scope, writer]);

    const getSnapshot = useCallback(() => snapshotRef.current, []);

    // eslint-disable-next-line react-hooks/refs -- `initialBody` is a deliberate live read of the latest composer text: keystrokes must not re-render the shell, and restore/clear call `forceSeed` to re-render exactly when a mounting composer must see a new seed.
    return { initialBody: snapshotRef.current, handleChange, clear, getSnapshot };
}
