// Shared harness for the rendered-diff suites (test/markdown.diff.*.test.ts):
// renders Markdown through the production pipeline, decorates it with diff
// ranges and reads back what a reviewer would see.

import { expect } from "vitest";

import { decorateDiffRanges, DIFF_TOOLTIP_CLASS } from "../src/markdown/diffDecorations";
import { refineDiffRanges } from "../src/markdown/diffRefine";
import { renderMarkdownSync } from "../src/markdown/render";
import { WORD_ADDED_CLASS, WORD_REMOVED_CLASS } from "../src/markdown/wordDiffDom";
import { sourceDiffRanges } from "../src/shell/shellHelpers";
import type { DiffRange } from "../src/types";

/** Joins source lines with `\n`. */
export const lines = (...source: string[]): string => source.join("\n");

/** A minimal stand-in for `renderMarkdownSync`: wraps text in a paragraph. */
export const stubRender = (md: string): string => `<p>${md}</p>`;

/** Renders Markdown into a detached article root, as the reader does. */
export function render(md: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";
    root.innerHTML = renderMarkdownSync(md);

    return root;
}

/**
 * Builds an article root by hand where each block carries the
 * `data-source-line` / `data-source-end-line` attributes the renderer stamps.
 */
export function makeRoot(
    blocks: Array<{ tag: string; start: number; end: number; html?: string }>,
): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-body emr-rendered";

    for (const b of blocks) {
        const el = document.createElement(b.tag);
        el.setAttribute("data-source-line", String(b.start));
        el.setAttribute("data-source-end-line", String(b.end));
        if (b.html !== undefined && b.html !== "") el.innerHTML = b.html;
        root.appendChild(el);
    }

    return root;
}

/** Decorates `root` with the production inline renderer. */
export function decorate(
    root: HTMLElement,
    ranges: DiffRange[],
    originalSource?: string,
    currentSource?: string,
) {
    return decorateDiffRanges(root, ranges, {
        renderInline: renderMarkdownSync,
        originalSource,
        currentSource,
    });
}

/** Text of all added / removed inline word marks under an element. */
export function words(el: Element): { added: string; removed: string } {
    return {
        added: Array.from(el.querySelectorAll(`.${WORD_ADDED_CLASS}`))
            .map((n) => n.textContent)
            .join(" "),
        removed: Array.from(el.querySelectorAll(`.${WORD_REMOVED_CLASS}`))
            .map((n) => n.textContent)
            .join(" "),
    };
}

/** Moves every child of `el` into `wrapper` and puts `wrapper` in their place. */
export function wrapContents<T extends HTMLElement>(el: HTMLElement, wrapper: T): T {
    wrapper.append(...Array.from(el.childNodes));
    el.appendChild(wrapper);

    return wrapper;
}

/** Asserts `element` carries an accessible, focusable amber explanation. */
export function expectPreciseAmber(element: HTMLElement, label: string): void {
    expect(element.classList.contains(DIFF_TOOLTIP_CLASS)).toBe(true);
    expect(element.dataset.diffTooltip).toBe(label);
    expect(element.dataset.diffAmberMode).toBe("explained");
    expect(element.getAttribute("aria-description")).toBe(label);
    expect(element.hasAttribute("title")).toBe(false);
    expect(element.tabIndex).toBe(0);
    expect(element.closest(".emr-rendered")?.querySelector(".emr-diff-before-trigger")).toBeNull();
}

/** Asserts the change is shown through a "Before" comparison, not explained inline. */
export function expectComparisonAmber(root: HTMLElement): void {
    expect(root.querySelector(".emr-diff-before-trigger")).not.toBeNull();
    expect(root.querySelector(`.${DIFF_TOOLTIP_CLASS}`)).toBeNull();
    expect(root.querySelector('[data-diff-amber-mode="comparison"]')).not.toBeNull();
}

/** The rendered `<dd>` value cell for a frontmatter key. */
export function frontmatterValue(root: HTMLElement, key: string): HTMLElement {
    const row = Array.from(root.querySelectorAll<HTMLElement>(".emr-frontmatter-row")).find(
        (r) => r.querySelector(".emr-frontmatter-key")?.textContent.trim() === key,
    );

    if (!row) throw new Error(`no frontmatter row for key "${key}"`);

    return row.querySelector<HTMLElement>(".emr-frontmatter-value")!;
}

