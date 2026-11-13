// Inline formatting-change detection (bold/italic/code/link wrappers and
// whitespace swaps) and the text-node wrapping that explains them.

import { getFormatLocale, type MessageKey, t } from "../../i18n";
import { type WordDiffOp, LINE_WHITESPACE } from "../wordDiff";
import { applyDiffTooltip, suppressNativeTitle } from "./tooltip";
import { DIFF_FORMAT_CLASS } from "./shared";

interface FormattingRange {
    tag: string;
    start: number;
    end: number;
    detail?: string;
}

interface ExplainedTextRange {
    start: number;
    end: number;
    label: string;
}

const INLINE_FORMAT_TAGS = new Set(["STRONG", "EM", "CODE", "DEL", "A"]);

// Links are described by their target instead (see formatDescription).
const FORMAT_NAME_KEY_BY_TAG = {
    CODE: "document.format.inlineCode",
    DEL: "document.format.strikethrough",
    EM: "document.format.italic",
    STRONG: "document.format.bold",
} as const satisfies Record<string, MessageKey>;

export function formattingRanges(root: Element): FormattingRange[] {
    // Stryker disable next-line ArrayDeclaration: both sides being compared start with the same placeholder entry, so it is never a difference
    const ranges: FormattingRange[] = [];
    let offset = 0;

    const visit = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            offset += (node as Text).data.length;

            return;
        }

        // Stryker disable next-line ConditionalExpression: a comment node has no children and no formatting tag, so visiting it records nothing either way
        if (!(node instanceof Element)) return;
        const start = offset;
        for (const child of Array.from(node.childNodes)) visit(child);

        if (INLINE_FORMAT_TAGS.has(node.tagName) && offset > start) {
            ranges.push({
                tag: node.tagName,
                start,
                end: offset,
                // Stryker disable next-line ConditionalExpression: the detail is only read for links, and other tags have no href to record
                detail: node.tagName === "A" ? node.getAttribute("href")! : undefined,
            });
        }
    };

    for (const child of Array.from(root.childNodes)) visit(child);

    return ranges;
}

function formattingRangeKey(range: FormattingRange): string {
    return `${range.tag}:${range.start}:${range.end}`;
}

function formattingName(tag: string): string {
    return t(FORMAT_NAME_KEY_BY_TAG[tag as keyof typeof FORMAT_NAME_KEY_BY_TAG]);
}

/** Upper-case the first letter of a whole translated sentence. */
function capitalizeSentence(sentence: string): string {
    return `${sentence.charAt(0).toLocaleUpperCase(getFormatLocale())}${sentence.slice(1)}`;
}

