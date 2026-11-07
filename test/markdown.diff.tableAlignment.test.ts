import { describe, expect, it } from "vitest";

import {
    alignTableCells,
    alignTableColumns,
    DIFF_CELL_REMOVED_CLASS,
    splitTableRow,
} from "../src/markdown/diffDecorations";
import { attachTableBeforeDisclosure } from "../src/markdown/diffDecorations/beforeDisclosure";
import { diffTableRowCells } from "../src/markdown/diffDecorations/tableCells";
import { stubRender, words } from "./markdownDiffHarness";

// How a table row's previous cells are matched to its current cells: splitting
// a row's source into cells, aligning cells and header columns that were
// inserted, removed or reordered, and the cell-level helpers built on them.

describe("splitTableRow", () => {
    it.each([
        { name: "a fully piped row", row: "| a | b | c |", cells: ["a", "b", "c"] },
        { name: "a row without outer pipes", row: "a | b", cells: ["a", "b"] },
        {
            name: "a row with whitespace around its outer pipes",
            row: "  | a | b |  ",
            cells: ["a", "b"],
        },
        {
            name: "a row with an escaped pipe inside a cell",
            row: "| a \\| b | c |",
            cells: ["a \\| b", "c"],
        },
    ])("splits $name into its cells", ({ row, cells }) => {
        expect(splitTableRow(row)).toEqual(cells);
    });
});

describe("alignTableCells", () => {
    it.each([
        {
            name: "an edited cell in an equal-width row stays in place",
            original: ["a", "old"],
            current: ["a", "new"],
            alignment: [
                { kind: "equal", originalIndex: 0, currentIndex: 0 },
                { kind: "modified", originalIndex: 1, currentIndex: 1 },
            ],
        },
        {
            name: "a single empty cell is unchanged",
            original: [""],
            current: [""],
            alignment: [{ kind: "equal", originalIndex: 0, currentIndex: 0 }],
        },
        {
            name: "a cell inserted between unique anchors is added",
            original: ["a", "b"],
            current: ["a", "new", "b"],
            alignment: [
                { kind: "equal", originalIndex: 0, currentIndex: 0 },
                { kind: "added", currentIndex: 1 },
                { kind: "equal", originalIndex: 1, currentIndex: 2 },
            ],
        },
        {
            name: "a cell inserted before the first anchor is added",
            original: ["anchor"],
            current: ["new", "anchor"],
            alignment: [
                { kind: "added", currentIndex: 0 },
                { kind: "equal", originalIndex: 0, currentIndex: 1 },
            ],
        },
        {
            name: "a cell removed before the first anchor is removed",
            original: ["old", "anchor"],
            current: ["anchor"],
            alignment: [
                { kind: "removed", originalIndex: 0, currentIndex: 0 },
                { kind: "equal", originalIndex: 1, currentIndex: 0 },
            ],
        },
        {
            name: "a cell appended after the last anchor is added",
            original: ["anchor"],
            current: ["anchor", "new"],
            alignment: [
                { kind: "equal", originalIndex: 0, currentIndex: 0 },
                { kind: "added", currentIndex: 1 },
            ],
        },
        {
            name: "a cell removed after the last anchor is removed",
            original: ["anchor", "old"],
            current: ["anchor"],
            alignment: [
                { kind: "equal", originalIndex: 0, currentIndex: 0 },
                { kind: "removed", originalIndex: 1, currentIndex: 1 },
            ],
        },
    ])("$name", ({ original, current, alignment }) => {
        expect(alignTableCells(original, current)).toEqual(alignment);
    });

    it.each([
        {
            name: "a rewrite with no unchanged cell",
            original: ["a", "b"],
            current: ["x", "y", "z"],
        },
        {
            name: "only a repeated value in common",
            original: ["yes", "yes"],
            current: ["yes", "new", "yes"],
        },
        { name: "only an empty cell in common", original: [""], current: ["", "new"] },
    ])("cannot align rows of different width with $name", ({ original, current }) => {
        expect(alignTableCells(original, current)).toBeNull();
    });
});

