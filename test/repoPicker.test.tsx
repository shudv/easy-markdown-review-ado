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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const trigger = () => container.querySelector<HTMLButtonElement>(".emr-docnav-repo-btn")!;

const menu = () => container.querySelector<HTMLElement>(".emr-docnav-repo-menu");

const list = () => container.querySelector<HTMLElement>(".emr-docnav-repo-list")!;

const options = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));

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
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;

    act(() => {
        descriptor.set!.bind(input)(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function scrollListTo(el: HTMLElement, scrollTop: number): void {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 100 });
    el.scrollTop = scrollTop;
    dispatch(el, "scroll");
}

describe("RepoPicker", () => {
    it.each([
        { name: "the selected repo's name", props: {}, expected: "name-b" },
        {
            name: "an explicit name for a repo outside the list",
            props: { selectedName: "Pinned" },
            expected: "Pinned",
        },
        { name: "nothing for an unknown repo", props: { selectedId: "missing" }, expected: "" },
    ])("titles the trigger with $name", ({ props, expected }) => {
        render(props);

        expect(trigger().title).toBe(expected);
    });

    it("opens on click as a fixed popover, focusing the selected repo", () => {
        render();

        click(trigger());

        expect(menu()!.style.position).toBe("fixed");
        expect(trigger().getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement).toBe(options()[1]);
        expect(options()[1]!.className).toContain("is-selected");
        expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    });

    it("closes when the trigger is clicked again", () => {
        render();
        click(trigger());

        click(trigger());

        expect(menu()).toBeNull();
    });

    it.each(["ArrowDown", "Enter", " "])(
        "opens from the keyboard with %j, focusing the first repo when none is selected",
        (pressed) => {
            render({ selectedId: "missing" });

            key(trigger(), pressed);

            expect(menu()).not.toBeNull();
            expect(document.activeElement).toBe(options()[0]);
        },
    );

    it("does not open when focus merely tabs through the trigger", () => {
        render();

        key(trigger(), "Tab");

        expect(menu()).toBeNull();
    });

    it("stays open when Enter is pressed on the trigger of an open menu", () => {
        render();
        click(trigger());

        key(trigger(), "Enter");

        expect(menu()).not.toBeNull();
    });

    it("explains an empty repository list", () => {
        render({ repos: [], selectedName: "Solo" });

        click(trigger());

        expect(options()).toHaveLength(0);
        expect(list().textContent).toContain("No repositories match");
    });

    it("moves focus to the next repo with ArrowDown", () => {
        render();
        click(trigger());

        key(menu()!, "ArrowDown");

        expect(document.activeElement).toBe(options()[2]);
    });

    it("keeps focus in place for keys that don't navigate", () => {
        render();
        click(trigger());

        key(menu()!, "x");

        expect(document.activeElement).toBe(options()[1]);
    });

    it("chooses a repo on click, closes and returns focus to the trigger", () => {
        const props = render();
        click(trigger());

        click(options()[0]!);

        expect(props.onSelect).toHaveBeenCalledWith("a");
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it("closes on Escape and returns focus to the trigger", () => {
        render();
        click(trigger());

        key(menu()!, "Escape");

        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    // The menu is fixed to the trigger's position, so anything that moves the
    // page closes it rather than leaving it floating in the wrong place.
    it.each([
        { name: "a pointer press outside it", act: () => dispatch(document.body, "pointerdown") },
        { name: "the page scrolling", act: () => dispatch(document, "scroll") },
        { name: "the window scrolling", act: () => dispatch(window, "scroll") },
        { name: "the window resizing", act: () => dispatch(window, "resize") },
    ])("closes on $name", ({ act: dismiss }) => {
        render();
        click(trigger());

        dismiss();

        expect(menu()).toBeNull();
    });

    it.each([
        { name: "a pointer press on a repo", act: () => dispatch(options()[0]!, "pointerdown") },
        { name: "a pointer press on the trigger", act: () => dispatch(trigger(), "pointerdown") },
        { name: "scrolling the repo list", act: () => dispatch(list(), "scroll") },
        { name: "a scroll inside a repo row", act: () => dispatch(options()[0]!, "scroll") },
    ])("stays open on $name", ({ act: interact }) => {
        render();
        click(trigger());

        interact();

        expect(menu()).not.toBeNull();
    });

    describe("paginated filter", () => {
        it("focuses the filter box on open", () => {
            render({ paginated: true, onFilter: vi.fn() });

            click(trigger());

            expect(document.activeElement).toBe(filterInput());
        });

        it("queries once, 250ms after the user stops typing", () => {
            vi.useFakeTimers();
            const onFilter = vi.fn();
            render({ paginated: true, onFilter });
            click(trigger());

            type(filterInput(), "do");
            type(filterInput(), "doc");
            act(() => {
                vi.advanceTimersByTime(249);
            });

            expect(onFilter).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(1);
            });

            expect(onFilter).toHaveBeenCalledExactlyOnceWith("doc");
        });

        it("clears an applied filter when the picker closes, so it reopens unfiltered", () => {
            vi.useFakeTimers();
            const onFilter = vi.fn();
            const props = render({ paginated: true, onFilter });
            click(trigger());
            type(filterInput(), "doc");
            act(() => {
                vi.advanceTimersByTime(250);
            });
            act(() => root.render(<RepoPicker {...props} filter="doc" />));

            click(trigger());

            expect(onFilter).toHaveBeenLastCalledWith("");
        });

        it("filters and closes without errors when no filter handler is wired", () => {
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

        it("explains when no repository matches the filter", () => {
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

    describe("infinite scroll", () => {
        it("does not ask for more repos away from the bottom of the list", () => {
            const onLoadMore = vi.fn();
            render({ paginated: true, hasMore: true, onLoadMore });
            click(trigger());

            scrollListTo(list(), 0);

            expect(onLoadMore).not.toHaveBeenCalled();
        });

        it("asks for the next page once, however often the list scrolls near its bottom", () => {
            const onLoadMore = vi.fn();
            render({ paginated: true, hasMore: true, onLoadMore });
            click(trigger());

            scrollListTo(list(), 900);
            dispatch(list(), "scroll");

            expect(onLoadMore).toHaveBeenCalledOnce();
        });

        it("announces the page load and does not ask again while it runs", () => {
            const onLoadMore = vi.fn();
            const props = render({ paginated: true, hasMore: true, onLoadMore });
            click(trigger());
            scrollListTo(list(), 900);

            act(() => root.render(<RepoPicker {...props} loading />));
            dispatch(list(), "scroll");

            expect(list().textContent).toContain("Loading repositories…");
            expect(
                container.querySelector(".emr-docnav-repo-page-status")!.getAttribute("role"),
            ).toBe("status");
            expect(onLoadMore).toHaveBeenCalledOnce();
        });

        it("asks for the following page once the previous one has loaded", () => {
            const onLoadMore = vi.fn();
            const props = render({ paginated: true, hasMore: true, onLoadMore });
            click(trigger());
            scrollListTo(list(), 900);
            act(() => root.render(<RepoPicker {...props} loading />));
            act(() => root.render(<RepoPicker {...props} loading={false} />));

            dispatch(list(), "scroll");

            expect(onLoadMore).toHaveBeenCalledTimes(2);
        });

        it("stops asking once every repo has loaded", () => {
            const onLoadMore = vi.fn();
            render({ paginated: true, hasMore: false, onLoadMore });
            click(trigger());

            scrollListTo(list(), 900);

            expect(onLoadMore).not.toHaveBeenCalled();
            expect(
                container
                    .querySelector(".emr-docnav-repo-page-status")!
                    .getAttribute("aria-hidden"),
            ).toBe("true");
        });

        it("scrolls without paging when no loader is wired", () => {
            render({ paginated: true, hasMore: true });
            click(trigger());

            scrollListTo(list(), 900);

            expect(menu()).not.toBeNull();
        });
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
        expect(status.getAttribute("aria-label")).toBe("No documents in empty-repo");
        expect(status.textContent).toContain("empty-repo");
    });
});

describe("SvgRefresh", () => {
    it("spins while refreshing", () => {
        act(() => root.render(<SvgRefresh spinning />));

        expect(container.querySelector("svg")!.getAttribute("class")).toContain("is-spinning");
    });

    it("stays still otherwise", () => {
        act(() => root.render(<SvgRefresh />));

        expect(container.querySelector("svg")!.getAttribute("class")).not.toContain("is-spinning");
    });
});
