// Markdown rendering pipeline.
//
// unified + remark/rehype convert Markdown to HTML. A small rehype plugin
// stamps `data-source-line` / `data-source-end-line` on every element — the
// foundation of comment anchoring, mapping any rendered DOM node back to a
// source line in the active commit (what ADO PR comment threads anchor on).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Element, ElementContent } from "hast";

import { parseMentionUrl, preprocessUserMentions } from "../comments/mentions";
import { rehypeSanitizeUrls } from "./sanitize-urls";
import { extractHastText } from "./hast-text";
import { preprocessMermaidBlocks, rehypeMermaidPlaceholder } from "./mermaid";
import { remarkEmoji } from "./emoji";
import { extractFrontmatter, renderFrontmatterHtml } from "./frontmatter";
import { rehypeSafeHtml } from "./safeHtml";

const remarkCodeMetadata: Plugin = () => {
  return (tree) => {
    visit(tree, "code", (node) => {
      const code = node as unknown as {
        meta?: string | null;
        data?: { hProperties?: Record<string, unknown> };
      };
      const meta = code.meta?.trim();
      if (!meta) return;
      const data = (code.data ??= {});
      const properties = (data.hProperties ??= {});
      properties["dataCodeMeta"] = meta;
    });
  };
};

/**
 * Copy each node's source line range from its `position` (set by remark) onto
 * `data-source-line` / `data-source-end-line`. Inline elements are tagged too
 * for the widest anchoring surface.
 */
const rehypeSourcePositions: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      const position = node.position;
      if (!position) return;
      const properties = (node.properties ??= {});
      properties["dataSourceLine"] = position.start.line;
      properties["dataSourceEndLine"] = position.end.line;
    });
  };
};

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
const rehypeMentions: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      /* v8 ignore next -- markdown links always carry a string href; guard is defensive */
      if (typeof href !== "string") return;
      const parsed = parseMentionUrl(href);
      if (!parsed) return;

      const props = (node.properties ??= {});
      const navigable =
        parsed.kind === "workitem" || parsed.kind === "pullrequest";

      if (navigable) {
        // Keep the anchor as a real link; href stays `mention://` (allowlisted
        // by sanitize-urls) until the runtime hydrator upgrades it.
        props.target = "_blank";
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
        const stateColor = parsed.params["stateColor"];
        const dotClass = ["emr-mention-state-dot"];
        if (parsed.kind === "pullrequest") {
          const status = parsed.params["status"];
          if (status) dotClass.push(`emr-pr-state-${status}`);
        }
        const safeColor = stateColor ? sanitizeCssColor(stateColor) : null;
        const dot: ElementContent = {
          type: "element",
          tagName: "span",
          properties: {
            className: dotClass,
            ariaHidden: "true",
            ...(safeColor ? { style: `background:${safeColor}` } : {}),
          },
          children: [],
        };
        node.children = [dot, ...node.children];
      }
    });
  };
};

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

function stripAlertMarker(node: Element): string | null {
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index]!;
    if (child.type === "text") {
      const match = ALERT_RE.exec(child.value);
      if (!match) return null;
      child.value = child.value.slice(match[0].length);
      if (child.value.length === 0) node.children.splice(index, 1);
      return match[1]!.toLowerCase();
    }
    return stripAlertMarker(child as Element);
  }
  return null;
}

const rehypeAlerts: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "blockquote") return;
      const first = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "p",
      );
      if (!first) return;
      const kind = stripAlertMarker(first);
      if (!kind) return;
      const properties = (node.properties ??= {});
      properties.className = ["markdown-alert", `markdown-alert-${kind}`];
      properties.dataAlertKind = kind;
      const title: Element = {
        type: "element",
        tagName: "p",
        properties: { className: ["markdown-alert-title"] },
        children: [
          { type: "text", value: kind[0]!.toUpperCase() + kind.slice(1) },
        ],
      };
      node.children.unshift(title);
    });
  };
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
  if (!/^[0-9a-fA-F]+$/.test(value)) return null;
  if (![3, 4, 6, 8].includes(value.length)) return null;
  return `#${value.toLowerCase()}`;
}

/**
 * Slug a heading's text content for use as an anchor / DOM id. Strips
 * HTML, lowercases, collapses non-alphanumerics to single dashes.
 */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

const HEADING_RE = /^h([1-6])$/;

