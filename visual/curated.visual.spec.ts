// Curated visual-regression suite.
//
// Screenshots a small, high-signal set of DETERMINISTIC Storybook stories and
// compares them against committed per-platform baselines (see
// playwright.visual.config.ts for the cross-platform rationale and tolerances).
//
// The curated core is two rich INTEGRATION stories fed fake fixtures — the PR
// tab (`Visual/PrTab`, exercising the reader + diff highlighting + comment rail)
// and the Documents hub (`Visual/DocumentsHub`, exercising the navigator +
// reader + rail). Between them they cover Markdown rendering, the diff wash
// layer, comment balloons, and the rail chrome, so a CSS/layout regression in
// any of those shows up as a pixel diff.
//
// To add a shot: author a deterministic `*.visual.stories.tsx` story (no time,
// no animation) and add a `{ title, name }` entry below. Mermaid is hidden
// inside article renders because integration shots don't wait for it; a story
// that blocks on the diagram (see `Visual/GeneratedSource`) may capture it.

import { expect, test, type Locator, type Page } from "@playwright/test";

interface Shot {
  /** Storybook `title` (CSF meta title). */
  title: string;
  /** Story export display name. */
  name: string;
  /**
   * Selector(s) that must be present before the frame is considered settled.
   * A comma-separated list means EACH selector must be visible (all are waited
   * for independently), e.g. `.emr-diff-block, .emr-highlight`. Use a
   * descendant combinator (space) for a single compound selector.
   */
  settledSelector: string;
  /**
   * Optional — screenshot only this element instead of the whole story root.
   * FOCUSED shots crop tight to a single control (e.g. a toolbar) so a small
   * change (an icon, a badge) is a large fraction of the frame and can't hide
   * under the whole-page `maxDiffPixelRatio`. The selector must resolve to
   * exactly one element in the story.
   */
  clip?: string;
  /** Optional element to hover with Playwright's real pointer before capture. */
  hover?: string;
  /**
   * What must become visible after hovering. Defaults to the Before control;
   * `heading-link` waits for the hovered heading's link button to reveal.
   */
  hoverEffect?: "before" | "tooltip" | "heading-link";
}

