// Unit tests for Shell's pure view-model derivations
// (`src/shell/shell/derive.ts` and `src/shell/shell/deriveChrome.ts`).

import { describe, expect, it, vi } from "vitest";

import type { FileInfo, TextQuoteAnchor } from "../src/types";
import { NEW_DRAFT_THREAD_ID, type DraftTarget } from "../src/shell/draftStorage";
import type { HistoryStop } from "../src/shell/shellHelpers";
import { DEFAULT_READER_PREFS } from "../src/shell/readerPrefs";
import {
    activeArticleState,
    activeSources,
    buildHistoryNav,
    commentAccess,
    diffInputs,
    docNavRangeChangesFor,
    documentReadOnly,
    draftTargetsOnScreen,
    historicalContentKeys,
    historicalStatus,
    historyModes,
    isDiffAvailable,
    isSameDraftTarget,
    pickInitialPath,
    resolveHistoryView,
} from "../src/shell/shell/derive";
import {
    appClassName,
    feedbackHrefFor,
    paneLayout,
    railChrome,
    readerStyleFor,
    statusBarExtras,
} from "../src/shell/shell/deriveChrome";

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

const range = (start: number) => [{ kind: "modified" as const, startLine: start, endLine: start }];

describe("pickInitialPath", () => {
    it.each([
        { name: "the seeded path", seeded: "b.md", files: [file("a.md")], path: "b.md" },
        {
            name: "the first file without a seeded path",
            seeded: undefined,
            files: [file("a.md")],
            path: "a.md",
        },
        { name: "nothing without files", seeded: undefined, files: [], path: "" },
    ])("opens $name", ({ seeded, files, path }) => {
        expect(pickInitialPath(seeded, files)).toBe(path);
    });
});

