// Behavioural tests for the `useDocSearch` file-finder hook. We mount a tiny
// React host that runs the hook with a controllable fake remote searcher,
// then drive it through query changes and assert only on the hook's public
// return surface (results, loading, unavailability, open/close) — never on
// how it computes them.
//
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocSearch } from "../src/shell/components/useDocSearch";
import type { FileInfo } from "../src/types";
import type { FileSearchOutcome } from "../src/shell/almSearch";

// Spy on telemetry so we can assert the exact `searchPerformed` payload the
// hook emits (success flag, counts, failure reason).
const trackMock = vi.fn();
vi.mock("../src/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telemetry")>();
  return { ...actual, track: (...args: unknown[]) => trackMock(...args) };
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function file(path: string): FileInfo {
  return { path, changeType: "modified", linesAdded: 0, linesDeleted: 0 };
}

type Hook = ReturnType<typeof useDocSearch>;

interface Handle {
  current: Hook | null;
}

function Harness(props: {
  files: FileInfo[];
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  handle: Handle;
}): null {
  props.handle.current = useDocSearch(props.files, props.onSearchFiles);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: {
  files: FileInfo[];
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
}): Handle {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const handle: Handle = { current: null };
  act(() => {
    root!.render(React.createElement(Harness, { ...props, handle }));
  });
  return handle;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.useRealTimers();
});

/** Advance fake timers inside act() and flush the resulting microtasks. */
async function flush(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    // Let the awaited onSearchFiles promise settle.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDocSearch — local filtering", () => {
  const files = [file("docs/intro.md"), file("docs/guide.md"), file("api.md")];

  it("returns no results and is not searching while the query is empty", () => {
    const h = mount({ files });
    expect(h.current!.isSearching).toBe(false);
    expect(h.current!.searchResults).toEqual([]);
  });

  it("filters files by case-insensitive substring on the path", () => {
    const h = mount({ files });
    act(() => h.current!.setSearchQuery("GUIDE"));
    expect(h.current!.isSearching).toBe(true);
    expect(h.current!.searchResults.map((f) => f.path)).toEqual([
      "docs/guide.md",
    ]);
  });

  it("treats a whitespace-only query as not searching", () => {
    const h = mount({ files });
    act(() => h.current!.setSearchQuery("   "));
    expect(h.current!.isSearching).toBe(false);
    expect(h.current!.searchResults).toEqual([]);
  });
});

describe("useDocSearch — open/close affordance", () => {
  it("opens automatically once a query is typed and closes via closeSearch", () => {
    const h = mount({ files: [file("a.md")] });
    expect(h.current!.searchOpen).toBe(false);
    act(() => h.current!.setSearchQuery("a"));
    expect(h.current!.searchOpen).toBe(true);

    act(() => h.current!.closeSearch());
    expect(h.current!.searchOpen).toBe(false);
    expect(h.current!.isSearching).toBe(false);
    expect(h.current!.searchResults).toEqual([]);
  });
});