// ---------------------------------------------------------------------------
// End-to-end view: original + current source through the production line
// diff, block refinement, rendering and decoration, read back one line per
// decorated block or marker:
//
//   `p modified inline: The quick {+brown +}fox.`
//
// `{+…+}` is an added run, `[-…-]` a removed run, `⟨…⟩` a precise amber
// explanation, `wash` a whole-block tint and `Before` a previous-version
// disclosure. Undecorated blocks are omitted, so an empty list means the edit
// is (correctly) invisible.
// ---------------------------------------------------------------------------

/** Annotation for a diff-mark element, or `null` when `node` isn't one. */
function diffMarkText(node: HTMLElement): string | null {
    const cls = node.classList;

    if (cls.contains("emr-diff-before-panel") || cls.contains("emr-diff-metadata-panel")) {
        return "";
    }

    if (cls.contains("emr-diff-before-control")) return "Before ";

    if (cls.contains("emr-diff-metadata")) {
        const trigger = node.querySelector(".emr-diff-metadata-trigger")!;

        return ` ⟨${trigger.getAttribute("aria-label") ?? trigger.textContent}⟩`;
    }

    if (cls.contains("emr-word-added")) return `{+${node.textContent}+}`;
    if (cls.contains("emr-word-removed")) return `[-${node.textContent}-]`;

    return null;
}

/** Whether an optional dataset value is present and non-empty. */
function hasText(value: string | undefined): value is string {
    return value !== undefined && value !== "";
}

/** Whether `node` is a nested block summarized on its own line. */
function isNestedBlock(node: HTMLElement): boolean {
    if (node.dataset.summarized === "self") return false;
    if (hasText(node.dataset.diffKind)) return true;

    return (
        ["UL", "OL", "TABLE", "PRE"].includes(node.tagName) && node.hasAttribute("data-source-line")
    );
}

/** Text of `node` with diff marks annotated and nested blocks left out. */
function annotate(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const mark = diffMarkText(node);
    if (mark !== null) return mark;
    if (isNestedBlock(node)) return "";
    const inner = Array.from(node.childNodes).map(annotate).join("");
    const tip = node.dataset.diffTooltip;

    return hasText(tip) && node.dataset.summarized !== "self" ? `⟨${tip}⟩${inner}` : inner;
}

/** One line per decorated block or marker under `root`, in document order. */
export function summarize(root: HTMLElement): string[] {
    const out: string[] = [];

    const walk = (el: Element): void => {
        if (!(el instanceof HTMLElement)) return;

        if (el.classList.contains("emr-diff-deleted-marker")) {
            out.push(`deleted: ${el.getAttribute("aria-label")}`);

            return;
        }

        if (el.classList.contains("emr-diff-source-only")) {
            out.push("source-only");

            return;
        }

        if (hasText(el.dataset.diffKind)) {
            el.dataset.summarized = "self";

            const flags = [
                el.dataset.diffInline === "true" ? "inline" : "",
                el.dataset.diffCells === "true" ? "cells" : "",
                el.dataset.diffLineWash === "true" ? "wash" : "",
            ].filter(Boolean);

            const tip = hasText(el.dataset.diffTooltip) ? ` ⟨${el.dataset.diffTooltip}⟩` : "";

            const text = annotate(el).replace(/\s+/g, " ").trim();
            delete el.dataset.summarized;
            out.push(
                `${el.tagName.toLowerCase()} ${[el.dataset.diffKind, ...flags].join(" ")}${tip}: ${text}`,
            );
        }

        Array.from(el.children).forEach(walk);
    };

    Array.from(root.children).forEach(walk);

    return out;
}

/** Diffs `original` → `current` end to end and returns the decorated article. */
export function diffView(original: string, current: string) {
    const ranges = refineDiffRanges(sourceDiffRanges(original, current), original, current);
    const root = render(current);
    const result = decorate(root, ranges, original, current);

    return { view: summarize(root), result, root };
}

/** What a reviewer sees for `original` → `current`, one line per change. */
export const view = (original: string, current: string): string[] =>
    diffView(original, current).view;