describe("alignTableColumns", () => {
    const eq = (originalIndex: number, currentIndex: number) => ({
        kind: "equal",
        originalIndex,
        currentIndex,
    });

    it.each([
        {
            name: "an unchanged schema with repeated names maps column for column",
            original: ["Owner", "Owner"],
            current: ["Owner", "Owner"],
            alignment: [eq(0, 0), eq(1, 1)],
        },
        {
            name: "an unchanged schema with an empty header maps column for column",
            original: ["", "Owner"],
            current: ["", "Owner"],
            alignment: [eq(0, 0), eq(1, 1)],
        },
        {
            name: "a renamed header in a same-width schema stays in place",
            original: ["Service", "Response owner"],
            current: ["Service", "Primary owner"],
            alignment: [eq(0, 0), { kind: "modified", originalIndex: 1, currentIndex: 1 }],
        },
        {
            name: "uniquely named swapped columns map by name",
            original: ["Cadence", "Owner"],
            current: ["Owner", "Cadence"],
            alignment: [eq(1, 0), eq(0, 1)],
        },
        {
            name: "a removed first column",
            original: ["Legacy", "Service", "Owner"],
            current: ["Service", "Owner"],
            alignment: [{ kind: "removed", originalIndex: 0, currentIndex: 0 }, eq(1, 0), eq(2, 1)],
        },
        {
            name: "an inserted middle column",
            original: ["Service", "Owner"],
            current: ["Service", "Cadence", "Owner"],
            alignment: [eq(0, 0), { kind: "added", currentIndex: 1 }, eq(1, 2)],
        },
        {
            name: "a removed middle column",
            original: ["Service", "Legacy", "Owner"],
            current: ["Service", "Owner"],
            alignment: [eq(0, 0), { kind: "removed", originalIndex: 1, currentIndex: 1 }, eq(2, 1)],
        },
        {
            name: "a removed last column",
            original: ["Service", "Owner", "Legacy"],
            current: ["Service", "Owner"],
            alignment: [eq(0, 0), eq(1, 1), { kind: "removed", originalIndex: 2, currentIndex: 2 }],
        },
        {
            name: "a removed column followed by several stable ones",
            original: ["Service", "Legacy", "Owner", "Tier"],
            current: ["Service", "Owner", "Tier"],
            alignment: [
                eq(0, 0),
                { kind: "removed", originalIndex: 1, currentIndex: 1 },
                eq(2, 1),
                eq(3, 2),
            ],
        },
    ])("aligns $name", ({ original, current, alignment }) => {
        expect(alignTableColumns(original, current)).toEqual(alignment);
    });

    it.each([
        {
            name: "only a repeated header in common",
            original: ["Yes", "Yes"],
            current: ["Yes", "New", "Yes"],
        },
        {
            name: "columns both removed and added",
            original: ["Service", "Legacy"],
            current: ["Service", "Cadence", "Owner"],
        },
    ])("cannot align schemas of different width with $name", ({ original, current }) => {
        expect(alignTableColumns(original, current)).toBeNull();
    });
});

// The cell-level helpers are also reached with rows the Markdown renderer never
// produces; these pin that they degrade safely.
describe("table diff helpers", () => {
    function tableWithRow(rowHtml: string) {
        const host = document.createElement("div");
        host.innerHTML = `<table><tbody><tr>${rowHtml}</tr></tbody></table>`;

        return {
            host,
            table: host.querySelector("table")!,
            row: host.querySelector("tr")!,
        };
    }

    it("adds no Before comparison to a row whose previous text is unknown", () => {
        const { host, table, row } = tableWithRow("<td>a</td>");

        attachTableBeforeDisclosure(row, { start: 1, end: 1, kind: "modified" }, stubRender);

        expect(row.dataset.diffAmberMode).toBeUndefined();
        expect(table.parentElement).toBe(host);
        expect(host.querySelector(".emr-diff-before-control")).toBeNull();
    });

    it("restores a removed cell as a td in a row that has no cells left", () => {
        const { row } = tableWithRow("");

        const result = diffTableRowCells(row, "| gone |", stubRender, [
            { kind: "removed", originalIndex: 0, currentIndex: 0 },
        ]);

        expect(result).toBe("precise");
        const cell = row.firstElementChild!;
        expect(cell.tagName).toBe("TD");
        expect(cell.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
        expect(words(cell).removed).toBe("gone");
    });
});
