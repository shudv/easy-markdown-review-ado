// PrShell: selecting threads and text in the article.

import * as React from "react";

import type { TextQuoteAnchor } from "../../types";
import { relocateAnchor } from "../../comments/anchor";
import { events, track } from "../../telemetry";
import { NEW_DRAFT_THREAD_ID, type DraftTarget } from "../draftStorage";

interface ThreadSelectionOptions {
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  scrollDocToAnchor: (tid: string) => void;
  requestDraft: (target: DraftTarget) => void;
  selectedPathRef: React.MutableRefObject<string>;
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
  const onHighlightClick = React.useCallback(
    (tid: string) => {
      // The clicked highlight is already in view, so only select — the
      // rail-follow effect brings its balloon into view in the rail's own
      // scroll.
      setActiveThreadId(tid);
    },
    [setActiveThreadId],
  );

  const onSelectThread = React.useCallback(
    (tid: string) => {
      /* v8 ignore next -- no-op updater branch when the thread is already active */
      setActiveThreadId((curr) => (curr === tid ? curr : tid));
      scrollDocToAnchor(tid);
    },
    [scrollDocToAnchor, setActiveThreadId],
  );

  // Cycle from the status bar: select the thread and scroll the document to its
  // anchor. The rail-follow effect reveals the balloon and auto-expands any
  // collapsed tray containing it. Replying remains an explicit rail action.
  const onCycleToThread = React.useCallback(
    (tid: string) => {
      setActiveThreadId(tid);
      track(events.commentNavigated());
      scrollDocToAnchor(tid);
    },
    [scrollDocToAnchor, setActiveThreadId],
  );

  // A text selection requests a *new-comment* composer at that anchor, subject
  // to the one-active-draft guard. Comments attach to the latest version, so a
  // selection made while comparing an earlier update — which carries THAT
  // version's source lines — is positioned against the latest rendering right
  // away: the draft then stays correct however the comparison changes before
  // it's posted (the bubble only offers "Add comment" for text the latest
  // version still has; see `commentBlocker`).
  const onSelectionMade = React.useCallback(
    (anchor: TextQuoteAnchor) => {
      const path = selectedPathRef.current;
      requestDraft({
        path,
        threadId: NEW_DRAFT_THREAD_ID,
        anchor:
          nativeIterationMode && viewingHistorical
            ? /* v8 ignore start -- the bubble only opens a composer for text found in the latest version */
              (relocateAnchor(anchor, htmlByPath[path] ?? "") ?? anchor)
            : /* v8 ignore stop */
              anchor,
      });
    },
    [
      requestDraft,
      nativeIterationMode,
      viewingHistorical,
      htmlByPath,
      selectedPathRef,
    ],
  );

  return { onHighlightClick, onSelectThread, onCycleToThread, onSelectionMade };
}
