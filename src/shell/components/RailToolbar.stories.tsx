import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { RailToolbar } from "./RailToolbar";

const meta = {
    title: "Components/RailToolbar",
    component: RailToolbar,
    decorators: [
        (Story) => (
            <div style={{ width: 360 }}>
                <Story />
            </div>
        ),
    ],
    args: {
        commentQuery: "",
        onCommentQueryChange: fn(),
        hasVisibleComments: true,
        resolvedThreadCount: 1,
        openThreadCount: 2,
        filterCounts: { all: 3, active: 2, resolved: 1, mine: 0 },
        filterMode: "active" as const,
        onFilterModeChange: fn(),
        onlyThisFile: false,
        onOnlyThisFileChange: fn(),
        routedPr: {
            prId: 42,
            title: "Add docs",
            status: "active" as const,
            url: "https://example.test/pr/42",
        },
        headerActions: <button type="button">Refresh</button>,
    },
} satisfies Meta<typeof RailToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The search field opens, passes typing to the host, and Escape on empty text closes it. */
export const Default: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        expect(canvas.queryByRole("button", { name: "Next comment" })).toBeNull();
        expect(canvas.queryByRole("button", { name: "Previous comment" })).toBeNull();

        // Open search and exercise typing + key handling.
        await userEvent.click(canvas.getByRole("button", { name: "Search comments" }));

        const input = await waitFor(() =>
            canvas.getByRole("searchbox", { name: "Search comments" }),
        );

        await userEvent.type(input, "abc");
        await expect(args.onCommentQueryChange).toHaveBeenCalled();
        // Enter doesn't close the field; Escape with no text collapses it.
        await userEvent.type(input, "{Enter}");
        await expect(canvas.getByRole("searchbox", { name: "Search comments" })).toBe(input);
        await userEvent.type(input, "{Escape}");
        await waitFor(() =>
            expect(canvas.queryByRole("searchbox", { name: "Search comments" })).toBeNull(),
        );
    },
};

/** Blurring an empty search field collapses it. */
export const BlurCollapsesSearch: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "Search comments" }));

        const input = await waitFor(() =>
            canvas.getByRole("searchbox", { name: "Search comments" }),
        );

        (input as HTMLInputElement).blur();
        await waitFor(() =>
            expect(canvas.queryByRole("searchbox", { name: "Search comments" })).toBeNull(),
        );
    },
};

/** All threads resolved shows the celebration; the filter menu is present. */
export const AllResolved: Story = {
    args: {
        openThreadCount: 0,
        resolvedThreadCount: 2,
        filterCounts: { all: 2, active: 0, resolved: 2, mine: 0 },
        filterMode: "active" as const,
        // Resolved threads are hidden by the Active filter, so nothing is shown.
        hasVisibleComments: false,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        // The all-resolved delight is now a compact circular check whose label
        // lives in its title/aria-label rather than visible text.
        await expect(canvas.getByLabelText("All comments resolved")).toBeTruthy();
        // The filter menu is available (its trigger names the active filter).
        await expect(
            canvas.getByRole("button", {
                name: /Filter comments/,
            }),
        ).toBeTruthy();
        // No comments shown → the search affordance is hidden.
        await expect(canvas.queryByRole("button", { name: "Search comments" })).toBeNull();
    },
};

