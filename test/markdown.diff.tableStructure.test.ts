import { beforeEach, describe, expect, it } from "vitest";

import {
    decorateDiffRanges,
    DIFF_BLOCK_CLASS,
    DIFF_CELL_ADDED_CLASS,
    DIFF_CELL_CLASS,
    DIFF_CELL_REMOVED_CLASS,
    DIFF_DELETED_MARKER_CLASS,
    selectionTouchesDeletedDiff,
} from "../src/markdown/diffDecorations";
import { WORD_ADDED_CLASS } from "../src/markdown/wordDiffDom";
import { decorate, expectComparisonAmber, lines, render, view, words } from "./markdownDiffHarness";

// Rendered diff of a table's shape: added / removed / reordered columns and
// rows, header changes, and removed rows revealed inside the table grid.

const table = [
    "| Option | Default |", // 1 (header)
    "| --- | --- |", // 2 (separator)
    "| theme | light |", // 3
    "| retries | 3 |", // 4
    "| timeout | 5000 |", // 5
].join("\n");

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("rows", () => {
    it.each([
        {
            name: "an added row is marked on its own",
            original: lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"),
            current: lines(
                "| Name | Value |",
                "| --- | --- |",
                "| a | 1 |",
                "| c | 9 |",
                "| b | 2 |",
            ),
            expected: ["tr added: c 9"],
        },
        {
            name: "a removed row is revealed in the table",
            original: lines(
                "| Name | Value |",
                "| --- | --- |",
                "| a | 1 |",
                "| b | 2 |",
                "| c | 3 |",
            ),
            current: lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| c | 3 |"),
            expected: ["deleted: Removed table row"],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it("marks every row of a wholly-added table, header included", () => {
        const root = render(lines("| A | B |", "| --- | --- |", "| 1 | 2 |"));

        decorate(root, [{ startLine: 1, endLine: 3, kind: "added" }]);

        const rows = Array.from(root.querySelectorAll("tr"));
        expect(rows.map((r) => r.classList.contains("emr-diff-block--added"))).toEqual([
            true,
            true,
        ]);
        expect(root.querySelector("table")?.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });

    it("shows a swapped row as removed at its old position and added at its new position", () => {
        const matrix = [
            "| Service | Owner |",
            "| --- | --- |",
            "| Search | Discovery |",
            "| Checkout | Platform |",
            "| Billing | Finance |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| Checkout | Platform |\n",
            },
            { startLine: 4, endLine: 4, kind: "added", linesAdded: 1 },
        ]);

        const marker = root.querySelector<HTMLTableRowElement>(`tr.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(Array.from(marker.cells).map((cell) => cell.textContent)).toEqual([
            "Checkout",
            "Platform",
        ]);

        const added = Array.from(root.querySelectorAll("tbody tr")).find((row) =>
            row.classList.contains("emr-diff-block--added"),
        );

        expect(added?.textContent).toContain("Checkout");
    });
});

describe("removed rows", () => {
    it("shows a removed row inside the table at its old position", () => {
        const root = render(table);

        const res = decorate(root, [
            {
                startLine: 5,
                endLine: 5,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| extra | 9 |\n",
            },
        ]);

        expect(res.markers).toBe(1);

        const removedRow = root.querySelector<HTMLTableRowElement>(
            `tr.${DIFF_DELETED_MARKER_CLASS}`,
        )!;

        expect(removedRow.classList.contains("emr-diff-deleted-table-row")).toBe(true);
        expect(removedRow.hidden).toBe(false);
        expect(removedRow.getAttribute("aria-label")).toBe("Removed table row");
        const cells = Array.from(removedRow.querySelectorAll("td"));
        expect(cells.map((cell) => cell.textContent)).toEqual(["extra", "9"]);
        expect(removedRow.querySelector(".emr-diff-deleted-chip")).toBeNull();
    });

    it("shows a removed row with a different cell count as a removal card", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 4,
                endLine: 4,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| too | many | cells |\n",
            },
        ]);

        const marker = root.querySelector<HTMLElement>(`.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(marker.tagName).toBe("DIV");
        expect(marker.querySelector(".emr-diff-deleted-body")?.textContent).toContain(
            "too | many | cells",
        );
    });

    it("falls back to the removal card when the renderer cannot rebuild deleted rows as a table", () => {
        const root = render(table);
        decorateDiffRanges(
            root,
            [
                {
                    startLine: 5,
                    endLine: 5,
                    kind: "deleted-marker",
                    linesDeleted: 1,
                    deletedContent: "| extra | 9 |\n",
                },
            ],
            { renderInline: (md) => `<p>${md}</p>` },
        );
        expect(root.querySelector(".emr-diff-deleted-table-row")).toBeNull();

        const marker = root.querySelector<HTMLElement>(`.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(marker.tagName).toBe("DIV");
        expect(marker.querySelector(".emr-diff-deleted-body")?.textContent).toContain(
            "| extra | 9 |",
        );
    });
    it("shows a removed last row after the table's final row", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 6,
                endLine: 6,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| legacy | disabled |\n",
            },
        ]);
        const bodyRows = Array.from(root.querySelectorAll("tbody tr"));
        expect(bodyRows.at(-1)?.classList.contains("emr-diff-deleted-table-row")).toBe(true);
        expect(bodyRows.at(-1)?.classList.contains(DIFF_DELETED_MARKER_CLASS)).toBe(true);
    });

    it("shows several adjacent removed rows inside the table", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 4,
                endLine: 4,
                kind: "deleted-marker",
                linesDeleted: 2,
                deletedContent: "| legacy | 1 |\n| obsolete | 0 |\n",
            },
        ]);

        const removedRows = Array.from(
            root.querySelectorAll<HTMLTableRowElement>("tbody tr.emr-diff-deleted-table-row"),
        );

        expect(removedRows).toHaveLength(2);
        expect(
            removedRows.map((row) => Array.from(row.cells).map((cell) => cell.textContent)),
        ).toEqual([
            ["legacy", "1"],
            ["obsolete", "0"],
        ]);
        expect(removedRows.every((row) => !row.hidden)).toBe(true);
        expect(
            removedRows.every((row) => row.querySelector(".emr-diff-deleted-chip") == null),
        ).toBe(true);
    });

    it("does not treat ordinary removed prose containing a pipe as a table", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "Choose A | B before continuing.\n",
            },
        ]);
        const body = root.querySelector<HTMLElement>(".emr-diff-deleted-body")!;
        expect(body.querySelector("table")).toBeNull();
        expect(body.querySelector("p")?.textContent).toBe("Choose A | B before continuing.");
    });

    it("does not attach fully-piped prose to a non-adjacent earlier table", () => {
        const root = render([table, "", "After the table.", "", "Next section."].join("\n"));

        decorate(root, [
            {
                startLine: 9,
                endLine: 9,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| legacy | note |\n",
            },
        ]);
        expect(root.querySelector("tbody .emr-diff-deleted-table-row")).toBeNull();

        const marker = root.querySelector<HTMLElement>(`div.${DIFF_DELETED_MARKER_CLASS}`)!;

        expect(marker.querySelector(".emr-diff-deleted-body")?.textContent).toContain("legacy");
    });
    it("does not insert a removed body row into the table header", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "deleted-marker",
                linesDeleted: 1,
                deletedContent: "| legacy | value |",
            },
        ]);
        expect(root.querySelector("thead .emr-diff-deleted-table-row")).toBeNull();
        expect(root.querySelector(`.${DIFF_DELETED_MARKER_CLASS}`)).not.toBeNull();
    });
});

describe("columns and cells added or removed", () => {
    it("shows an added column green across the header and every row", () => {
        const matrix = [
            "| Option | Cadence | Owner |",
            "| --- | --- | --- |",
            "| theme | On change | Platform |",
            "| retries | Every minute | Runtime |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 4,
                kind: "modified",
                originalText: [
                    "| Option | Owner |",
                    "| --- | --- |",
                    "| theme | Platform |",
                    "| retries | Runtime |",
                ].join("\n"),
            },
        ]);
        const rows = Array.from(root.querySelectorAll("tr"));
        expect(rows).toHaveLength(3);

        expect(rows.map((row) => row.dataset.diffCells)).toEqual(["true", "true", "true"]);
        expect(
            rows.map((row) =>
                Array.from(row.querySelectorAll(`.${DIFF_CELL_ADDED_CLASS}`), (c) => c.textContent),
            ),
        ).toEqual([["Cadence"], ["On change"], ["Every minute"]]);
        // A wholly new cell is tinted as a whole, not word by word.
        expect(root.querySelector(`.${DIFF_CELL_ADDED_CLASS} .${WORD_ADDED_CLASS}`)).toBeNull();
    });

    it("shows a removed column struck red across the header and every row", () => {
        const root = render(
            [
                "| Option | Owner |",
                "| --- | --- |",
                "| theme | Platform |",
                "| retries | Runtime |",
            ].join("\n"),
        );

        decorate(root, [
            {
                startLine: 1,
                endLine: 4,
                kind: "modified",
                originalText: [
                    "| Option | Legacy | Owner |",
                    "| --- | --- | --- |",
                    "| theme | dark | Platform |",
                    "| retries | 1 | Runtime |",
                ].join("\n"),
            },
        ]);
        const rows = Array.from(root.querySelectorAll("tr"));
        expect(rows).toHaveLength(3);
        expect(words(rows[0]!).removed).toContain("Legacy");
        expect(words(rows[1]!).removed).toContain("dark");
        expect(words(rows[2]!).removed).toContain("1");

        expect(
            rows.map((row) => row.querySelectorAll(`.${DIFF_CELL_REMOVED_CLASS}`).length),
        ).toEqual([1, 1, 1]);
    });

    it("shows an inserted cell as added when an unchanged cell anchors the row", () => {
        const root = render(table);

        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme |",
            },
        ]);

        expect(res.decorated).toBe(1);

        const row = Array.from(root.querySelectorAll("table"))
            .at(-1)!
            .querySelector("tbody tr") as HTMLElement;

        expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(row.dataset.diffCells).toBe("true");
        const cells = Array.from(row.querySelectorAll("td"));
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
        expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expect(words(cells[1]!).removed).toHaveLength(0);
    });

    it("restores a removed cell, struck through, at its old position", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | legacy | light |",
            },
        ]);
        const row = root.querySelector("tbody tr") as HTMLElement;
        expect(row.dataset.diffCells).toBe("true");
        const cells = Array.from(row.querySelectorAll("td"));
        expect(cells).toHaveLength(3);
        expect(cells[1]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
        expect(words(cells[1]!).removed).toContain("legacy");
        expect(cells[0]!.textContent).toBe("theme");
        expect(cells[2]!.textContent).toBe("light");
    });

    it("restores a removed last cell, struck through, at the end of the row", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | light | legacy |",
            },
        ]);

        const cells = Array.from(root.querySelectorAll("tbody tr:first-child td"));

        expect(cells).toHaveLength(3);
        expect(cells[2]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
        expect(words(cells[2]!).removed).toContain("legacy");
    });

    it("shows an inserted middle cell and a paired trailing edit precisely", () => {
        const matrix = [
            "| Change shape | Cadence | Owner |",
            "| --- | --- | --- |",
            "| Columns restructured | On material change | Communications lead |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| Columns restructured | Response team |",
            },
        ]);
        const cells = Array.from(root.querySelectorAll("tbody td"));
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
        expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expect(words(cells[1]!).removed).toHaveLength(0);
        expect(words(cells[2]!).removed).toContain("Response team");
        expect(words(cells[2]!).added).toContain("Communications lead");
    });

    it("offers Before instead of cell marks when a resized row has no unchanged cell", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| palette | dark | inherited |",
            },
        ]);

        const row = Array.from(root.querySelectorAll("table"))
            .at(-1)!
            .querySelector("tbody tr") as HTMLElement;

        expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(row.dataset.diffCells).toBeUndefined();
        expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
        expectComparisonAmber(root);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;

        const comparison = root.querySelector<HTMLElement>(".emr-diff-table-comparison")!;

        expect(Array.from(comparison.children)).toEqual(
            expect.arrayContaining([trigger.parentElement, panel, row.closest("table")]),
        );
        expect(trigger.textContent).toBe("Before");
        expect(trigger.getAttribute("aria-label")).toBe("Show previous version");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(panel.hidden).toBe(true);
        expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
        trigger.click();
        expect(trigger.textContent).toBe("Hide");
        expect(trigger.getAttribute("aria-label")).toBe("Hide previous version");
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(panel.hidden).toBe(false);
        expect(panel.querySelector(".emr-diff-before-label")?.textContent).toBe("Before");
        expect(
            Array.from(panel.querySelectorAll("tbody td")).map((cell) => cell.textContent),
        ).toEqual(["palette", "dark", "inherited"]);
        const beforeText = panel.querySelector("td")!.firstChild!;
        expect(selectionTouchesDeletedDiff(beforeText, beforeText)).toBe(true);
        trigger.click();
        expect(panel.hidden).toBe(true);
        decorate(root, []);
        expect(root.querySelector(".emr-diff-before-control")).toBeNull();
        expect(root.querySelector(".emr-diff-before-panel")).toBeNull();
        expect(root.querySelector(".emr-diff-table-comparison")).toBeNull();
        expect(root.querySelector("table")).not.toBeNull();
    });
});

describe("headers", () => {
    it("marks only the edited header cell", () => {
        const root = render(table);

        // Header was `| Choice | Default |`; the first column label changed.
        const res = decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "| Choice | Default |",
            },
        ]);

        expect(res.decorated).toBe(1);
        const headCells = Array.from(root.querySelectorAll("thead th"));
        expect(headCells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
        expect(headCells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    });

    it("shows a renamed column header as an inline edit", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "| Option | Initial value |",
            },
        ]);
        const cells = Array.from(root.querySelectorAll("thead th"));
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(words(cells[1]!).removed).toContain("Initial value");
        expect(words(cells[1]!).added).toContain("Default");
    });

    it("keeps body cells neutral when a header is renamed across the table hunk", () => {
        const matrix = [
            "| Service | Primary owner |",
            "| --- | --- |",
            "| Checkout | Platform |",
            "| Search | Discovery |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 4,
                kind: "modified",
                originalText: [
                    "| Service | Response owner |",
                    "| --- | --- |",
                    "| Checkout | Platform |",
                    "| Search | Discovery |",
                ].join("\n"),
            },
        ]);
        expect(words(root.querySelector("thead")!).removed).toContain("Response");
        expect(words(root.querySelector("thead")!).added).toContain("Primary");
        expect(root.querySelector("tbody .emr-diff-cell")).toBeNull();
        expect(root.querySelector(".emr-diff-before-control")).toBeNull();
    });

    it("falls back for repeated headers despite repeated body values", () => {
        const matrix = [
            "| Yes | Inserted | Yes |",
            "| --- | --- | --- |",
            "| Yes | New | Yes |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 3,
                kind: "modified",
                originalText: ["| Yes | Yes |", "| --- | --- |", "| Yes | Yes |"].join("\n"),
            },
        ]);
        expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
        expect(
            root.querySelectorAll("table:last-of-type tr.emr-diff-block--modified"),
        ).toHaveLength(2);
    });

    it("falls back when a stable header surrounds both removed and added headers", () => {
        const matrix = [
            "| Service | Cadence | Owner |",
            "| --- | --- | --- |",
            "| Checkout | Continuous | Platform |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 3,
                kind: "modified",
                originalText: [
                    "| Service | Legacy mode |",
                    "| --- | --- |",
                    "| Checkout | Enabled |",
                ].join("\n"),
            },
        ]);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        trigger.click();

        const before = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;

        expect(before.querySelectorAll("table")).toHaveLength(1);
        expect(before.querySelectorAll("thead th")).toHaveLength(2);
        expect(before.querySelectorAll("tbody td")).toHaveLength(2);
        expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
    });

    it("falls back when the original body row had fewer cells than its header", () => {
        const matrix = [
            "| Service | Owner | Tier |",
            "| --- | --- | --- |",
            "| Checkout | Platform | Gold |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 3,
                kind: "modified",
                originalText: [
                    "| Service | Owner | Tier |",
                    "| --- | --- | --- |",
                    "| Checkout |",
                ].join("\n"),
            },
        ]);

        const row = Array.from(root.querySelectorAll<HTMLElement>("tbody tr")).at(-1)!;

        expect(row.classList.contains("emr-diff-block--modified")).toBe(true);
        expect(row.dataset.diffCells).toBeUndefined();
        expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
        expect(root.querySelectorAll(".emr-diff-before-control")).toHaveLength(1);
    });

    it("shows a swapped header order while keeping moved body values neutral", () => {
        const matrix = [
            "| Owner | Cadence |",
            "| --- | --- |",
            "| Platform | Every hour |",
            "| Operations | Every day |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 4,
                kind: "modified",
                originalText: [
                    "| Cadence | Owner |",
                    "| --- | --- |",
                    "| Every hour | Platform |",
                    "| Every day | Operations |",
                ].join("\n"),
            },
        ]);
        const rows = Array.from(root.querySelectorAll("tr"));
        expect(rows).toHaveLength(3);
        const headers = Array.from(rows[0]!.querySelectorAll("th"));
        expect(headers.every((cell) => words(cell).added.length > 0)).toBe(true);
        expect(headers.every((cell) => words(cell).removed.length > 0)).toBe(true);

        const body = rows.slice(1);
        expect(body.map((row) => row.querySelector(`.${DIFF_CELL_CLASS}`))).toEqual([null, null]);
        expect(body.map((row) => row.dataset.diffCells)).toEqual(["true", "true"]);
    });
    it("marks an inserted header cell green instead of washing the header row", () => {
        const matrix = [
            "| Option | Cadence | Owner |",
            "| --- | --- | --- |",
            "| theme | On change | Platform |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "| Option | Owner |",
            },
        ]);
        const cells = Array.from(root.querySelectorAll("thead th"));
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(cells[1]!.classList.contains(DIFF_CELL_ADDED_CLASS)).toBe(true);
        expect(cells[1]!.querySelector(`.${WORD_ADDED_CLASS}`)).toBeNull();
        expect(cells[2]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    });

    it("restores a removed header cell in its original position", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 1,
                endLine: 1,
                kind: "modified",
                originalText: "| Option | Legacy | Default |",
            },
        ]);
        const cells = Array.from(root.querySelectorAll("thead th"));
        expect(cells).toHaveLength(3);
        expect(cells[1]!.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
        expect(words(cells[1]!).removed).toContain("Legacy");
    });
});
