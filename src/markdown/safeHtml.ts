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
type ParseParent = DefaultTreeAdapterMap["parentNode"];
type Point = NonNullable<RootContent["position"]>["start"];

interface RawNode {
    type: "raw";
    value: string;
    position?: RootContent["position"];
}

type RawFragment = Pick<RawNode, "value" | "position">;

type Properties = NonNullable<Element["properties"]>;
type AttributeHandler = (properties: Properties, value: string, tagName: string) => void;

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
    // Stryker disable next-line Regex: splitting on single spaces only adds empty tokens, which the class allowlist rejects.
    const classes = value.split(/\s+/).filter((token) => SAFE_HTML_CLASS.test(token));

    if (classes.length > 0) properties.className = classes;
}

function assignLinkTarget(properties: Properties, value: string): void {
    if (value === "_blank" || value === "_self") properties.target = value;
}

function assignLinkRel(properties: Properties, value: string): void {
    // Stryker disable next-line Regex: splitting on single spaces only adds empty tokens, which filter(Boolean) drops.
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

/** Convert a parse5 node, recording each element it creates in `created`. */
function convertNode(node: ParseNode, created: Map<ParseNode, Element>): RootContent[] {
    if ("value" in node) {
        return [{ type: "text", value: node.value }];
    }

    if (!("tagName" in node)) return [];
    const tagName = node.tagName.toLowerCase();
    if (DROP_HTML_SUBTREE_TAGS.has(tagName)) return [];
    const children = node.childNodes.flatMap((child) => convertNode(child, created));
    if (!SAFE_HTML_TAGS.has(tagName)) return children;

    const element: Element = {
        type: "element",
        tagName,
        properties: safeProperties(tagName, node.attrs),
        children: children as ElementContent[],
    };

    created.set(node, element);

    return [element];
}

function lastChild(parent: ParseParent): ParseNode | undefined {
    return parent.childNodes[parent.childNodes.length - 1];
}

/**
 * The safe elements still open where the fragment ends, outermost first: an
 * element without an end tag that is its parent's last child holds everything
 * after it (parse5 gives implied elements such as `tbody` no source location,
 * so they count as open too).
 */
function openAtEnd(fragment: ParseParent, created: Map<ParseNode, Element>): Element[] {
    const open: Element[] = [];
    let node = lastChild(fragment);

    while (
        node !== undefined &&
        "tagName" in node &&
        node.sourceCodeLocation?.endTag === undefined &&
        !VOID_HTML_TAGS.has(node.tagName)
    ) {
        const element = created.get(node);
        if (element !== undefined) open.push(element);
        node = lastChild(node);
    }

    return open;
}

/**
 * Leading closing tag of a raw value, optionally preceded by comments.
 * Group 1 runs through the tag's `>`, group 2 is its name; the whole match
 * also takes the whitespace that follows.
 */
const LEADING_CLOSING_TAG = /^(\s*(?:<!--(?:(?!-->)[\s\S])*-->\s*)*<\/([a-z][a-z0-9-]*)\s*>)\s*/i;

/**
 * The point reached after `text`, which starts at `start`. Only the line is
 * dependable (block containers strip prefixes such as `> ` from the value),
 * so no offset is reported.
 */
function pointAfter(start: Point, text: string): Point {
    const lines = text.split("\n");
    const last = lines[lines.length - 1]!;

    return {
        line: start.line + lines.length - 1,
        column: lines.length === 1 ? start.column + text.length : last.length + 1,
    };
}

interface OpenContainer {
    element: Element;
    parent: RootContent[];
}

interface TransformState {
    current: RootContent[];
    stack: OpenContainer[];
}

function lastOpenIndex(stack: readonly OpenContainer[], tagName: string): number {
    let index = stack.length - 1;
    while (index >= 0 && stack[index]!.element.tagName !== tagName) index--;

    return index;
}

/**
 * Close the innermost open container named `close`, and every container
 * opened inside it, as a browser would; an unmatched closing tag is ignored.
 */
function closeContainer(state: TransformState, close: string, end: Point | undefined): void {
    const index = lastOpenIndex(state.stack, close);
    if (index < 0) return;

    const closed = state.stack.splice(index);
    state.current = closed[0]!.parent;

    for (const { element } of closed) {
        if (end && element.position) element.position = { start: element.position.start, end };
    }
}

/** Close the containers named by `raw`'s leading closing tags; return the rest. */
function consumeClosingTags(state: TransformState, raw: RawNode): RawFragment {
    let { value, position } = raw;

    for (
        let match = LEADING_CLOSING_TAG.exec(value);
        match !== null;
        match = LEADING_CLOSING_TAG.exec(value)
    ) {
        const [consumed, tag, name] = match as unknown as [string, string, string];
        closeContainer(state, name.toLowerCase(), position && pointAfter(position.start, tag));
        position &&= { start: pointAfter(position.start, consumed), end: position.end };
        value = value.slice(consumed.length);
    }

    return { value, position };
}

/**
 * Append the sanitized nodes of a raw HTML fragment; descend into the
 * containers it leaves open, so later Markdown lands inside them until their
 * closing tags arrive.
 */
function appendRawFragment(state: TransformState, raw: RawFragment): void {
    const parsed = parseFragment(raw.value, { sourceCodeLocationInfo: true });
    const created = new Map<ParseNode, Element>();
    const converted = parsed.childNodes.flatMap((node) => convertNode(node, created));

    for (const node of converted) {
        node.position = raw.position;
        state.current.push(node);
    }

    for (const element of openAtEnd(parsed, created)) {
        state.stack.push({ element, parent: state.current });
        state.current = element.children;
    }
}

function transformChildren(children: RootContent[]): RootContent[] {
    const output: RootContent[] = [];
    const state: TransformState = { current: output, stack: [] };

    for (const child of children) {
        if (child.type === "raw") {
            appendRawFragment(state, consumeClosingTags(state, child as RawNode));
            continue;
        }

        if (child.type === "element") {
            child.children = transformChildren(child.children as RootContent[]) as ElementContent[];
        }

        state.current.push(child);
    }

    return output;
}

/** Parse raw HTML, retain only inert documentation markup, and drop all else. */
export const rehypeSafeHtml: Plugin<[], Root> = () => (tree) => {
    tree.children = transformChildren(tree.children);
};
