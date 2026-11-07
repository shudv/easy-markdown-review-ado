// The mutable decoration pass plus the block-level marking primitives: change
// classification, span ownership, line washes, and contiguous grouping.

import type { DiffRange } from "../../types";
import { type InteriorEdit, reconstructEditedBlock, reconstructOriginalBlock } from "./reconstruct";
import {
    type ChangeRange,
    DIFF_BLOCK_CLASS,
    DIFF_IMAGE_CLASS,
    DIFF_INLINE_CLASS,
    DIFF_LINE_WASH_CLASS,
    DIFF_MATH_CLASS,
    FRONTMATTER_ROW_CLASS,
    inlineProseTarget,
    isChildBlock,
    isImageOnlyBlock,
    numAttr,
    overlaps,
} from "./shared";

/** Tags decorated at the row/item level (inside a list or table container). */
const GRANULAR_TAGS = new Set(["LI", "TR"]);

/**
 * A granular leaf (list item / table row / frontmatter row) owns no group card
 * — it tints in place rather than joining a contiguous run.
 */
function isGranularLeaf(el: Element): boolean {
    return GRANULAR_TAGS.has(el.tagName) || el.classList.contains(FRONTMATTER_ROW_CLASS);
}

/** Prose blocks whose fallback wash can follow rendered line boxes. */
const LINE_WASH_TAGS = new Set([
    "P",
    "PRE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "BLOCKQUOTE",
    "DD",
    "DT",
]);

/** Options controlling the richer inline word-diff overlay. */
export interface DiffDecorationOptions {
    /**
     * Render a Markdown source fragment to HTML (typically `renderMarkdownSync`).
     * Supplied by the view layer so this pure module stays free of the heavy
     * unified pipeline. When provided, modified prose blocks that carry an
     * `originalText` get an inline word-level diff instead of a flat wash.
     */
    renderInline?: (md: string) => string;
    /** Complete Markdown source at the base commit for old-block reconstruction. */
    originalSource?: string;
    /** Complete Markdown source at the current commit for source-only fallbacks. */
    currentSource?: string;
}

/** Human-readable corner tag shown on a changed block. */
const KIND_LABEL: Record<"added" | "modified", string> = {
    added: "Added",
    modified: "Edited",
};

/**
 * The last source line a block "owns" for change-classification. Ownership is
 * the contract that keeps every changed line visible exactly once: a list item
 * or blockquote owns only its LEAD content — the lines before its first child
 * block — and every child block (a second paragraph, nested list, code block,
 * table, quote, diagram) owns and decorates its own lines. Returns a value
 * below `start` when the container opens with a child block and so owns no
 * lines itself. Everything else owns its whole span.
 */
export function ownSpanEnd(
    el: HTMLElement,
    start: number,
    end: number,
    currentLines?: readonly string[],
): number {
    if (el.tagName !== "LI" && el.tagName !== "BLOCKQUOTE") return end;
    const lead = inlineProseTarget(el);
    let ownEnd = end;

    for (const child of Array.from(el.children)) {
        if (!isChildBlock(child)) continue;
        const childStart = numAttr(child, "data-source-line");
        if (childStart == null) continue;
        if (child === lead && childStart === start) continue;
        ownEnd = childStart - 1;
        break;
    }

    // Blank separator lines (bare `>` in a quote) before a child block carry no
    // lead content: adding a second paragraph adds one, and must not paint the
    // unchanged lead as added.
    while (
        ownEnd > start &&
        currentLines?.[ownEnd - 1] != null &&
        /^[\s>]*$/.test(currentLines[ownEnd - 1]!)
    ) {
        ownEnd--;
    }

    return ownEnd;
}

/**
 * True when a decorated ancestor's PAINT already covers `el`. Paint is
 * explicit, not assumed: a line wash covers only the ancestor's lead prose, an
 * inline word diff covers only its prose target (the whole item when it's a
 * tight item), and a plain box wash covers everything inside it — except a
 * nested list item, which decorates itself. Anything outside an ancestor's
 * paint must decorate itself, or its change would silently disappear.
 */
export function coveredByDecoratedAncestor(el: HTMLElement): boolean {
    for (
        let ancestor = el.parentElement!.closest<HTMLElement>(`.${DIFF_BLOCK_CLASS}`);
        ancestor;
        ancestor = ancestor.parentElement?.closest<HTMLElement>(`.${DIFF_BLOCK_CLASS}`) ?? null
    ) {
        if (ancestorPaintCovers(ancestor, el)) return true;
    }

    return false;
}

