// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    ReaderActivityIndicator,
    readerActivityKey,
    selectReaderActivity,
    useDelayedReaderActivity,
    type ReaderActivity,
} from "../src/shell/components/readerActivity";
import { buildReaderActivities } from "../src/shell/shellHelpers";

describe("selectReaderActivity", () => {
    it("selects the highest priority activity", () => {
        expect(
            selectReaderActivity([
                { id: "sync", label: "Syncing comments…", priority: 10 },
                { id: "document", label: "Loading document…", priority: 100 },
                { id: "search", label: "Searching documents…", priority: 40 },
            ]),
        ).toMatchObject({ id: "document" });
    });

    it("selects the latest activity when priorities tie", () => {
        expect(
            selectReaderActivity([
                { id: "first", label: "First…", priority: 40 },
                { id: "latest", label: "Latest…", priority: 40 },
            ]),
        ).toMatchObject({ id: "latest" });
    });

    it("returns null when no work is active", () => {
        expect(selectReaderActivity([])).toBeNull();
    });
});

describe("readerActivityKey", () => {
    const loading = { id: "document", label: "Loading…", priority: 100 };

    it("is the same for an equivalent activity object", () => {
        expect(readerActivityKey({ ...loading })).toBe(readerActivityKey(loading));
    });

    it("changes when the activity's meaning changes", () => {
        expect(readerActivityKey({ ...loading, priority: 101 })).not.toBe(
            readerActivityKey(loading),
        );
    });

    it("is empty when there is no activity", () => {
        expect(readerActivityKey(null)).toBe("");
    });
});

describe("buildReaderActivities", () => {
    const settled = {
        navigationActivities: [],
        commentSyncing: false,
        fileRefreshing: false,
        historicalLoading: false,
        documentLoading: false,
    };

    it("combines navigation and refresh work, with the document load taking precedence", () => {
        const activities = buildReaderActivities({
            navigationActivities: [{ id: "search", label: "Searching documents…", priority: 40 }],
            commentSyncing: true,
            fileRefreshing: true,
            historicalLoading: false,
            documentLoading: true,
        });

        expect(activities).toEqual([
            { id: "search", label: "Searching documents…", priority: 40 },
            { id: "comment-sync", label: "Refreshing files and comments…", priority: 60 },
            { id: "document", label: "Loading document…", priority: 100 },
        ]);
        expect(selectReaderActivity(activities)?.id).toBe("document");
    });

    it.each([
        {
            name: "reports a file refresh, and a version load instead of the document load",
            state: { fileRefreshing: true, historicalLoading: true, documentLoading: true },
            expected: [
                { id: "file-refresh", label: "Refreshing files…", priority: 60 },
                { id: "history", label: "Loading document version…", priority: 100 },
            ],
        },
        {
            name: "reports the document load when no version is loading",
            state: { documentLoading: true },
            expected: [{ id: "document", label: "Loading document…", priority: 100 }],
        },
        {
            name: "reports background comment sync without elevating it to a refresh",
            state: { commentSyncing: true },
            expected: [{ id: "comment-sync", label: "Syncing comments…", priority: 20 }],
        },
        { name: "reports no activity when the reader is settled", state: {}, expected: [] },
    ])("$name", ({ state, expected }) => {
        expect(buildReaderActivities({ ...settled, ...state })).toEqual(expected);
    });
});
describe("ReaderActivityIndicator", () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
        true;

    function show(activity: ReaderActivity, activeCount?: number): HTMLElement {
        const host = document.createElement("div");
        const root = createRoot(host);
        act(() => {
            root.render(createElement(ReaderActivityIndicator, { activity, activeCount }));
        });
        onCleanup.push(() => act(() => root.unmount()));

        return host;
    }

    const onCleanup: Array<() => void> = [];

    afterEach(() => {
        while (onCleanup.length > 0) onCleanup.pop()!();
    });

    it("shows work in progress with a spinner and no action", () => {
        const host = show({ id: "doc", label: "Loading document…", priority: 100 }, 2);
        expect(host.querySelector(".emr-statusbar-spinner")).toBeTruthy();
        expect(host.querySelector("button")).toBeNull();
        expect(host.querySelector('[role="status"]')?.getAttribute("title")).toBe(
            "Loading document… (2 operations running)",
        );
    });

    it("offers the activity's action beside its message", () => {
        const onClick = vi.fn();

        const host = show({
            id: "boot-slow",
            label: "Still loading…",
            priority: 100,
            action: { label: "Try again", onClick },
        });

        act(() => host.querySelector("button")!.click());
        expect(onClick).toHaveBeenCalledOnce();
    });
});

describe("useDelayedReaderActivity", () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
        true;

    afterEach(() => {
        vi.useRealTimers();
    });

    it("hides the shown activity when it changes, then shows the new one after the delay", () => {
        vi.useFakeTimers();
        const root = createRoot(document.createElement("div"));
        const committed: (string | null)[] = [];

        function Probe(props: { activity: ReaderActivity | null }) {
            const visible = useDelayedReaderActivity(props.activity, 100);
            committed.push(visible?.id ?? null);

            return null;
        }

        const render = (activity: ReaderActivity | null) => {
            act(() => {
                root.render(createElement(Probe, { activity }));
            });
        };

        const advance = (ms: number) => {
            act(() => {
                vi.advanceTimersByTime(ms);
            });
        };

        const latest = () => committed[committed.length - 1];

        render({ id: "first", label: "First…", priority: 10 });
        expect(latest()).toBeNull();
        advance(100);
        expect(latest()).toBe("first");

        render({ id: "second", label: "Second…", priority: 10 });
        expect(latest()).toBeNull();
        advance(99);
        expect(latest()).toBeNull();
        advance(1);
        expect(latest()).toBe("second");

        render(null);
        expect(latest()).toBeNull();
        advance(100);
        expect(latest()).toBeNull();

        act(() => {
            root.unmount();
        });
    });
});
