// DocumentsHubApp — real-ADO top-level component for the Documents hub.
// Lives behind our own top-level hub-group contribution. Discovers the active
// project + repos +
// their markdown + each repo's routing PR, then feeds the shared
// <DocumentsApp/>. Repos with no active PR get no commentApi (writes fall
// back to LocalOnly behind a banner).

import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  type IHostNavigationService,
  type IProjectPageService,
} from "azure-devops-extension-api";
import {
  GitVersionOptions,
  GitVersionType,
  type GitPullRequest,
} from "azure-devops-extension-api/Git";

import type { CommentAuthor, CommentThread, FileInfo } from "../types";
import { AdoCommentApi } from "../shell/adoCommentApi";
import type { CommentApi } from "../comments/api";
import { checkRepoCommentPermission } from "../shell/commentPermission";
import { resolveAdoRepositoryImageObjectUrl } from "../shell/adoRepositoryImages";

import { DocumentsApp } from "./DocumentsApp";
import { AvatarImageContext } from "../shell/components/Avatar";
import type { RoutedPrInfo } from "../shell/PrShell";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { buildReposFileUrl } from "../markdown/docLinks";
import type { DocPrRef } from "../shell/prShellHelpers";
import { markAppReady, setTelemetryContext } from "../telemetry";
import {
  buildPrUrl,
  fetchRepoById,
  fetchRepoPage,
  fetchRepoFileContent,
  findRoutingPrForDoc,
  listFolderMarkdown,
  loadDocPrHistory,
  loadThreadsForRepo,
  loadThreadsForRoutedPr,
  refreshRepoDiscovery,
  resolveAdoAvatarObjectUrl,
  searchRepoFiles,
  type RepoPage,
} from "../shell/adoGitData";
import { identityAvatarUrl } from "../shell/adoGitData.helpers";
import { readCommentParam, COMMENT_LINK_PARAM } from "../comments/commentLink";
import type { DocRepo } from "../shell/types";
import type { FileSearchOutcome } from "../shell/almSearch";
import {
  readLastPath,
  readLastRepo,
  writeLastPath,
  writeLastRepo,
} from "./lastVisited";
import {
  assembleHubCommentUrl,
  formatError,
  initialsOf,
  orgUrlFromReferrer,
} from "./documentsHub.helpers";

type RepoDetailsLoadState = "idle" | "loading" | "loaded" | "error";

import type { GitRepository } from "azure-devops-extension-api/Git";

interface DiscoveryState {
  projectId: string;
  projectName: string;
  repos: DocRepo[];
  /** Repo to select on first render (the first repo with markdown). */
  initialRepoId: string;
  /**
   * Document to open on first render, from the `?path=` deep-link route.
   * Applies to the initial repo; undefined when no route was present.
   */
  initialSelectedPath?: string;
  /**
   * Thread to auto-open on first render, from the `?comment=` deep-link route.
   * Forwarded to DocumentsApp alongside `initialSelectedPath`.
   */
  initialActiveThreadId?: string;
  /** Resolved per-repo PR routing — populated lazily by `loadDetailsFor`. */
  prByRepo: Record<string, GitPullRequest | undefined>;
  /** Raw `GitRepository` payloads we need to feed `loadRepoPrRouting`. */
  rawRepoById: Map<string, GitRepository>;
}

/** Picker pagination/filter view state (see the `picker` useState comment). */
interface PickerState {
  /** Ordered repo ids currently displayed in the dropdown. */
  viewIds: string[];
  /** Active server-side name filter (empty = unfiltered). */
  filter: string;
  /** Continuation token for the current view; `null` when fully paged. */
  token: string | null;
  /** Whether another page can be fetched for the current view. */
  hasMore: boolean;
  /** A page (or filter) fetch is in flight. */
  loading: boolean;
}

/** Repos fetched per page as the user scrolls the picker. */
const REPO_PAGE_SIZE = 50;

