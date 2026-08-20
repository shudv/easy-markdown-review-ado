// YAML frontmatter support.
//
// Markdown documents often open with a `---` fenced YAML block carrying
// metadata (title, author, tags, status…). Vanilla `remark-parse` has no
// concept of frontmatter, so left alone the leading `---` is parsed as a
// thematic break and the `key: value` lines leak into the rendered prose.
//
// Instead we lift the block out BEFORE the parser sees it and render it as an
// elegant, self-contained metadata card:
//   1. `extractFrontmatter` splits the leading `---…---` block off the source,
//      returning the parsed entries plus a body with the block replaced by
//      blank lines — preserving every downstream line number so comment
//      anchoring (`data-source-line`) still maps to the real file.
//   2. `renderFrontmatterHtml` serialises the entries into a
//      `<div class="emr-frontmatter">` definition card, escaped via
//      rehype-stringify (values are text nodes — never raw HTML).

import { unified } from "unified";
import rehypeStringify from "rehype-stringify";
import type { Element, ElementContent, Root } from "hast";

/** A single `key: value(s)` pair lifted from the frontmatter block. */
export interface FrontmatterEntry {
  key: string;
  /** One entry for a scalar; many for an inline/block YAML list. */
  values: string[];
  /**
   * 1-based source line of the entry's `key:` line. Enables per-row diff
   * highlighting — omitted when entries are built outside the parser.
   */
  startLine?: number;
  /**
   * 1-based source line of the entry's last line. Equals `startLine` for
   * scalars and inline lists; extends across a block list's item lines.
   */
  endLine?: number;
}

// Leading `---` fence … closing `---` fence, anchored to the very start of the
// document. Tolerates trailing spaces on the fences and a final EOF close. The
// newline before the closing fence is optional (`\r?\n?`) so a truly empty
// block (`---\n---`) still matches and is stripped rather than leaking into the
// rendered body.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** 1-based source line span a lifted frontmatter block occupied. */
export interface FrontmatterSourceRange {
  startLine: number;
  endLine: number;
}

/** Strip a single pair of matching surrounding quotes from a scalar value. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse a minimal, common subset of YAML used in Markdown frontmatter:
 *   - `key: value` scalars (optionally quoted)
 *   - inline flow lists `key: [a, b, c]`
 *   - block lists (`key:` then indented `- item` lines)
 * Blank lines and `#` comments are ignored. Anything unrecognised is skipped
 * rather than throwing — frontmatter is best-effort metadata, not code.
 */
function parseFrontmatter(raw: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  let current: FrontmatterEntry | null = null;

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // `raw` is the content BETWEEN the fences, so its first line is source
    // line 2 (line 1 is the opening `---`).
    const sourceLine = i + 2;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Indented `- item` continues the most recent block-list key, extending
    // that entry's source span to cover the item line.
    const listItem = /^[ \t]+-[ \t]+(.*)$/.exec(line);
    if (listItem && current) {
      const item = unquote(listItem[1]!.trim());
      if (item !== "") {
        current.values.push(item);
        current.endLine = sourceLine;
      }
      continue;
    }

    const kv = /^([^:\s][^:]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.trim();
    const rawValue = kv[2]!.trim();

    if (rawValue === "") {
      // Bare key — a block list (or empty value) may follow on later lines.
      current = { key, values: [], startLine: sourceLine, endLine: sourceLine };
      entries.push(current);
    } else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      entries.push({
        key,
        values: parseInlineList(rawValue),
        startLine: sourceLine,
        endLine: sourceLine,
      });
      current = null;
    } else {
      entries.push({
        key,
        values: [unquote(rawValue)],
        startLine: sourceLine,
        endLine: sourceLine,
      });
      current = null;
    }
  }

  return entries;
}

/** Parse an inline flow list `[a, b, c]` into its trimmed, unquoted values. */
function parseInlineList(rawValue: string): string[] {
  return rawValue
    .slice(1, -1)
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter((s) => s !== "");
}

/**
 * Parse the value list for `key` from a frontmatter source fragment (the
 * original lines of an edited block), or `null` when the key is absent. Used
 * by the diff layer to compare a metadata list against its pre-edit values so
 * only the added / removed items are highlighted.
 */
export function frontmatterValuesForKey(
  source: string,
  key: string,
): string[] | null {
  const entry = parseFrontmatter(source).find((e) => e.key === key);
  return entry ? entry.values : null;
}

/**
 * Parse the bare `- item` lines from a frontmatter source fragment (e.g. the
 * original lines of a single changed block-list item, which carry no `key:`
 * line). Returns the trimmed, unquoted item values in order. Used by the diff
 * layer to reconstruct a block list's pre-edit values when ADO's per-line diff
 * hands us only the changed item lines.
 */
