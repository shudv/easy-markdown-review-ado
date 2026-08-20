// Visual-regression fixtures for the diff-highlighting layer in isolation.
//
// This is the highest-value component shot: the diff wash + inline word-diff +
// deleted-marker are the layer we tweak most, and rendering ArticleView on its
// own (light AND dark) pins those pixels without the noise of the full shell.
//
// Screenshotted by visual/curated.visual.spec.ts. Deterministic: no time,
// no animation, no Mermaid.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { fn, waitFor } from "storybook/test";

import type { CommentThread, DiffRange } from "../../types";
import { renderMarkdownSync } from "../../markdown/render";
import { ArticleView } from "./ArticleView";

// Keep line numbers stable — the diff ranges below reference them. This fixture
// deliberately exercises EVERY diff kind in one frame so a regression in any of
// them shows up as a pixel diff:
//   • heading inline word-diff (add + remove words)
//   • paragraph inline word-diff
//   • a pure-added section (green wash + granular added list items)
//   • a HARD-WRAPPED ordered-list item edited across two source lines (the
//     exact shape from the field bug report — inline word-diff on a <li>)
//   • a structurally-added TABLE COLUMN plus paired cell edits
//   • a deleted TABLE ROW revealed inside the original table grid
//   • a blockquote inline word-diff
//   • a deleted-marker with a rendered removed-content body
const SOURCE = [
  /*  1 */ "# Widget Configuration Guide",
  /*  2 */ "",
  /*  3 */ "Configure your widget by editing the [settings file](https://example.com/settings-v2) in your home folder.",
  /*  4 */ "",
  /*  5 */ "## Prerequisites",
  /*  6 */ "",
  /*  7 */ "- Node.js 20 or newer installed on the build machine.",
  /*  8 */ "- A valid API token with read and write scopes.",
  /*  9 */ "",
  /* 10 */ "## Installation",
  /* 11 */ "",
  /* 12 */ "1. Download the signed installer from the release page and run it using an",
  /* 13 */ "   administrator account on the target host.",
  /* 14 */ "2. Restart your shell so the new PATH entry is picked up.",
  /* 15 */ "",
  /* 16 */ "## Settings",
  /* 17 */ "",
  /* 18 */ "| Option  | Cadence      | Default |",
  /* 19 */ "| ------- | ------------ | ------- |",
  /* 20 */ "| theme   | On change    | dark    |",
  /* 21 */ "| retries | Every minute | 5       |",
  /* 22 */ "",
  /* 23 */ "> Tip: keep the settings file under version control for easy rollback.",
  /* 24 */ "",
  /* 25 */ "## Notes",
  /* 26 */ "",
  /* 27 */ "Everything else in this guide is unchanged for the current release.",
  /* 28 */ "",
].join("\n");

const HTML = renderMarkdownSync(SOURCE);

const DIFF: DiffRange[] = [
  // Heading reworded: "Setup" → "Configuration" (inline add + remove).
  {
    startLine: 1,
    endLine: 1,
    kind: "modified",
    originalText: "# Widget Setup Guide",
    linesAdded: 1,
    linesDeleted: 1,
  },
  // Paragraph reworded + link target changed; pins both word marks and the
  // shared metadata indicator.
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalText:
      "Configure your widget by editing the [config file](https://example.com/settings-v1) in your home directory.",
    linesAdded: 1,
    linesDeleted: 1,
  },
  // Pure-added Prerequisites section (heading + two list items).
  { startLine: 5, endLine: 8, kind: "added", linesAdded: 4 },
  // Hard-wrapped ordered-list item edited across BOTH of its source lines —
  // the reported bug shape. Renders as one <li> spanning lines 12-13.
  {
    startLine: 12,
    endLine: 13,
    kind: "modified",
    originalText:
      "1. Download the installer from the release page and run it using a standard\n   user account on the target host.",
    linesAdded: 2,
    linesDeleted: 2,
  },
  // Cadence column added; Default values also edited. Unchanged Option cells
  // anchor each row so the structural alignment stays precise rather than
  // falling back to an amber whole-row wash.
  {
    startLine: 18,
    endLine: 21,
    kind: "modified",
    originalText: [
      "| Option  | Default |",
      "| ------- | ------- |",
      "| theme   | light   |",
      "| retries | 3       |",
    ].join("\n"),
    linesAdded: 4,
    linesDeleted: 4,
  },
  // Removed table row: the chip + revealed row stay inside the existing table
  // so all three cells inherit the parent grid's column widths.
  {
    startLine: 21,
    endLine: 21,
    kind: "deleted-marker",
    linesDeleted: 1,
    deletedContent: "| legacy  | 1       | Removed compatibility option. |",
  },
  // Blockquote reworded (inline add + remove).
  {
    startLine: 23,
    endLine: 23,
    kind: "modified",
    originalText:
      "> Tip: keep the settings file backed up somewhere for quick recovery.",
    linesAdded: 1,
    linesDeleted: 1,
  },
  // A removed "## Deprecated" section leaves a red deleted-marker before Notes.
  {
    startLine: 25,
    endLine: 25,
    kind: "deleted-marker",
    linesDeleted: 3,
    deletedContent:
      "## Deprecated\n\n- The legacy config file format is no longer supported.",
  },
];

const THREADS: CommentThread[] = [
  {
    id: "t1",
    filePath: "/widget-guide.md",
    status: "active",
    anchor: {
      exact: "Everything else",
      prefix: "",
      suffix: " in this guide",
    },
    comments: [],
  },
];

