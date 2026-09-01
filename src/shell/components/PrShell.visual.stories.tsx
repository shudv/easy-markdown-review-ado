// Visual-regression fixture: the PR tab (`PrShell`) rendered with a rich,
// fully deterministic set of fake data — a modified document carrying diff
// decorations (added / edited / removed) plus seeded comment threads.
//
// This story exists ONLY to be screenshotted by the curated visual suite
// (visual/curated.visual.spec.ts). It renders a stable end-to-end picture
// of the reader + rail + diff highlighting so a CSS/layout regression is caught
// pixel-for-pixel. It deliberately avoids Mermaid and any time/animation so the
// frame is byte-stable across runs. Interactive behaviour lives in
// PrShell.stories.tsx; keep this one static.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor } from "storybook/test";

import { FIXTURE_AUTHORS } from "../../comments/fixtures";
import type { CommentThread, DiffRange, PrInfo } from "../../types";
import { PrShell } from "../PrShell";
import { writeReaderPrefs, DEFAULT_READER_PREFS } from "../readerPrefs";

const alex = FIXTURE_AUTHORS.alex!;
const shubhd = FIXTURE_AUTHORS.shubhd!;
const jamie = FIXTURE_AUTHORS.jamie!;

const GUIDE = "/widget-guide.md";

type Rgba = [number, number, number, number];

function parseRenderedColor(color: string): Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha / 255];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    (foreground[0] * foreground[3] +
      background[0] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[1] * foreground[3] +
      background[1] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[2] * foreground[3] +
      background[2] * background[3] * (1 - foreground[3])) /
      alpha,
    alpha,
  ];
}

function renderedBackground(
  element: HTMLElement,
  includeElement: boolean,
): Rgba {
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = includeElement
    ? element
    : element.parentElement;
  while (current) {
    ancestors.unshift(current);
    current = current.parentElement;
  }
  return ancestors.reduce<Rgba>(
    (background, ancestor) => {
      const color = parseRenderedColor(
        getComputedStyle(ancestor).backgroundColor,
      );
      return color[3] > 0 ? composite(color, background) : background;
    },
    [255, 255, 255, 1],
  );
}

