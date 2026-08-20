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
// no animation, no Mermaid) and add a `{ title, name }` entry below.

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
  /** What must become visible after hovering. Defaults to the Before control. */
  hoverEffect?: "before" | "tooltip";
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
    name: "Checklist State Tooltip Dark",
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
    name: "Tooltip Edges Light",
    settledSelector:
      '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover:
      'p:nth-of-type(2) .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Tooltip Edges Dark",
    settledSelector:
      '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hover:
      'p:nth-of-type(2) .emr-diff-format-change[data-diff-tooltip^="Link added:"]',
    hoverEffect: "tooltip",
  },
  {
    title: "Visual/ArticleDiff",
    name: "Tooltip Edges High Contrast Light",
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
  // Hide anything non-deterministic: async-rendered Mermaid SVGs and any
  // remote avatar images (fixtures fall back to initials when hidden).
  await page.addStyleTag({
    content: `
      .emr-mermaid { visibility: hidden !important; }
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