/** Applies an EMR theme to the document root for the story's lifetime. */
function ThemeFrame({
  theme,
  width = 720,
  children,
}: {
  theme?: "dark" | "hc-light" | "hc-dark";
  width?: number;
  children: React.ReactNode;
}): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-emr-theme");
    if (theme) el.setAttribute("data-emr-theme", theme);
    else el.removeAttribute("data-emr-theme");
    return () => {
      if (prev) el.setAttribute("data-emr-theme", prev);
      else el.removeAttribute("data-emr-theme");
    };
  }, [theme]);
  return (
    <div
      style={{
        background: "var(--emr-bg)",
        color: "var(--emr-fg)",
        padding: 24,
        width,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Visual/ArticleDiff",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  args: {
    pristineHtml: HTML,
    threads: THREADS,
    activeThreadId: "t1",
    draftAnchor: null,
    diff: DIFF,
    showDiff: true,
    storageKey: "visual-widget-guide.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

function assertMicroBeforeTriggers(canvasElement: HTMLElement): void {
  for (const trigger of canvasElement.querySelectorAll<HTMLButtonElement>(
    ".emr-diff-before-trigger",
  )) {
    const control = trigger.closest<HTMLElement>(".emr-diff-before-control")!;
    const panel = control.nextElementSibling as HTMLElement | null;
    const owner =
      control.parentElement?.tagName === "LI"
        ? control.parentElement
        : (panel?.nextElementSibling as HTMLElement | null);
    const triggerRect = trigger.getBoundingClientRect();
    const ownerRect = owner?.getBoundingClientRect();
    if (
      trigger.textContent !== "Before" ||
      trigger.getAttribute("aria-label") !== "Show previous version" ||
      triggerRect.height > 19 ||
      trigger.scrollWidth > trigger.clientWidth ||
      trigger.scrollHeight > trigger.clientHeight ||
      !ownerRect ||
      triggerRect.left < ownerRect.left - 1 ||
      triggerRect.right > ownerRect.right + 1 ||
      triggerRect.top < ownerRect.top - 1 ||
      triggerRect.bottom > ownerRect.bottom + 1
    ) {
      throw new Error(
        `Before chip does not fit ${owner?.tagName ?? "unknown"}: trigger=${JSON.stringify({ left: triggerRect.left, right: triggerRect.right, top: triggerRect.top, bottom: triggerRect.bottom, clientWidth: trigger.clientWidth, scrollWidth: trigger.scrollWidth, clientHeight: trigger.clientHeight, scrollHeight: trigger.scrollHeight })} owner=${ownerRect ? JSON.stringify({ left: ownerRect.left, right: ownerRect.right, top: ownerRect.top, bottom: ownerRect.bottom }) : "missing"}`,
      );
    }
  }
}

async function waitForDiff(canvasElement: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      if (!canvasElement.querySelector(".emr-diff-block")) {
        throw new Error("diff not decorated yet");
      }
      if (!canvasElement.querySelector(".emr-word-added")) {
        throw new Error("inline word diff not applied yet");
      }
    },
    { timeout: 5000 },
  );
  const tableMarker = canvasElement.querySelector<HTMLTableRowElement>(
    "tr.emr-diff-deleted-table-row",
  );
  if (!tableMarker) throw new Error("deleted table row not rendered");
  await waitFor(() => {
    if (tableMarker.hidden) {
      throw new Error("deleted table row not expanded yet");
    }
  });
}

/** Light theme: green add wash, inline word edits, red deleted-marker. */
export const Light: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForDiff(canvasElement);
  },
};

/** Dark theme: the same diff layer, verifying the dark colour tokens. */
export const Dark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForDiff(canvasElement);
  },
};

const MEDIA_IMAGE_URL = new URL("../../../static/logo.png", import.meta.url)
  .href;
const MEDIA_SOURCE = [
  "# Media Diff",
  "",
  "## Added image",
  "",
  `![Added architecture](${MEDIA_IMAGE_URL})`,
  "",
  "## Modified image",
  "",
  `![Current architecture](${MEDIA_IMAGE_URL})`,
].join("\n");
const MEDIA_DIFF: DiffRange[] = [
  { startLine: 5, endLine: 5, kind: "added" },
  {
    startLine: 9,
    endLine: 9,
    kind: "modified",
    originalText: `![Legacy architecture](${MEDIA_IMAGE_URL})`,
  },
];

async function waitForMinimalMediaDiff(canvasElement: HTMLElement) {
  await waitFor(() => {
    const blocks =
      canvasElement.querySelectorAll<HTMLElement>(".emr-diff-image");
    if (blocks.length !== 2) throw new Error("media diffs not decorated");
    for (const block of blocks) {
      const style = getComputedStyle(block);
      if (
        style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
        style.borderLeftWidth !== "3px"
      ) {
        throw new Error("media diff is not using the minimal left marker");
      }
    }
  });
}

/** Added and modified image-only blocks use a left marker instead of wash. */
export const MediaDiffLight: Story = {
  args: {
    pristineHtml: renderMarkdownSync(MEDIA_SOURCE),
    documentPath: "/media.md",
    threads: [],
    activeThreadId: null,
    diff: MEDIA_DIFF,
    storageKey: "media.md",
  },
  decorators: [
    (Story) => (
      <ThemeFrame width={860}>
        <Story />
      </ThemeFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitForMinimalMediaDiff(canvasElement);
  },
};

export const MediaDiffDark: Story = {
  ...MediaDiffLight,
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark" width={860}>
        <Story />
      </ThemeFrame>
    ),
  ],
};

function OriginalSourceRewrapArticle(
  props: React.ComponentProps<typeof ArticleView>,
): React.ReactElement {
  const [originalSource, setOriginalSource] = React.useState<string>();
  React.useEffect(() => setOriginalSource(SOURCE), []);
  return (
    <div data-original-source-ready={originalSource !== undefined}>
      <ArticleView {...props} originalSource={originalSource} />
    </div>
  );
}

export const ActiveHighlightAfterOriginalSource: Story = {
  render: (args) => <OriginalSourceRewrapArticle {...args} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (
        canvasElement.querySelector("[data-original-source-ready=true]") ===
        null
      ) {
        throw new Error("original source did not settle");
      }
      if (
        canvasElement.querySelector(
          '.emr-highlight.is-active[data-thread-id="t1"]',
        ) === null
      ) {
        throw new Error("original-source rewrap dropped the active highlight");
      }
    });
  },
};

const TABLE_SOURCE = [
  /*  1 */ "# Table Diff Gallery",
  /*  2 */ "",
  /*  3 */ "## Added Column",
  /*  4 */ "",
  /*  5 */ "| Service | Cadence | Owner |",
  /*  6 */ "| --- | --- | --- |",
  /*  7 */ "| Checkout | Every 30 minutes | Platform |",
  /*  8 */ "| Search | Every 60 minutes | Discovery |",
  /*  9 */ "",
  /* 10 */ "## Rich Cell Edit",
  /* 11 */ "",
  /* 12 */ "| Resource | Link | Guidance |",
  /* 13 */ "| --- | --- | --- |",
  /* 14 */ "| Incident guide | [Response guide](https://support.fabrikam.test/v2) | Notify after the first failed mitigation and include affected regions in the response log. |",
  /* 15 */ "| Dashboard | [Service health](https://example.com/health) | Unchanged control row. |",
  /* 16 */ "",
  /* 17 */ "## Amber Fallback",
  /* 18 */ "",
  /* 19 */ "| Modern field | Modern value | Owner |",
  /* 20 */ "| --- | --- | --- |",
  /* 21 */ "| Modern schedule | Continuous | Automation |",
  /* 22 */ "",
  /* 23 */ "## Removed and Added Rows",
  /* 24 */ "",
  /* 25 */ "| Region | Status | Owner |",
  /* 26 */ "| --- | --- | --- |",
  /* 27 */ "| East US | Active | Core platform |",
  /* 28 */ "| West Europe | Active | Core platform |",
  /* 29 */ "| North Europe | New | Edge platform |",
  /* 30 */ "",
  /* 31 */ "## Removed Column",
  /* 32 */ "",
  /* 33 */ "| Service | Owner |",
  /* 34 */ "| --- | --- |",
  /* 35 */ "| Checkout | Platform |",
].join("\n");

