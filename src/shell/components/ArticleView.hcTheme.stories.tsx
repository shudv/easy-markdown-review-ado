// High-contrast prose guard. github-markdown-css bakes its colours as fixed hex,
// so under hc-light / hc-dark the rendered Markdown must be repainted from the
// --emr-* HC tokens (see the `[data-emr-theme="hc-*"] .emr-rendered.markdown-body`
// block in styles.scss) to match the chrome. These stories assert the computed
// colours in a real browser (Storybook Chromium) — no pixel baseline needed.

import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, waitFor } from "storybook/test";

import { renderMarkdownSync } from "../../markdown/render";
import { setMarkdownDark } from "../../theme/markdownStyles";
import { isDarkTheme, type EmrTheme } from "../../theme/theme.helpers";
import { ArticleView } from "./ArticleView";

const SOURCE = [
  "# High Contrast Check",
  "",
  "See the [official reference](https://example.com) for details, or run",
  "`widget --help` in your shell.",
  "",
  "> Keep the settings file under version control.",
  "",
].join("\n");

const HTML = renderMarkdownSync(SOURCE);

/** Applies an EMR theme + the matching github-markdown sheet for the story. */
function HcFrame({
  theme,
  children,
}: {
  theme: EmrTheme;
  children: React.ReactNode;
}): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-emr-theme");
    // Capture the markdown-sheet state too, so it's restored alongside the
    // attribute — otherwise a later story inherits this story's HC sheet.
    const prevMarkdownDark = prev ? isDarkTheme(prev as EmrTheme) : false;
    el.setAttribute("data-emr-theme", theme);
    setMarkdownDark(isDarkTheme(theme));
    return () => {
      if (prev) el.setAttribute("data-emr-theme", prev);
      else el.removeAttribute("data-emr-theme");
      setMarkdownDark(prevMarkdownDark);
    };
  }, [theme]);
  return (
    <div
      style={{
        background: "var(--emr-bg)",
        color: "var(--emr-fg)",
        padding: 24,
        width: 640,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/ArticleViewHighContrast",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  args: {
    pristineHtml: HTML,
    threads: [],
    activeThreadId: null,
    draftAnchor: null,
    diff: [],
    showDiff: false,
    storageKey: "hc-theme.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Assert the prose adopts the HC tokens rather than github-markdown-css's
 * regular light/dark hex: body text + blockquote take `--emr-fg`, links take
 * `--emr-accent`.
 */
async function assertHcProse(
  canvasElement: HTMLElement,
  expected: { fg: string; accent: string },
): Promise<void> {
  const link = await waitFor(
    () => {
      const a = canvasElement.querySelector<HTMLAnchorElement>(
        ".emr-rendered.markdown-body a",
      );
      if (!a) throw new Error("prose not rendered yet");
      return a;
    },
    { timeout: 5000 },
  );
  const body = canvasElement.querySelector<HTMLElement>(
    ".emr-rendered.markdown-body",
  )!;
  const quote = canvasElement.querySelector<HTMLElement>(
    ".emr-rendered.markdown-body blockquote",
  )!;
  expect(getComputedStyle(body).color).toBe(expected.fg);
  expect(getComputedStyle(link).color).toBe(expected.accent);
  // Regression guard: github paints blockquotes a muted grey; HC forces --emr-fg.
  expect(getComputedStyle(quote).color).toBe(expected.fg);
}

/** hc-dark: white prose text, yellow links. */
export const HighContrastDark: Story = {
  decorators: [
    (Story) => (
      <HcFrame theme="hc-dark">
        <Story />
      </HcFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await assertHcProse(canvasElement, {
      fg: "rgb(255, 255, 255)",
      accent: "rgb(255, 216, 11)",
    });
  },
};

/** hc-light: black prose text, blue links. */
export const HighContrastLight: Story = {
  decorators: [
    (Story) => (
      <HcFrame theme="hc-light">
        <Story />
      </HcFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    await assertHcProse(canvasElement, {
      fg: "rgb(0, 0, 0)",
      accent: "rgb(0, 51, 204)",
    });
  },
};
