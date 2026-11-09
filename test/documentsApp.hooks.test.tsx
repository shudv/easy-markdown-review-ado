// Behavioural tests for the Documents hub container hooks (repo selection,
// lazy tree + root auto-expand, active document path, repo-bound loaders).
// Each hook runs inside a tiny host component; assertions only touch the
// hook's returned surface and the host callbacks it drives.
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentApi } from "../src/comments/api";
import type { DocRepo, FolderListing } from "../src/shell/types";
import type { FileInfo, PrInfo } from "../src/types";
import type { DocumentsAppProps } from "../src/hub/documentsAppProps";
import { useActiveDocPath } from "../src/hub/useActiveDocPath";
import { useLazyTree } from "../src/hub/useLazyTree";
import { useRepoBindings } from "../src/hub/useRepoBindings";
import { useSelectedRepo } from "../src/hub/useSelectedRepo";
import { EVENT, getTelemetryContext } from "../src/telemetry";
import { recordTelemetryEachTest } from "./telemetrySink";

const telemetry = recordTelemetryEachTest();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function renderHook<P, R>(hook: (props: P) => R, initial: P) {
    const result = { current: undefined as unknown as R };

    function Host({ props }: { props: P }): null {
        result.current = hook(props);

        return null;
    }

    const root = createRoot(document.createElement("div"));
    roots.push(root);
    act(() => root.render(<Host props={initial} />));

    return {
        result,
        rerender: (props: P) => act(() => root.render(<Host props={props} />)),
    };
}

function file(path: string): FileInfo {
    return { path, changeType: "modified", linesAdded: 0, linesDeleted: 0 };
}

function repo(id: string, overrides: Partial<DocRepo> = {}): DocRepo {
    return {
        id,
        name: id,
        description: "",
        defaultBranch: "main",
        files: [],
        recentPr: null,
        ...overrides,
    };
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    roots = [];
});

describe("useSelectedRepo", () => {
    type P = Parameters<typeof useSelectedRepo>;
    const run = (args: P) => renderHook((p: P) => useSelectedRepo(...p), args);

    it("opens the initial repo and loads its details when it is still a skeleton", () => {
        const onLoad = vi.fn(async () => {});

        const { result } = run([
            [repo("a"), repo("b", { detailsLoaded: false })],
            "b",
            undefined,
            onLoad,
        ]);

        expect(result.current.selectedRepoId).toBe("b");
        expect(result.current.selectedRepo?.id).toBe("b");
        expect(onLoad).toHaveBeenCalledWith("b");
    });

    it("tags telemetry with the selected repo, following a switch", () => {
        const { result } = run([[repo("a"), repo("b")], "b", undefined, undefined]);
        expect(getTelemetryContext().repositoryId).toBe("b");

        act(() => result.current.handleSelectRepo("a"));
        expect(getTelemetryContext().repositoryId).toBe("a");
    });

    it("reports a switch to an already-loaded repo without reloading its details", () => {
        const onLoad = vi.fn(async () => {});
        const { result } = run([[repo("a"), repo("b")], "b", undefined, onLoad]);

        act(() => result.current.handleSelectRepo("a"));
        expect(result.current.selectedRepo?.id).toBe("a");
        expect(telemetry.current.eventNames()).toEqual([EVENT.RepoSwitched]);
        expect(onLoad).not.toHaveBeenCalled();
    });

    it("notifies the host on switch and keeps a repo filtered out of view", () => {
        const onSelect = vi.fn();
        const repos = [repo("a"), repo("b")];
        const { result, rerender } = run([repos, "a", onSelect, undefined]);
        act(() => result.current.handleSelectRepo("b"));
        expect(onSelect).toHaveBeenCalledWith("b");
        rerender([[repo("a")], "a", onSelect, undefined]);
        expect(result.current.selectedRepo?.id).toBe("b");
    });

    it("shows a repo's details once they load", () => {
        const loaded = repo("a", { files: [file("/a.md")] });

        const { result, rerender } = run([
            [repo("a", { detailsLoaded: false })],
            "a",
            undefined,
            undefined,
        ]);

        rerender([[loaded], "a", undefined, undefined]);
        expect(result.current.selectedRepo).toBe(loaded);
    });

    it("loads the details of a not-yet-loaded repo the user switches to", () => {
        const onLoad = vi.fn(async () => {});

        const { result } = run([
            [repo("a"), repo("b", { detailsLoaded: false })],
            "a",
            undefined,
            onLoad,
        ]);

        act(() => result.current.handleSelectRepo("b"));
        expect(onLoad).toHaveBeenCalledWith("b");
    });

    it("tells the host's latest selection handler about a switch", () => {
        const first = vi.fn();
        const latest = vi.fn();
        const repos = [repo("a"), repo("b")];
        const { result, rerender } = run([repos, "a", first, undefined]);
        rerender([repos, "a", latest, undefined]);
        act(() => result.current.handleSelectRepo("b"));
        expect(latest).toHaveBeenCalledWith("b");
        expect(first).not.toHaveBeenCalled();
    });

    it("selects nothing in a project without repos", () => {
        const onLoad = vi.fn(async () => {});
        const { result } = run([[], "", undefined, onLoad]);
        expect(result.current.selectedRepo).toBeUndefined();
        expect(getTelemetryContext().repositoryId).toBeUndefined();
        expect(onLoad).not.toHaveBeenCalled();
    });
});