const TABLE_DIFF: DiffRange[] = [
  {
    startLine: 5,
    endLine: 8,
    kind: "modified",
    originalText: [
      "| Service | Owner |",
      "| --- | --- |",
      "| Checkout | Platform |",
      "| Search | Discovery |",
    ].join("\n"),
  },
  {
    startLine: 14,
    endLine: 14,
    kind: "modified",
    originalText:
      "| Incident guide | [Legacy guide](https://docs.contoso.test/v1) | Notify after the second failed mitigation and include customer impact in the response log. |",
  },
  {
    startLine: 19,
    endLine: 21,
    kind: "modified",
    originalText: [
      "| Legacy field | Legacy value |",
      "| --- | --- |",
      "| Legacy policy | Weekly batch |",
    ].join("\n"),
  },
  {
    startLine: 28,
    endLine: 28,
    kind: "deleted-marker",
    linesDeleted: 1,
    deletedContent: "| Central US | Deprecated | Legacy operations |",
  },
  { startLine: 29, endLine: 29, kind: "added", linesAdded: 1 },
  {
    startLine: 33,
    endLine: 35,
    kind: "modified",
    originalText: [
      "| Service | Legacy | Owner |",
      "| --- | --- | --- |",
      "| Checkout | Enabled | Platform |",
    ].join("\n"),
  },
];

async function waitForTableGallery(canvasElement: HTMLElement): Promise<void> {
  await waitFor(() => {
    for (const selector of [
      ".emr-diff-cell--added",
      ".emr-diff-cell--inline",
      "tr.emr-diff-block--modified:not([data-diff-cells])",
      "tr.emr-diff-deleted-table-row",
      ".emr-diff-metadata-trigger",
      ".emr-diff-before-trigger",
    ]) {
      if (!canvasElement.querySelector(selector)) {
        throw new Error(`table gallery missing ${selector}`);
      }
    }
  });
  assertMicroBeforeTriggers(canvasElement);
  canvasElement
    .querySelector<HTMLButtonElement>(".emr-diff-metadata-trigger")!
    .click();
  canvasElement
    .querySelector<HTMLButtonElement>(".emr-diff-before-trigger")!
    .click();
  await waitFor(() => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-diff-metadata-trigger",
    )!;
    const panel = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-metadata-panel",
    )!;
    if (!panel.matches(":popover-open")) {
      throw new Error("metadata popover not open");
    }
    if (
      trigger.getAttribute("aria-expanded") !== "true" ||
      trigger.getAttribute("aria-controls") !== panel.id
    ) {
      throw new Error("metadata popover ARIA is not synchronized");
    }
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.top < 7 || panelRect.bottom > window.innerHeight - 7) {
      throw new Error("metadata popover extends beyond the viewport");
    }
    if (
      canvasElement.querySelector<HTMLElement>(".emr-diff-before-panel")!.hidden
    ) {
      throw new Error("before table not expanded");
    }
    const removedRowCell = canvasElement.querySelector<HTMLElement>(
      "tr.emr-diff-deleted-table-row > td",
    );
    const removedColumnCell = canvasElement.querySelector<HTMLElement>(
      "td.emr-diff-cell--removed, th.emr-diff-cell--removed",
    );
    if (!removedRowCell || !removedColumnCell) {
      throw new Error("structural removal examples not rendered");
    }
    const removedRowBackground =
      getComputedStyle(removedRowCell).backgroundColor;
    const removedColumnBackground =
      getComputedStyle(removedColumnCell).backgroundColor;
    if (removedRowBackground !== removedColumnBackground) {
      throw new Error(
        `removed row (${removedRowBackground}) and column (${removedColumnBackground}) washes do not match`,
      );
    }
  });
  const trigger = canvasElement.querySelector<HTMLButtonElement>(
    ".emr-diff-metadata-trigger",
  )!;
  const panel = canvasElement.querySelector<HTMLElement>(
    ".emr-diff-metadata-panel",
  )!;
  (
    panel as HTMLElement & {
      hidePopover(): void;
    }
  ).hidePopover();
  await waitFor(() => {
    if (
      panel.matches(":popover-open") ||
      trigger.getAttribute("aria-expanded") !== "false"
    ) {
      throw new Error("metadata popover did not synchronize after Escape");
    }
  });
  trigger.click();
  await waitFor(() => {
    if (
      !panel.matches(":popover-open") ||
      trigger.getAttribute("aria-expanded") !== "true"
    ) {
      throw new Error("metadata popover did not reopen");
    }
  });
}

export const TableGalleryLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(TABLE_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: TABLE_DIFF,
    storageKey: "visual-table-gallery.md",
  },
  play: async ({ canvasElement }) => {
    await waitForTableGallery(canvasElement);
  },
};

export const TableGalleryDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(TABLE_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: TABLE_DIFF,
    storageKey: "visual-table-gallery-dark.md",
  },
  play: async ({ canvasElement }) => {
    await waitForTableGallery(canvasElement);
  },
};

const CONFIDENCE_SOURCE = [
  /*  1 */ "# Table Alignment Confidence",
  /*  2 */ "",
  /*  3 */ "## Header Rename",
  /*  4 */ "",
  /*  5 */ "| Service | Primary owner |",
  /*  6 */ "| --- | --- |",
  /*  7 */ "| Checkout | Platform |",
  /*  8 */ "",
  /*  9 */ "## Swapped Columns",
  /* 10 */ "",
  /* 11 */ "| Owner | Cadence |",
  /* 12 */ "| --- | --- |",
  /* 13 */ "| Platform | Every hour |",
  /* 14 */ "| Operations | Every day |",
  /* 15 */ "",
  /* 16 */ "## Repeated Value Fallback",
  /* 17 */ "",
  /* 18 */ "| Yes | Inserted | Yes |",
  /* 19 */ "| --- | --- | --- |",
  /* 20 */ "| Yes | New | Yes |",
  /* 21 */ "",
  /* 22 */ "## Empty Value Fallback",
  /* 23 */ "",
  /* 24 */ "| | Cadence | |",
  /* 25 */ "| --- | --- | --- |",
  /* 26 */ "| Schedule | Continuous | |",
  /* 27 */ "",
  /* 28 */ "## Formatting Only",
  /* 29 */ "",
  /* 30 */ "| Resource | Description |",
  /* 31 */ "| --- | --- |",
  /* 32 */ "| Runbook | **incident guide** |",
  /* 33 */ "| Dashboard | service health |",
].join("\n");

