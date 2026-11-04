// Idempotency: remove every decoration a previous pass applied.

import { WORD_REMOVED_CLASS, WORD_ADDED_CLASS } from "../wordDiffDom";
import { alignDiffTooltip } from "./tooltip";
import {
  DIFF_BLOCK_CLASS,
  DIFF_CELL_ADDED_CLASS,
  DIFF_CELL_CLASS,
  DIFF_CELL_INLINE_CLASS,
  DIFF_CELL_METADATA_CLASS,
  DIFF_CELL_REMOVED_CLASS,
  DIFF_DELETED_MARKER_CLASS,
  DIFF_FORMAT_CLASS,
  DIFF_IMAGE_CLASS,
  DIFF_INLINE_CLASS,
  DIFF_LINE_WASH_CLASS,
  DIFF_LIST_MARKER_CLASS,
  DIFF_MATH_CLASS,
  DIFF_MERMAID_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_SOURCE_ONLY_CLASS,
  DIFF_SUPPRESSED_TITLE_CLASS,
  DIFF_TABLE_COMPARISON_CLASS,
  DIFF_TASK_STATE_CLASS,
  DIFF_TASK_TOOLTIP_CLASS,
  DIFF_TOOLTIP_CLASS,
  DIFF_TOOLTIP_RIGHT_CLASS,
} from "./shared";

/**
 * Remove any decorations a previous pass applied so the transform stays
 * idempotent across re-renders / section toggles.
 */
export function clearDecorations(root: HTMLElement): void {
  clearBlockDecorations(root);
  clearTooltipDecorations(root);
  clearInlineDecorations(root);
}

/** Undo block-level washes, Before disclosures, and per-cell highlights. */
function clearBlockDecorations(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_LINE_WASH_CLASS}`)
    .forEach((wrapper) =>
      wrapper.replaceWith(...Array.from(wrapper.childNodes)),
    );
  root
    .querySelectorAll(".emr-diff-before-control, .emr-diff-before-panel")
    .forEach((el) => el.remove());
  root
    .querySelectorAll(`.${DIFF_CELL_REMOVED_CLASS}`)
    .forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>(`.${DIFF_BLOCK_CLASS}`).forEach((el) => {
    el.classList.remove(
      DIFF_BLOCK_CLASS,
      "emr-diff-block--added",
      "emr-diff-block--modified",
      DIFF_INLINE_CLASS,
      DIFF_MERMAID_CLASS,
      DIFF_MATH_CLASS,
      DIFF_IMAGE_CLASS,
    );
    delete el.dataset.diffKind;
    delete el.dataset.diffLabel;
    delete el.dataset.diffGroup;
    delete el.dataset.diffInline;
    delete el.dataset.diffOriginal;
    delete el.dataset.diffCells;
    delete el.dataset.diffAmberMode;
    delete el.dataset.diffLineWash;
  });
  // Undo per-cell table highlights (wash + inline modifier).
  root
    .querySelectorAll(`.${DIFF_CELL_CLASS}`)
    .forEach((el) =>
      el.classList.remove(
        DIFF_CELL_CLASS,
        DIFF_CELL_INLINE_CLASS,
        DIFF_CELL_ADDED_CLASS,
        DIFF_CELL_METADATA_CLASS,
      ),
    );
  root.querySelectorAll(`.${DIFF_METADATA_CLASS}`).forEach((el) => el.remove());
}

/** Restore the attributes an explanation tooltip replaced or suppressed. */
function clearTooltipDecorations(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`.${DIFF_TOOLTIP_CLASS}`).forEach((el) => {
    el.removeEventListener("pointerenter", alignDiffTooltip);
    el.removeEventListener("focus", alignDiffTooltip);
    el.classList.remove(DIFF_TOOLTIP_CLASS);
    el.classList.remove(DIFF_TOOLTIP_RIGHT_CLASS);
    delete el.dataset.diffTooltip;
    delete el.dataset.diffAmberMode;
    if (el.dataset.diffTooltipHadTitle === "true") {
      el.setAttribute("title", el.dataset.diffTooltipPreviousTitle!);
    } else {
      el.removeAttribute("title");
    }
    if (el.dataset.diffTooltipHadTabindex === "true") {
      el.setAttribute("tabindex", el.dataset.diffTooltipPreviousTabindex!);
    } else {
      el.removeAttribute("tabindex");
    }
    delete el.dataset.diffTooltipHadTitle;
    delete el.dataset.diffTooltipPreviousTitle;
    delete el.dataset.diffTooltipHadTabindex;
    delete el.dataset.diffTooltipPreviousTabindex;
    if (el.dataset.diffTooltipHadDescription === "true") {
      el.setAttribute(
        "aria-description",
        el.dataset.diffTooltipPreviousDescription!,
      );
    } else {
      el.removeAttribute("aria-description");
    }
    delete el.dataset.diffTooltipHadDescription;
    delete el.dataset.diffTooltipPreviousDescription;
  });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_SUPPRESSED_TITLE_CLASS}`)
    .forEach((el) => {
      el.classList.remove(DIFF_SUPPRESSED_TITLE_CLASS);
      el.setAttribute("title", el.dataset.diffTooltipPreviousTitle!);
      delete el.dataset.diffTooltipPreviousTitle;
    });
}

/** Unwrap inline change marks and remove inserted markers. */
function clearInlineDecorations(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`)
    .forEach((element) =>
      element.replaceWith(...Array.from(element.childNodes)),
    );
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_LIST_MARKER_CLASS}`)
    .forEach((element) => {
      element.classList.remove(DIFF_LIST_MARKER_CLASS);
    });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TASK_STATE_CLASS}`)
    .forEach((element) => {
      element.classList.remove(DIFF_TASK_STATE_CLASS);
    });
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TASK_TOOLTIP_CLASS}`)
    .forEach((wrapper) =>
      wrapper.replaceWith(...Array.from(wrapper.childNodes)),
    );
  // Undo any inline word-diff overlay: drop the removed-word insertions and
  // unwrap the added-word marks back to plain text so a re-decorate is stable.
  root.querySelectorAll(`.${WORD_REMOVED_CLASS}`).forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>(`.${WORD_ADDED_CLASS}`).forEach((el) => {
    /* v8 ignore next -- element textContent is never null */
    el.replaceWith(el.ownerDocument.createTextNode(el.textContent ?? ""));
  });
  root
    .querySelectorAll(
      `.${DIFF_DELETED_MARKER_CLASS}, .emr-diff-deleted-table-row`,
    )
    .forEach((el) => el.remove());
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_TABLE_COMPARISON_CLASS}`)
    .forEach((wrapper) =>
      wrapper.replaceWith(...Array.from(wrapper.childNodes)),
    );
  root
    .querySelectorAll<HTMLElement>(`.${DIFF_SOURCE_ONLY_CLASS}`)
    .forEach((element) => element.remove());
}
