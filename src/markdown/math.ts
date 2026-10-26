// KaTeX placeholder generation.
//
// `remark-math` identifies inline `$...$`, display `$$...$$`, and fenced
// `math` blocks. This rehype step replaces their code-shaped HAST with inert
// placeholders so the heavy KaTeX renderer and fonts load only on pages that
// actually contain equations.

import type { Element, ElementContent, Root } from "hast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";

import { extractHastText } from "./hast-text";

function classesOf(element: Element): string[] {
  const classes = element.properties?.className;
  return Array.isArray(classes) ? classes.map(String) : [];
}

function sourceProperties(element: Element): Record<string, unknown> {
  return {
    /* v8 ignore next -- parsed math nodes always carry source positions */
    ...(element.properties?.dataSourceLine != null
      ? { dataSourceLine: element.properties.dataSourceLine }
      : {}),
    /* v8 ignore next -- parsed math nodes always carry source positions */
    ...(element.properties?.dataSourceEndLine != null
      ? { dataSourceEndLine: element.properties.dataSourceEndLine }
      : {}),
  };
}

function placeholder(
  source: string,
  display: boolean,
  sourceOwner: Element,
): Element {
  const fallback: Element = display
    ? {
        type: "element",
        tagName: "pre",
        properties: { className: ["emr-math-fallback"] },
        children: [
          {
            type: "element",
            tagName: "code",
            properties: {},
            children: [{ type: "text", value: source }],
          },
        ],
      }
    : {
        type: "element",
        tagName: "code",
        properties: { className: ["emr-math-fallback"] },
        children: [{ type: "text", value: source }],
      };

  return {
    type: "element",
    tagName: display ? "div" : "span",
    properties: {
      className: [
        "emr-math",
        display ? "emr-math--display" : "emr-math--inline",
      ],
      dataMathSrc: encodeURIComponent(source),
      dataMathDisplay: display ? "true" : "false",
      ...sourceProperties(sourceOwner),
    },
    children: [fallback as ElementContent],
  };
}

export const rehypeMathPlaceholder: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element, index, parent) => {
      /* v8 ignore next -- element visitors always receive an indexed parent */
      if (index == null || !parent) return;

      if (node.tagName === "pre") {
        const code = node.children.find(
          (child): child is Element =>
            child.type === "element" && child.tagName === "code",
        );
        /* v8 ignore next -- remark-rehype always wraps fenced code in `<code>` */
        if (!code) return;
        const classes = classesOf(code);
        if (
          !classes.includes("language-math") &&
          !classes.includes("math-display")
        ) {
          return;
        }
        const source = extractHastText(code).replace(/\n+$/g, "");
        /* v8 ignore next -- empty math fences remain ordinary code blocks */
        if (!source) return;
        parent.children[index] = placeholder(source, true, node);
        return SKIP;
      }

      if (node.tagName === "code" && classesOf(node).includes("math-inline")) {
        const source = extractHastText(node);
        /* v8 ignore next -- remark-math does not emit empty inline math nodes */
        if (!source) return;
        parent.children[index] = placeholder(source, false, node);
        return SKIP;
      }
    });
  };
};
