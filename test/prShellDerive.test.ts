// Unit tests for PrShell's pure view-model derivations (`src/shell/prShell/derive.ts`).

import { describe, expect, it, vi } from "vitest";

import type { FileInfo, TextQuoteAnchor } from "../src/types";
import {
  NEW_DRAFT_THREAD_ID,
  type DraftTarget,
} from "../src/shell/draftStorage";
import type { HistoryStop } from "../src/shell/prShellHelpers";
import { DEFAULT_READER_PREFS } from "../src/shell/readerPrefs";
import {
  activeArticleState,
  activeSources,
  appClassName,
  buildHistoryNav,
  commentAccess,
  diffInputs,
  docNavRangeChangesFor,
  documentReadOnly,
  draftTargetsOnScreen,
  feedbackHrefFor,
  historicalContentKeys,
  historicalStatus,
  historyModes,
  isDiffAvailable,
  isSameDraftTarget,
  paneLayout,
  pickInitialPath,
  railChrome,
  readerStyleFor,
  resolveHistoryView,
  statusBarExtras,
} from "../src/shell/prShell/derive";

const current: HistoryStop = {
  commitId: null,
  prId: 7,
  isCurrent: true,
  readOnly: false,
};
const past = (prId: number, commitId: string | null): HistoryStop => ({
  commitId,
  prId,
  title: `PR ${prId}`,
  url: `https://example.test/pr/${prId}`,
  isCurrent: false,
  readOnly: true,
});
const anchor = (exact: string): TextQuoteAnchor =>
  ({ exact, prefix: "", suffix: "" }) as TextQuoteAnchor;
const file = (path: string): FileInfo => ({ path }) as FileInfo;
const range = (start: number) => [
  { kind: "modified" as const, startLine: start, endLine: start },
];

describe("pickInitialPath", () => {
  it("prefers the seeded path, then the first file, then empty", () => {
    expect(pickInitialPath("b.md", [file("a.md")])).toBe("b.md");
    expect(pickInitialPath(undefined, [file("a.md")])).toBe("a.md");
    expect(pickInitialPath(undefined, [])).toBe("");
  });
});