const CONFIDENCE_DIFF: DiffRange[] = [
  {
    startLine: 5,
    endLine: 7,
    kind: "modified",
    originalText: [
      "| Service | Response owner |",
      "| --- | --- |",
      "| Checkout | Platform |",
    ].join("\n"),
  },
  {
    startLine: 11,
    endLine: 14,
    kind: "modified",
    originalText: [
      "| Cadence | Owner |",
      "| --- | --- |",
      "| Every hour | Platform |",
      "| Every day | Operations |",
    ].join("\n"),
  },
  {
    startLine: 18,
    endLine: 20,
    kind: "modified",
    originalText: ["| Yes | Yes |", "| --- | --- |", "| Yes | Yes |"].join(
      "\n",
    ),
  },
  {
    startLine: 24,
    endLine: 26,
    kind: "modified",
    originalText: ["| | |", "| --- | --- |", "| Schedule | |"].join("\n"),
  },
  {
    startLine: 32,
    endLine: 32,
    kind: "modified",
    originalText: "| Runbook | incident guide |",
  },
];

async function waitForConfidenceGallery(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitFor(() => {
    if (
      canvasElement.querySelectorAll(".emr-diff-before-trigger").length !== 2
    ) {
      throw new Error("confidence fallbacks not rendered");
    }
    if (!canvasElement.querySelector("thead .emr-word-added")) {
      throw new Error("header rename not rendered");
    }
    const formattingCell = Array.from(
      canvasElement.querySelectorAll<HTMLElement>("td.emr-diff-cell"),
    ).find((cell) => cell.textContent?.includes("incident guide"));
    if (
      !formattingCell ||
      !formattingCell.classList.contains("emr-diff-cell--inline") ||
      formattingCell.querySelector(".emr-diff-format-change")?.textContent !==
        "incident guide" ||
      formattingCell.querySelector(".emr-diff-metadata")
    ) {
      throw new Error("formatting-only cell was not marked precisely");
    }
  });
  assertMicroBeforeTriggers(canvasElement);
  for (const trigger of canvasElement.querySelectorAll<HTMLButtonElement>(
    ".emr-diff-before-trigger",
  )) {
    trigger.click();
  }
  await waitFor(() => {
    const panels = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".emr-diff-before-panel"),
    );
    if (panels.length !== 2 || panels.some((panel) => panel.hidden)) {
      throw new Error("confidence before panels not expanded");
    }
  });
}

export const TableConfidenceLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(CONFIDENCE_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: CONFIDENCE_DIFF,
    storageKey: "visual-table-confidence.md",
  },
  play: async ({ canvasElement }) => {
    await waitForConfidenceGallery(canvasElement);
  },
};

export const TableConfidenceDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(CONFIDENCE_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: CONFIDENCE_DIFF,
    storageKey: "visual-table-confidence-dark.md",
  },
  play: async ({ canvasElement }) => {
    await waitForConfidenceGallery(canvasElement);
  },
};

const FORMATTING_SOURCE = [
  "# Formatting Precision",
  "",
  "This sentence is **bold** now.",
  "",
  "| Resource | Description |",
  "| --- | --- |",
  "| Runbook | **incident guide** |",
].join("\n");

const FORMATTING_DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalText: "This sentence is bold now.",
  },
  {
    startLine: 7,
    endLine: 7,
    kind: "modified",
    originalText: "| Runbook | incident guide |",
  },
];

async function waitForFormattingPrecision(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitFor(() => {
    const paragraph = canvasElement.querySelector<HTMLElement>(
      "p.emr-diff-block--inline",
    );
    const cell = Array.from(
      canvasElement.querySelectorAll<HTMLElement>("td.emr-diff-cell"),
    ).find((candidate) => candidate.textContent?.includes("incident guide"));
    if (
      !paragraph ||
      paragraph.querySelector(".emr-diff-format-change")?.textContent !==
        "bold" ||
      paragraph.querySelector(".emr-diff-metadata") ||
      !cell ||
      !cell.classList.contains("emr-diff-cell--inline") ||
      cell.querySelector(".emr-diff-format-change")?.textContent !==
        "incident guide" ||
      cell.querySelector(".emr-diff-metadata")
    ) {
      throw new Error("formatting-only changes were not marked precisely");
    }
    if (canvasElement.querySelector(".emr-diff-before-trigger")) {
      throw new Error("precise formatting diff exposed a Before fallback");
    }
  });
}

export const FormattingPrecisionLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(FORMATTING_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: FORMATTING_DIFF,
    storageKey: "visual-formatting-precision.md",
  },
  play: async ({ canvasElement }) => {
    await waitForFormattingPrecision(canvasElement);
  },
};

export const FormattingPrecisionDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(FORMATTING_SOURCE),
    threads: [],
    activeThreadId: null,
    diff: FORMATTING_DIFF,
    storageKey: "visual-formatting-precision-dark.md",
  },
  play: async ({ canvasElement }) => {
    await waitForFormattingPrecision(canvasElement);
  },
};

const BLOCK_CONFIDENCE_SOURCE = [
  /*  1 */ "# Block Diff Confidence",
  /*  2 */ "",
  /*  3 */ "## Wholesale Rewrite",
  /*  4 */ "",
  /*  5 */ "Production traffic now follows a staged regional rollout with automated health gates.",
  /*  6 */ "",
  /*  7 */ "## Reconstructed Hard Wrap",
  /*  8 */ "",
  /*  9 */ "The deployment guide keeps this opening phrase and now recommends",
  /* 10 */ "the staged verification path for regional rollouts while preserving",
  /* 11 */ "the final rollback checklist for operators.",
  /* 12 */ "",
  /* 13 */ "## Heading Structure",
  /* 14 */ "",
  /* 15 */ "### Approval workflow",
  /* 16 */ "",
  /* 17 */ "## List Structure",
  /* 18 */ "",
  /* 19 */ "- Preserve customer context through the handoff.",
  /* 20 */ "",
  /* 21 */ "## Quote Rewrite",
  /* 22 */ "",
  /* 23 */ "> Escalate after the first failed mitigation and page the regional owner.",
  /* 24 */ "",
  /* 25 */ "## Code Edit",
  /* 26 */ "",
  /* 27 */ "```ts",
  /* 28 */ "const timeout = 30;",
  /* 29 */ "```",
  /* 30 */ "",
  /* 31 */ "## Code Rewrite",
  /* 32 */ "",
  /* 33 */ "```powershell",
  /* 34 */ "Invoke-RestMethod $healthEndpoint",
  /* 35 */ "```",
  /* 36 */ "",
  /* 37 */ "## Link Wrapping",
  /* 38 */ "",
  /* 39 */ "Read the [deployment guide](https://example.com/deployment) before continuing.",
  /* 40 */ "",
  /* 41 */ "## Checklist State",
  /* 42 */ "",
  /* 43 */ "- [x] Confirm the rollback owner.",
  /* 44 */ "",
  /* 45 */ "## Formatting Only",
  /* 46 */ "",
  /* 47 */ "The **release owner** confirms the deployment window.",
].join("\n");