describe("documentReadOnly", () => {
    it.each([
        { hostReadOnly: true, writable: true, readOnly: true },
        { hostReadOnly: undefined, writable: false, readOnly: false },
    ])(
        "passes the host's read-only state ($hostReadOnly) through",
        ({ hostReadOnly, writable, readOnly }) => {
            expect(documentReadOnly(hostReadOnly, "host", writable)).toEqual({
                effectiveReadOnly: readOnly,
                effectiveReadOnlyMessage: "host",
            });
        },
    );

    it("makes a document without a write target read-only", () => {
        const r = documentReadOnly(false, "host", true);
        expect(r.effectiveReadOnly).toBe(true);
        expect(r.effectiveReadOnlyMessage).toMatch(/isn't part of a completed/);
    });
});

describe("draftTargetsOnScreen", () => {
    const a = anchor("x");
    const newComment: DraftTarget = { path: "a.md", threadId: NEW_DRAFT_THREAD_ID, anchor: a };
    const reply: DraftTarget = { path: "a.md", threadId: "t1", anchor: null };

    it.each([
        {
            name: "a new-comment draft's anchor on its own file",
            draft: newComment,
            path: "a.md",
            onScreen: { draftAnchor: a, activeReplyThreadId: null },
        },
        {
            name: "a reply draft's thread on its own file",
            draft: reply,
            path: "a.md",
            onScreen: { draftAnchor: null, activeReplyThreadId: "t1" },
        },
        {
            name: "nothing of a draft on another file",
            draft: newComment,
            path: "b.md",
            onScreen: { draftAnchor: null, activeReplyThreadId: null },
        },
        {
            name: "nothing without a draft",
            draft: null,
            path: "a.md",
            onScreen: { draftAnchor: null, activeReplyThreadId: null },
        },
    ])("shows $name", ({ draft, path, onScreen }) => {
        expect(draftTargetsOnScreen(draft, path)).toEqual(onScreen);
    });
});

describe("isSameDraftTarget", () => {
    const target: DraftTarget = { path: "a.md", threadId: "t1", anchor: null };

    const newComment = (exact: string): DraftTarget => ({
        path: "a.md",
        threadId: NEW_DRAFT_THREAD_ID,
        anchor: anchor(exact),
    });

    it.each([
        { name: "the same reply composer", open: { ...target }, requested: target, same: true },
        { name: "no open draft", open: null, requested: target, same: false },
        {
            name: "a reply on another file",
            open: { ...target, path: "b.md" },
            requested: target,
            same: false,
        },
        {
            name: "a reply to another thread",
            open: { ...target, threadId: "t2" },
            requested: target,
            same: false,
        },
        {
            name: "a new comment on equal text",
            open: newComment("x"),
            requested: newComment("x"),
            same: true,
        },
        {
            name: "a new comment on other text",
            open: newComment("x"),
            requested: newComment("y"),
            same: false,
        },
    ])("matches $name: $same", ({ open, requested, same }) => {
        expect(isSameDraftTarget(open, requested)).toBe(same);
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
        expect(
            historyModes({
                loadDocHistory: undefined,
                loadThreadsForPr: undefined,
                loadFileSourceAt: load,
                reviewIterationStops: [current, past(1, "c1")],
                reviewIterationBaseCommit: "base",
            }),
        ).toEqual({
            completedPrHistoryEnabled: false,
            nativeIterationMode: true,
            nativeUpdateCount: 2,
        });
    });

    it.each(["loadDocHistory", "loadThreadsForPr", "loadFileSourceAt"] as const)(
        "keeps completed-PR history off when the host has no %s",
        (missing) => {
            expect(
                historyModes({
                    loadDocHistory: load,
                    loadThreadsForPr: load,
                    loadFileSourceAt: load,
                    [missing]: undefined,
                    reviewIterationStops: undefined,
                    reviewIterationBaseCommit: undefined,
                }).completedPrHistoryEnabled,
            ).toBe(false);
        },
    );

    it.each([
        { name: "a base commit", base: "", loadFileSourceAt: load },
        { name: "a way to load past versions", base: "base", loadFileSourceAt: undefined },
    ])("leaves native updates off for a PR without $name", ({ base, loadFileSourceAt }) => {
        expect(
            historyModes({
                loadDocHistory: undefined,
                loadThreadsForPr: undefined,
                loadFileSourceAt,
                reviewIterationStops: [current, past(1, "c1")],
                reviewIterationBaseCommit: base,
            }).nativeIterationMode,
        ).toBe(false);
    });

    it("leaves native updates off for a PR without update stops", () => {
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
    // Newest first: Update 3 (latest), Update 2, Update 1.
    const stops = [current, past(1, "u2"), past(1, "u1")];

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

    it("shows All updates of a PR against its base, with no range changes to load", () => {
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
    });

    it("compares a partial range of updates between its two stops", () => {
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
    const compared = { fromUpdate: 1, toUpdate: 2 };

    it("returns the loaded marks for the compared updates", () => {
        expect(docNavRangeChangesFor("1-2", byKey, compared, 3)).toEqual({
            label: "Update 1 → 2",
            byPath: byKey["1-2"],
        });
    });

    it.each([
        { name: "outside a comparison", key: null },
        { name: "until the compared range's marks load", key: "0-1" },
    ])("marks nothing $name", ({ key }) => {
        expect(docNavRangeChangesFor(key, byKey, compared, 3)).toBeUndefined();
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

    it("has no snapshot to load for a past PR without a merge commit", () => {
        expect(
            historicalContentKeys({
                selectedPath: "a.md",
                viewingHistorical: true,
                activeStop: past(1, null),
                baselineStop: undefined,
                reviewIterationBaseCommit: undefined,
                comparingIterations: false,
            }).historicalContentKey,
        ).toBeNull();
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

    it("is loading while the compared endpoints haven't arrived", () => {
        expect(historicalStatus(base)).toMatchObject({
            usingHistoricalContent: true,
            historicalLoading: true,
            absentNotice: null,
        });
    });

    it("shows the newer endpoint once both endpoints arrive", () => {
        expect(
            historicalStatus({
                ...base,
                historicalHtmlByKey: { k1: "<p>1</p>" },
                historicalSourceByKey: { k0: "0" },
            }),
        ).toMatchObject({
            historicalHtml: "<p>1</p>",
            historicalLoading: false,
            baselineAbsent: false,
            absentNotice: null,
        });
    });

    it("is loading while the older compared update hasn't arrived", () => {
        expect(
            historicalStatus({ ...base, historicalHtmlByKey: { k1: "<p>1</p>" } }),
        ).toMatchObject({ historicalLoading: true });
    });

    const pastStop = {
        ...base,
        comparingIterations: false,
        baselineContentKey: null,
        historicalLoadTargets: [{ key: "k1" }],
    };

    it("is loading while a past version hasn't arrived", () => {
        expect(historicalStatus(pastStop)).toMatchObject({
            usingHistoricalContent: true,
            historicalLoading: true,
        });
    });

    it("shows the live content for a past PR without a merge commit", () => {
        expect(
            historicalStatus({
                ...pastStop,
                historicalContentKey: null,
                historicalLoadTargets: [],
            }),
        ).toMatchObject({ usingHistoricalContent: false, historicalLoading: false });
    });

    it.each([
        {
            name: "a deleted file's live version outside a comparison",
            overrides: {
                comparingIterations: false,
                historicalContentKey: null,
                currentFileChangeType: "deleted" as const,
            },
        },
        {
            name: "an earlier update of a file the PR later deletes",
            overrides: {
                historicalHtmlByKey: { k1: "<p>1</p>" },
                currentFileChangeType: "deleted" as const,
            },
        },
        {
            name: "the latest update of an edited file",
            overrides: {
                viewingHistorical: false,
                historicalContentKey: null,
                currentFileChangeType: "modified" as const,
            },
        },
    ])("shows $name without an absent notice", ({ overrides }) => {
        expect(historicalStatus({ ...base, ...overrides }).absentNotice).toBeNull();
    });

    it("reports the first load error", () => {
        expect(historicalStatus({ ...base, historicalErrorByKey: { k0: "boom" } })).toMatchObject({
            historicalLoadError: "boom",
            historicalLoading: false,
        });
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

    const historical = {
        pristineHtml: "<p>live</p>",
        viewingHistorical: true,
        historicalContentKey: "k1",
        selectedPath: "a.md",
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

    it("holds the article back until a historical snapshot loads", () => {
        expect(
            activeArticleState({
                ...historical,
                status: { ...status, usingHistoricalContent: true },
            }),
        ).toEqual({
            activePristineHtml: "",
            activeStorageKey: "k1",
            articleReady: false,
        });
    });

    it("keeps a past PR without a merge commit under the document's own storage key", () => {
        expect(
            activeArticleState({ ...historical, historicalContentKey: null, status })
                .activeStorageKey,
        ).toBe("a.md");
    });

    it("holds the article back when the file is absent at that version", () => {
        expect(
            activeArticleState({
                ...historical,
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
    });

    it("compares against an empty baseline for a file added in the range", () => {
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

    const comparing = { ...avail, comparingIterations: true };

    it.each([
        { name: "a file with changes", state: { ...avail, currentFileDiff }, offered: true },
        {
            name: "a file with an empty diff",
            state: { ...avail, currentFileDiff: [] },
            offered: false,
        },
        { name: "a file whose diff hasn't loaded", state: avail, offered: false },
        {
            name: "a wholly added or deleted file",
            state: { ...avail, currentFileDiff, isWholeFileChange: true },
            offered: false,
        },
        {
            name: "a past version of the file",
            state: { ...avail, currentFileDiff, viewingHistorical: true },
            offered: false,
        },
        {
            name: "compared updates with changes",
            state: { ...comparing, iterationDiff },
            offered: true,
        },
        {
            name: "compared updates without changes",
            state: { ...comparing, iterationDiff: [] },
            offered: false,
        },
        { name: "compared updates whose diff hasn't loaded", state: comparing, offered: false },
        {
            name: "compared updates where the file is new",
            state: { ...comparing, iterationDiff, baselineAbsent: true },
            offered: false,
        },
    ])("offers the changes view for $name: $offered", ({ state, offered }) => {
        expect(isDiffAvailable(state)).toBe(offered);
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

    it.each([
        {
            name: "its title",
            stop: { ...past(4, "c4"), title: undefined },
            pill: { prId: 4, title: "PR #4" },
        },
        {
            name: "its id",
            stop: { ...past(4, "c4"), prId: null },
            pill: { prId: 0, title: "PR 4" },
        },
    ])("labels a past PR pill even when the stop lacks $name", ({ stop, pill }) => {
        expect(
            commentAccess({ ...base, viewingHistorical: true, activeStop: stop }).activeRoutedPr,
        ).toMatchObject(pill);
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

    it("locks documents-mode comments while the routing PR is still active", () => {
        const r = commentAccess({ ...base, documentsMode: true });
        expect(r.commentsAvailable).toBe(false);
        expect(r.activeReadOnly).toBe(true);
        expect(r.activeReadOnlyMessage).toMatch(/unavailable until/);
    });

    it("makes comments unavailable for a hub document no completed PR has touched", () => {
        const r = commentAccess({
            ...base,
            documentsMode: true,
            routedPrResolution: null,
            effectiveRoutedPr: undefined,
        });

        expect(r.commentsAvailable).toBe(false);
        expect(r.activeReadOnlyMessage).toMatch(/unavailable until/);
    });

    it.each([
        { name: "the routing PR is still resolving", overrides: { routedPrResolution: undefined } },
        {
            name: "the routing PR is completed",
            overrides: { effectiveRoutedPr: { ...routed, status: "completed" as const } },
        },
    ])("allows documents-mode comments when $name", ({ overrides }) => {
        expect(
            commentAccess({ ...base, documentsMode: true, ...overrides }).commentsAvailable,
        ).toBe(true);
    });
});

describe("buildHistoryNav", () => {
    const stops = [current, past(5, "c5"), past(4, "c4")];

    it.each([
        { name: "history is off", enabled: false, available: stops },
        { name: "there is only the current version", enabled: true, available: [current] },
    ])("offers no history stepping when $name", ({ enabled, available }) => {
        expect(buildHistoryNav(enabled, available, 0, vi.fn())).toBeUndefined();
    });

    it("offers both directions from a middle stop, naming the stop each one leads to", () => {
        const nav = buildHistoryNav(true, stops, 1, vi.fn())!;
        expect(nav.canNewer).toBe(true);
        expect(nav.canOlder).toBe(true);
        expect(nav.olderLabel).toBe("Older version — PR #4: PR 4");
        expect(nav.newerLabel).toBe("Newer version — current version (PR #7)");
    });

    it.each([
        { name: "newer steps to the stop above", step: "onNewer" as const, to: 0 },
        { name: "older steps to the stop below", step: "onOlder" as const, to: 2 },
    ])("from a middle stop, $name", ({ step, to }) => {
        const onStep = vi.fn();
        buildHistoryNav(true, stops, 1, onStep)![step]();
        expect(onStep).toHaveBeenCalledWith(to);
    });

    it("can't step older from the oldest stop", () => {
        expect(buildHistoryNav(true, stops, 2, vi.fn())!.canOlder).toBe(false);
    });

    it("can't step newer from the current version", () => {
        expect(buildHistoryNav(true, stops, 0, vi.fn())!.canNewer).toBe(false);
    });
});

describe("reader chrome", () => {
    it("exposes the reading style as CSS custom properties", () => {
        const { readerFont, readerStyle } = readerStyleFor(DEFAULT_READER_PREFS);

        expect(readerStyle).toMatchObject({
            "--emr-reader-font": readerFont.stack,
        });
    });

    it.each([undefined, ""])("offers no feedback link without an address (%j)", (address) => {
        expect(feedbackHrefFor(address)).toBeUndefined();
    });

    it("builds the feedback mailto for an address", () => {
        expect(feedbackHrefFor("a@b.test")).toBe(
            `mailto:a@b.test?subject=${encodeURIComponent("Markdown Review — bug report / feedback")}`,
        );
    });

    it.each([
        {
            name: "the plain app",
            state: {
                navHidden: false,
                commentsHidden: false,
                documentsMode: undefined,
                tooNarrow: false,
            },
            className: "emr-app",
        },
        {
            name: "every layout modifier",
            state: { navHidden: true, commentsHidden: true, documentsMode: true, tooNarrow: true },
            className: "emr-app is-nav-hidden is-comments-hidden is-documents-mode is-too-narrow",
        },
    ])("styles $name", ({ state, className }) => {
        expect(appClassName(state)).toBe(className);
    });

    it.each([
        {
            name: "an earlier PR update shows no read-only banner and no pill",
            state: { nativeIterationMode: true, viewingHistorical: true, documentsMode: undefined },
            chrome: { showReadOnlyBanner: false, hidePrPill: true },
        },
        {
            name: "a past completed PR shows the read-only banner and its pill",
            state: {
                nativeIterationMode: false,
                viewingHistorical: true,
                documentsMode: undefined,
            },
            chrome: { showReadOnlyBanner: true, hidePrPill: false },
        },
        {
            name: "documents mode hides the PR pill",
            state: { nativeIterationMode: false, viewingHistorical: false, documentsMode: true },
            chrome: expect.objectContaining({ hidePrPill: true }),
        },
    ])("$name", ({ state, chrome }) => {
        expect(railChrome({ ...state, hidePrPill: false })).toEqual(chrome);
    });

    const prefs = {
        ...DEFAULT_READER_PREFS,
        showNav: true,
        showComments: true,
    };

    it("lays out a full reader with resizable panes", () => {
        expect(paneLayout(undefined, prefs, true)).toEqual({
            navToggleable: true,
            navHidden: false,
            commentsHidden: false,
            bodyFrameClassName: "emr-body-frame",
            railResizable: true,
            navReopenShown: false,
            commentsReopenShown: false,
        });
    });

    it("offers to reopen panes the reader closed", () => {
        expect(
            paneLayout(undefined, { ...prefs, showNav: false, showComments: false }, true),
        ).toMatchObject({ navReopenShown: true, commentsReopenShown: true });
    });

    it("hides the nav when the host hides it, and the rail when comments are unavailable", () => {
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

    it("keeps a single-file panel's comment rail fixed even with comments available", () => {
        expect(paneLayout(true, prefs, true).railResizable).toBe(false);
    });

    it("keeps the full reader's rail fixed when comments are unavailable", () => {
        expect(paneLayout(undefined, prefs, false).railResizable).toBe(false);
    });

    const updates = [
        { stopIndex: 1, number: 1, title: "Update 1" },
        { stopIndex: 0, number: 2, title: "Update 2" },
    ];

    const done = { prId: 1, title: "t", status: "completed" as const };

    it("gives the status bar the resolved PR, update picker and refresh in a PR's documents", () => {
        const handleRefresh = vi.fn();
        expect(
            statusBarExtras({
                documentsMode: true,
                activeRoutedPr: done,
                nativeIterationMode: true,
                iterationOptions: updates,
                reviewIterationBaseCommit: "base",
                canRefreshComments: true,
                handleRefresh,
                commentsRefreshing: false,
                fileRefreshInFlight: true,
            }),
        ).toEqual({
            resolvedPullRequest: done,
            iterationOptions: updates,
            iterationBaseCommit: "base",
            onRefresh: handleRefresh,
            refreshing: true,
        });
    });

    const statusBarBase = {
        documentsMode: true,
        activeRoutedPr: done,
        nativeIterationMode: true,
        iterationOptions: updates,
        reviewIterationBaseCommit: "base",
        canRefreshComments: false,
        handleRefresh: vi.fn(),
        commentsRefreshing: false,
        fileRefreshInFlight: false,
    };

    it.each([
        { name: "still active", activeRoutedPr: { ...done, status: "active" as const } },
        { name: "not resolved yet", activeRoutedPr: undefined },
    ])(
        "names no resolved PR in the status bar while the routing PR is $name",
        ({ activeRoutedPr }) => {
            expect(
                statusBarExtras({ ...statusBarBase, activeRoutedPr }).resolvedPullRequest,
            ).toBeUndefined();
        },
    );

    it("offers no update picker for a PR with a single update", () => {
        expect(
            statusBarExtras({ ...statusBarBase, iterationOptions: [updates[0]!] }).iterationOptions,
        ).toBeUndefined();
    });

    it("gives the status bar none of the PR controls outside documents and update modes", () => {
        expect(
            statusBarExtras({
                documentsMode: false,
                activeRoutedPr: done,
                nativeIterationMode: false,
                iterationOptions: updates,
                reviewIterationBaseCommit: "base",
                canRefreshComments: false,
                handleRefresh: vi.fn(),
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