function relativeLuminance(color: Rgba): number {
  const linear = color.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

// Line numbers matter: the diff ranges below reference these 1-based source
// lines, so keep the layout stable if you edit the prose.
const SOURCE = [
  /*  1 */ "# Widget Guide",
  /*  2 */ "",
  /*  3 */ "The widget boots the host iframe and injects the resolved configuration.",
  /*  4 */ "",
  /*  5 */ "## Startup Sequence",
  /*  6 */ "",
  /*  7 */ "1. Validate the widget manifest and its declared permissions up front.",
  /*  8 */ "2. Allocate a sandboxed iframe for the widget to run in.",
  /*  9 */ "3. Inject the configuration payload into the frame.",
  /* 10 */ "4. Emit the ready event once the first paint completes.",
  /* 11 */ "",
  /* 12 */ "## Deployment Regions",
  /* 13 */ "",
  /* 14 */ "- Americas",
  /* 15 */ "  - us-east",
  /* 16 */ "  - us-west-2",
  /* 17 */ "- Europe",
  /* 18 */ "  - eu-west",
  /* 19 */ "",
  // Unchanged trailing content (no diff ranges reference lines past 18) so the
  // reader overflows the viewport and the custom diff scrollbar appears.
  /* 20 */ "## Configuration",
  /* 21 */ "",
  /* 22 */ "Configuration is resolved from the host and merged with per-widget defaults.",
  /* 23 */ "",
  /* 24 */ "| Option  | Default |",
  /* 25 */ "| ------- | ------- |",
  /* 26 */ "| theme   | dark    |",
  /* 27 */ "| retries | 5       |",
  /* 28 */ "",
  /* 29 */ "## Troubleshooting",
  /* 30 */ "",
  /* 31 */ "If the widget fails to boot, check the browser console for a CSP violation.",
  /* 32 */ "",
  /* 33 */ "> Tip: keep the manifest under version control so changes stay reviewable.",
  /* 34 */ "",
  /* 35 */ "## FAQ",
  /* 36 */ "",
  /* 37 */ "Answers to common questions about embedding and lifecycle management follow.",
  /* 38 */ "",
  /* 39 */ "Each widget runs isolated; state is never shared across host frames.",
  /* 40 */ "",
].join("\n");

const SOURCES: Record<string, string> = { [GUIDE]: SOURCE };

function makeLoad(): (path: string) => Promise<string> {
  return async (path: string) => {
    const src = SOURCES[path];
    if (src == null) throw new Error(`No source for ${path}`);
    return src;
  };
}

const SHOWCASE_SOURCE = [
  /*  1 */ "# Production Rollout",
  /*  2 */ "",
  /*  3 */ "Review the [deployment runbook](https://example.com/runbooks/deploy-v2) before using the resolved configuration.",
  /*  4 */ "",
  /*  5 */ "## Service Plan",
  /*  6 */ "",
  /*  7 */ "| Service | Owner    | Window    |",
  /*  8 */ "| ------- | -------- | --------- |",
  /*  9 */ "| API     | Platform | 02:00 UTC |",
  /* 10 */ "| Web     | Frontend | 04:00 UTC |",
  /* 11 */ "| Worker  | Runtime  | 06:00 UTC |",
  /* 12 */ "",
  /* 13 */ "## Release Checks",
  /* 14 */ "",
  /* 15 */ "1. Confirm health checks in every active region.",
  /* 16 */ "2. Publish the release summary after rollout.",
  /* 17 */ "",
  /* 18 */ "## Recovery",
  /* 19 */ "",
  /* 20 */ "Roll back to the previous artifact if regional health checks fail.",
  /* 21 */ "",
].join("\n");

const SHOWCASE_DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalText:
      "Review the [deployment runbook](https://example.com/runbooks/deploy-v1) before using the resolved configuration.",
    linesAdded: 1,
    linesDeleted: 1,
  },
  { startLine: 10, endLine: 10, kind: "added", linesAdded: 1 },
  {
    startLine: 11,
    endLine: 11,
    kind: "deleted-marker",
    linesDeleted: 1,
    deletedContent: "| Notifications | Messaging | 05:00 UTC |",
  },
];

function makeShowcaseLoad(): (path: string) => Promise<string> {
  return async (path: string) => {
    if (path !== GUIDE) throw new Error(`No showcase source for ${path}`);
    return SHOWCASE_SOURCE;
  };
}

const PR: PrInfo = {
  prId: 42,
  title: "Rework the widget guide",
  authorName: shubhd.displayName,
  files: [
    { path: GUIDE, changeType: "modified", linesAdded: 9, linesDeleted: 2 },
  ],
};

const SHOWCASE_PR: PrInfo = {
  ...PR,
  title: "Refresh the production rollout",
  files: [
    { path: GUIDE, changeType: "modified", linesAdded: 2, linesDeleted: 2 },
  ],
};

// Added (green wash): the whole new "Deployment Regions" section + its list.
// Modified (amber wash): the reworded intro sentence and the first step.
// Deleted marker (red): a removed sentence that used to sit under the heading.
const DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    linesAdded: 1,
    linesDeleted: 1,
  },
  {
    startLine: 7,
    endLine: 7,
    kind: "modified",
    linesAdded: 1,
    linesDeleted: 1,
  },
  { startLine: 10, endLine: 10, kind: "added", linesAdded: 1 },
  { startLine: 12, endLine: 18, kind: "added", linesAdded: 7 },
  {
    startLine: 5,
    endLine: 5,
    kind: "deleted-marker",
    linesDeleted: 1,
    deletedContent: "Older builds skipped manifest validation entirely.",
  },
];

