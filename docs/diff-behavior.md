# Diff presentation contract

Easy Markdown Review chooses the smallest trustworthy rendered diff. It does
not use red/green when source lines cannot be aligned with confidence.

| Change shape                                             | Presentation                                               | Before reveal                |
| -------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| Added block, list item, or table row                     | Green wash on the added leaf                               | No                           |
| Deleted Markdown                                         | Red removed-content marker rendered as Markdown            | Built in                     |
| Small prose, heading, list, or quote text edit           | Inline red removed words and green added words             | No                           |
| Partial or multi-hunk hard-wrapped prose                 | Reconstruct the complete old block, then inline words      | No                           |
| Wholesale prose or quote rewrite                         | Amber current block                                        | Hover/focus only             |
| Bold, italic, inline-code, strike, or link wrapping      | Amber only the affected text range                         | No                           |
| Heading level or equal-text block type                   | Amber only the affected text                               | No                           |
| Ordered/bulleted list conversion                         | Amber list marker only                                     | No                           |
| Checklist state toggle                                   | Amber checkbox outline only                                | No                           |
| Code token or line edit                                  | Inline red/green tokens in the code block                  | No                           |
| Code language only                                       | Metadata indicator with old/new language                   | No                           |
| Code language plus precise body edit                     | Metadata indicator plus inline tokens                      | No                           |
| Code fence options/meta only                             | Metadata indicator with old/new options                    | No                           |
| Wholesale code rewrite                                   | Amber current code block                                   | Hover/focus only             |
| Link destination change                                  | Inline target-change indicator; hostname changes warn      | No                           |
| Image source, alt, or title change                       | Image metadata indicator                                   | No                           |
| Mermaid source edit                                      | Diagram accent plus source-modal diff when reconstructable | Source modal                 |
| Equal-width or anchored table edit                       | Changed cells only; inline words when possible             | No                           |
| Added/removed table column                               | Green/red cells in their structural positions              | No                           |
| Added/removed table row                                  | Green/red row in the existing grid                         | No                           |
| Formatting-only table cell                               | Amber only the affected text range                         | No                           |
| Unanchored, repeated, or partially replaced table schema | Amber current row/table                                    | Hover/focus only             |
| Missing original source needed for reconstruction        | Conservative amber wash                                    | Only when old content exists |
| Frontmatter                                              | Per-key value words; added keys use a small green key wash | No                           |
| Changed source with no rendered DOM owner                | Compact source strip at its document position              | Hover/focus only             |
| Deleted Markdown file                                    | Previous version, clean and read-only                      | Whole document               |
| GitHub-style admonition                                  | Semantic alert; body diffed as prose                       | No                           |

## Confidence rules

1. Reconstruct the complete old rendered block before comparing partial source
   hunks.
2. Prefer exact text, formatting, metadata, cell, marker, or checkbox leaves
   over block washes.
3. Use broad amber only for low-similarity rewrites or structural alignment
   that cannot be proven.
4. Keep Before controls out of layout. They appear on hover or keyboard focus,
   and expanded history is a compact reference strip.
5. Never infer table alignment from repeated or empty values.
6. Never silently drop a changed source range. If rendering produces no DOM
   owner (for example a reference-link definition or unknown directive), show
   a safe source-only strip instead.
7. Prose fallback washes follow rendered line boxes rather than the article
   column: single lines, contiguous list items, and a wrapped paragraph's
   incomplete final line all stop at their text edge. Structural rows, code,
   media, and low-confidence table regions keep their specialized treatment.

## Documentation dialects

Raw HTML is parsed with `parse5` and reduced to an inert allowlist of common
documentation elements, including `details`, `summary`, `kbd`, card-grid
containers, links, and images. Event handlers, styles, executable/embed tags,
unsafe classes, and unsafe URL schemes are removed. Unknown MDX wrappers are
flattened so their Markdown content remains readable; a changed wrapper with no
rendered owner uses the source-only fallback. GitHub-style `> [!NOTE]` alerts
render semantically and retain ordinary prose diff behavior.

## Amber modes

Amber has exactly two presentations:

1. **Precise amber** marks a trustworthy rendered leaf, such as formatted text,
   a heading label, list marker, checklist checkbox, or cell-local structure.
   It has
   no Before control. Hovering or focusing the amber leaf opens one custom
   tooltip that names the semantic transition. Browser-native `title` tooltips
   are suppressed while the diff is active.
2. **Comparison amber** marks a block or table region whose old and new content
   cannot be aligned precisely. It has a hover/focus-only `Before` chip and no
   precise-change tooltip. Expanded history uses a compact comparison strip.

Precise tooltip detail is bounded and domain-specific:

- formatting names the added, removed, or switched styles;
- links include the added or removed destination, truncated only in the
  callout;
- heading/block changes name the old and new rendered block types;
- list markers and checklist checkboxes name their old and new state;
- unsupported cell-local structure names the old and new rendered shapes.

## Prose and table-cell reuse

Rendered inline semantics use one shared engine in prose blocks and table
cells. It owns word changes, formatting transitions, link wrapping and target
changes, hostname warnings, image source/alt/title changes, multiple inline
objects, and combinations such as text plus image metadata or formatting plus
link metadata.

Context-specific behavior stays outside that engine:

- prose owns complete-block reconstruction, the low-similarity readability
  threshold, loose-list/blockquote prose targeting, heading/block transitions,
  list markers, and checklist state;
- tables own pipe parsing, escaped delimiters, row/cell/column alignment,
  synthetic added/removed cells, deleted rows in-grid, and ambiguous table
  Before panels.

When a list marker and checklist state change together, both leaves remain visually
marked but the item exposes one combined callout.