const SHOTS: Shot[] = [
  {
    title: "Visual/PrTab",
    name: "Default",
    // Diff decorated + a comment highlight wrapped = the reader has settled.
    settledSelector: ".emr-diff-block, .emr-highlight",
  },
  {
    title: "Visual/PrTab",
    name: "Dark",
    settledSelector: ".emr-diff-block, .emr-highlight",
  },
  {
    title: "Visual/PrTab",
    name: "Comment Anchor Diff Collision",
    settledSelector:
      ".emr-diff-block, .emr-highlight.is-active, .emr-section-toggle",
  },
  {
    title: "Visual/PrTab",
    name: "Comment Anchor Diff Collision Dark",
    settledSelector:
      ".emr-diff-block, .emr-highlight.is-active, .emr-section-toggle",
  },
  {
    title: "Visual/PrTab",
    name: "Comment Anchor Diff Collision High Contrast Light",
    settledSelector:
      ".emr-diff-block, .emr-highlight.is-active, .emr-section-toggle",
  },
  {
    title: "Visual/PrTab",
    name: "Comment Anchor Diff Collision High Contrast Dark",
    settledSelector:
      ".emr-diff-block, .emr-highlight.is-active, .emr-section-toggle",
  },
  {
    title: "Visual/PrTab",
    name: "High Contrast Dark",
    settledSelector: ".emr-diff-block, .emr-diff-ruler",
  },
  {
    title: "Visual/PrTab",
    name: "High Contrast Dark Collapsed",
    settledSelector: ".emr-diff-block, .emr-diff-ruler",
  },
  {
    title: "Visual/DocumentsHub",
    name: "Default",
    settledSelector: ".markdown-body .emr-highlight",
  },
  {
    title: "Visual/DocumentsHub",
    name: "High Contrast Dark",
    settledSelector: ".markdown-body .emr-highlight",
  },
  {
    title: "Visual/DocumentsHub",
    name: "No Completed Pull Request",
    settledSelector: ".markdown-body, .emr-app.is-comments-hidden",
  },
  {
    // Diff-highlighting layer in isolation (light + dark): add wash, inline
    // word-diff, deleted-marker.
    title: "Visual/ArticleDiff",
    name: "Light",
    settledSelector: ".emr-word-added",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Dark",
    settledSelector: ".emr-word-added",
  },
  {
    // Side-by-side audit of all broad-wash reductions: prose lines, wrapped
    // final lines, contiguous items, code rewrites, and source-only strips.
    // The ambiguous table remains broad in both panes by design.
    title: "Visual/ArticleDiff",
    name: "Minimal Diff Comparison Shot",
    settledSelector:
      ".minimal-diff-comparison .emr-diff-line-wash, .minimal-diff-comparison .emr-diff-source-only",
    clip: ".minimal-diff-comparison",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Media Diff Light",
    settledSelector: ".emr-diff-image",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Media Diff Dark",
    settledSelector: ".emr-diff-image",
  },
  {
    // Dedicated table-diff matrix: structural columns/rows, inline cells,
    // amber fallback, rich links, and an open top-layer metadata callout.
    title: "Visual/ArticleDiff",
    name: "Table Gallery Light",
    settledSelector:
      ".emr-diff-cell--added, tr.emr-diff-deleted-table-row, .emr-diff-before-panel, .emr-diff-metadata-panel:popover-open",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Table Gallery Dark",
    settledSelector:
      ".emr-diff-cell--added, tr.emr-diff-deleted-table-row, .emr-diff-before-panel, .emr-diff-metadata-panel:popover-open",
  },
  {
    // Confidence matrix: header rename/swap remain precise, while repeated
    // and empty anchors show amber with expanded old-schema disclosures.
    title: "Visual/ArticleDiff",
    name: "Table Confidence Light",
    settledSelector:
      "thead .emr-word-added, .emr-diff-before-panel:not([hidden])",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Table Confidence Dark",
    settledSelector:
      "thead .emr-word-added, .emr-diff-before-panel:not([hidden])",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Formatting Precision Light",
    settledSelector:
      "p.emr-diff-block--inline .emr-diff-format-change, td.emr-diff-cell--inline .emr-diff-format-change",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Formatting Precision Dark",
    settledSelector:
      "p.emr-diff-block--inline .emr-diff-format-change, td.emr-diff-cell--inline .emr-diff-format-change",
  },
  {
    // Block confidence matrix: reconstructed partial prose stays precise;
    // wholesale/structural/formatting/code fallbacks expose rendered history.
    title: "Visual/ArticleDiff",
    name: "Block Confidence Light",
    settledSelector:
      "p.emr-diff-block--inline, .emr-diff-before-panel--block:not([hidden]), .emr-diff-before-panel pre",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Block Confidence Dark",
    settledSelector:
      "p.emr-diff-block--inline, .emr-diff-before-panel--block:not([hidden]), .emr-diff-before-panel pre",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Block Confidence Hover Light",
    settledSelector:
      "pre.emr-diff-block--inline .emr-word-added, .emr-diff-before-trigger",
    hover: "p.emr-diff-block--modified",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Block Confidence Hover Dark",
    settledSelector:
      "pre.emr-diff-block--inline .emr-word-added, .emr-diff-before-trigger",
    hover: "p.emr-diff-block--modified",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Before Chip Text Inflation",
    settledSelector: ".emr-diff-before-trigger:focus",
  },
  {
    title: "Components/ArticleViewSelection",
    name: "Full Line Selection Dark",
    settledSelector: ".emr-selection-bubble",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Precise Amber Tooltip Light",
    settledSelector:
      'a .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover: 'a .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Precise Amber Tooltip Dark",
    settledSelector:
      'a .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover: 'a .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Checklist State Tooltip Light",
    settledSelector:
      '.emr-diff-task-tooltip-anchor[data-diff-tooltip^="Checklist item changed from"]',
    hover:
      '.emr-diff-task-tooltip-anchor[data-diff-tooltip^="Checklist item changed from"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Inline Parity Light",
    settledSelector:
      'li[data-diff-tooltip^="List item changed:"], td .emr-diff-format-change, td .emr-diff-metadata',
    hover: 'li[data-diff-tooltip^="List item changed:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Inline Parity Dark",
    settledSelector:
      'li[data-diff-tooltip^="List item changed:"], td .emr-diff-format-change, td .emr-diff-metadata',
    hover: 'li[data-diff-tooltip^="List item changed:"]',
    hoverEffect: "tooltip",
  },
  {
    // New items nested inside new (and unchanged) parent items: each changed
    // item carries its own wash, and no tint stacks onto a washed child.
    title: "Visual/ArticleDiff",
    name: "Nested List Changes Light",
    settledSelector: "li li li.emr-diff-block--added",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Nested List Changes Dark",
    settledSelector: "li li li.emr-diff-block--added",
  },
  {
    // Lines added to / removed from inside existing blocks, whitespace-only
    // code edits, checklist + text, list nesting, nested quotes, CJK and
    // footnotes — every one shown in place, built by the production pipeline.
    title: "Visual/ArticleDiff",
    name: "Structural Edits Light",
    settledSelector:
      'pre .emr-word-removed, li .emr-diff-format-change[data-diff-tooltip^="List nesting changed"], pre .emr-diff-format-change, li .emr-diff-task-tooltip-anchor, [data-footnotes] .emr-word-added',
  },
  {
    title: "Visual/ArticleDiff",
    name: "Structural Edits Dark",
    settledSelector:
      'pre .emr-word-removed, li .emr-diff-format-change[data-diff-tooltip^="List nesting changed"], pre .emr-diff-format-change, li .emr-diff-task-tooltip-anchor, [data-footnotes] .emr-word-added',
  },
  {
    title: "Visual/ArticleDiff",
    name: "Production Syntax Light",
    settledSelector:
      ".emr-diff-source-only .emr-diff-before-panel:not([hidden]), details[open] .emr-word-added, .markdown-alert .emr-word-added, pre .emr-diff-metadata",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Production Syntax Dark",
    settledSelector:
      ".emr-diff-source-only .emr-diff-before-panel:not([hidden]), details[open] .emr-word-added, .markdown-alert .emr-word-added, pre .emr-diff-metadata",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Equation Gallery Light",
    settledSelector:
      '.equation-gallery-frame .emr-math[data-hydrated="true"] .katex, .equation-gallery-frame .emr-math[data-math-error="render-failed"], .equation-gallery-frame .emr-math.emr-diff-block',
    clip: ".equation-gallery-frame",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Equation Gallery Dark",
    settledSelector:
      '.equation-gallery-frame .emr-math[data-hydrated="true"] .katex, .equation-gallery-frame .emr-math[data-math-error="render-failed"], .equation-gallery-frame .emr-math.emr-diff-block',
    clip: ".equation-gallery-frame",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Equation Source Diff",
    settledSelector:
      ".emr-generated-source-code-diff .emr-word-added, .emr-generated-source-preview .katex",
    clip: ".emr-generated-source-modal",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Equation Source Before",
    settledSelector:
      '.emr-generated-source-before[aria-pressed="true"], .emr-generated-source-preview .katex',
    clip: ".emr-generated-source-modal",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Equation Source Before High Contrast Dark",
    settledSelector:
      '.emr-generated-source-before[aria-pressed="true"], .emr-generated-source-preview .katex',
    clip: ".emr-generated-source-modal",
  },
  // The Mermaid half of the shared callout: same header, toggles and preview
  // pane as the equation shots above, so a regression in either kind is caught.
  {
    title: "Visual/GeneratedSource",
    name: "Diagram Source Diff",
    settledSelector:
      '.emr-generated-source-code-diff .emr-word-added, .emr-generated-source-preview .emr-mermaid[data-hydrated="true"] > svg',
    clip: ".emr-generated-source-modal",
  },
  {
    title: "Visual/GeneratedSource",
    name: "Diagram Source Diff Dark",
    settledSelector:
      '.emr-generated-source-code-diff .emr-word-added, .emr-generated-source-preview .emr-mermaid[data-hydrated="true"] > svg',
    clip: ".emr-generated-source-modal",
  },
  {
    title: "Visual/GeneratedSource",
    name: "Diagram Source Before",
    settledSelector:
      '.emr-generated-source-before[aria-pressed="true"], .emr-generated-source-preview .emr-mermaid[data-hydrated="true"] > svg',
    clip: ".emr-generated-source-modal",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Tooltip Edges Light",
    settledSelector:
      '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover:
      'p:nth-of-type(2) .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Tooltip Edges High Contrast Dark",
    settledSelector:
      '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover:
      'p:nth-of-type(2) .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    // YAML frontmatter metadata card (light + dark): scalar + comma-list rows.
    title: "Visual/ArticleFrontmatter",
    name: "Light",
    settledSelector: ".emr-frontmatter-row",
  },
  {
    title: "Visual/ArticleFrontmatter",
    name: "Dark",
    settledSelector: ".emr-frontmatter-row",
  },
  {
    // Frontmatter DIFF (light + dark): inline word-diff of the value cells
    // (added green / removed struck-red words), plus an added row.
    title: "Visual/ArticleFrontmatter",
    name: "Diff",
    settledSelector:
      ".emr-frontmatter-value .emr-word-added, .emr-frontmatter-value .emr-word-removed",
  },
  {
    title: "Visual/ArticleFrontmatter",
    name: "Diff Dark",
    settledSelector:
      ".emr-frontmatter-value .emr-word-added, .emr-frontmatter-value .emr-word-removed",
  },
  {
    // Comment-thread balloon status variants (active / resolved / orphaned).
    title: "Visual/BalloonGallery",
    name: "Default",
    settledSelector: ".emr-balloon-orphan-quote",
  },
  // --- FOCUSED shots -------------------------------------------------------
  // Tight crops of individual controls so a small glyph change (the toggle
  // icons, the resolved badge) fills a large share of the frame and is caught
  // by the same tolerance the big composite shots would let slide.
  {
    // DocNav header — the “Documents” title + search affordance.
    title: "Visual/PrTab",
    name: "Default",
    settledSelector: ".emr-docnav-header",
    clip: ".emr-docnav-header",
  },
  {
    // Comment rail toolbar — the show/hide-resolved toggle + search live here.
    title: "Visual/PrTab",
    name: "Default",
    settledSelector: ".emr-rail-toolbar-actions",
    clip: ".emr-rail-toolbar",
  },
  {
    // Status bar (controls ON) — the colour-only Navigation / Comments /
    // Changes toggles in the accent state, plus the Aa font button + size
    // stepper and the word-count status on the left.
    title: "Visual/PrTab",
    name: "Default",
    settledSelector: ".emr-statusbar",
    clip: ".emr-statusbar",
  },
  {
    // Status bar under the dark theme.
    title: "Visual/PrTab",
    name: "Dark",
    settledSelector: ".emr-statusbar",
    clip: ".emr-statusbar",
  },
  {
    // Status bar with both panels collapsed — the toggles read "off" (muted),
    // guarding the colour-only on/off contrast.
    title: "Visual/PrTab",
    name: "Collapsed",
    settledSelector: ".emr-statusbar",
    clip: ".emr-statusbar",
  },
  {
    // Multi-comment stepping — catches alignment and count regressions around
    // the Comments toggle without paying the tolerance cost of a full reader.
    title: "Components/ReaderStatusBar",
    name: "Comment Stepping",
    settledSelector: ".emr-statusbar-comment-stepper",
    clip: ".emr-statusbar",
  },
  {
    // Documents-hub file tree — proves the hub shows NO per-file change
    // indicators (A/M/D glyph + ±N stats), which are a PR-only concept. A
    // whole-page hub shot can't catch these small per-row glyphs (they're far
    // under the composite tolerance), so this tight crop of the navigator is
    // what actually guards the "latest master, no diff" presentation.
    title: "Visual/DocumentsHub",
    name: "Default",
    settledSelector: ".emr-docnav-file-label",
    clip: ".emr-docnav-list",
  },
  {
    // "Copy link to section" — the hover-revealed link glyph after a heading's
    // text. Cropped to the hovered heading so the small glyph is a large share
    // of the frame (a whole-article shot would never notice it change).
    title: "Visual/HeadingLink",
    name: "Light",
    settledSelector: "#classifiers-hashing > .emr-heading-link",
    clip: "#classifiers-hashing",
    hover: "#classifiers-hashing",
    hoverEffect: "heading-link",
  },
  {
    title: "Visual/HeadingLink",
    name: "Dark",
    settledSelector: "#classifiers-hashing > .emr-heading-link",
    clip: "#classifiers-hashing",
    hover: "#classifiers-hashing",
    hoverEffect: "heading-link",
  },
  {
    // An added (diff-washed) heading: the link must sit outside the wash,
    // right after the text, with the gutter chevron still in place.
    title: "Visual/HeadingLink",
    name: "Light",
    settledSelector: "#retention.emr-diff-block > .emr-heading-link",
    clip: "#retention",
    hover: "#retention",
    hoverEffect: "heading-link",
  },
  {
    // Comparing specific PR updates: files the comparison doesn't touch are
    // dimmed — a per-row opacity change only a tight crop can catch.
    title: "Visual/UpdateComparison",
    name: "File List Light",
    settledSelector: ".emr-docnav-item.is-unchanged-in-range",
    clip: ".emr-docnav-list",
  },
  {
    title: "Visual/UpdateComparison",
    name: "File List Dark",
    settledSelector: ".emr-docnav-item.is-unchanged-in-range",
    clip: ".emr-docnav-list",
  },
  {
    // The selection bubble's explained variant (no "Add comment").
    title: "Visual/UpdateComparison",
    name: "Blocked Comment",
    settledSelector: ".emr-selection-bubble.is-blocked",
    clip: ".emr-selection-bubble",
  },
];

