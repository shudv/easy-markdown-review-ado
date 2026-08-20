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

const PR: PrInfo = {
  prId: 42,
  title: "Rework the widget guide",
  authorName: shubhd.displayName,
  files: [
    { path: GUIDE, changeType: "modified", linesAdded: 9, linesDeleted: 2 },
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