/** A routed PR without a URL renders a plain (non-link) badge. */
export const RoutedPrNoLink: Story = {
    args: {
        routedPr: { prId: 7, title: "Fix typo", status: "completed" as const },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/PR #7/)).toBeVisible();
        await expect(canvas.queryByRole("link", { name: /PR #7/ })).toBeNull();
    },
};

/** `hidePrPill` suppresses the routed-PR badge (PR tab, where it's implicit). */
export const HidePrPill: Story = {
    args: {
        routedPr: { prId: 7, title: "Fix typo", status: "active" as const },
        hidePrPill: true,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByText(/PR #7/)).toBeNull();
    },
};

/** Documents hides the duplicate PR label but keeps comment-history controls. */
export const HiddenPrWithHistory: Story = {
    args: {
        hidePrPill: true,
        historyNav: {
            canNewer: true,
            canOlder: true,
            newerLabel: "View newer comments",
            olderLabel: "View older comments",
            onNewer: fn(),
            onOlder: fn(),
        },
    },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByText(/PR #42/)).toBeNull();
        await expect(canvas.getByLabelText("Comment history")).toBeTruthy();
        await userEvent.click(canvas.getByRole("button", { name: "Older version" }));
        await userEvent.click(canvas.getByRole("button", { name: "Newer version" }));
        await expect(args.historyNav?.onOlder).toHaveBeenCalledOnce();
        await expect(args.historyNav?.onNewer).toHaveBeenCalledOnce();
    },
};

/** No routed PR and no comments hides the PR badge and the filter menu. */
export const Minimal: Story = {
    args: {
        routedPr: undefined,
        headerActions: undefined,
        resolvedThreadCount: 0,
        filterCounts: { all: 0, active: 0, resolved: 0, mine: 0 },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByText(/PR #/)).toBeNull();
        await expect(canvas.queryByRole("button", { name: /Filter comments/ })).toBeNull();
    },
};

/** With no comments and no query, the search affordance is hidden entirely. */
export const NoSearchNoCyclers: Story = {
    args: {
        hasVisibleComments: false,
        resolvedThreadCount: 0,
        filterCounts: { all: 0, active: 0, resolved: 0, mine: 0 },
        routedPr: undefined,
        headerActions: undefined,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("button", { name: "Search comments" })).toBeNull();
        await expect(canvas.queryByRole("button", { name: "Next comment" })).toBeNull();
    },
};

/** A preset query opens the field on mount; the close button clears it. */
export const SearchPreopen: Story = {
    args: { commentQuery: "needle" },
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await waitFor(() =>
            expect(canvas.getByRole("searchbox", { name: "Search comments" })).toBeTruthy(),
        );
        // Typing fires the change handler.
        await userEvent.type(canvas.getByRole("searchbox", { name: "Search comments" }), "x");
        await expect(args.onCommentQueryChange).toHaveBeenCalled();
        // Escape while text is present clears the query (does not collapse).
        await userEvent.type(
            canvas.getByRole("searchbox", { name: "Search comments" }),
            "{Escape}",
        );
        await expect(args.onCommentQueryChange).toHaveBeenCalledWith("");
        // The close button collapses the search field.
        await userEvent.click(canvas.getByRole("button", { name: "Close search" }));
        await expect(args.onCommentQueryChange).toHaveBeenCalledWith("");
    },
};

/**
 * A comment search started elsewhere (the host sets the query while the field
 * is collapsed) re-opens the field showing that query.
 */
export const ExternalQueryReopens: Story = {
    render: (args) => {
        const [query, setQuery] = useState("");

        return (
            <>
                <button type="button" onClick={() => setQuery("external")}>
                    Search from host
                </button>
                <RailToolbar {...args} commentQuery={query} onCommentQueryChange={setQuery} />
            </>
        );
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.queryByRole("searchbox", { name: "Search comments" })).toBeNull();
        await userEvent.click(canvas.getByRole("button", { name: "Search from host" }));
        await waitFor(() =>
            expect(canvas.getByRole("searchbox", { name: "Search comments" })).toHaveValue(
                "external",
            ),
        );
    },
};

/**
 * The "Comments" header label is the filter dropdown: opening it reveals the
 * status modes and the "only this file" scope toggle, each wired to its
 * callback. (Guards that the menu opens from the header — not the old funnel —
 * and isn't clipped by the toolbar lead.)
 */
export const FilterDropdownFromHeader: Story = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: /Filter comments/ }));

        // Pick a status mode.
        const resolved = await waitFor(() =>
            canvas.getByRole("menuitemradio", { name: /Resolved comments/ }),
        );

        await userEvent.click(resolved);
        await expect(args.onFilterModeChange).toHaveBeenCalledWith("resolved");
        // Re-open and flip the independent "only this file" scope.
        await userEvent.click(canvas.getByRole("button", { name: /Filter comments/ }));

        const scope = await waitFor(() =>
            canvas.getByRole("menuitemcheckbox", {
                name: /Hide comments not on this file/,
            }),
        );

        await userEvent.click(scope);
        await expect(args.onOnlyThisFileChange).toHaveBeenCalledWith(true);
    },
};
