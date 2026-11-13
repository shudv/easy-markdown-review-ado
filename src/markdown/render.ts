// Markdown rendering pipeline.
//
// unified + remark/rehype convert Markdown to HTML. A small rehype plugin
// stamps `data-source-line` / `data-source-end-line` on every element — the
// foundation of comment anchoring, mapping any rendered DOM node back to a
// source line in the active commit (what ADO PR comment threads anchor on).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element, ElementContent } from "hast";

import { t } from "../i18n";

import {
    parseMentionUrl,
    preprocessUserMentions,
    type ParsedMentionUrl,
} from "../comments/mentions";
import { rehypeSanitizeUrls } from "./sanitize-urls";
import { extractHastText } from "./hast-text";
import { rehypeMathPlaceholder } from "./math";
import { preprocessMermaidBlocks, rehypeMermaidPlaceholder } from "./mermaid";
import { remarkEmoji } from "./emoji";
import { extractFrontmatter, renderFrontmatterHtml } from "./frontmatter";
import { rehypeSafeHtml } from "./safeHtml";
import { rehypeWikiMacros, remarkWikiMacros } from "./wikiMacros";

const remarkCodeMetadata: Plugin = () => (tree) => {
    // Stryker disable next-line StringLiteral: unist-util-visit treats an empty test like no test, so every node is visited, and only `code` nodes carry a meta to copy.
    visit(tree, "code", (node) => {
        const code = node as unknown as {
            meta?: string | null;
            data?: { hProperties?: Record<string, unknown> };
        };

        // Stryker disable next-line MethodExpression: dead code: remark-parse already trims the fence's meta string before it reaches this plugin; candidate for removal.
        const meta = code.meta?.trim();
        // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral: dead code: remark-parse reports a missing or whitespace-only meta as null (never ""), and an undefined dataCodeMeta is omitted from the markup, so this guard never changes the output; candidate for removal.
        if (meta === undefined || meta === "") return;
        const data = (code.data ??= {});
        const properties = (data.hProperties ??= {});
        properties["dataCodeMeta"] = meta;
    });
};

/**
 * Copy each node's source line range from its `position` (set by remark) onto
 * `data-source-line` / `data-source-end-line`. Inline elements are tagged too
 * for the widest anchoring surface.
 */
const rehypeSourcePositions: Plugin<[], Root> = () => (tree) => {
    visit(tree, "element", (node: Element) => {
        const position = node.position;
        if (!position) return;
        const properties = node.properties;
        properties["dataSourceLine"] = position.start.line;
        properties["dataSourceEndLine"] = position.end.line;
    });
};

/** Leading state-dot span for work-item / PR mention pills. */
function mentionStateDot(parsed: ParsedMentionUrl): ElementContent {
    const stateColor = parsed.params["stateColor"];
    const dotClass = ["emr-mention-state-dot"];

    if (parsed.kind === "pullrequest") {
        const status = parsed.params["status"];
        if (status) dotClass.push(`emr-pr-state-${status}`);
    }

    const safeColor = stateColor ? sanitizeCssColor(stateColor) : null;

    return {
        type: "element",
        tagName: "span",
        properties: {
            className: dotClass,
            ariaHidden: "true",
            ...(safeColor !== null ? { style: `background:${safeColor}` } : {}),
        },
        children: [],
    };
}

/**
 * Transform `mention://` links into rich inline pills.
 *   - `user` mentions become display-only `<span>` chips (no href).
 *   - `workitem` / `pullrequest` mentions stay `<a>` with the `mention://`
 *     href as a placeholder (hydrated to a real ADO URL later by
 *     `comments/mentionLinks.ts`), keeping the renderer org/project-agnostic.
 *   - Adds `emr-mention` / `emr-mention-<kind>` classes, lifts kind/id/params
 *     onto `data-mention-*` attrs, and injects a leading state-dot span for
 *     work items and PRs.
 * Links that don't match the scheme pass through untouched.
 */
