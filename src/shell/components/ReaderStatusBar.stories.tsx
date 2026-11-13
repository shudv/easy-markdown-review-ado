import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, type ReactElement, useLayoutEffect, useState } from "react";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

import { ReaderStatusBar } from "./ReaderStatusBar";
import { READER_FONTS } from "../readerPrefs";

// Dock the bar at the viewport bottom (as in the app) so its upward-opening
// font popover lands on-screen and its controls are hit-testable.
const meta = {
    title: "Components/ReaderStatusBar",
    component: ReaderStatusBar,
    parameters: { layout: "fullscreen" },
    decorators: [
        (Story) => (
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                }}
            >
                <Story />
            </div>
        ),
    ],
    args: {
        wordCount: 1240,
        wordDelta: { added: 38, removed: 12 },
        fontId: "system",
        sizePct: 100,
        spacingPct: 100,
        onFontChange: fn(),
        onSizeChange: fn(),
        onSpacingChange: fn(),
        availableFontIds: READER_FONTS.map((font) => font.id),
        showNav: true,
        onToggleNav: fn(),
        navToggleable: true,
        showComments: true,
        onToggleComments: fn(),
        changesAvailable: true,
        changesShown: true,
        onToggleChanges: fn(),
        iterationOptions: [
            {
                stopIndex: 2,
                number: 1,
                title: "Initial draft",
                dateMs: Date.parse("2026-08-11T17:06:00Z"),
            },
            {
                stopIndex: 1,
                number: 2,
                title: "Refine review workflow",
                dateMs: Date.parse("2026-08-18T11:07:00Z"),
            },
            {
                stopIndex: 0,
                number: 3,
                title: "Improve review workflow",
                dateMs: Date.parse("2026-08-23T10:14:00Z"),
            },
        ],
        iterationBaseCommit: "abcdef1234567890",
        iterationRange: { fromUpdate: 0, toUpdate: 3 },
        onIterationRangeChange: fn(),
        feedbackHref: "mailto:x@microsoft.com",
        onRefresh: fn(),
        // `refreshLabel` intentionally omitted — exercises the "Refresh" fallback.
    },
} satisfies Meta<typeof ReaderStatusBar>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledReaderStatusBar(props: ComponentProps<typeof ReaderStatusBar>): ReactElement {
    const [iterationRange, setIterationRange] = useState(props.iterationRange);

    return (
        <ReaderStatusBar
            {...props}
            iterationRange={iterationRange}
            onIterationRangeChange={(nextRange) => {
                setIterationRange(nextRange);
                props.onIterationRangeChange?.(nextRange);
            }}
        />
    );
}

function ControlledCommentStatusBar(props: ComponentProps<typeof ReaderStatusBar>): ReactElement {
    const [showComments, setShowComments] = useState(props.showComments);

    const [activeCommentThreadId, setActiveCommentThreadId] = useState(
        props.activeCommentThreadId ?? null,
    );

    return (
        <ReaderStatusBar
            {...props}
            showComments={showComments}
            onToggleComments={() => {
                setShowComments((shown) => !shown);
                props.onToggleComments();
            }}
            activeCommentThreadId={activeCommentThreadId}
            onCycleComment={(threadId) => {
                setActiveCommentThreadId(threadId);
                props.onCycleComment?.(threadId);
            }}
        />
    );
}

