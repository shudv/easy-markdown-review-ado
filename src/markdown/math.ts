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
    const classes = element.properties.className;

    // Stryker disable next-line ArrayDeclaration: any fallback list without a math class makes the caller skip the element, exactly as an empty list does.
    return Array.isArray(classes) ? classes.map(String) : [];
}

function sourceProperties(element: Element): Record<string, unknown> {
    return {
        ...(element.properties.dataSourceLine != null
            ? { dataSourceLine: element.properties.dataSourceLine }
            : {}),
        ...(element.properties.dataSourceEndLine != null
            ? { dataSourceEndLine: element.properties.dataSourceEndLine }
            : {}),
    };
}

function placeholder(source: string, display: boolean, sourceOwner: Element): Element {
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
            className: ["emr-math", display ? "emr-math--display" : "emr-math--inline"],
            dataMathSrc: encodeURIComponent(source),
            dataMathDisplay: display ? "true" : "false",
            ...sourceProperties(sourceOwner),
        },
        children: [fallback as ElementContent],
    };
}

export const rehypeMathPlaceholder: Plugin<[], Root> = () => (tree) => {
    // Stryker disable next-line StringLiteral: unist-util-visit treats an empty test like no test, so every node is visited, and anything but a <pre> or math <code> is left alone.
    visit(tree, "element", (node: Element, index, parent) => {
        // Stryker disable next-line ConditionalExpression,LogicalOperator: dead code: visit() over a Root only reaches descendants, which always have a parent and index; candidate for removal (it only narrows the callback types).
        /* v8 ignore next -- visit() over a Root only matches descendant elements, which always have a parent and index; this only narrows the optional callback params */
        if (index == null || !parent) return;

        if (node.tagName === "pre") {
            const code = node.children.find(
                // Stryker disable next-line LogicalOperator,ConditionalExpression: a fenced-code <pre> holds exactly one child, its <code>, and raw-HTML <pre> is dropped by rehypeSafeHtml, so a looser predicate finds the same node.
                (child): child is Element => child.type === "element" && child.tagName === "code",
            );

            if (!code) return;
            const classes = classesOf(code);

            // Stryker disable next-line StringLiteral: dead code: remark-math marks display math with both `language-math` and `math-display`, so the `math-display` check never decides anything; candidate for removal.
            if (!classes.includes("language-math") && !classes.includes("math-display")) {
                return;
            }

            const source = extractHastText(code).replace(/\n+$/g, "");
            // Empty math fences remain ordinary code blocks.
            if (!source) return;
            parent.children[index] = placeholder(source, true, node);

            return SKIP;
        }

        // Stryker disable next-line ConditionalExpression: only remark-math's inline <code> carries the `math-inline` class (rehypeSafeHtml drops it from raw HTML), so the tag check never decides anything.
        if (node.tagName === "code" && classesOf(node).includes("math-inline")) {
            const source = extractHastText(node);
            if (!source) return;
            parent.children[index] = placeholder(source, false, node);

            return SKIP;
        }
    });
};