function compactTooltipValue(value: string, limit = 96): string {
    // Stryker disable next-line MethodExpression,Regex,StringLiteral: it only compacts rendered link hrefs, which the renderer percent-encodes, so they hold no whitespace
    const compact = value.replace(/\s+/g, " ").trim();

    return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function formatDescription(ranges: readonly FormattingRange[]): string {
    const link = ranges.find((range) => range.tag === "A");

    const parts = Array.from(
        new Set(
            ranges.filter((range) => range.tag !== "A").map((range) => formattingName(range.tag)),
        ),
    );

    if (link) {
        parts.push(t("document.format.linkTo", { target: compactTooltipValue(link.detail!) }));
    }

    return joinList(parts);
}

/** "a", "a and b", "a, b and c" in the UI language. */
export function joinList(parts: readonly string[]): string {
    if (parts.length < 2) return parts[0]!;

    const head = parts
        .slice(1, -1)
        .reduce((list, item) => t("document.format.listItem", { list, item }), parts[0]!);

    return t("document.format.listLastItem", { list: head, item: parts[parts.length - 1]! });
}

function describeFormattingChange(
    beforeRanges: readonly FormattingRange[],
    afterRanges: readonly FormattingRange[],
): string {
    const before = formatDescription(beforeRanges);
    const after = formatDescription(afterRanges);
    const beforeLink = beforeRanges.find((range) => range.tag === "A");
    const afterLink = afterRanges.find((range) => range.tag === "A");

    if (beforeRanges.length === 0) {
        return afterLink && afterRanges.length === 1
            ? t("document.format.linkAdded", { target: compactTooltipValue(afterLink.detail!) })
            : capitalizeSentence(t("document.format.added", { formats: after }));
    }

    if (afterRanges.length === 0) {
        return beforeLink && beforeRanges.length === 1
            ? t("document.format.linkRemoved", {
                  target: compactTooltipValue(beforeLink.detail!),
              })
            : capitalizeSentence(t("document.format.removed", { formats: before }));
    }

    if (before === after) {
        return capitalizeSentence(t("document.format.moved", { formats: before }));
    }

    return t("document.format.changed", { before, after });
}

function formattingChangeRanges(
    originalRanges: readonly FormattingRange[],
    currentRanges: readonly FormattingRange[],
): ExplainedTextRange[] {
    const originalKeys = new Set(originalRanges.map(formattingRangeKey));
    const currentKeys = new Set(currentRanges.map(formattingRangeKey));

    const removed = originalRanges.filter((range) => !currentKeys.has(formattingRangeKey(range)));

    const added = currentRanges.filter((range) => !originalKeys.has(formattingRangeKey(range)));

    const sorted = [...removed, ...added]
        .map(({ start, end }) => ({ start, end }))
        .sort((a, b) => a.start - b.start || a.end - b.end);

    const merged: Array<{ start: number; end: number }> = [];

    for (const range of sorted) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: indexing an empty list already yields undefined
        const previous = merged.length > 0 ? merged[merged.length - 1] : undefined;

        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end);
        } else {
            merged.push(range);
        }
    }

    return merged.map(({ start, end }) => ({
        start,
        end,
        label: describeFormattingChange(
            removed.filter((range) => range.start < end && start < range.end),
            added.filter((range) => range.start < end && start < range.end),
        ),
    }));
}

interface TextNodeSpan {
    node: Text;
    start: number;
    end: number;
}

/** Every text node under `root` with its offset span in the root's text. */
function collectTextNodeSpans(root: HTMLElement): TextNodeSpan[] {
    // Stryker disable next-line ArrayDeclaration: a placeholder entry without offsets overlaps no range, so it is skipped
    const nodes: TextNodeSpan[] = [];
    let offset = 0;

    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let node = walker.nextNode();

    while (node) {
        const text = node as Text;
        nodes.push({
            node: text,
            start: offset,
            end: offset + text.data.length,
        });
        offset += text.data.length;
        node = walker.nextNode();
    }

    return nodes;
}

/** Replace one text node with its text, wrapping each overlapping range. */
function wrapTextNodeRanges(
    doc: Document,
    entry: TextNodeSpan,
    overlaps: readonly ExplainedTextRange[],
): void {
    const fragment = doc.createDocumentFragment();
    let cursor = 0;

    for (const range of overlaps) {
        const start = Math.max(range.start, entry.start) - entry.start;
        const end = Math.min(range.end, entry.end) - entry.start;

        // Stryker disable next-line ConditionalExpression,EqualityOperator: at the cursor there is no text before the mark, and appending an empty string adds nothing
        if (start > cursor) {
            fragment.append(entry.node.data.slice(cursor, start));
        }

        const mark = doc.createElement("span");
        mark.className = DIFF_FORMAT_CLASS;
        applyDiffTooltip(mark, range.label);
        mark.append(entry.node.data.slice(start, end));
        fragment.append(mark);
        cursor = end;
    }

    // Stryker disable next-line ConditionalExpression,EqualityOperator: at the end of the text there is nothing left, and appending an empty string adds nothing
    if (cursor < entry.node.data.length) {
        fragment.append(entry.node.data.slice(cursor));
    }

    entry.node.replaceWith(fragment);
}

