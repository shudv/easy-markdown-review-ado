// DocumentsHubApp — real-ADO top-level component for the Documents hub.
// Lives behind our own top-level hub-group contribution. Discovers the active
// project + repos +
// their markdown + each repo's routing PR, then feeds the shared
// <DocumentsApp/>. Repos with no active PR get no commentApi (writes fall
// back to LocalOnly behind a banner).

/* eslint-disable max-lines -- Holds only the DocumentsHubApp component, itself a documented exception, plus its imports; its logic lives in tested hub modules. */

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import {
    GitVersionOptions,
    GitVersionType,
    type GitPullRequest,
} from "azure-devops-extension-api/Git";

import type { CommentAuthor, CommentThread } from "../types";
import { AdoCommentApi } from "../shell/adoCommentApi";
import type { CommentApi } from "../comments/api";
import { checkRepoCommentPermission } from "../shell/commentPermission";
import { resolveAdoRepositoryImageObjectUrl } from "../shell/adoRepositoryImages";

import { DocumentsApp } from "./DocumentsApp";
import { AvatarImageContext } from "../shell/components/Avatar";
import type { RoutedPrInfo } from "../shell/Shell";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { buildReposFileUrl } from "../markdown/docLinks";
import type { DocPrRef } from "../shell/shellHelpers";
import { markAppReady, trackUserFacingError } from "../telemetry";
import { t } from "../i18n";
import {
    buildPrUrl,
    fetchRepoPage,
    fetchBlobText,
    fetchRepoFileContent,
    findRoutingPrForDoc,
    listFolderMarkdown,
    listSubpageFolder,
    loadDocPrHistory,
    loadThreadsForRepo,
    loadThreadsForRoutedPr,
    refreshRepoDiscovery,
    resolveAdoAvatarObjectUrl,
    searchRepoFiles,
    type RepoPage,
} from "../shell/adoGitData";
import { ANCHOR_LINK_PARAM, COMMENT_LINK_PARAM, TEXT_LINK_PARAM } from "../shell/deepLink";
import type { DocRepo, FolderListing } from "../shell/types";
import type { FileSearchOutcome } from "../shell/almSearch";
import { writeLastPath, writeLastRepo } from "./lastVisited";
import { formatError, routeUpdatesForPath } from "./documentsHub.helpers";
import {
    REPO_PAGE_SIZE,
    discoverHub,
    type DiscoveryState,
    type PickerState,
    type RepoDetailsLoadState,
} from "./hubDiscovery";
import {
    buildHubDeepLinkUrl,
    openInNewTab,
    readCurrentUser,
    hubBackLinkFor,
    resolveOrgUrl,
    setRouteQuery,
} from "./hubNavigation";
import { withRepoDetails, withRepoDetailsLoaded, withoutKeyPrefix } from "./hubRepoState";

