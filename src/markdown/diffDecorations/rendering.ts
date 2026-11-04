// Standalone rendering of original Markdown fragments and semantic comparison
// with the current rendering.

import { leadText } from "./structure";
import type { ChangeRange } from "./shared";

/**
 * Prose blocks a source-only edit can leave visually untouched. Headings are
 * excluded because the app injects anchor/section controls into them.
 */
const IDENTITY_TAGS = new Set(["P", "LI"]);

/**
 * Rendered text plus semantic structure (tags and the attributes that change
 * meaning), ignoring source-position metadata, whitespace runs and comment
 * highlight wrappers. List numbering is deliberately not part of it: an
 * ordered list numbers itself, so a renumbered item reads the same.
 */
function semanticSignature(root: Element): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (!(node instanceof Element)) {
      parts.push(node.textContent!);
      return;
    }
    const transparent = node.classList.contains("emr-highlight");
    const tag = node.tagName.toLowerCase();
    if (!transparent) {
      const attributes = [
        "href",
        "src",
        "alt",
        "title",
        "type",
        "checked",
        "width",
        "height",
        "class",
        "open",
      ]
        .filter((name) => node.hasAttribute(name))
        .map((name) => ` ${name}="${node.getAttribute(name)}"`)
        .join("");
      parts.push(`<${tag}${attributes}>`);
    }
    node.childNodes.forEach(visit);
    if (!transparent) parts.push(`</${tag}>`);
  };
  root.childNodes.forEach(visit);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * How the current block's rendering compares to its original source:
 * `identical` when a reader sees no difference; `numbering` when the only
 * difference is the start number of the ordered list this first item heads.
 */
export type RenderComparison =
  | { kind: "different" }
  | { kind: "identical" }
  | { kind: "numbering"; before: number; after: number }
  | { kind: "nesting"; before: number; after: number };

/** Render a whole Markdown source into a detached container. */
export function renderSource(
  doc: Document,
  source: string | undefined,
  renderInline: (md: string) => string,
): HTMLElement | null {
  if (!source) return null;
  const container = doc.createElement("div");
  container.innerHTML = renderInline(source);
  return container;
}

/** How many list items `item` is nested inside (0 for a top-level item). */
function listDepth(item: Element): number {
  let depth = 0;
  for (
    let parent = item.parentElement?.closest("li");
    parent;
    parent = parent.parentElement?.closest("li")
  ) {
    depth++;
  }
  return depth;
}

/**
 * The 1-based nesting levels of a list item that was indented or outdented,
 * found by locating the same item in the rendered original document; null when
 * its depth is unchanged or the original item can't be located.
 */
export function listNestingChange(
  item: HTMLElement,
  start: number,
  ranges: readonly ChangeRange[],
  originalDocument: () => HTMLElement | null,
): RenderComparison | null {
  if (item.tagName !== "LI") return null;
  const range = ranges.find(
    (candidate) =>
      candidate.kind === "modified" &&
      candidate.start <= start &&
      start <= candidate.end,
  );
  if (
    range?.originalStart == null ||
    range.originalEnd == null ||
    range.end - range.start !== range.originalEnd - range.originalStart
  ) {
    return null;
  }
  const originalLine = range.originalStart + (start - range.start);
  const original = originalDocument()?.querySelector<HTMLElement>(
    `li[data-source-line="${originalLine}"]`,
  );
  if (!original) return null;
  const before = listDepth(original) + 1;
  const after = listDepth(item) + 1;
  if (before === after) return null;
  // An item carried along by its indented parent keeps its place under it.
  const parent = item.parentElement!.closest<HTMLElement>("li");
  const originalParent = original.parentElement!.closest<HTMLElement>("li");
  if (
    parent &&
    originalParent &&
    leadText(parent).trim() === leadText(originalParent).trim()
  ) {
    return null;
  }
  return { kind: "nesting", before, after };
}

export function compareRendering(
  block: HTMLElement,
  originalMarkdown: string,
  renderInline: (md: string) => string,
): RenderComparison {
  const different: RenderComparison = { kind: "different" };
  if (!IDENTITY_TAGS.has(block.tagName)) return different;
  const scratch = renderOriginalStandalone(
    block,
    originalMarkdown,
    renderInline,
  );
  const original = scratch.querySelector(block.tagName);
  if (original == null) return different;
  // The block's structural context must match too: a quote that became a
  // paragraph, or a bulleted item that became numbered, reads differently.
  if (
    block.tagName === "LI"
      ? original.parentElement!.tagName !== block.parentElement?.tagName
      : original.parentElement !== scratch
  ) {
    return different;
  }
  if (semanticSignature(original) !== semanticSignature(block)) {
    return different;
  }
  // The first item of an ordered list sets the numbering every item shows.
  if (
    block.parentElement instanceof HTMLOListElement &&
    block.parentElement.firstElementChild === block &&
    original.parentElement instanceof HTMLOListElement &&
    original.parentElement.start !== block.parentElement.start
  ) {
    return {
      kind: "numbering",
      before: original.parentElement.start,
      after: block.parentElement.start,
    };
  }
  return { kind: "identical" };
}

/**
 * The source to render on its own for comparison with `block`. The block's
 * original lines still carry the syntax of the containers it sits in, which
 * would render differently standalone: the `>` markers of enclosing quotes
 * become an extra quote, and list-item indentation — at four or more spaces —
 * an indented code block. Both are stripped so the original renders as the
 * same kind of block the current one is.
 */
function standaloneSource(block: HTMLElement, markdown: string): string {
  let lines = markdown.split("\n");
  for (
    let quote = block.parentElement?.closest("blockquote");
    quote;
    quote = quote.parentElement?.closest("blockquote")
  ) {
    if (!lines.every((line) => line.trim() === "" || /^[ \t]*>/.test(line))) {
      break;
    }
    lines = lines.map((line) => line.replace(/^[ \t]*> ?/, ""));
  }
  return (
    block.closest("li")
      ? dedentListContent(lines, block.tagName === "PRE")
      : lines
  ).join("\n");
}

/** Strip a list item's content indentation from its lines. */
function dedentListContent(lines: readonly string[], code: boolean): string[] {
  const content = lines.filter((line) => line.trim() !== "");
  let indent = Math.min(
    ...content.map((line) => /^[ \t]*/.exec(line)![0].length),
  );
  // An indented (unfenced) code block keeps its own four-space indent.
  if (code && !/^[ \t]*(`{3,}|~{3,})/.test(content.join("\n"))) {
    indent = Math.max(0, indent - 4);
  }
  return lines.map((line) => line.slice(indent));
}

/**
 * Render `block`'s original Markdown standalone (see `standaloneSource`) and
 * return the element to look its counterpart up in. A footnote definition
 * renders nothing without a reference, so one is supplied and the footnote
 * list itself is returned.
 */
export function renderOriginalStandalone(
  block: HTMLElement,
  markdown: string,
  renderInline: (md: string) => string,
): HTMLElement {
  const scratch = block.ownerDocument.createElement("div");
  let source = standaloneSource(block, markdown);
  const footnote = block.closest("[data-footnotes]")
    ? /^\[\^([^\]\s]+)\]:/.exec(source)
    : null;
  if (footnote) source = `[^${footnote[1]}]\n\n${source}`;
  scratch.innerHTML = renderInline(source);
  return (
    (footnote && scratch.querySelector<HTMLElement>("[data-footnotes] ol")) ||
    scratch
  );
}