/**
 * The settled bar: pressed view toggles, the word count with the PR's word
 * delta, closed popovers, and an update picker that lists All updates first,
 * then the newest update down to the first.
 */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        expect(canvas.getByRole("toolbar", { name: "Reader status and controls" })).toBeTruthy();

        // The view toggles read as pressed while their panes are shown.
        for (const name of ["Navigation", "Changes", "Comments"]) {
            expect(canvas.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
        }

        expect(canvas.getByRole("button", { name: "Aa" })).toHaveAttribute(
            "aria-expanded",
            "false",
        );

        // Word count and the PR's word delta, each part announced in words.
        expect(canvas.getByText("words")).toHaveTextContent("1,240 words");
        expect(canvas.getByLabelText("38 words added")).toHaveTextContent("+38");
        expect(canvas.getByLabelText("12 words removed")).toHaveTextContent("−12");

        // Popovers start closed: their contents are hidden from assistive tech.
        expect(canvas.queryByRole("listbox", { name: "Review iterations" })).toBeNull();
        expect(canvas.queryByRole("group", { name: "Reading preferences" })).toBeNull();
        expect(canvas.queryByRole("slider", { name: "Text spacing" })).toBeNull();

        const sizeSlider = canvas.getByRole("slider", { name: "Text size" });
        expect(sizeSlider).toHaveAttribute("min", "50");
        expect(sizeSlider).toHaveAttribute("max", "150");
        expect(sizeSlider).toHaveAttribute("aria-valuetext", "100%");

        await userEvent.click(canvas.getByRole("button", { name: "All updates" }));

        // Newest first, like ADO's own update list: All updates, then 3 → 1.
        const options = within(
            canvas.getByRole("listbox", { name: "Review iterations" }),
        ).getAllByRole("option");

        expect(options.map((option) => option.textContent)).toEqual([
            expect.stringContaining("All updates"),
            expect.stringContaining("3Improve review workflow"),
            expect.stringContaining("2Refine review workflow"),
            expect.stringContaining("1Initial draft"),
        ]);

        const selectedOptions = canvas.getAllByRole("option", {
            selected: true,
        });

        expect(selectedOptions).toHaveLength(1);
        expect(selectedOptions[0]).toHaveTextContent("All updates");

        // The selected row must actually be painted. `aria-selected` alone passes
        // even when the stylesheet drifts to a different attribute and the
        // highlight silently disappears.
        const unselected = canvas.getByRole("option", {
            name: /3 Improve review workflow/,
            selected: false,
        });

        const selectedBg = getComputedStyle(selectedOptions[0]!).backgroundColor;

        expect(selectedBg).not.toBe(getComputedStyle(unselected).backgroundColor);
        expect(selectedBg).not.toBe("rgba(0, 0, 0, 0)");
    },
};

/** Highest-priority overlapping work owns the centered status message. */
export const LoadingActivity: Story = {
    args: {
        activities: [
            { id: "sync", label: "Syncing comments…", priority: 10 },
            { id: "document", label: "Loading document…", priority: 100 },
        ],
        activityDelayMs: 0,
    },
    play: async ({ canvasElement }) => {
        const message = await within(canvasElement).findByText("Loading document…");
        const status = message.closest<HTMLElement>('[role="status"]')!;

        await expect(status).toHaveTextContent("Loading document…");
        await expect(status).not.toHaveTextContent("Syncing comments…");
        await expect(status).toHaveAttribute("title", "Loading document… (2 operations running)");

        // The spinner beside the message is actually turning.
        const spinner = status.querySelector<HTMLElement>(".emr-statusbar-spinner")!;

        await expect(spinner.getAnimations()).toHaveLength(1);
        await expect(spinner.getAnimations()[0]?.playState).toBe("running");
    },
};

/** Documents Hub surfaces the active document's latest resolved PR. */
export const ResolvedPullRequest: Story = {
    args: {
        resolvedPullRequest: {
            prId: 128,
            title: "Clarify the review checklist",
            url: "https://example.test/pullrequest/128",
        },
    },
    play: async ({ canvasElement }) => {
        const link = within(canvasElement).getByRole("link", {
            name: "Latest completed PR for this file: #128 Clarify the review checklist",
        });

        await expect(link).toHaveTextContent("PR #128");
        await expect(link).toHaveAttribute("href", "https://example.test/pullrequest/128");
        await expect(link).toHaveAttribute("target", "_blank");
    },
};

/** Resolved PR metadata remains useful when the host cannot provide a URL. */
export const ResolvedPullRequestWithoutLink: Story = {
    args: {
        resolvedPullRequest: {
            prId: 128,
            title: "Clarify the review checklist",
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);

        const badge = canvas.getByLabelText(
            "Latest completed PR for this file: #128 Clarify the review checklist",
        );

        await expect(badge).toHaveTextContent("PR #128");
        await expect(canvas.queryByRole("link", { name: /Latest completed PR/ })).toBeNull();
    },
};

/** Left edges of the comparison stepper's three buttons. */
function stepperPositions(...buttons: HTMLElement[]): number[] {
    return buttons.map((button) => Math.round(button.getBoundingClientRect().left * 10) / 10);
}