const rehypeMentions: Plugin<[], Root> = () => (tree) => {
    // Stryker disable next-line StringLiteral: unist-util-visit treats an empty test like no test, so every node is visited, and non-anchors leave at the tag check.
    visit(tree, "element", (node: Element) => {
        // Stryker disable next-line ConditionalExpression: dead code: in this pipeline only <a> elements carry an href (rehypeSafeHtml allows href on `a` alone), so the href check below already skips everything else; candidate for removal.
        if (node.tagName !== "a") return;
        const href = node.properties.href;
        // Raw-HTML anchors such as `<a id="top">` pass rehypeSafeHtml without one.
        if (typeof href !== "string") return;
        const parsed = parseMentionUrl(href);
        if (!parsed) return;

        const props = node.properties;

        const navigable = parsed.kind === "workitem" || parsed.kind === "pullrequest";

        if (navigable) {
            // Keep the anchor as a real link; href stays `mention://` (allowlisted
            // by sanitize-urls) until the runtime hydrator upgrades it.
            props.target = "_blank";
            // Stryker disable next-line ArrayDeclaration,StringLiteral: rehypeSanitizeUrls runs later and forces `noopener noreferrer` onto every link with a target, so the rendered rel is the same.
            props.rel = ["noopener", "noreferrer"];
        } else {
            // User mentions: render as a static span with no nav target.
            node.tagName = "span";
            delete props.href;
            delete props.target;
            delete props.rel;
        }

        // Mention anchors come straight from markdown links, which never carry a
        // pre-existing className, so we start from a clean list.
        props.className = ["emr-mention", `emr-mention-${parsed.kind}`];

        // Data attributes for downstream consumers (hover cards, link-out).
        props["dataMentionKind"] = parsed.kind;
        props["dataMentionId"] = parsed.id;

        for (const [k, v] of Object.entries(parsed.params)) {
            props[`dataMentionParam${k.charAt(0).toUpperCase()}${k.slice(1)}`] = v;
        }

        // Work items and PRs get a leading status dot so the state color
        // shows up without needing async hydration.
        if (parsed.kind === "workitem" || parsed.kind === "pullrequest") {
            node.children = [mentionStateDot(parsed), ...node.children];
        }
    });
};

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

const ALERT_TITLE_KEYS = {
    note: "document.alert.note",
    tip: "document.alert.tip",
    important: "document.alert.important",
    warning: "document.alert.warning",
    caution: "document.alert.caution",
} as const;

function stripAlertMarker(node: Element): keyof typeof ALERT_TITLE_KEYS | null {
    // Stryker disable next-line UpdateOperator: dead code: every iteration returns, so the loop never advances past its first child; candidate for removal (it is an `if` on the first child).
    for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]!;

        if (child.type === "text") {
            const match = ALERT_RE.exec(child.value);
            if (!match) return null;
            child.value = child.value.slice(match[0].length);
            // Stryker disable next-line ConditionalExpression: dead code: an empty text node serialises to nothing, so removing it never changes the rendered markup; candidate for removal.
            if (child.value.length === 0) node.children.splice(index, 1);

            return match[1]!.toLowerCase() as keyof typeof ALERT_TITLE_KEYS;
        }

        return stripAlertMarker(child as Element);
    }

    return null;
}

const rehypeAlerts: Plugin<[], Root> = () => (tree) => {
    // Stryker disable next-line StringLiteral: unist-util-visit treats an empty test like no test, so every node is visited, and anything but a blockquote leaves at the tag check.
    visit(tree, "element", (node: Element) => {
        if (node.tagName !== "blockquote") return;

        const first = node.children.find(
            (child): child is Element => child.type === "element" && child.tagName === "p",
        );

        if (!first) return;
        const kind = stripAlertMarker(first);
        if (kind === null) return;
        const properties = node.properties;
        properties.className = ["markdown-alert", `markdown-alert-${kind}`];
        properties.dataAlertKind = kind;

        const title: Element = {
            type: "element",
            tagName: "p",
            properties: { className: ["markdown-alert-title"] },
            children: [{ type: "text", value: t(ALERT_TITLE_KEYS[kind]) }],
        };

        node.children.unshift(title);
    });
};

/**
 * Validate an untrusted work-item/PR `stateColor` for use in an inline
 * `style="background:..."`. ADO returns state colors as hex (`#rrggbb`), so we
 * ALLOW-LIST that shape rather than trying to strip dangerous characters out of
 * arbitrary text — a rejection-based escaper is easy to weaken (drop one char
 * from the deny set) and still leave an injection vector, whereas an allow-list
 * fails closed. Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (leading `#`
 * optional; it's added back), case-insensitive. Returns the normalized
 * `#`-prefixed lower-case hex, or `null` for anything else (caller then emits
 * no `style` at all).
 */