describe("documentReadOnly", () => {
  it("passes the host's read-only state through", () => {
    expect(documentReadOnly(true, "host", true)).toEqual({
      effectiveReadOnly: true,
      effectiveReadOnlyMessage: "host",
    });
    expect(documentReadOnly(undefined, "host", false)).toEqual({
      effectiveReadOnly: false,
      effectiveReadOnlyMessage: "host",
    });
  });
  it("makes a document without a write target read-only", () => {
    const r = documentReadOnly(false, "host", true);
    expect(r.effectiveReadOnly).toBe(true);
    expect(r.effectiveReadOnlyMessage).toMatch(/isn't part of a completed/);
  });
});

describe("draftTargetsOnScreen", () => {
  const a = anchor("x");
  it("shows a new-comment draft's anchor on its own file only", () => {
    const d: DraftTarget = {
      path: "a.md",
      threadId: NEW_DRAFT_THREAD_ID,
      anchor: a,
    };
    expect(draftTargetsOnScreen(d, "a.md")).toEqual({
      draftAnchor: a,
      activeReplyThreadId: null,
    });
    expect(draftTargetsOnScreen(d, "b.md")).toEqual({
      draftAnchor: null,
      activeReplyThreadId: null,
    });
  });
  it("shows a reply draft's thread on its own file only", () => {
    const d: DraftTarget = { path: "a.md", threadId: "t1", anchor: null };
    expect(draftTargetsOnScreen(d, "a.md")).toEqual({
      draftAnchor: null,
      activeReplyThreadId: "t1",
    });
    expect(draftTargetsOnScreen(null, "a.md")).toEqual({
      draftAnchor: null,
      activeReplyThreadId: null,
    });
  });
});

describe("isSameDraftTarget", () => {
  const target: DraftTarget = { path: "a.md", threadId: "t1", anchor: null };
  it("matches the same reply composer", () => {
    expect(isSameDraftTarget(null, target)).toBe(false);
    expect(isSameDraftTarget({ ...target }, target)).toBe(true);
    expect(isSameDraftTarget({ ...target, path: "b.md" }, target)).toBe(false);
    expect(isSameDraftTarget({ ...target, threadId: "t2" }, target)).toBe(
      false,
    );
  });
  it("compares new-comment anchors by value", () => {
    const d = (exact: string): DraftTarget => ({
      path: "a.md",
      threadId: NEW_DRAFT_THREAD_ID,
      anchor: anchor(exact),
    });
    expect(isSameDraftTarget(d("x"), d("x"))).toBe(true);
    expect(isSameDraftTarget(d("x"), d("y"))).toBe(false);
  });
});

describe("historyModes", () => {
  const load = () => Promise.resolve();
  it("enables completed-PR history only with all three loaders", () => {
    expect(
      historyModes({
        loadDocHistory: load,
        loadThreadsForPr: load,
        loadFileSourceAt: load,
        reviewIterationStops: undefined,
        reviewIterationBaseCommit: undefined,
      }),
    ).toEqual({
      completedPrHistoryEnabled: true,
      nativeIterationMode: false,
      nativeUpdateCount: 1,
    });
  });
  it("enables native updates with stops, a base and a source loader", () => {
    const stops = [current, past(1, "c1")];
    expect(
      historyModes({
        loadDocHistory: undefined,
        loadThreadsForPr: undefined,
        loadFileSourceAt: load,
        reviewIterationStops: stops,
        reviewIterationBaseCommit: "base",
      }),
    ).toEqual({
      completedPrHistoryEnabled: false,
      nativeIterationMode: true,
      nativeUpdateCount: 2,
    });
    expect(
      historyModes({
        loadDocHistory: undefined,
        loadThreadsForPr: undefined,
        loadFileSourceAt: load,
        reviewIterationStops: [],
        reviewIterationBaseCommit: "base",
      }).nativeIterationMode,
    ).toBe(false);
  });
});

describe("resolveHistoryView", () => {
  const completed = [current, past(5, "c5"), past(4, "c4")];
  it("clamps the completed-PR stop index", () => {
    const v = resolveHistoryView({
      nativeIterationMode: false,
      reviewIterationStops: undefined,
      completedPrHistoryStops: completed,
      iterationRange: { fromUpdate: 0, toUpdate: 1 },
      completedHistoryStopIndex: 9,
    });
    expect(v.clampedStopIndex).toBe(2);
    expect(v.activeStop).toBe(completed[2]);
    expect(v.baselineStop).toBe(completed[2]);
    expect(v.viewingHistorical).toBe(true);
    expect(v.comparingIterations).toBe(false);
    expect(v.reportedRangeKey).toBeNull();
    expect(v.rangeChangesKey).toBeNull();
  });
  it("maps a native comparison onto its stops", () => {
    // Newest first: Update 3 (latest), Update 2, Update 1.
    const stops = [current, past(1, "u2"), past(1, "u1")];
    const all = resolveHistoryView({
      nativeIterationMode: true,
      reviewIterationStops: stops,
      completedPrHistoryStops: completed,
      iterationRange: { fromUpdate: 0, toUpdate: 3 },
      completedHistoryStopIndex: 0,
    });
    expect(all.historyStops).toBe(stops);
    expect(all.reportedRangeKey).toBe("all");
    expect(all.rangeChangesKey).toBeNull();
    expect(all.baselineStop).toBeUndefined();
    const partial = resolveHistoryView({
      nativeIterationMode: true,
      reviewIterationStops: stops,
      completedPrHistoryStops: completed,
      iterationRange: { fromUpdate: 1, toUpdate: 2 },
      completedHistoryStopIndex: 0,
    });
    expect(partial.activeStop).toBe(stops[1]);
    expect(partial.baselineStop).toBe(stops[2]);
    expect(partial.comparingIterations).toBe(true);
    expect(partial.reportedRangeKey).toBe("1-2");
    expect(partial.rangeChangesKey).toBe("1-2");
  });
});

describe("docNavRangeChangesFor", () => {
  const byKey = { "1-2": { "a.md": "modified" as const } };
  it("returns the loaded marks for the compared updates", () => {
    expect(
      docNavRangeChangesFor("1-2", byKey, { fromUpdate: 1, toUpdate: 2 }, 3),
    ).toEqual({ label: "Update 1 → 2", byPath: byKey["1-2"] });
  });
  it("returns nothing until loaded or outside a comparison", () => {
    const r = { fromUpdate: 1, toUpdate: 2 };
    expect(docNavRangeChangesFor(null, byKey, r, 3)).toBeUndefined();
    expect(docNavRangeChangesFor("0-1", byKey, r, 3)).toBeUndefined();
  });
});

describe("historicalContentKeys", () => {
  it("keys the active and baseline snapshots", () => {
    expect(
      historicalContentKeys({
        selectedPath: "a.md",
        viewingHistorical: true,
        activeStop: past(1, "c1"),
        baselineStop: past(1, "c0"),
        reviewIterationBaseCommit: "base",
        comparingIterations: true,
      }),
    ).toEqual({
      historicalContentKey: "a.md\u0000c1",
      baselineCommitId: "c0",
      baselineContentKey: "a.md\u0000c0",
    });
  });
  it("falls back to the merge base and skips the live head", () => {
    expect(
      historicalContentKeys({
        selectedPath: "a.md",
        viewingHistorical: false,
        activeStop: current,
        baselineStop: undefined,
        reviewIterationBaseCommit: "base",
        comparingIterations: false,
      }),
    ).toEqual({
      historicalContentKey: null,
      baselineCommitId: "base",
      baselineContentKey: null,
    });
  });
});

describe("historicalStatus", () => {
  const base = {
    viewingHistorical: true,
    comparingIterations: true,
    historicalContentKey: "k1" as string | null,
    baselineContentKey: "k0" as string | null,
    historicalLoadTargets: [{ key: "k1" }, { key: "k0" }],
    currentFileChangeType: undefined,
    toUpdate: 2,
    historicalHtmlByKey: {} as Record<string, string>,
    historicalSourceByKey: {} as Record<string, string>,
    historicalErrorByKey: {} as Record<string, string>,
    historicalAbsentByKey: {} as Record<string, true>,
  };
  it("loads until both endpoints arrive", () => {
    expect(historicalStatus(base)).toMatchObject({
      usingHistoricalContent: true,
      historicalLoading: true,
      absentNotice: null,
    });
    expect(
      historicalStatus({
        ...base,
        historicalHtmlByKey: { k1: "<p>1</p>" },
        historicalSourceByKey: { k0: "0" },
      }),
    ).toMatchObject({ historicalHtml: "<p>1</p>", historicalLoading: false });
  });
  it("reports the first load error", () => {
    expect(
      historicalStatus({ ...base, historicalErrorByKey: { k0: "boom" } }),
    ).toMatchObject({ historicalLoadError: "boom", historicalLoading: false });
  });
  it("explains a file absent at the newer endpoint", () => {
    const s = historicalStatus({
      ...base,
      historicalAbsentByKey: { k1: true },
    });
    expect(s.absentNotice?.title).toBe("Not present at Update 2");
    expect(s.historicalLoading).toBe(false);
  });
  it("treats a deleted file as absent at the latest update", () => {
    const s = historicalStatus({
      ...base,
      viewingHistorical: false,
      historicalContentKey: null,
      currentFileChangeType: "deleted",
    });
    expect(s.absentNotice?.title).toBe("Deleted by Update 2");
    expect(s.usingHistoricalContent).toBe(false);
  });
  it("renders a file absent only at the baseline as added", () => {
    const s = historicalStatus({
      ...base,
      historicalHtmlByKey: { k1: "<p>1</p>" },
      historicalAbsentByKey: { k0: true },
    });
    expect(s.baselineAbsent).toBe(true);
    expect(s.historicalLoading).toBe(false);
  });
  it("is idle with no historical endpoints", () => {
    expect(
      historicalStatus({
        ...base,
        viewingHistorical: false,
        comparingIterations: false,
        historicalContentKey: null,
        baselineContentKey: null,
        historicalLoadTargets: [],
      }),
    ).toEqual({
      historicalHtml: undefined,
      usingHistoricalContent: false,
      historicalLoadError: undefined,
      absentNotice: null,
      baselineAbsent: false,
      historicalLoading: false,
    });
  });
});

describe("activeArticleState", () => {
  const status = {
    historicalHtml: undefined as string | undefined,
    usingHistoricalContent: false,
    historicalLoadError: undefined,
    absentNotice: null as { title: string; body: string } | null,
    baselineAbsent: false,
    historicalLoading: false,
  };
  it("shows the live document", () => {
    expect(
      activeArticleState({
        status,
        pristineHtml: "<p>live</p>",
        viewingHistorical: false,
        historicalContentKey: null,
        selectedPath: "a.md",
      }),
    ).toEqual({
      activePristineHtml: "<p>live</p>",
      activeStorageKey: "a.md",
      articleReady: true,
    });
  });
  it("shows a historical snapshot once loaded", () => {
    const args = {
      pristineHtml: "<p>live</p>",
      viewingHistorical: true,
      historicalContentKey: "k1",
      selectedPath: "a.md",
    };
    expect(
      activeArticleState({
        ...args,
        status: { ...status, usingHistoricalContent: true },
      }),
    ).toEqual({
      activePristineHtml: "",
      activeStorageKey: "k1",
      articleReady: false,
    });
    expect(
      activeArticleState({
        ...args,
        status: {
          ...status,
          usingHistoricalContent: true,
          historicalHtml: "<p>old</p>",
          absentNotice: { title: "t", body: "b" },
        },
      }).articleReady,
    ).toBe(false);
  });
});

describe("activeSources", () => {
  const base = {
    usingHistoricalContent: false,
    comparingIterations: false,
    baselineAbsent: false,
    historicalContentKey: "k1",
    baselineContentKey: "k0",
    historicalSourceByKey: { k1: "one", k0: "zero" },
    latestSource: "latest",
  };
  it("uses the live source outside a comparison", () => {
    expect(activeSources(base)).toEqual({
      activeSource: "latest",
      baselineSource: undefined,
    });
  });
  it("uses both endpoints while comparing", () => {
    expect(
      activeSources({
        ...base,
        usingHistoricalContent: true,
        comparingIterations: true,
      }),
    ).toEqual({ activeSource: "one", baselineSource: "zero" });
    expect(
      activeSources({
        ...base,
        comparingIterations: true,
        baselineAbsent: true,
      }).baselineSource,
    ).toBe("");
  });
});

describe("diffInputs / isDiffAvailable", () => {
  const iterationDiff = range(1);
  const currentFileDiff = range(2);
  const base = {
    baselineSource: "zero",
    activeSource: "one",
    latestSource: "latest",
    currentOriginalSource: "orig",
    iterationDiff,
    currentFileDiff,
  };
  it("diffs the compared updates", () => {
    expect(diffInputs({ ...base, comparingIterations: true })).toEqual({
      activeOriginalSource: "zero",
      activeDiffTarget: "one",
      rawActiveDiff: iterationDiff,
    });
  });
  it("diffs the PR against its base", () => {
    expect(diffInputs({ ...base, comparingIterations: false })).toEqual({
      activeOriginalSource: "orig",
      activeDiffTarget: "latest",
      rawActiveDiff: currentFileDiff,
    });
  });
  const avail = {
    comparingIterations: false,
    baselineAbsent: false,
    iterationDiff: undefined,
    viewingHistorical: false,
    isWholeFileChange: false,
    currentFileDiff: undefined,
  };
  it("offers changes only for a non-empty displayable diff", () => {
    expect(isDiffAvailable({ ...avail, currentFileDiff })).toBe(true);
    expect(isDiffAvailable({ ...avail, currentFileDiff: [] })).toBe(false);
    expect(isDiffAvailable(avail)).toBe(false);
    expect(
      isDiffAvailable({ ...avail, currentFileDiff, isWholeFileChange: true }),
    ).toBe(false);
    expect(
      isDiffAvailable({ ...avail, currentFileDiff, viewingHistorical: true }),
    ).toBe(false);
    const cmp = { ...avail, comparingIterations: true };
    expect(isDiffAvailable({ ...cmp, iterationDiff })).toBe(true);
    expect(isDiffAvailable({ ...cmp, iterationDiff: [] })).toBe(false);
    expect(isDiffAvailable(cmp)).toBe(false);
    expect(
      isDiffAvailable({ ...cmp, iterationDiff, baselineAbsent: true }),
    ).toBe(false);
  });
});

describe("commentAccess", () => {
  const routed = { prId: 7, title: "Routed", status: "active" as const };
  const base = {
    viewingHistorical: false,
    nativeIterationMode: false,
    activeStop: current,
    effectiveRoutedPr: routed,
    routedPrResolution: routed,
    documentsMode: false,
    currentFileChangeType: undefined,
    effectiveReadOnly: false,
    effectiveReadOnlyMessage: "msg",
  };
  it("keeps the live head writable", () => {
    expect(commentAccess(base)).toEqual({
      viewingPastPr: false,
      activeRoutedPr: routed,
      commentsAvailable: true,
      activeReadOnly: false,
      activeReadOnlyMessage: "msg",
    });
  });
  it("shows a past PR read-only with its own pill", () => {
    const r = commentAccess({
      ...base,
      viewingHistorical: true,
      activeStop: past(4, "c4"),
    });
    expect(r.viewingPastPr).toBe(true);
    expect(r.activeRoutedPr).toEqual({
      prId: 4,
      title: "PR 4",
      status: "completed",
      url: "https://example.test/pr/4",
    });
    expect(r.activeReadOnly).toBe(true);
    expect(r.activeReadOnlyMessage).toMatch(/pull request #4/);
  });
  it("keeps earlier PR updates writable", () => {
    const r = commentAccess({
      ...base,
      viewingHistorical: true,
      nativeIterationMode: true,
      activeStop: past(7, "u1"),
    });
    expect(r.viewingPastPr).toBe(false);
    expect(r.activeReadOnly).toBe(false);
  });
  it("makes a deleted file read-only", () => {
    const r = commentAccess({ ...base, currentFileChangeType: "deleted" });
    expect(r.activeReadOnly).toBe(true);
    expect(r.activeReadOnlyMessage).toMatch(/was deleted/);
  });
  it("gates documents-mode comments on a completed routing PR", () => {
    const r = commentAccess({ ...base, documentsMode: true });
    expect(r.commentsAvailable).toBe(false);
    expect(r.activeReadOnly).toBe(true);
    expect(r.activeReadOnlyMessage).toMatch(/unavailable until/);
    expect(
      commentAccess({
        ...base,
        documentsMode: true,
        routedPrResolution: undefined,
      }).commentsAvailable,
    ).toBe(true);
    const done = { ...routed, status: "completed" as const };
    expect(
      commentAccess({ ...base, documentsMode: true, effectiveRoutedPr: done })
        .commentsAvailable,
    ).toBe(true);
  });
});

describe("buildHistoryNav", () => {
  const stops = [current, past(5, "c5"), past(4, "c4")];
  it("is absent without a history to step through", () => {
    expect(buildHistoryNav(false, stops, 0, vi.fn())).toBeUndefined();
    expect(buildHistoryNav(true, [current], 0, vi.fn())).toBeUndefined();
  });
  it("steps between neighbouring stops", () => {
    const onStep = vi.fn();
    const nav = buildHistoryNav(true, stops, 1, onStep)!;
    expect(nav.canNewer).toBe(true);
    expect(nav.canOlder).toBe(true);
    expect(nav.olderLabel).toMatch(/PR 4|#4/);
    nav.onNewer();
    nav.onOlder();
    expect(onStep.mock.calls).toEqual([[0], [2]]);
    const atEnd = buildHistoryNav(true, stops, 2, onStep)!;
    expect(atEnd.canOlder).toBe(false);
    expect(buildHistoryNav(true, stops, 0, onStep)!.canNewer).toBe(false);
  });
});

describe("reader chrome", () => {
  it("exposes the reading style as CSS custom properties", () => {
    const { readerFont, readerStyle } = readerStyleFor(DEFAULT_READER_PREFS);
    expect(readerStyle).toMatchObject({
      "--emr-reader-font": readerFont.stack,
    });
  });
  it("builds the feedback mailto only with an address", () => {
    expect(feedbackHrefFor(undefined)).toBeUndefined();
    expect(feedbackHrefFor("a@b.test")).toMatch(/^mailto:a@b\.test\?subject=/);
  });
  it("composes the app class name", () => {
    expect(
      appClassName({
        navHidden: false,
        commentsHidden: false,
        documentsMode: undefined,
        tooNarrow: false,
      }),
    ).toBe("emr-app");
    expect(
      appClassName({
        navHidden: true,
        commentsHidden: true,
        documentsMode: true,
        tooNarrow: true,
      }),
    ).toBe(
      "emr-app is-nav-hidden is-comments-hidden is-documents-mode is-too-narrow",
    );
  });
  it("drops the banner and pill for earlier PR updates", () => {
    expect(
      railChrome({
        nativeIterationMode: true,
        viewingHistorical: true,
        hidePrPill: false,
        documentsMode: undefined,
      }),
    ).toEqual({ showReadOnlyBanner: false, hidePrPill: true });
    expect(
      railChrome({
        nativeIterationMode: false,
        viewingHistorical: true,
        hidePrPill: false,
        documentsMode: undefined,
      }),
    ).toEqual({ showReadOnlyBanner: true, hidePrPill: false });
    expect(
      railChrome({
        nativeIterationMode: false,
        viewingHistorical: false,
        hidePrPill: false,
        documentsMode: true,
      }).hidePrPill,
    ).toBe(true);
  });
  it("lays out the panes", () => {
    const prefs = {
      ...DEFAULT_READER_PREFS,
      showNav: true,
      showComments: true,
    };
    expect(paneLayout(undefined, prefs, true)).toEqual({
      navToggleable: true,
      navHidden: false,
      commentsHidden: false,
      bodyFrameClassName: "emr-body-frame",
      railResizable: true,
      navReopenShown: false,
      commentsReopenShown: false,
    });
    expect(
      paneLayout(
        undefined,
        { ...prefs, showNav: false, showComments: false },
        true,
      ),
    ).toMatchObject({ navReopenShown: true, commentsReopenShown: true });
    expect(paneLayout(true, prefs, false)).toEqual({
      navToggleable: false,
      navHidden: true,
      commentsHidden: true,
      bodyFrameClassName: "emr-body-frame emr-body-frame--no-nav",
      railResizable: false,
      navReopenShown: false,
      commentsReopenShown: false,
    });
  });
  it("derives the status bar's mode-dependent controls", () => {
    const options = [
      { stopIndex: 1, number: 1, title: "Update 1" },
      { stopIndex: 0, number: 2, title: "Update 2" },
    ];
    const handleRefresh = vi.fn();
    const done = { prId: 1, title: "t", status: "completed" as const };
    expect(
      statusBarExtras({
        documentsMode: true,
        activeRoutedPr: done,
        nativeIterationMode: true,
        iterationOptions: options,
        reviewIterationBaseCommit: "base",
        canRefreshComments: true,
        handleRefresh,
        commentsRefreshing: false,
        fileRefreshInFlight: true,
      }),
    ).toEqual({
      resolvedPullRequest: done,
      iterationOptions: options,
      iterationBaseCommit: "base",
      onRefresh: handleRefresh,
      refreshing: true,
    });
    expect(
      statusBarExtras({
        documentsMode: false,
        activeRoutedPr: done,
        nativeIterationMode: false,
        iterationOptions: options,
        reviewIterationBaseCommit: "base",
        canRefreshComments: false,
        handleRefresh,
        commentsRefreshing: false,
        fileRefreshInFlight: false,
      }),
    ).toEqual({
      resolvedPullRequest: undefined,
      iterationOptions: undefined,
      iterationBaseCommit: undefined,
      onRefresh: undefined,
      refreshing: false,
    });
  });
});