function threads(): CommentThread[] {
  return [
    {
      id: "t-active",
      filePath: GUIDE,
      status: "active",
      anchor: {
        exact: "sandboxed iframe",
        prefix: "Allocate a ",
        suffix: " for the widget",
      },
      comments: [
        {
          id: "c1",
          author: alex,
          bodyMarkdown: "Should we note the CSP the sandbox enforces here?",
          createdAt: "2026-01-01T10:00:00.000Z",
          reactions: [
            {
              kind: "like",
              users: [{ id: jamie.id, displayName: jamie.displayName }],
            },
          ],
        },
        {
          id: "c2",
          author: shubhd,
          bodyMarkdown: "Good call — I'll add a sentence about the CSP.",
          createdAt: "2026-01-01T11:00:00.000Z",
        },
      ],
    },
    {
      id: "t-resolved",
      filePath: GUIDE,
      status: "resolved",
      anchor: {
        exact: "Deployment Regions",
        prefix: "## ",
        suffix: "",
      },
      comments: [
        {
          id: "c3",
          author: jamie,
          bodyMarkdown: "Regions section looks complete now.",
          createdAt: "2026-01-02T09:00:00.000Z",
        },
      ],
    },
  ];
}

const meta = {
  title: "Visual/PrTab",
  component: PrShell,
  parameters: { layout: "fullscreen" },
  // Reader prefs persist to localStorage; clear before each so a pref set in
  // another story never perturbs the baseline.
  beforeEach: () => {
    localStorage.clear();
  },
  decorators: [
    (Story) => (
      // Fill the viewport so the full comment rail is captured (a fixed short
      // height clips the balloons). The spec screenshots `#storybook-root`.
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    pr: PR,
    loadFileSource: makeLoad(),
    diffsByFile: { [GUIDE]: DIFF },
    initialThreads: threads(),
    currentUser: shubhd,
  },
} satisfies Meta<typeof PrShell>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default, settled picture: diff washes applied and the comment highlight
 * wrapped. The visual spec waits for `.emr-diff-block` + `.emr-highlight`
 * before shooting, so no interaction is needed here.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (!canvasElement.querySelector(".emr-diff-block")) {
          throw new Error("diff not decorated yet");
        }
        if (!canvasElement.querySelector(".emr-highlight")) {
          throw new Error("highlight not wrapped yet");
        }
      },
      { timeout: 5000 },
    );
  },
};

/** Focused README tour: one changed link, one added row, one deleted row. */
export const Showcase: Story = {
  args: {
    pr: SHOWCASE_PR,
    loadFileSource: makeShowcaseLoad(),
    diffsByFile: { [GUIDE]: SHOWCASE_DIFF },
    initialThreads: [],
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (
          !canvasElement.querySelector(
            '.emr-diff-metadata-trigger[aria-label="Show link target change"]',
          )
        ) {
          throw new Error("link target diff not decorated yet");
        }
        if (!canvasElement.querySelector("tr.emr-diff-block--added")) {
          throw new Error("added table row not decorated yet");
        }
        const deletedRow = canvasElement.querySelector<HTMLTableRowElement>(
          "tr.emr-diff-deleted-table-row",
        );
        if (!deletedRow || deletedRow.hidden) {
          throw new Error("deleted table row not rendered yet");
        }
      },
      { timeout: 5000 },
    );
  },
};

const COLLISION_THREADS: CommentThread[] = [
  {
    id: "t-modified-anchor",
    filePath: GUIDE,
    status: "active",
    anchor: {
      exact: "declared permissions",
      prefix: "manifest and its ",
      suffix: " up front",
    },
    comments: [
      {
        id: "c-modified-anchor",
        author: alex,
        bodyMarkdown: "Should this name the minimum permission set?",
        createdAt: "2026-01-03T10:00:00.000Z",
      },
    ],
  },
  {
    id: "t-added-anchor",
    filePath: GUIDE,
    status: "active",
    anchor: {
      exact: "Americas",
      prefix: "- ",
      suffix: "\n  - us-east",
    },
    comments: [
      {
        id: "c-added-anchor",
        author: jamie,
        bodyMarkdown: "Can we confirm this list matches the rollout plan?",
        createdAt: "2026-01-03T11:00:00.000Z",
      },
    ],
  },
  {
    id: "t-plain-anchor",
    filePath: GUIDE,
    status: "active",
    anchor: {
      exact: "per-widget defaults",
      prefix: "merged with ",
      suffix: ".",
    },
    comments: [
      {
        id: "c-plain-anchor",
        author: shubhd,
        bodyMarkdown: "This resolved anchor remains legible without a wash.",
        createdAt: "2026-01-03T12:00:00.000Z",
      },
    ],
  },
];