const BLOCK_CONFIDENCE_ORIGINAL = [
  "# Block Diff Confidence",
  "",
  "## Wholesale Rewrite",
  "",
  "A legacy operator manually copied a checklist into each ticket before deployment.",
  "",
  "## Reconstructed Hard Wrap",
  "",
  "The deployment guide keeps this opening phrase and now recommends",
  "the direct verification path for global rollouts while preserving",
  "the final rollback checklist for operators.",
  "",
  "## Heading Structure",
  "",
  "## Approval workflow",
  "",
  "## List Structure",
  "",
  "1. Preserve customer context through the handoff.",
  "",
  "## Quote Rewrite",
  "",
  "> Archive the weekly summary after review and notify the documentation team.",
  "",
  "## Code Edit",
  "",
  "```ts",
  "const timeout = 15;",
  "```",
  "",
  "## Code Rewrite",
  "",
  "```powershell",
  "Remove-Item legacy.cache -Force",
  "```",
  "",
  "## Link Wrapping",
  "",
  "Read the deployment guide before continuing.",
  "",
  "## Checklist State",
  "",
  "- [ ] Confirm the rollback owner.",
  "",
  "## Formatting Only",
  "",
  "The release owner confirms the deployment window.",
].join("\n");

const BLOCK_CONFIDENCE_DIFF: DiffRange[] = [
  {
    startLine: 5,
    endLine: 5,
    kind: "modified",
    originalStartLine: 5,
    originalEndLine: 5,
    originalText:
      "A legacy operator manually copied a checklist into each ticket before deployment.",
  },
  {
    startLine: 10,
    endLine: 10,
    kind: "modified",
    originalStartLine: 10,
    originalEndLine: 10,
    originalText:
      "the direct verification path for global rollouts while preserving",
  },
  {
    startLine: 15,
    endLine: 15,
    kind: "modified",
    originalStartLine: 15,
    originalEndLine: 15,
    originalText: "## Approval workflow",
  },
  {
    startLine: 19,
    endLine: 19,
    kind: "modified",
    originalStartLine: 19,
    originalEndLine: 19,
    originalText: "1. Preserve customer context through the handoff.",
  },
  {
    startLine: 23,
    endLine: 23,
    kind: "modified",
    originalStartLine: 23,
    originalEndLine: 23,
    originalText:
      "> Archive the weekly summary after review and notify the documentation team.",
  },
  {
    startLine: 28,
    endLine: 28,
    kind: "modified",
    originalStartLine: 28,
    originalEndLine: 28,
    originalText: "const timeout = 15;",
  },
  {
    startLine: 34,
    endLine: 34,
    kind: "modified",
    originalStartLine: 34,
    originalEndLine: 34,
    originalText: "Remove-Item legacy.cache -Force",
  },
  {
    startLine: 39,
    endLine: 39,
    kind: "modified",
    originalStartLine: 39,
    originalEndLine: 39,
    originalText: "Read the deployment guide before continuing.",
  },
  {
    startLine: 43,
    endLine: 43,
    kind: "modified",
    originalStartLine: 43,
    originalEndLine: 43,
    originalText: "- [ ] Confirm the rollback owner.",
  },
  {
    startLine: 47,
    endLine: 47,
    kind: "modified",
    originalStartLine: 47,
    originalEndLine: 47,
    originalText: "The release owner confirms the deployment window.",
  },
];

async function waitForBlockConfidenceReady(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitFor(() => {
    const triggers = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    );
    if (triggers.length !== 3) {
      throw new Error(`expected 3 block fallbacks, found ${triggers.length}`);
    }
    if (
      canvasElement.querySelectorAll('[data-diff-amber-mode="comparison"]')
        .length !== 3
    ) {
      throw new Error("comparison amber regions are not classified precisely");
    }
    const explained = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        '[data-diff-amber-mode="explained"]',
      ),
    );
    if (
      explained.length < 5 ||
      explained.some(
        (element) =>
          !element.dataset.diffTooltip || element.hasAttribute("title"),
      )
    ) {
      throw new Error("explained amber regions lack one custom-only tooltip");
    }
    if (!canvasElement.querySelector("p.emr-diff-block--inline")) {
      throw new Error("reconstructed hard-wrap diff not rendered inline");
    }
    const preciseCode = Array.from(
      canvasElement.querySelectorAll<HTMLElement>("pre"),
    ).find((candidate) => candidate.textContent?.includes("timeout"));
    if (
      preciseCode?.querySelector(".emr-word-added")?.textContent !== "30" ||
      preciseCode.querySelector(".emr-word-removed")?.textContent !== "15" ||
      preciseCode.previousElementSibling?.classList.contains(
        "emr-diff-before-panel",
      )
    ) {
      throw new Error(
        `numeric code edit was not rendered precisely: ${preciseCode?.outerHTML ?? "missing"}`,
      );
    }
    const formattingMark = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".emr-diff-format-change"),
    ).find((mark) => mark.textContent === "release owner");
    if (!formattingMark) {
      throw new Error("formatting-only block was not marked precisely");
    }
    if (!canvasElement.querySelector("li.emr-diff-list-marker-change")) {
      throw new Error("list type change was not scoped to its marker");
    }
    if (
      canvasElement.querySelector("h3 .emr-diff-format-change")?.textContent !==
      "Approval workflow"
    ) {
      throw new Error("heading structure change was not scoped to its text");
    }
    const linkMark = Array.from(
      canvasElement.querySelectorAll<HTMLElement>("a .emr-diff-format-change"),
    ).find((mark) => mark.textContent === "deployment guide");
    if (!linkMark) {
      throw new Error("link wrapping change was not scoped to its text");
    }
    if (!canvasElement.querySelector(".emr-diff-task-state-change")) {
      throw new Error("checklist state change was not scoped to its checkbox");
    }
  });
  assertMicroBeforeTriggers(canvasElement);
}

