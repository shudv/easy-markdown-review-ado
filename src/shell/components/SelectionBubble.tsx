// Small floating popover shown right above the user's selection.
// Normally "Add comment" plus a quiet "Copy link to selection" glyph. When a
// comment can't be attached to the selection (e.g. comparing an earlier PR
// update where the text no longer exists in the latest version), it explains
// why and offers a way forward instead. Read-only surfaces show only the link.

import * as React from "react";
import { selectionLinkResultLabel } from "./SelectionBubble.helpers";
import {
  BlockedSelectionBubble,
  SelectionLinkButton,
  useSelectionCopyLink,
} from "./SelectionBubble.parts";

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

export function SelectionBubble(
  props: SelectionBubbleProps,
): React.ReactElement {
  const { top, left, onAddComment, onCopyLink, onCopyLinkSettled, block } =
    props;
  const { linkState, copyLink } = useSelectionCopyLink(
    onCopyLink,
    onCopyLinkSettled,
  );

  if (block) {
    return <BlockedSelectionBubble top={top} left={left} block={block} />;
  }

  const linkResult = selectionLinkResultLabel(linkState);

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
        <SelectionLinkButton
          linkState={linkState}
          linkResult={linkResult}
          alone={!onAddComment}
          onClick={copyLink}
        />
      ) : null}
      <span className="emr-sr-only" role="status" aria-live="polite">
        {linkResult ?? ""}
      </span>
    </div>
  );
}
