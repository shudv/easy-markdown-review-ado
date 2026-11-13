// Tests for the PR tab's slow-boot signal: it appears only after a long
// VISIBLE wait, and a new attempt starts the clock again.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VisibilityClock } from "../src/pr-tab/prTabApp.helpers";
import {
    checkingForUpdatesActivity,
    isBootWaiting,
    PrTabLoadingView,
    SLOW_BOOT_MS,
    useSlowBoot,
} from "../src/pr-tab/useSlowBoot";
import { mountTracked, unmountAll } from "./shellHarness";

function clock() {
    let visible = true;
    let listener: (() => void) | null = null;

    const visibility: VisibilityClock = {
        now: () => Date.now(),
        isVisible: () => visible,
        subscribeVisibilityChange(next) {
            listener = next;

            return () => {
                listener = null;
            };
        },
    };

    return {
        visibility,
        setVisible(next: boolean) {
            visible = next;
            listener?.();
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    unmountAll();
    vi.useRealTimers();
});

type Props = { waiting: boolean; attempt: number; visibility: VisibilityClock };
const useHook = (p: Props) => useSlowBoot(p.waiting, p.attempt, p.visibility);

async function advance(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

describe("checkingForUpdatesActivity", () => {
    it("tells the user a cached PR is being checked for a newer version, below shell operations", () => {
        expect(checkingForUpdatesActivity()).toEqual({
            id: "pr-check-updates",
            label: "Checking for updates…",
            priority: 30,
        });
    });
});

describe("isBootWaiting", () => {
    it.each([
        {
            name: "waits before anything has loaded",
            ctx: null,
            error: null,
            refreshing: null,
            waiting: true,
        },
        {
            name: "waits after a blank error",
            ctx: null,
            error: "",
            refreshing: null,
            waiting: true,
        },
        {
            name: "stops once the PR has loaded",
            ctx: {},
            error: null,
            refreshing: null,
            waiting: false,
        },
        {
            name: "stops on a boot error",
            ctx: null,
            error: "boom",
            refreshing: null,
            waiting: false,
        },
        {
            name: "stops while reconnecting",
            ctx: null,
            error: null,
            refreshing: {},
            waiting: false,
        },
    ])("$name", ({ ctx, error, refreshing, waiting }) => {
        expect(isBootWaiting(ctx, error, refreshing)).toBe(waiting);
    });
});

describe("PrTabLoadingView", () => {
    it("shows the plain loading message until boot is slow", async () => {
        const host = document.createElement("div");
        const root = createRoot(host);
        await act(async () => {
            root.render(createElement(PrTabLoadingView, { slow: false, onRetry: vi.fn() }));
        });
        expect(host.querySelector(".emr-loading-statusbar")?.textContent).toBe(
            "Loading pull request",
        );
        expect(host.querySelector("button")).toBeNull();
        act(() => root.unmount());
    });
});

describe("useSlowBoot", () => {
    it("says boot is slow only after the full visible wait", async () => {
        const { visibility } = clock();
        const hook = await mountTracked(useHook, { waiting: true, attempt: 0, visibility });
        await advance(SLOW_BOOT_MS - 1);
        expect(hook.current).toBe(false);
        await advance(1);
        expect(hook.current).toBe(true);
    });

    it("doesn't count time the tab spent hidden", async () => {
        const c = clock();

        const hook = await mountTracked(useHook, {
            waiting: true,
            attempt: 0,
            visibility: c.visibility,
        });

        await advance(SLOW_BOOT_MS / 2);
        c.setVisible(false);
        await advance(SLOW_BOOT_MS * 3);
        expect(hook.current).toBe(false);
        c.setVisible(true);
        await advance(SLOW_BOOT_MS / 2);
        expect(hook.current).toBe(true);
    });

    it("starts again for a new attempt, and clears once boot stops waiting", async () => {
        const { visibility } = clock();
        const hook = await mountTracked(useHook, { waiting: true, attempt: 0, visibility });
        await advance(SLOW_BOOT_MS);
        expect(hook.current).toBe(true);

        await hook.rerender({ waiting: true, attempt: 1, visibility });
        expect(hook.current).toBe(false);
        await advance(SLOW_BOOT_MS);
        expect(hook.current).toBe(true);

        await hook.rerender({ waiting: false, attempt: 1, visibility });
        expect(hook.current).toBe(false);
    });
});
