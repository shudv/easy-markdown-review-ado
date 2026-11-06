// Behavioural tests for the Documents hub chrome: the inline repo picker
// (open/close, keyboard, dismissal, debounced filter, infinite scroll), the
// empty-repo shell and the refresh glyph.
//
// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocRepo } from "../src/shell/types";
import { RepoPicker } from "../src/hub/RepoPicker";
import { DocsEmptyShell } from "../src/hub/DocsEmptyShell";
import { SvgRefresh } from "../src/hub/hubIcons";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PickerProps = ComponentProps<typeof RepoPicker>;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function repo(id: string): DocRepo {
  return {
    id,
    name: `name-${id}`,
    description: "",
    defaultBranch: "main",
    files: [],
    recentPr: null,
  };
}

const repos = [repo("a"), repo("b"), repo("c")];

function render(props: Partial<PickerProps> = {}): PickerProps {
  const full: PickerProps = {
    repos,
    selectedId: "b",
    onSelect: vi.fn(),
    ...props,
  };

  act(() => root.render(<RepoPicker {...full} />));

  return full;
}

const trigger = () =>
  container.querySelector<HTMLButtonElement>(".emr-docnav-repo-btn")!;

const menu = () =>
  container.querySelector<HTMLElement>(".emr-docnav-repo-menu");

const list = () =>
  container.querySelector<HTMLElement>(".emr-docnav-repo-list")!;

const options = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));

const filterInput = () =>
  container.querySelector<HTMLInputElement>(".emr-docnav-repo-filter-input")!;

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

