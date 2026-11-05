import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactElement, useCallback, useState } from "react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

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

const loadMore = fn();

function PaginatedPicker(): ReactElement {
  const [repos, setRepos] = useState(() => allRepos.slice(0, 16));
  const [loading, setLoading] = useState(false);

  const handleLoadMore = useCallback(() => {
    loadMore();
    setLoading(true);
    window.setTimeout(() => {
      setRepos(allRepos);
      setLoading(false);
    }, 100);
  }, []);

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
        onLoadMore={handleLoadMore}
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

export const StablePagination: Story = {
  render: () => <PaginatedPicker />,
  beforeEach: () => loadMore.mockClear(),
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      ".emr-docnav-repo-btn",
    )!;
    const chevron = trigger.querySelector<SVGElement>(
      ".emr-docnav-repo-chevron",
    )!;
    // Browser tests use a real pointer, which can rest over the centered trigger.
    const restingOpacity = trigger.matches(":hover, :focus-visible")
      ? "0.75"
      : "0";
    expect(getComputedStyle(chevron).opacity).toBe(restingOpacity);
    expect(chevron.getBoundingClientRect().width).toBe(16);
    expect(
      trigger.getBoundingClientRect().right -
        chevron.getBoundingClientRect().right,
    ).toBeCloseTo(5, 1);
    await userEvent.click(trigger);
    expect(getComputedStyle(chevron).opacity).toBe("0.75");
    const list = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        ".emr-docnav-repo-list",
      );
      if (!element || element.scrollHeight <= element.clientHeight) {
        throw new Error("repository list is not scrollable");
      }
      return element;
    });
    const heightBeforeLoading = list.scrollHeight;

    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
    list.dispatchEvent(new Event("scroll", { bubbles: true }));

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(list.textContent).toContain("Loading repositories…"),
    );
    expect(list.scrollHeight).toBe(heightBeforeLoading);
    await waitFor(() =>
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(24),
    );
    expect(loadMore).toHaveBeenCalledTimes(1);
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
        repos={allRepos}
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

/** Closing after a filter re-queries page one exactly once. */
export const FilterResetsOnceOnClose: Story = {
  render: () => <FilteringPicker />,
  beforeEach: () => filterCalls.mockClear(),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      canvasElement.querySelector<HTMLButtonElement>(".emr-docnav-repo-btn")!,
    );
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        ".emr-docnav-repo-filter-input",
      );
      if (!el) throw new Error("filter input not shown");
      return el;
    });
    await userEvent.type(input, "rep");
    await waitFor(() => expect(filterCalls).toHaveBeenCalledWith("rep"));
    await userEvent.keyboard("{Escape}");
    // Longer than the 250 ms debounce, so a stray second re-query would land.
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(filterCalls.mock.calls).toEqual([["rep"], [""]]);
  },
};