// eslint-disable-next-line max-lines-per-function -- Hub root inside the Azure DevOps SDK: boot, repo discovery, routing and deep links feeding one Shell. Logic is extracted to tested modules; what remains is the wiring that only runs in the host.
export function DocumentsHubApp(): ReactElement {
    const [state, setState] = useState<DiscoveryState | null>(null);
    const [user, setUser] = useState<CommentAuthor | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Picker pagination/filter view. `viewIds` is the ordered set of repo ids
    // currently shown in the dropdown (the full first page, or the server-side
    // filter result). `token` is the continuation token for the *current* view
    // (unfiltered or filtered); `hasMore` mirrors whether `token` is non-null.
    // The union of every repo we've fetched lives in `state.repos` so a selected
    // repo never vanishes when the filtered view changes underneath it.
    const [picker, setPicker] = useState<PickerState>({
        viewIds: [],
        filter: "",
        token: null,
        hasMore: false,
        loading: false,
    });

    // Per-document comment routing. Each document's comments live on the most
    // recent COMPLETED PR that changed it (resolved lazily, cached here). This
    // replaces the old per-doc "housing PR" model so the hub needs no
    // vso.code_write scope. An absent key = unresolved; `null` = resolved with
    // no PR found; a PR = the resolved comment home.
    const [routingPrByPath, setRoutingPrByPath] = useState<Record<string, GitPullRequest | null>>(
        {},
    );

    // Per-repo PR-routing load state. Held in a ref so concurrent
    // `loadDetailsFor` calls dedupe without a re-render race; mirrored into
    // `state.repos[i].detailsLoaded` so DocumentsApp can gate on it.
    const detailsStatusRef = useRef<Map<string, RepoDetailsLoadState>>(new Map());

    // Mirror of `state` so `loadDetailsFor` reads the latest projectId /
    // rawRepoById without changing the callback identity every render.
    //
    // CRITICAL: assigned during render, not in a `useEffect`. Parent effects
    // fire after child effects, so with useEffect the DocumentsApp effect would
    // call `loadDetailsFor` while `stateRef.current` was still `null` and the
    // load would never complete. Assigning during render is the React-documented
    // pattern for mirroring state into a ref for downstream callbacks.
    const stateRef = useRef<DiscoveryState | null>(null);
    // eslint-disable-next-line react-hooks/refs -- latest-value mirror must be set during render: child effects call loadDetailsFor before this component's effects run (see CRITICAL above).
    stateRef.current = state;

    // Mirror of the picker view so the (stable-identity) load-more / filter
    // handlers read the latest token + filter without re-subscribing.
    const pickerRef = useRef<PickerState>(picker);
    // eslint-disable-next-line react-hooks/refs -- latest-value mirror set during render, like stateRef, so handlers invoked from child effects never see a stale picker.
    pickerRef.current = picker;
    // Monotonic id stamped on each filter request so a slow earlier query can't
    // clobber the results of a newer keystroke (last-write-wins by sequence).
    const filterSeqRef = useRef(0);

    // Mirror of routing resolutions so the async resolver (stable identity)
    // reads the latest cache without re-subscribing.
    const routingPrByPathRef = useRef(routingPrByPath);
    // eslint-disable-next-line react-hooks/refs -- latest-value mirror set during render, like stateRef, so the resolver invoked from child effects reads the current cache.
    routingPrByPathRef.current = routingPrByPath;

    // Per-(repo, path) comment-API + in-flight caches for per-document routing.
    // Declared up here so `refreshRepo` can invalidate them. Keys use a NUL
    // separator (illegal in repo ids and paths) to avoid collisions.
    const pathApiCacheRef = useRef<Map<string, CommentApi>>(new Map());
    // De-dupe concurrent routing lookups for the same document.
    const routingInFlightRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        void (async () => {
            try {
                const log = (step: string) => {
                    // eslint-disable-next-line no-console -- boot step trace in the host DevTools console, for diagnosing hub boot problems in a real org
                    console.log(`[DocumentsHubApp] ${step}`);
                };

                const { discovery, picker: initialPicker } = await discoverHub(log);

                setState(discovery);
                setPicker(initialPicker);

                log("reading current user");
                setUser(readCurrentUser());

                log("ready");
            } catch (err: unknown) {
                console.error("[DocumentsHubApp] discovery failed", err);
                trackUserFacingError({
                    error: err,
                    source: "DocumentsHubApp.discovery",
                    operation: "repository-discovery",
                    impact: "blocking",
                });
                setError(formatError(err));
            }
        })();
    }, []);

    // Per-repo deferred PR-routing load. Triggered by DocumentsApp the first
    // time the user selects a repo. Dedupes concurrent calls via the ref.
    const loadDetailsFor = useCallback(async (repoId: string): Promise<void> => {
        const status = detailsStatusRef.current.get(repoId) ?? "idle";
        if (status === "loading" || status === "loaded") return;
        detailsStatusRef.current.set(repoId, "loading");

        const snapshot = stateRef.current;
        const rawRepo = snapshot?.rawRepoById.get(repoId);
        const projectId = snapshot?.projectId ?? "";

        if (!rawRepo || !projectId) {
            detailsStatusRef.current.set(repoId, "idle");

            return;
        }

        try {
            // The repo arrived from the picker as a content-less skeleton, so this
            // first selection resolves what the document view needs to paint: the
            // root markdown listing + PR routing, and the Contribute-permission
            // probe. They're independent, so fire them concurrently — selection
            // latency is the slower of the two, not their sum.
            const [details, perm] = await Promise.all([
                refreshRepoDiscovery(rawRepo, projectId),
                checkRepoCommentPermission(resolveOrgUrl(), projectId, repoId),
            ]);

            detailsStatusRef.current.set(repoId, "loaded");
            setState((curr) => withRepoDetails(curr, repoId, details, perm.canComment));
        } catch (err) {
            console.warn(`[DocumentsHubApp] PR routing failed for ${repoId}:`, err);
            trackUserFacingError({
                error: err,
                source: "DocumentsHubApp.repository",
                operation: "repository-details-load",
                impact: "degraded",
            });
            detailsStatusRef.current.set(repoId, "error");
            // Still mark `detailsLoaded: true` so the shell stops waiting — the
            // read-only banner then surfaces the no-PR state.
            setState((curr) => withRepoDetailsLoaded(curr, repoId, true));
        }
    }, []);

    // User-initiated refresh: re-run root listing + PR routing in parallel.
    // While in flight, `detailsLoaded` flips back to `false` so DocumentsApp
    // tears down threads/Shell and shows a loading state.
    const refreshRepo = useCallback(async (repoId: string): Promise<void> => {
        const snapshot = stateRef.current;
        const rawRepo = snapshot?.rawRepoById.get(repoId);
        const projectId = snapshot?.projectId ?? "";
        if (!rawRepo || !projectId) return;

        // Flip back to "loading" so DocumentsApp's effects gate on it.
        detailsStatusRef.current.set(repoId, "loading");
        setState((curr) => withRepoDetailsLoaded(curr, repoId, false));

        try {
            const [details, perm] = await Promise.all([
                refreshRepoDiscovery(rawRepo, projectId),
                checkRepoCommentPermission(resolveOrgUrl(), projectId, repoId),
            ]);

            // Drop any cached commentApi so a new PR target gets a fresh instance.
            apiCacheRef.current.delete(repoId);
            // Also invalidate per-document routing for this repo so each doc
            // re-resolves to any newly completed PR after refresh (otherwise an
            // already-resolved path keeps writing to its stale cached PR target).
            const keyPrefix = `${repoId}\u0000`;
            pathApiCacheRef.current.forEach((_api, key) => {
                if (key.startsWith(keyPrefix)) {
                    pathApiCacheRef.current.delete(key);
                }
            });
            routingInFlightRef.current.forEach((key) => {
                if (key.startsWith(keyPrefix)) {
                    routingInFlightRef.current.delete(key);
                }
            });
            setRoutingPrByPath((prev) => withoutKeyPrefix(prev, keyPrefix));
            detailsStatusRef.current.set(repoId, "loaded");
            setState((curr) => withRepoDetails(curr, repoId, details, perm.canComment));
        } catch (err) {
            console.warn(`[DocumentsHubApp] refresh failed for ${repoId}:`, err);
            trackUserFacingError({
                error: err,
                source: "DocumentsHubApp.repository",
                operation: "repository-refresh",
                impact: "action-failed",
            });
            detailsStatusRef.current.set(repoId, "error");
            setState((curr) => withRepoDetailsLoaded(curr, repoId, true));
        }
    }, []);

    // Merge a freshly-fetched page into the union without duplicating repos we
    // already hold (the deep-link / last-repo repo, or an earlier filter match).
    const mergeRepos = useCallback((page: RepoPage): void => {
        setState((curr) => {
            if (!curr) return curr;
            const known = new Set(curr.repos.map((r) => r.id));
            const added = page.repos.filter((r) => !known.has(r.id));

            const rawRepoById =
                page.rawRepoById.size > 0 ? new Map(curr.rawRepoById) : curr.rawRepoById;

            page.rawRepoById.forEach((raw, id) => rawRepoById.set(id, raw));

            return added.length === 0 && rawRepoById === curr.rawRepoById
                ? curr
                : { ...curr, repos: [...curr.repos, ...added], rawRepoById };
        });
    }, []);

    // Picker "load more": fetch the next page for the CURRENT view (filtered or
    // not), append its ids and roll the continuation token forward. Deduped via
    // the in-flight `loading` flag mirrored in `pickerRef`.
    const loadMoreRepos = useCallback(async (): Promise<void> => {
        const snapshot = stateRef.current;
        const cur = pickerRef.current;

        if (!snapshot || cur.loading || !cur.hasMore || cur.token === null) {
            return;
        }

        setPicker((p) => ({ ...p, loading: true }));

        try {
            const page = await fetchRepoPage(snapshot.projectId, {
                filter: cur.filter,
                continuationToken: cur.token,
                top: REPO_PAGE_SIZE,
            });

            mergeRepos(page);
            setPicker((p) => {
                // The filter may have changed while this page was in flight; if so,
                // discard these results rather than mixing views.
                if (p.filter !== cur.filter) return p;
                const seen = new Set(p.viewIds);

                const nextIds = page.repos.map((r) => r.id).filter((id) => !seen.has(id));

                return {
                    ...p,
                    viewIds: [...p.viewIds, ...nextIds],
                    token: page.continuationToken,
                    hasMore: page.continuationToken !== null,
                    loading: false,
                };
            });
        } catch (err) {
            console.warn("[DocumentsHubApp] load more repos failed:", err);
            trackUserFacingError({
                error: err,
                source: "DocumentsHubApp.picker",
                operation: "repository-page-load",
                impact: "action-failed",
            });
            setPicker((p) => {
                // If the filter changed while this request was in flight, don't let
                // this older failure clobber the newer filtered view's pagination.
                if (p.filter !== cur.filter) return p;

                return { ...p, loading: false, hasMore: false };
            });
        }
    }, [mergeRepos]);

    // Picker keyword filter: re-query page one with a server-side `filterContains`
    // and REPLACE the view (the union keeps growing so the selected repo never
    // disappears). A per-request sequence guards against out-of-order keystrokes.
    const filterRepos = useCallback(
        async (keyword: string): Promise<void> => {
            const snapshot = stateRef.current;
            if (!snapshot) return;
            const trimmed = keyword.trim();
            const seq = ++filterSeqRef.current;
            setPicker((p) => ({ ...p, filter: trimmed, loading: true }));

            try {
                const page = await fetchRepoPage(snapshot.projectId, {
                    filter: trimmed,
                    top: REPO_PAGE_SIZE,
                });

                if (seq !== filterSeqRef.current) return; // a newer keystroke won
                mergeRepos(page);
                setPicker((p) => ({
                    ...p,
                    filter: trimmed,
                    viewIds: page.repos.map((r) => r.id),
                    token: page.continuationToken,
                    hasMore: page.continuationToken !== null,
                    loading: false,
                }));
            } catch (err) {
                if (seq !== filterSeqRef.current) return;

                console.warn("[DocumentsHubApp] filter repos failed:", err);
                trackUserFacingError({
                    error: err,
                    source: "DocumentsHubApp.picker",
                    operation: "repository-filter",
                    impact: "action-failed",
                });
                setPicker((p) => ({ ...p, loading: false, hasMore: false }));
            }
        },
        [mergeRepos],
    );

    // ---- per-repo loaders + commentApi factories ----

    const loadFileSource = useCallback(
        async (repoId: string, path: string, objectId?: string): Promise<string> => {
            if (!state) throw new Error("project not loaded yet");
            const repo = state.repos.find((r) => r.id === repoId);
            if (!repo) throw new Error(`Unknown repo ${repoId}`);

            // The listed blob, exactly (it is cached under its id); else the tip.
            return objectId !== undefined && objectId !== ""
                ? fetchBlobText(repo.id, state.projectId, objectId)
                : fetchRepoFileContent(repo, state.projectId, path);
        },
        [state],
    );

    const resolveDocumentImage = useCallback(
        async (
            repoId: string,
            _documentPath: string,
            repositoryPath: string,
            atCommitId?: string,
        ): Promise<string | undefined> => {
            const snapshot = stateRef.current;
            const repo = snapshot?.repos.find((item) => item.id === repoId);
            if (!snapshot || !repo) return undefined;

            const versionDescriptor =
                atCommitId !== undefined && atCommitId !== ""
                    ? {
                          version: atCommitId,
                          versionType: GitVersionType.Commit,
                          versionOptions: GitVersionOptions.None,
                      }
                    : {
                          version: repo.defaultBranch,
                          versionType: GitVersionType.Branch,
                          versionOptions: GitVersionOptions.None,
                      };

            return resolveAdoRepositoryImageObjectUrl({
                repositoryId: repoId,
                project: snapshot.projectId,
                path: repositoryPath,
                versionDescriptor,
            });
        },
        [],
    );

    const loadThreadsFor = useCallback(
        async (repoId: string): Promise<CommentThread[]> => {
            if (!state) return [];

            return loadThreadsForRepo(repoId, state.projectId, state.prByRepo);
        },
        [state],
    );

    // Lazy folder expansion. Called the first time the user opens an
    // unenumerated folder; backed by `getItems(scopePath, OneLevel)`.
    const expandFolder = useCallback(
        async (repoId: string, path: string): Promise<FolderListing> => {
            if (!state) return { files: [], folders: [] };
            const repo = state.repos.find((r) => r.id === repoId);
            if (!repo) return { files: [], folders: [] };

            return listFolderMarkdown(repo, state.projectId, path);
        },
        [state],
    );

    // A wiki page's subpage folder, for its `[[_TOSP_]]` table: at the given
    // commit for a historical version, else the default branch (a missing
    // folder lists as empty — the page simply has no subpages).
    const listSubpages = useCallback(
        async (repoId: string, folderPath: string, atCommitId?: string): Promise<FolderListing> => {
            if (!state) return { files: [], folders: [] };
            const repo = state.repos.find((r) => r.id === repoId);
            if (!repo) return { files: [], folders: [] };

            return listSubpageFolder(repo, state.projectId, folderPath, atCommitId);
        },
        [state],
    );

    // ALM Code Search-backed filename search. Returns a `FileSearchOutcome` so
    // the DocNav can render a "Code Search isn't installed" hint on failure.
    const searchFiles = useCallback(
        async (repoId: string, query: string, signal?: AbortSignal): Promise<FileSearchOutcome> => {
            if (!state) return { kind: "ok", files: [] };
            const repo = state.repos.find((r) => r.id === repoId);
            if (!repo) return { kind: "ok", files: [] };

            return searchRepoFiles(repo, state.projectName, query, signal);
        },
        [state],
    );

    // Cache constructed AdoCommentApi instances per repo so Shell sees
    // a stable identity across renders.
    const apiCacheRef = useRef<Map<string, CommentApi>>(new Map());

    const commentApiFor = useCallback(
        (repoId: string): CommentApi | undefined => {
            if (!state) return undefined;
            const cached = apiCacheRef.current.get(repoId);
            if (cached) return cached;
            const pr = state.prByRepo[repoId];
            if (!pr || typeof pr.pullRequestId !== "number") return undefined;

            const api = new AdoCommentApi({
                repositoryId: repoId,
                pullRequestId: pr.pullRequestId,
                project: state.projectId,
                backLinkFor: hubBackLinkFor(state.projectName, repoId),
            });

            apiCacheRef.current.set(repoId, api);

            return api;
        },
        [state],
    );

    // ---- per-document comment routing (read PRs + write threads only) ----
    //
    // A document's comments live on the most recent COMPLETED PR that changed
    // it, resolved lazily on first open. This replaces the old "housing PR"
    // model (which created/abandoned a draft PR per doc and needed
    // vso.code_write); routing only reads PRs and writes comment threads.

    // Resolve (and cache) the routing PR for a document. Idempotent: once a key
    // is resolved it's served from the cache; concurrent first-time lookups are
    // de-duped so we don't scan the PR history twice.
    const resolveRoutingPrForPath = useCallback(
        async (repoId: string, path: string): Promise<GitPullRequest | null> => {
            const key = `${repoId}\u0000${path}`;

            if (key in routingPrByPathRef.current) {
                return routingPrByPathRef.current[key] ?? null;
            }

            const snapshot = stateRef.current;
            const rawRepo = snapshot?.rawRepoById.get(repoId);
            if (!snapshot || !rawRepo) return null;
            if (routingInFlightRef.current.has(key)) return null;
            routingInFlightRef.current.add(key);

            try {
                const pr = await findRoutingPrForDoc(rawRepo, snapshot.projectId, path);

                setRoutingPrByPath((prev) => ({ ...prev, [key]: pr }));

                return pr;
            } finally {
                routingInFlightRef.current.delete(key);
            }
        },
        [],
    );

    const commentApiForPath = useCallback(
        (repoId: string, path: string): CommentApi | undefined => {
            const key = `${repoId}\u0000${path}`;
            const cached = pathApiCacheRef.current.get(key);
            if (cached) return cached;
            // The routing PR is resolved lazily by loadThreadsForPath. Until it
            // lands, return undefined so Shell uses its read-only session stub;
            // this callback's identity changes when routingPrByPath updates, so the
            // write-capable api is adopted on the next render.
            const pr = routingPrByPath[key];
            const snapshot = stateRef.current;

            if (!pr || typeof pr.pullRequestId !== "number" || !snapshot) {
                return undefined;
            }

            const api = new AdoCommentApi({
                repositoryId: repoId,
                pullRequestId: pr.pullRequestId,
                project: snapshot.projectId,
                backLinkFor: hubBackLinkFor(snapshot.projectName, repoId),
            });

            pathApiCacheRef.current.set(key, api);

            return api;
        },
        [routingPrByPath],
    );

    const loadThreadsForPath = useCallback(
        async (repoId: string, path: string): Promise<CommentThread[]> => {
            const snapshot = stateRef.current;
            if (!snapshot) return [];
            const pr = await resolveRoutingPrForPath(repoId, path);
            if (!pr || typeof pr.pullRequestId !== "number") return [];

            return loadThreadsForRoutedPr(repoId, snapshot.projectId, pr.pullRequestId, path);
        },
        [resolveRoutingPrForPath],
    );

    // Routed-PR pill for the selected document. Reads the resolved routing PR
    // from the cache (populated by `loadThreadsForPath`) and projects it onto
    // the shell's `RoutedPrInfo`, so the rail can show "Comments (PR #N)" linking
    // to where the comments live. `findRoutingPrForDoc` only ever returns
    // completed PRs, so the status is always "completed". Undefined until the
    // routing PR resolves (the pill stays hidden meanwhile); the callback's
    // identity changes when `routingPrByPath` updates, so the pill appears on the
    // next render once routing lands.
    const routedPrForPath = useCallback(
        (repoId: string, path: string): RoutedPrInfo | null | undefined => {
            const key = `${repoId}\u0000${path}`;
            if (!(key in routingPrByPath)) return undefined;
            const pr = routingPrByPath[key];
            if (!pr || typeof pr.pullRequestId !== "number") return null;
            const rawRepo = stateRef.current?.rawRepoById.get(repoId);

            return {
                prId: pr.pullRequestId,
                // `title` is typed required but can be absent from the ADO REST payload.
                title:
                    (pr.title as string | undefined) ??
                    t("hub.pr.titleFallback", { id: pr.pullRequestId }),
                status: "completed",
                url: rawRepo ? buildPrUrl(rawRepo, pr.pullRequestId) : undefined,
            };
        },
        [routingPrByPath],
    );

    // ---- comment-history stepper loaders ----
    // List a document's completed-PR history (most recent first) for the rail's
    // ‹ › chevrons. Degrades to [] (no history) when the repo isn't resolved.
    const loadDocHistory = useCallback(
        async (repoId: string, path: string): Promise<DocPrRef[]> => {
            const snapshot = stateRef.current;
            const rawRepo = snapshot?.rawRepoById.get(repoId);
            if (!snapshot || !rawRepo) return [];

            return loadDocPrHistory(rawRepo, snapshot.projectId, path);
        },
        [],
    );

    // Read a historical PR's threads for the file (read-only stop view).
    const loadThreadsForPr = useCallback(
        async (repoId: string, prId: number, path: string): Promise<CommentThread[]> => {
            const snapshot = stateRef.current;
            if (!snapshot) return [];

            return loadThreadsForRoutedPr(repoId, snapshot.projectId, prId, path);
        },
        [],
    );

    // Read the document's Markdown source at a specific commit (a history stop).
    const loadFileSourceAt = useCallback(
        async (repoId: string, path: string, commitId: string): Promise<string> => {
            const snapshot = stateRef.current;
            const repo = snapshot?.repos.find((r) => r.id === repoId);
            if (!snapshot || !repo) return "";

            return fetchRepoFileContent(repo, snapshot.projectId, path, commitId);
        },
        [],
    );

    // Boot-time completion for terminal states that never mount DocumentsApp /
    // Shell (which would otherwise fire the "content" signal): a discovery
    // error, or a project with no repositories. Without this the boot event would
    // silently never fire for those sessions. Idempotent + no-ops outside a real
    // boot; if content later renders, Shell's "content" already won.
    const noRepos = !!state && state.repos.length === 0;
    useEffect(() => {
        if (error !== null && error !== "") markAppReady("error");
        else if (noRepos) markAppReady("empty");
    }, [error, noRepos]);

    if (error !== null && error !== "") {
        return (
            <div className="emr-error">
                <h2>{t("hub.docs.loadFailed")}</h2>
                <pre>{error}</pre>
            </div>
        );
    }

    if (!state || !user) {
        return (
            <div className="emr-docs-app">
                <ReaderLoadingShell scope="hub" ariaLabel={t("hub.docs.loading")} />
            </div>
        );
    }

    if (state.repos.length === 0) {
        return (
            <div className="emr-error" style={{ color: "var(--emr-muted)" }}>
                <h2>{t("hub.docs.noReposFound.title")}</h2>
                <p>{t("hub.docs.noReposFound.body")}</p>
            </div>
        );
    }

    // Ordered repo list for the picker dropdown: the current (filtered or full)
    // view, resolved from the accumulated union. Falls back to the union order
    // if the view hasn't been seeded yet.
    const repoById = new Map(state.repos.map((r) => [r.id, r]));

    const repoPickerView =
        picker.viewIds.length > 0
            ? picker.viewIds
                  .map((id) => repoById.get(id))
                  .filter((r): r is DocRepo => r !== undefined)
            : state.repos;

    return (
        <AvatarImageContext.Provider value={resolveAdoAvatarObjectUrl}>
            <DocumentsApp
                repos={state.repos}
                repoPickerView={repoPickerView}
                repoFilter={picker.filter}
                reposHasMore={picker.hasMore}
                reposLoading={picker.loading}
                onLoadMoreRepos={loadMoreRepos}
                onFilterRepos={filterRepos}
                initialRepoId={state.initialRepoId}
                loadFileSource={loadFileSource}
                resolveDocumentImage={resolveDocumentImage}
                loadThreadsFor={loadThreadsFor}
                commentApiFor={commentApiFor}
                commentApiForPath={commentApiForPath}
                loadThreadsForPath={loadThreadsForPath}
                routedPrForPath={routedPrForPath}
                loadDocHistory={loadDocHistory}
                loadThreadsForPr={loadThreadsForPr}
                loadFileSourceAt={loadFileSourceAt}
                currentUser={user}
                onExpandFolder={expandFolder}
                onListSubpageFolder={listSubpages}
                onSearchFiles={searchFiles}
                onLoadRepoDetails={loadDetailsFor}
                onRefreshRepo={refreshRepo}
                orgUrl={resolveOrgUrl()}
                projectName={state.projectName}
                initialSelectedPath={state.initialSelectedPath}
                initialActiveThreadId={state.initialActiveThreadId}
                initialAnchor={state.initialAnchor}
                initialTextFragment={state.initialTextFragment}
                buildDeepLink={(repoId, path, target) =>
                    buildHubDeepLinkUrl(
                        {
                            orgUrl: resolveOrgUrl(),
                            projectName: state.projectName,
                            repoId,
                            path,
                        },
                        target,
                    )
                }
                onSelectPath={(repoId, path) => {
                    // Remember the document so a return visit reopens it (scoped per repo).
                    writeLastPath(state.projectId, repoId, path);
                    // Pin repo + slash-free path (`?path=docs/x.md`, matching ADO's
                    // native Files experience) so the link round-trips; a heading
                    // anchor from the previous document is dropped (see helper).
                    void setRouteQuery((current) => routeUpdatesForPath(current, repoId, path));
                }}
                onSelectRepo={(repoId) => {
                    // Remember the choice so a return visit reopens the same repo.
                    writeLastRepo(state.projectId, repoId);
                    // Switching repos lands on a different document set, so the previous
                    // repo's `?path=`/`?comment=`/`?anchor=` deep link no longer applies.
                    // Clear them (empty value removes the param) and pin the new repo, so
                    // the URL never momentarily shows the new repo paired with the OLD
                    // repo's path. DocumentsApp's onSelectPath repopulates `?path=` once
                    // the new repo's first document resolves, keeping the URL consistent.
                    void setRouteQuery({
                        repo: repoId,
                        path: "",
                        [COMMENT_LINK_PARAM]: "",
                        [ANCHOR_LINK_PARAM]: "",
                        [TEXT_LINK_PARAM]: "",
                    });
                }}
                onActiveThreadChange={(_repoId, threadId) => {
                    // Mirror the active thread into `?comment=` so selecting a comment
                    // yields the same shareable deep link the "Link to comment" action
                    // builds. An empty value removes the param when nothing is active;
                    // an active comment supersedes any heading or text target.
                    void setRouteQuery(
                        threadId !== null && threadId !== ""
                            ? {
                                  [COMMENT_LINK_PARAM]: threadId,
                                  [ANCHOR_LINK_PARAM]: "",
                                  [TEXT_LINK_PARAM]: "",
                              }
                            : { [COMMENT_LINK_PARAM]: "" },
                    );
                }}
                onHeadingLinkCopied={(_repoId, anchor) => {
                    // Mirror a copied heading link into the address bar, as ADO's own
                    // Markdown preview does when its anchor glyph is clicked.
                    void setRouteQuery({
                        [ANCHOR_LINK_PARAM]: anchor,
                        [COMMENT_LINK_PARAM]: "",
                        [TEXT_LINK_PARAM]: "",
                    });
                }}
                onTextLinkCopied={(_repoId, text, anchor) => {
                    void setRouteQuery({
                        [TEXT_LINK_PARAM]: text,
                        [ANCHOR_LINK_PARAM]: anchor ?? "",
                        [COMMENT_LINK_PARAM]: "",
                    });
                }}
                onDocNavigate={(repoId, target) => {
                    // In the hub every Markdown link opens in place, so this only fires
                    // for a non-Markdown file: open it in ADO's native Files view in a
                    // new tab (at the repo's default branch, which the hub reads).
                    if (target.kind !== "repo-file") return;
                    const rawRepo = state.rawRepoById.get(repoId);
                    if (!rawRepo) return;
                    void openInNewTab(
                        buildReposFileUrl(
                            {
                                orgUrl: resolveOrgUrl(),
                                project: state.projectName,
                                repoName: rawRepo.name,
                            },
                            target.path,
                        ),
                    );
                }}
            />
        </AvatarImageContext.Provider>
    );
}