// Storybook builds a story index we can query to resolve a (title, name) pair
// to its stable story id — more robust than hand-kebab-casing the id.
interface StoryIndexEntry {
  id: string;
  title: string;
  name: string;
  type?: string;
}
interface StoryIndex {
  entries: Record<string, StoryIndexEntry>;
}

let indexPromise: Promise<StoryIndex> | undefined;
async function storyIndex(page: Page): Promise<StoryIndex> {
  indexPromise ??= page.request
    .get("/index.json")
    .then((r) => r.json() as Promise<StoryIndex>);
  return indexPromise;
}

async function resolveStoryId(page: Page, shot: Shot): Promise<string> {
  const index = await storyIndex(page);
  const match = Object.values(index.entries).find(
    (e) =>
      (e.type === undefined || e.type === "story") &&
      e.title === shot.title &&
      e.name === shot.name,
  );
  if (!match) {
    throw new Error(
      `No story found for "${shot.title}" / "${shot.name}". ` +
        `Did the story title/name change?`,
    );
  }
  return match.id;
}

/** Neutralise the few sources of frame-to-frame noise before shooting. */
async function stabilize(page: Page): Promise<void> {
  // Hide anything non-deterministic: async-rendered Mermaid SVGs inside an
  // ARTICLE (integration shots don't wait for them) and any remote avatar
  // images (fixtures fall back to initials when hidden). The source-callout
  // preview is exempt: those shots exist to pin the diagram and block on it
  // rendering first via `settledSelector`.
  await page.addStyleTag({
    content: `
      .emr-rendered .emr-mermaid { visibility: hidden !important; }
      .emr-avatar img { visibility: hidden !important; }
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  // Wait for web/system fonts so text metrics are final.
  await page.evaluate(() => document.fonts.ready);
}

function storyRoot(page: Page): Locator {
  return page.locator("#storybook-root");
}

for (const shot of SHOTS) {
  // Focused (clipped) shots reuse a story's (title, name) but crop to a
  // control, so fold the clip selector into the slug to keep baselines unique.
  const slugSource = shot.clip
    ? `${shot.title}-${shot.name}-${shot.clip}`
    : `${shot.title}-${shot.name}`;
  const slug = slugSource
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const label = shot.clip
    ? `${shot.title} / ${shot.name} [${shot.clip}]`
    : `${shot.title} / ${shot.name}`;
  test(`visual — ${label}`, async ({ page }) => {
    const id = await resolveStoryId(page, shot);
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);

    // The story's own `play` runs on load and settles the async render; wait
    // for the settle selector(s) rather than relying on `play` timing. A
    // comma-separated `settledSelector` lists MULTIPLE elements that must ALL
    // be present (e.g. the diff wash AND the comment highlight), so wait for
    // each independently — a single comma selector would resolve as soon as
    // any one matched, risking a shot before the others have rendered.
    const settledSelectors = shot.settledSelector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const selector of settledSelectors) {
      await page.locator(selector).first().waitFor({ state: "visible" });
    }
    await stabilize(page);
    if (shot.hover) {
      const hovered = page.locator(shot.hover).first();
      await hovered.hover();
      if (shot.hoverEffect === "tooltip") {
        await expect
          .poll(() =>
            hovered.evaluate(
              (element) => getComputedStyle(element, "::after").opacity,
            ),
          )
          .toBe("1");
      } else if (shot.hoverEffect === "heading-link") {
        await expect(hovered.locator(":scope > .emr-heading-link")).toHaveCSS(
          "opacity",
          "1",
        );
      } else {
        await expect(
          page.locator(".emr-diff-before-trigger").first(),
        ).toHaveCSS("opacity", "1");
      }
    }

    const target = shot.clip ? page.locator(shot.clip) : storyRoot(page);
    await expect(target).toHaveScreenshot(`${slug}.png`);
  });
}
