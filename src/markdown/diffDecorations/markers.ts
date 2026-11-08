// Deletion and source-only markers inserted between rendered blocks, plus the
// selection guard that withholds commenting over removed content.

import type { DiffRange } from "../../types";
import type { DecorationPass } from "./pass";
import { splitTableRow } from "./tableAlignment";
import {
    type ChangeRange,
    DIFF_DELETED_MARKER_CLASS,
    DIFF_SOURCE_ONLY_CLASS,
    numAttr,
    overlaps,
    readSourceSpan,
} from "./shared";

function insertBeforeAnchor(
    root: HTMLElement,
    marker: HTMLElement,
    anchor: HTMLElement | null,
): void {
    if (anchor?.parentElement) {
        anchor.parentElement.insertBefore(marker, anchor);
    } else {
        root.appendChild(marker);
    }
}

/** Show changed source lines that no rendered block covers as raw source. */
export function insertSourceOnlyMarkers(
    pass: DecorationPass,
    markerAnchors: readonly HTMLElement[],
): void {
    const currentLines = pass.currentLines;
    if (!currentLines) return;

    const renderedSpans = markerAnchors.flatMap((element) => {
        const span = readSourceSpan(element);

        // Stryker disable next-line ArrayDeclaration: a placeholder entry has no lines, so it overlaps no change, just like contributing nothing
        return span ? [span] : [];
    });

    for (const range of pass.changeRanges) {
        if (renderedSpans.some((span) => overlaps(span.start, span.end, range.start, range.end))) {
            continue;
        }

        const currentText = currentLines.slice(range.start - 1, range.end).join("\n");

        if (currentText.trim().length === 0) continue;

        const marker = buildSourceOnlyMarker(range, currentText, pass.root.ownerDocument);

        insertBeforeAnchor(pass.root, marker, firstBlockAtOrAfter(markerAnchors, range.start));
        pass.decorated++;
    }
}

/**
 * Deletion markers: lines removed have no surviving DOM, so we insert a
 * thin marker just before the block that now occupies the deletion's
 * line, and stash the removed text for a hover/expand affordance.
 *
 * Anchor candidates must also include Mermaid placeholders (decorated in a
 * separate pass, so absent from `blocks`) — otherwise a deletion sitting
 * right before a diagram would skip past it and land on a later block, or
 * fall through to being appended at the very end. The combined selector
 * returns nodes in document order, which matches source order.
 */
export function insertDeletionMarkers(
    pass: DecorationPass,
    markerAnchors: readonly HTMLElement[],
): number {
    let markers = 0;

    for (const r of pass.deletedRanges) {
        if (pass.absorbedDeletions.has(r)) continue;
        const anchor = firstBlockAtOrAfter(markerAnchors, r.startLine);

        const tableMarker = pass.renderInline
            ? buildDeletedTableRows(r, anchor, markerAnchors, pass.renderInline)
            : null;

        if (tableMarker) {
            const { parent, before, rows } = tableMarker;
            for (const row of rows) parent.insertBefore(row, before);
        } else {
            insertBeforeAnchor(pass.root, buildDeletedMarker(r, pass.renderInline), anchor);
        }

        markers++;
    }

    return markers;
}

