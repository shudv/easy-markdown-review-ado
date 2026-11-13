// List-marker, checklist-state, and block-structure change explanations.

import { type MessageKey, t } from "../../i18n";
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

export function applyLeafStructureDiff(original: HTMLElement, target: HTMLElement): boolean {
    if (target.tagName !== "LI") return false;
    if (original.tagName !== "LI") return false;
    const markerChange = listMarkerChange(original, target);
    const stateChange = checklistStateChange(original, target);
    const taskChange = stateChange ?? checklistToggled(original, target);
    if (markerChange !== null) target.classList.add(DIFF_LIST_MARKER_CLASS);
    // A newly added checkbox is explained, but its (default) state didn't change.
    if (stateChange) stateChange.input.classList.add(DIFF_TASK_STATE_CLASS);

    if (markerChange !== null) {
        const keys = MARKER_CHANGE_KEYS[markerChange];
        applyDiffTooltip(
            target,
            taskChange ? t(keys.withTask, { change: taskChange.label }) : t(keys.alone),
        );

        return true;
    }

    if (!taskChange) return false;
    explainChecklistChange(target, taskChange);

    return true;
}

/**
 * Explain a checklist change on the live checkbox, or — for an item that lost
 * its checkbox — on the item's own text.
 */
function explainChecklistChange(target: HTMLElement, change: ChecklistChange): void {
    const currentTask = change.input;

    if (currentTask == null) {
        explainLeadText(target, change.callout);

        return;
    }

    const wrapper = currentTask.ownerDocument.createElement("span");
    wrapper.className = DIFF_TASK_TOOLTIP_CLASS;
    currentTask.before(wrapper);
    wrapper.appendChild(currentTask);
    applyDiffTooltip(wrapper, change.callout);
}

function isListTag(tag: string | undefined): boolean {
    // Stryker disable next-line ConditionalExpression: it is only asked about a list item's parent, which is always a UL or OL
    return tag === "UL" || tag === "OL";
}

type ListMarkerChange = "toNumbered" | "toBulleted";

const MARKER_CHANGE_KEYS = {
    toNumbered: {
        alone: "document.list.markerToNumbered",
        withTask: "document.list.itemChangedToNumbered",
    },
    toBulleted: {
        alone: "document.list.markerToBulleted",
        withTask: "document.list.itemChangedToBulleted",
    },
} as const satisfies Record<ListMarkerChange, { alone: MessageKey; withTask: MessageKey }>;

/** The direction of a bullet <-> number switch of a list item, or null. */
function listMarkerChange(original: HTMLElement, target: HTMLElement): ListMarkerChange | null {
    // Stryker disable next-line OptionalChaining: a list item always sits in a list
    const originalList = original.parentElement?.tagName;
    // Stryker disable next-line OptionalChaining: a list item always sits in a list
    const currentList = target.parentElement?.tagName;

    const markerChanged =
        // Stryker disable next-line ConditionalExpression,LogicalOperator: both parents are always lists (UL or OL), so only the tag comparison decides
        isListTag(originalList) && isListTag(currentList) && originalList !== currentList;

    if (!markerChanged) return null;

    return currentList === "OL" ? "toNumbered" : "toBulleted";
}

interface ChecklistChange {
    /** The live checkbox that changed; null when the item lost its checkbox. */
    input: HTMLInputElement | null;
    /** The change as part of a combined list-item explanation. */
    label: string;
    /** The change explained on its own. */
    callout: string;
}

/** The live checkbox of a task item whose checked state flipped, or null. */
function checklistStateChange(
    original: HTMLElement,
    target: HTMLElement,
): (ChecklistChange & { input: HTMLInputElement }) | null {
    const originalTask = original.querySelector<HTMLInputElement>(':scope input[type="checkbox"]');

    const currentTask = target.querySelector<HTMLInputElement>(':scope input[type="checkbox"]');

    if (
        originalTask == null ||
        currentTask == null ||
        originalTask.checked === currentTask.checked
    ) {
        return null;
    }

    return {
        input: currentTask,
        ...(currentTask.checked
            ? {
                  label: t("document.checklist.checkedLabel"),
                  callout: t("document.checklist.checkedCallout"),
              }
            : {
                  label: t("document.checklist.uncheckedLabel"),
                  callout: t("document.checklist.uncheckedCallout"),
              }),
    };
}

/** The checkbox an item shows before its own text (not a nested item's), or null. */
function ownCheckbox(item: HTMLElement): HTMLInputElement | null {
    return inlineProseTarget(item).querySelector<HTMLInputElement>(
        ':scope > input[type="checkbox"]',
    );
}

/** The checkbox a list item gained or lost by becoming or ceasing to be a task item, or null. */
function checklistToggled(original: HTMLElement, target: HTMLElement): ChecklistChange | null {
    const originalTask = ownCheckbox(original);
    const currentTask = ownCheckbox(target);

    if (currentTask != null && originalTask == null) {
        return {
            input: currentTask,
            ...(currentTask.checked
                ? {
                      label: t("document.checklist.addedCheckedLabel"),
                      callout: t("document.checklist.addedCheckedCallout"),
                  }
                : {
                      label: t("document.checklist.addedUncheckedLabel"),
                      callout: t("document.checklist.addedUncheckedCallout"),
                  }),
        };
    }

    if (originalTask == null || currentTask != null) return null;

    return {
        input: null,
        ...(originalTask.checked
            ? {
                  label: t("document.checklist.removedCheckedLabel"),
                  callout: t("document.checklist.removedCheckedCallout"),
              }
            : {
                  label: t("document.checklist.removedUncheckedLabel"),
                  callout: t("document.checklist.removedUncheckedCallout"),
              }),
    };
}

/**
 * A task item renders a single space between its checkbox and its text. Align
 * the detached original of an item that gained or lost its checkbox with the
 * current item — add or drop that space — so the word diff doesn't show the
 * space as an added or removed word.
 */
export function alignChecklistSpace(original: HTMLElement, target: HTMLElement): void {
    const change = checklistToggled(original, target);
    if (change == null) return;

    if (change.input) {
        inlineProseTarget(original).prepend(" ");
    } else {
        (ownCheckbox(original)!.nextSibling as Text).deleteData(0, 1);
    }
}

export function applyBlockStructureDiff(
    original: HTMLElement,
    target: HTMLElement,
    text: string,
): boolean {
    if (original.tagName === target.tagName || text.length === 0) return false;

    const describeBlock = (tag: string): string => {
        // Stryker disable next-line Regex: it only sees block tag names (P, LI, BLOCKQUOTE, H1-H6), none of which contain H plus a digit except the headings themselves
        const heading = /^H([1-6])$/.exec(tag);
        if (heading) return t("document.block.heading", { level: heading[1]! });

        return t(
            (
                {
                    BLOCKQUOTE: "document.block.quote",
                    LI: "document.block.listItem",
                    P: "document.block.paragraph",
                } as const satisfies Record<string, MessageKey>
            )[tag as "BLOCKQUOTE" | "LI" | "P"],
        );
    };

    wrapFormattingRanges(inlineProseTarget(target), [
        {
            start: text.length - text.trimStart().length,
            end: text.trimEnd().length,
            label: t("document.block.changed", {
                before: describeBlock(original.tagName),
                after: describeBlock(target.tagName),
            }),
        },
    ]);

    return true;
}
