import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { GeneratedSourceModal } from "./GeneratedSourceModal";

const SOURCE = `graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]`;

// Mermaid and KaTeX are lazily imported, so any wait on a (re)rendered preview
// needs far more headroom than testing-library's 1s default once the suite is
// running browser stories in parallel.
const LAZY_RENDER = { timeout: 15000 };

const meta = {
    title: "Components/GeneratedSourceModal",
    component: GeneratedSourceModal,
    args: {
        source: SOURCE,
        onClose: fn(),
    },
} satisfies Meta<typeof GeneratedSourceModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Override navigator.clipboard for the duration of a play function. */
function stubClipboard(impl: { writeText: () => Promise<void> } | undefined) {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
        value: impl,
        configurable: true,
    });

    return () => {
        if (original) Object.defineProperty(navigator, "clipboard", original);
    };
}

/** A diagram's source opens in a labelled dialog with its code and a copy action. */
export const Open: Story = {
    play: async ({ canvasElement }) => {
        const dialog = within(canvasElement).getByRole("dialog", {
            name: "Mermaid diagram source",
        });

        await expect(within(dialog).getByText("Diagram source")).toBeVisible();
        await expect(within(dialog).getByText(/A\[Start\] --> B\{Choice\}/)).toBeVisible();
        await expect(within(dialog).getByRole("button", { name: "Copy source" })).toBeEnabled();
    },
};

/** With no source to show, no dialog is open. */
export const Closed: Story = {
    args: { source: null },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByRole("dialog")).toBeNull();
    },
};

/** Opening moves focus into the dialog; closing gives it back to the opener. */
export const MovesFocusInAndBack: Story = {
    args: { source: null },
    render: function Render(args) {
        const [source, setSource] = useState<string | null>(null);

        return (
            <>
                <button type="button" onClick={() => setSource(SOURCE)}>
                    Source
                </button>
                <GeneratedSourceModal {...args} source={source} onClose={() => setSource(null)} />
            </>
        );
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const opener = canvas.getByRole("button", { name: "Source" });
        await userEvent.click(opener);
        await expect(canvas.getByRole("dialog")).toContainElement(
            document.activeElement as HTMLElement,
        );
        await userEvent.keyboard("{Escape}");
        await expect(canvas.queryByRole("dialog")).toBeNull();
        await expect(opener).toHaveFocus();
    },
};

/** Escape closes the dialog; other keys don't. */
export const ClosesOnEscape: Story = {
    play: async ({ args }) => {
        await userEvent.keyboard("a");
        await expect(args.onClose).not.toHaveBeenCalled();
        await userEvent.keyboard("{Escape}");
        await expect(args.onClose).toHaveBeenCalledTimes(1);
    },
};

/** Clicking the dimmed backdrop around the dialog closes it. */
export const ClosesOnOverlayClick: Story = {
    play: async ({ args, canvasElement }) => {
        // The labelled dialog element is the full-screen backdrop; the panel sits inside it.
        await userEvent.click(within(canvasElement).getByRole("dialog"));
        await expect(args.onClose).toHaveBeenCalledTimes(1);
    },
};

/** The Close button closes the dialog. */
export const ClosesOnButton: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Close" }));
        await expect(args.onClose).toHaveBeenCalledTimes(1);
    },
};

/** Copy puts the source on the clipboard; the label flips to "Copied" then reverts. */
export const CopySucceeds: Story = {
    play: async ({ canvasElement }) => {
        const writeText = fn(() => Promise.resolve());
        const restore = stubClipboard({ writeText });

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "Copy source" }));
            await expect(writeText).toHaveBeenCalledWith(SOURCE);
            await waitFor(() =>
                expect(canvas.getByRole("button", { name: "Copied" })).toBeTruthy(),
            );
            await waitFor(
                () => expect(canvas.getByRole("button", { name: "Copy source" })).toBeTruthy(),
                { timeout: 2500 },
            );
        } finally {
            restore();
        }
    },
};

