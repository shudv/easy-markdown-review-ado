import { beforeEach, describe, expect, it } from "vitest";

import {
    DIFF_BLOCK_CLASS,
    DIFF_CELL_CLASS,
    DIFF_CELL_INLINE_CLASS,
    DIFF_CELL_METADATA_CLASS,
    DIFF_CELL_REMOVED_CLASS,
    DIFF_FORMAT_CLASS,
    DIFF_METADATA_CLASS,
} from "../src/markdown/diffDecorations";
import {
    decorate,
    diffView,
    expectPreciseAmber,
    lines,
    render,
    view,
    words,
    wrapContents,
} from "./markdownDiffHarness";

// Rendered diff of table cells. ADO's diff is LINE-based (a table row is one
// source line), but per-CELL granularity is recovered by diffing the original
// row's source against the live cells: a changed cell is marked on its own and
// shows an inline word diff (green added / struck red removed), falling back
// to a flat cell wash when the words can't be safely reconstructed.

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

describe("edited cells", () => {
    it.each([
        {
            name: "an edited cell is word-diffed on its own",
            original: lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"),
            current: lines("| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 3 |"),
            expected: ["tr modified cells: b [-2-]{+3+}"],
        },
        {
            name: "re-padded cells are hidden",
            original: lines("| Name | Value |", "| --- | --- |", "| a | 1 |"),
            current: lines("| Name | Value |", "| --- | --- |", "| a   | 1     |"),
            expected: [],
        },
    ])("$name", ({ original, current, expected }) => {
        expect(view(original, current)).toEqual(expected);
    });

    it("marks only the edited cell of a row", () => {
        const root = render(table);

        // Live row renders `theme | light`; the original was `theme | dark`, so
        // only the second cell (Default) changed.
        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | dark |",
            },
        ]);

        expect(res.decorated).toBe(1);
        const rows = Array.from(root.querySelectorAll("tbody tr"));
        const row = rows[0]!;
        expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect((row as HTMLElement).dataset.diffCells).toBe("true");
        const cells = Array.from(row.querySelectorAll("td"));
        // First cell (`theme`) unchanged, second cell (`light`→`auto`) marked.
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(cells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
        // Untouched rows carry no cell marks.
        expect(rows[1]!.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
    });

    it("word-diffs the changed word inside a multi-word cell", () => {
        const multi = [
            "| Option | Description |",
            "| --- | --- |",
            "| theme | the widget colour scheme |",
        ].join("\n");

        const root = render(multi);

        // Live cell reads "the widget colour scheme"; the original said
        // "...colour palette" — only the last word changed, so the rest of the
        // cell must stay neutral while just that word is marked.
        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | the widget colour palette |",
            },
        ]);

        expect(res.decorated).toBe(1);
        const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
        expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
        // The inline modifier drops the flat wash so the word marks read cleanly.
        expect(cell.classList.contains("emr-diff-cell--inline")).toBe(true);
        const w = words(cell);
        expect(w.added).toContain("scheme");
        expect(w.removed).toContain("palette");
        // Unchanged words are left untouched.
        expect(cell.textContent).toContain("colour");
    });

    it("shows a toggleable target indicator when only a cell link's destination changed", () => {
        const rich = [
            "| Resource | Link | Owner |",
            "| --- | --- | --- |",
            "| Guide | [Open guide](https://example.com/v2) | Platform |",
        ].join("\n");

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| Guide | [Open guide](https://example.com/v1) | Platform |",
            },
        ]);
        const cells = Array.from(root.querySelectorAll("tbody td"));
        expect(cells[0]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
        expect(cells[1]!.classList.contains(DIFF_CELL_CLASS)).toBe(true);
        expect(cells[1]!.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(true);
        expect(cells[1]!.querySelector("a")?.getAttribute("href")).toBe("https://example.com/v2");

        const indicator = cells[1]!.querySelector<HTMLElement>(`.${DIFF_METADATA_CLASS}`)!;

        const trigger = indicator.querySelector<HTMLButtonElement>("button")!;
        expect(trigger.getAttribute("aria-label")).toBe("Show link target change");
        expect(trigger.querySelector("svg")).not.toBeNull();
        expect(trigger.textContent).toBe("");
        expect(indicator.querySelectorAll(".emr-diff-metadata-target-diff")).toHaveLength(1);
        expect(indicator.querySelector(".emr-diff-metadata-row--before")).toBeNull();
        expect(indicator.querySelector(".emr-diff-metadata-row--after")).toBeNull();
        expect(words(indicator).removed).toContain("v1");
        expect(words(indicator).added).toContain("v2");
        trigger.click();
        expect(indicator.classList.contains("is-open")).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        trigger.click();
        expect(indicator.classList.contains("is-open")).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(cells[2]!.classList.contains(DIFF_CELL_CLASS)).toBe(false);
    });
    it("word-diffs a cell while keeping its inline code and emphasis", () => {
        const rich = [
            "| Setting | Required value |",
            "| --- | --- |",
            "| Retry | Set `retry.mode` to **adaptive**. |",
        ].join("\n");

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| Retry | Set `retry.mode` to **legacy**. |",
            },
        ]);
        const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
        expect(cell.classList.contains("emr-diff-cell--inline")).toBe(true);
        expect(cell.querySelector("code")?.textContent).toBe("retry.mode");
        expect(cell.querySelector("strong")?.textContent).toContain("adaptive");
        expect(words(cell).removed).toContain("legacy");
        expect(words(cell).added).toContain("adaptive");
    });

    it("keeps bold text inside a cell link whose text and target changed", () => {
        const rich = [
            "| Resource | Link |",
            "| --- | --- |",
            "| Guide | [**Current guide**](https://example.com/v2) |",
        ].join("\n");

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| Guide | [**Legacy guide**](https://example.com/v1) |",
            },
        ]);
        const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
        expect(cell.querySelector("a strong")?.textContent).toContain("Current");
        expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).not.toBeNull();
    });
    it("shows text marks without a formatting indicator in a mixed cell edit", () => {
        const rich = ["| Setting | Value |", "| --- | --- |", "| Retry | **adaptive mode** |"].join(
            "\n",
        );

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| Retry | legacy mode |",
            },
        ]);
        const cell = root.querySelectorAll("tbody td")[1] as HTMLElement;
        expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(true);
        expect(cell.classList.contains(DIFF_CELL_METADATA_CLASS)).toBe(false);
        expect(words(cell).removed).toContain("legacy");
        expect(words(cell).added).toContain("adaptive");
        expect(cell.querySelector(`.${DIFF_METADATA_CLASS}`)).toBeNull();
    });

    it("word-diffs long cells without splitting on an escaped pipe", () => {
        const rich = [
            "| Policy | Guidance | Query |",
            "| --- | --- | --- |",
            '| Escalation | Notify after the first failed mitigation attempt and include affected regions in the response log. | `state == "active" \\| state == "waiting"` |',
        ].join("\n");

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText:
                    '| Escalation | Notify after the second failed mitigation attempt and include customer impact in the response log. | `state == "active" \\| state == "queued"` |',
            },
        ]);
        const cells = Array.from(root.querySelectorAll("tbody td"));
        expect(cells).toHaveLength(3);
        expect(words(cells[1]!).removed).toContain("second");
        expect(words(cells[1]!).added).toContain("first");
        expect(cells[2]!.querySelector("code")?.textContent).toContain("|");
        expect(words(cells[2]!).removed).toContain("queued");
        expect(words(cells[2]!).added).toContain("waiting");
    });

    it("shows filled and cleared empty cells precisely", () => {
        const rich = [
            "| Service | Escalation |",
            "| --- | --- |",
            "| Checkout | Pager |",
            "| Search | |",
        ].join("\n");

        const root = render(rich);
        decorate(root, [
            {
                startLine: 3,
                endLine: 4,
                kind: "modified",
                originalText: "| Checkout | |\n| Search | Pager |",
            },
        ]);
        const rows = Array.from(root.querySelectorAll("tbody tr"));
        expect(words(rows[0]!.children[1]!).added).toContain("Pager");
        expect(words(rows[0]!.children[1]!).removed).toHaveLength(0);
        expect(words(rows[1]!.children[1]!).removed).toContain("Pager");
        expect(words(rows[1]!.children[1]!).added).toHaveLength(0);
    });

    it("shows each edited cell precisely when several cells in a row changed", () => {
        const matrix = [
            "| Option | Default | Owner |",
            "| --- | --- | --- |",
            "| palette | light | Runtime |",
        ].join("\n");

        const root = render(matrix);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | dark | Platform |",
            },
        ]);

        const row = Array.from(root.querySelectorAll("table"))
            .at(-1)!
            .querySelector("tbody tr") as HTMLElement;

        const cells = Array.from(row.querySelectorAll("td"));
        expect(row.dataset.diffCells).toBe("true");
        expect(cells).toHaveLength(3);
        expect(cells.every((cell) => cell.classList.contains(DIFF_CELL_CLASS))).toBe(true);
        expect(words(cells[0]!).removed).toContain("theme");
        expect(words(cells[0]!).added).toContain("palette");
        expect(words(cells[1]!).removed).toContain("dark");
        expect(words(cells[1]!).added).toContain("light");
        expect(words(cells[2]!).removed).toContain("Platform");
        expect(words(cells[2]!).added).toContain("Runtime");
    });

    it("highlights only the changed column across rows", () => {
        const root = render(table);

        const res = decorate(root, [
            { startLine: 3, endLine: 3, kind: "modified", originalText: "| theme | dark |" },
            { startLine: 4, endLine: 4, kind: "modified", originalText: "| retries | 1 |" },
        ]);

        expect(res.decorated).toBe(2);

        const marked = Array.from(root.querySelectorAll("tbody tr"), (row) =>
            Array.from(row.querySelectorAll("td"), (cell) =>
                cell.classList.contains(DIFF_CELL_CLASS),
            ),
        );

        expect(marked).toEqual([
            [false, true],
            [false, true],
            [false, false],
        ]);
    });

    it("shows nothing when every cell of the hunk's row is unchanged", () => {
        const root = render(table);

        // originalText matches the live row exactly, so no rendered cell changed
        // and the line hunk must not leave a phantom amber row wash.
        const res = decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | light |",
            },
        ]);

        expect(res.decorated).toBe(0);

        const row = Array.from(root.querySelectorAll("table"))
            .at(-1)!
            .querySelector("tbody tr") as HTMLElement;

        expect(row.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        expect(row.dataset.diffCells).toBeUndefined();
        expect(row.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
        expect(root.querySelector(".emr-diff-before-control")).toBeNull();
    });
});

