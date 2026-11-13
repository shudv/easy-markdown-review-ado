// Shell: comment-write error banner and in-flight bookkeeping.

import { useCallback, useState } from "react";

import { t, type MessageKey } from "../../i18n";
import { trackUserFacingError } from "../../telemetry";
import { friendlyWriteError } from "../shellHelpers";

/**
 * Display text for each comment write. The English label itself is the
 * telemetry source and log name; only the toast shows the translation.
 */
const WRITE_ACTION_KEY = {
    "Create comment": "shell.writeAction.createComment",
    "Add reply": "shell.writeAction.addReply",
    "Resolve thread": "shell.writeAction.resolveThread",
    "Reopen thread": "shell.writeAction.reopenThread",
    "Mark thread pending": "shell.writeAction.markThreadPending",
    "Close thread": "shell.writeAction.closeThread",
    "Edit comment": "shell.writeAction.editComment",
    "Delete comment": "shell.writeAction.deleteComment",
    "Delete thread": "shell.writeAction.deleteThread",
    "Toggle reaction": "shell.writeAction.toggleReaction",
} as const satisfies Record<string, MessageKey>;

export type WriteAction = keyof typeof WRITE_ACTION_KEY;

/**
 * Comment-write bookkeeping: the failed-write banner, the in-flight count of
 * composer writes that disables every composer's submit, and the open inline
 * editors.
 */
export function useCommentWrites() {
    // Transient error surfaced when a remote write fails. Cleared on next success.
    const [persistError, setPersistError] = useState<string | null>(null);
    // Wrap an async persistence call so errors surface in the rail banner. While
    // a composer's write (post, reply, edit) is in flight every composer's
    // submit is disabled (see ComposerBusyContext) — a write can be held for
    // minutes through the ADO token dead window, and a second click must not
    // post a duplicate. Other writes (likes, status, deletes) don't count:
    // they can't duplicate a comment.
    const [composerWritesInFlight, setComposerWritesInFlight] = useState(0);
    // Open inline comment editors (see editorRegistry.ts): their text isn't kept
    // as a draft, so the reconnect notice hides "Reload page" while any is open.
    const [openEditors, setOpenEditors] = useState(0);

    const registerEditor = useCallback(() => {
        setOpenEditors((n) => n + 1);

        return () => setOpenEditors((n) => n - 1);
    }, []);

    const persistWith = useCallback(
        async <T>(
            label: WriteAction,
            op: () => Promise<T>,
            opts?: { fromComposer?: boolean },
        ): Promise<T | null> => {
            const fromComposer = opts?.fromComposer === true;
            if (fromComposer) setComposerWritesInFlight((n) => n + 1);

            try {
                const result = await op();
                setPersistError(null);

                return result;
            } catch (err) {
                setPersistError(friendlyWriteError(t(WRITE_ACTION_KEY[label]), err));

                console.error(`[Shell] ${label} failed:`, err);
                trackUserFacingError({
                    error: err,
                    source: label,
                    operation: "comment-write",
                    impact: "action-failed",
                });

                return null;
            } finally {
                if (fromComposer) setComposerWritesInFlight((n) => n - 1);
            }
        },
        [],
    );

    return {
        persistError,
        setPersistError,
        composerWritesInFlight,
        openEditors,
        registerEditor,
        persistWith,
    };
}

export type PersistWith = ReturnType<typeof useCommentWrites>["persistWith"];
