// React-hook tests for useHistoryLoaders: loads that settle after the
// selection moved on (or the shell unmounted) must not land in the caches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "../src/types";
import type { DocPrRef, HistoryStop } from "../src/shell/shellHelpers";
import { useHistoryLoaders } from "../src/shell/shell/useHistoryLoaders";
import {
    deferred,
    HELD_SOURCE,
    heldRender,
    mountHook,
    parentState,
    settle,
    type MountedHook,
} from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

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
            options({
                loadDocHistory: () => history.promise,
                setHistoryByPath,
            }),
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
            loadFileSourceAt: (path) => (path === "docs/a.md" ? source.promise : never<string>()),
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
            loadFileSourceAt: (path) => (path === "docs/a.md" ? source.promise : never<string>()),
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

const telemetry = recordTelemetryEachTest();

const KEY_C1 = "docs/a.md\u0000c1";
const KEY_C2 = "docs/a.md\u0000c2";

const stopAt = (commitId: string, prId: number): HistoryStop => ({
    commitId,
    prId,
    isCurrent: false,
    readOnly: true,
});

const notFound = () => new Error("TF401174: The item docs/a.md could not be found.");

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("useHistoryLoaders: a document's review history", () => {
    it("keeps each opened document's review history under its own path", async () => {
        const history = parentState<Record<string, DocPrRef[]>>({});

        const refsFor = (path: string): DocPrRef[] => [
            { prId: path === "docs/a.md" ? 1 : 2, commitId: "m", title: path },
        ];

        const base = options({
            loadDocHistory: (path) => Promise.resolve(refsFor(path)),
            setHistoryByPath: history.set,
        });

        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, selectedPath: "docs/b.md" });
        await settle();
        expect(history.value).toEqual({
            "docs/a.md": refsFor("docs/a.md"),
            "docs/b.md": refsFor("docs/b.md"),
        });
    });

    it.each([
        ["review history is turned off", { completedPrHistoryEnabled: false }],
        ["no document is selected", { selectedPath: "" }],
    ])("doesn't request a review history when %s", async (_situation, overrides) => {
        const loadDocHistory = vi.fn(() => never<DocPrRef[]>());
        mounted = await mountHook(useHistoryLoaders, options({ loadDocHistory, ...overrides }));
        await settle();
        expect(loadDocHistory).not.toHaveBeenCalled();
    });

    it("doesn't request a document's history again when it's reopened", async () => {
        const loadDocHistory = vi.fn(() => Promise.resolve<DocPrRef[]>([]));
        const base = options({ loadDocHistory });
        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, selectedPath: "docs/b.md" });
        await settle();
        await mounted.rerender(base);
        await settle();
        expect(loadDocHistory).toHaveBeenCalledTimes(2);
    });

    it("retries a failed history load the next time the document is opened", async () => {
        const history = parentState<Record<string, DocPrRef[]>>({});
        const refs: DocPrRef[] = [{ prId: 3, commitId: "m3", title: "PR 3" }];

        const loadDocHistory = vi
            .fn<(path: string) => Promise<DocPrRef[]>>()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue(refs);

        const base = options({ loadDocHistory, setHistoryByPath: history.set });
        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, selectedPath: "docs/b.md" });
        await settle();
        await mounted.rerender(base);
        await settle();
        expect(history.value["docs/a.md"]).toEqual(refs);
    });

    it("reports a failed history load as degraded history", async () => {
        mounted = await mountHook(
            useHistoryLoaders,
            options({ loadDocHistory: () => Promise.reject(new Error("offline")) }),
        );
        await settle();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "Shell.history",
                operation: "history-list-load",
                impact: "degraded",
            }),
        ]);
    });
});

