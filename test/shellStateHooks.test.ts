// React-hook tests for Shell's comment-state plumbing — CommentApi routing
// and identity resolution, the per-document first thread load, the
// historical thread view — plus the draft-guard notice's file label.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalOnlyCommentApi, type CommentApi } from "../src/comments/api";
import { IdentityStore } from "../src/comments/identityStore";
import type { CommentThread } from "../src/types";
import { ShellNotices } from "../src/shell/shell/ShellNotices";
import { useCommentApiRouting } from "../src/shell/shell/useCommentApiRouting";
import { useThreadStore } from "../src/shell/shell/useThreadStore";
import { useThreadViews } from "../src/shell/shell/useThreadViews";
import {
    deferred,
    mountTracked as mount,
    onUnmountAll,
    settle,
    stubCommentApi,
    unmountAll,
} from "./shellHarness";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

const GUID = "6f2c3a1e-1234-4abc-9def-0123456789ab";
afterEach(unmountAll);

function routing(commentApi: CommentApi | undefined, selectedPath: string) {
    return {
        commentApi,
        commentApiForPath: undefined,
        routedPr: undefined,
        routedPrForPath: undefined,
        selectedPath,
    };
}

describe("useCommentApiRouting", () => {
    it("adopts a CommentApi swapped in after mount", async () => {
        const first = new LocalOnlyCommentApi();
        const second = new LocalOnlyCommentApi();
        const hook = await mount(useCommentApiRouting, routing(first, "a.md"));
        expect(hook.current.commentApi).toBe(first);
        await hook.rerender(routing(second, "b.md"));
        expect(hook.current.commentApi).toBe(second);
    });

    it("keeps the last CommentApi when the host stops passing one", async () => {
        const api = new LocalOnlyCommentApi();
        const hook = await mount(useCommentApiRouting, routing(api, "a.md"));
        await hook.rerender(routing(undefined, "b.md"));
        expect(hook.current.commentApi).toBe(api);
    });

    it("resolves mention identities through the effective CommentApi", async () => {
        const api = {
            ...stubCommentApi(),
            resolveIdentities: vi.fn(async () => ({
                [GUID]: { displayName: "Ada" },
            })),
        };

        const hook = await mount(useCommentApiRouting, routing(api, "a.md"));
        hook.current.identityStore.ensure([GUID]);
        await settle();
        expect(hook.current.identityStore.get(GUID)?.displayName).toBe("Ada");
    });

    it("resolves no identities when the CommentApi can't look them up", async () => {
        const hook = await mount(useCommentApiRouting, routing(stubCommentApi(), "a.md"));

        hook.current.identityStore.ensure([GUID]);
        await settle();
        expect(hook.current.identityStore.get(GUID)).toBeUndefined();
    });
});

describe("useCommentApiRouting: documents hub routing each document to its own pull request", () => {
    const pr = (id: number) =>
        ({ prId: id }) as unknown as NonNullable<
            Parameters<typeof useCommentApiRouting>[0]["routedPr"]
        >;

    function perDocument(apis: Record<string, CommentApi | undefined>, selectedPath: string) {
        return {
            commentApi: undefined,
            // Like the hub, each lookup hands out a fresh connection for the path.
            commentApiForPath: vi.fn((path: string) =>
                apis[path] ? { ...apis[path] } : undefined,
            ),
            routedPr: undefined,
            routedPrForPath: (path: string) => (path === "docs/a.md" ? pr(1) : pr(2)),
            selectedPath,
        };
    }

    it("writes each document's comments to its own pull request", async () => {
        const opts = perDocument(
            { "docs/a.md": stubCommentApi(), "docs/b.md": stubCommentApi() },
            "docs/a.md",
        );

        const hook = await mount(useCommentApiRouting, opts);
        expect(opts.commentApiForPath).toHaveBeenCalledWith("docs/a.md");
        expect(hook.current.perDocNoWriteTarget).toBe(false);
        await hook.rerender({ ...opts, selectedPath: "docs/b.md" });
        expect(opts.commentApiForPath).toHaveBeenLastCalledWith("docs/b.md");
    });

    it("keeps using a document's connection when the reader returns to it", async () => {
        const opts = perDocument(
            { "docs/a.md": stubCommentApi(), "docs/b.md": stubCommentApi() },
            "docs/a.md",
        );

        const hook = await mount(useCommentApiRouting, opts);
        const first = hook.current.commentApi;
        await hook.rerender({ ...opts, selectedPath: "docs/b.md" });
        await hook.rerender(opts);
        expect(hook.current.commentApi).toBe(first);
    });

    it("shows a document without a pull request to write to as read-only", async () => {
        const opts = perDocument({}, "docs/a.md");
        const hook = await mount(useCommentApiRouting, opts);
        expect(hook.current.perDocNoWriteTarget).toBe(true);
        expect(hook.current.commentApi).toBeInstanceOf(LocalOnlyCommentApi);
    });

    it("shows the pull request pill of the open document", async () => {
        const opts = perDocument({}, "docs/a.md");
        const hook = await mount(useCommentApiRouting, opts);
        expect(hook.current.effectiveRoutedPr).toEqual(pr(1));
        await hook.rerender({ ...opts, selectedPath: "docs/b.md" });
        expect(hook.current.effectiveRoutedPr).toEqual(pr(2));
    });

    it("lets reviewers comment on a pull request's documents", async () => {
        const hook = await mount(useCommentApiRouting, {
            ...routing(stubCommentApi(), "docs/a.md"),
            routedPr: pr(5),
        });

        expect(hook.current.perDocNoWriteTarget).toBe(false);
        expect(hook.current.effectiveRoutedPr).toEqual(pr(5));
    });
});