/**
 * Stepping back through the updates one comparison at a time, then forward
 * again: the label follows each step, the chevrons stay put under the
 * pointer, each end disables its chevron, and the picker shows the selection.
 */
export const IterationStepping: Story = {
    render: (args) => <ControlledReaderStatusBar {...args} />,
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const trigger = canvas.getByRole("button", { name: "All updates" });

        const previous = canvas.getByRole("button", {
            name: "Previous comparison: Update 2 → 3",
        });

        const next = canvas.getByRole("button", { name: "No next comparison" });
        const initialPositions = stepperPositions(previous, trigger, next);

        expect(next).toBeDisabled();

        for (const label of ["Update 2 → 3", "Update 1 → 2", "Base → Update 1"]) {
            await userEvent.click(previous);
            expect(canvas.getByRole("button", { name: label })).toBe(trigger);
            expect(stepperPositions(previous, trigger, next)).toEqual(initialPositions);
        }

        expect(previous).toHaveAccessibleName("No previous comparison");
        expect(previous).toBeDisabled();
        expect(canvas.getByTitle("Base commit abcdef1")).toBeTruthy();

        for (const label of ["Update 1 → 2", "Update 2 → 3", "All updates"]) {
            await userEvent.click(next);
            expect(canvas.getByRole("button", { name: label })).toBe(trigger);
            expect(stepperPositions(previous, trigger, next)).toEqual(initialPositions);
        }

        expect(next).toBeDisabled();
        expect(args.onIterationRangeChange).toHaveBeenCalledWith({
            fromUpdate: 0,
            toUpdate: 3,
        });

        await userEvent.click(previous);
        await userEvent.click(canvas.getByRole("button", { name: "Update 2 → 3" }));
        // Picking rows keeps the picker open so the resulting selection stays visible.
        await userEvent.click(canvas.getByRole("option", { name: /2 Refine review workflow/ }));
        expect(
            canvas.getByRole("option", {
                name: /2 Refine review workflow/,
                selected: true,
            }),
        ).toBeTruthy();
        await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
        expect(canvas.getByRole("option", { name: "All updates", selected: true })).toBeTruthy();
    },
};

/**
 * In a long PR (128 updates) stepping between multi-digit labels doesn't move
 * the chevrons or resize the picker, and opening the list scrolls the current
 * comparison into view instead of leaving the reviewer at the newest update.
 */
export const IterationMultiDigitStepping: Story = {
    args: {
        iterationOptions: Array.from({ length: 128 }, (_, index) => ({
            stopIndex: 127 - index,
            number: index + 1,
            title: `Update ${index + 1}`,
        })),
        iterationRange: { fromUpdate: 98, toUpdate: 99 },
    },
    render: (args) => <ControlledReaderStatusBar {...args} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const trigger = canvas.getByRole("button", { name: "Update 98 → 99" });

        const previous = canvas.getByRole("button", {
            name: "Previous comparison: Update 97 → 98",
        });

        const next = canvas.getByRole("button", {
            name: "Next comparison: Update 99 → 100",
        });

        const initialPositions = stepperPositions(previous, trigger, next);
        const width = () => Math.round(trigger.getBoundingClientRect().width * 10) / 10;
        const initialWidth = width();

        await userEvent.click(next);
        expect(canvas.getByRole("button", { name: "Update 99 → 100" })).toBe(trigger);
        expect(stepperPositions(previous, trigger, next)).toEqual(initialPositions);
        expect(width()).toBe(initialWidth);

        await userEvent.click(trigger);
        const list = canvas.getByRole("listbox", { name: "Review iterations" });
        await expect(list.scrollTop).toBeGreaterThan(0);

        const selected = canvas.getByRole("option", {
            name: /^100 Update 100/,
            selected: true,
        });

        const listRect = list.getBoundingClientRect();
        const rowRect = selected.getBoundingClientRect();
        await expect(rowRect.top).toBeGreaterThanOrEqual(listRect.top);
        await expect(rowRect.bottom).toBeLessThanOrEqual(listRect.bottom);
    },
};