const COLLISION_DIFF: DiffRange[] = DIFF.map((range) =>
  range.startLine === 7 && range.kind === "modified"
    ? {
        ...range,
        originalText:
          "1. Validate the widget manifest and its permissions up front.",
      }
    : range,
);

/**
 * Full reader + rail demonstration of comment anchors over amber and green
 * change decoration. Diff colour owns every background; one underline carries
 * comment state consistently across changed and unchanged text.
 */
export const CommentAnchorDiffCollision: Story = {
  args: {
    diffsByFile: { [GUIDE]: COLLISION_DIFF },
    initialThreads: COLLISION_THREADS,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (
        canvasElement.querySelectorAll(".emr-highlight").length !== 3 ||
        canvasElement.querySelectorAll(".emr-diff-block").length === 0
      ) {
        throw new Error("comment/diff collision fixture not settled");
      }
    });

    const highlights = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".emr-highlight"),
    );
    for (const highlight of highlights) {
      await expect(getComputedStyle(highlight).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
      await expect(highlight.getAttribute("role")).toBe("button");
      await expect(highlight.tabIndex).toBe(0);
      await expect(getComputedStyle(highlight).textDecorationLine).toContain(
        "underline",
      );
      await expect(getComputedStyle(highlight).textDecorationStyle).toBe(
        "dotted",
      );
      await expect(
        Number.parseFloat(getComputedStyle(highlight).textDecorationThickness),
      ).toBeCloseTo(3.48, 3);
      await expect(
        Number.parseFloat(getComputedStyle(highlight).textUnderlineOffset),
      ).toBeCloseTo(3.9875, 3);
    }
    const inlineAnchor = canvasElement.querySelector<HTMLElement>(
      '[data-thread-id="t-modified-anchor"]',
    )!;
    const addedWord =
      inlineAnchor.querySelector<HTMLElement>(".emr-word-added")!;
    await expect(addedWord).toBeTruthy();
    await expect(getComputedStyle(addedWord).backgroundColor).not.toBe(
      getComputedStyle(inlineAnchor).backgroundColor,
    );
    const inlineBackground = renderedBackground(addedWord, true);
    const inlineUnderline = composite(
      parseRenderedColor(getComputedStyle(inlineAnchor).textDecorationColor),
      inlineBackground,
    );
    await expect(
      contrastRatio(inlineUnderline, inlineBackground),
    ).toBeGreaterThanOrEqual(3);

    const resolvedAnchor = canvasElement.querySelector<HTMLElement>(
      '[data-thread-id="t-plain-anchor"]',
    )!;
    resolvedAnchor.classList.add("is-resolved");
    await expect(resolvedAnchor.classList.contains("is-resolved")).toBe(true);
    await expect(getComputedStyle(resolvedAnchor).textDecorationStyle).toBe(
      "dotted",
    );
    const resolvedBackground = renderedBackground(resolvedAnchor, false);
    const resolvedUnderline = composite(
      parseRenderedColor(getComputedStyle(resolvedAnchor).textDecorationColor),
      resolvedBackground,
    );
    await expect(
      contrastRatio(resolvedUnderline, resolvedBackground),
    ).toBeGreaterThanOrEqual(3);

    const added = canvasElement.querySelector<HTMLElement>(
      '[data-thread-id="t-added-anchor"]',
    )!;
    const idleStyle = getComputedStyle(added);
    const landingWash =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--emr-anchor-land-wash",
        ),
      ) / 100;
    const landingAccent = parseRenderedColor(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--emr-anchor-active",
      ),
    );
    const landingBackground = renderedBackground(added, false);
    const peakLandingBackground = composite(
      [landingAccent[0], landingAccent[1], landingAccent[2], landingWash],
      landingBackground,
    );
    await expect(
      contrastRatio(parseRenderedColor(idleStyle.color), peakLandingBackground),
    ).toBeGreaterThanOrEqual(4.5);
    const idleBackground = idleStyle.backgroundColor;
    const idleUnderlineStyle = idleStyle.textDecorationStyle;
    const idleRect = added.getBoundingClientRect();
    added.click();
    await waitFor(() =>
      expect(added.classList.contains("is-active")).toBe(true),
    );
    await waitFor(() =>
      expect(
        Number.parseFloat(getComputedStyle(added).textDecorationThickness),
      ).toBeCloseTo(3.9875, 3),
    );
    await expect(getComputedStyle(added).textDecorationStyle).toBe("solid");
    await expect(getComputedStyle(added).animationName).toBe("emr-anchor-land");
    await expect(getComputedStyle(added).boxShadow).not.toBe("none");
    await expect(getComputedStyle(added).boxDecorationBreak).toBe("clone");
    await waitFor(
      () =>
        expect(getComputedStyle(added).backgroundColor).toBe(
          "rgba(0, 0, 0, 0)",
        ),
      { timeout: 3000 },
    );
    const selectedStyle = getComputedStyle(added);
    const selectedRect = added.getBoundingClientRect();
    await expect(selectedStyle.backgroundColor).toBe(idleBackground);
    await expect(selectedStyle.textDecorationStyle).not.toBe(
      idleUnderlineStyle,
    );
    await expect(selectedRect.bottom).toBeCloseTo(idleRect.bottom, 3);
    await expect(selectedRect.height).toBeCloseTo(idleRect.height, 3);
    await expect(
      canvasElement.querySelector(
        '.emr-balloon.is-active[data-thread-id="t-added-anchor"]',
      ),
    ).toBeTruthy();

    const measureIntroText = (): DOMRect => {
      const intro = canvasElement.querySelector<HTMLElement>(
        '.emr-rendered p[data-source-line="3"]',
      )!;
      const walker = document.createTreeWalker(intro, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (
        text &&
        !text.textContent?.includes("The widget boots the host iframe")
      ) {
        text = walker.nextNode();
      }
      if (!text) throw new Error("intro text node not found");
      const range = document.createRange();
      range.selectNodeContents(text);
      return range.getBoundingClientRect();
    };
    const withChanges = measureIntroText();
    canvasElement
      .querySelector<HTMLButtonElement>(".emr-statusbar-changes")!
      .click();
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-diff-block")).toBeNull(),
    );
    const withoutChanges = measureIntroText();
    await expect(withChanges.left).toBeCloseTo(withoutChanges.left, 3);
    await expect(withChanges.top).toBeCloseTo(withoutChanges.top, 3);
    await expect(withChanges.width).toBeCloseTo(withoutChanges.width, 3);
    await expect(withChanges.height).toBeCloseTo(withoutChanges.height, 3);
    canvasElement
      .querySelector<HTMLButtonElement>(".emr-statusbar-changes")!
      .click();
    await waitFor(() =>
      expect(canvasElement.querySelector(".emr-diff-block")).toBeTruthy(),
    );
    canvasElement
      .querySelector<HTMLElement>('[data-thread-id="t-added-anchor"]')!
      .click();
    await waitFor(() =>
      expect(
        canvasElement.querySelector(
          '.emr-highlight.is-active[data-thread-id="t-added-anchor"]',
        ),
      ).toBeTruthy(),
    );
  },
};