const thread = (id: string, filePath: string): CommentThread => ({
    id,
    filePath,
    anchor: { exact: "x", prefix: "", suffix: "" },
    status: "active",
    comments: [],
});

describe("useThreadStore", () => {
    it("drops a document's first thread load that resolves after leaving it", async () => {
        const first = deferred<CommentThread[]>();

        const base = {
            initialThreads: [],
            currentUser: { id: "me", displayName: "Me", initials: "ME" },
            identityStore: new IdentityStore(),
            selectedPath: "docs/a.md",
            selectedPathRef: { current: "docs/a.md" },
            // A PR-wide poller that never settles keeps the sync out of the way.
            fetchRemoteThreads: () => new Promise<CommentThread[]>(() => {}),
            loadThreadsForPath: (path: string) =>
                path === "docs/a.md" ? first.promise : new Promise<CommentThread[]>(() => {}),
            threadSyncIntervalMs: undefined,
            onRefreshFiles: undefined,
        };

        const hook = await mount(useThreadStore, base);
        await hook.rerender({ ...base, selectedPath: "docs/b.md" });
        first.resolve([thread("t1", "docs/a.md")]);
        await settle();
        expect(hook.current.threadState.order).toEqual([]);
    });

    // Production: only 19% of PRs with comments started here saw one resolved
    // here; the snapshot shows whether the rest are finished in ADO's own UI.
    it("reports the PR's thread statuses once, on the first PR-wide load", async () => {
        const ours = (id: string, status: CommentThread["status"]): CommentThread => ({
            ...thread(id, "docs/a.md"),
            origin: "extension",
            status,
        });

        const fetchRemoteThreads = vi.fn(async () => [
            ours("t1", "active"),
            ours("t2", "resolved"),
            ours("t3", "closed"),
            { ...thread("t4", "docs/a.md"), origin: "ado" as const, status: "pending" as const },
            { ...thread("t5", "docs/a.md"), status: "wontFix" as const },
        ]);

        const hook = await mount(useThreadStore, {
            initialThreads: [],
            currentUser: { id: "me", displayName: "Me", initials: "ME" },
            identityStore: new IdentityStore(),
            selectedPath: "docs/a.md",
            selectedPathRef: { current: "docs/a.md" },
            fetchRemoteThreads,
            loadThreadsForPath: undefined,
            threadSyncIntervalMs: undefined,
            onRefreshFiles: undefined,
        });

        await settle();
        await act(async () => hook.current.handleRefresh());
        await settle();

        const snapshots = telemetry.current.events.filter((e) => e.name === "threads.snapshot");
        expect(fetchRemoteThreads.mock.calls.length).toBeGreaterThan(1);
        expect(snapshots).toEqual([
            expect.objectContaining({
                measurements: { ourOpen: 1, ourDone: 2, otherOpen: 1, otherDone: 1 },
            }),
        ]);
    });
});

describe("useThreadViews", () => {
    const t7 = thread("t7", "docs/a.md");

    async function historicalThreads(activeStopPrId: number | null) {
        const hook = await mount(useThreadViews, {
            threadState: { threadsById: {}, order: [] },
            selectedPath: "docs/a.md",
            files: [],
            isHub: false,
            viewingHistorical: true,
            nativeIterationMode: false,
            activeStopPrId,
            historicalThreadsByKey: { "docs/a.md\u00007": [t7] },
            commentQuery: "",
            commentFilter: "all",
            currentUserId: "me",
        });

        return hook.current.currentThreadsRaw;
    }

    it("shows a past PR's cached threads", async () => {
        expect(await historicalThreads(7)).toEqual([t7]);
    });

    it.each([
        { name: "a past PR whose threads haven't loaded", prId: 8 },
        { name: "a past version without a PR", prId: null },
    ])("shows no threads for $name", async ({ prId }) => {
        expect(await historicalThreads(prId)).toEqual([]);
    });
});

describe("ShellNotices", () => {
    it("labels a draft on a path with no file name by its raw path", async () => {
        const container = document.body.appendChild(document.createElement("div"));

        const root = createRoot(container);
        onUnmountAll(() => {
            act(() => root.unmount());
            container.remove();
        });
        await act(async () => {
            root.render(
                createElement(ShellNotices, {
                    persistError: null,
                    onDismissPersistError: vi.fn(),
                    reloadAllowed: true,
                    missingDoc: null,
                    onDismissMissingDoc: vi.fn(),
                    draftGuard: {
                        requested: { path: "/", threadId: "t1", anchor: null },
                        existingPath: "/",
                        snippet: "draft",
                    },
                    onDiscardExistingDraft: vi.fn(),
                    onKeepExistingDraft: vi.fn(),
                }),
            );
        });
        expect(container.querySelector(".emr-draft-guard-body strong")?.textContent).toBe("/");
    });
});