describe("useLazyTree", () => {
    type P = Parameters<typeof useLazyTree>;
    const run = (args: P) => renderHook((p: P) => useLazyTree(...p), args);

    it("is inert without a selected repo", async () => {
        const { result } = run([undefined, vi.fn()]);
        expect(result.current.lazyTree).toBeUndefined();
        await expect(result.current.handleExpandFolder("/docs")).resolves.toBeNull();
    });

    it("returns null when no expansion handler is wired", async () => {
        const { result } = run([repo("a", { files: [file("/a.md")] }), undefined]);

        expect(result.current.lazyTree?.files).toEqual([file("/a.md")]);
        await expect(result.current.handleExpandFolder("/docs")).resolves.toBeNull();
    });

    it("seeds from the real listing, not the skeleton, and keeps the cache", () => {
        const skeleton = repo("a", { detailsLoaded: false });
        const { result, rerender } = run([skeleton, undefined]);
        expect(result.current.lazyTree).toBeUndefined();

        const loaded = repo("a", {
            files: [file("/a.md")],
            detailsLoaded: true,
        });

        rerender([loaded, undefined]);
        expect(result.current.lazyTree?.files).toEqual([file("/a.md")]);

        rerender([repo("a", { files: [], detailsLoaded: true }), undefined]);
        expect(result.current.lazyTree?.files).toEqual([file("/a.md")]);
    });

    it("seeds a repo switched to from its real listing once it loads, not from its skeleton", () => {
        const { result, rerender } = run([repo("a", { files: [file("/a.md")] }), undefined]);
        rerender([repo("b", { detailsLoaded: false }), undefined]);
        rerender([repo("b", { files: [file("/b.md")], detailsLoaded: true }), undefined]);
        expect(result.current.lazyTree?.files).toEqual([file("/b.md")]);
    });

    it("shows no tree once no repo is selected", () => {
        const { result, rerender } = run([repo("a", { files: [file("/a.md")] }), undefined]);
        rerender([undefined, undefined]);
        expect(result.current.lazyTree).toBeUndefined();
    });

    it("expands folders of the repo the user switched to", async () => {
        const onExpand = vi.fn(async (): Promise<FolderListing> => ({ files: [], folders: [] }));
        const { result, rerender } = run([repo("a", { files: [file("/a.md")] }), onExpand]);
        rerender([repo("b", { files: [file("/b.md")] }), onExpand]);
        await act(async () => {
            await result.current.handleExpandFolder("/x");
        });
        expect(onExpand).toHaveBeenCalledWith("b", "/x");
    });

    it.each([
        { name: "a folder-only repo", loaded: {} },
        { name: "a folder-only repo flagged as loaded", loaded: { detailsLoaded: true } },
    ])("auto-expands $name until a document surfaces", async ({ loaded }) => {
        const listings: Record<string, FolderListing> = {
            "/docs": { files: [], folders: ["docs/guide"], order: ["guide"] },
            "docs/guide": { files: [file("/docs/guide/a.md")], folders: [] },
        };

        const onExpand = vi.fn(async (_repoId: string, path: string) => listings[path]!);

        const { result } = run([repo("a", { topLevelFolders: ["/docs"], ...loaded }), onExpand]);

        await flush();
        await flush();
        expect(onExpand).toHaveBeenCalledWith("a", "docs/guide");
        expect(result.current.lazyTree?.files).toEqual([file("/docs/guide/a.md")]);
        expect(result.current.lazyTree?.unloadedFolders).toEqual([]);
        expect(result.current.lazyTree?.folderOrders).toEqual({
            docs: ["guide"],
        });
    });

    it("skips auto-expand for skeletons, unseeded repos and visible docs", async () => {
        const onExpand = vi.fn(async (): Promise<FolderListing> => ({ files: [], folders: [] }));

        const { rerender } = run([
            repo("a", { topLevelFolders: ["/x"], detailsLoaded: false }),
            onExpand,
        ]);

        rerender([repo("b", { files: [file("/b.md")], topLevelFolders: ["/x"] }), onExpand]);
        await flush();
        expect(onExpand).not.toHaveBeenCalled();
    });

    it("reports a failed expansion and leaves the tree as-is", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const onExpand = vi.fn(async (): Promise<FolderListing> => {
            throw new Error("boom");
        });

        const { result } = run([repo("a", { files: [file("/a.md")] }), onExpand]);

        await act(async () => {
            await expect(result.current.handleExpandFolder("/x")).resolves.toBeNull();
        });
        expect(telemetry.current.userFacingErrors()).toEqual([
            expect.objectContaining({
                source: "DocumentsApp.navigation",
                operation: "folder-expand",
            }),
        ]);
        expect(result.current.lazyTree?.files).toEqual([file("/a.md")]);
        warn.mockRestore();
    });

    it("drops a listing whose repo entry was evicted mid-flight", async () => {
        let resolveListing: (listing: FolderListing) => void = () => {};

        const onExpand = vi.fn(
            () =>
                new Promise<FolderListing>((resolve) => {
                    resolveListing = resolve;
                }),
        );

        const { result } = run([repo("a", { files: [file("/a.md")] }), onExpand]);

        const pending = result.current.handleExpandFolder("/x");
        act(() => result.current.setLazyTreeByRepo(new Map()));
        await act(async () => {
            resolveListing({ files: [file("/x/b.md")], folders: [] });
            await pending;
        });
        expect(result.current.lazyTree).toBeUndefined();
    });

    it("stops auto-expanding once the per-repo budget is spent", async () => {
        const folders = Array.from({ length: 41 }, (_, i) => `/f${i}`);

        const onExpand = vi.fn(async (): Promise<FolderListing> => ({ files: [], folders: [] }));

        run([repo("a", { topLevelFolders: folders }), onExpand]);
        await flush();
        await flush();
        expect(onExpand).toHaveBeenCalledTimes(40);
    });
});

