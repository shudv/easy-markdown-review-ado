// PrShell navigation rail with its resize handle.

import * as React from "react";

type PointerHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

interface NavPaneProps {
  /** False in single-file panels, which drop the navigation rail entirely. */
  shown: boolean;
  /** The DocNav rendered in the rail. */
  children: React.ReactNode;
  onResizeStart: PointerHandler;
  onResizeMove: PointerHandler;
  onResizeEnd: () => void;
  onResetWidth: () => void;
}

/**
 * Navigation rail — fixed width, anchored to the viewport's left edge, its own
 * scroller. Rendered whenever the nav is a feature (full page); focus mode
 * hides it via `.is-nav-hidden` but keeps it MOUNTED so expand/scroll state
 * survives toggling (the document reclaims the freed width). Single-file
 * panels drop it entirely.
 */
export function NavPane(props: NavPaneProps): React.ReactElement | null {
  if (!props.shown) return null;
  return (
    <div className="emr-body__nav">
      {props.children}
      {/* Resize affordance on the rail's right border: drag to set
          the nav width, double-click to reset. Mouse enhancement
          (hidden from AT) — the toolbar's Navigation-width stepper is
          the keyboard-accessible equivalent. */}
      <div
        className="emr-nav-resize"
        title="Drag to resize navigation (double-click to reset)"
        aria-hidden="true"
        onPointerDown={props.onResizeStart}
        onPointerMove={props.onResizeMove}
        onPointerUp={props.onResizeEnd}
        onPointerCancel={props.onResizeEnd}
        onDoubleClick={props.onResetWidth}
      />
    </div>
  );
}