/** A range steps to the first single-update comparison outside each edge. */
export const IterationRangeStepping: Story = {
    args: {
        iterationOptions: Array.from({ length: 6 }, (_, index) => ({
            stopIndex: 5 - index,
            number: index + 1,
            title: `Update ${index + 1}`,
        })),
        iterationRange: { fromUpdate: 2, toUpdate: 5 },
    },
    render: (args) => <ControlledReaderStatusBar {...args} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);

        expect(canvas.getByRole("button", { name: "Update 2 → 5" })).toBeTruthy();
        expect(
            canvas.getByRole("button", { name: "Previous comparison: Update 1 → 2" }),
        ).toBeEnabled();

        await userEvent.click(
            canvas.getByRole("button", { name: "Next comparison: Update 5 → 6" }),
        );
        expect(canvas.getByRole("button", { name: "Update 5 → 6" })).toBeTruthy();
        expect(canvas.getByRole("button", { name: "Next comparison: All updates" })).toBeEnabled();
    },
};

/** Comment navigation wraps while Comments and Navigation stay right-anchored. */
export const CommentStepping: Story = {
    args: {
        commentThreadIds: ["t1", "t2", "t3"],
        activeCommentThreadId: "t2",
        onCycleComment: fn(),
    },
    render: (args) => <ControlledCommentStatusBar {...args} />,
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const comments = canvas.getByRole("button", { name: "Comments" });
        const navigation = canvas.getByRole("button", { name: "Navigation" });

        const persistentPositions = {
            comments: comments.getBoundingClientRect().left,
            navigation: navigation.getBoundingClientRect().left,
        };

        expect(canvas.getByLabelText("Comment 2 of 3")).toBeTruthy();

        const previous = canvas.getByRole("button", {
            name: "Previous comment",
        });

        const next = canvas.getByRole("button", { name: "Next comment" });
        await userEvent.click(next);
        expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");
        expect(canvas.getByLabelText("Comment 3 of 3")).toBeTruthy();
        await userEvent.click(next);
        expect(args.onCycleComment).toHaveBeenLastCalledWith("t1");
        expect(canvas.getByLabelText("Comment 1 of 3")).toBeTruthy();
        await userEvent.click(previous);
        expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");

        await userEvent.click(comments);
        expect(canvas.queryByRole("button", { name: "Previous comment" })).toBeNull();
        expect(comments.getBoundingClientRect().left).toBeCloseTo(persistentPositions.comments, 1);
        expect(navigation.getBoundingClientRect().left).toBeCloseTo(
            persistentPositions.navigation,
            1,
        );
        await userEvent.click(comments);
        expect(canvas.getByRole("button", { name: "Previous comment" })).toBeTruthy();
        expect(comments.getBoundingClientRect().left).toBeCloseTo(persistentPositions.comments, 1);
    },
};

/** With no selection, Previous starts at the last visible comment. */
export const CommentSteppingNoSelection: Story = {
    args: {
        commentThreadIds: ["t1", "t2", "t3"],
        activeCommentThreadId: null,
        onCycleComment: fn(),
    },
    render: (args) => <ControlledCommentStatusBar {...args} />,
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        expect(canvas.getByLabelText("3 comments")).toBeTruthy();
        await userEvent.click(canvas.getByRole("button", { name: "Previous comment" }));
        expect(args.onCycleComment).toHaveBeenLastCalledWith("t3");
        expect(canvas.getByLabelText("Comment 3 of 3")).toBeTruthy();
    },
};

/** A single visible comment needs no previous/next navigation. */
export const SingleCommentWithoutStepper: Story = {
    args: {
        commentThreadIds: ["t1"],
        activeCommentThreadId: "t1",
        onCycleComment: fn(),
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByRole("button", { name: "Comments" })).toBeTruthy();
        await expect(canvas.queryByRole("button", { name: "Previous comment" })).toBeNull();
        await expect(canvas.queryByRole("button", { name: "Next comment" })).toBeNull();
    },
};

/** No completed PR means no comments pane control or navigation. */
export const CommentsUnavailable: Story = {
    args: {
        commentsAvailable: false,
        commentThreadIds: ["t1", "t2"],
        activeCommentThreadId: "t1",
        onCycleComment: fn(),
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("button", { name: "Comments" })).toBeNull();
        await expect(canvas.queryByLabelText("Comment navigation")).toBeNull();
    },
};

/**
 * Comparing a range of updates (Update 1 → 3): both rows read as selected in
 * the list, shift-clicking extends the range from its anchor, and Next jumps
 * straight to All updates.
 */