export function DocumentsHubApp(): React.ReactElement {
  const [state, setState] = React.useState<DiscoveryState | null>(null);
  const [user, setUser] = React.useState<CommentAuthor | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Picker pagination/filter view. `viewIds` is the ordered set of repo ids
  // currently shown in the dropdown (the full first page, or the server-side
  // filter result). `token` is the continuation token for the *current* view
  // (unfiltered or filtered); `hasMore` mirrors whether `token` is non-null.
  // The union of every repo we've fetched lives in `state.repos` so a selected
  // repo never vanishes when the filtered view changes underneath it.
  const [picker, setPicker] = React.useState<PickerState>({
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
  const [routingPrByPath, setRoutingPrByPath] = React.useState<
    Record<string, GitPullRequest | null>
  >({});
  // Per-repo PR-routing load state. Held in a ref so concurrent
  // `loadDetailsFor` calls dedupe without a re-render race; mirrored into
  // `state.repos[i].detailsLoaded` so DocumentsApp can gate on it.
  const detailsStatusRef = React.useRef<Map<string, RepoDetailsLoadState>>(
    new Map(),
  );
  // Mirror of `state` so `loadDetailsFor` reads the latest projectId /
  // rawRepoById without changing the callback identity every render.
  //
  // CRITICAL: assigned during render, not in a `useEffect`. Parent effects
  // fire after child effects, so with useEffect the DocumentsApp effect would
  // call `loadDetailsFor` while `stateRef.current` was still `null` and the
  // load would never complete. Assigning during render is the React-documented
  // pattern for mirroring state into a ref for downstream callbacks.
  const stateRef = React.useRef<DiscoveryState | null>(null);
  stateRef.current = state;

  // Mirror of the picker view so the (stable-identity) load-more / filter
  // handlers read the latest token + filter without re-subscribing.
  const pickerRef = React.useRef<PickerState>(picker);
  pickerRef.current = picker;
  // Monotonic id stamped on each filter request so a slow earlier query can't
  // clobber the results of a newer keystroke (last-write-wins by sequence).
  const filterSeqRef = React.useRef(0);

  // Mirror of routing resolutions so the async resolver (stable identity)
  // reads the latest cache without re-subscribing.
  const routingPrByPathRef = React.useRef(routingPrByPath);
  routingPrByPathRef.current = routingPrByPath;

  // Per-(repo, path) comment-API + in-flight caches for per-document routing.
  // Declared up here so `refreshRepo` can invalidate them. Keys use a NUL
  // separator (illegal in repo ids and paths) to avoid collisions.
  const pathApiCacheRef = React.useRef<Map<string, CommentApi>>(new Map());
  // De-dupe concurrent routing lookups for the same document.
  const routingInFlightRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    void (async () => {
      try {
        const log = (step: string) => {
          // eslint-disable-next-line no-console
          console.log(`[DocumentsHubApp] ${step}`);
        };

        log("getting project page service");
        const projectService = await SDK.getService<IProjectPageService>(
          CommonServiceIds.ProjectPageService,
        );
        log("loading project");
        const project = await projectService.getProject();
        if (!project) throw new Error("No active project on the page.");
        log(`project: ${project.name}`);

        // De-identified telemetry context: project GUID only, never the name.
        setTelemetryContext({ projectId: project.id });

        // A third-party hub is never handed the repo the user had selected in
        // Repos, so we page in the project's repos and let the in-hub picker
        // choose. The first page (plus the user + route params) is all we need
        // to render; the rest stream in as the user scrolls or filters.
        log("fetching first repo page + route params");
        const [firstPage, routeParams] = await Promise.all([
          fetchRepoPage(project.id, { top: REPO_PAGE_SIZE }),
          readRouteParams(),
        ]);
        log(`first page: ${firstPage.repos.length} repo(s)`);

        // Accumulated union of every repo we've fetched, keyed for dedupe.
        const repos = [...firstPage.repos];
        const rawRepoById = new Map(firstPage.rawRepoById);

        // Resolve which repo opens first: a deep link wins, else the
        // last-visited repo for this project, else the first repo on page one.
        // The first two may live beyond page one, so fetch them by id and fold
        // them into the union (and to the front of the view) when missing.
        const routedRepoId = routeParams.repo;
        const lastRepoId = readLastRepo(project.id);
        const preferredId = routedRepoId || lastRepoId;
        let resolvedRepoId = firstPage.repos[0]?.id ?? "";
        if (preferredId) {
          if (repos.some((r) => r.id === preferredId)) {
            resolvedRepoId = preferredId;
          } else {
            const fetched = await fetchRepoById(project.id, preferredId);
            if (fetched) {
              repos.unshift(fetched.repo);
              rawRepoById.set(fetched.repo.id, fetched.raw);
              resolvedRepoId = fetched.repo.id;
            }
          }
        }

        const routedPath = routeParams.path;
        // The route stores a slash-free path (`docs/x.md`) to match ADO's
        // Files URLs; downstream code expects the repo-rooted form. A deep link
        // wins; otherwise reopen the repo's last-visited document, if any.
        const initialSelectedPath = routedPath
          ? `/${routedPath.replace(/^\/+/, "")}`
          : readLastPath(project.id, resolvedRepoId);
        const initialActiveThreadId = readCommentParam(routeParams);

        // Seed the cache from wherever we landed so a later root-URL visit
        // restores it. Without this, a deep link (`?repo=…&path=…`) never
        // updates the cache — the initial repo/path don't flow through the
        // `onSelectRepo`/`onSelectPath` callbacks (those only fire on later
        // user-driven changes), so returning to `/` would fall back to the
        // first repo + default document instead of where the user last was.
        writeLastRepo(project.id, resolvedRepoId);
        if (initialSelectedPath) {
          writeLastPath(project.id, resolvedRepoId, initialSelectedPath);
        }

        setState({
          projectId: project.id,
          projectName: project.name,
          repos,
          prByRepo: {},
          rawRepoById,
          initialRepoId: resolvedRepoId,
          initialSelectedPath,
          initialActiveThreadId,
        });
        setPicker({
          viewIds: repos.map((r) => r.id),
          filter: "",
          token: firstPage.continuationToken,
          hasMore: firstPage.continuationToken !== null,
          loading: false,
        });

        log("reading current user");
        const u = SDK.getUser();
        setUser({
          id: u.id,
          displayName: u.displayName,
          initials: initialsOf(u.displayName),
          avatarUrl: identityAvatarUrl(u),
        });

        log("ready");
      } catch (err: unknown) {
        console.error("[DocumentsHubApp] discovery failed", err);
        setError(formatError(err));
      }
    })();
  }, []);

  // Per-repo deferred PR-routing load. Triggered by DocumentsApp the first
  // time the user selects a repo. Dedupes concurrent calls via the ref.
  const loadDetailsFor = React.useCallback(
    async (repoId: string): Promise<void> => {
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
        const [{ files, topLevelFolders, recentPr, pr }, perm] =
          await Promise.all([
            refreshRepoDiscovery(rawRepo, projectId),
            checkRepoCommentPermission(resolveOrgUrl(), projectId, repoId),
          ]);
        detailsStatusRef.current.set(repoId, "loaded");
        setState((curr) => {
          if (!curr) return curr;
          const nextRepos = curr.repos.map((r) =>
            r.id === repoId
              ? {
                  ...r,
                  files,
                  topLevelFolders,
                  recentPr,
                  detailsLoaded: true,
                  canComment: perm.canComment,
                }
              : r,
          );
          const nextPrByRepo = {
            ...curr.prByRepo,
            [repoId]: pr ?? undefined,
          };
          return { ...curr, repos: nextRepos, prByRepo: nextPrByRepo };
        });
      } catch (err) {
        console.warn(`[DocumentsHubApp] PR routing failed for ${repoId}:`, err);
        detailsStatusRef.current.set(repoId, "error");
        // Still mark `detailsLoaded: true` so the shell stops waiting — the
        // read-only banner then surfaces the no-PR state.
        setState((curr) => {
          if (!curr) return curr;
          const nextRepos = curr.repos.map((r) =>
            r.id === repoId ? { ...r, detailsLoaded: true } : r,
          );
          return { ...curr, repos: nextRepos };
        });
      }
    },
    [],
  );

  // User-initiated refresh: re-run root listing + PR routing in parallel.
  // While in flight, `detailsLoaded` flips back to `false` so DocumentsApp
  // tears down threads/PrShell and shows a loading state.
  const refreshRepo = React.useCallback(
    async (repoId: string): Promise<void> => {
      const snapshot = stateRef.current;
      const rawRepo = snapshot?.rawRepoById.get(repoId);
      const projectId = snapshot?.projectId ?? "";
      if (!rawRepo || !projectId) return;

      // Flip back to "loading" so DocumentsApp's effects gate on it.
      detailsStatusRef.current.set(repoId, "loading");
      setState((curr) => {
        if (!curr) return curr;
        const nextRepos = curr.repos.map((r) =>
          r.id === repoId ? { ...r, detailsLoaded: false } : r,
        );
        return { ...curr, repos: nextRepos };
      });

      try {
        const [{ files, topLevelFolders, recentPr, pr }, perm] =
          await Promise.all([
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
          if (key.startsWith(keyPrefix)) pathApiCacheRef.current.delete(key);
        });
        routingInFlightRef.current.forEach((key) => {
          if (key.startsWith(keyPrefix)) routingInFlightRef.current.delete(key);
        });
        setRoutingPrByPath((prev) => {
          let changed = false;
          const next: typeof prev = {};
          for (const [key, value] of Object.entries(prev)) {
            if (key.startsWith(keyPrefix)) {
              changed = true;
              continue;
            }
            next[key] = value;
          }
          return changed ? next : prev;
        });
        detailsStatusRef.current.set(repoId, "loaded");
        setState((curr) => {
          if (!curr) return curr;
          const nextRepos = curr.repos.map((r) =>
            r.id === repoId
              ? {
                  ...r,
                  files,
                  topLevelFolders,
                  recentPr,
                  detailsLoaded: true,
                  canComment: perm.canComment,
                }
              : r,
          );
          const nextPrByRepo = {
            ...curr.prByRepo,
            [repoId]: pr ?? undefined,
          };
          return { ...curr, repos: nextRepos, prByRepo: nextPrByRepo };
        });
      } catch (err) {
        console.warn(`[DocumentsHubApp] refresh failed for ${repoId}:`, err);
        detailsStatusRef.current.set(repoId, "error");
        setState((curr) => {
          if (!curr) return curr;
          const nextRepos = curr.repos.map((r) =>
            r.id === repoId ? { ...r, detailsLoaded: true } : r,
          );
          return { ...curr, repos: nextRepos };
        });
      }
    },
    [],
  );

  // Merge a freshly-fetched page into the union without duplicating repos we
  // already hold (the deep-link / last-repo repo, or an earlier filter match).
  const mergeRepos = React.useCallback((page: RepoPage): void => {
    setState((curr) => {
      if (!curr) return curr;
      const known = new Set(curr.repos.map((r) => r.id));
      const added = page.repos.filter((r) => !known.has(r.id));
      const rawRepoById =
        page.rawRepoById.size > 0
          ? new Map(curr.rawRepoById)
          : curr.rawRepoById;
      page.rawRepoById.forEach((raw, id) => rawRepoById.set(id, raw));
      return added.length === 0 && rawRepoById === curr.rawRepoById
        ? curr
        : { ...curr, repos: [...curr.repos, ...added], rawRepoById };
    });
  }, []);

  // Picker "load more": fetch the next page for the CURRENT view (filtered or
  // not), append its ids and roll the continuation token forward. Deduped via
  // the in-flight `loading` flag mirrored in `pickerRef`.
  const loadMoreRepos = React.useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    const cur = pickerRef.current;
    if (!snapshot || cur.loading || !cur.hasMore || cur.token === null) return;
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
        const nextIds = page.repos
          .map((r) => r.id)
          .filter((id) => !seen.has(id));
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
  const filterRepos = React.useCallback(
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
        setPicker((p) => ({ ...p, loading: false, hasMore: false }));
      }
    },
    [mergeRepos],
  );

  // ---- per-repo loaders + commentApi factories ----

  const loadFileSource = React.useCallback(
    async (repoId: string, path: string): Promise<string> => {
      if (!state) throw new Error("project not loaded yet");
      const repo = state.repos.find((r) => r.id === repoId);
      if (!repo) throw new Error(`Unknown repo ${repoId}`);
      return fetchRepoFileContent(repo, state.projectId, path);
    },
    [state],
  );
  const resolveDocumentImage = React.useCallback(
    async (
      repoId: string,
      _documentPath: string,
      repositoryPath: string,
      atCommitId?: string,
    ): Promise<string | undefined> => {
      const snapshot = stateRef.current;
      const repo = snapshot?.repos.find((item) => item.id === repoId);
      if (!snapshot || !repo) return undefined;
      const versionDescriptor = atCommitId
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

  const loadThreadsFor = React.useCallback(
    async (repoId: string): Promise<CommentThread[]> => {
      if (!state) return [];
      return loadThreadsForRepo(repoId, state.projectId, state.prByRepo);
    },
    [state],
  );

  // Lazy folder expansion. Called the first time the user opens an
  // unenumerated folder; backed by `getItems(scopePath, OneLevel)`.
  const expandFolder = React.useCallback(
    async (
      repoId: string,
      path: string,
    ): Promise<{ files: FileInfo[]; folders: string[] }> => {
      if (!state) return { files: [], folders: [] };
      const repo = state.repos.find((r) => r.id === repoId);
      if (!repo) return { files: [], folders: [] };
      return listFolderMarkdown(repo, state.projectId, path);
    },
    [state],
  );

  // ALM Code Search-backed filename search. Returns a `FileSearchOutcome` so
  // the DocNav can render a "Code Search isn't installed" hint on failure.
  const searchFiles = React.useCallback(
    async (
      repoId: string,
      query: string,
      signal?: AbortSignal,
    ): Promise<FileSearchOutcome> => {
      if (!state) return { kind: "ok", files: [] };
      const repo = state.repos.find((r) => r.id === repoId);
      if (!repo) return { kind: "ok", files: [] };
      return searchRepoFiles(repo, state.projectName, query, signal);
    },
    [state],
  );

  // Cache constructed AdoCommentApi instances per repo so PrShell sees
  // a stable identity across renders.
  const apiCacheRef = React.useRef<Map<string, CommentApi>>(new Map());

  const commentApiFor = React.useCallback(
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
  const resolveRoutingPrForPath = React.useCallback(
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

  const commentApiForPath = React.useCallback(
    (repoId: string, path: string): CommentApi | undefined => {
      const key = `${repoId}\u0000${path}`;
      const cached = pathApiCacheRef.current.get(key);
      if (cached) return cached;
      // The routing PR is resolved lazily by loadThreadsForPath. Until it
      // lands, return undefined so PrShell uses its read-only session stub;
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
      });
      pathApiCacheRef.current.set(key, api);
      return api;
    },
    [routingPrByPath],
  );

  const loadThreadsForPath = React.useCallback(
    async (repoId: string, path: string): Promise<CommentThread[]> => {
      const snapshot = stateRef.current;
      if (!snapshot) return [];
      const pr = await resolveRoutingPrForPath(repoId, path);
      if (!pr || typeof pr.pullRequestId !== "number") return [];
      return loadThreadsForRoutedPr(
        repoId,
        snapshot.projectId,
        pr.pullRequestId,
        path,
      );
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
  const routedPrForPath = React.useCallback(
    (repoId: string, path: string): RoutedPrInfo | undefined => {
      const key = `${repoId}\u0000${path}`;
      const pr = routingPrByPath[key];
      if (!pr || typeof pr.pullRequestId !== "number") return undefined;
      const rawRepo = stateRef.current?.rawRepoById.get(repoId);
      return {
        prId: pr.pullRequestId,
        title: pr.title ?? `PR #${pr.pullRequestId}`,
        status: "completed",
        url: rawRepo ? buildPrUrl(rawRepo, pr.pullRequestId) : undefined,
      };
    },
    [routingPrByPath],
  );

  // ---- comment-history stepper loaders ----
  // List a document's completed-PR history (most recent first) for the rail's
  // ‹ › chevrons. Degrades to [] (no history) when the repo isn't resolved.
  const loadDocHistory = React.useCallback(
    async (repoId: string, path: string): Promise<DocPrRef[]> => {
      const snapshot = stateRef.current;
      const rawRepo = snapshot?.rawRepoById.get(repoId);
      if (!snapshot || !rawRepo) return [];
      return loadDocPrHistory(rawRepo, snapshot.projectId, path);
    },
    [],
  );

  // Read a historical PR's threads for the file (read-only stop view).
  const loadThreadsForPr = React.useCallback(
    async (
      repoId: string,
      prId: number,
      path: string,
    ): Promise<CommentThread[]> => {
      const snapshot = stateRef.current;
      if (!snapshot) return [];
      return loadThreadsForRoutedPr(repoId, snapshot.projectId, prId, path);
    },
    [],
  );

  // Read the document's Markdown source at a specific commit (a history stop).
  const loadFileSourceAt = React.useCallback(
    async (repoId: string, path: string, commitId: string): Promise<string> => {
      const snapshot = stateRef.current;
      const repo = snapshot?.repos.find((r) => r.id === repoId);
      if (!snapshot || !repo) return "";
      return fetchRepoFileContent(repo, snapshot.projectId, path, commitId);
    },
    [],
  );

  // Boot-time completion for terminal states that never mount DocumentsApp /
  // PrShell (which would otherwise fire the "content" signal): a discovery
  // error, or a project with no repositories. Without this the boot event would
  // silently never fire for those sessions. Idempotent + no-ops outside a real
  // boot; if content later renders, PrShell's "content" already won.
  const noRepos = !!state && state.repos.length === 0;
  React.useEffect(() => {
    if (error) markAppReady("error");
    else if (noRepos) markAppReady("empty");
  }, [error, noRepos]);

  if (error) {
    return (
      <div className="emr-error">
        <h2>Couldn't load Documents</h2>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!state || !user) {
    return (
      <div className="emr-docs-app">
        <ReaderLoadingShell scope="hub" ariaLabel="Loading Documents" />
      </div>
    );
  }

  if (state.repos.length === 0) {
    return (
      <div className="emr-error" style={{ color: "var(--emr-muted)" }}>
        <h2>No repositories found</h2>
        <p>This project doesn&apos;t contain any repositories to browse.</p>
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
        onSearchFiles={searchFiles}
        onLoadRepoDetails={loadDetailsFor}
        onRefreshRepo={refreshRepo}
        orgUrl={resolveOrgUrl()}
        projectName={state.projectName}
        initialSelectedPath={state.initialSelectedPath}
        initialActiveThreadId={state.initialActiveThreadId}
        buildCommentLink={(repoId, path, threadId) =>
          buildHubCommentUrl(
            resolveOrgUrl(),
            state.projectName,
            repoId,
            path,
            threadId,
          )
        }
        onSelectPath={(repoId, path) => {
          // Remember the document so a return visit reopens it (scoped per repo).
          writeLastPath(state.projectId, repoId, path);
          // Strip the leading slash so the URL reads `?path=docs/x.md`, matching
          // ADO's native Files experience (the host encodes `/` as %2F). Also
          // pin the repo so the link round-trips to the right repository.
          void setRouteQuery({ repo: repoId, path: path.replace(/^\/+/, "") });
        }}
        onSelectRepo={(repoId) => {
          // Remember the choice so a return visit reopens the same repo.
          writeLastRepo(state.projectId, repoId);
          // Switching repos lands on a different document set, so the previous
          // repo's `?path=`/`?comment=` deep link no longer applies. Clear both
          // (empty value removes the param) and pin the new repo, so the URL
          // never momentarily shows the new repo paired with the OLD repo's
          // path. DocumentsApp's onSelectPath repopulates `?path=` once the new
          // repo's first document resolves, keeping the URL consistent.
          void setRouteQuery({
            repo: repoId,
            path: "",
            [COMMENT_LINK_PARAM]: "",
          });
        }}
        onActiveThreadChange={(_repoId, threadId) => {
          // Mirror the active thread into `?comment=` so selecting a comment
          // yields the same shareable deep link the "Link to comment" action
          // builds. An empty value removes the param when nothing is active.
          void setRouteQuery({ [COMMENT_LINK_PARAM]: threadId ?? "" });
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
              resolveOrgUrl(),
              state.projectName,
              rawRepo.name,
              target.path,
            ),
          );
        }}
      />
    </AvatarImageContext.Provider>
  );
}

// ---------------- helpers ----------------

/**
 * Read the hub's current query parameters (e.g. the `?path=` deep-link).
 * Best-effort: returns `{}` when the navigation service is unavailable.
 */
async function readRouteParams(): Promise<Record<string, string>> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    return (await nav.getQueryParams()) ?? {};
  } catch {
    return {};
  }
}

/**
 * Open `url` in a new browser tab via the host navigation service, used to
 * route a non-Markdown relative link to ADO's native Files view. Best-effort:
 * a missing navigation service is silently ignored (the click just no-ops).
 */
async function openInNewTab(url: string): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    nav.openNewWindow(url, "");
  } catch {
    /* navigation service unavailable — opening the file is best-effort */
  }
}

