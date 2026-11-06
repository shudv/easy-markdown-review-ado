// List-marker, checklist-state, and block-structure change explanations.

import { wrapFormattingRanges } from "./formatting";
import { applyDiffTooltip } from "./tooltip";
import {
  DIFF_LIST_MARKER_CLASS,
  DIFF_TASK_STATE_CLASS,
  DIFF_TASK_TOOLTIP_CLASS,
  inlineProseTarget,
  isChildBlock,
} from "./shared";

/** The text a list item shows itself, before any nested list or child block. */
export function leadText(item: HTMLElement): string {
  let lead = "";

  for (const child of Array.from(inlineProseTarget(item).childNodes)) {
    if (child instanceof HTMLElement && isChildBlock(child)) break;
    lead += child.textContent;
  }

  return lead;
}

/**
 * Tint a list item's own text — not its nested lists or child blocks — as an
 * explained structural change. An item with no text of its own (an image, say)
 * carries the explanation on the item itself.
 */
export function explainLeadText(item: HTMLElement, label: string): void {
  const lead = leadText(item);
  const start = lead.length - lead.trimStart().length;
  const end = lead.trimEnd().length;

  if (end > start) {
    wrapFormattingRanges(inlineProseTarget(item), [{ start, end, label }]);
  } else {
    applyDiffTooltip(item, label);
  }
}

export function applyLeafStructureDiff(
  original: HTMLElement,
  target: HTMLElement,
): boolean {
  if (target.tagName !== "LI" || original.tagName !== "LI") return false;
  const markerLabel = listMarkerChangeLabel(original, target);
  const taskChange = checklistStateChange(original, target);
  if (markerLabel !== null) target.classList.add(DIFF_LIST_MARKER_CLASS);
  if (taskChange) taskChange.input.classList.add(DIFF_TASK_STATE_CLASS);

  if (markerLabel !== null) {
    applyDiffTooltip(
      target,
      taskChange
        ? `List item changed: ${markerLabel}; ${taskChange.label}`
        : `List marker changed from ${markerLabel.slice("marker ".length)}`,
    );

    return true;
  }

  if (!taskChange) return false;
  const currentTask = taskChange.input;
  const wrapper = currentTask.ownerDocument.createElement("span");
  wrapper.className = DIFF_TASK_TOOLTIP_CLASS;
  currentTask.before(wrapper);
  wrapper.appendChild(currentTask);
  applyDiffTooltip(
    wrapper,
    `Checklist item changed from ${taskChange.label.slice("checklist item ".length)}`,
  );

  return true;
}

function isListTag(tag: string | undefined): boolean {
  return tag === "UL" || tag === "OL";
}

function listKindName(tag: string | undefined): string {
  return tag === "OL" ? "numbered" : "bulleted";
}

/** Label for a bullet <-> number switch of a list item, or null. */
function listMarkerChangeLabel(
  original: HTMLElement,
  target: HTMLElement,
): string | null {
  const originalList = original.parentElement?.tagName;
  const currentList = target.parentElement?.tagName;

  const markerChanged =
    isListTag(originalList) &&
    isListTag(currentList) &&
    originalList !== currentList;

  return markerChanged
    ? `marker ${listKindName(originalList)} to ${listKindName(currentList)}`
    : null;
}

function checkedName(task: HTMLInputElement): string {
  return task.checked ? "checked" : "unchecked";
}

/** The live checkbox of a task item whose checked state flipped, or null. */
function checklistStateChange(
  original: HTMLElement,
  target: HTMLElement,
): { input: HTMLInputElement; label: string } | null {
  const originalTask = original.querySelector<HTMLInputElement>(
    ':scope input[type="checkbox"]',
  );

  const currentTask = target.querySelector<HTMLInputElement>(
    ':scope input[type="checkbox"]',
  );

  if (
    originalTask == null ||
    currentTask == null ||
    originalTask.checked === currentTask.checked
  ) {
    return null;
  }

  return {
    input: currentTask,
    label: `checklist item ${checkedName(originalTask)} to ${checkedName(currentTask)}`,
  };
}

export function applyBlockStructureDiff(
  original: HTMLElement,
  target: HTMLElement,
  text: string,
): boolean {
  if (original.tagName === target.tagName || text.length === 0) return false;

  const describeBlock = (tag: string): string => {
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) return `heading level ${heading[1]}`;

    return {
      BLOCKQUOTE: "quote",
      LI: "list item",
      P: "paragraph",
    }[tag]!;
  };

  wrapFormattingRanges(target, [
    {
      start: 0,
      end: text.length,
      label: `Block changed from ${describeBlock(original.tagName)} to ${describeBlock(target.tagName)}`,
    },
  ]);

  return true;
}
