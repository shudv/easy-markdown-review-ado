import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { renderMarkdownSync } from "../../markdown/render";
import type { DiffRange } from "../../types";
import { ArticleView } from "./ArticleView";

const ORIGINAL_LINE =
    "The authoritative directory layout and file conventions are documented in " +
    "[`docs/ReviewGuide/README.md`](../docs/ReviewGuide/README.md).";

const CURRENT_LINE =
    "The authoritative directory layout and file conventions are documented in " +
    "[`docs/ReviewGuide/README.md`](https://example.visualstudio.com/Example%20Project/_git/SharedDocs?path=/docs/ReviewGuide/README.md)" +
    " — now hosted in the shared repository.";

const SOURCE = ["# Review Guide", "", CURRENT_LINE, ""].join("\n");

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
        documentPath: "/docs/ReviewGuide/README.md",
        currentSource: SOURCE,
        originalSource: ["# Review Guide", "", ORIGINAL_LINE, ""].join("\n"),
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

        // The new prose is marked as added inline, and no Before comparison is offered.
        expect(canvas.getByText(/now hosted in the shared repository/)).toHaveClass(
            "emr-word-added",
        );
        expect(canvas.queryByRole("button", { name: /Show previous/ })).toBeNull();

        await userEvent.click(trigger);
        await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));

        // The callout diffs the old relative target against the new cross-host URL.
        const callout = within(canvas.getByRole("dialog", { name: "Link target change" }));

        expect(callout.getByText("..")).toHaveClass("emr-word-removed");
        expect(callout.getByText(/example\.visualstudio\.com/)).toHaveClass("emr-word-added");
        expect(callout.getByText(/\/docs\/ReviewGuide/)).toBeVisible();
    },
};
