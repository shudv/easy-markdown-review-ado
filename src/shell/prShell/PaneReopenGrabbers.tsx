// Edge grabbers that reopen PrShell's collapsed panes.

import * as React from "react";

type PointerHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

interface PaneReopenGrabbersProps {
  navShown: boolean;
  commentsShown: boolean;
  onNavReopenStart: PointerHandler;
  onNavReopenMove: PointerHandler;
  onNavReopenEnd: () => void;
  onCommentReopenStart: PointerHandler;
  onCommentReopenMove: PointerHandler;
  onCommentReopenEnd: () => void;
}

/**
 * Edge grabbers to REOPEN a collapsed pane by dragging inward — the drag
 * counterpart to the status-bar toggles. Only mounted while a pane is hidden
 * (full reader), pinned to the frame's edge.
 */
export function PaneReopenGrabbers(
  props: PaneReopenGrabbersProps,
): React.ReactElement {
  return (
    <>
      {props.navShown ? (
        <div
          className="emr-nav-reopen"
          title="Drag to reopen navigation"
          aria-hidden="true"
          onPointerDown={props.onNavReopenStart}
          onPointerMove={props.onNavReopenMove}
          onPointerUp={props.onNavReopenEnd}
          onPointerCancel={props.onNavReopenEnd}
        />
      ) : null}
      {props.commentsShown ? (
        <div
          className="emr-rail-reopen"
          title="Drag to reopen comments"
          aria-hidden="true"
          onPointerDown={props.onCommentReopenStart}
          onPointerMove={props.onCommentReopenMove}
          onPointerUp={props.onCommentReopenEnd}
          onPointerCancel={props.onCommentReopenEnd}
        />
      ) : null}
    </>
  );
}