async function waitForBlockConfidence(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitForBlockConfidenceReady(canvasElement);
  for (const trigger of canvasElement.querySelectorAll<HTMLButtonElement>(
    ".emr-diff-before-trigger",
  )) {
    trigger.click();
  }
  await waitFor(() => {
    const panels = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        ".emr-diff-before-panel--block",
      ),
    );
    if (panels.length !== 3 || panels.some((panel) => panel.hidden)) {
      throw new Error("block Before panels not expanded");
    }
    for (const panel of panels) {
      const label = panel.querySelector<HTMLElement>(".emr-diff-before-label")!;
      const content = panel.querySelector<HTMLElement>(
        ".emr-diff-before-content",
      )!;
      const panelStyle = getComputedStyle(panel);
      const expectedLeft =
        panel.getBoundingClientRect().left +
        Number.parseFloat(panelStyle.borderLeftWidth) +
        Number.parseFloat(panelStyle.paddingLeft);
      if (
        getComputedStyle(label).display !== "none" ||
        Math.abs(content.getBoundingClientRect().left - expectedLeft) > 1
      ) {
        throw new Error(
          "Before panel does not use micro-chip content alignment",
        );
      }
    }
    if (!canvasElement.querySelector(".emr-diff-before-panel pre")) {
      throw new Error("historical code block not rendered");
    }
  });
}

async function prepareBlockDisclosureHover(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitForBlockConfidenceReady(canvasElement);
  const paragraph = Array.from(canvasElement.querySelectorAll("p")).find(
    (candidate) => candidate.textContent?.startsWith("Production traffic"),
  )!;
  const panel = paragraph.previousElementSibling as HTMLElement;
  const control = panel.previousElementSibling as HTMLElement;
  const trigger = control.querySelector<HTMLButtonElement>(
    ".emr-diff-before-trigger",
  )!;
  if (
    control.getBoundingClientRect().height !== 0 ||
    !panel.hidden ||
    getComputedStyle(panel).display !== "none"
  ) {
    throw new Error("collapsed disclosure still consumes layout");
  }
  trigger.focus();
  await waitFor(() => {
    if (getComputedStyle(trigger).opacity !== "1") {
      throw new Error("focused disclosure is not visible");
    }
  });
  trigger.blur();
}

async function preparePreciseAmberTooltip(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitForBlockConfidenceReady(canvasElement);
  const mark = Array.from(
    canvasElement.querySelectorAll<HTMLElement>("a .emr-diff-format-change"),
  ).find((candidate) => candidate.textContent === "deployment guide")!;
  if (
    mark.dataset.diffTooltip !== "Link added: https://example.com/deployment" ||
    mark.hasAttribute("title") ||
    mark.closest("a")?.hasAttribute("title")
  ) {
    throw new Error(
      "precise link tooltip is missing detail or has a native duplicate",
    );
  }
  mark.focus();
  await waitFor(() => {
    if (getComputedStyle(mark, "::after").opacity !== "1") {
      throw new Error("precise amber tooltip is not visible on keyboard focus");
    }
  });
  mark.blur();
}

async function prepareChecklistStateTooltip(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitForBlockConfidenceReady(canvasElement);
  const wrapper = canvasElement.querySelector<HTMLElement>(
    ".emr-diff-task-tooltip-anchor",
  )!;
  const checkbox = wrapper.querySelector<HTMLElement>(
    ".emr-diff-task-state-change",
  )!;
  const wrapperRect = wrapper.getBoundingClientRect();
  const checkboxRect = checkbox.getBoundingClientRect();
  const checkboxCenter = checkboxRect.left + checkboxRect.width / 2;
  if (
    wrapper.dataset.diffTooltip !==
      "Checklist item changed from unchecked to checked" ||
    wrapper.hasAttribute("title") ||
    checkbox.hasAttribute("title") ||
    checkboxCenter < wrapperRect.left ||
    checkboxCenter > wrapperRect.right ||
    getComputedStyle(wrapper, "::after").left !== "0px"
  ) {
    throw new Error(
      "checklist tooltip is not anchored to the changed checkbox",
    );
  }
  wrapper.focus();
  await waitFor(() => {
    if (getComputedStyle(wrapper, "::after").opacity !== "1") {
      throw new Error("checklist tooltip is not visible on keyboard focus");
    }
  });
  wrapper.blur();
}

export const BlockConfidenceLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-block-confidence.md",
  },
  play: async ({ canvasElement }) => {
    await waitForBlockConfidence(canvasElement);
  },
};

export const BlockConfidenceDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-block-confidence-dark.md",
  },
  play: async ({ canvasElement }) => {
    await waitForBlockConfidence(canvasElement);
  },
};

export const BlockConfidenceHoverLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-block-confidence-hover.md",
  },
  play: async ({ canvasElement }) => {
    await prepareBlockDisclosureHover(canvasElement);
  },
};

export const BlockConfidenceHoverDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-block-confidence-hover-dark.md",
  },
  play: async ({ canvasElement }) => {
    await prepareBlockDisclosureHover(canvasElement);
  },
};

/**
 * Browser/OS text inflation can enlarge fixed-pixel button text independently
 * of its box. The chip must grow on one line rather than wrapping its last
 * letter below the 18px control.
 */
export const BeforeChipTextInflation: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <style>{`.emr-diff-before-trigger { font-size: 13px !important; }`}</style>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-before-chip-text-inflation.md",
  },
  play: async ({ canvasElement }) => {
    await waitForBlockConfidenceReady(canvasElement);
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    trigger.focus();
    await waitFor(() => {
      if (getComputedStyle(trigger).opacity !== "1") {
        throw new Error("inflated Before chip is not visible");
      }
    });
  },
};

/** An unusually narrow comparison owner must clip the label, never overrun it. */
export const BeforeChipNarrowOwner: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-before-chip-narrow-owner.md",
  },
  play: async ({ canvasElement }) => {
    await waitForBlockConfidenceReady(canvasElement);
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-diff-before-trigger",
    )!;
    const owner = trigger.closest<HTMLElement>(".emr-section")!;
    owner.style.width = "32px";
    trigger.focus();
    await waitFor(() => {
      const ownerRect = owner.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const style = getComputedStyle(trigger);
      if (
        triggerRect.left < ownerRect.left ||
        triggerRect.right > ownerRect.right ||
        triggerRect.height > 19 ||
        style.overflow !== "hidden" ||
        style.whiteSpace !== "nowrap"
      ) {
        throw new Error(
          `narrow Before chip escaped its owner: trigger=${JSON.stringify({ left: triggerRect.left, right: triggerRect.right, width: triggerRect.width, height: triggerRect.height })} owner=${JSON.stringify({ left: ownerRect.left, right: ownerRect.right, width: ownerRect.width })}`,
        );
      }
    });
  },
};