export function wrapFormattingRanges(
    root: HTMLElement,
    ranges: readonly ExplainedTextRange[],
): void {
    const titledAncestors = new Set<HTMLElement>();

    for (const entry of collectTextNodeSpans(root)) {
        const overlaps = ranges.filter(
            (range) => range.start < entry.end && entry.start < range.end,
        );

        // Stryker disable next-line ConditionalExpression: rewrapping a text node no range overlaps rebuilds the same text, and its parent's marks were already collected
        if (overlaps.length === 0) continue;
        const parent = entry.node.parentElement;
        wrapTextNodeRanges(root.ownerDocument, entry, overlaps);

        for (const mark of Array.from(
            parent!.querySelectorAll<HTMLElement>(`.${DIFF_FORMAT_CLASS}`),
        )) {
            const titledAncestor = mark.closest<HTMLElement>("[title]");
            if (titledAncestor) titledAncestors.add(titledAncestor);
        }
    }

    for (const titledAncestor of titledAncestors) {
        suppressNativeTitle(titledAncestor);
    }
}

/**
 * Mark formatting that differs from `originalRanges`. Callers pass ranges
 * read from an original whose rendered text equals `target`'s, so the
 * offsets on both sides index the same text.
 */
export function applyFormattingDiff(
    target: HTMLElement,
    originalRanges: readonly FormattingRange[],
): boolean {
    const currentRanges = formattingRanges(target);
    const changed = formattingChangeRanges(originalRanges, currentRanges);
    if (changed.length === 0) return false;
    wrapFormattingRanges(target, changed);

    return true;
}

/** "4 spaces", "1 tab", "2 spaces and 1 tab". */
function describeWhitespace(run: string): string {
    const tabCount = run.split("\t").length - 1;
    const spaceCount = run.length - tabCount;
    const spaces = t("document.whitespace.spaces", { count: spaceCount });
    const tabs = t("document.whitespace.tabs", { count: tabCount });

    if (tabCount === 0) return spaces;
    if (spaceCount === 0) return tabs;

    return t("document.whitespace.spacesAndTabs", { spaces, tabs });
}

/**
 * Turn each remaining in-line whitespace swap (removed run then added run)
 * into unchanged text plus an explained range over the new run, in
 * modified-text offsets.
 */
export function explainWhitespaceSwaps(ops: readonly WordDiffOp[]): {
    operations: WordDiffOp[];
    ranges: ExplainedTextRange[];
} {
    const operations: WordDiffOp[] = [];
    // Stryker disable next-line ArrayDeclaration: a placeholder range without offsets wraps no text, and a code block that reaches here always has word marks, so it is handled either way
    const ranges: ExplainedTextRange[] = [];
    let modified = "";

    const push = (kind: WordDiffOp["kind"], value: string): void => {
        // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: only unchanged runs can end up next to each other here, and two adjacent unchanged runs render the same as one
        const last = operations.length > 0 ? operations[operations.length - 1] : undefined;

        // Stryker disable next-line ConditionalExpression: only unchanged runs can end up next to each other here, and two adjacent unchanged runs render the same as one
        if (last?.kind === kind) last.value += value;
        else operations.push({ kind, value });
        if (kind !== "removed") modified += value;
    };

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: reading past the last op already yields undefined
        const next = i + 1 < ops.length ? ops[i + 1] : undefined;

        if (
            op.kind === "removed" &&
            next?.kind === "added" &&
            LINE_WHITESPACE.test(op.value) &&
            LINE_WHITESPACE.test(next.value)
        ) {
            const lineStart = modified === "" || modified.endsWith("\n");
            ranges.push({
                start: modified.length,
                end: modified.length + next.value.length,
                label: t(
                    lineStart
                        ? "document.whitespace.indentationChanged"
                        : "document.whitespace.whitespaceChanged",
                    { before: describeWhitespace(op.value), after: describeWhitespace(next.value) },
                ),
            });
            push("equal", next.value);
            i++;
            continue;
        }

        push(op.kind, op.value);
    }

    return { operations, ranges };
}
