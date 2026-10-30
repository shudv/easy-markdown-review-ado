import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Plugin } from "unified";
import {
  DROP_HTML_SUBTREE_TAGS,
  SAFE_HTML_CLASS,
  SAFE_HTML_TAGS,
  VOID_HTML_TAGS,
} from "./safeHtmlPolicy";

type ParseNode = DefaultTreeAdapterMap["childNode"];

interface RawNode {
  type: "raw";
  value: string;
  position?: RootContent["position"];
}

type Properties = NonNullable<Element["properties"]>;
type AttributeHandler = (
  properties: Properties,
  value: string,
  tagName: string,
) => void;

const assignTo =
  (key: string): AttributeHandler =>
  (properties, value) => {
    properties[key] = value;
  };

/** Apply `handler` only when the attribute sits on a `tag` element. */
const onlyOn =
  (tag: string, handler: AttributeHandler): AttributeHandler =>
  (properties, value, tagName) => {
    if (tagName === tag) handler(properties, value, tagName);
  };

const assignDimension =
  (key: string): AttributeHandler =>
  (properties, value) => {
    if (/^\d+$/.test(value)) properties[key] = Number(value);
  };

function assignClasses(properties: Properties, value: string): void {
  const classes = value
    .split(/\s+/)
    .filter((token) => SAFE_HTML_CLASS.test(token));
  if (classes.length > 0) properties.className = classes;
}

function assignLinkTarget(properties: Properties, value: string): void {
  if (value === "_blank" || value === "_self") properties.target = value;
}

function assignLinkRel(properties: Properties, value: string): void {
  properties.rel = value.split(/\s+/).filter(Boolean);
}

function assignAriaHidden(properties: Properties, value: string): void {
  properties.ariaHidden = value === "false" ? "false" : "true";
}

function assignOpen(properties: Properties): void {
  properties.open = true;
}

/**
 * Allowlist of attributes kept on safe elements, keyed by attribute name.
 * Anything not listed (or listed for a different tag) is dropped.
 */
const ATTRIBUTE_HANDLERS: ReadonlyMap<string, AttributeHandler> = new Map([
  ["class", assignClasses],
  ["id", assignTo("id")],
  ["title", assignTo("title")],
  ["open", onlyOn("details", assignOpen)],
  ["href", onlyOn("a", assignTo("href"))],
  ["target", onlyOn("a", assignLinkTarget)],
  ["rel", onlyOn("a", assignLinkRel)],
  ["src", onlyOn("img", assignTo("src"))],
  ["alt", onlyOn("img", assignTo("alt"))],
  ["width", onlyOn("img", assignDimension("width"))],
  ["height", onlyOn("img", assignDimension("height"))],
  ["aria-hidden", assignAriaHidden],
  ["aria-label", assignTo("ariaLabel")],
  ["data-show-in-doc", onlyOn("div", assignTo("dataShowInDoc"))],
  ["data-show-in-sidebar", onlyOn("div", assignTo("dataShowInSidebar"))],
]);

function safeProperties(
  tagName: string,
  attrs: ReadonlyArray<{ name: string; value: string }>,
): Element["properties"] {
  const properties: Properties = {};
  for (const { name, value } of attrs) {
    ATTRIBUTE_HANDLERS.get(name)?.(properties, value, tagName);
  }
  return properties;
}

function convertNode(node: ParseNode): RootContent[] {
  if ("value" in node) {
    return [{ type: "text", value: node.value }];
  }
  if (!("tagName" in node)) return [];
  const tagName = node.tagName.toLowerCase();
  if (DROP_HTML_SUBTREE_TAGS.has(tagName)) return [];
  const children = node.childNodes.flatMap(convertNode);
  if (!SAFE_HTML_TAGS.has(tagName)) return children;
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
    SAFE_HTML_TAGS.has(tagName) &&
    !VOID_HTML_TAGS.has(tagName) &&
    !new RegExp(`<\\/${tagName}\\s*>`, "i").test(value)
    ? tagName
    : null;
}

interface TransformState {
  current: RootContent[];
  stack: Array<{ element: Element; parent: RootContent[] }>;
}

/** Close the innermost open container if `close` matches its tag. */
function closeContainer(
  state: TransformState,
  close: string,
  raw: RawNode,
): void {
  const active = state.stack[state.stack.length - 1];
  if (active?.element.tagName !== close) return;
  if (raw.position && active.element.position) {
    active.element.position.end = raw.position.end;
  }
  state.current = active.parent;
  state.stack.pop();
}

/**
 * Append the sanitized nodes of a raw HTML fragment; if it opens a container
 * left unclosed in the fragment, descend into it until its closing tag.
 */
function appendRawFragment(state: TransformState, raw: RawNode): void {
  const parsed = parseFragment(raw.value);
  const converted = parsed.childNodes.flatMap(convertNode);
  for (const node of converted) {
    node.position = raw.position;
    state.current.push(node);
  }
  const open = openingContainer(raw.value);
  const container = converted.find(
    (node): node is Element => node.type === "element" && node.tagName === open,
  );
  if (open && container) {
    state.stack.push({ element: container, parent: state.current });
    state.current = container.children;
  }
}

function transformChildren(children: RootContent[]): RootContent[] {
  const output: RootContent[] = [];
  const state: TransformState = { current: output, stack: [] };

  for (const child of children) {
    if (child.type === "raw") {
      const raw = child as RawNode;
      const close = closingTag(raw.value);
      if (close) closeContainer(state, close, raw);
      else appendRawFragment(state, raw);
      continue;
    }

    if (child.type === "element") {
      child.children = transformChildren(
        child.children as RootContent[],
      ) as ElementContent[];
    }
    state.current.push(child);
  }
  return output;
}

/** Parse raw HTML, retain only inert documentation markup, and drop all else. */
export const rehypeSafeHtml: Plugin<[], Root> = () => {
  return (tree) => {
    tree.children = transformChildren(tree.children);
  };
};
