import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { renderMarkdownSync } from "../../markdown/render";
import type { DiffRange } from "../../types";
import { ArticleView } from "./ArticleView";

const ORIGINAL_LINE =
  "The authoritative directory layout and file conventions are documented in " +
  "[`docs/TelemetryAnalytics/README.md`](../docs/TelemetryAnalytics/README.md).";
const CURRENT_LINE =
  "The authoritative directory layout and file conventions are documented in " +
  "[`docs/TelemetryAnalytics/README.md`](https://o365exchange.visualstudio.com/O365%20Core/_git/BlackstoneRA?path=/docs/TelemetryAnalytics/README.md)" +
  " — now hosted in the shared repository.";
const SOURCE = ["# Telemetry Analytics", "", CURRENT_LINE, ""].join("\n");
const DIFF: DiffRange[] = [
  {
    startLine: 3,
    endLine: 3,
    kind: "modified",
    originalStartLine: 3,
    originalEndLine: 3,
    originalText: ORIGINAL_LINE,
  },
];

const meta = {
  title: "Production Diffs/Link Target And Prose",
  component: ArticleView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: 980, padding: 32 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    pristineHtml: renderMarkdownSync(SOURCE),
    documentPath: "/docs/TelemetryAnalytics/README.md",
    currentSource: SOURCE,
    originalSource: ["# Telemetry Analytics", "", ORIGINAL_LINE, ""].join("\n"),
    threads: [],
    activeThreadId: null,
    draftAnchor: null,
    diff: DIFF,
    showDiff: true,
    storageKey: "production-link-target-and-prose.md",
    onAnchorsResolved: fn(),
    onHighlightClick: fn(),
    onSelection: fn(),
  },
} satisfies Meta<typeof ArticleView>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Same link label, a cross-host destination change, and added prose on one
 * source line. The prose is green inline; the warning icon opens the target
 * diff. This remains precise and never falls back to a Before comparison.
 */
export const TargetCalloutOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await waitFor(() =>
      canvas.getByRole("button", { name: "Show link hostname change" }),
    );
    const paragraph = trigger.closest("p")!;
    const addedProse = Array.from(
      paragraph.querySelectorAll<HTMLElement>(".emr-word-added"),
    )
      .filter((mark) => !mark.closest(".emr-diff-metadata"))
      .map((mark) => mark.textContent)
      .join(" ");
    expect(addedProse).toContain("now hosted in the shared repository");
    expect(paragraph.querySelector(".emr-diff-before-trigger")).toBeNull();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true"),
    );
    const targetDiff = canvasElement.querySelector<HTMLElement>(
      ".emr-diff-metadata-target-diff",
    )!;
    expect(targetDiff.querySelector(".emr-word-removed")?.textContent).toBe(
      "..",
    );
    expect(targetDiff.querySelector(".emr-word-added")?.textContent).toContain(
      "o365exchange.visualstudio.com",
    );
    expect(targetDiff.textContent).toContain("/docs/TelemetryAnalytics");
    expect(targetDiff.textContent).toContain("o365exchange.visualstudio.com");
  },
};
