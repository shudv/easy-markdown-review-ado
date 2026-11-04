// "Before" disclosures that reveal a changed block's or table's original
// rendering next to the current one.

import { splitTableRow } from "./tableAlignment";
import { renderOriginalStandalone } from "./rendering";
import {
  type ChangeRange,
  DIFF_TABLE_COMPARISON_CLASS,
  type SourceSpan,
} from "./shared";

export function attachTableBeforeDisclosure(
  row: HTMLElement,
  range: ChangeRange,
  renderInline: (md: string) => string,
): void {
  /* v8 ignore next -- decorateModifiedTableRow calls this only after reading originalRow from range.originalText; the check narrows the optional field */
  if (range.originalText == null) return;
  row.dataset.diffAmberMode = "comparison";
  const table = row.closest<HTMLTableElement>("table");
  let parent = table!.parentElement!;
  if (!parent.classList.contains(DIFF_TABLE_COMPARISON_CLASS)) {
    const wrapper = table!.ownerDocument.createElement("div");
    wrapper.className = DIFF_TABLE_COMPARISON_CLASS;
    parent.insertBefore(wrapper, table!);
    wrapper.appendChild(table!);
    parent = wrapper;
  }
  const key = `${range.start}:${range.end}`;
  if (
    Array.from(
      parent.querySelectorAll<HTMLElement>(".emr-diff-before-control"),
    ).some((control) => control.dataset.diffBeforeKey === key)
  ) {
    return;
  }

  const control = document.createElement("div");
  control.className = "emr-diff-before-control";
  control.dataset.diffBeforeKey = key;
  const { trigger, panel, content } = createBeforeToggle(
    `emr-diff-before-table-${range.start}-${range.end}`,
    "emr-diff-before-panel markdown-body",
  );
  content.appendChild(
    buildBeforeTableContent(
      range.originalText,
      renderInline,
      row.ownerDocument,
    ),
  );
  control.appendChild(trigger);
  parent.insertBefore(control, table);
  parent.insertBefore(panel, table);
}

/**
 * The "Before" trigger and its hidden panel (label + empty content), wired so
 * the trigger shows and hides the panel. Callers fill `content` and place both.
 */
function createBeforeToggle(
  panelId: string,
  panelClassName: string,
): {
  trigger: HTMLButtonElement;
  panel: HTMLDivElement;
  content: HTMLDivElement;
} {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "emr-diff-before-trigger";
  trigger.textContent = "Before";
  trigger.setAttribute("aria-label", "Show previous version");
  trigger.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div");
  panel.className = panelClassName;
  panel.id = panelId;
  panel.hidden = true;
  trigger.setAttribute("aria-controls", panel.id);
  const label = document.createElement("span");
  label.className = "emr-diff-before-label";
  label.textContent = "Before";
  const content = document.createElement("div");
  content.className = "emr-diff-before-content";
  panel.append(label, content);
  trigger.addEventListener("click", () => {
    const open = panel.hidden === true;
    panel.hidden = !open;
    trigger.textContent = open ? "Hide" : "Before";
    trigger.setAttribute(
      "aria-label",
      open ? "Hide previous version" : "Show previous version",
    );
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  return { trigger, panel, content };
}

function buildBeforeTableContent(
  markdown: string,
  renderInline: (md: string) => string,
  doc: Document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const rendered = doc.createElement("div");
  rendered.innerHTML = renderInline(markdown);
  if (rendered.querySelector("table")) {
    while (rendered.firstChild) fragment.appendChild(rendered.firstChild);
    return fragment;
  }

  const lines = markdown.split(/\r\n|\r|\n/);
  const rows = lines.map(splitTableRow);
  const columnCount = rows[0]!.length;
  const isRowFragment =
    columnCount >= 2 &&
    lines.every((line) => /^\s*\|.*\|\s*$/.test(line)) &&
    rows.every((cells) => cells.length === columnCount);
  if (!isRowFragment) {
    while (rendered.firstChild) fragment.appendChild(rendered.firstChild);
    return fragment;
  }

  const delimiter = `| ${Array(columnCount).fill("---").join(" | ")} |`;
  rendered.innerHTML = renderInline(
    [lines[0]!, delimiter, ...lines.slice(1)].join("\n"),
  );
  const table = rendered.querySelector<HTMLTableElement>("table")!;
  const headerRow = table.querySelector<HTMLTableRowElement>("thead tr")!;
  for (const header of Array.from(headerRow.querySelectorAll("th"))) {
    const cell = doc.createElement("td");
    cell.innerHTML = header.innerHTML;
    header.replaceWith(cell);
  }
  const body = table.tBodies[0] ?? table.createTBody();
  body.prepend(headerRow);
  table.tHead?.remove();
  fragment.appendChild(table);
  return fragment;
}

export function attachBlockBeforeDisclosure(
  block: HTMLElement,
  span: SourceSpan,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): void {
  block.dataset.diffAmberMode = "comparison";
  const control = document.createElement("div");
  control.className = "emr-diff-before-control emr-diff-before-control--block";
  const { trigger, panel, content } = createBeforeToggle(
    `emr-diff-before-${block.tagName.toLowerCase()}-${span.start}-${span.end}`,
    "emr-diff-before-panel emr-diff-before-panel--block markdown-body",
  );
  const scratch = renderOriginalStandalone(
    block,
    originalMarkdown,
    renderInline,
  );
  const originalBlock = scratch.querySelector<HTMLElement>(block.tagName);
  if (originalBlock) {
    if (block.tagName === "LI") {
      while (originalBlock.firstChild) {
        content.appendChild(originalBlock.firstChild);
      }
    } else {
      content.appendChild(originalBlock);
    }
  } else {
    while (scratch.firstChild) content.appendChild(scratch.firstChild);
  }
  control.appendChild(trigger);

  if (block.tagName === "LI") {
    block.prepend(panel);
    block.prepend(control);
  } else {
    block.parentElement!.insertBefore(panel, block);
    block.prepend(control);
  }
}
