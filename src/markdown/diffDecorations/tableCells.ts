// Per-cell decoration of a modified table row against its original source.

import { diffWords } from "../wordDiff";
import { WORD_REMOVED_CLASS, applyInlineWordDiff } from "../wordDiffDom";
import {
  alignTableCells,
  alignTableColumns,
  splitTableRow,
  type TableCellAlignment,
} from "./tableAlignment";
import { applyDiffTooltip } from "./tooltip";
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
  const headerRow = row
    .closest("table")!
    .querySelector<HTMLElement>("thead tr")!;

  const headerLine = numAttr(headerRow, "data-source-line");

  if (
    headerLine == null ||
    headerLine < range.start ||
    headerLine > range.end
  ) {
    return undefined;
  }

  const originalHeader =
    range.originalText!.split(/\r\n|\r|\n/)[headerLine - range.start]!;

  const originalHeaders = renderTableSourceTexts(originalHeader, renderInline);

  const currentHeaders = Array.from(
    headerRow.querySelectorAll<HTMLElement>("th, td"),
  )
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

function renderTableSourceTexts(
  row: string,
  renderInline: (md: string) => string,
): string[] {
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
  const cells = Array.from(tr.children).filter(
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

  if (!rawAlignment) return "ambiguous";

  if (
    alignmentOutOfRange(rawAlignment, originalCells.length, currentCells.length)
  ) {
    return "ambiguous";
  }

  const alignment = rawAlignment.map((item): TableCellAlignment => {
    if (item.kind === "added" || item.kind === "removed") return item;

    return {
      ...item,
      kind:
        originalCells[item.originalIndex] === currentCells[item.currentIndex]
          ? "equal"
          : "modified",
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
      return (
        item.originalIndex >= originalLength ||
        item.currentIndex > currentLength
      );
    }

    return (
      item.originalIndex >= originalLength || item.currentIndex >= currentLength
    );
  });
}

/** Mark one aligned cell; true when the cell shows a change. */
function markAlignedCell(
  row: TableRowCells,
  item: TableCellAlignment,
): boolean {
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

  const contentDiff = diffInlineContent(
    row.originals.rendered[item.originalIndex]!,
    cell,
  );

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

  if (
    row.originals.signatures[item.originalIndex] !==
    tableCellStructureSignature(cell)
  ) {
    cell.classList.add(DIFF_CELL_CLASS);
    applyDiffTooltip(
      cell,
      `Rendered structure changed from ${describeRenderedStructure(originalCell)} to ${describeRenderedStructure(cell)}`,
    );

    return true;
  }

  return false;
}

/** Show a removed cell in place as a struck-through temporary cell. */
function insertRemovedCell(
  row: TableRowCells,
  item: { originalIndex: number; currentIndex: number },
): void {
  /* v8 ignore next -- GFM pads every rendered row to the header width, so a row showing a removed cell always has a td/th to copy */
  const removedCell = row.doc.createElement(row.cells[0]?.tagName ?? "td");
  removedCell.classList.add(
    DIFF_CELL_CLASS,
    DIFF_CELL_INLINE_CLASS,
    DIFF_CELL_REMOVED_CLASS,
  );
  applyInlineWordDiff(
    removedCell,
    diffWords(row.originals.texts[item.originalIndex]!, ""),
  );
  row.tr.insertBefore(removedCell, row.cells[item.currentIndex] ?? null);
}

/**
 * Text-independent shape of rich cell content. Keeps element names and the
 * attributes that change meaning/navigation, while ignoring renderer-only
 * source-position metadata and the words handled by the word diff itself.
 */
function tableCellStructureSignature(root: Element): string {
  const parts: string[] = [];

  const visit = (element: Element): void => {
    const semanticAttributes = ["href", "src", "title"]
      .map((name) => [name, element.getAttribute(name)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null)
      .map(([name, value]) => `${name}=${value}`)
      .join(",");

    parts.push(`<${element.tagName.toLowerCase()}${semanticAttributes}>`);
    for (const child of Array.from(element.children)) visit(child);
    parts.push(`</${element.tagName.toLowerCase()}>`);
  };

  for (const child of Array.from(root.children)) visit(child);

  return parts.join("");
}

function describeRenderedStructure(root: Element): string {
  const nameByTag: Record<string, string> = {
    A: "link",
    CODE: "inline code",
    DEL: "strikethrough",
    EM: "italic",
    IMG: "image",
    SPAN: "span",
    STRONG: "bold",
  };

  const names = Array.from(
    root.querySelectorAll("strong, em, code, del, a, img, span"),
  ).map((element) => nameByTag[element.tagName]!);

  const unique = Array.from(new Set(names));
  if (unique.length === 0) return "plain text";
  if (unique.length === 1) return unique[0]!;

  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