/**
 * Merge `updates` into the hub's query string without reloading the page, so
 * in-hub navigation is reflected in (and shareable via) the URL. Existing
 * params are preserved. Best-effort when the navigation service is missing.
 */
async function setRouteQuery(updates: Record<string, string>): Promise<void> {
  try {
    const nav = await SDK.getService<IHostNavigationService>(
      CommonServiceIds.HostNavigationService,
    );
    const current = (await nav.getQueryParams()) ?? {};
    nav.setQueryParams({ ...current, ...updates });
  } catch {
    /* navigation service unavailable — route syncing is best-effort */
  }
}

/**
 * Build the absolute, shareable Documents-hub URL for a deep link to a thread.
 * Resolves the extension identity from the SDK, then delegates the URL
 * assembly to the pure `assembleHubCommentUrl`. Returns `undefined` when the
 * extension context can't be resolved, so the caller falls back to the
 * in-iframe hash link.
 */
function buildHubCommentUrl(
  orgUrl: string,
  projectName: string,
  repoId: string,
  path: string,
  threadId: string,
): string | undefined {
  let ext: { publisherId: string; extensionId: string };
  try {
    ext = SDK.getExtensionContext();
  } catch {
    return undefined;
  }
  return assembleHubCommentUrl(
    orgUrl,
    projectName,
    ext,
    repoId,
    path,
    threadId,
  );
}

/**
 * Resolve the org's web URL (no trailing slash) for hydrating mention links.
 * Mirrors the helper in `pr-tab/PrTabApp.tsx`. Returns `""` when nothing is
 * resolvable, leaving mentions non-navigable rather than pointing wrong.
 */
function resolveOrgUrl(): string {
  try {
    const host = SDK.getHost();
    if (host?.name) return `https://dev.azure.com/${host.name}`;
  } catch {
    // Falls through to the referrer-based heuristic.
  }
  return orgUrlFromReferrer(document.referrer);
}
