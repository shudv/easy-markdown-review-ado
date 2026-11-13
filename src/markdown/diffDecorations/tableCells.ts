// Per-cell decoration of a modified table row against its original source.

import { type MessageKey, t } from "../../i18n";
import { diffWords } from "../wordDiff";
import { WORD_REMOVED_CLASS, applyInlineWordDiff } from "../wordDiffDom";
import {
    alignTableCells,
    alignTableColumns,
    splitTableRow,
    type TableCellAlignment,
} from "./tableAlignment";
import { applyDiffTooltip } from "./tooltip";
import { joinList } from "./formatting";
import { diffInlineContent } from "./inlineDiff";
import {
    type ChangeRange,
    DIFF_CELL_ADDED_CLASS,
    DIFF_CELL_CLASS,
    DIFF_CELL_INLINE_CLASS,
    DIFF_CELL_METADATA_CLASS,
    DIFF_CELL_REMOVED_CLASS,
    DIFF_METADATA_CLASS,
    numAttr,
} from "./shared";

export function resolveTableColumnAlignment(
    row: HTMLElement,
    range: ChangeRange,
    renderInline: (md: string) => string,
): TableCellAlignment[] | null | undefined {
    const headerRow = row.closest("table")!.querySelector<HTMLElement>("thead tr")!;

    const headerLine = numAttr(headerRow, "data-source-line");

    // Stryker disable next-line ConditionalExpression,EqualityOperator: a missing header line compares as 0, which is before every range, and a body row's range always ends after the header line
    if (headerLine == null || headerLine < range.start || headerLine > range.end) {
        return undefined;
    }

    const originalHeader = range.originalText!.split(/\r\n|\r|\n/)[headerLine - range.start]!;

    const originalHeaders = renderTableSourceTexts(originalHeader, renderInline);

    const currentHeaders = Array.from(headerRow.querySelectorAll<HTMLElement>("th, td"))
        .filter((cell) => !cell.classList.contains(DIFF_CELL_REMOVED_CLASS))
        .map(readCurrentTableCellText);

    return alignTableColumns(originalHeaders, currentHeaders);
}

function readCurrentTableCellText(cell: HTMLElement): string {
    const clone = cell.cloneNode(true) as HTMLElement;
    clone
        .querySelectorAll(`.${WORD_REMOVED_CLASS}, .${DIFF_METADATA_CLASS}`)
        .forEach((element) => element.remove());

    return clone.textContent.trim();
}

function renderTableSourceTexts(row: string, renderInline: (md: string) => string): string[] {
    const scratch = document.createElement("div");

    return splitTableRow(row).map((source) => {
        // eslint-disable-next-line no-unsanitized/property -- renderInline is renderMarkdownSync, whose output is sanitized by rehypeSafeHtml + rehypeSanitizeUrls
        scratch.innerHTML = renderInline(source);
        const content = scratch.querySelector("p") ?? scratch;

        return content.textContent.trim();
    });
}

/**
 * Highlight only the CHANGED cells of an edited table row by comparing the
 * rendered original row against the live one. `originalRow` is the row's
 * Markdown source (`| a | b |`); each original cell is rendered to plain text
 * (so `` `code` ``/formatting never reads as a spurious change) and compared
 * with the matching live `<td>`/`<th>`. Marks each differing cell and returns
 * true when at least one cell was marked (so the caller can suppress the
 * whole-row tint). Unequal rows align around unchanged cells; a row with no
 * trustworthy anchor falls back to the whole-row tint.
 */