describe("rows that can't be diffed cell by cell", () => {
    it("marks the whole row and explains that the previous row is unavailable", () => {
        const root = render(table);

        // Without originalText we can't tell which cell changed → whole row.
        const res = decorate(root, [{ startLine: 3, endLine: 3, kind: "modified" }]);

        expect(res.decorated).toBe(1);
        const rows = Array.from(root.querySelectorAll("tbody tr"));

        const marked = rows.filter((tr) => tr.classList.contains(DIFF_BLOCK_CLASS));

        expect(marked).toHaveLength(1);
        expect(marked[0]!.textContent).toContain("theme");
        const markedRow = marked[0] as HTMLElement;
        expect(markedRow.dataset.diffCells).toBeUndefined();
        expectPreciseAmber(
            markedRow,
            "Previous content unavailable; exact comparison cannot be shown",
        );
        expect(rows[1]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
        expect(rows[2]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });

    it("shows a previous row that was not a table row as text in Before", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "Original row unavailable as structured Markdown",
            },
        ]);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;

        trigger.click();

        const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;

        expect(panel.querySelector("table")).toBeNull();
        expect(panel.textContent).toContain("Original row unavailable as structured Markdown");
    });
    it("marks each row of a multi-row hunk whose previous text is unknown", () => {
        const root = render(table);

        // The Default column changed in the theme + retries rows (lines 3-4).
        const res = decorate(root, [{ startLine: 3, endLine: 4, kind: "modified" }]);

        expect(res.decorated).toBe(2);
        const rows = Array.from(root.querySelectorAll("tbody tr"));
        expect(rows[0]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(rows[1]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
        expect(rows[2]!.classList.contains(DIFF_BLOCK_CLASS)).toBe(false);
    });

    it("marks the header row when its previous text is unknown", () => {
        const root = render(table);

        const res = decorate(root, [{ startLine: 1, endLine: 1, kind: "modified" }]);

        expect(res.decorated).toBe(1);
        const headRow = root.querySelector("thead tr")!;
        expect(headRow.classList.contains(DIFF_BLOCK_CLASS)).toBe(true);
    });

    const wide = (indent = "") =>
        lines(
            `${indent}| Option | Default | Notes |`,
            `${indent}| --- | --- | --- |`,
            `${indent}| theme | light | ok |`,
            `${indent}| retries | 3 | fine |`,
        );

    it.each([
        { name: "a previous row", current: wide(), line: 3, previous: "| colour | dark |" },
        {
            name: "a previous row with trailing spaces",
            current: wide(),
            line: 3,
            previous: "| colour | dark |  ",
        },
        {
            name: "a previous row of a table inside a list item",
            current: lines("- Settings:", "", wide("  ")),
            line: 5,
            previous: "  | colour | dark |",
        },
    ])("shows $name in Before as a table row", ({ current, line, previous }) => {
        const root = render(current);
        decorate(root, [
            { startLine: line, endLine: line, kind: "modified", originalText: previous },
        ]);

        const trigger = root.querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!;
        const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
        expect(panel.id).not.toBe("");
        expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.querySelector("thead")).toBeNull();
        expect(
            Array.from(panel.querySelectorAll("tr"), (row) =>
                Array.from(row.cells, (cell) => cell.textContent),
            ),
        ).toEqual([["colour", "dark"]]);
    });

    it.each([
        { name: "a previous row with a single cell", previous: "| colour |" },
        {
            name: "a previous row edited together with the paragraph below it",
            previous: "| colour | dark |\n\nOld note.",
        },
    ])("shows $name in Before as written", ({ previous }) => {
        const root = render(lines(wide(), "", "New note."));
        decorate(root, [{ startLine: 3, endLine: 3, kind: "modified", originalText: previous }]);

        const panel = root.querySelector<HTMLElement>(".emr-diff-before-panel")!;
        expect(panel.querySelector("table")).toBeNull();
        expect(panel.textContent).toContain("| colour");
    });

    it("offers a previous version for each separately edited row of a table", () => {
        const root = render(wide());
        decorate(root, [
            { startLine: 3, endLine: 3, kind: "modified", originalText: "| colour | dark |" },
            { startLine: 4, endLine: 4, kind: "modified", originalText: "| attempts | 5 |" },
        ]);

        const panels = Array.from(root.querySelectorAll<HTMLElement>(".emr-diff-before-panel"));
        expect(panels.map((panel) => panel.querySelector("td")?.textContent)).toEqual([
            "colour",
            "attempts",
        ]);
        expect(new Set(panels.map((panel) => panel.id)).size).toBe(2);
    });
});

