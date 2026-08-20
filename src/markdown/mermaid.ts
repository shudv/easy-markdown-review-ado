// Mermaid diagram support.
//
// We accept both ADO's colon fence (`:::mermaid … :::`) and the GitHub-style
// backtick fence (```` ```mermaid … ``` ````) so authoring is portable.
//   1. `preprocessMermaidBlocks` rewrites the colon fence into a backtick
//      fence before the parser sees it.
//   2. `rehypeMermaidPlaceholder` replaces each rendered mermaid code block
//      with a `<div class="emr-mermaid" data-mermaid-src="…">` placeholder.
//   3. `ArticleView` hydrates each placeholder into an SVG client-side.
// This keeps `renderMarkdown` sync and free of the heavy `mermaid` import,
// which loads lazily only when an article contains a diagram.

import type { Plugin } from "unified";
import type { Root, Element, ElementContent } from "hast";
import { visit } from "unist-util-visit";
import { extractHastText } from "./hast-text";

/**
 * Rewrite ADO-style `:::mermaid … :::` fences into GitHub-style backtick
 * fences so the parser sees one canonical form. Line-based and tolerant:
 * opening indentation is preserved; unterminated blocks are left unchanged.
 */
export function preprocessMermaidBlocks(src: string): string {
  // Bail fast on the common no-mermaid case to avoid the line split.
  if (!/^[ \t]*:{3,}\s*mermaid\b/im.test(src)) return src;

  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const open = /^([ \t]*):{3,}\s*mermaid\s*$/i.exec(line);
    if (!open) {
      out.push(line);
      i += 1;
      continue;
    }
    const indent = open[1]!;
    // Look ahead for the closing fence.
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      if (/^[ \t]*:{3,}\s*$/.test(lines[j]!)) {
        closed = true;
        break;
      }
      j += 1;
    }
    if (!closed) {
      // No close — leave the input untouched so the user sees their typo.
      out.push(line);
      i += 1;
      continue;
    }
    out.push(`${indent}\`\`\`mermaid`);
    for (let k = i + 1; k < j; k += 1) {
      out.push(lines[k]!);
    }
    out.push(`${indent}\`\`\``);
    i = j + 1;
  }
  return out.join("\n");
}

/**
 * Replace each fenced mermaid code block with a `<div class="emr-mermaid">`
 * placeholder carrying the URL-encoded source in `data-mermaid-src` and a
 * `<pre>` fallback so the raw diagram stays readable if JS hydration fails.
 */
export const rehypeMermaidPlaceholder: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre") return;
      const codeChild = node.children.find(
        (c): c is Element => c.type === "element" && c.tagName === "code",
      );
      /* v8 ignore next -- a <pre> emitted by the renderer always wraps a <code> */
      if (!codeChild) return;
      // Code fences emerge from the rehype pipeline with their className as a
      // string array (e.g. ["language-mermaid"]); a bare string never reaches
      // here, so we only need the array case.
      const cls = codeChild.properties?.className;
      const classList = Array.isArray(cls) ? cls.map(String) : [];
      if (!classList.includes("language-mermaid")) return;

      // Concatenate all text-node children to recover the diagram source.
      const source = extractHastText(codeChild).replace(/\n+$/g, "");
      if (!source) return;

      const placeholder: Element = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["emr-mermaid"],
          // encodeURIComponent so newlines/quotes survive inside the attr.
          dataMermaidSrc: encodeURIComponent(source),
          // Carry the source-line span (stamped on the original <pre> by
          // rehypeSourcePositions, which runs before us) onto the placeholder
          // so the diff decorator can tell when the diagram changed in a PR.
          /* v8 ignore start -- a parsed code fence always carries a position, so the null fallbacks are defensive */
          ...(node.properties?.dataSourceLine != null
            ? { dataSourceLine: node.properties.dataSourceLine }
            : {}),
          ...(node.properties?.dataSourceEndLine != null
            ? { dataSourceEndLine: node.properties.dataSourceEndLine }
            : {}),
          /* v8 ignore stop */
        },
        children: [
          {
            type: "element",
            tagName: "pre",
            properties: { className: ["emr-mermaid-fallback"] },
            children: [{ type: "text", value: source }],
          } as ElementContent,
        ],
      };

      // Replace the `<pre>` node with our placeholder.
      (parent as Element).children[index as number] = placeholder;
    });
  };
};
