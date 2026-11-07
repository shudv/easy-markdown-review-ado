// Shell comment rail column with its resize handle.

import type { ReactElement, ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { RailSkeleton } from "./Skeletons";

type PointerHandler = (e: ReactPointerEvent<HTMLDivElement>) => void;

interface RailPaneProps {
    /** Show the rail skeleton while the document (or its version) loads. */
    showSkeleton: boolean;
    /** Full reader with a comments UI: the rail's left border resizes it. */
    resizable: boolean;
    /** The CommentRail shown once the document is ready. */
    children: ReactNode;
    onResizeStart: PointerHandler;
    onResizeMove: PointerHandler;
    onResizeEnd: () => void;
    onResetWidth: () => void;
}

/**
 * Comment rail — a SEPARATE scroll container (a flex sibling of `.emr-body`,
 * not nested in it), so scrolling the article to its end never chain-scrolls
 * the comments. It carries a native scrollbar (styled to match the reader) on
 * its far-right edge. The wrapper stays mounted while the skeleton/list swaps
 * inside, so the rail's scroll position survives the load. Its own left-border
 * handle (full reader only) drag-resizes it live, INDEPENDENTLY of the nav.
 */
export function RailPane(props: Readonly<RailPaneProps>): ReactElement {
    return (
        <div className="emr-rail">
            <div className="emr-rail-scroll">
                {props.showSkeleton ? <RailSkeleton /> : props.children}
            </div>
            {/* Drag the rail's LEFT border to resize the comments live;
          double-click resets. Mouse-only enhancement (aria-hidden),
          mirroring the nav handle — full reader only (single-file panels
          keep a fixed rail). */}
            {props.resizable ? (
                <div
                    className="emr-rail-resize"
                    title="Drag to resize comments (double-click to reset)"
                    aria-hidden="true"
                    onPointerDown={props.onResizeStart}
                    onPointerMove={props.onResizeMove}
                    onPointerUp={props.onResizeEnd}
                    onPointerCancel={props.onResizeEnd}
                    onDoubleClick={props.onResetWidth}
                />
            ) : null}
        </div>
    );
}