// The live DOM can differ in structure from the freshly rendered original —
// e.g. another feature wrapped a cell's content — so the cell is explained as
// a structure change rather than word-diffed.
describe("cells whose rendered structure differs", () => {
    const row = (cells: string) => lines("| A | B |", "| --- | --- |", cells);

    it.each([
        {
            name: "bold added to one cell",
            original: row("| a | b |"),
            current: row("| **a** | b |"),
            shown: ["tr modified cells: ⟨Bold formatting added⟩a b"],
        },
        {
            name: "bold and italic nested the other way round",
            original: row("| **_a_** | b |"),
            current: row("| _**a**_ | b |"),
            shown: [
                "tr modified cells: ⟨Rendered structure changed from bold and italic to italic and bold⟩a b",
            ],
        },
        {
            name: "strikethrough, bold and italic nested in a new order",
            original: row("| ~~**_a_**~~ | b |"),
            current: row("| **_~~a~~_** | b |"),
            shown: [
                "tr modified cells: ⟨Rendered structure changed from strikethrough, bold and italic to bold, italic and strikethrough⟩a b",
            ],
        },
        {
            name: "a link whose title alone changed",
            original: row('| [x](u "Old tip") | b |'),
            current: row('| [x](u "New tip") | b |'),
            shown: ["tr modified cells: ⟨Link title changed from Old tip to New tip⟩x b"],
        },
        {
            name: "a link that gained a title",
            original: row("| [x](u) | b |"),
            current: row('| [x](u "New tip") | b |'),
            shown: ["tr modified cells: ⟨Link title changed from none to New tip⟩x b"],
        },
        {
            name: "a link that lost its title",
            original: row('| [x](u "Old tip") | b |'),
            current: row("| [x](u) | b |"),
            shown: ["tr modified cells: ⟨Link title changed from Old tip to none⟩x b"],
        },
        {
            name: "an image moved into the link beside it",
            original: row("| [x](u)![i](i.png) | b |"),
            current: row("| [x![i](i.png)](u) | b |"),
            shown: ["tr modified cells: ⟨Rendered link and image structure changed⟩x b"],
        },
        {
            name: "a second image added beside the first",
            original: row("| ![a](a.png) x | b |"),
            current: row("| ![a](a.png)![b](b.png) x | b |"),
            shown: ["tr modified cells: ⟨Rendered image structure changed⟩ x b"],
        },
        {
            name: "a second image dropped beside the first",
            original: row("| ![a](a.png)![b](b.png) x | b |"),
            current: row("| ![a](a.png) x | b |"),
            shown: ["tr modified cells: ⟨Rendered image structure changed⟩ x b"],
        },
    ])("explains $name inside its cell", ({ original, current, shown }) => {
        expect(view(original, current)).toEqual(shown);
    });

    it("marks a cell whose link only changed its title", () => {
        const { root } = diffView(row('| [x](u "t1") | b |'), row('| [x](u "t2") | b |'));

        expect(root.querySelector("tbody td")?.classList.contains(DIFF_CELL_CLASS)).toBe(true);
    });
    it("keeps the amber cell fallback for equal text in a different structure", () => {
        const root = render(table);
        const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
        const wrapper = document.createElement("span");
        wrapper.title = "custom semantic wrapper";
        wrapContents(cell, wrapper);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | light |",
            },
        ]);
        expect(cell.classList.contains(DIFF_CELL_CLASS)).toBe(true);
        expect(cell.classList.contains(DIFF_CELL_INLINE_CLASS)).toBe(false);
        expect(cell.querySelector(`.${DIFF_FORMAT_CLASS}`)).toBeNull();
        expectPreciseAmber(cell, "Rendered structure changed from plain text to span");
    });

    it("restores existing tooltip and focus metadata after clearing diffs", () => {
        const root = render(table);
        const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
        cell.title = "Existing native detail";
        cell.setAttribute("aria-description", "Existing accessible detail");
        cell.tabIndex = -1;
        wrapContents(cell, document.createElement("span"));
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | light |",
            },
        ]);
        expect(cell.hasAttribute("title")).toBe(false);
        expect(cell.getAttribute("aria-description")).toBe(
            "Rendered structure changed from plain text to span",
        );
        expect(cell.tabIndex).toBe(-1);
        decorate(root, []);
        expect(cell.title).toBe("Existing native detail");
        expect(cell.getAttribute("aria-description")).toBe("Existing accessible detail");
        expect(cell.tabIndex).toBe(-1);
    });

    // eslint-disable-next-line vitest/expect-expect -- asserts through the expectPreciseAmber helper
    it("describes multiple unsupported rendered structures", () => {
        const root = render(table);
        const cell = root.querySelector<HTMLElement>("tbody td:nth-child(2)")!;
        const wrapper = wrapContents(cell, document.createElement("span"));
        wrapper.appendChild(document.createElement("img"));
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | light |",
            },
        ]);
        expectPreciseAmber(cell, "Rendered structure changed from plain text to span and image");
    });
});

describe("clearing cell highlights", () => {
    it("removes cell highlights when changes are hidden", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | dark |",
            },
        ]);
        expect(root.querySelector(`.${DIFF_CELL_CLASS}`)).not.toBeNull();
        // Re-decorating with no ranges must wipe the earlier cell marks.
        decorate(root, []);
        expect(root.querySelector(`.${DIFF_CELL_CLASS}`)).toBeNull();
        const row = root.querySelector("tbody tr") as HTMLElement;
        expect(row.dataset.diffCells).toBeUndefined();
    });

    it("removes restored deleted cells when changes are hidden", () => {
        const root = render(table);
        decorate(root, [
            {
                startLine: 3,
                endLine: 3,
                kind: "modified",
                originalText: "| theme | legacy | light |",
            },
        ]);
        expect(root.querySelector(`.${DIFF_CELL_REMOVED_CLASS}`)).not.toBeNull();
        decorate(root, []);
        expect(root.querySelector(`.${DIFF_CELL_REMOVED_CLASS}`)).toBeNull();
        expect(root.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
    });
});
