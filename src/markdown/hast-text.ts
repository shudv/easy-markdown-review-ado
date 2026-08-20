// Shared HAST text extraction, used by the heading-slug and mermaid
// placeholder steps to recover the concatenated text of a HAST element.

import type { Element } from "hast";

/**
 * Concatenate every descendant `text` node under `node` in document order.
 * Returns the empty string when there are none.
 */
export function extractHastText(node: Element): string {
  let out = "";
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      out += child.value;
    } else if (child.type === "element") {
      out += extractHastText(child);
    }
  }
  return out;
}