function buildSourceOnlyMarker(
    range: ChangeRange,
    currentText: string,
    doc: Document,
): HTMLElement {
    const marker = doc.createElement("div");
    marker.className = `${DIFF_SOURCE_ONLY_CLASS} emr-diff-block--${range.kind}`;
    marker.dataset.diffKind = range.kind;
    marker.dataset.sourceLine = String(range.start);
    marker.dataset.sourceEndLine = String(range.end);

    const label = doc.createElement("span");
    label.className = "emr-diff-source-only-label";
    label.textContent = range.kind === "added" ? "Source added" : "Source changed";
    const source = doc.createElement("pre");
    source.className = "emr-diff-source-only-current";
    const code = doc.createElement("code");
    code.textContent = currentText;
    source.appendChild(code);

    if (range.kind === "modified" && range.originalText != null) {
        const control = doc.createElement("div");
        control.className = "emr-diff-before-control emr-diff-before-control--source";
        const trigger = doc.createElement("button");
        // Stryker disable next-line StringLiteral: the rendered article holds no form, so the button type changes nothing
        trigger.type = "button";
        trigger.className = "emr-diff-before-trigger";
        trigger.textContent = "Before";
        trigger.setAttribute("aria-label", "Show previous source");
        trigger.setAttribute("aria-expanded", "false");
        const panel = doc.createElement("div");
        panel.className = "emr-diff-before-panel emr-diff-before-panel--source markdown-body";
        panel.id = `emr-diff-before-source-${range.start}-${range.end}`;
        panel.hidden = true;
        trigger.setAttribute("aria-controls", panel.id);
        const previous = doc.createElement("pre");
        const previousCode = doc.createElement("code");
        previousCode.textContent = range.originalText;
        previous.appendChild(previousCode);
        panel.appendChild(previous);
        trigger.addEventListener("click", () => {
            const open = panel.hidden;
            panel.hidden = !open;
            trigger.textContent = open ? "Hide" : "Before";
            trigger.setAttribute(
                "aria-label",
                open ? "Hide previous source" : "Show previous source",
            );
            trigger.setAttribute("aria-expanded", open ? "true" : "false");
        });
        control.appendChild(trigger);
        marker.append(control, panel);
    }

    marker.append(label, source);

    return marker;
}

/** First block whose source range starts at/after `line` (document order). */
function firstBlockAtOrAfter(blocks: readonly HTMLElement[], line: number): HTMLElement | null {
    for (const el of blocks) {
        const start = numAttr(el, "data-source-line");
        // Stryker disable next-line ConditionalExpression: an unstamped block's missing line compares as 0, which is never at or after a change line (lines start at 1)
        if (start != null && start >= line) return el;
    }

    return null;
}

function buildDeletedMarker(r: DiffRange, renderInline?: (md: string) => string): HTMLElement {
    const count = r.linesDeleted ?? 0;
    const marker = document.createElement("div");
    marker.className = DIFF_DELETED_MARKER_CLASS;
    marker.setAttribute("role", "note");
    const label = `${count} line${count === 1 ? "" : "s"} removed`;
    marker.setAttribute("aria-label", label);

    const rail = document.createElement("span");
    rail.className = "emr-diff-deleted-rail";
    rail.setAttribute("aria-hidden", "true");

    const chip = document.createElement("button");
    // Stryker disable next-line StringLiteral: the rendered article holds no form, so the button type changes nothing
    chip.type = "button";
    chip.className = "emr-diff-deleted-chip";
    chip.textContent = label;
    chip.setAttribute("aria-expanded", "false");

    const removedMarkdown = (r.deletedContent ?? "").replace(/\n+$/, "");
    // Render the removed source as Markdown so headings/code/lists read like the
    // document they came from — not raw `##`/backtick syntax. Falls back to a
    // preformatted plain block when no renderer is supplied (pure jsdom tests).
    let body: HTMLElement;

    if (renderInline && removedMarkdown) {
        body = document.createElement("div");
        body.className = "emr-diff-deleted-body markdown-body";
        // eslint-disable-next-line no-unsanitized/property -- renderInline is renderMarkdownSync, whose output is sanitized by rehypeSafeHtml + rehypeSanitizeUrls
        body.innerHTML = renderInline(removedMarkdown);
    } else {
        body = document.createElement("pre");
        body.className = "emr-diff-deleted-body";
        body.textContent = removedMarkdown;
    }

    body.hidden = true;

    chip.addEventListener("click", () => {
        const open = body.hidden === true;
        body.hidden = !open;
        chip.setAttribute("aria-expanded", open ? "true" : "false");
        marker.classList.toggle("is-open", open);
    });

    marker.appendChild(rail);
    marker.appendChild(chip);
    marker.appendChild(body);

    return marker;
}

