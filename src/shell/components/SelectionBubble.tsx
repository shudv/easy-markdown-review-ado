// Small floating popover shown right above the user's selection.
// Normally "Add comment" plus a quiet "Copy link to selection" glyph. When a
// comment can't be attached to the selection (e.g. comparing an earlier PR
// update where the text no longer exists in the latest version), it explains
// why and offers a way forward instead. Read-only surfaces show only the link.

import * as React from "react";

interface SelectionBubbleProps {
  /** Top in px relative to article-wrap. */
  top: number;
  /** Left in px relative to article-wrap. */
  left: number;
  /** Omitted when commenting isn't available (read-only surfaces). */
  onAddComment?: () => void;
  /**
   * Copy a shareable link to the selected text; resolves to whether the copy
   * succeeded. Omitted when the host can't build a shareable URL.
   */
  onCopyLink?: () => Promise<boolean>;
  /** Called once the copy confirmation has been shown, to close the bubble. */
  onCopyLinkSettled?: () => void;
  /** Why the selection can't be commented on, with an alternative action. */
  block?: { message: string; actionLabel: string; onAction: () => void } | null;
}

const COPY_LINK_LABEL = "Copy link to selection";

/** How long the copy outcome stays visible before the bubble closes. */
const LINK_RESULT_MS = { copied: 1200, failed: 2400 } as const;

export function SelectionBubble(
  props: SelectionBubbleProps,
): React.ReactElement {
  const { top, left, onAddComment, onCopyLink, onCopyLinkSettled, block } =
    props;
  const [linkState, setLinkState] = React.useState<
    "idle" | "pending" | keyof typeof LINK_RESULT_MS
  >("idle");
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

  if (block) {
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
  const linkResult =
    linkState === "copied"
      ? "Link copied"
      : linkState === "failed"
        ? "Couldn't copy link"
        : null;
  // Alone (read-only), the link button carries a visible label.
  const linkText = linkResult ?? (onAddComment ? null : "Copy link");

  return (
    <div
      className="emr-selection-bubble"
      style={{ top, left }}
      // Don't let mousedown clear the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {onAddComment ? (
        <button type="button" onClick={onAddComment}>
          <span style={{ fontSize: 13 }}>💬</span>
          Add comment
        </button>
      ) : null}
      {onAddComment && copyLink ? (
        <span className="emr-selection-bubble-divider" aria-hidden="true" />
      ) : null}
      {copyLink ? (
        <button
          type="button"
          className={[
            "emr-selection-bubble-link",
            linkState === "copied" ? "is-copied" : "",
            linkState === "failed" ? "is-failed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={linkResult ?? COPY_LINK_LABEL}
          title={linkResult ?? COPY_LINK_LABEL}
          onClick={copyLink}
        >
          <span className="emr-selection-bubble-link-icon" aria-hidden="true" />
          {linkText ? <span aria-hidden="true">{linkText}</span> : null}
        </button>
      ) : null}
      <span className="emr-sr-only" role="status" aria-live="polite">
        {linkResult ?? ""}
      </span>
    </div>
  );
}