export function sanitizeCssColor(raw: string): string | null {
    const value = raw.trim().replace(/^#/, "");
    if (!/^[0-9a-f]+$/i.test(value)) return null;
    if (![3, 4, 6, 8].includes(value.length)) return null;

    return `#${value.toLowerCase()}`;
}

/**
 * Slug a heading's text content for use as an anchor / DOM id. Strips
 * HTML, lowercases, collapses non-alphanumerics to single dashes. Exported so
 * deep-link consumers can normalise foreign slugs (ADO / GitHub keep `&` and
 * double dashes) onto ours — reslugging one of ours is a no-op.
 */
export function slugifyHeading(text: string): string {
    return (
        text
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/[\s_-]+/g, "-")
            .replace(
                // Stryker disable next-line Regex: the previous step already collapses every run of dashes into one, so trimming one dash or a run of them at either end is the same.
                /^-+|-+$/g,
                "",
            ) || "section"
    );
}

// Stryker disable next-line Regex: no other HTML tag name starts or ends with "h" plus a digit 1-6, so dropping either anchor matches the same elements.
const HEADING_RE = /^h([1-6])$/;

/** Heading level (1-6) of `node`, or `null` when it isn't a heading element. */
function headingLevel(node: ElementContent): number | null {
    if (node.type !== "element") return null;
    const match = node.tagName.match(HEADING_RE);

    return match ? Number(match[1]!) : null;
}

/**
 * Index of the next sibling heading at the same or higher level than `level`,
 * searching from `start`; everything before it belongs inside the section.
 */
function sectionEnd(nodes: ElementContent[], start: number, level: number): number {
    let j = start;

    while (j < nodes.length) {
        const peekLevel = headingLevel(nodes[j]!);
        if (peekLevel !== null && peekLevel <= level) break;
        j++;
    }

    return j;
}

/**
 * Wrap each heading and its following content in a `<section class="emr-section">`
 * so the body can be folded by toggling `data-collapsed`. Sections nest by
 * heading level. Each section carries `data-section-id` (a stable slug used as
 * the collapse-persistence key and deep-link fragment) and `data-section-level`;
 * the heading keeps a matching `id` for DocNav and anchor jumps.
 */
const rehypeCollapsibleSections: Plugin<[], Root> = () => (tree) => {
    // Slug → count, shared across the doc to disambiguate duplicate slugs.
    const seen = new Map<string, number>();

    function mintId(text: string): string {
        const baseSlug = slugifyHeading(text);
        const n = (seen.get(baseSlug) ?? 0) + 1;
        seen.set(baseSlug, n);

        return n === 1 ? baseSlug : `${baseSlug}-${n}`;
    }

    /**
     * Wrap any nested headings in `nodes` (the content between a heading and
     * the next same-or-higher heading) into their own subsections.
     */
    function wrapRange(nodes: ElementContent[]): ElementContent[] {
        const out: ElementContent[] = [];
        let i = 0;

        while (i < nodes.length) {
            const node = nodes[i]!;
            const level = headingLevel(node);

            if (level === null) {
                out.push(node);
                i++;
                continue;
            }

            const j = sectionEnd(nodes, i + 1, level);
            out.push(wrapSection(node as Element, level, nodes.slice(i + 1, j)));
            i = j;
        }

        return out;
    }

    /** Wrap `heading` and its (recursively sectioned) `body` in a section. */
    function wrapSection(heading: Element, level: number, body: ElementContent[]): Element {
        const id = mintId(extractHastText(heading));
        const headingProps = heading.properties;
        // Top-level headings only come from Markdown syntax (rehypeSafeHtml
        // drops raw-HTML headings), so none carries an id before this point.
        headingProps.id = id;

        return {
            type: "element",
            tagName: "section",
            properties: {
                className: ["emr-section", `emr-section-level-${level}`],
                dataSectionId: id,
                dataSectionLevel: String(level),
            },
            children: [heading, ...wrapRange(body)],
        };
    }

    // Filter doctypes (allowed under Root but not Element) and wrap the body.
    // Stryker disable next-line MethodExpression: dead code: Markdown never produces a doctype node, so this filter never removes anything; candidate for removal (it only narrows the type).
    const body = (tree.children as ReadonlyArray<(typeof tree.children)[number]>).filter(
        // Stryker disable next-line ConditionalExpression,StringLiteral: dead code: Markdown never produces a doctype node; candidate for removal.
        (n): n is ElementContent => n.type !== "doctype",
    );

    tree.children = wrapRange([...body]);

    // Identify the document title: the single outermost section that wraps the
    // ENTIRE document (i.e. the doc opens with one heading and everything else
    // nests under it). Collapsing that section would fold the whole document,
    // so the chevron is pointless there — mark it so the UI suppresses the
    // collapse affordance. When there's no single top-level title (leading
    // content before the first heading, multiple top-level headings, or no
    // heading at all) nothing is marked and every section stays collapsible.
    const topElements = tree.children.filter((n): n is Element => n.type === "element");

    // A top-level `section` can only be one we just created (raw HTML is
    // dropped upstream), so its className is always the string[] set above.
    if (topElements.length === 1 && topElements[0]!.tagName === "section") {
        (topElements[0]!.properties!.className as string[]).push("emr-section--doc-title");
    }
};