export const IterationRange: Story = {
    args: {
        iterationRange: {
            fromUpdate: 1,
            toUpdate: 3,
        },
    },
    render: (args) => <ControlledReaderStatusBar {...args} />,
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);

        expect(
            canvas.getByRole("button", { name: "Previous comparison: Base → Update 1" }),
        ).toBeEnabled();

        const next = canvas.getByRole("button", { name: "Next comparison: All updates" });

        expect(next).toBeEnabled();
        await userEvent.click(canvas.getByRole("button", { name: "Update 1 → 3" }));

        const selectedOptions = canvas.getAllByRole("option", {
            selected: true,
        });

        expect(selectedOptions.map((option) => option.textContent)).toEqual([
            expect.stringContaining("3Improve review workflow"),
            expect.stringContaining("2Refine review workflow"),
        ]);
        fireEvent.click(canvas.getByRole("option", { name: /2 Refine review workflow/ }), {
            shiftKey: true,
        });
        expect(args.onIterationRangeChange).toHaveBeenCalledWith({
            fromUpdate: 1,
            toUpdate: 3,
        });
        await userEvent.click(next);
        expect(canvas.getByRole("button", { name: "All updates" })).toBeTruthy();
        expect(next).toBeDisabled();
    },
};

/** High contrast uses one continuous outline because its soft fill matches the page. */
export const IterationRangeHighContrast: Story = {
    args: IterationRange.args,
    decorators: [
        (Story) => {
            useLayoutEffect(() => {
                const root = document.documentElement;
                const previousTheme = root.getAttribute("data-emr-theme");
                root.setAttribute("data-emr-theme", "hc-light");

                return () => {
                    if (previousTheme) root.setAttribute("data-emr-theme", previousTheme);
                    else root.removeAttribute("data-emr-theme");
                };
            }, []);

            return <Story />;
        },
    ],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Update 1 → 3" }));

        const selectedOptions = canvas.getAllByRole("option", {
            selected: true,
        });

        expect(selectedOptions).toHaveLength(2);

        // Newest first: the band's top row is the range's newest update (3) and
        // its bottom row the oldest (2), so the caps follow that order.
        const bandTop = getComputedStyle(selectedOptions[0]!, "::after");
        const bandBottom = getComputedStyle(selectedOptions[1]!, "::after");
        expect(bandTop.borderLeftColor).toBe("rgb(0, 51, 204)");
        expect(parseFloat(bandTop.borderTopWidth)).toBeGreaterThan(0);
        expect(bandTop.borderBottomWidth).toBe("0px");
        expect(bandBottom.borderTopWidth).toBe("0px");
        expect(parseFloat(bandBottom.borderBottomWidth)).toBeGreaterThan(0);
    },
};

/**
 * The update list shows compact relative ages (15m / 2h / 2d ago) and no age
 * for an update without a timestamp; with no recorded base commit the base
 * marker's tooltip just says "Base commit".
 */
export const IterationRelativeAges: Story = {
    args: {
        iterationBaseCommit: undefined,
        iterationOptions: [
            { stopIndex: 3, number: 1, title: "No recorded timestamp" },
            {
                stopIndex: 2,
                number: 2,
                title: "Two days ago",
                dateMs: Date.now() - 2 * 24 * 60 * 60_000,
            },
            {
                stopIndex: 1,
                number: 3,
                title: "Two hours ago",
                dateMs: Date.now() - 2 * 60 * 60_000,
            },
            {
                stopIndex: 0,
                number: 4,
                title: "Fifteen minutes ago",
                dateMs: Date.now() - 15 * 60_000,
            },
        ],
        iterationRange: { fromUpdate: 0, toUpdate: 1 },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Base → Update 1" }));
        expect(canvas.getByTitle("Base commit")).toBeTruthy();
        expect(canvas.getByRole("option", { name: /Fifteen minutes ago/ })).toHaveTextContent(
            "15m ago",
        );
        expect(canvas.getByRole("option", { name: /Two hours ago/ })).toHaveTextContent("2h ago");
        expect(canvas.getByRole("option", { name: /Two days ago/ })).toHaveTextContent("2d ago");
        expect(canvas.getByRole("option", { name: /No recorded timestamp/ })).not.toHaveTextContent(
            "ago",
        );
    },
};

