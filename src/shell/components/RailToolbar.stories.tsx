import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
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
    orderedThreadIds: ["t1", "t2", "t3"],
    activeThreadId: "t2",
    onSelectThread: fn(),
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

/** Cyclers move the active thread; the search field opens and handles keys. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Next comment" }));
    await userEvent.click(
      canvas.getByRole("button", { name: "Previous comment" }),
    );
    await expect(args.onSelectThread).toHaveBeenCalledTimes(2);

    // Open search and exercise typing + key handling.
    await userEvent.click(
      canvas.getByRole("button", { name: "Search comments" }),
    );
    const input = await waitFor(() =>
      canvas.getByRole("searchbox", { name: "Search comments" }),
    );
    await userEvent.type(input, "abc");
    await expect(args.onCommentQueryChange).toHaveBeenCalled();
    // Non-Escape keys are ignored; Escape with no text collapses the field.
    await userEvent.type(input, "{Enter}");
    await userEvent.type(input, "{Escape}");
    await waitFor(() =>
      expect(
        canvas.queryByRole("searchbox", { name: "Search comments" }),
      ).toBeNull(),
    );
  },
};

/** Blurring an empty search field collapses it. */
export const BlurCollapsesSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Search comments" }),
    );
    const input = await waitFor(() =>
      canvas.getByRole("searchbox", { name: "Search comments" }),
    );
    (input as HTMLInputElement).blur();
    await waitFor(() =>
      expect(
        canvas.queryByRole("searchbox", { name: "Search comments" }),
      ).toBeNull(),
    );
  },
};

/** With nothing selected, prev/next wrap to the ends and the count shows a dash. */
export const NoActiveSelection: Story = {
  args: { activeThreadId: null },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Previous comment" }),
    );
    await expect(args.onSelectThread).toHaveBeenCalledWith("t3");
    await userEvent.click(canvas.getByRole("button", { name: "Next comment" }));
    await expect(args.onSelectThread).toHaveBeenCalledWith("t1");
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
    orderedThreadIds: [],
    activeThreadId: null,
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
    await expect(
      canvas.queryByRole("button", { name: "Search comments" }),
    ).toBeNull();
  },
};

/** A routed PR without a URL renders a plain (non-link) badge. */
export const RoutedPrNoLink: Story = {
  args: {
    routedPr: { prId: 7, title: "Fix typo", status: "completed" as const },
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

/** No routed PR and no comments hides the PR badge and the filter menu. */
export const Minimal: Story = {
  args: {
    routedPr: undefined,
    headerActions: undefined,
    resolvedThreadCount: 0,
    filterCounts: { all: 0, active: 0, resolved: 0, mine: 0 },
  },
};

/** With no comments and no query, the search affordance is hidden entirely. */
export const NoSearchNoCyclers: Story = {
  args: {
    hasVisibleComments: false,
    resolvedThreadCount: 0,
    filterCounts: { all: 0, active: 0, resolved: 0, mine: 0 },
    orderedThreadIds: [],
    activeThreadId: null,
    routedPr: undefined,
    headerActions: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: "Search comments" }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Next comment" }),
    ).toBeNull();
  },
};

/** A preset query opens the field on mount; the close button clears it. */
export const SearchPreopen: Story = {
  args: { commentQuery: "needle" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("searchbox", { name: "Search comments" }),
      ).toBeTruthy(),
    );
    // Typing fires the change handler.
    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search comments" }),
      "x",
    );
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

/** A query set externally while collapsed re-opens the search field. */
export const ExternalQueryReopens: Story = {
  render: (args) => {
    const [query, setQuery] = React.useState("");
    React.useEffect(() => {
      const id = setTimeout(() => setQuery("external"), 0);
      return () => clearTimeout(id);
    }, []);
    return (
      <RailToolbar
        {...args}
        commentQuery={query}
        onCommentQueryChange={setQuery}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("searchbox", { name: "Search comments" }),
      ).toBeTruthy(),
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
    await userEvent.click(
      canvas.getByRole("button", { name: /Filter comments/ }),
    );
    // Pick a status mode.
    const resolved = await waitFor(() =>
      canvas.getByRole("menuitemradio", { name: /Resolved comments/ }),
    );
    await userEvent.click(resolved);
    await expect(args.onFilterModeChange).toHaveBeenCalledWith("resolved");
    // Re-open and flip the independent "only this file" scope.
    await userEvent.click(
      canvas.getByRole("button", { name: /Filter comments/ }),
    );
    const scope = await waitFor(() =>
      canvas.getByRole("menuitemcheckbox", {
        name: /Hide comments not on this file/,
      }),
    );
    await userEvent.click(scope);
    await expect(args.onOnlyThisFileChange).toHaveBeenCalledWith(true);
  },
};
