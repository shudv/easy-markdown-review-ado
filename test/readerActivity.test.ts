// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
  it("is stable for equivalent activity objects and changes with semantics", () => {
    const first = { id: "document", label: "Loading…", priority: 100 };
    expect(readerActivityKey({ ...first })).toBe(readerActivityKey(first));
    expect(readerActivityKey({ ...first, priority: 101 })).not.toBe(
      readerActivityKey(first),
    );
    expect(readerActivityKey(null)).toBe("");
  });
});

describe("buildReaderActivities", () => {
  it("combines navigation and refresh work with deterministic priorities", () => {
    const activities = buildReaderActivities({
      navigationActivities: [
        { id: "search", label: "Searching documents…", priority: 40 },
      ],
      commentSyncing: true,
      fileRefreshing: true,
      historicalLoading: false,
      documentLoading: true,
    });
    expect(activities.map((activity) => activity.id)).toEqual([
      "search",
      "comment-sync",
      "document",
    ]);
    expect(selectReaderActivity(activities)?.id).toBe("document");
    expect(activities[1]?.label).toBe("Refreshing files and comments…");
  });

  it("reports standalone file refresh and prefers history over document load", () => {
    const activities = buildReaderActivities({
      navigationActivities: [],
      commentSyncing: false,
      fileRefreshing: true,
      historicalLoading: true,
      documentLoading: true,
    });
    expect(activities.map((activity) => activity.id)).toEqual([
      "file-refresh",
      "history",
    ]);
    expect(activities).toEqual([
      { id: "file-refresh", label: "Refreshing files…", priority: 60 },
      { id: "history", label: "Loading document version…", priority: 100 },
    ]);
  });

  it("uses the exact document-loading activity when no history is loading", () => {
    expect(
      buildReaderActivities({
        navigationActivities: [],
        commentSyncing: false,
        fileRefreshing: false,
        historicalLoading: false,
        documentLoading: true,
      }),
    ).toEqual([{ id: "document", label: "Loading document…", priority: 100 }]);
  });

  it("reports background comment sync without elevating it to refresh", () => {
    expect(
      buildReaderActivities({
        navigationActivities: [],
        commentSyncing: true,
        fileRefreshing: false,
        historicalLoading: false,
        documentLoading: false,
      }),
    ).toEqual([
      {
        id: "comment-sync",
        label: "Syncing comments…",
        priority: 20,
      },
    ]);
  });

  it("returns no activity when the reader is settled", () => {
    expect(
      buildReaderActivities({
        navigationActivities: [],
        commentSyncing: false,
        fileRefreshing: false,
        historicalLoading: false,
        documentLoading: false,
      }),
    ).toEqual([]);
  });
});

describe("useDelayedReaderActivity", () => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

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