/**
 * When the host frame blocks the clipboard, or the browser has none (a
 * non-secure context), Copy quietly does nothing: it never claims "Copied".
 */
export const CopyBlocked: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const writeText = fn(() => Promise.reject(new Error("blocked")));
        let restore = stubClipboard({ writeText });

        try {
            await userEvent.click(canvas.getByRole("button", { name: "Copy source" }));
            await expect(writeText).toHaveBeenCalledTimes(1);
            await expect(canvas.getByRole("button", { name: "Copy source" })).toBeTruthy();
        } finally {
            restore();
        }

        restore = stubClipboard(undefined);

        try {
            await userEvent.click(canvas.getByRole("button", { name: "Copy source" }));
            await expect(canvas.getByRole("button", { name: "Copy source" })).toBeTruthy();
            await expect(canvas.queryByRole("button", { name: "Copied" })).toBeNull();
        } finally {
            restore();
        }
    },
};

/**
 * When the diagram changed in the PR, Changes shows a word-level source diff
 * and Before switches both source and preview to the previous diagram.
 */
export const WithSourceDiff: Story = {
    args: {
        source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship it]",
        originalSource: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Diagram source")).toBeTruthy();
        await expect(canvas.getByRole("button", { name: "Hide source changes" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        // The changed word is marked added; the old word struck through.
        await waitFor(() => {
            const added = canvasElement.querySelector(".emr-word-added");
            const removed = canvasElement.querySelector(".emr-word-removed");
            expect(added?.textContent).toContain("Ship");
            expect(removed?.textContent).toContain("Do");
        });
        await userEvent.click(canvas.getByRole("button", { name: "Hide source changes" }));
        await expect(canvasElement.querySelector(".emr-word-added")).toBeNull();
        await expect(canvas.getByRole("button", { name: "Show source changes" })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        await userEvent.click(canvas.getByRole("button", { name: "Show source changes" }));
        await userEvent.click(canvas.getByRole("button", { name: "Before" }));
        await expect(canvas.queryByRole("button", { name: /source changes/i })).toBeNull();
        // Both the source pane and the rendered preview now show the old diagram.
        await expect(
            canvas.getByText("graph TD A[Start] --> B{Choice} B -->|yes| C[Do it]"),
        ).toBeVisible();
        await waitFor(
            () => {
                expect(canvas.getByText("Do it")).toBeVisible();
                expect(canvas.queryByText("Ship it")).toBeNull();
            },
            // Switching to Before re-renders through Mermaid, which is lazily
            // imported — too slow for the 1s default when the suite runs in parallel.
            LAZY_RENDER,
        );
    },
};

/**
 * Switching between Changes, plain source and Before (a much smaller diagram)
 * keeps the dialog's toolbar where it was, so the reviewer can keep clicking
 * the toggles without chasing them around the screen.
 */
export const TogglesStayUnderPointer: Story = {
    args: {
        source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship it]\n  B -->|no| D[Skip]\n  C --> E[Done]\n  D --> E",
        originalSource: "graph TD\n  A[Start] --> B{Go}",
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const before = canvas.getByRole("button", { name: "Before" });

        await waitFor(() => expect(canvas.getByText("Ship it")).toBeVisible(), LAZY_RENDER);

        const baseline = before.getBoundingClientRect();

        const expectToolbarInPlace = () => {
            const { top, left } = before.getBoundingClientRect();
            expect(top).toBe(baseline.top);
            expect(left).toBe(baseline.left);
        };

        await userEvent.click(canvas.getByRole("button", { name: "Hide source changes" }));
        expectToolbarInPlace();
        await userEvent.click(canvas.getByRole("button", { name: "Show source changes" }));
        expectToolbarInPlace();
        await userEvent.click(before);
        await waitFor(() => expect(canvas.getByText("Go")).toBeVisible(), LAZY_RENDER);
        expectToolbarInPlace();
    },
};

/**
 * A removal that is only punctuation (here a trailing period in a node label)
 * has no ink at strike height, so it renders "tight" — no strikethrough, just
 * the red tint — the same rule the article uses.
 */
export const WithPunctuationRemoval: Story = {
    args: {
        source: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
        originalSource: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it.]",
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            const tight = canvasElement.querySelector(".emr-word-removed--tight");

            expect(tight?.textContent).toBe(".");
        });
    },
};

