// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    BootErrorView,
    DEAD_WINDOW_ISSUE_URL,
    NoMarkdownFilesView,
    SessionRefreshingView,
    reconnectEta,
} from "../src/pr-tab/PrTabStatusViews";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
    container = null;
});

function mount(element: ReactElement): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(element));

    return container;
}

function click(el: Element | null): void {
    act(() => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("SessionRefreshingView", () => {
    it("reassures without a manual action while an auto reload is pending", () => {
        const onReload = vi.fn();

        const el = mount(<SessionRefreshingView autoReload onReload={onReload} />);

        const status = el.querySelector(".emr-error[role='status']");
        expect(status?.querySelector("h2")?.textContent).toBe("Reconnecting to Azure DevOps…");
        expect(status?.textContent).toContain("This only takes a moment.");
        expect(el.querySelector("button")).toBeNull();
        expect(onReload).not.toHaveBeenCalled();
    });

    it("offers a manual reload once auto recovery is off", () => {
        const onReload = vi.fn();

        const el = mount(<SessionRefreshingView autoReload={false} onReload={onReload} />);

        expect(el.textContent).toContain("This usually fixes itself within a few minutes.");
        const button = el.querySelector("button.emr-error-retry");
        expect(button?.getAttribute("type")).toBe("button");
        expect(button?.textContent).toBe("Reload page");
        click(button);
        expect(onReload).toHaveBeenCalledTimes(1);
        expectIssueLink(el);
    });

    // Production: users stuck in a window that survives reloads clicked
    // "Reload page" every few seconds (25 times in 8 minutes for one user), each
    // landing back in the same window as a new failed session.
    describe("once the window survived an automatic reload", () => {
        afterEach(() => vi.useRealTimers());

        it("explains why, says when it continues, and offers no reload", () => {
            vi.useFakeTimers();

            const el = mount(
                <SessionRefreshingView
                    autoReload={false}
                    reloadTried
                    recoverAtMs={Date.now() + 4.5 * 60_000}
                    onReload={vi.fn()}
                />,
            );

            expect(el.textContent).toContain(
                "Azure DevOps is still giving this tab an expired sign-in, so reloading won't help. It will continue by itself within about 5 minutes.",
            );
            expect(el.querySelector("button")).toBeNull();
            expectIssueLink(el);
        });

        it("keeps the estimate current while it waits", () => {
            vi.useFakeTimers();

            const el = mount(
                <SessionRefreshingView
                    autoReload={false}
                    reloadTried
                    recoverAtMs={Date.now() + 4.5 * 60_000}
                    onReload={vi.fn()}
                />,
            );

            act(() => {
                vi.advanceTimersByTime(2 * 60_000);
            });
            expect(el.textContent).toContain("within about 3 minutes");
        });
    });
});

function expectIssueLink(el: HTMLElement): void {
    const link = el.querySelector("a");
    expect(link?.textContent).toBe("Why this happens (known Azure DevOps issue)");
    expect(link?.getAttribute("href")).toBe(DEAD_WINDOW_ISSUE_URL);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
}

describe("reconnectEta", () => {
    const now = 1_000_000;

    it.each<[string, number | undefined, string]>([
        ["no known recovery time", undefined, "within a few minutes"],
        ["a recovery time already past", now - 5_000, "within a minute"],
        ["under a minute away", now + 40_000, "within a minute"],
        ["exactly a minute away", now + 60_000, "within a minute"],
        ["several minutes away, rounded up", now + 3 * 60_000 + 1, "within about 4 minutes"],
    ])("phrases %s", (_label, recoverAtMs, expected) => {
        expect(reconnectEta(recoverAtMs, now)).toBe(expected);
    });
});

describe("BootErrorView", () => {
    it("shows the error and retries on demand", () => {
        const onRetry = vi.fn();

        const el = mount(<BootErrorView error="TF400813: nope" onRetry={onRetry} />);

        expect(el.querySelector(".emr-error h2")?.textContent).toBe("Something went wrong");
        expect(el.querySelector("pre")?.textContent).toBe("TF400813: nope");
        const button = el.querySelector("button.emr-error-retry");
        expect(button?.textContent).toBe("Try again");
        click(button);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe("NoMarkdownFilesView", () => {
    it("explains that only Markdown files are shown", () => {
        const el = mount(<NoMarkdownFilesView />);
        expect(el.querySelector(".emr-error h2")?.textContent).toBe(
            "No Markdown files changed in this PR",
        );
        expect(el.querySelector("p")?.textContent).toContain(
            "Switch to the Files tab for the rest.",
        );
    });
});
