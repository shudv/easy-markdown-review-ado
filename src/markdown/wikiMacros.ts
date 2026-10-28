// Azure DevOps wiki macros: `[[_TOC_]]` (a table of contents of the page's
// headings) and `[[_TOSP_]]` (a table of the page's subpages).
//
// A macro is recognised when it is a paragraph of its own — matched against
// the paragraph's raw source, because Markdown parses the underscores in
// `[[_TOC_]]` as emphasis. As in Azure DevOps the macros are case-sensitive.
//
// `remarkWikiMacros` turns a macro paragraph into an empty
// `<nav class="emr-wiki-macro">` placeholder (keeping its source position, so
// diffs and line anchors still map to the macro's line). `rehypeWikiMacros`
// fills the placeholders in once headings carry their final ids: the table of
// contents links to those ids. Subpages need a repository listing, so the
// renderer stays synchronous and pure: it emits the subpages box saying they
// aren't available, and a host that can list folders fills it in afterwards
// with `fillSubpagesMacros` (loading, then the list), so the page never waits.

import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root as MdastRoot, Paragraph } from "mdast";
import type { Element, ElementContent, Root } from "hast";

import { extractHastText } from "./hast-text";

/** A subpage of a wiki page: a document in the page's same-named folder. */
export interface WikiSubpage {
  /** Repo path of the subpage (`/Guides/Install.md`). */
  path: string;
  /** Display title (the wiki page title derived from the file name). */
  title: string;
}

type WikiMacroKind = "toc" | "tosp";

const MACROS: ReadonlyMap<string, WikiMacroKind> = new Map([
  ["[[_TOC_]]", "toc"],
  ["[[_TOSP_]]", "tosp"],
]);

const MACRO_LABELS: Readonly<Record<WikiMacroKind, string>> = {
  toc: "Contents",
  tosp: "Subpages",
};

export const remarkWikiMacros: Plugin<[], MdastRoot> = () => {
  return (tree, file) => {
    const source = String(file.value);
    visit(tree, "paragraph", (node: Paragraph) => {
      const start = node.position!.start.offset!;
      const end = node.position!.end.offset!;
      const kind = MACROS.get(source.slice(start, end).trim());
      if (!kind) return;
      node.children = [];
      node.data = {
        hName: "nav",
        hProperties: {
          className: ["emr-wiki-macro", `emr-wiki-${kind}`],
          ariaLabel: MACRO_LABELS[kind],
          dataWikiMacro: kind,
        },
      };
    });
  };
};

function element(
  tagName: string,
  className: string | null,
  children: ElementContent[],
  properties: Element["properties"] = {},
): Element {
  return {
    type: "element",
    tagName,
    properties: className
      ? { ...properties, className: [className] }
      : properties,
    children,
  };
}

function link(href: string, text: string): Element {
  return element("a", null, [{ type: "text", value: text }], { href });
}

interface TocEntry {
  level: number;
  id: string;
  text: string;
}

const HEADING_RE = /^h([1-6])$/;

function collectHeadings(tree: Root): TocEntry[] {
  const entries: TocEntry[] = [];
  visit(tree, "element", (node: Element) => {
    const match = HEADING_RE.exec(node.tagName);
    const id = node.properties.id;
    if (!match || typeof id !== "string") return;
    entries.push({ level: Number(match[1]), id, text: extractHastText(node) });
  });
  return entries;
}

/**
 * Nest headings into lists by level. A deeper heading nests under the
 * previous entry; a shallower one returns to the matching enclosing list.
 */
function tocList(entries: readonly TocEntry[]): Element {
  const root = element("ul", null, []);
  const frames: Array<{ level: number; list: Element; last: Element }> = [];
  for (const entry of entries) {
    while (
      frames.length > 0 &&
      frames[frames.length - 1]!.level > entry.level
    ) {
      frames.pop();
    }
    const item = element("li", null, [link(`#${entry.id}`, entry.text)]);
    const top = frames[frames.length - 1];
    if (top && top.level === entry.level) {
      top.list.children.push(item);
      top.last = item;
    } else if (top) {
      const nested = element("ul", null, [item]);
      top.last.children.push(nested);
      frames.push({ level: entry.level, list: nested, last: item });
    } else {
      root.children.push(item);
      frames.push({ level: entry.level, list: root, last: item });
    }
  }
  return root;
}

function note(text: string): Element {
  return element("p", "emr-wiki-macro-note", [{ type: "text", value: text }]);
}

const SUBPAGES_UNAVAILABLE = "Subpages aren't available here.";

/**
 * A repo path as an href: each segment percent-encoded, so `#`, `?` and `%`
 * in a wiki file name stay part of the path instead of starting a fragment or
 * query.
 */
function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export const rehypeWikiMacros: Plugin<[], Root> = () => {
  return (tree) => {
    const macros: Element[] = [];
    visit(tree, "element", (node: Element) => {
      if (node.properties.dataWikiMacro) macros.push(node);
    });
    if (macros.length === 0) return;
    let headings: TocEntry[] | null = null;
    for (const nav of macros) {
      const kind = nav.properties.dataWikiMacro as WikiMacroKind;
      const title = element("p", "emr-wiki-macro-title", [
        { type: "text", value: MACRO_LABELS[kind] },
      ]);
      if (kind === "toc") {
        headings ??= collectHeadings(tree);
        nav.children = [
          title,
          headings.length > 0
            ? tocList(headings)
            : note("This page has no headings."),
        ];
      } else {
        nav.children = [title, note(SUBPAGES_UNAVAILABLE)];
      }
    }
  };
};

/** What a `[[_TOSP_]]` box shows: the subpages, or why there are none yet. */
export type SubpagesState = readonly WikiSubpage[] | "loading" | "unavailable";

const SUBPAGES_SELECTOR = 'nav[data-wiki-macro="tosp"]';

const SUBPAGES_NOTES: Readonly<Record<"loading" | "unavailable", string>> = {
  loading: "Loading subpages…",
  unavailable: SUBPAGES_UNAVAILABLE,
};

/** True when rendered HTML contains a `[[_TOSP_]]` subpages box. */
export function hasSubpagesMacro(html: string): boolean {
  return html.includes('data-wiki-macro="tosp"');
}

/**
 * Rendered HTML with every `[[_TOSP_]]` box showing `state`. Parsed in an
 * inert `<template>`, so nothing in the HTML (images, media) loads. Returns
 * `html` unchanged when it has no subpages box.
 */
export function fillSubpagesMacros(html: string, state: SubpagesState): string {
  if (!hasSubpagesMacro(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const doc = template.content.ownerDocument;
  for (const nav of template.content.querySelectorAll(SUBPAGES_SELECTOR)) {
    const title = nav.querySelector(":scope > .emr-wiki-macro-title")!;
    nav.replaceChildren(title, subpagesContent(doc, state));
  }
  return template.innerHTML;
}

function subpagesContent(doc: Document, state: SubpagesState): HTMLElement {
  if (typeof state === "string" || state.length === 0) {
    const text = doc.createElement("p");
    text.className = "emr-wiki-macro-note";
    text.textContent =
      typeof state === "string"
        ? SUBPAGES_NOTES[state]
        : "This page has no subpages.";
    return text;
  }
  const list = doc.createElement("ul");
  for (const page of state) {
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", encodeRepoPath(page.path));
    anchor.textContent = page.title;
    const item = doc.createElement("li");
    item.append(anchor);
    list.append(item);
  }
  return list;
}
