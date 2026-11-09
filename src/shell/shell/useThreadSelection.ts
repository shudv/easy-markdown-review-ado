// Shell: selecting threads and text in the article.

import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";

import type { TextQuoteAnchor } from "../../types";
import { relocateAnchor } from "../../comments/anchor";
import { events, track } from "../../telemetry";
import { NEW_DRAFT_THREAD_ID, type DraftTarget } from "../draftStorage";

interface ThreadSelectionOptions {
    setActiveThreadId: Dispatch<SetStateAction<string | null>>;
    scrollDocToAnchor: (tid: string) => void;
    requestDraft: (target: DraftTarget) => void;
    selectedPathRef: MutableRefObject<string>;
    nativeIterationMode: boolean;
    viewingHistorical: boolean;
    htmlByPath: Record<string, string>;
}

/** Selecting threads (highlight, rail, status-bar cycle) and text selections. */
export function useThreadSelection(opts: ThreadSelectionOptions) {
    const {
        setActiveThreadId,
        scrollDocToAnchor,
        requestDraft,
        selectedPathRef,
        nativeIterationMode,
        viewingHistorical,
        htmlByPath,
    } = opts;

    const onHighlightClick = useCallback(
        (tid: string) => {
            // The clicked highlight is already in view, so only select — the
            // rail-follow effect brings its balloon into view in the rail's own
            // scroll.
            setActiveThreadId(tid);
        },
        // Stryker disable next-line ArrayDeclaration: every dependency is stable for the shell's lifetime (a useState setter, useDocScroll's dependency-free callback), so the callback never needs re-creating
        [setActiveThreadId],
    );

    const onSelectThread = useCallback(
        (tid: string) => {
            setActiveThreadId(tid);
            scrollDocToAnchor(tid);
        },
        // Stryker disable next-line ArrayDeclaration: every dependency is stable for the shell's lifetime (a useState setter, useDocScroll's dependency-free callback), so the callback never needs re-creating
        [scrollDocToAnchor, setActiveThreadId],
    );

    // Cycle from the status bar: select the thread and scroll the document to its
    // anchor. The rail-follow effect reveals the balloon and auto-expands any
    // collapsed tray containing it. Replying remains an explicit rail action.
    const onCycleToThread = useCallback(
        (tid: string) => {
            setActiveThreadId(tid);
            track(events.commentNavigated());
            scrollDocToAnchor(tid);
        },
        // Stryker disable next-line ArrayDeclaration: every dependency is stable for the shell's lifetime (a useState setter, useDocScroll's dependency-free callback), so the callback never needs re-creating
        [scrollDocToAnchor, setActiveThreadId],
    );

    // A text selection requests a *new-comment* composer at that anchor, subject
    // to the one-active-draft guard. Comments attach to the latest version, so a
    // selection made while comparing an earlier update — which carries THAT
    // version's source lines — is positioned against the latest rendering right
    // away: the draft then stays correct however the comparison changes before
    // it's posted (the bubble only offers "Add comment" for text the latest
    // version still has; see `commentBlocker`).
    const onSelectionMade = useCallback(
        (anchor: TextQuoteAnchor) => {
            const path = selectedPathRef.current;
            requestDraft({
                path,
                threadId: NEW_DRAFT_THREAD_ID,
                anchor:
                    nativeIterationMode && viewingHistorical
                        ? // Stryker disable next-line StringLiteral: without the latest HTML there is nothing to relocate against; any placeholder that doesn't contain the quote fails to relocate and keeps the selection's own anchor just like ""
                          (relocateAnchor(anchor, htmlByPath[path] ?? "") ?? anchor)
                        : anchor,
            });
        },
        [requestDraft, nativeIterationMode, viewingHistorical, htmlByPath, selectedPathRef],
    );

    return {
        onHighlightClick,
        onSelectThread,
        onCycleToThread,
        onSelectionMade,
    };
}