/**
 * Wrap each heading and its following content in a `<section class="emr-section">`
 * so the body can be folded by toggling `data-collapsed`. Sections nest by
 * heading level. Each section carries `data-section-id` (a stable slug used as
 * the collapse-persistence key and deep-link fragment) and `data-section-level`;
 * the heading keeps a matching `id` for DocNav and anchor jumps.
 */
const rehypeCollapsibleSections: Plugin<[], Root> = () => {
  return (tree) => {
    // Slug → count, shared across the doc to disambiguate duplicate slugs.
    const seen = new Map<string, number>();

    function mintId(text: string): string {
      const baseSlug = slugify(text);
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
        const m =
          node.type === "element" ? node.tagName.match(HEADING_RE) : null;
        if (m) {
          const level = Number(m[1]!);
          // Find the next sibling heading at the same or higher level;
          // everything before it belongs inside this heading's section.
          let j = i + 1;
          while (j < nodes.length) {
            const peek = nodes[j]!;
            if (peek.type === "element") {
              const pm = peek.tagName.match(HEADING_RE);
              if (pm && Number(pm[1]!) <= level) break;
            }
            j++;
          }
          const id = mintId(extractHastText(node as Element));
          const headingProps = ((node as Element).properties ??= {});
          /* v8 ignore next -- headings parsed from markdown never pre-carry an id, so the already-set branch is unreachable */
          if (!headingProps.id) headingProps.id = id;

          const body = nodes.slice(i + 1, j);
          const sectionChildren: ElementContent[] = [
            node as ElementContent,
            ...wrapRange(body),
          ];
          out.push({
            type: "element",
            tagName: "section",
            properties: {
              className: ["emr-section", `emr-section-level-${level}`],
              dataSectionId: id,
              dataSectionLevel: String(level),
            },
            children: sectionChildren,
          });
          i = j;
        } else {
          out.push(node);
          i++;
        }
      }
      return out;
    }

    // Filter doctypes (allowed under Root but not Element) and wrap the body.
    const body = (
      tree.children as ReadonlyArray<(typeof tree.children)[number]>
    ).filter((n): n is ElementContent => n.type !== "doctype");
    tree.children = wrapRange([...body]);

    // Identify the document title: the single outermost section that wraps the
    // ENTIRE document (i.e. the doc opens with one heading and everything else
    // nests under it). Collapsing that section would fold the whole document,
    // so the chevron is pointless there — mark it so the UI suppresses the
    // collapse affordance. When there's no single top-level title (leading
    // content before the first heading, multiple top-level headings, or no
    // heading at all) nothing is marked and every section stays collapsible.
    const topElements = tree.children.filter(
      (n): n is Element => n.type === "element",
    );
    // A top-level `section` can only be one we just created (raw HTML is
    // dropped upstream), so its className is always the string[] set above.
    if (topElements.length === 1 && topElements[0]!.tagName === "section") {
      (topElements[0]!.properties!.className as string[]).push(
        "emr-section--doc-title",
      );
    }
  };
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCodeMetadata)
  .use(remarkEmoji)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeSafeHtml)
  .use(rehypeSourcePositions)
  .use(rehypeMermaidPlaceholder)
  .use(rehypeMentions)
  .use(rehypeAlerts)
  .use(rehypeCollapsibleSections)
  // Must run after every plugin that touches `href`/`src` and before
  // stringify. See `sanitize-urls.ts` for policy.
  .use(rehypeSanitizeUrls)
  .use(rehypeStringify);

/**
 * Render Markdown source to an HTML string. Safe-by-default: `remark-rehype`
 * runs with `allowDangerousHtml: false` (raw HTML dropped) and
 * `rehypeSanitizeUrls` scrubs dangerous schemes and forces
 * `rel="noopener noreferrer"` on new-context links. Insert the output via
 * `innerHTML` / `dangerouslySetInnerHTML` only.
 */
export async function renderMarkdown(md: string): Promise<string> {
  const { body, entries, sourceRange } = extractFrontmatter(md);
  const file = await processor.process(
    preprocessUserMentions(preprocessMermaidBlocks(body)),
  );
  return entries
    ? renderFrontmatterHtml(entries, sourceRange) + String(file)
    : String(file);
}

/**
 * Synchronous variant for short comment bodies and the live composer preview
 * where zero-latency keystroke feedback matters. All plugins are sync.
 */
export function renderMarkdownSync(md: string): string {
  const { body, entries, sourceRange } = extractFrontmatter(md);
  const file = processor.processSync(
    preprocessUserMentions(preprocessMermaidBlocks(body)),
  );
  return entries
    ? renderFrontmatterHtml(entries, sourceRange) + String(file)
    : String(file);
}