/** An identical original source shows no diff (plain source, normal title). */
export const UnchangedSource: Story = {
    args: {
        source: SOURCE,
        originalSource: SOURCE,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Diagram source")).toBeTruthy();
        await expect(canvas.queryByRole("button", { name: "Before" })).toBeNull();
        await expect(canvasElement.querySelector(".emr-word-added")).toBeNull();
    },
};

/**
 * An equation changed in the PR: Changes marks the added LaTeX, and Before
 * toggles both the source and the rendered preview to the earlier equation
 * and back.
 */
export const EquationSourceDiff: Story = {
    args: {
        kind: "math",
        source: String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`,
        originalSource: String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Equation source")).toBeTruthy();
        await waitFor(() => {
            expect(
                canvasElement.querySelector(".emr-generated-source-preview .katex"),
            ).toBeTruthy();
            expect(canvasElement.querySelector(".emr-word-added")?.textContent).toBe("^2");
        }, LAZY_RENDER);
        await userEvent.click(canvas.getByRole("button", { name: "Before" }));
        await expect(canvas.getByRole("button", { name: "Before" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await waitFor(() => {
            expect(
                canvasElement.querySelector(".emr-generated-source-code code")?.textContent,
            ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`);
            expect(
                canvasElement.querySelector(".emr-generated-source-preview annotation")
                    ?.textContent,
            ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i}`);
        }, LAZY_RENDER);
        await userEvent.click(canvas.getByRole("button", { name: "Before" }));
        await expect(canvas.getByRole("button", { name: "Hide source changes" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await waitFor(() => {
            expect(
                canvasElement.querySelector(".emr-generated-source-code code")?.textContent,
            ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`);
            expect(
                canvasElement.querySelector(".emr-generated-source-preview annotation")
                    ?.textContent,
            ).toBe(String.raw`G_{\mathrm{RMS}} = \sqrt{\sum_{i=1}^{n} g_i^2}`);
        }, LAZY_RENDER);
    },
};

/** A wide equation's source renders as math that fits the dialog without scrollbars. */
export const EquationSource: Story = {
    args: {
        kind: "math",
        source: String.raw`G_{\mathrm{scroll},\mathrm{RMS}} = \sqrt{\frac{1}{Kn}\sum_{i=1}^{n} g_i}`,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText("Equation source")).toBeTruthy();
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelector(".emr-generated-source-preview .katex"),
                ).toBeTruthy(),
            LAZY_RENDER,
        );

        // An equation that fits must not scroll: the radical's tail overhangs, so a
        // shrink-wrapped host would show a scrollbar with room to spare.
        for (const selector of [
            ".emr-generated-source-preview .emr-math",
            ".emr-generated-source-preview .katex-display",
        ]) {
            const el = canvasElement.querySelector<HTMLElement>(selector)!;
            expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
        }
    },
};

/** Copying while Before is shown copies the earlier equation the reviewer is looking at. */
export const EquationCopyBeforeVersion: Story = {
    args: {
        kind: "math",
        source: String.raw`x^2 + y^2`,
        originalSource: String.raw`x^2`,
    },
    play: async ({ canvasElement }) => {
        const writeText = fn(() => Promise.resolve());
        const restore = stubClipboard({ writeText });

        try {
            const canvas = within(canvasElement);
            await userEvent.click(canvas.getByRole("button", { name: "Before" }));
            await userEvent.click(canvas.getByRole("button", { name: "Copy source" }));
            await expect(writeText).toHaveBeenCalledWith(String.raw`x^2`);
            await waitFor(() =>
                expect(canvas.getByRole("button", { name: "Copied" })).toBeTruthy(),
            );
        } finally {
            restore();
        }
    },
};