describe("useDocSearch — remote merge", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => trackMock.mockClear());

  it("does not call the remote searcher for queries shorter than 2 chars", async () => {
    const onSearchFiles = vi.fn();
    const h = mount({ files: [file("a.md")], onSearchFiles });
    act(() => h.current!.setSearchQuery("a"));
    await flush(1000);
    expect(onSearchFiles).not.toHaveBeenCalled();
    expect(h.current!.remoteLoading).toBe(false);
  });

  it("merges remote hits after local ones, deduped by path", async () => {
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => ({
        kind: "ok",
        files: [file("docs/guide.md"), file("remote/only.md")],
      }),
    );
    const h = mount({
      files: [file("docs/guide.md"), file("local.md")],
      onSearchFiles,
    });
    act(() => h.current!.setSearchQuery("o"));
    // 1-char query: local-only ("o" matches docs and local), no remote.
    act(() => h.current!.setSearchQuery("do"));
    await flush(300);

    expect(onSearchFiles).toHaveBeenCalledWith("do", expect.anything());
    expect(h.current!.searchResults.map((f) => f.path)).toEqual([
      "docs/guide.md", // local hit, kept once despite also being a remote hit
      "remote/only.md", // remote-only hit appended
    ]);
    expect(h.current!.remoteLoading).toBe(false);
    expect(h.current!.searchUnavailable).toBeNull();
  });

  it("surfaces an unavailable outcome and drops remote hits", async () => {
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => ({
        kind: "unavailable",
        reason: "extension-missing",
        message: "Code Search not installed",
      }),
    );
    const h = mount({ files: [file("local.md")], onSearchFiles });
    act(() => h.current!.setSearchQuery("loc"));
    await flush(300);

    expect(h.current!.searchUnavailable).toEqual({
      reason: "extension-missing",
      message: "Code Search not installed",
    });
    // Only the local hit remains.
    expect(h.current!.searchResults.map((f) => f.path)).toEqual(["local.md"]);
  });

  it("treats a rejected remote search as an unknown unavailability", async () => {
    const onSearchFiles = vi.fn(async (): Promise<FileSearchOutcome> => {
      throw new Error("boom");
    });
    const h = mount({ files: [], onSearchFiles });
    act(() => h.current!.setSearchQuery("query"));
    await flush(300);

    expect(h.current!.searchUnavailable).toEqual({ reason: "unknown" });
    expect(h.current!.searchResults).toEqual([]);
  });

  it("recovers from unavailable back to ok on a later successful query", async () => {
    let outcome: FileSearchOutcome = {
      kind: "unavailable",
      reason: "network",
    };
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => outcome,
    );
    const h = mount({ files: [], onSearchFiles });

    act(() => h.current!.setSearchQuery("aa"));
    await flush(300);
    expect(h.current!.searchUnavailable).not.toBeNull();

    outcome = { kind: "ok", files: [file("found.md")] };
    act(() => h.current!.setSearchQuery("aaa"));
    await flush(300);
    expect(h.current!.searchUnavailable).toBeNull();
    expect(h.current!.searchResults.map((f) => f.path)).toEqual(["found.md"]);
  });

  it("sets remoteLoading true during the debounce and clears it after settle", async () => {
    let resolveOutcome: (o: FileSearchOutcome) => void = () => {};
    const onSearchFiles = vi.fn(
      () =>
        new Promise<FileSearchOutcome>((res) => {
          resolveOutcome = res;
        }),
    );
    const h = mount({ files: [], onSearchFiles });
    act(() => h.current!.setSearchQuery("abc"));
    // After the debounce fires but before the promise settles, loading is on.
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(h.current!.remoteLoading).toBe(true);
    // Settling the fetch flips loading back off.
    await act(async () => {
      resolveOutcome({ kind: "ok", files: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.current!.remoteLoading).toBe(false);
  });

  it("does not fire the remote search until the debounce elapses", async () => {
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => ({ kind: "ok", files: [] }),
    );
    const h = mount({ files: [], onSearchFiles });
    act(() => h.current!.setSearchQuery("abc"));
    // Just short of the 250ms debounce: no call yet.
    await flush(249);
    expect(onSearchFiles).not.toHaveBeenCalled();
    // Crossing the threshold fires exactly one call.
    await flush(1);
    expect(onSearchFiles).toHaveBeenCalledTimes(1);
  });

  it("emits a success telemetry event with the result count", async () => {
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => ({
        kind: "ok",
        files: [file("r/one.md"), file("r/two.md")],
      }),
    );
    const h = mount({ files: [], onSearchFiles });
    act(() => h.current!.setSearchQuery("abcd"));
    await flush(300);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search.performed",
        properties: expect.objectContaining({ succeeded: true }),
        measurements: { queryLength: 4, resultCount: 2 },
      }),
    );
  });

  it("emits a failure telemetry event carrying the failure reason", async () => {
    const onSearchFiles = vi.fn(
      async (): Promise<FileSearchOutcome> => ({
        kind: "unavailable",
        reason: "extension-missing",
      }),
    );
    const h = mount({ files: [], onSearchFiles });
    act(() => h.current!.setSearchQuery("abcd"));
    await flush(300);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search.performed",
        properties: expect.objectContaining({
          succeeded: false,
          failureReason: "extension-missing",
        }),
        measurements: expect.objectContaining({ resultCount: 0 }),
      }),
    );
  });
});