export function diffTableRowCells(
    tr: HTMLElement,
    originalRow: string,
    renderInline: (md: string) => string,
    columnAlignment?: TableCellAlignment[] | null,
): "precise" | "unchanged" | "ambiguous" {
    // Stryker disable next-line MethodExpression: a rendered table row only holds td/th cells
    const cells = Array.from(tr.children).filter(
        // Stryker disable next-line ConditionalExpression: a rendered table row only holds td/th cells
        (c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH",
    );

    const doc = tr.ownerDocument;
    const originals = renderOriginalTableCells(doc, originalRow, renderInline);
    const originalCells = originals.texts;
    const currentCells = cells.map((cell) => cell.textContent.trim());

    const rawAlignment =
        columnAlignment === undefined
            ? alignTableCells(originalCells, currentCells)
            : columnAlignment;

    // Stryker disable next-line StringLiteral: the caller treats every result other than precise and unchanged as ambiguous
    if (!rawAlignment) return "ambiguous";

    if (alignmentOutOfRange(rawAlignment, originalCells.length, currentCells.length)) {
        // Stryker disable next-line StringLiteral: the caller treats every result other than precise and unchanged as ambiguous
        return "ambiguous";
    }

    const alignment = rawAlignment.map((item): TableCellAlignment => {
        if (item.kind === "added" || item.kind === "removed") return item;

        return {
            ...item,
            kind:
                originalCells[item.originalIndex] === currentCells[item.currentIndex]
                    ? "equal"
                    : // Stryker disable next-line StringLiteral: any kind other than equal, added or removed takes the modified-cell branch
                      "modified",
        };
    });

    const row: TableRowCells = { tr, doc, cells, originals };
    let marked = 0;

    for (const item of alignment) {
        if (markAlignedCell(row, item)) marked++;
    }

    if (marked > 0 || columnAlignment !== undefined) return "precise";

    return "unchanged";
}

/** An original row's cells rendered once for comparison. */
interface RenderedTableCells {
    /** Rendered plain text of each cell. */
    texts: string[];
    /** {@link tableCellStructureSignature} of each cell. */
    signatures: string[];
    /** Detached rendered content of each cell. */
    rendered: HTMLElement[];
}

/** A live table row being diffed against its rendered original cells. */
interface TableRowCells {
    tr: HTMLElement;
    doc: Document;
    cells: HTMLElement[];
    originals: RenderedTableCells;
}

function renderOriginalTableCells(
    doc: Document,
    originalRow: string,
    renderInline: (md: string) => string,
): RenderedTableCells {
    const scratch = doc.createElement("div");
    const signatures: string[] = [];
    const rendered: HTMLElement[] = [];

    const texts = splitTableRow(originalRow).map((source) => {
        // eslint-disable-next-line no-unsanitized/property -- renderInline is renderMarkdownSync, whose output is sanitized by rehypeSafeHtml + rehypeSanitizeUrls
        scratch.innerHTML = renderInline(source);
        const content = scratch.querySelector("p") ?? scratch;
        signatures.push(tableCellStructureSignature(content));
        rendered.push(content.cloneNode(true) as HTMLElement);

        return content.textContent.trim();
    });

    return { texts, signatures, rendered };
}

function alignmentOutOfRange(
    alignment: readonly TableCellAlignment[],
    originalLength: number,
    currentLength: number,
): boolean {
    return alignment.some((item) => {
        if (item.kind === "added") {
            return item.currentIndex >= currentLength;
        }

        if (item.kind === "removed") {
            return item.originalIndex >= originalLength || item.currentIndex > currentLength;
        }

        return item.originalIndex >= originalLength || item.currentIndex >= currentLength;
    });
}

/** Mark one aligned cell; true when the cell shows a change. */
function markAlignedCell(row: TableRowCells, item: TableCellAlignment): boolean {
    if (item.kind === "equal") return markEqualCell(row, item);

    if (item.kind === "removed") {
        insertRemovedCell(row, item);

        return true;
    }

    const cell = row.cells[item.currentIndex]!;

    if (item.kind === "added") {
        cell.classList.add(DIFF_CELL_CLASS, DIFF_CELL_ADDED_CLASS);

        return true;
    }

    const contentDiff = diffInlineContent(row.originals.rendered[item.originalIndex]!, cell);

    cell.classList.add(DIFF_CELL_CLASS);
    cell.classList.add(DIFF_CELL_INLINE_CLASS);

    if (contentDiff.metadataChanged) {
        cell.classList.add(DIFF_CELL_METADATA_CLASS);
    }

    return true;
}

/** A cell with equal text may still differ in formatting or structure. */
function markEqualCell(
    row: TableRowCells,
    item: { originalIndex: number; currentIndex: number },
): boolean {
    const cell = row.cells[item.currentIndex]!;
    const originalCell = row.originals.rendered[item.originalIndex]!;
    const contentDiff = diffInlineContent(originalCell, cell);

    if (contentDiff.handled) {
        cell.classList.add(DIFF_CELL_CLASS);

        if (contentDiff.formattingChanged) {
            cell.classList.add(DIFF_CELL_INLINE_CLASS);
        }

        if (contentDiff.metadataChanged) {
            cell.classList.add(DIFF_CELL_METADATA_CLASS);
        }

        return true;
    }

    if (row.originals.signatures[item.originalIndex] !== tableCellStructureSignature(cell)) {
        cell.classList.add(DIFF_CELL_CLASS);
        applyDiffTooltip(cell, describeStructureChange(originalCell, cell));

        return true;
    }

    return false;
}

/** Show a removed cell in place as a struck-through temporary cell. */
function insertRemovedCell(
    row: TableRowCells,
    item: { originalIndex: number; currentIndex: number },
): void {
    const removedCell = row.doc.createElement(row.cells[0]?.tagName ?? "td");
    removedCell.classList.add(DIFF_CELL_CLASS, DIFF_CELL_INLINE_CLASS, DIFF_CELL_REMOVED_CLASS);
    applyInlineWordDiff(removedCell, diffWords(row.originals.texts[item.originalIndex]!, ""));
    row.tr.insertBefore(removedCell, row.cells[item.currentIndex] ?? null);
}

/**
 * Text-independent shape of rich cell content. Keeps element names and the
 * attributes that change meaning/navigation, while ignoring renderer-only
 * source-position metadata and the words handled by the word diff itself.
 */
function tableCellStructureSignature(root: Element): string {
    // Stryker disable next-line ArrayDeclaration: both signatures being compared get the same leading entry
    const parts: string[] = [];

    const visit = (element: Element): void => {
        const semanticAttributes = ["href", "src", "title"]
            .map((name) => [name, element.getAttribute(name)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] != null)
            .map(([name, value]) => `${name}=${value}`)
            // Stryker disable next-line StringLiteral: both signatures being compared join their attributes the same way
            .join(",");

        // Stryker disable next-line MethodExpression: both signatures being compared spell tag names the same way
        parts.push(`<${element.tagName.toLowerCase()}${semanticAttributes}>`);
        for (const child of Array.from(element.children)) visit(child);
        // Stryker disable next-line MethodExpression: both signatures being compared spell tag names the same way
        parts.push(`</${element.tagName.toLowerCase()}>`);
    };

    for (const child of Array.from(root.children)) visit(child);

    // Stryker disable next-line StringLiteral: both signatures being compared join their parts the same way
    return parts.join("");
}

const STRUCTURE_NAME_KEY_BY_TAG = {
    A: "document.structure.link",
    CODE: "document.format.inlineCode",
    DEL: "document.format.strikethrough",
    EM: "document.format.italic",
    IMG: "document.structure.image",
    SPAN: "document.structure.span",
    STRONG: "document.format.bold",
} as const satisfies Record<string, MessageKey>;

type StructureTag = keyof typeof STRUCTURE_NAME_KEY_BY_TAG;

const TITLE_CHANGED_KEY_BY_TAG = {
    A: "document.structure.linkTitleChanged",
    CODE: "document.structure.inlineCodeTitleChanged",
    DEL: "document.structure.strikethroughTitleChanged",
    EM: "document.structure.italicTitleChanged",
    IMG: "document.structure.imageTitleChanged",
    SPAN: "document.structure.spanTitleChanged",
    STRONG: "document.structure.boldTitleChanged",
} as const satisfies Record<StructureTag, MessageKey>;

const STRUCTURE_SELECTOR = "strong, em, code, del, a, img, span";

function describeRenderedStructure(root: Element): string {
    const names = Array.from(root.querySelectorAll(STRUCTURE_SELECTOR)).map((element) =>
        t(STRUCTURE_NAME_KEY_BY_TAG[element.tagName as StructureTag]),
    );

    const unique = Array.from(new Set(names));
    if (unique.length === 0) return t("document.metadata.plainText");

    return joinList(unique);
}

/** Explain how a cell's rendered structure differs from its original's. */
function describeStructureChange(original: Element, current: Element): string {
    const before = describeRenderedStructure(original);
    const after = describeRenderedStructure(current);

    if (before !== after) return t("document.structure.changed", { before, after });

    return (
        describeTitleChange(original, current) ??
        t("document.structure.changedSame", { structure: before })
    );
}

/** "Link title changed from A to B" for the first element whose title differs. */
function describeTitleChange(original: Element, current: Element): string | null {
    const originals = Array.from(original.querySelectorAll(STRUCTURE_SELECTOR));
    const currents = Array.from(current.querySelectorAll(STRUCTURE_SELECTOR));
    if (originals.length !== currents.length) return null;

    const index = currents.findIndex(
        (element, i) => element.getAttribute("title") !== originals[i]!.getAttribute("title"),
    );

    if (index < 0) return null;
    const none = t("document.metadata.none");
    const before = originals[index]!.getAttribute("title") ?? none;
    const after = currents[index]!.getAttribute("title") ?? none;

    return t(TITLE_CHANGED_KEY_BY_TAG[currents[index]!.tagName as StructureTag], { before, after });
}