/**
 * The same integrated picture under the dark theme, so a dark-mode regression
 * (which the light-only `Default` shot would miss) is caught. Sets
 * `data-emr-theme="dark"` on the document root for the story's lifetime.
 */
export const Dark: Story = {
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        const el = document.documentElement;
        const prev = el.getAttribute("data-emr-theme");
        el.setAttribute("data-emr-theme", "dark");
        return () => {
          if (prev) el.setAttribute("data-emr-theme", prev);
          else el.removeAttribute("data-emr-theme");
        };
      }, []);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (!canvasElement.querySelector(".emr-diff-block")) {
          throw new Error("diff not decorated yet");
        }
        if (!canvasElement.querySelector(".emr-highlight")) {
          throw new Error("highlight not wrapped yet");
        }
      },
      { timeout: 5000 },
    );
  },
};

export const CommentAnchorDiffCollisionDark: Story = {
  ...CommentAnchorDiffCollision,
  decorators: Dark.decorators,
};

/**
 * Full reader under Windows-style high contrast. The diff ruler owns the right
 * gutter, so the document card must not add a second vertical edge beside it;
 * its horizontal bottom edge remains intact.
 */
export const HighContrastDark: Story = {
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        const el = document.documentElement;
        const prev = el.getAttribute("data-emr-theme");
        el.setAttribute("data-emr-theme", "hc-dark");
        return () => {
          if (prev) el.setAttribute("data-emr-theme", prev);
          else el.removeAttribute("data-emr-theme");
        };
      }, []);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const body = canvasElement.querySelector<HTMLElement>(".emr-body");
        if (!body || !canvasElement.querySelector(".emr-diff-block")) {
          throw new Error("high-contrast reader not settled yet");
        }
        const style = getComputedStyle(body);
        expect(style.borderRightColor).toBe("rgb(255, 255, 255)");
        expect(style.borderBottomColor).toBe("rgb(255, 255, 255)");
        const bodyBottom = body.getBoundingClientRect().bottom;
        expect(
          canvasElement
            .querySelector<HTMLElement>(".emr-body__nav")!
            .getBoundingClientRect().bottom,
        ).toBeCloseTo(bodyBottom, 1);
        expect(
          canvasElement
            .querySelector<HTMLElement>(".emr-rail-scroll")!
            .getBoundingClientRect().bottom,
        ).toBeCloseTo(bodyBottom, 1);
      },
      { timeout: 5000 },
    );
  },
};