/**
 * Every control flows through its callback: the view toggles, the update
 * picker (Escape / outside click restore focus, single and shift-click picks),
 * the font popover (open → pick + change spacing → close on Escape) and the
 * text-size slider.
 */
export const Interactions: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const updatesList = () => canvas.queryByRole("listbox", { name: "Review iterations" });
        const preferences = () => canvas.queryByRole("group", { name: "Reading preferences" });

        // View toggles fire their callbacks.
        await userEvent.click(canvas.getByRole("button", { name: "Navigation" }));
        await userEvent.click(canvas.getByRole("button", { name: "Comments" }));
        await userEvent.click(canvas.getByRole("button", { name: "Changes" }));
        expect(args.onToggleNav).toHaveBeenCalled();
        expect(args.onToggleComments).toHaveBeenCalled();
        expect(args.onToggleChanges).toHaveBeenCalled();

        // Iteration picker restores trigger focus on Escape and closes without
        // stealing focus on an outside pointer-down.
        const iterationTrigger = canvas.getByRole("button", {
            name: "All updates",
        });

        await userEvent.click(iterationTrigger);
        expect(updatesList()).toBeTruthy();
        await userEvent.keyboard("{ArrowDown}");
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(updatesList()).toBeNull());
        expect(iterationTrigger).toHaveFocus();
        await userEvent.click(iterationTrigger);
        await userEvent.click(canvas.getByRole("button", { name: "Navigation" }));
        await waitFor(() => expect(updatesList()).toBeNull());
        expect(canvas.getByRole("button", { name: "Navigation" })).toHaveFocus();

        // All updates and numbered updates remain mutually exclusive and the
        // picker stays open so the resulting selection remains visible.
        await userEvent.click(canvas.getByRole("button", { name: "All updates" }));
        await userEvent.click(canvas.getByRole("option", { name: "All updates" }));
        expect(args.onIterationRangeChange).toHaveBeenCalledWith({
            fromUpdate: 0,
            toUpdate: 3,
        });
        expect(updatesList()).toBeTruthy();

        const iterationOne = canvas.getByRole("option", {
            name: /1 Initial draft/,
        });

        fireEvent.click(iterationOne, { shiftKey: true });
        expect(args.onIterationRangeChange).toHaveBeenCalledWith({
            fromUpdate: 0,
            toUpdate: 1,
        });
        expect(updatesList()).toBeTruthy();
        await userEvent.click(iterationOne);
        expect(args.onIterationRangeChange).toHaveBeenCalledWith({
            fromUpdate: 0,
            toUpdate: 1,
        });
        expect(updatesList()).toBeTruthy();
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(updatesList()).toBeNull());
        expect(iterationTrigger).toHaveFocus();

        // Font popover: open, pick the reading serif, then close with Escape.
        const typeTrigger = canvas.getByRole("button", { name: "Aa" });

        await userEvent.click(typeTrigger);
        await waitFor(() => expect(preferences()).toBeTruthy());
        expect(typeTrigger).toHaveAttribute("aria-expanded", "true");
        // Spacing ranges 100–200% and starts at its minimum, so it can't go lower.
        expect(canvas.getByRole("slider", { name: "Text spacing" })).toHaveAttribute("min", "100");
        expect(canvas.getByRole("slider", { name: "Text spacing" })).toHaveAttribute("max", "200");
        expect(canvas.getByRole("button", { name: "Decrease text spacing" })).toBeDisabled();
        // A non-Escape key while the popover is open is ignored (keydown guard).
        await userEvent.keyboard("{ArrowDown}");
        // A pointer-down INSIDE the popover (picking a font) doesn't close it.
        await userEvent.click(canvas.getByRole("button", { name: /Sitka/ }));
        expect(args.onFontChange).toHaveBeenCalledWith("sitka");
        fireEvent.change(canvas.getByRole("slider", { name: "Text spacing" }), {
            target: { value: "125" },
        });
        expect(args.onSpacingChange).toHaveBeenCalledWith(125);
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(preferences()).toBeNull());
        expect(typeTrigger).toHaveFocus();
        expect(canvas.queryByRole("slider", { name: "Text spacing" })).toBeNull();

        // Re-open, then a pointer-down OUTSIDE the popover closes it — and the
        // click still nudges the text size (smaller).
        await userEvent.click(typeTrigger);
        await waitFor(() => expect(preferences()).toBeTruthy());
        await userEvent.click(canvas.getByRole("button", { name: "Decrease text size" }));
        await waitFor(() => expect(preferences()).toBeNull());
        await userEvent.click(canvas.getByRole("button", { name: "Increase text size" }));

        fireEvent.change(canvas.getByRole("slider", { name: "Text size" }), {
            target: { value: "125" },
        });
        const sizeSlider = canvas.getByRole("slider", { name: "Text size" });

        for (const key of ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home"]) {
            fireEvent.keyDown(sizeSlider, { key });
        }

        expect(args.onSizeChange).toHaveBeenCalledWith(95);
        expect(args.onSizeChange).toHaveBeenCalledWith(105);
        expect(args.onSizeChange).toHaveBeenCalledWith(125);
        expect(args.onSizeChange).toHaveBeenCalledWith(99);
        expect(args.onSizeChange).toHaveBeenCalledWith(101);
    },
};