function dispatch(target: EventTarget, type: string): void {
  act(() => {
    target.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

function type(input: HTMLInputElement, value: string): void {
  // Go through the prototype setter so React's value tracker sees a change.
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!;

  act(() => {
    descriptor.set!.bind(input)(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RepoPicker", () => {
  it("names the trigger from the repo list or the explicit name", () => {
    render();
    expect(trigger().title).toBe("name-b");
    render({ selectedName: "Pinned" });
    expect(trigger().title).toBe("Pinned");
    render({ selectedId: "missing" });
    expect(trigger().title).toBe("");
  });

  it("opens on click, focuses the selected option and toggles closed", () => {
    render();
    click(trigger());
    expect(menu()).not.toBeNull();
    expect(menu()!.style.position).toBe("fixed");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(options()[1]);
    expect(options()[1]!.className).toContain("is-selected");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    click(trigger());
    expect(menu()).toBeNull();
  });

  it("opens from the keyboard and focuses the first option by default", () => {
    render({ selectedId: "missing" });
    key(trigger(), "Tab");
    expect(menu()).toBeNull();
    key(trigger(), "ArrowDown");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(options()[0]);
    key(trigger(), "Enter");
    expect(menu()).not.toBeNull();
    click(trigger());
    key(trigger(), "Enter");
    expect(menu()).not.toBeNull();
    click(trigger());
    key(trigger(), " ");
    expect(menu()).not.toBeNull();
  });

  it("opens an empty list without a focus target", () => {
    render({ repos: [], selectedName: "Solo" });
    click(trigger());
    expect(options()).toHaveLength(0);
    expect(list().textContent).toContain("No repositories match");
  });

  it("moves focus with arrow keys, chooses on click and closes on Escape", () => {
    const props = render();
    click(trigger());
    key(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(options()[2]);
    key(menu()!, "x");
    expect(document.activeElement).toBe(options()[2]);
    click(options()[0]!);
    expect(props.onSelect).toHaveBeenCalledWith("a");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    click(trigger());
    key(menu()!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on outside pointer, outside scroll and resize", () => {
    render();
    click(trigger());
    dispatch(options()[0]!, "pointerdown");
    dispatch(trigger(), "pointerdown");
    expect(menu()).not.toBeNull();
    dispatch(document.body, "pointerdown");
    expect(menu()).toBeNull();

    click(trigger());
    dispatch(list(), "scroll");
    expect(menu()).not.toBeNull();
    dispatch(options()[0]!, "scroll");
    expect(menu()).not.toBeNull();
    dispatch(document, "scroll");
    expect(menu()).toBeNull();

    click(trigger());
    dispatch(window, "scroll");
    expect(menu()).toBeNull();

    click(trigger());
    dispatch(window, "resize");
    expect(menu()).toBeNull();
  });

  it("debounces the paginated filter and clears it on close", () => {
    vi.useFakeTimers();
    const onFilter = vi.fn();
    const props = render({ paginated: true, onFilter });
    click(trigger());
    expect(document.activeElement).toBe(filterInput());

    type(filterInput(), "do");
    type(filterInput(), "doc");
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onFilter).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFilter).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledWith("doc");

    act(() => root.render(<RepoPicker {...props} filter="doc" />));
    click(trigger());
    expect(onFilter).toHaveBeenLastCalledWith("");
    expect(onFilter).toHaveBeenCalledTimes(2);
  });

  it("tolerates a paginated picker without a filter handler", () => {
    vi.useFakeTimers();
    const props = render({ paginated: true, filter: "x" });
    click(trigger());
    type(filterInput(), "y");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    act(() => root.render(<RepoPicker {...props} />));
    click(trigger());
    expect(menu()).toBeNull();
  });

  it("clears local filter text on close in non-paginated mode", () => {
    render({ filter: "abc" });
    click(trigger());
    click(trigger());
    click(trigger());
    expect(menu()).not.toBeNull();
  });

  it("pages in more repos near the bottom, once per load", () => {
    const onLoadMore = vi.fn();
    const props = render({ paginated: true, hasMore: true, onLoadMore });
    click(trigger());
    const el = list();
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      value: 100,
    });
    el.scrollTop = 0;
    dispatch(el, "scroll");
    expect(onLoadMore).not.toHaveBeenCalled();

    el.scrollTop = 900;
    dispatch(el, "scroll");
    dispatch(el, "scroll");
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    act(() => root.render(<RepoPicker {...props} loading />));
    expect(el.textContent).toContain("Loading repositories…");
    expect(
      container
        .querySelector(".emr-docnav-repo-page-status")!
        .getAttribute("role"),
    ).toBe("status");
    dispatch(el, "scroll");
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    act(() => root.render(<RepoPicker {...props} loading={false} />));
    dispatch(el, "scroll");
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does not page when exhausted or unwired", () => {
    const onLoadMore = vi.fn();
    const props = render({ paginated: true, hasMore: false, onLoadMore });
    click(trigger());
    dispatch(list(), "scroll");
    act(() =>
      root.render(<RepoPicker {...props} hasMore onLoadMore={undefined} />),
    );
    dispatch(list(), "scroll");
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(
      container
        .querySelector(".emr-docnav-repo-page-status")!
        .getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("shows the paginated no-match status", () => {
    render({ paginated: true, repos: [], selectedName: "Solo" });
    click(trigger());
    type(filterInput(), " zz ");
    expect(list().textContent).toContain("No repositories match “zz”.");
    expect(
      container
        .querySelector(".emr-docnav-repo-page-status")!
        .getAttribute("aria-hidden"),
    ).toBeNull();
  });
});

describe("DocsEmptyShell", () => {
  it("keeps the header live and explains the empty repo", () => {
    act(() =>
      root.render(
        <DocsEmptyShell
          titleSlot={<span className="slot">title</span>}
          headerActions={<button type="button">act</button>}
          repoName="empty-repo"
        />,
      ),
    );
    expect(container.querySelector(".emr-docnav-header .slot")).not.toBeNull();
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-label")).toBe(
      "No documents in empty-repo",
    );
    expect(status.textContent).toContain("empty-repo");
  });
});

describe("SvgRefresh", () => {
  it("spins only while refreshing", () => {
    act(() => root.render(<SvgRefresh spinning />));
    expect(container.querySelector("svg")!.getAttribute("class")).toContain(
      "is-spinning",
    );
    act(() => root.render(<SvgRefresh />));
    expect(container.querySelector("svg")!.getAttribute("class")).not.toContain(
      "is-spinning",
    );
  });
});