describe("useHistoryLoaders: where the history stepper starts", () => {
    it("starts a newly opened document at its current version", async () => {
        const setCompletedHistoryStopIndex = vi.fn();
        const base = options({ setCompletedHistoryStopIndex });
        mounted = await mountHook(useHistoryLoaders, base);
        setCompletedHistoryStopIndex.mockClear();
        await mounted.rerender({ ...base, selectedPath: "docs/b.md" });
        expect(setCompletedHistoryStopIndex).toHaveBeenCalledWith(0);
    });

    it("keeps an update comparison opened from a shared link", async () => {
        const setIterationRange = vi.fn();
        mounted = await mountHook(
            useHistoryLoaders,
            options({ nativeIterationMode: true, nativeUpdateCount: 3, setIterationRange }),
        );
        expect(setIterationRange).not.toHaveBeenCalled();
    });

    it("resets the update comparison to all updates when the PR gets a new update", async () => {
        const setIterationRange = vi.fn();

        const base = options({
            nativeIterationMode: true,
            nativeUpdateCount: 3,
            setIterationRange,
        });

        mounted = await mountHook(useHistoryLoaders, base);
        await mounted.rerender({ ...base, nativeUpdateCount: 4 });
        expect(setIterationRange).toHaveBeenCalledWith({ fromUpdate: 0, toUpdate: 4 });
    });
});

describe("useHistoryLoaders: past versions of the document", () => {
    const viewingPast = (overrides: Partial<Options> = {}): Options =>
        options({
            viewingHistorical: true,
            activeStop: stopAt("c1", 7),
            loadFileSourceAt: (_path, commitId) => Promise.resolve(`# Version ${commitId}`),
            ...overrides,
        });

    it("loads and renders the document as it was at a past PR stop", async () => {
        const loadFileSourceAt = vi.fn(() => Promise.resolve("# Old title"));
        mounted = await mountHook(useHistoryLoaders, viewingPast({ loadFileSourceAt }));
        await settle();
        expect(loadFileSourceAt).toHaveBeenCalledWith("docs/a.md", "c1");
        expect(mounted.current.historicalSourceByKey).toEqual({ [KEY_C1]: "# Old title" });
        expect(mounted.current.historicalHtmlByKey[KEY_C1]).toContain("Old title");
    });

    it("fetches no past version while the current version is shown", async () => {
        const loadFileSourceAt = vi.fn(() => never<string>());
        mounted = await mountHook(
            useHistoryLoaders,
            options({ loadFileSourceAt, reviewIterationBaseCommit: "base" }),
        );
        await settle();
        expect(loadFileSourceAt).not.toHaveBeenCalled();
    });

    it("loads both ends when comparing two PR updates", async () => {
        mounted = await mountHook(
            useHistoryLoaders,
            viewingPast({
                nativeIterationMode: true,
                comparingIterations: true,
                activeStop: stopAt("c2", 7),
                baselineStop: stopAt("c1", 7),
            }),
        );
        await settle();
        expect(mounted.current.historicalSourceByKey).toEqual({
            [KEY_C1]: "# Version c1",
            [KEY_C2]: "# Version c2",
        });
    });

    it("loads the newly chosen version when stepping to another past stop", async () => {
        const base = viewingPast();
        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, activeStop: stopAt("c2", 8) });
        await settle();
        expect(mounted.current.historicalSourceByKey[KEY_C2]).toBe("# Version c2");
    });

    it("doesn't fetch a past version again when stepping back to it", async () => {
        const loadFileSourceAt = vi.fn((_path: string, commitId: string) =>
            Promise.resolve(`# Version ${commitId}`),
        );

        const base = viewingPast({ loadFileSourceAt });
        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, activeStop: stopAt("c2", 8) });
        await settle();
        await mounted.rerender(base);
        await settle();
        expect(loadFileSourceAt).toHaveBeenCalledTimes(2);
    });

    it("shows why a past version failed to load, without fetching it again", async () => {
        const loadFileSourceAt = vi.fn(() => Promise.reject(new Error("Server busy")));
        mounted = await mountHook(useHistoryLoaders, viewingPast({ loadFileSourceAt }));
        await settle();
        expect(mounted.current.historicalErrorByKey).toEqual({ [KEY_C1]: "Server busy" });
        expect(loadFileSourceAt).toHaveBeenCalledTimes(1);
    });

    it("reports a past version that failed to load as a failed action", async () => {
        mounted = await mountHook(
            useHistoryLoaders,
            viewingPast({ loadFileSourceAt: () => Promise.reject(new Error("Server busy")) }),
        );
        await settle();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "Shell.history",
                operation: "history-content-load",
                impact: "action-failed",
            }),
        ]);
    });

    it("marks a document missing at a compared PR update as absent rather than failed, without fetching it again", async () => {
        const loadFileSourceAt = vi.fn(() => Promise.reject(notFound()));
        mounted = await mountHook(
            useHistoryLoaders,
            viewingPast({ nativeIterationMode: true, loadFileSourceAt }),
        );
        await settle();
        expect(mounted.current.historicalAbsentByKey).toEqual({ [KEY_C1]: true });
        expect(mounted.current.historicalErrorByKey).toEqual({});
        expect(loadFileSourceAt).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["a missing document at a past PR stop", false, notFound()],
        ["a server failure while comparing PR updates", true, new Error("Server busy")],
    ])("treats %s as a load failure", async (_situation, nativeIterationMode, error) => {
        mounted = await mountHook(
            useHistoryLoaders,
            viewingPast({ nativeIterationMode, loadFileSourceAt: () => Promise.reject(error) }),
        );
        await settle();
        expect(mounted.current.historicalErrorByKey).toEqual({ [KEY_C1]: error.message });
        expect(mounted.current.historicalAbsentByKey).toEqual({});
    });

    it("shows nothing for a past stop when past versions can't be fetched", async () => {
        mounted = await mountHook(useHistoryLoaders, viewingPast({ loadFileSourceAt: undefined }));
        await settle();
        expect(mounted.current.historicalSourceByKey).toEqual({});
        expect(mounted.current.historicalErrorByKey).toEqual({});
    });
});