function ancestorPaintCovers(ancestor: HTMLElement, el: HTMLElement): boolean {
    const target = inlineProseTarget(ancestor);

    if (ancestor.dataset.diffInline === "true") {
        return target === ancestor || target.contains(el);
    }

    if (ancestor.dataset.diffLineWash === "true") {
        return target === ancestor
            ? el.closest(`.${DIFF_LINE_WASH_CLASS}`) !== null
            : target.contains(el);
    }

    return el.tagName !== "LI" || ancestor.tagName !== "LI";
}

/**
 * Classify a block spanning [start,end]: 'modified' wins over 'added'; null
 * when it doesn't intersect any change.
 */
export function classifyBlock(
    start: number,
    end: number,
    ranges: readonly ChangeRange[],
): "added" | "modified" | null {
    let sawAdded = false;

    for (const r of ranges) {
        if (!overlaps(start, end, r.start, r.end)) continue;
        if (r.kind === "modified") return "modified";
        sawAdded = true;
    }

    return sawAdded ? "added" : null;
}

/**
 * Wrap a prose block's own inline content so its wash follows each rendered
 * line box. CSS `box-decoration-break: clone` gives every visual line a
 * separate rounded fragment whose right edge stops with that line's text.
 * Structural descendants (for example a nested list) remain outside.
 */
export function applyLineWash(block: HTMLElement): boolean {
    if (!LINE_WASH_TAGS.has(block.tagName)) return false;

    const target =
        block.tagName === "PRE"
            ? block.querySelector<HTMLElement>("code")
            : inlineProseTarget(block);

    if (!target) return false;

    const nodes: ChildNode[] = [];

    for (const child of Array.from(target.childNodes)) {
        if (
            child instanceof HTMLElement &&
            (child.classList.contains("emr-diff-before-control") ||
                child.classList.contains("emr-diff-before-panel") ||
                child.classList.contains("emr-section-toggle") ||
                child.classList.contains("emr-heading-link"))
        ) {
            continue;
        }

        if (child instanceof HTMLElement && isChildBlock(child)) break;
        nodes.push(child);
    }

    // Media in the lead can't follow line boxes (child blocks paint themselves).
    const media = "img, .emr-mermaid, .katex";

    if (
        nodes.some(
            (node) =>
                node instanceof Element &&
                (node.matches(media) || node.querySelector(media) !== null),
        )
    ) {
        return false;
    }

    if (nodes.length === 0 || nodes.every((node) => (node.textContent ?? "").trim().length === 0)) {
        return false;
    }

    const wrapper = target.ownerDocument.createElement("span");
    wrapper.className = DIFF_LINE_WASH_CLASS;
    target.insertBefore(wrapper, nodes[0]!);
    wrapper.append(...nodes);
    block.dataset.diffLineWash = "true";

    return true;
}

/** Mutable state shared by the phases of {@link decorateDiffRanges}. */
export interface DecorationPass {
    root: HTMLElement;
    renderInline: ((md: string) => string) | undefined;
    originalSource: string | undefined;
    changeRanges: ChangeRange[];
    deletedRanges: DiffRange[];
    originalLines: string[] | undefined;
    currentLines: string[] | undefined;
    /** Deletions shown inside the block they were removed from, not as markers. */
    absorbedDeletions: Set<DiffRange>;
    /** The original document, rendered only if a list item needs its old depth. */
    originalDocument: HTMLElement | null;
    decoratedEls: HTMLElement[];
    decorated: number;
    inlined: number;
}

/** A changed block and the source span it was classified over. */
export interface ChangedBlock {
    el: HTMLElement;
    kind: "added" | "modified";
    start: number;
    end: number;
    ownEnd: number;
    interiorEdit: InteriorEdit | null;
}

export function createDecorationPass(
    root: HTMLElement,
    ranges: readonly DiffRange[],
    options: DiffDecorationOptions | undefined,
): DecorationPass {
    const changeRanges: ChangeRange[] = [];
    const deletedRanges: DiffRange[] = [];

    for (const r of ranges) {
        if (r.kind === "deleted-marker") deletedRanges.push(r);
        else {
            changeRanges.push({
                start: r.startLine,
                end: r.endLine,
                kind: r.kind,
                originalText: r.originalText,
                originalStart: r.originalStartLine,
                originalEnd: r.originalEndLine,
            });
        }
    }

    return {
        root,
        renderInline: options?.renderInline,
        originalSource: options?.originalSource,
        changeRanges,
        deletedRanges,
        originalLines: options?.originalSource?.split(/\r\n|\r|\n/),
        currentLines: options?.currentSource?.split(/\r\n|\r|\n/),
        absorbedDeletions: new Set<DiffRange>(),
        originalDocument: null,
        decoratedEls: [],
        decorated: 0,
        inlined: 0,
    };
}