export const CommentAnchorDiffCollisionHighContrastLight: Story = {
  ...CommentAnchorDiffCollision,
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        const element = document.documentElement;
        const previousTheme = element.getAttribute("data-emr-theme");
        element.setAttribute("data-emr-theme", "hc-light");
        return () => {
          if (previousTheme) {
            element.setAttribute("data-emr-theme", previousTheme);
          } else {
            element.removeAttribute("data-emr-theme");
          }
        };
      }, []);
      return <Story />;
    },
  ],
};

export const CommentAnchorDiffCollisionHighContrastDark: Story = {
  ...CommentAnchorDiffCollision,
  decorators: HighContrastDark.decorators,
};

/** High contrast with both side panes hidden: no pane divider may remain. */
export const HighContrastDarkCollapsed: Story = {
  beforeEach: () => {
    localStorage.clear();
    writeReaderPrefs("pr", {
      ...DEFAULT_READER_PREFS,
      showNav: false,
      showComments: false,
    });
  },
  decorators: HighContrastDark.decorators,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const body = canvasElement.querySelector<HTMLElement>(".emr-body");
      if (!body || !canvasElement.querySelector(".emr-diff-block")) {
        throw new Error("collapsed high-contrast reader not settled yet");
      }
      expect(getComputedStyle(body).borderBottomColor).toBe(
        "rgb(255, 255, 255)",
      );
    });
    const nav = canvasElement.querySelector<HTMLElement>(".emr-body__nav");
    expect(nav ? getComputedStyle(nav).display : "none").toBe("none");
    const rail = canvasElement.querySelector<HTMLElement>(".emr-rail");
    expect(rail ? getComputedStyle(rail).display : "none").toBe("none");
  },
};

/**
 * Both side panes collapsed: the nav and comment rails are hidden and the
 * document reclaims the width, leaving a slim edge grabber reserved on each side
 * to drag a pane back open. The status bar's Navigation + Comments toggles read
 * "off".
 */
export const Collapsed: Story = {
  beforeEach: () => {
    localStorage.clear();
    writeReaderPrefs("pr", {
      ...DEFAULT_READER_PREFS,
      showNav: false,
      showComments: false,
    });
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (!canvasElement.querySelector(".emr-diff-block")) {
          throw new Error("diff not decorated yet");
        }
        if (!canvasElement.querySelector(".emr-statusbar")) {
          throw new Error("status bar not mounted yet");
        }
      },
      { timeout: 5000 },
    );
  },
};
