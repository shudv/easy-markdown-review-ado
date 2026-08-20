import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Plugin } from "unified";

type ParseNode = DefaultTreeAdapterMap["childNode"];

interface RawNode {
  type: "raw";
  value: string;
  position?: RootContent["position"];
}

const SAFE_TAGS = new Set([
  "a",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "i",
  "img",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "small",
  "span",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const DROP_SUBTREE_TAGS = new Set([
  "iframe",
  "object",
  "script",
  "style",
  "template",
]);

const VOID_TAGS = new Set(["br", "img"]);
const SAFE_CLASS =
  /^(?:card|card-grid|docs-action|codicon(?:-[a-z0-9-]+)?|markdown-alert(?:-[a-z]+)?)$/;

function safeProperties(
  tagName: string,
  attrs: ReadonlyArray<{ name: string; value: string }>,
): Element["properties"] {
  const properties: NonNullable<Element["properties"]> = {};
  for (const { name, value } of attrs) {
    if (name === "class") {
      const classes = value
        .split(/\s+/)
        .filter((token) => SAFE_CLASS.test(token));
      if (classes.length > 0) properties.className = classes;
    } else if (name === "id" || name === "title") {
      properties[name] = value;
    } else if (tagName === "details" && name === "open") {
      properties.open = true;
    } else if (tagName === "a" && name === "href") {
      properties.href = value;
    } else if (tagName === "a" && name === "target") {
      if (value === "_blank" || value === "_self") properties.target = value;
    } else if (tagName === "a" && name === "rel") {
      properties.rel = value.split(/\s+/).filter(Boolean);
    } else if (tagName === "img" && ["src", "alt"].includes(name)) {
      properties[name] = value;
    } else if (
      tagName === "img" &&
      (name === "width" || name === "height") &&
      /^\d+$/.test(value)
    ) {
      properties[name] = Number(value);
    } else if (name === "aria-hidden") {
      properties.ariaHidden = value === "false" ? "false" : "true";
    } else if (name === "aria-label") {
      properties.ariaLabel = value;
    } else if (tagName === "div" && name === "data-show-in-doc") {
      properties.dataShowInDoc = value;
    } else if (tagName === "div" && name === "data-show-in-sidebar") {
      properties.dataShowInSidebar = value;
    }
  }
  return properties;
}

function convertNode(node: ParseNode): RootContent[] {
  if ("value" in node) {
    return [{ type: "text", value: node.value }];
  }
  if (!("tagName" in node)) return [];
  const tagName = node.tagName.toLowerCase();
  if (DROP_SUBTREE_TAGS.has(tagName)) return [];
  const children = node.childNodes.flatMap(convertNode);
  if (!SAFE_TAGS.has(tagName)) return children;
  return [
    {
      type: "element",
      tagName,
      properties: safeProperties(tagName, node.attrs),
      children: children as ElementContent[],
    },
  ];
}

function closingTag(value: string): string | null {
  return (
    /^\s*<\/([a-z][a-z0-9-]*)\s*>\s*$/i.exec(value)?.[1]?.toLowerCase() ?? null
  );
}

function openingContainer(value: string): string | null {
  const match = /^\s*<([a-z][a-z0-9-]*)(?:\s[^>]*)?>/i.exec(value);
  const tagName = match?.[1]?.toLowerCase();
  return tagName &&
    SAFE_TAGS.has(tagName) &&
    !VOID_TAGS.has(tagName) &&
    !new RegExp(`<\\/${tagName}\\s*>`, "i").test(value)
    ? tagName
    : null;
}

function transformChildren(children: RootContent[]): RootContent[] {
  const output: RootContent[] = [];
  const stack: Array<{ element: Element; parent: RootContent[] }> = [];
  let current = output;

  for (const child of children) {
    if (child.type === "raw") {
      const raw = child as RawNode;
      const close = closingTag(raw.value);
      if (close) {
        const active = stack[stack.length - 1];
        if (active?.element.tagName === close) {
          if (raw.position && active.element.position) {
            active.element.position.end = raw.position.end;
          }
          current = active.parent;
          stack.pop();
        }
        continue;
      }

      const parsed = parseFragment(raw.value);
      const converted = parsed.childNodes.flatMap(convertNode);
      for (const node of converted) {
        node.position = raw.position;
        current.push(node);
      }
      const open = openingContainer(raw.value);
      const container = converted.find(
        (node): node is Element =>
          node.type === "element" && node.tagName === open,
      );
      if (open && container) {
        stack.push({ element: container, parent: current });
        current = container.children;
      }
      continue;
    }

    if (child.type === "element") {
      child.children = transformChildren(
        child.children as RootContent[],
      ) as ElementContent[];
    }
    current.push(child);
  }
  return output;
}

/** Parse raw HTML, retain only inert documentation markup, and drop all else. */
export const rehypeSafeHtml: Plugin<[], Root> = () => {
  return (tree) => {
    tree.children = transformChildren(tree.children);
  };
};