describe("useActiveDocPath", () => {
    type P = Parameters<typeof useActiveDocPath>;
    const run = (args: P) => renderHook((p: P) => useActiveDocPath(...p), args);

    const pr = (paths: string[]): PrInfo =>
        ({
            prId: 0,
            title: "",
            authorName: "",
            files: paths.map(file),
        }) as PrInfo;

    it("publishes the deep-link path once", () => {
        const onSelect = vi.fn();
        const { result, rerender } = run(["a", null, "/deep.md", onSelect]);
        expect(result.current[0]).toBe("/deep.md");
        expect(onSelect).toHaveBeenCalledWith("a", "/deep.md");
        rerender(["a", pr(["/x.md"]), "/deep.md", onSelect]);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("waits for a skeleton's files, then publishes the default doc", () => {
        const onSelect = vi.fn();
        const { result, rerender } = run(["a", pr([]), undefined, onSelect]);
        expect(result.current[0]).toBe("");
        expect(onSelect).not.toHaveBeenCalled();
        rerender(["a", pr(["/first.md"]), undefined, onSelect]);
        expect(result.current[0]).toBe("/first.md");
        expect(onSelect).toHaveBeenCalledWith("a", "/first.md");
    });

    it("keeps the document the user navigated to when the repo's file list refreshes", () => {
        const { result, rerender } = run(["a", pr(["/a.md"]), undefined, undefined]);
        act(() => result.current[1]("/other.md"));
        rerender(["a", pr(["/a.md", "/b.md"]), undefined, undefined]);
        expect(result.current[0]).toBe("/other.md");
    });

    it("clears the path on repo switch and tracks manual navigation", () => {
        const { result, rerender } = run(["a", pr(["/a.md"]), undefined, undefined]);

        expect(result.current[0]).toBe("/a.md");
        act(() => result.current[1]("/other.md"));
        expect(result.current[0]).toBe("/other.md");
        rerender(["b", null, undefined, undefined]);
        expect(result.current[0]).toBe("");
        rerender(["c", null, "/c.md", undefined]);
        expect(result.current[0]).toBe("/c.md");
    });
});

describe("useRepoBindings", () => {
    type P = Parameters<typeof useRepoBindings>;
    const run = (args: P) => renderHook((p: P) => useRepoBindings(...p), args);
    const api = {} as CommentApi;

    function fullProps(): DocumentsAppProps {
        return {
            repos: [],
            currentUser: { id: "u", displayName: "U", initials: "U" },
            loadThreadsFor: vi.fn(async () => []),
            loadFileSource: vi.fn(async (_r: string, p: string) => `src:${p}`),
            resolveDocumentImage: vi.fn(async () => "blob:img"),
            commentApiFor: vi.fn(() => api),
            commentApiForPath: vi.fn(() => api),
            loadThreadsForPath: vi.fn(async () => []),
            routedPrForPath: vi.fn(() => null),
            loadDocHistory: vi.fn(async () => []),
            loadThreadsForPr: vi.fn(async () => []),
            loadFileSourceAt: vi.fn(async () => "old"),
            onListSubpageFolder: vi.fn(async () => ({
                files: [],
                folders: [],
            })),
        };
    }

    it("curries the active repo id onto every host loader", async () => {
        const props = fullProps();
        const { result } = run([props, repo("r1"), true]);
        const b = result.current;

        await expect(b.repoScopedLoader("/a.md")).resolves.toBe("src:/a.md");
        await b.resolveDocumentImageBound!("/a.md", "/img.png", "c1");
        expect(props.resolveDocumentImage).toHaveBeenCalledWith("r1", "/a.md", "/img.png", "c1");
        expect(b.commentApi).toBe(api);
        expect(b.commentApiForPathBound!("/a.md")).toBe(api);
        expect(props.commentApiForPath).toHaveBeenCalledWith("r1", "/a.md");
        await b.loadThreadsForPathBound!("/a.md");
        expect(props.loadThreadsForPath).toHaveBeenCalledWith("r1", "/a.md");
        expect(b.routedPrForPathBound!("/a.md")).toBeNull();
        expect(props.routedPrForPath).toHaveBeenCalledWith("r1", "/a.md");
        await b.loadDocHistoryBound!("/a.md");
        expect(props.loadDocHistory).toHaveBeenCalledWith("r1", "/a.md");
        await b.loadThreadsForPrBound!(7, "/a.md");
        expect(props.loadThreadsForPr).toHaveBeenCalledWith("r1", 7, "/a.md");
        await expect(b.loadFileSourceAtBound!("/a.md", "c1")).resolves.toBe("old");
        expect(props.loadFileSourceAt).toHaveBeenCalledWith("r1", "/a.md", "c1");
        await b.listSubpageFolderBound!("/docs", "c1");
        expect(props.onListSubpageFolder).toHaveBeenCalledWith("r1", "/docs", "c1");
    });

    type Bindings = ReturnType<typeof useRepoBindings>;

    it.each<{
        name: string;
        use: (b: Bindings) => unknown;
        host: (p: DocumentsAppProps) => unknown;
        args: unknown[];
    }>([
        {
            name: "document sources",
            use: (b) => b.repoScopedLoader("/a.md"),
            host: (p) => p.loadFileSource,
            args: ["r2", "/a.md"],
        },
        {
            name: "document images",
            use: (b) => b.resolveDocumentImageBound!("/a.md", "/i.png"),
            host: (p) => p.resolveDocumentImage,
            args: ["r2", "/a.md", "/i.png", undefined],
        },
        {
            name: "the comment API",
            use: (b) => b.commentApi,
            host: (p) => p.commentApiFor,
            args: ["r2"],
        },
        {
            name: "per-document comment APIs",
            use: (b) => b.commentApiForPathBound!("/a.md"),
            host: (p) => p.commentApiForPath,
            args: ["r2", "/a.md"],
        },
        {
            name: "per-document threads",
            use: (b) => b.loadThreadsForPathBound!("/a.md"),
            host: (p) => p.loadThreadsForPath,
            args: ["r2", "/a.md"],
        },
        {
            name: "routed pull requests",
            use: (b) => b.routedPrForPathBound!("/a.md"),
            host: (p) => p.routedPrForPath,
            args: ["r2", "/a.md"],
        },
        {
            name: "review history",
            use: (b) => b.loadDocHistoryBound!("/a.md"),
            host: (p) => p.loadDocHistory,
            args: ["r2", "/a.md"],
        },
        {
            name: "past pull request threads",
            use: (b) => b.loadThreadsForPrBound!(7, "/a.md"),
            host: (p) => p.loadThreadsForPr,
            args: ["r2", 7, "/a.md"],
        },
        {
            name: "past document versions",
            use: (b) => b.loadFileSourceAtBound!("/a.md", "c1"),
            host: (p) => p.loadFileSourceAt,
            args: ["r2", "/a.md", "c1"],
        },
        {
            name: "wiki subpage folders",
            use: (b) => b.listSubpageFolderBound!("/docs"),
            host: (p) => p.onListSubpageFolder,
            args: ["r2", "/docs", undefined],
        },
    ])("reads $name from the repository the user switched to", ({ use, host, args }) => {
        const props = fullProps();
        const { result, rerender } = run([props, repo("r1"), true]);
        rerender([props, repo("r2"), true]);
        void use(result.current);
        expect(host(props)).toHaveBeenLastCalledWith(...args);
    });

    it("leaves per-document loaders unbound outside per-document mode", () => {
        const { result } = run([fullProps(), repo("r1"), false]);
        expect(result.current.commentApiForPathBound).toBeUndefined();
        expect(result.current.loadThreadsForPathBound).toBeUndefined();
        expect(result.current.routedPrForPathBound).toBeUndefined();
        expect(result.current.loadDocHistoryBound).toBeUndefined();
        expect(result.current.loadThreadsForPrBound).toBeUndefined();
        expect(result.current.loadFileSourceAtBound).toBeUndefined();
        expect(result.current.listSubpageFolderBound).toBeDefined();
    });

    it("binds nothing optional when the host omits the loaders", () => {
        const props: DocumentsAppProps = {
            repos: [],
            currentUser: { id: "u", displayName: "U", initials: "U" },
            loadThreadsFor: vi.fn(async () => []),
            loadFileSource: vi.fn(async () => ""),
        };

        const { result } = run([props, repo("r1"), true]);
        const { repoScopedLoader, ...optional } = result.current;
        expect(repoScopedLoader).toBeTypeOf("function");
        expect(optional).toEqual({});
    });

    it("binds nothing and rejects loads without a selected repo", async () => {
        const { result } = run([fullProps(), undefined, true]);
        const { repoScopedLoader, ...optional } = result.current;
        await expect(repoScopedLoader("/a.md")).rejects.toThrow("No repo selected");
        expect(optional).toEqual({});
    });
});
