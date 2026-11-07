// Diff-decoration class names, block selectors, and the source-span helpers
// shared by every phase of the decoration pass.

/** Class applied to a block element that overlaps a changed range. */
export const DIFF_BLOCK_CLASS = "emr-diff-block";
/** Class on the inserted deletion marker. */
export const DIFF_DELETED_MARKER_CLASS = "emr-diff-deleted-marker";
/** Class added to a modified block when an inline word-diff was overlaid. */
export const DIFF_INLINE_CLASS = "emr-diff-block--inline";
/** Class added to a changed Mermaid diagram (left-bar only, no wash). */
export const DIFF_MERMAID_CLASS = "emr-diff-mermaid";
/** Class added to a changed equation (left-bar only, no wash). */
export const DIFF_MATH_CLASS = "emr-diff-math";
/** Class added to an image-only block (left-bar only, no wash). */
export const DIFF_IMAGE_CLASS = "emr-diff-image";
/** Class added to an individual changed table cell (td/th). */
export const DIFF_CELL_CLASS = "emr-diff-cell";
/** Class marking a changed cell whose change is shown as an inline word diff. */
export const DIFF_CELL_INLINE_CLASS = "emr-diff-cell--inline";
/** Class marking a structurally added table cell (for example a new column). */
export const DIFF_CELL_ADDED_CLASS = "emr-diff-cell--added";
/** Class on a temporary table cell inserted to show a removed cell in place. */
export const DIFF_CELL_REMOVED_CLASS = "emr-diff-cell--removed";
/** Class marking a cell whose non-text metadata change has its own indicator. */
export const DIFF_CELL_METADATA_CLASS = "emr-diff-cell--metadata";
/** Shared inline indicator for non-visible rendered-content metadata changes. */
export const DIFF_METADATA_CLASS = "emr-diff-metadata";
/** Class on text whose Markdown formatting changed without a text edit. */
export const DIFF_FORMAT_CLASS = "emr-diff-format-change";
/** Class on a localized amber change with an explanatory hover/focus tooltip. */
export const DIFF_TOOLTIP_CLASS = "emr-diff-explained-change";
export const DIFF_LINE_WASH_CLASS = "emr-diff-line-wash";
export const DIFF_SUPPRESSED_TITLE_CLASS = "emr-diff-suppressed-native-title";
export const DIFF_TOOLTIP_RIGHT_CLASS = "emr-diff-explained-change--right";
export const DIFF_LIST_MARKER_CLASS = "emr-diff-list-marker-change";
export const DIFF_TASK_STATE_CLASS = "emr-diff-task-state-change";
export const DIFF_TASK_TOOLTIP_CLASS = "emr-diff-task-tooltip-anchor";
export const DIFF_TABLE_COMPARISON_CLASS = "emr-diff-table-comparison";
export const DIFF_SOURCE_ONLY_CLASS = "emr-diff-source-only";
/** Class marking a frontmatter metadata row (a granular leaf like `li`/`tr`). */
export const FRONTMATTER_ROW_CLASS = "emr-frontmatter-row";

/**
 * Block-level tags we decorate. Note the ABSENCE of the container tags
 * `ul` / `ol` / `table`: instead of washing a whole list or table when a
 * single item changed, we decorate the granular `li` (list item) and `tr`
 * (table row) leaves so only the changed rows/items highlight.
 *
 * `.emr-frontmatter-row` is one key row of the metadata card. Each row carries
 * its own `data-source-line` span, so — exactly like `li` / `tr` — only the
 * edited/added key highlights rather than washing the whole card. (The card
 * container `.emr-frontmatter` is the analogue of `ul` / `table` and is
 * intentionally NOT selected.)
 */
export const BLOCK_SELECTOR =
    "p, pre, blockquote, dl, h1, h2, h3, h4, h5, h6, hr, img, li, tr, .emr-frontmatter-row, .emr-math";

/** An image by itself (optionally wrapped in a link/span) owns the whole block. */
export function isImageOnlyBlock(el: HTMLElement): boolean {
    if (el.tagName === "IMG") return true;

    return el.tagName === "P" && el.querySelector("img") !== null && el.textContent.trim() === "";
}

/** Selector for a rendered Mermaid diagram placeholder/host. */
export const MERMAID_SELECTOR = ".emr-mermaid";

/**
 * Tags whose rendered text is prose we can safely word-diff inline. Excludes
 * table rows (`tr` — the original row source is a pipe line that won't render
 * back to matching text), code (`pre` — char-precise, monospace), and void
 * blocks. `li` is included so a reworded list item shows word-level changes.
 */
export const PROSE_TAGS = new Set([
    "P",
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

/**
 * Block-level children that own their source lines inside a list item or
 * blockquote: a second paragraph, nested list, code block, table, quote,
 * definition list, heading, rule, or a rendered diagram/equation host.
 */
const CHILD_BLOCK_TAGS = new Set([
    "P",
    "UL",
    "OL",
    "PRE",
    "TABLE",
    "BLOCKQUOTE",
    "DL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "DIV",
]);

/** A child block of a container (a source-mapped `div` only, never chrome). */
export function isChildBlock(el: Element): boolean {
    return (
        CHILD_BLOCK_TAGS.has(el.tagName) &&
        (el.tagName !== "DIV" || el.hasAttribute("data-source-line"))
    );
}

/** A 1-based, inclusive span of source lines. */
export interface SourceSpan {
    start: number;
    end: number;
}

export interface ChangeRange {
    start: number;
    end: number;
    kind: "added" | "modified";
    /** Original source text of the changed lines (modified ranges only). */
    originalText?: string;
    originalStart?: number;
    originalEnd?: number;
}

export function numAttr(el: Element, name: string): number | null {
    const raw = el.getAttribute(name);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);

    return Number.isFinite(n) ? n : null;
}

/** True when [aStart,aEnd] and [bStart,bEnd] share at least one line. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart <= bEnd && bStart <= aEnd;
}

/** A block's stamped `[start, end]` source span, or null when unstamped. */
export function readSourceSpan(el: Element): SourceSpan | null {
    const start = numAttr(el, "data-source-line");
    const end = numAttr(el, "data-source-end-line");

    return start == null || end == null ? null : { start, end };
}

/**
 * The element to run the inline word-diff against. A LOOSE list item (one whose
 * list has blank lines or nested blocks) wraps its prose in a `<p>`, with
 * whitespace text nodes sitting BETWEEN the `<li>` and that `<p>`. Diffing the
 * whole `<li>` would fold those inter-block newlines into the word diff and wrap
 * them in stray `<ins>`/`<del>` marks that render as blank lines above and below
 * the item. Targeting the inner prose `<p>` keeps the diff to the item's actual
 * text. Tight items (direct text, no `<p>`) and non-list prose blocks are
 * returned unchanged.
 */
export function inlineProseTarget(block: HTMLElement): HTMLElement {
    if (block.tagName === "BLOCKQUOTE") {
        const body = Array.from(block.children).find(
            (child) => child.tagName === "P" && !child.classList.contains("markdown-alert-title"),
        );

        if (body) return body as HTMLElement;
    }

    if (block.tagName === "LI") {
        const prose = Array.from(block.children).find((child) => child.tagName === "P");

        if (prose) return prose as HTMLElement;
    }

    return block;
}
