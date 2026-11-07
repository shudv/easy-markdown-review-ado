import { describe, it, expect } from "vitest";
import { attachTableBeforeDisclosure } from "../src/markdown/diffDecorations/beforeDisclosure";
import { applyLinkTargetIndicators } from "../src/markdown/diffDecorations/metadata";
import {
  DIFF_CELL_REMOVED_CLASS,
  DIFF_METADATA_CLASS,
  DIFF_TABLE_COMPARISON_CLASS,
} from "../src/markdown/diffDecorations/shared";
import { diffTableRowCells } from "../src/markdown/diffDecorations/tableCells";
import { WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";

const stubRender = (md: string): string => `<p>${md}</p>`;

function tableWithRow(rowHtml: string): {
  host: HTMLElement;
  table: HTMLTableElement;
  row: HTMLTableRowElement;
} {
  const host = document.createElement("div");
  host.innerHTML = `<table><tbody><tr>${rowHtml}</tr></tbody></table>`;

  return {
    host,
    table: host.querySelector("table")!,
    row: host.querySelector("tr")!,
  };
}

describe("attachTableBeforeDisclosure", () => {
  it("leaves the table untouched when the range has no original text", () => {
    const { host, table, row } = tableWithRow("<td>a</td>");

    attachTableBeforeDisclosure(
      row,
      { start: 1, end: 1, kind: "modified" },
      stubRender,
    );

    expect(row.dataset.diffAmberMode).toBeUndefined();
    expect(table.parentElement).toBe(host);
    expect(host.querySelector(`.${DIFF_TABLE_COMPARISON_CLASS}`)).toBeNull();
    expect(host.querySelector(".emr-diff-before-control")).toBeNull();
  });
});

describe("applyLinkTargetIndicators", () => {
  it("skips a change whose index has no matching link", () => {
    const root = document.createElement("p");
    root.innerHTML = `<a href="https://new.example/">one</a>`;

    applyLinkTargetIndicators(root, [
      {
        index: 1,
        before: "https://missing.example/",
        after: "https://other.example/",
        hostChanged: true,
      },
      {
        index: 0,
        before: "https://old.example/",
        after: "https://new.example/",
        hostChanged: true,
      },
    ]);

    const indicators = root.querySelectorAll(`.${DIFF_METADATA_CLASS}`);
    expect(indicators).toHaveLength(1);
    expect(root.querySelector("a")!.nextElementSibling).toBe(indicators[0]);
  });
});

describe("diffTableRowCells", () => {
  it("renders a removed cell as a td when the row has no cells", () => {
    const { row } = tableWithRow("");

    const result = diffTableRowCells(row, "| gone |", stubRender, [
      { kind: "removed", originalIndex: 0, currentIndex: 0 },
    ]);

    expect(result).toBe("precise");
    expect(row.children).toHaveLength(1);
    const cell = row.firstElementChild!;
    expect(cell.tagName).toBe("TD");
    expect(cell.classList.contains(DIFF_CELL_REMOVED_CLASS)).toBe(true);
    expect(cell.querySelector(`.${WORD_REMOVED_CLASS}`)?.textContent).toBe(
      "gone",
    );
  });
});
