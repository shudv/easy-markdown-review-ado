// The floating selection bubble `ArticleView` shows above a text selection:
// its state, placement, link target, and the wired-up bubble element.

import * as React from "react";
import type { TextQuoteAnchor } from "../../types";
import { SelectionBubble } from "./SelectionBubble";
import { buildTextFragment, serializeTextFragment } from "../textFragment";
import type { CommentBlock, SelectionLinkTarget } from "./ArticleView.types";

export interface SelectionBubbleState {
  top: number;
  left: number;
  anchor: TextQuoteAnchor;
  /** Set when a comment can't be attached to this selection. */
  block: CommentBlock | null;
  /** Set when the selection can be linked to. */
  link: SelectionLinkTarget | null;
}

/** The link target for `range`, or null when it holds no live text. */
export function selectionLinkTarget(
  article: HTMLElement,
  range: Range,
): SelectionLinkTarget | null {
  const fragment = buildTextFragment(article, range);
  if (!fragment) return null;
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const heading = start
    ?.closest(".emr-section")
    ?.querySelector<HTMLElement>(":scope > :is(h1, h2, h3, h4, h5, h6)[id]");
  return {
    text: serializeTextFragment(fragment),
    ...(heading ? { anchor: heading.id } : {}),
  };
}

/**
 * Approx selection bubble width (button label + chrome), used to clamp it
 * horizontally. The explained (blocked) variant carries a sentence and an
 * action.
 */
export function selectionBubbleWidth(
  block: CommentBlock | null,
  readOnly: boolean,
  link: SelectionLinkTarget | null,
): number {
  if (block) return 320;
  if (readOnly) return 104;
  return link ? 170 : 132;
}

/** Where the selection bubble sits relative to the article wrap. */
export function selectionBubblePosition(
  rect: DOMRect,
  wrapRect: DOMRect,
  bubbleWidth: number,
): { top: number; left: number } {
  const desiredTop = rect.top - wrapRect.top - 36;
  const desiredLeft =
    rect.left + rect.width / 2 - wrapRect.left - bubbleWidth / 2;
  return {
    // Don't render above the article. If selection is at the very top,
    // tuck the bubble just below it instead of off-screen.
    top: desiredTop < 4 ? rect.bottom - wrapRect.top + 8 : desiredTop,
    // Clamp horizontally so the bubble always fully fits inside wrap.
    left: Math.max(4, Math.min(desiredLeft, wrapRect.width - bubbleWidth - 4)),
  };
}

/** The floating selection bubble, wired to the article's comment/link actions. */
export function ArticleSelectionBubble(
  props: Readonly<{
    bubble: SelectionBubbleState;
    readOnly: boolean;
    onCopySelectionLink:
      | ((target: SelectionLinkTarget) => Promise<boolean>)
      | undefined;
    onSelection: (anchor: TextQuoteAnchor) => void;
    onDismiss: () => void;
  }>,
): React.ReactElement {
  const { bubble, readOnly, onCopySelectionLink, onSelection, onDismiss } =
    props;
  return (
    <SelectionBubble
      top={bubble.top}
      left={bubble.left}
      block={
        bubble.block
          ? {
              ...bubble.block,
              onAction: () => {
                const action = bubble.block!.onAction;
                onDismiss();
                window.getSelection()?.removeAllRanges();
                action();
              },
            }
          : null
      }
      onAddComment={
        readOnly
          ? undefined
          : () => {
              const a = bubble.anchor;
              onDismiss();
              // Collapse selection so the highlight is visible.
              window.getSelection()?.removeAllRanges();
              onSelection(a);
            }
      }
      onCopyLink={
        bubble.link && onCopySelectionLink
          ? () => onCopySelectionLink(bubble.link!)
          : undefined
      }
      onCopyLinkSettled={onDismiss}
    />
  );
}
