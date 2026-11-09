import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactElement, useCallback, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { DocRepo } from "../shell/types";
import { RepoPicker } from "./RepoPicker";

const allRepos: DocRepo[] = Array.from({ length: 24 }, (_, index) => ({
    id: `repo-${index + 1}`,
    name: `repository-${String(index + 1).padStart(2, "0")}`,
    description: "",
    defaultBranch: "main",
    files: [],
    recentPr: null,
    detailsLoaded: false,
}));

/**
 * A paging host the play function drives step by step: `onLoadMore` only
 * records the request; the story then reports the request as started and
 * delivers the next page when it chooses — like a host that first waits for a
 * fresh access token, then for the REST call.
 */
const pagingHost = {
    loadMore: fn(),
    startLoading: () => {},
    deliverNextPage: () => {},
};

function PaginatedPicker(): ReactElement {
    const [repos, setRepos] = useState(() => allRepos.slice(0, 16));
    const [loading, setLoading] = useState(false);

    pagingHost.startLoading = () => setLoading(true);

    pagingHost.deliverNextPage = () => {
        setRepos(allRepos);
        setLoading(false);
    };

    return (
        <div style={{ width: 260 }}>
            <RepoPicker
                repos={repos}
                selectedId={repos[0]!.id}
                selectedName={repos[0]!.name}
                onSelect={fn()}
                paginated
                hasMore={repos.length < allRepos.length}
                loading={loading}
                onLoadMore={pagingHost.loadMore}
                onFilter={fn()}
            />
        </div>
    );
}

const meta = {
    title: "Components/RepoPicker",
    component: RepoPicker,
    parameters: { layout: "centered" },
    args: {
        repos: allRepos.slice(0, 16),
        selectedId: allRepos[0]!.id,
        onSelect: fn(),
    },
} satisfies Meta<typeof RepoPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Scroll `list` to its end, as the reader's wheel would, and wait for the scroll event. */
async function scrollToEnd(list: HTMLElement, offset = 0): Promise<void> {
    const scrolled = new Promise((resolve) => {
        list.addEventListener("scroll", resolve, { once: true });
    });

    list.scrollTop = list.scrollHeight - list.clientHeight - offset;
    await scrolled;
}

/**
 * Scrolling to the end of a long repository list asks the host for the next
 * page exactly once — even if the reader keeps scrolling before the host
 * reports it is loading — shows "Loading repositories…" without the list
 * jumping, then appends the new repositories.
 */
export const ScrollingLoadsNextPage: Story = {
    render: () => <PaginatedPicker />,
    beforeEach: () => {
        pagingHost.loadMore.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "repository-01" }));

        const list = canvas.getByRole("listbox", { name: "Repository" });

        await expect(within(list).getAllByRole("option")).toHaveLength(16);
        await expect(canvas.getByRole("textbox", { name: "Filter repositories" })).toHaveFocus();

        const heightBeforeLoading = list.scrollHeight;

        await scrollToEnd(list);
        await waitFor(() => expect(pagingHost.loadMore).toHaveBeenCalledTimes(1));

        // Still at the end while the request hasn't started: no second request.
        await scrollToEnd(list, 4);
        await scrollToEnd(list);
        await expect(pagingHost.loadMore).toHaveBeenCalledTimes(1);

        pagingHost.startLoading();
        await waitFor(() =>
            expect(within(list).getByRole("status")).toHaveTextContent("Loading repositories…"),
        );
        await expect(list.scrollHeight).toBe(heightBeforeLoading);
        await scrollToEnd(list, 4);

        pagingHost.deliverNextPage();
        await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(24));
        await expect(within(list).queryByRole("status")).toBeNull();
        await expect(pagingHost.loadMore).toHaveBeenCalledTimes(1);
    },
};

const filterCalls = fn();

/** A paginated host that applies `onFilter` like DocumentsHubApp does. */
function FilteringPicker(): ReactElement {
    const [filter, setFilter] = useState("");

    const handleFilter = useCallback((text: string) => {
        filterCalls(text);
        setFilter(text);
    }, []);

    return (
        <div style={{ width: 260 }}>
            <RepoPicker
                repos={allRepos.filter((repo) => repo.name.includes(filter))}
                selectedId={allRepos[0]!.id}
                selectedName={allRepos[0]!.name}
                onSelect={fn()}
                paginated
                filter={filter}
                onFilter={handleFilter}
            />
        </div>
    );
}

/**
 * Like Azure DevOps, closing the picker clears its keyword filter: the host
 * re-queries the unfiltered first page once, and reopening shows every
 * repository with an empty filter box.
 */
export const ClosingClearsFilter: Story = {
    render: () => <FilteringPicker />,
    beforeEach: () => {
        filterCalls.mockClear();
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const trigger = canvas.getByRole("button", { name: "repository-01" });
        await userEvent.click(trigger);

        const input = canvas.getByRole("textbox", { name: "Filter repositories" });
        await userEvent.click(input);
        await userEvent.paste("repository-2");
        await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(5));
        await expect(filterCalls).toHaveBeenCalledWith("repository-2");

        await userEvent.keyboard("{Escape}");
        await expect(canvas.queryByRole("listbox")).toBeNull();
        await expect(trigger).toHaveFocus();

        await userEvent.click(trigger);
        await expect(canvas.getByRole("textbox", { name: "Filter repositories" })).toHaveValue("");
        await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(24));
        await expect(filterCalls.mock.calls).toEqual([["repository-2"], [""]]);
    },
};