interface DeletedTableRows {
    parent: HTMLElement;
    before: ChildNode | null;
    rows: HTMLTableRowElement[];
}

function buildDeletedTableRows(
    range: DiffRange,
    anchor: HTMLElement | null,
    anchors: readonly HTMLElement[],
    renderInline: (md: string) => string,
): DeletedTableRows | null {
    // Stryker disable next-line ConditionalExpression,StringLiteral: empty removed text is a single empty line, which the table-row check below rejects anyway
    if (range.deletedContent == null || range.deletedContent === "") {
        return null;
    }

    const markdown = range.deletedContent.replace(/\n+$/, "");
    const lines = markdown.split(/\r\n|\r|\n/);
    const columnCount = deletedTableColumnCount(lines);
    // Stryker disable next-line ConditionalExpression: dead code: without a column count no live row can match it, so the cell-count check below already returns null, candidate for removal
    if (columnCount == null) return null;

    const referenceRow = deletedRowReference(range, anchor, anchors);
    if (!referenceRow) return null;
    const parent = referenceRow.parentElement;

    // Stryker disable next-line OptionalChaining: a reference row always sits inside a table section
    if (parent?.tagName !== "TBODY" || referenceRow.children.length !== columnCount) {
        return null;
    }

    const removedRows = renderDeletedTableRows(lines, columnCount, renderInline);

    if (!removedRows) return null;

    const before =
        anchor?.tagName === "TR" && anchor.parentElement === parent
            ? anchor
            : referenceRow.nextSibling;

    return { parent, before, rows: removedRows };
}

/**
 * The shared column count of deleted lines that are all plain table rows (no
 * delimiter row, at least two columns); null for anything else.
 */
function deletedTableColumnCount(lines: readonly string[]): number | null {
    const rows = lines.map(splitTableRow);
    const columnCount = rows[0]!.length;

    if (
        lines.some((line) => !/^\s*\|.*\|\s*$/.test(line)) ||
        // Stryker disable next-line MethodExpression,ArrowFunction,Regex: dead code: removed lines that include a delimiter row are a whole table, which never sits next to a live body row (its neighbour is another table's header row or a non-row block), so the checks below already reject it, candidate for removal
        lines.some((line) => splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell))) ||
        columnCount < 2 ||
        rows.some((cells) => cells.length !== columnCount)
    ) {
        return null;
    }

    return columnCount;
}

/**
 * The live row that deleted rows are shown beside: the anchor row itself, or
 * the last row of a table that ends just before the deletion.
 */
function deletedRowReference(
    range: DiffRange,
    anchor: HTMLElement | null,
    anchors: readonly HTMLElement[],
): HTMLElement | undefined {
    const previousRow = [...anchors].reverse().find(
        (candidate) =>
            // Stryker disable next-line ConditionalExpression,LogicalOperator: a non-row block found here is never inside a table body, so the parent check below rejects it just as finding no row would
            candidate.tagName === "TR" &&
            // Stryker disable next-line EqualityOperator: rows are one line, so a row ending on the removal's own line starts there too and is already the anchor used first
            numAttr(candidate, "data-source-end-line")! < range.startLine,
    );

    const previousRowEnd =
        previousRow == null ? null : numAttr(previousRow, "data-source-end-line");

    const immediatelyAfterPreviousTable =
        // Stryker disable next-line ConditionalExpression: dead code: the previous row was found by its end line, so that line is never missing, candidate for removal
        previousRowEnd != null && previousRowEnd + 1 === range.startLine;

    return anchor?.tagName === "TR"
        ? anchor
        : immediatelyAfterPreviousTable
          ? previousRow
          : undefined;
}

