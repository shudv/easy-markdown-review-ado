import { describe, expect, it } from "vitest";

import {
  readerActivityKey,
  selectReaderActivity,
} from "../src/shell/components/readerActivity";
import { buildReaderActivities } from "../src/shell/prShellHelpers";

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