export function parseFrontmatterListItems(fragment: string): string[] {
  const items: string[] = [];
  for (const line of fragment.split(/\r?\n/)) {
    const m = /^[ \t]*-[ \t]+(.*)$/.exec(line);
    if (!m) continue;
    const value = unquote(m[1]!.trim());
    if (value !== "") items.push(value);
  }
  return items;
}

/**
 * Split a leading YAML frontmatter block off `src`. Returns the parsed
 * `entries` (or `null` when there is no frontmatter) and a `body` string with
 * the block replaced by an equal number of blank lines so that every remaining
 * line keeps its original 1-based number (critical for comment anchoring).
 */
export function extractFrontmatter(src: string): {
  body: string;
  entries: FrontmatterEntry[] | null;
  sourceRange: FrontmatterSourceRange | null;
} {
  const match = FRONTMATTER_RE.exec(src);
  if (!match) return { body: src, entries: null, sourceRange: null };

  const consumed = match[0];
  /* v8 ignore next -- FRONTMATTER_RE always matches at least one newline, so `match` is never null */
  const blankLines = (consumed.match(/\r?\n/g) ?? []).length;
  const body = "\n".repeat(blankLines) + src.slice(consumed.length);
  // The block runs from line 1 through its closing fence. Drop a trailing
  // newline before counting so the EOF-close and newline-close cases agree.
  const endLine = consumed.replace(/\r?\n$/, "").split(/\r?\n/).length;
  return {
    body,
    entries: parseFrontmatter(match[1]!),
    sourceRange: { startLine: 1, endLine },
  };
}

/**
 * Flatten an entry's value list into the single string shown in its `<dd>`.
 * Lists render comma-separated (`a, b, c`) so a metadata change reads as a
 * simple inline word-diff of one line — no bespoke pill/list-diff machinery.
 */
export function frontmatterValueText(values: readonly string[]): string {
  return values.join(", ");
}

/** Assemble the frontmatter metadata card as a hast element. */
function frontmatterToHast(
  entries: FrontmatterEntry[],
  sourceRange?: FrontmatterSourceRange | null,
): Element {
  const rows: ElementContent[] = entries.map((entry) => ({
    type: "element",
    tagName: "div",
    properties: {
      className: ["emr-frontmatter-row"],
      // Stamp each row with its own source span so diff highlighting lands on
      // the individual key that changed (like a table row), not the whole card.
      ...(entry.startLine != null
        ? {
            dataSourceLine: entry.startLine,
            /* v8 ignore next -- the parser always co-sets endLine with startLine; the ?? is a type guard */
            dataSourceEndLine: entry.endLine ?? entry.startLine,
          }
        : {}),
    },
    children: [
      {
        type: "element",
        tagName: "dt",
        properties: { className: ["emr-frontmatter-key"] },
        children: [{ type: "text", value: entry.key }],
      },
      {
        type: "element",
        tagName: "dd",
        properties: { className: ["emr-frontmatter-value"] },
        children: [{ type: "text", value: frontmatterValueText(entry.values) }],
      },
    ],
  }));

  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["emr-frontmatter"],
      dataEmrFrontmatter: "true",
      // Stamp the source span so comment anchoring and diff highlighting can
      // map the card back to the frontmatter lines, exactly as every other
      // rendered block carries its position.
      ...(sourceRange
        ? {
            dataSourceLine: sourceRange.startLine,
            dataSourceEndLine: sourceRange.endLine,
          }
        : {}),
    },
    children: [
      {
        type: "element",
        tagName: "dl",
        properties: { className: ["emr-frontmatter-grid"] },
        children: rows,
      },
    ],
  };
}

// Dedicated stringifier for the standalone metadata card. Kept separate from
// the main pipeline so the card can be rendered independently and prepended to
// the article body.
const frontmatterStringifier = unified().use(rehypeStringify);

/**
 * Serialise frontmatter entries into an HTML metadata card. Returns an empty
 * string when there are no entries (an empty `---\n---` block renders nothing).
 * All values are emitted as escaped text nodes, so the output is XSS-safe.
 */
export function renderFrontmatterHtml(
  entries: FrontmatterEntry[],
  sourceRange?: FrontmatterSourceRange | null,
): string {
  if (entries.length === 0) return "";
  const root: Root = {
    type: "root",
    children: [frontmatterToHast(entries, sourceRange)],
  };
  return frontmatterStringifier.stringify(root);
}