export const PreciseAmberTooltipLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-precise-amber-tooltip.md",
  },
  play: async ({ canvasElement }) => {
    await preparePreciseAmberTooltip(canvasElement);
  },
};

export const PreciseAmberTooltipDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-precise-amber-tooltip-dark.md",
  },
  play: async ({ canvasElement }) => {
    await preparePreciseAmberTooltip(canvasElement);
  },
};

export const ChecklistStateTooltipLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-checklist-state-tooltip.md",
  },
  play: async ({ canvasElement }) => {
    await prepareChecklistStateTooltip(canvasElement);
  },
};

export const ChecklistStateTooltipDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(BLOCK_CONFIDENCE_SOURCE),
    originalSource: BLOCK_CONFIDENCE_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: BLOCK_CONFIDENCE_DIFF,
    storageKey: "visual-checklist-state-tooltip-dark.md",
  },
  play: async ({ canvasElement }) => {
    await prepareChecklistStateTooltip(canvasElement);
  },
};

const INLINE_PARITY_SOURCE = [
  /*  1 */ "# Shared Inline Diff Semantics",
  /*  2 */ "",
  /*  3 */ "## Combined Marker and Checklist State",
  /*  4 */ "",
  /*  5 */ "- [x] Confirm the release owner.",
  /*  6 */ "",
  /*  7 */ "## Formatting and Link Target",
  /*  8 */ "",
  /*  9 */ "| Resource | Link |",
  /* 10 */ "| --- | --- |",
  /* 11 */ "| Guide | [**Incident guide**](https://example.com/v2) |",
  /* 12 */ "",
  /* 13 */ "## Text and Image Metadata",
  /* 14 */ "",
  /* 15 */ "| Preview |",
  /* 16 */ "| --- |",
  /* 17 */ "| Current ![Architecture](https://example.com/v2.png) |",
].join("\n");

const INLINE_PARITY_ORIGINAL = [
  "# Shared Inline Diff Semantics",
  "",
  "## Combined Marker and Checklist State",
  "",
  "1. [ ] Confirm the release owner.",
  "",
  "## Formatting and Link Target",
  "",
  "| Resource | Link |",
  "| --- | --- |",
  "| Guide | [Incident guide](https://example.com/v1) |",
  "",
  "## Text and Image Metadata",
  "",
  "| Preview |",
  "| --- |",
  "| Legacy ![Architecture](https://example.com/v1.png) |",
].join("\n");

const INLINE_PARITY_DIFF: DiffRange[] = [
  {
    startLine: 5,
    endLine: 5,
    kind: "modified",
    originalStartLine: 5,
    originalEndLine: 5,
    originalText: "1. [ ] Confirm the release owner.",
  },
  {
    startLine: 11,
    endLine: 11,
    kind: "modified",
    originalStartLine: 11,
    originalEndLine: 11,
    originalText: "| Guide | [Incident guide](https://example.com/v1) |",
  },
  {
    startLine: 17,
    endLine: 17,
    kind: "modified",
    originalStartLine: 17,
    originalEndLine: 17,
    originalText: "| Legacy ![Architecture](https://example.com/v1.png) |",
  },
];

async function prepareInlineParity(canvasElement: HTMLElement): Promise<void> {
  await waitFor(() => {
    const item = canvasElement.querySelector<HTMLElement>(
      'li[data-diff-tooltip^="List item changed:"]',
    );
    const cells = canvasElement.querySelectorAll<HTMLElement>("tbody td");
    if (
      !item ||
      item.querySelector(".emr-diff-task-tooltip-anchor") ||
      !item.querySelector(".emr-diff-task-state-change") ||
      !cells[1]?.querySelector(".emr-diff-format-change") ||
      !cells[1]?.querySelector(".emr-diff-metadata") ||
      !cells[2]?.querySelector(".emr-word-added") ||
      !cells[2]?.querySelector(".emr-diff-metadata")
    ) {
      throw new Error("shared inline parity examples are incomplete");
    }
  });
}

export const InlineParityLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(INLINE_PARITY_SOURCE),
    originalSource: INLINE_PARITY_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: INLINE_PARITY_DIFF,
    storageKey: "visual-inline-parity.md",
  },
  play: async ({ canvasElement }) => {
    await prepareInlineParity(canvasElement);
  },
};

export const InlineParityDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(INLINE_PARITY_SOURCE),
    originalSource: INLINE_PARITY_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: INLINE_PARITY_DIFF,
    storageKey: "visual-inline-parity-dark.md",
  },
  play: async ({ canvasElement }) => {
    await prepareInlineParity(canvasElement);
  },
};

const PRODUCTION_SYNTAX_SOURCE = [
  /*  1 */ "# Production Documentation Syntax",
  /*  2 */ "",
  /*  3 */ "[guide]: docs/current-guide.md",
  /*  4 */ "",
  /*  5 */ "Read the [deployment guide][guide] before continuing.",
  /*  6 */ "",
  /*  7 */ "> [!NOTE]",
  /*  8 */ "> The browser may omit capabilities from the object.",
  /*  9 */ "",
  /* 10 */ "<details open>",
  /* 11 */ "<summary>Common question</summary>",
  /* 12 */ "",
  /* 13 */ "The current answer remains visible.",
  /* 14 */ "",
  /* 15 */ "</details>",
  /* 16 */ "",
  /* 17 */ '```js [[1, 3, "updateName"], [2, 25, "submitAction"]]',
  /* 18 */ '"use client";',
  /* 19 */ "```",
].join("\n");

const PRODUCTION_SYNTAX_ORIGINAL = [
  "# Production Documentation Syntax",
  "",
  "[guide]: http://localhost:3000/docs/current-guide.md",
  "",
  "Read the [deployment guide][guide] before continuing.",
  "",
  "> [!NOTE]",
  "> The browser may omit capabilities from the map.",
  "",
  "<details open>",
  "<summary>Common question</summary>",
  "",
  "The previous answer remains visible.",
  "",
  "</details>",
  "",
  '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
  '"use client";',
  "```",
].join("\n");

const PRODUCTION_SYNTAX_DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalStartLine: 3,
    originalEndLine: 3,
    originalText: "[guide]: http://localhost:3000/docs/current-guide.md",
  },
  {
    startLine: 8,
    endLine: 8,
    kind: "modified",
    originalStartLine: 8,
    originalEndLine: 8,
    originalText: "> The browser may omit capabilities from the map.",
  },
  {
    startLine: 13,
    endLine: 13,
    kind: "modified",
    originalStartLine: 13,
    originalEndLine: 13,
    originalText: "The previous answer remains visible.",
  },
  {
    startLine: 17,
    endLine: 17,
    kind: "modified",
    originalStartLine: 17,
    originalEndLine: 17,
    originalText: '```js [[1, 3, "updateName"], [2, 23, "submitAction"]]',
  },
];