/** A machine with no curated local fonts keeps spacing but hides System-only UI. */
export const SystemOnly: Story = {
    args: {
        fontId: "atkinson",
        availableFontIds: ["system"],
        onFontChange: fn(),
    },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
        expect(canvas.queryByText("Reading font")).toBeNull();
        expect(canvas.getByRole("slider", { name: "Text spacing" })).toBeTruthy();
        expect(args.onFontChange).not.toHaveBeenCalled();
    },
};

/** Browsers without the FontFace API degrade to System without hiding spacing. */
export const FontDetectionUnavailable: Story = {
    args: {
        availableFontIds: undefined,
    },
    beforeEach: () => {
        const NativeFontFace = window.FontFace;
        window.FontFace = undefined as unknown as typeof FontFace;

        return () => {
            window.FontFace = NativeFontFace;
        };
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Aa" }));
        await waitFor(() => expect(canvas.queryByText("Reading font")).toBeNull());
        expect(canvas.getByRole("slider", { name: "Text spacing" })).toBeTruthy();
    },
};

/**
 * The navigation outline can be turned off from the status bar; the toggle sits
 * next to Navigation and is only offered while the navigation is shown.
 */
export const OutlineToggle: Story = {
    args: { showOutline: true, onToggleOutline: fn() },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const toggle = canvas.getByRole("button", { name: "Outline" });
        await expect(toggle.getAttribute("aria-pressed")).toBe("true");
        await expect(toggle.title).toBe("Hide the document outline in the navigation");
        await userEvent.click(toggle);
        await expect(args.onToggleOutline).toHaveBeenCalledTimes(1);
    },
};

/** With the outline off the toggle reads as not pressed. */
export const OutlineToggleOff: Story = {
    args: { showOutline: false, onToggleOutline: fn() },
    play: async ({ canvasElement }) => {
        const toggle = within(canvasElement).getByRole("button", {
            name: "Outline",
        });

        await expect(toggle.getAttribute("aria-pressed")).toBe("false");
        await expect(toggle.title).toBe("Show the document outline in the navigation");
    },
};

/** Hidden navigation (or no toggle handler) drops the Outline control. */
export const OutlineToggleHidden: Story = {
    args: { showNav: false, onToggleOutline: fn() },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByRole("button", { name: "Outline" })).toBeNull();
    },
};

/** Single-file mode has no navigation, so no Outline control either. */
export const OutlineToggleSingleFile: Story = {
    args: { navToggleable: false, onToggleOutline: fn() },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByRole("button", { name: "Outline" })).toBeNull();
    },
};

/**
 * The reading-preferences popover carries the "Send usage data" opt-out. It is
 * on by default; turning it off persists for the PR tab and the Documents hub.
 */
export const SendUsageDataOptOut: Story = {
    play: async ({ canvasElement }) => {
        window.localStorage.removeItem("emr.usageData");
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByTitle("Reading preferences"));
        const optIn = canvas.getByRole("checkbox", { name: "Send usage data" });
        await expect(optIn).toBeChecked();

        await userEvent.click(optIn);
        await expect(optIn).not.toBeChecked();
        await expect(window.localStorage.getItem("emr.usageData")).toBe("off");

        await userEvent.click(optIn);
        await expect(optIn).toBeChecked();
        await expect(window.localStorage.getItem("emr.usageData")).toBeNull();
    },
};
