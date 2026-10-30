// PrShell: drag-to-resize and drag-to-reopen for the side panes.

import * as React from "react";

import {
  clampNavWidthPct,
  clampCommentWidthPct,
  maxRailWidthPct,
  dragClosesPane,
  dragReopensPane,
  type ReaderPrefs,
} from "../readerPrefs";

// The nav rail's base width in px (the 100% nav-width scale). Mirrors the 340px
// base in `.emr-body__nav`'s flex-basis (styles.scss); drag deltas are
// converted to a percentage against it.
const NAV_BASE_WIDTH = 340;

type PointerHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

/** Pointer handlers for the nav/comment resize handles and reopen grabbers. */
export function usePaneResize(
  readerPrefs: ReaderPrefs,
  setReaderPrefs: React.Dispatch<React.SetStateAction<ReaderPrefs>>,
): {
  bodyFrameRef: React.MutableRefObject<HTMLDivElement | null>;
  commentsAvailableRef: React.MutableRefObject<boolean>;
  onNavResizeStart: PointerHandler;
  onNavResizeMove: PointerHandler;
  onNavResizeEnd: () => void;
  onCommentResizeStart: PointerHandler;
  onCommentResizeMove: PointerHandler;
  onCommentResizeEnd: () => void;
  onNavReopenStart: PointerHandler;
  onNavReopenMove: PointerHandler;
  onNavReopenEnd: () => void;
  onCommentReopenStart: PointerHandler;
  onCommentReopenMove: PointerHandler;
  onCommentReopenEnd: () => void;
} {
  // The reader frame. The resize handlers read its LIVE width to cap a drag at
  // the edge of the usable space — so growing a rail can never squeeze the
  // document below its floor and tip the reader into the too-narrow state — and
  // the too-narrow observer (`useTooNarrow`) watches it.
  const bodyFrameRef = React.useRef<HTMLDivElement | null>(null);
  const commentsAvailableRef = React.useRef(true);
  // Nav + comment resize: dragging a rail's inner-border handle sets THAT rail's
  // width live (continuous, clamped). The handle captures the pointer on press,
  // so every move — and the resize cursor — stays bound to it as the pointer
  // travels across the sheet; no document listeners or unmount teardown are
  // needed (capture releases itself on pointer-up and on unmount). A ref carries
  // the drag origin from the press to the moves it captures. The two rails
  // resize INDEPENDENTLY (separate prefs); each drag is capped via
  // `maxRailWidthPct` so the OTHER rail (always budgeted, since it can be
  // revealed) plus the document floor still fit.
  const navDragRef = React.useRef<{
    startX: number;
    startPct: number;
  } | null>(null);
  const onNavResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      navDragRef.current = {
        startX: e.clientX,
        startPct: readerPrefs.navWidthPct,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [readerPrefs.navWidthPct],
  );
  const onNavResizeMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = navDragRef.current;
      if (!drag) return;
      const frame = bodyFrameRef.current;
      /* v8 ignore next -- the frame is mounted throughout any in-progress drag */
      if (!frame) return;
      const frameWidth = frame.clientWidth;
      // Nav's RIGHT-border handle: dragging right (larger clientX) widens it.
      const deltaPct = ((e.clientX - drag.startX) / NAV_BASE_WIDTH) * 100;
      const rawTarget = drag.startPct + deltaPct;
      // Dragged well past the resize floor → collapse the pane (the same state
      // the status-bar toggle sets); the width pref is kept for the reopen.
      if (dragClosesPane(rawTarget)) {
        navDragRef.current = null;
        // The handle only exists while the nav is shown, so this always closes.
        setReaderPrefs((p) => ({ ...p, showNav: false }));
        return;
      }
      setReaderPrefs((p) => {
        const commentPx = commentsAvailableRef.current
          ? Math.round((NAV_BASE_WIDTH * p.commentWidthPct) / 100)
          : 0;
        const cap = maxRailWidthPct(frameWidth, commentPx);
        return {
          ...p,
          navWidthPct: Math.min(clampNavWidthPct(rawTarget), cap),
        };
      });
    },
    [setReaderPrefs],
  );
  const onNavResizeEnd = React.useCallback(() => {
    navDragRef.current = null;
  }, []);
  const commentDragRef = React.useRef<{
    startX: number;
    startPct: number;
  } | null>(null);
  const onCommentResizeStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      commentDragRef.current = {
        startX: e.clientX,
        startPct: readerPrefs.commentWidthPct,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [readerPrefs.commentWidthPct],
  );
  const onCommentResizeMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = commentDragRef.current;
      if (!drag) return;
      const frame = bodyFrameRef.current;
      /* v8 ignore next -- the frame is mounted throughout any in-progress drag */
      if (!frame) return;
      const frameWidth = frame.clientWidth;
      // Comment rail's LEFT-border handle: dragging LEFT (smaller clientX) widens
      // it, so the delta sign is mirrored from the nav handle.
      const deltaPct = ((drag.startX - e.clientX) / NAV_BASE_WIDTH) * 100;
      const rawTarget = drag.startPct + deltaPct;
      // Dragged well past the resize floor → collapse the pane (the same state
      // the status-bar toggle sets); the width pref is kept for the reopen.
      if (dragClosesPane(rawTarget)) {
        commentDragRef.current = null;
        // The handle only exists while comments show, so this always closes.
        setReaderPrefs((p) => ({ ...p, showComments: false }));
        return;
      }
      setReaderPrefs((p) => {
        const navPx = Math.round((NAV_BASE_WIDTH * p.navWidthPct) / 100);
        const cap = maxRailWidthPct(frameWidth, navPx);
        return {
          ...p,
          commentWidthPct: Math.min(clampCommentWidthPct(rawTarget), cap),
        };
      });
    },
    [setReaderPrefs],
  );
  const onCommentResizeEnd = React.useCallback(() => {
    commentDragRef.current = null;
  }, []);
  // Reopen a collapsed pane by dragging its edge grabber inward. The grabber is
  // only mounted while the pane is hidden; crossing the trigger flips show* back
  // on (restoring the last width) and the grabber unmounts mid-drag — fine, the
  // gesture is done. A ref holds the press origin (null = no drag in progress).
  const navReopenRef = React.useRef<number | null>(null);
  const onNavReopenStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      navReopenRef.current = e.clientX;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [],
  );
  const onNavReopenMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startX = navReopenRef.current;
      if (startX === null) return;
      // Nav grabber sits at the LEFT edge: drag RIGHT (inward) to reopen.
      if (dragReopensPane(e.clientX - startX)) {
        navReopenRef.current = null;
        // The grabber only exists while the nav is hidden, so this reopens it.
        setReaderPrefs((p) => ({ ...p, showNav: true }));
      }
    },
    [setReaderPrefs],
  );
  const onNavReopenEnd = React.useCallback(() => {
    navReopenRef.current = null;
  }, []);
  const commentReopenRef = React.useRef<number | null>(null);
  const onCommentReopenStart = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      commentReopenRef.current = e.clientX;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic (test) pointer has no active id to capture — ignore */
      }
    },
    [],
  );
  const onCommentReopenMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startX = commentReopenRef.current;
      if (startX === null) return;
      // Comment grabber sits at the RIGHT edge: drag LEFT (inward) to reopen.
      if (dragReopensPane(startX - e.clientX)) {
        commentReopenRef.current = null;
        // The grabber only exists while comments are hidden, so this reopens.
        setReaderPrefs((p) => ({ ...p, showComments: true }));
      }
    },
    [setReaderPrefs],
  );
  const onCommentReopenEnd = React.useCallback(() => {
    commentReopenRef.current = null;
  }, []);
  return {
    bodyFrameRef,
    commentsAvailableRef,
    onNavResizeStart,
    onNavResizeMove,
    onNavResizeEnd,
    onCommentResizeStart,
    onCommentResizeMove,
    onCommentResizeEnd,
    onNavReopenStart,
    onNavReopenMove,
    onNavReopenEnd,
    onCommentReopenStart,
    onCommentReopenMove,
    onCommentReopenEnd,
  };
}