async function prepareProductionSyntax(
  canvasElement: HTMLElement,
): Promise<void> {
  await waitFor(() => {
    if (!canvasElement.querySelector(".emr-diff-source-only")) {
      throw new Error("source-only reference diff missing");
    }
    if (!canvasElement.querySelector("details[open] .emr-word-added")) {
      throw new Error("details body diff missing");
    }
    if (!canvasElement.querySelector(".markdown-alert .emr-word-added")) {
      throw new Error("admonition body diff missing");
    }
    if (!canvasElement.querySelector("pre .emr-diff-metadata")) {
      throw new Error("code fence metadata diff missing");
    }
  });
  const metadataTrigger = canvasElement.querySelector<HTMLButtonElement>(
    "pre .emr-diff-metadata-trigger",
  )!;
  if (metadataTrigger.scrollWidth > metadataTrigger.clientWidth) {
    throw new Error("code fence metadata label overflows its trigger");
  }
  const trigger = canvasElement.querySelector<HTMLButtonElement>(
    ".emr-diff-source-only .emr-diff-before-trigger",
  )!;
  trigger.click();
  await waitFor(() => {
    if (
      canvasElement.querySelector(
        ".emr-diff-source-only .emr-diff-before-panel:not([hidden])",
      ) === null
    ) {
      throw new Error("source-only Before panel did not open");
    }
  });
}

export const ProductionSyntaxLight: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame>
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(PRODUCTION_SYNTAX_SOURCE),
    currentSource: PRODUCTION_SYNTAX_SOURCE,
    originalSource: PRODUCTION_SYNTAX_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: PRODUCTION_SYNTAX_DIFF,
    storageKey: "visual-production-syntax.md",
  },
  play: async ({ canvasElement }) => {
    await prepareProductionSyntax(canvasElement);
  },
};

export const ProductionSyntaxDark: Story = {
  decorators: [
    (Story) => (
      <ThemeFrame theme="dark">
        <Story />
      </ThemeFrame>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(PRODUCTION_SYNTAX_SOURCE),
    currentSource: PRODUCTION_SYNTAX_SOURCE,
    originalSource: PRODUCTION_SYNTAX_ORIGINAL,
    threads: [],
    activeThreadId: null,
    diff: PRODUCTION_SYNTAX_DIFF,
    storageKey: "visual-production-syntax-dark.md",
  },
  play: async ({ canvasElement }) => {
    await prepareProductionSyntax(canvasElement);
  },
};

const EDGE_DESTINATION =
  "https://example.com/platform/deployments/regions/primary/secondary/canary/rings/validation/health/checks/owners/approvals/matrix";
const TOOLTIP_EDGE_SOURCE = [
  "# Tooltip Edge Matrix",
  "",
  `[Left edge guide](${EDGE_DESTINATION})`,
  "",
  `Open the [right edge guide](${EDGE_DESTINATION})`,
].join("\n");
const TOOLTIP_EDGE_ORIGINAL = [
  "# Tooltip Edge Matrix",
  "",
  "Left edge guide",
  "",
  "Open the right edge guide",
].join("\n");
const TOOLTIP_EDGE_DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalStartLine: 3,
    originalEndLine: 3,
    originalText: "Left edge guide",
  },
  {
    startLine: 5,
    endLine: 5,
    kind: "modified",
    originalStartLine: 5,
    originalEndLine: 5,
    originalText: "Open the right edge guide",
  },
];

async function prepareTooltipEdges(canvasElement: HTMLElement): Promise<void> {
  await waitFor(() => {
    if (
      canvasElement.querySelectorAll<HTMLElement>(
        '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
      ).length !== 2
    ) {
      throw new Error("tooltip edge examples not rendered");
    }
  });
  const paragraphs = canvasElement.querySelectorAll<HTMLElement>("p");
  paragraphs[1]!.style.textAlign = "right";
  const marks = canvasElement.querySelectorAll<HTMLElement>(
    '.emr-diff-format-change[data-diff-tooltip^="Link added:"]',
  );
  marks[0]!.focus();
  if (marks[0]!.classList.contains("emr-diff-explained-change--right")) {
    throw new Error("left-edge tooltip aligned outward");
  }
  marks[0]!.blur();
  marks[1]!.focus();
  if (!marks[1]!.classList.contains("emr-diff-explained-change--right")) {
    throw new Error("right-edge tooltip aligned outward");
  }
  marks[1]!.blur();
}

function tooltipEdgeDecorator(
  theme?: "dark" | "hc-light" | "hc-dark",
): (Story: React.ComponentType) => React.ReactElement {
  return (Story) => (
    <ThemeFrame theme={theme} width={360}>
      <Story />
    </ThemeFrame>
  );
}

const TOOLTIP_EDGE_ARGS = {
  pristineHtml: renderMarkdownSync(TOOLTIP_EDGE_SOURCE),
  originalSource: TOOLTIP_EDGE_ORIGINAL,
  threads: [],
  activeThreadId: null,
  diff: TOOLTIP_EDGE_DIFF,
  storageKey: "visual-tooltip-edges.md",
};

export const TooltipEdgesLight: Story = {
  decorators: [tooltipEdgeDecorator()],
  args: TOOLTIP_EDGE_ARGS,
  play: async ({ canvasElement }) => {
    await prepareTooltipEdges(canvasElement);
  },
};

export const TooltipEdgesDark: Story = {
  decorators: [tooltipEdgeDecorator("dark")],
  args: { ...TOOLTIP_EDGE_ARGS, storageKey: "visual-tooltip-edges-dark.md" },
  play: async ({ canvasElement }) => {
    await prepareTooltipEdges(canvasElement);
  },
};

export const TooltipEdgesHighContrastLight: Story = {
  decorators: [tooltipEdgeDecorator("hc-light")],
  args: { ...TOOLTIP_EDGE_ARGS, storageKey: "visual-tooltip-edges-hcl.md" },
  play: async ({ canvasElement }) => {
    await prepareTooltipEdges(canvasElement);
  },
};

export const TooltipEdgesHighContrastDark: Story = {
  decorators: [tooltipEdgeDecorator("hc-dark")],
  args: { ...TOOLTIP_EDGE_ARGS, storageKey: "visual-tooltip-edges-hcd.md" },
  play: async ({ canvasElement }) => {
    await prepareTooltipEdges(canvasElement);
  },
};