/** Render deleted table-row Markdown as body rows styled as removed. */
function renderDeletedTableRows(
    lines: readonly string[],
    columnCount: number,
    renderInline: (md: string) => string,
): HTMLTableRowElement[] | null {
    const delimiter = `| ${Array(columnCount).fill("---").join(" | ")} |`;
    const scratch = document.createElement("div");
    // eslint-disable-next-line no-unsanitized/property -- renderInline is renderMarkdownSync, whose output is sanitized by rehypeSafeHtml + rehypeSanitizeUrls
    scratch.innerHTML = renderInline([lines[0]!, delimiter, ...lines.slice(1)].join("\n"));
    const table = scratch.querySelector<HTMLTableElement>("table");
    const headerRow = table?.querySelector<HTMLTableRowElement>("thead tr");
    // Stryker disable next-line LogicalOperator: a rendered GFM table always has a header row, so the two checks only fail together
    if (!table || !headerRow) return null;

    for (const header of Array.from(headerRow.querySelectorAll("th"))) {
        const cell = document.createElement("td");

        // Stryker disable next-line BlockStatement: dead code: the delimiter row built above has no alignment, so this only copies the scratch render's meaningless source-line stamps, which nothing reads on a removed row, candidate for removal
        for (const attribute of Array.from(header.attributes)) {
            cell.setAttribute(attribute.name, attribute.value);
        }

        cell.append(...Array.from(header.childNodes));
        header.replaceWith(cell);
    }

    const body = table.tBodies.item(0) ?? table.createTBody();
    body.prepend(headerRow);
    const removedRows = Array.from(body.rows);

    for (const row of removedRows) {
        row.className = `${DIFF_DELETED_MARKER_CLASS} emr-diff-deleted-table-row`;
        row.setAttribute("role", "note");
        row.setAttribute("aria-label", "Removed table row");
    }

    return removedRows;
}

/**
 * True when `node` sits inside a deleted-diff marker — removed content shown
 * for reference only. That text is not part of the live document, so it must
 * never be offered as a comment anchor (the anchor would orphan immediately).
 */
function isWithinDeletedDiff(node: Node | null): boolean {
    const el =
        node == null
            ? null
            : node.nodeType === Node.ELEMENT_NODE
              ? (node as Element)
              : node.parentElement;

    return (
        el?.closest(
            `.${DIFF_DELETED_MARKER_CLASS}, .emr-diff-before-panel, .${DIFF_SOURCE_ONLY_CLASS}`,
        ) != null
    );
}

/**
 * True when a selection touches a deleted-diff marker, so the caller can
 * withhold the "add comment" affordance for removed content. This fires when
 * either endpoint lands inside a marker *or* the selection spans across one — a
 * selection that starts before a marker and ends after it has both endpoints
 * outside the removed block, so the endpoint check alone would miss it and
 * leave the comment bubble available over deleted content.
 */
export function selectionTouchesDeletedDiff(
    anchorNode: Node | null,
    focusNode: Node | null,
): boolean {
    if (isWithinDeletedDiff(anchorNode) || isWithinDeletedDiff(focusNode)) {
        return true;
    }

    // Stryker disable next-line LogicalOperator: a DOM selection's anchor and focus are both null or both set
    if (!anchorNode || !focusNode) return false;

    // Both endpoints sit outside every marker. The selection still covers a
    // marker when one lies between the endpoints in document order — i.e. exactly
    // one endpoint precedes it. Scope the scan to the nodes' shared tree so it
    // works whether the article is live in the document or a detached fixture.
    // "Before" panels count only while open: a collapsed (`hidden`) panel sits
    // beside every changed block but contributes no selected text.
    const scope = anchorNode.getRootNode() as ParentNode;

    for (const marker of scope.querySelectorAll(
        `.${DIFF_DELETED_MARKER_CLASS}, .emr-diff-before-panel:not([hidden]), .${DIFF_SOURCE_ONLY_CLASS}`,
    )) {
        const markerAfterAnchor =
            (anchorNode.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

        const markerAfterFocus =
            (focusNode.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

        if (markerAfterAnchor !== markerAfterFocus) return true;
    }

    return false;
}