/**
 * A line added to, or removed from the middle of, a block that already
 * existed edits that block: the block isn't new, and the removal belongs
 * inside it rather than in a marker after it.
 */
export function findInteriorEdit(
    pass: DecorationPass,
    el: HTMLElement,
    start: number,
    end: number,
): InteriorEdit | null {
    if (!pass.renderInline || !pass.currentLines) return null;

    const interiorEdit = reconstructEditedBlock(
        el,
        { start, end },
        {
            changeRanges: pass.changeRanges,
            deletedRanges: pass.deletedRanges,
            currentLines: pass.currentLines,
            renderInline: pass.renderInline,
        },
    );

    for (const deletion of interiorEdit?.deletions ?? []) {
        pass.absorbedDeletions.add(deletion);
    }

    return interiorEdit;
}

/** The block's pre-edit Markdown, rebuilt from the original document. */
export function reconstructBlockOriginal(
    pass: DecorationPass,
    interiorEdit: InteriorEdit | null,
    start: number,
    end: number,
): string | null {
    return (
        interiorEdit?.original ??
        reconstructOriginalBlock(
            { start, end },
            pass.changeRanges,
            pass.originalSource,
            pass.originalLines,
        )
    );
}

export function markChangedBlock(
    pass: DecorationPass,
    el: HTMLElement,
    kind: "added" | "modified",
): void {
    el.classList.add(
        DIFF_BLOCK_CLASS,
        kind === "added" ? "emr-diff-block--added" : "emr-diff-block--modified",
    );
    el.dataset.diffKind = kind;
    el.dataset.diffLabel = KIND_LABEL[kind];
    if (isImageOnlyBlock(el)) el.classList.add(DIFF_IMAGE_CLASS);
    if (el.classList.contains("emr-math")) el.classList.add(DIFF_MATH_CLASS);
    pass.decorated++;
    pass.decoratedEls.push(el);
}

/** Undo {@link markChangedBlock} for a modified block that reads the same. */
export function unmarkChangedBlock(
    pass: DecorationPass,
    el: HTMLElement,
    ...extraClasses: string[]
): void {
    el.classList.remove(DIFF_BLOCK_CLASS, "emr-diff-block--modified", ...extraClasses);
    delete el.dataset.diffKind;
    delete el.dataset.diffLabel;
    pass.decorated--;
    pass.decoratedEls.pop();
}

export function markInlined(pass: DecorationPass, el: HTMLElement): void {
    el.dataset.diffInline = "true";
    pass.inlined++;
}

/**
 * Tag each decorated block with its position in a run of contiguous
 * same-kind sibling blocks via `data-diff-group` = start|mid|end|single.
 * The CSS uses this to render a run as ONE continuous card, squaring the inner
 * corners and collapsing the inter-block gap. Inline (word-diffed) blocks and
 * granular list-item / table-row leaves have no card, so they never
 * participate in a group.
 */
export function markContiguousGroups(els: readonly HTMLElement[]): void {
    const groupable = (el: Element | null, kind: string | undefined): boolean =>
        el instanceof HTMLElement &&
        el.classList.contains(DIFF_BLOCK_CLASS) &&
        !el.classList.contains(DIFF_INLINE_CLASS) &&
        !el.classList.contains(DIFF_MATH_CLASS) &&
        el.dataset.diffLineWash !== "true" &&
        !isGranularLeaf(el) &&
        el.dataset.diffKind === kind;

    for (const el of els) {
        if (
            el.classList.contains(DIFF_INLINE_CLASS) ||
            el.classList.contains(DIFF_MATH_CLASS) ||
            el.dataset.diffLineWash === "true" ||
            isGranularLeaf(el)
        ) {
            delete el.dataset.diffGroup;
            continue;
        }

        const kind = el.dataset.diffKind;
        const samePrev = groupable(el.previousElementSibling, kind);
        const sameNext = groupable(el.nextElementSibling, kind);
        el.dataset.diffGroup =
            samePrev && sameNext ? "mid" : samePrev ? "end" : sameNext ? "start" : "single";
    }
}