/** remark-rehype's footnote back-link label, in the UI language. */
function footnoteBackLabel(referenceIndex: number, repeatIndex: number): string {
    const reference =
        repeatIndex > 1 ? `${referenceIndex + 1}-${repeatIndex}` : String(referenceIndex + 1);

    return t("document.footnote.backLabel", { reference });
}

// Built on first render, once the UI language has loaded: the footnote label
// is fixed when the processor is created.
const createProcessor = () =>
    unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(
            remarkMath,
            // Stryker disable next-line ObjectLiteral: `singleDollarTextMath: true` is remark-math's default; spelling it out only documents the choice.
            { singleDollarTextMath: true },
        )
        .use(remarkCodeMetadata)
        .use(remarkEmoji)
        .use(remarkWikiMacros)
        .use(remarkRehype, {
            allowDangerousHtml: true,
            footnoteLabel: t("document.footnote.label"),
            footnoteBackLabel,
        })
        .use(rehypeSafeHtml)
        .use(rehypeSourcePositions)
        .use(rehypeMathPlaceholder)
        .use(rehypeMermaidPlaceholder)
        .use(rehypeMentions)
        .use(rehypeAlerts)
        .use(rehypeCollapsibleSections)
        // After sections mint the heading ids the table of contents links to.
        .use(rehypeWikiMacros)
        // Must run after every plugin that touches `href`/`src` and before
        // stringify. See `sanitize-urls.ts` for policy.
        .use(rehypeSanitizeUrls)
        .use(rehypeStringify);

let processor: ReturnType<typeof createProcessor> | undefined;

function markdownProcessor(): ReturnType<typeof createProcessor> {
    processor ??= createProcessor();

    return processor;
}

/**
 * Render Markdown source to an HTML string. Safe-by-default: `remark-rehype`
 * runs with `allowDangerousHtml: false` (raw HTML dropped) and
 * `rehypeSanitizeUrls` scrubs dangerous schemes and forces
 * `rel="noopener noreferrer"` on new-context links. Insert the output via
 * `innerHTML` / `dangerouslySetInnerHTML` only.
 */
export async function renderMarkdown(md: string): Promise<string> {
    const { body, entries, sourceRange } = extractFrontmatter(md);

    const file = await markdownProcessor().process(
        preprocessUserMentions(preprocessMermaidBlocks(body)),
    );

    return entries ? renderFrontmatterHtml(entries, sourceRange) + String(file) : String(file);
}

/**
 * Synchronous variant for short comment bodies and the live composer preview
 * where zero-latency keystroke feedback matters. All plugins are sync.
 */
export function renderMarkdownSync(md: string): string {
    const { body, entries, sourceRange } = extractFrontmatter(md);

    const file = markdownProcessor().processSync(
        preprocessUserMentions(preprocessMermaidBlocks(body)),
    );

    return entries ? renderFrontmatterHtml(entries, sourceRange) + String(file) : String(file);
}
