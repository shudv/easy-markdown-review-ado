// Sub-components + state hook for the SelectionBubble, split out so the
// bubble itself stays a thin layout of its optional controls.

import * as React from "react";
import {
  LINK_RESULT_MS,
  selectionLinkButtonClass,
  type SelectionLinkState,
} from "./SelectionBubble.helpers";

const COPY_LINK_LABEL = "Copy link to selection";

/**
 * Copy-link state machine: idle → pending → copied/failed, then (after the
 * outcome has been visible for a moment) reports `onCopyLinkSettled`.
 * `copyLink` is undefined when the host can't build a shareable URL.
 */
export function useSelectionCopyLink(
  onCopyLink: (() => Promise<boolean>) | undefined,
  onCopyLinkSettled: (() => void) | undefined,
): { linkState: SelectionLinkState; copyLink: (() => void) | undefined } {
  const [linkState, setLinkState] = React.useState<SelectionLinkState>("idle");
  const settledRef = React.useRef(onCopyLinkSettled);
  settledRef.current = onCopyLinkSettled;

  React.useEffect(() => {
    if (linkState !== "copied" && linkState !== "failed") return;
    const timer = window.setTimeout(
      () => settledRef.current?.(),
      LINK_RESULT_MS[linkState],
    );
    return () => window.clearTimeout(timer);
  }, [linkState]);

  const copyLink = onCopyLink
    ? () => {
        if (linkState !== "idle") return;
        setLinkState("pending");
        // A rejection (e.g. the link builder threw) is a failed copy too —
        // never a stuck "pending" bubble or an unhandled rejection.
        void onCopyLink().then(
          (ok) => setLinkState(ok ? "copied" : "failed"),
          () => setLinkState("failed"),
        );
      }
    : undefined;

  return { linkState, copyLink };
}

/** Bubble variant explaining why the selection can't be commented on. */
export function BlockedSelectionBubble(props: {
  top: number;
  left: number;
  block: { message: string; actionLabel: string; onAction: () => void };
}): React.ReactElement {
  const { top, left, block } = props;
  return (
    <div
      className="emr-selection-bubble is-blocked"
      style={{ top, left }}
      role="status"
      // Don't let mousedown clear the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="emr-selection-bubble-note">{block.message}</span>
      <button type="button" onClick={block.onAction}>
        {block.actionLabel}
      </button>
    </div>
  );
}

/** The "Copy link to selection" glyph button (labelled when shown alone). */
export function SelectionLinkButton(props: {
  linkState: SelectionLinkState;
  linkResult: string | null;
  /** Alone (read-only), the link button carries a visible label. */
  alone: boolean;
  onClick: () => void;
}): React.ReactElement {
  const { linkState, linkResult, alone, onClick } = props;
  const linkText = linkResult ?? (alone ? "Copy link" : null);
  return (
    <button
      type="button"
      className={selectionLinkButtonClass(linkState)}
      aria-label={linkResult ?? COPY_LINK_LABEL}
      title={linkResult ?? COPY_LINK_LABEL}
      onClick={onClick}
    >
      <span className="emr-selection-bubble-link-icon" aria-hidden="true" />
      {linkText ? <span aria-hidden="true">{linkText}</span> : null}
    </button>
  );
}
