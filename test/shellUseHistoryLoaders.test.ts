// React-hook tests for useHistoryLoaders: loads that settle after the
// selection moved on (or the shell unmounted) must not land in the caches.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "../src/types";
import type { DocPrRef, HistoryStop } from "../src/shell/shellHelpers";
import { useHistoryLoaders } from "../src/shell/shell/useHistoryLoaders";
import {
  deferred,
  HELD_SOURCE,
  heldRender,
  mountHook,
  settle,
  type MountedHook,
} from "./shellHarness";

vi.mock("../src/markdown/render", async (importOriginal) =>
  (await import("./shellHarness")).withHeldRender(
    await importOriginal<typeof import("../src/markdown/render")>(),
  ),
);

type Options = Parameters<typeof useHistoryLoaders>[0];
type Loaders = ReturnType<typeof useHistoryLoaders>;

const current: HistoryStop = {
  commitId: null,
  prId: null,
  isCurrent: true,
  readOnly: false,
};
const pastStop: HistoryStop = {
  commitId: "c1",
  prId: 7,
  title: "PR 7",
  isCurrent: false,
  readOnly: true,
};
const never = <T>(): Promise<T> => new Promise<T>(() => {});

function options(overrides: Partial<Options>): Options {
  return {
    selectedPath: "docs/a.md",
    completedPrHistoryEnabled: true,
    nativeIterationMode: false,
    nativeUpdateCount: 1,
    viewingHistorical: false,
    comparingIterations: false,
    activeStop: current,
    baselineStop: undefined,
    reviewIterationBaseCommit: undefined,
    loadDocHistory: () => never<DocPrRef[]>(),
    loadThreadsForPr: () => never<CommentThread[]>(),
    loadFileSourceAt: () => never<string>(),
    setHistoryByPath: vi.fn(),
    setCompletedHistoryStopIndex: vi.fn(),
    setIterationRange: vi.fn(),
    ...overrides,
  };
}

let mounted: MountedHook<Options, Loaders> | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  heldRender.gate = null;
});

/** Mounts on a historical stop of `docs/a.md`, then moves to `docs/b.md`. */
async function loadThenSwitch(overrides: Partial<Options>): Promise<void> {
  const base = options({
    viewingHistorical: true,
    activeStop: pastStop,
    ...overrides,
  });
  mounted = await mountHook(useHistoryLoaders, base);
  await settle();
  await mounted.rerender({ ...base, selectedPath: "docs/b.md" });
}

describe("useHistoryLoaders", () => {
  it("drops a document history that resolves after unmount", async () => {
    const history = deferred<DocPrRef[]>();
    const setHistoryByPath = vi.fn();
    mounted = await mountHook(
      useHistoryLoaders,
      options({ loadDocHistory: () => history.promise, setHistoryByPath }),
    );
    mounted.unmount();
    mounted = undefined;
    history.resolve([]);
    await settle();
    expect(setHistoryByPath).not.toHaveBeenCalled();
  });

  it("drops historical content fetched after the selection moved on", async () => {
    const source = deferred<string>();
    await loadThenSwitch({
      loadFileSourceAt: (path) =>
        path === "docs/a.md" ? source.promise : never<string>(),
    });
    source.resolve("# Old");
    await settle();
    expect(mounted!.current.historicalSourceByKey).toEqual({});
    expect(mounted!.current.historicalHtmlByKey).toEqual({});
  });

  it("drops historical content rendered after the selection moved on", async () => {
    heldRender.gate = deferred<void>();
    await loadThenSwitch({
      loadFileSourceAt: (path) =>
        path === "docs/a.md" ? Promise.resolve(HELD_SOURCE) : never<string>(),
    });
    heldRender.gate.resolve();
    await settle();
    expect(mounted!.current.historicalHtmlByKey).toEqual({});
  });

  it("ignores a historical load failing after the selection moved on", async () => {
    const source = deferred<string>();
    await loadThenSwitch({
      loadFileSourceAt: (path) =>
        path === "docs/a.md" ? source.promise : never<string>(),
    });
    source.reject(new Error("gone"));
    await settle();
    expect(mounted!.current.historicalErrorByKey).toEqual({});
  });

  it("drops a past PR's threads resolving after the selection moved on", async () => {
    const threads = deferred<CommentThread[]>();
    await loadThenSwitch({
      loadThreadsForPr: (_prId, path) =>
        path === "docs/a.md" ? threads.promise : never<CommentThread[]>(),
    });
    threads.resolve([]);
    await settle();
    expect(mounted!.current.historicalThreadsByKey).toEqual({});
  });
});