describe("useHistoryLoaders: comments of a past PR", () => {
    const thread = { id: "t1" } as unknown as CommentThread;

    it("loads the past PR's comments on this document", async () => {
        const loadThreadsForPr = vi.fn(() => Promise.resolve([thread]));
        mounted = await mountHook(
            useHistoryLoaders,
            options({ viewingHistorical: true, activeStop: pastStop, loadThreadsForPr }),
        );
        await settle();
        expect(loadThreadsForPr).toHaveBeenCalledWith(7, "docs/a.md");
        expect(mounted.current.historicalThreadsByKey).toEqual({
            "docs/a.md\u00007": [thread],
        });
    });

    it.each([
        ["the current version is shown", { viewingHistorical: false, activeStop: current }],
        ["PR updates are being compared", { viewingHistorical: true, nativeIterationMode: true }],
    ])("loads no past comments when %s", async (_situation, overrides) => {
        const loadThreadsForPr = vi.fn(() => never<CommentThread[]>());
        mounted = await mountHook(
            useHistoryLoaders,
            options({ activeStop: pastStop, loadThreadsForPr, ...overrides }),
        );
        await settle();
        expect(loadThreadsForPr).not.toHaveBeenCalled();
    });

    it("shows a past PR's comments again without reloading them", async () => {
        const loadThreadsForPr = vi.fn(() => Promise.resolve([thread]));
        const base = options({ viewingHistorical: true, activeStop: pastStop, loadThreadsForPr });
        mounted = await mountHook(useHistoryLoaders, base);
        await settle();
        await mounted.rerender({ ...base, viewingHistorical: false, activeStop: current });
        await settle();
        await mounted.rerender(base);
        await settle();
        expect(loadThreadsForPr).toHaveBeenCalledTimes(1);
        expect(mounted.current.historicalThreadsByKey["docs/a.md\u00007"]).toEqual([thread]);
    });

    it("reports a past PR's comments failing to load as degraded history", async () => {
        mounted = await mountHook(
            useHistoryLoaders,
            options({
                viewingHistorical: true,
                activeStop: pastStop,
                loadThreadsForPr: () => Promise.reject(new Error("offline")),
            }),
        );
        await settle();
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "Shell.history",
                operation: "history-comments-load",
                impact: "degraded",
            }),
        ]);
    });
});
