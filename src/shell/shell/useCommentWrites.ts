// Shell: comment-write error banner and in-flight bookkeeping.

import { useCallback, useState } from "react";

import { trackUserFacingError } from "../../telemetry";
import { friendlyWriteError } from "../shellHelpers";

/**
 * Comment-write bookkeeping: the failed-write banner, the in-flight count that
 * disables every composer's submit, and the open inline editors.
 */
export function useCommentWrites() {
    // Transient error surfaced when a remote write fails. Cleared on next success.
    const [persistError, setPersistError] = useState<string | null>(null);
    // Wrap an async persistence call so errors surface in the rail banner. While
    // any write is in flight every composer's submit is disabled (see
    // ComposerBusyContext) — a write can be held for minutes through the ADO
    // token dead window, and a second click must not post a duplicate.
    const [writesInFlight, setWritesInFlight] = useState(0);
    // Open inline comment editors (see editorRegistry.ts): their text isn't kept
    // as a draft, so the reconnect notice hides "Reload page" while any is open.
    const [openEditors, setOpenEditors] = useState(0);

    const registerEditor = useCallback(() => {
        setOpenEditors((n) => n + 1);

        return () => setOpenEditors((n) => n - 1);
    }, []);

    const persistWith = useCallback(
        async <T>(label: string, op: () => Promise<T>): Promise<T | null> => {
            setWritesInFlight((n) => n + 1);

            try {
                const result = await op();
                setPersistError(null);

                return result;
            } catch (err) {
                setPersistError(friendlyWriteError(label, err));

                console.error(`[Shell] ${label} failed:`, err);
                trackUserFacingError({
                    error: err,
                    source: label,
                    operation: "comment-write",
                    impact: "action-failed",
                });

                return null;
            } finally {
                setWritesInFlight((n) => n - 1);
            }
        },
        [],
    );

    return {
        persistError,
        setPersistError,
        writesInFlight,
        openEditors,
        registerEditor,
        persistWith,
    };
}

export type PersistWith = ReturnType<typeof useCommentWrites>["persistWith"];
