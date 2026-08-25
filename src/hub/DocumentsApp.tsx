// DocumentsApp — repo-aware shell for the Documents hub. Renders the same
// three-pane grid as the PR tab (DocNav | ArticleView | CommentRail) by
// feeding `PrShell` a synthesized `PrInfo` whose `files` is the repo's doc
// inventory, a repo-scoped `loadFileSource`, and the repo's threads. Loaders
// are agnostic to fixture-vs-live: standalone passes fixture-backed ones, the
// real ADO entry passes `GitRestClient`-backed ones.

import * as React from "react";

import type { CommentAuthor, CommentThread, FileInfo, PrInfo } from "../types";
import { PrShell } from "../shell/PrShell";
import type { RoutedPrInfo, DocLinkNavigation } from "../shell/PrShell";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { SearchIcon } from "../shell/components/icons";
import {
  resolveInitialDocPath,
  shouldPublishDefaultPath,
} from "./documentsAppRouting";
import type { DocPrRef } from "../shell/prShellHelpers";
import type { CommentApi } from "../comments/api";
import {
  MentionLinkContext,
  type MentionLinkResolution,
} from "../comments/mentionLinks";
import {
  CommentLinkContext,
  type CommentLinkBuilder,
} from "../comments/commentLink";
import { refreshHostTheme } from "../theme/theme";
import {
  events,
  markAppReady,
  setTelemetryContext,
  track,
  trackUserFacingError,
} from "../telemetry";

import type { DocRepo } from "../shell/types";
import type { FileSearchOutcome } from "../shell/almSearch";
import { COMMENT_PERMISSION_DENIED_MESSAGE } from "../shell/commentPermission.helpers";
import { planRootAutoExpand } from "./autoExpand";

/** Stable empty seed for per-document mode (threads load lazily per file). */
const EMPTY_THREADS: CommentThread[] = [];

interface DocumentsAppProps {
  repos: DocRepo[];
  /** Initial repo id; defaults to the first repo. */
  initialRepoId?: string;
  /** Resolve a markdown source by (repoId, path). */
  loadFileSource: (repoId: string, path: string) => Promise<string>;
  /** Resolve an image referenced from a repository document. */
  resolveDocumentImage?: (
    repoId: string,
    documentPath: string,
    repositoryPath: string,
    atCommitId?: string,
  ) => Promise<string | undefined>;
  /** Async threads loader. Called on mount and on repo switch. */
  loadThreadsFor: (repoId: string) => Promise<CommentThread[]>;
  currentUser: CommentAuthor;
  /**
   * Optional per-repo comment persistence boundary. When undefined for a repo
   * the shell falls back to `LocalOnlyCommentApi` (session-local writes) and
   * surfaces a banner. Real ADO returns an `AdoCommentApi` for the routing PR.
   */
  commentApiFor?: (repoId: string) => CommentApi | undefined;
  /**
   * Lazy folder enumeration, called the first time a folder is expanded.
   * Real ADO: `listFolderMarkdown`. Omitted in standalone. Returns the
   * immediate `.md` files + subfolder paths.
   */
  onExpandFolder?: (
    repoId: string,
    path: string,
  ) => Promise<{ files: FileInfo[]; folders: string[] }>;
  /**
   * Async cross-folder filename search for one repo. Real ADO: ALM Code
   * Search. Omitted in standalone (DocNav falls back to local filter).
   */
  onSearchFiles?: (
    repoId: string,
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  /**
   * Per-repo deferred-details loader resolving the PR-routing target, called
   * the first time a repo is selected. The host dedupes concurrent calls.
   * Omitted in standalone (repos arrive fully resolved).
   */
  onLoadRepoDetails?: (repoId: string) => Promise<void>;
  /**
   * User-initiated refresh re-running root listing + PR routing. While in
   * flight the host sets the repo's `detailsLoaded` to `false`. Omitted in
   * standalone (the refresh button hides without a handler).
   */
  onRefreshRepo?: (repoId: string) => Promise<void>;
  /**
   * Organization web URL (no trailing slash). With `projectName`, mention
   * links are upgraded to real ADO web URLs by `comments/mentionLinks.ts`.
   * Omitted in standalone (mentions stay inert pills).
   */
  orgUrl?: string;
  /** Project name (URL slug). Required together with `orgUrl`. */
  projectName?: string;
  /**
   * Per-document comment persistence (Documents hub per-document routing).
   * When provided, the hub routes each document's comments to the most recent
   * COMPLETED PR that changed it instead of a single repo-level routing PR.
   * Supplying this (together with {@link loadThreadsForPath}) switches the hub
   * into per-document mode; the routed-PR pill is resolved per file via
   * {@link routedPrForPath}.
   */
  commentApiForPath?: (repoId: string, path: string) => CommentApi | undefined;
  /**
   * Per-document thread loader (Documents hub per-document routing). Loads a
   * single document's threads (from its routing PR) on demand. Presence of
   * this prop is what enables per-document mode.
   */
  loadThreadsForPath?: (
    repoId: string,
    path: string,
  ) => Promise<CommentThread[]>;
  /**
   * Per-document routed-PR resolver (per-document mode). Returns the routing
   * PR summary for a document so the rail can show a "Comments (PR #N)" pill
   * linking to where the comments live. Undefined until routing resolves.
   */
  routedPrForPath?: (
    repoId: string,
    path: string,
  ) => RoutedPrInfo | null | undefined;
  /**
   * Comment-history stepper loaders (per-document mode). Supplied together, they
   * let the comment rail walk a document's review history PR-to-PR: list its
   * completed PRs, read a historical PR's threads, and read the document's
   * source at a specific commit. Omitted in standalone (stepper stays off).
   */
  loadDocHistory?: (repoId: string, path: string) => Promise<DocPrRef[]>;
  loadThreadsForPr?: (
    repoId: string,
    prId: number,
    path: string,
  ) => Promise<CommentThread[]>;
  loadFileSourceAt?: (
    repoId: string,
    path: string,
    commitId: string,
  ) => Promise<string>;
  /**
   * Initial document to open (deep-link routing, `?path=`). Applies only to
   * the first mount of the initial repo — switching repos clears it so it
   * can't override later in-hub navigation.
   */
  initialSelectedPath?: string;
  /**
   * Called when the active document changes, so the host can reflect the
   * selected file in the route. Receives the active repo id and file path.
   */
  onSelectPath?: (repoId: string, path: string) => void;
  /**
   * Called when the active repo changes (in-rail selector), so the host can
   * reflect the selected repo in the route (`?repo=`).
   */
  onSelectRepo?: (repoId: string) => void;
  /**
   * Deep-link seed (`?comment=`): the thread to auto-open on first mount of
   * the initial repo. Forwarded to PrShell alongside `initialSelectedPath`.
   */
  initialActiveThreadId?: string;
  /**
   * Builds a shareable deep link to a thread in the given repo/document, used
   * by the "Link to comment" action. Undefined in standalone (no host URL).
   */
  buildCommentLink?: (
    repoId: string,
    path: string,
    threadId: string,
  ) => string | undefined;
  /**
   * Called when the active comment thread changes, so the host can mirror it
   * into the route's `?comment=` param (the inverse of `initialActiveThreadId`).
   * Receives the active repo id and the thread id (`null` when cleared).
   */
  onActiveThreadChange?: (repoId: string, threadId: string | null) => void;
  /**
   * Called when a relative Markdown link resolves to something the hub can't
   * open in place — a non-Markdown file that should open in ADO's native Files
   * view. Receives the active repo id and the resolved navigation target.
   */
  onDocNavigate?: (repoId: string, target: DocLinkNavigation) => void;
  /**
   * Ordered repo list shown in the picker dropdown. In the paginated hub this
   * is the current (filtered or full) view, which can differ from `repos` (the
   * accumulated union used for selection + content). Defaults to `repos`.
   */
  repoPickerView?: DocRepo[];
  /** Current server-side picker filter keyword (controlled). Default "". */
  repoFilter?: string;
  /** Whether more repo pages can be fetched for the current picker view. */
  reposHasMore?: boolean;
  /** Whether a repo page/filter fetch is currently in flight. */
  reposLoading?: boolean;
  /**
   * Fetch the next page of repos for the picker (infinite scroll). Presence of
   * this prop switches the picker into paginated mode (filter box + scroll
   * loading) and makes it render even for a single visible repo.
   */
  onLoadMoreRepos?: () => void;
  /** Re-query the repo list with a server-side name filter (debounced by the picker). */
  onFilterRepos?: (keyword: string) => void;
}

/**
 * Lazy tree state per active repo. Seeded from `selectedRepo.files` +
 * `topLevelFolders` on repo change; grows as folders are expanded via
 * `onExpandFolder`. Fully-loaded repos (standalone fixtures) leave
 * `unloadedFolders` empty.
 */
interface LazyTreeState {
  repoId: string;
  files: FileInfo[];
  unloadedFolders: string[];
}

export function DocumentsApp(props: DocumentsAppProps): React.ReactElement {
  const {
    repos,
    loadFileSource,
    loadThreadsFor,
    currentUser,
    commentApiFor,
    onExpandFolder,
    onSearchFiles,
    onLoadRepoDetails,
    onRefreshRepo,
    orgUrl,
    projectName,
    onSelectPath,
    onSelectRepo,
  } = props;

  // Per-document "transparent PR" mode is enabled when the host supplies a
  // per-document thread loader. In this mode each document owns a dedicated
  // housing PR; the repo-level routing PR / read-only gating is bypassed.
  const perDocumentMode = !!props.loadThreadsForPath;

  // The active repo. A third-party hub is never handed the repo the user had
  // selected in Repos, so the hub lists every repo in the project and the user
  // switches between them with the in-rail picker below. `initialRepoId` seeds
  // the choice (deep link > last-visited > first repo on page one).
  const [selectedRepoId, setSelectedRepoId] = React.useState<string>(
    props.initialRepoId ?? repos[0]?.id ?? "",
  );

  // Resolve the active repo from the accumulated `repos` union. Cached in a ref
  // so that when the picker's *view* is narrowed by a server-side filter — which
  // can momentarily drop the selected repo out of the visible list — the open
  // document doesn't snap to `repos[0]`. The selected repo only changes when the
  // user actually picks a new one.
  const selectedRepoRef = React.useRef<DocRepo | undefined>(undefined);
  const selectedRepo = React.useMemo(() => {
    const found = repos.find((r) => r.id === selectedRepoId);
    if (found) {
      selectedRepoRef.current = found;
      return found;
    }
    if (selectedRepoRef.current?.id === selectedRepoId) {
      return selectedRepoRef.current;
    }
    const fallback = repos[0];
    selectedRepoRef.current = fallback;
    return fallback;
  }, [repos, selectedRepoId]);

  // Deep-link path (`?path=`). PrShell is keyed by repo id, so it only needs
  // to seed the *initial* repo's first mount. Once consumed — or once the user
  // switches repos — it's dropped so it can never override later navigation.
  // NOTE: consumption is latched only once PrShell actually mounts (see the
  // `prShellMounting` effect below), not on this component's mount: in
  // paginated mode the initial repo arrives as a content-less skeleton and
  // PrShell is gated behind its details/threads loading, so latching on mount
  // here would drop the deep-link path before PrShell ever reads it.
  const initialRepoId = props.initialRepoId ?? repos[0]?.id ?? "";
  const initialPathConsumedRef = React.useRef(false);
  const initialSelectedPathForShell =
    !initialPathConsumedRef.current && selectedRepoId === initialRepoId
      ? props.initialSelectedPath
      : undefined;

  const handleSelectRepo = React.useCallback(
    (repoId: string) => {
      setSelectedRepoId(repoId);
      onSelectRepo?.(repoId);
      track(events.repoSwitched());
    },
    [onSelectRepo],
  );

  // Keep telemetry's de-identified repo context in sync with the active repo
  // (covers both the initial selection and later switches). Repo *id* only.
  React.useEffect(() => {
    if (selectedRepoId) setTelemetryContext({ repositoryId: selectedRepoId });
  }, [selectedRepoId]);

  // Trigger the host's deferred per-repo PR-routing load on selection. The
  // host dedupes, so firing on every selectedRepo change is safe.
  React.useEffect(() => {
    if (!selectedRepo || !onLoadRepoDetails) return;
    if (selectedRepo.detailsLoaded === false) {
      void onLoadRepoDetails(selectedRepo.id);
    }
  }, [selectedRepo, onLoadRepoDetails]);

  // Threads are NOT fetched up front and awaited before mounting PrShell.
  // Instead PrShell mounts as soon as the repo's routing is known and loads its
  // threads via the mount-time thread sync (`fetchRemoteThreads` below, which
  // calls the same `loadThreadsFor`), merging them into the rail when they land.
  // This keeps the Markdown render off the thread-fetch critical path — the
  // document paints immediately and comments stream in.

  // Lazy-tree working set keyed by repo id. Each entry starts as
  // `{ files: repo.files, unloadedFolders: repo.topLevelFolders }` and grows
  // as `onExpandFolder` resolves. The map is NOT reset on repo switch —
  // entries persist for the DocumentsApp lifetime so re-opening a repo doesn't
  // re-fetch already-expanded folders.
  const [lazyTreeByRepo, setLazyTreeByRepo] = React.useState<
    Map<string, LazyTreeState>
  >(() => {
    const m = new Map<string, LazyTreeState>();
    // Only seed once the repo's listing has loaded. The paginated picker hands
    // us a content-less skeleton (`detailsLoaded === false`) first; seeding
    // from it would cache an empty tree that never refreshes when the real
    // root listing arrives, leaving the nav permanently empty.
    if (selectedRepo && selectedRepo.detailsLoaded !== false) {
      m.set(selectedRepo.id, {
        repoId: selectedRepo.id,
        files: selectedRepo.files,
        unloadedFolders: [...(selectedRepo.topLevelFolders ?? [])],
      });
    }
    return m;
  });
  // Seed an entry the first time we see a repo with loaded content; existing
  // entries are the cache. Skeletons (`detailsLoaded === false`) are skipped so
  // the entry is first created from the real listing, not the empty skeleton.
  React.useEffect(() => {
    if (!selectedRepo) return;
    if (selectedRepo.detailsLoaded === false) return;
    setLazyTreeByRepo((curr) => {
      if (curr.has(selectedRepo.id)) return curr;
      const next = new Map(curr);
      next.set(selectedRepo.id, {
        repoId: selectedRepo.id,
        files: selectedRepo.files,
        unloadedFolders: [...(selectedRepo.topLevelFolders ?? [])],
      });
      return next;
    });
  }, [selectedRepo]);

  // The cached entry for the active repo (undefined for the one render right
  // after a new repo is selected, before the seeding effect lands — read
  // sites fall back to `selectedRepo.files`).
  const lazyTree = selectedRepo
    ? lazyTreeByRepo.get(selectedRepo.id)
    : undefined;

  // Lazy folder expansion handler: returns the raw payload to the DocNav and
  // merges the result into the per-repo `lazyTreeByRepo` entry.
  const handleExpandFolder = React.useCallback(
    async (
      path: string,
    ): Promise<{ files: FileInfo[]; folders: string[] } | null> => {
      if (!selectedRepo || !onExpandFolder) return null;
      const repoIdAtCall = selectedRepo.id;
      let payload: { files: FileInfo[]; folders: string[] };
      try {
        payload = await onExpandFolder(repoIdAtCall, path);
      } catch (err) {
        console.warn("[documents-hub] expand folder failed:", path, err);
        trackUserFacingError({
          error: err,
          source: "DocumentsApp.navigation",
          operation: "folder-expand",
          impact: "action-failed",
        });
        return null;
      }
      setLazyTreeByRepo((curr) => {
        const entry = curr.get(repoIdAtCall);
        if (!entry) return curr;
        const seenFiles = new Set(entry.files.map((f) => f.path));
        const mergedFiles = entry.files.slice();
        for (const f of payload.files) {
          if (!seenFiles.has(f.path)) {
            seenFiles.add(f.path);
            mergedFiles.push(f);
          }
        }
        // Drop the just-expanded folder; add new unloaded subfolders. Folder
        // paths arrive in two flavours across the host boundary (`/docs` vs
        // `docs`), so canonicalize every value to a "no leading slash" form
        // — otherwise the set accumulates both variants.
        const canonicalize = (p: string): string => p.replace(/^\/+/, "");
        const unloaded = new Set(entry.unloadedFolders.map(canonicalize));
        unloaded.delete(canonicalize(path));
        for (const sub of payload.folders) {
          unloaded.add(canonicalize(sub));
        }
        mergedFiles.sort((a, b) => a.path.localeCompare(b.path));
        const next = new Map(curr);
        next.set(repoIdAtCall, {
          repoId: repoIdAtCall,
          files: mergedFiles,
          unloadedFolders: Array.from(unloaded).sort((a, b) =>
            a.localeCompare(b),
          ),
        });
        return next;
      });
      return payload;
    },
    [selectedRepo, onExpandFolder],
  );

  // After a repo's listing loads, auto-expand its folders so the markdown
  // surfaces immediately — a docs repo usually keeps its content under a
  // folder (e.g. `/docs`), so the root listing alone has no files and the nav
  // would otherwise read as empty until the user manually drilled in. Walks
  // one level per pass (the effect re-runs as the tree grows) until the first
  // document appears, then stops. Deduped + budgeted via refs so it never
  // re-fetches a folder or walks a large repo without bound.
  const autoExpandedFoldersRef = React.useRef<Set<string>>(new Set());
  const autoExpandUsedRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    if (!selectedRepo || !onExpandFolder) return;
    if (selectedRepo.detailsLoaded === false) return;
    const tree = lazyTree;
    if (!tree || tree.unloadedFolders.length === 0) return;
    const repoId = selectedRepo.id;
    const plan = planRootAutoExpand({
      repoId,
      fileCount: tree.files.length,
      unloadedFolders: tree.unloadedFolders,
      expandedKeys: autoExpandedFoldersRef.current,
      used: autoExpandUsedRef.current.get(repoId) ?? 0,
      max: 40, // safety cap per repo
    });
    if (plan.folders.length === 0) return;
    for (const key of plan.keys) autoExpandedFoldersRef.current.add(key);
    autoExpandUsedRef.current.set(repoId, plan.used);
    for (const folder of plan.folders) void handleExpandFolder(folder);
  }, [selectedRepo, lazyTree, onExpandFolder, handleExpandFolder]);

  // Repo-scoped search callback. Returns `undefined` (DocNav local-only
  // filter) when no `onSearchFiles` is wired; otherwise curries the repo id.
  const handleSearchFiles = React.useMemo<
    | ((query: string, signal?: AbortSignal) => Promise<FileSearchOutcome>)
    | undefined
  >(() => {
    if (!selectedRepo || !onSearchFiles) return undefined;
    const repoIdAtBind = selectedRepo.id;
    return (query: string, signal?: AbortSignal) =>
      onSearchFiles(repoIdAtBind, query, signal);
  }, [selectedRepo, onSearchFiles]);

  // Build the `PrInfo` PrShell expects (it only renders `files`; the other
  // fields are set for a readable DevTools breadcrumb). `files` comes from
  // the cached `lazyTree.files` so expansion + search visibly grow the tree.
  const syntheticPr: PrInfo | null = React.useMemo(() => {
    if (!selectedRepo) return null;
    const treeFiles = lazyTree ? lazyTree.files : selectedRepo.files;
    return {
      prId: selectedRepo.recentPr?.id ?? 0,
      title: `Documents in ${selectedRepo.name}`,
      authorName: selectedRepo.recentPr?.author ?? "\u2014",
      files: treeFiles,
    };
  }, [selectedRepo, lazyTree]);

  // Track the active document path so the "Link to comment" builder can encode
  // it. Seeded from the deep-link/cache path (or the first file PrShell will
  // open), updated as the user navigates, and reset when the repo switches.
  const [activeDocPath, setActiveDocPath] = React.useState<string>(
    resolveInitialDocPath(
      initialSelectedPathForShell,
      syntheticPr?.files[0]?.path,
    ),
  );
  // The repo whose open document we've already published to the route. It
  // trails `selectedRepoId` until that repo's files resolve, then we publish
  // its initial/default document exactly once.
  const activeDocRepoRef = React.useRef(selectedRepoId);
  const publishedRepoRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // Repo switch: clear the active path immediately so the comment-link
    // builder (and `activeDocPath`) never momentarily point at the *previous*
    // repo's document while the new repo's default document resolves.
    if (activeDocRepoRef.current !== selectedRepoId) {
      activeDocRepoRef.current = selectedRepoId;
      setActiveDocPath(initialSelectedPathForShell ?? "");
    }

    // Publish the repo's initial/default document to the route exactly once —
    // PrShell opens it without emitting a selection, so the route's `?path=`
    // would otherwise stay stale (the previous repo's doc) or empty.
    //
    // CRITICAL: this must be RE-EVALUATED as `syntheticPr` streams in, not run
    // once on switch. In paginated mode a repo (the initial one OR a
    // freshly-picked one) first arrives as a content-less skeleton, so its
    // `files` are empty on the switch render; a one-shot publish would miss the
    // default doc entirely. We guard per-repo via `publishedRepoRef` so we
    // still publish only once, but retry on later renders until files land.
    //
    // The deep-link / cache path (`initialSelectedPathForShell`) wins when set
    // and is available immediately (no skeleton wait), so the bare-URL cache
    // restore is still back-filled to `?repo=…&path=…` on the first render.
    // Republishing is idempotent — `setRouteQuery` merges, preserving
    // `?comment=`.
    if (publishedRepoRef.current === selectedRepoId) return;
    const nextPath = resolveInitialDocPath(
      initialSelectedPathForShell,
      syntheticPr?.files[0]?.path,
    );
    if (
      !shouldPublishDefaultPath(
        publishedRepoRef.current,
        selectedRepoId,
        nextPath,
      )
    ) {
      return; // files not resolved yet — retry on the next render
    }
    publishedRepoRef.current = selectedRepoId;
    setActiveDocPath(nextPath);
    onSelectPath?.(selectedRepoId, nextPath);
  }, [selectedRepoId, syntheticPr, initialSelectedPathForShell, onSelectPath]);

  // Curry the per-repo source loader so PrShell's `loadFileSource(path)`
  // contract is satisfied without leaking the repo id.
  const repoScopedLoader = React.useCallback(
    (path: string): Promise<string> => {
      if (!selectedRepo) return Promise.reject(new Error("No repo selected"));
      return loadFileSource(selectedRepo.id, path);
    },
    [selectedRepo, loadFileSource],
  );
  const resolveDocumentImageBound = React.useMemo<
    | ((
        documentPath: string,
        repositoryPath: string,
        atCommitId?: string,
      ) => Promise<string | undefined>)
    | undefined
  >(() => {
    const resolveImage = props.resolveDocumentImage;
    if (!selectedRepo || !resolveImage) return undefined;
    const repoId = selectedRepo.id;
    return (
      documentPath: string,
      repositoryPath: string,
      atCommitId?: string,
    ): Promise<string | undefined> =>
      resolveImage(repoId, documentPath, repositoryPath, atCommitId);
  }, [props.resolveDocumentImage, selectedRepo]);

  const commentApi = React.useMemo<CommentApi | undefined>(() => {
    if (!selectedRepo || !commentApiFor) return undefined;
    return commentApiFor(selectedRepo.id);
  }, [selectedRepo, commentApiFor]);

  // Per-document mode: curry the repo id so PrShell's per-path contracts
  // (`(path) => …`) are satisfied without leaking it.
  const commentApiForPathBound = React.useMemo<
    ((path: string) => CommentApi | undefined) | undefined
  >(() => {
    const fn = props.commentApiForPath;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (path: string) => fn(repoId, path);
  }, [perDocumentMode, props.commentApiForPath, selectedRepo]);

  const loadThreadsForPathBound = React.useMemo<
    ((path: string) => Promise<CommentThread[]>) | undefined
  >(() => {
    const fn = props.loadThreadsForPath;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (path: string) => fn(repoId, path);
  }, [perDocumentMode, props.loadThreadsForPath, selectedRepo]);

  // Per-document mode: curry the repo id so PrShell resolves the routed-PR
  // pill for its selected file.
  const routedPrForPathBound = React.useMemo<
    ((path: string) => RoutedPrInfo | null | undefined) | undefined
  >(() => {
    const fn = props.routedPrForPath;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (path: string) => fn(repoId, path);
  }, [perDocumentMode, props.routedPrForPath, selectedRepo]);

  // Comment-history stepper: curry the repo id onto the three history loaders
  // so PrShell's per-path stepper contracts are satisfied.
  const loadDocHistoryBound = React.useMemo<
    ((path: string) => Promise<DocPrRef[]>) | undefined
  >(() => {
    const fn = props.loadDocHistory;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (path: string) => fn(repoId, path);
  }, [perDocumentMode, props.loadDocHistory, selectedRepo]);

  const loadThreadsForPrBound = React.useMemo<
    ((prId: number, path: string) => Promise<CommentThread[]>) | undefined
  >(() => {
    const fn = props.loadThreadsForPr;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (prId: number, path: string) => fn(repoId, prId, path);
  }, [perDocumentMode, props.loadThreadsForPr, selectedRepo]);

  const loadFileSourceAtBound = React.useMemo<
    ((path: string, commitId: string) => Promise<string>) | undefined
  >(() => {
    const fn = props.loadFileSourceAt;
    if (!perDocumentMode || !fn || !selectedRepo) return undefined;
    const repoId = selectedRepo.id;
    return (path: string, commitId: string) => fn(repoId, path, commitId);
  }, [perDocumentMode, props.loadFileSourceAt, selectedRepo]);

  // Build the routed-PR pill payload for the rail (only when the repo has a
  // completed PR; the rail hides when undefined).
  const routedPr = React.useMemo<RoutedPrInfo | null>(() => {
    const rp = selectedRepo?.recentPr;
    if (!rp) return null;
    return {
      prId: rp.id,
      title: rp.title,
      status: rp.status,
      url: rp.url,
    };
  }, [selectedRepo]);

  // Disable commenting when there's no PR to route through. The rail then
  // renders a read-only banner and the article suppresses its selection bubble.
  const readOnly = !selectedRepo?.recentPr;
  const readOnlyMessage = readOnly
    ? selectedRepo
      ? `${selectedRepo.name} has no completed pull request — commenting is disabled until one is completed.`
      : undefined
    : undefined;

  // Per-document mode has no routing PR to gate on; instead commenting is
  // disabled only when ADO explicitly denied Contribute on the repo. The rail
  // surfaces the reason in its read-only banner (right panel).
  const perDocCommentDenied =
    perDocumentMode && selectedRepo?.canComment === false;
  const perDocReadOnly = perDocumentMode ? perDocCommentDenied : readOnly;
  const perDocReadOnlyMessage = perDocumentMode
    ? perDocCommentDenied
      ? COMMENT_PERMISSION_DENIED_MESSAGE
      : undefined
    : readOnlyMessage;

  // Background thread sync for the routed PR. Skipped when the repo has no PR.
  // PrShell polls this ~30s while visible and merges via `MERGE_REMOTE_THREADS`.
  const fetchRemoteThreads = React.useMemo<
    ((signal: AbortSignal) => Promise<CommentThread[]>) | undefined
  >(() => {
    if (!selectedRepo || readOnly) return undefined;
    const repoIdAtBind = selectedRepo.id;
    return async (_signal: AbortSignal) => loadThreadsFor(repoIdAtBind);
  }, [selectedRepo, readOnly, loadThreadsFor]);

  if (!selectedRepo || !syntheticPr) {
    return (
      <div className="emr-error">
        <h2>No repositories</h2>
        <p>This project has no Markdown documents to review.</p>
      </div>
    );
  }

  // Refresh handler: bust the lazy-tree cache for the current repo and
  // delegate to the host (which flips `detailsLoaded` false then true,
  // remounting PrShell with fresh data).
  const [refreshingRepoId, setRefreshingRepoId] = React.useState<string | null>(
    null,
  );
  const handleRefresh = React.useCallback(async () => {
    if (!selectedRepo || !onRefreshRepo) return;
    // Re-mirror the host's ADO theme on manual refresh — some ADO chromes
    // don't broadcast live theme changes to loaded contributions. Only
    // reached in the hosted context (standalone bails above).
    refreshHostTheme();
    const repoId = selectedRepo.id;
    setRefreshingRepoId(repoId);
    setLazyTreeByRepo((curr) => {
      if (!curr.has(repoId)) return curr;
      const next = new Map(curr);
      next.delete(repoId);
      return next;
    });
    try {
      await onRefreshRepo(repoId);
    } finally {
      setRefreshingRepoId((curr) => (curr === repoId ? null : curr));
    }
  }, [selectedRepo, onRefreshRepo]);

  // The DocNav header hosts the in-hub repo selector (the host never gives us
  // the selected repo, so this is the only way to switch). The repo name in the
  // header is itself the trigger — clicking it opens an inline dropdown of the
  // project's repos with a keyword filter and scroll-paginated loading. With a
  // single non-paginated repo it degrades to a static label. Lives in the
  // DocNav title slot so the hub mirrors the PR tab's layout without a separate
  // header strip.
  const paginated = !!props.onFilterRepos;
  const pickerRepos = props.repoPickerView ?? repos;
  const docNavTitleSlot =
    paginated || repos.length > 1 ? (
      <RepoPicker
        repos={pickerRepos}
        selectedId={selectedRepo.id}
        selectedName={selectedRepo.name}
        onSelect={handleSelectRepo}
        paginated={paginated}
        filter={props.repoFilter ?? ""}
        hasMore={props.reposHasMore ?? false}
        loading={props.reposLoading ?? false}
        onLoadMore={props.onLoadMoreRepos}
        onFilter={props.onFilterRepos}
      />
    ) : (
      <span className="emr-docnav-title" title={selectedRepo.name}>
        <SvgRepo />
        <span className="emr-docnav-repo-name">{selectedRepo.name}</span>
      </span>
    );
  const docNavHeaderActions = onRefreshRepo ? (
    <button
      type="button"
      className="emr-icon-btn emr-docs-refresh-btn"
      onClick={() => {
        void handleRefresh();
      }}
      disabled={refreshingRepoId === selectedRepo.id}
      aria-label="Refresh repository contents and PR routing"
      title="Refresh repository contents and PR routing"
    >
      <SvgRefresh spinning={refreshingRepoId === selectedRepo.id} />
    </button>
  ) : null;

  // Mention-link hydration context. `defaultRepoName` tracks the selected repo
  // so PR mentions that omit the `repo` URL param still resolve. Null when
  // org/project aren't supplied (standalone) — the hydrator no-ops on null.
  const mentionLinks: MentionLinkResolution | null =
    orgUrl && projectName
      ? {
          orgUrl,
          projectName,
          defaultRepoName: selectedRepo?.name,
        }
      : null;

  // "Link to comment" builder for the active document. Closes over the current
  // repo + path so CommentRow only needs to pass the thread id. Null when the
  // host can't build a shareable URL (standalone).
  const buildCommentLink = props.buildCommentLink;
  const commentLinkBuilder = React.useMemo<CommentLinkBuilder | null>(
    () =>
      buildCommentLink
        ? (threadId: string) =>
            buildCommentLink(selectedRepoId, activeDocPath, threadId)
        : null,
    [buildCommentLink, selectedRepoId, activeDocPath],
  );

  // A repo whose content has loaded but holds no markdown at all (no root
  // files and no subfolders to expand). Drives the friendly "No documents"
  // empty state instead of mounting PrShell on an empty file list.
  const shellUnloadedFolders = lazyTree
    ? lazyTree.unloadedFolders
    : (selectedRepo.topLevelFolders ?? []);
  const isEmptyRepo =
    selectedRepo.detailsLoaded !== false &&
    (syntheticPr?.files.length ?? 0) === 0 &&
    shellUnloadedFolders.length === 0;

  // True on renders where PrShell is actually shown (the repo's routing has
  // resolved and the repo isn't empty). Used to latch the deep-link path as
  // consumed only after PrShell has had a chance to read it.
  const prShellMounting = selectedRepo.detailsLoaded !== false && !isEmptyRepo;
  React.useEffect(() => {
    if (prShellMounting) initialPathConsumedRef.current = true;
  }, [prShellMounting]);

  // Boot-time completion for the no-content terminal: a repo with no Markdown
  // never mounts PrShell (which would otherwise fire the "content" signal), so
  // mark boot ready as "empty" here. Idempotent — if a doc later renders,
  // PrShell's "content" already won.
  React.useEffect(() => {
    if (isEmptyRepo) markAppReady("empty");
  }, [isEmptyRepo]);

  return (
    <MentionLinkContext.Provider value={mentionLinks}>
      <CommentLinkContext.Provider value={commentLinkBuilder}>
        <div className="emr-docs-app">
          {/*
            PrShell mounts as soon as the repo's routing is known — it does NOT
            wait on the thread fetch. Threads stream in via the shell's
            mount-time sync (fetchRemoteThreads) and merge into the rail, so the
            Markdown paints without blocking on comments.
          */}
          {selectedRepo.detailsLoaded === false ? (
            // Paginated picker: a freshly-selected repo arrives as a content-less
            // skeleton; show the loading shell while its root listing + routing
            // resolve.
            <ReaderLoadingShell
              scope="hub"
              ariaLabel="Loading document"
              titleSlot={docNavTitleSlot}
              headerActions={docNavHeaderActions}
            />
          ) : isEmptyRepo ? (
            <DocsEmptyShell
              titleSlot={docNavTitleSlot}
              headerActions={docNavHeaderActions}
              repoName={selectedRepo.name}
            />
          ) : (
            // Key on the repo id so PrShell remounts on repo switch — it holds
            // per-file HTML caches and selected-path state in local hooks.
            <PrShell
              key={selectedRepo.id}
              pr={syntheticPr}
              loadFileSource={repoScopedLoader}
              resolveDocumentImage={resolveDocumentImageBound}
              diffsByFile={{}}
              initialThreads={EMPTY_THREADS}
              currentUser={currentUser}
              draftScope="hub"
              documentsMode
              commentApi={perDocumentMode ? undefined : commentApi}
              commentApiForPath={commentApiForPathBound}
              loadThreadsForPath={loadThreadsForPathBound}
              routedPrForPath={routedPrForPathBound}
              loadDocHistory={loadDocHistoryBound}
              loadThreadsForPr={loadThreadsForPrBound}
              loadFileSourceAt={loadFileSourceAtBound}
              readOnly={perDocumentMode ? perDocReadOnly : readOnly}
              readOnlyMessage={
                perDocumentMode ? perDocReadOnlyMessage : readOnlyMessage
              }
              routedPr={perDocumentMode ? undefined : routedPr}
              fetchRemoteThreads={
                perDocumentMode ? undefined : fetchRemoteThreads
              }
              unloadedFolders={
                lazyTree
                  ? lazyTree.unloadedFolders
                  : (selectedRepo.topLevelFolders ?? [])
              }
              onExpandFolder={onExpandFolder ? handleExpandFolder : undefined}
              onSearchFiles={handleSearchFiles}
              docNavTitleSlot={docNavTitleSlot}
              onRefreshFiles={onRefreshRepo ? handleRefresh : undefined}
              feedbackEmail="shubd3@gmail.com"
              initialSelectedPath={initialSelectedPathForShell}
              initialActiveThreadId={
                !initialPathConsumedRef.current &&
                selectedRepoId === initialRepoId
                  ? props.initialActiveThreadId
                  : undefined
              }
              onSelectPath={(path) => {
                setActiveDocPath(path);
                onSelectPath?.(selectedRepoId, path);
              }}
              onActiveThreadChange={(threadId) =>
                props.onActiveThreadChange?.(selectedRepoId, threadId)
              }
              onDocNavigate={(target) =>
                props.onDocNavigate?.(selectedRepoId, target)
              }
            />
          )}
        </div>
      </CommentLinkContext.Provider>
    </MentionLinkContext.Provider>
  );
}

function SvgRefresh(props: { spinning?: boolean }): React.ReactElement {
  return (
    <svg
      className={`emr-icon ${props.spinning ? "is-spinning" : ""}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 3a5 5 0 0 1 4.546 2.914.75.75 0 1 0 1.362-.628A6.5 6.5 0 1 0 14.5 8a.75.75 0 0 0-1.5 0A5 5 0 1 1 8 3Z"
      />
      <path
        fill="currentColor"
        d="M14 2.5a.75.75 0 0 0-1.5 0V5h-2.5a.75.75 0 0 0 0 1.5h3.25A.75.75 0 0 0 14 5.75V2.5Z"
      />
    </svg>
  );
}

function SvgChevron(): React.ReactElement {
  return (
    <svg
      className="emr-docnav-repo-chevron"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L8.53 10.53a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  );
}

function SvgCheck(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0l-2.75-2.75a.75.75 0 1 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0Z"
      />
    </svg>
  );
}

/**
 * Subtle monochrome git-repository glyph (Octicon "repo"). Drawn in
 * `currentColor` at reduced opacity via CSS so it reads as a quiet affordance
 * rather than a bright brand mark — keeping with the app's minimal aesthetic.
 */
function SvgRepo(): React.ReactElement {
  // Azure DevOps Repos glyph (the git-branch "bowtie-git" mark the product uses
  // for repositories), drawn in currentColor so it inherits the picker's tone.
  return (
    <svg
      className="emr-docnav-repo-glyph"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
      />
    </svg>
  );
}

/**
 * Empty-state shell shown when the selected repo holds no markdown. Keeps the
 * DocNav header (and its repo picker) live so the user can switch to another
 * repo, and replaces the article + rail with a friendly message.
 */
function DocsEmptyShell({
  titleSlot,
  headerActions,
  repoName,
}: {
  titleSlot?: React.ReactNode;
  headerActions?: React.ReactNode;
  repoName: string;
}): React.ReactElement {
  return (
    <div className="emr-app emr-docs-empty-shell">
      <div className="emr-grid">
        <aside className="emr-docnav" aria-label="Document navigation">
          <div className="emr-docnav-header">
            {titleSlot}
            {headerActions}
          </div>
        </aside>
        <div
          className="emr-article-wrap emr-docs-empty"
          role="status"
          aria-label={`No documents in ${repoName}`}
        >
          <div className="emr-docs-empty-card">
            <SvgRepo />
            <h2>No documents in this repository</h2>
            <p>
              <strong>{repoName}</strong> doesn&apos;t contain any Markdown (
              <code>.md</code>) files yet. Pick another repository from the
              selector above.
            </p>
          </div>
        </div>
        <aside className="emr-rail-col" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * Inline repo picker for the DocNav header. The repo name is the trigger —
 * clicking it (or pressing Enter/Space/ArrowDown) opens a dropdown listing the
 * project's repos. The menu is rendered with `position: fixed` anchored to the
 * trigger because the DocNav rail clips overflow, so an absolutely-positioned
 * popover would be cut off. Closes on outside click, Escape, scroll and resize;
 * arrow keys move focus between options.
 *
 * In paginated mode (`paginated`, used by the live hub) the menu grows a
 * keyword filter box (debounced server-side query via `onFilter`) and pages in
 * more repos as the user scrolls (`onLoadMore`), so it scales to projects with
 * thousands of repositories.
 */
export function RepoPicker({
  repos,
  selectedId,
  selectedName,
  onSelect,
  paginated = false,
  filter = "",
  hasMore = false,
  loading = false,
  onLoadMore,
  onFilter,
}: {
  repos: DocRepo[];
  selectedId: string;
  /** Display name for the trigger; the selected repo may be outside the view. */
  selectedName?: string;
  onSelect: (repoId: string) => void;
  paginated?: boolean;
  filter?: string;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  onFilter?: (keyword: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});
  // Local mirror of the filter text so typing is instant; the server query is
  // debounced off this value.
  const [filterText, setFilterText] = React.useState(filter);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const loadMoreRequestedRef = React.useRef(false);

  const triggerName =
    selectedName ?? repos.find((r) => r.id === selectedId)?.name;

  const openMenu = React.useCallback(() => {
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: Math.round(rect.bottom + 4),
        left: Math.round(rect.left),
        minWidth: Math.round(rect.width),
      });
    }
    setOpen(true);
  }, []);

  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // When opening: focus the filter box (paginated) or the selected option.
  React.useEffect(() => {
    if (!open) return;
    if (paginated) {
      filterInputRef.current?.focus();
      return;
    }
    const idx = Math.max(
      0,
      repos.findIndex((r) => r.id === selectedId),
    );
    optionRefs.current[idx]?.focus();
    // Only on open — re-focusing on every repos change would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce the keyword filter: re-query 250ms after the last keystroke so a
  // burst of typing makes a single server round-trip.
  const onFilterRef = React.useRef(onFilter);
  onFilterRef.current = onFilter;
  React.useEffect(() => {
    if (!paginated) return;
    if (filterText === filter) return; // already in sync (e.g. external reset)
    const handle = window.setTimeout(() => {
      onFilterRef.current?.(filterText);
    }, 250);
    return () => window.clearTimeout(handle);
    // `filter` intentionally omitted: we debounce off local input only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText, paginated]);

  // Match native ADO: clear the keyword filter whenever the picker closes, so
  // reopening always starts from the full, unfiltered list. Resets the local
  // input immediately and tells the host to re-query page one when a filter
  // was actually applied (avoids a needless round-trip on a plain open/close).
  React.useEffect(() => {
    if (open) return;
    if (filterText !== "") setFilterText("");
    if (paginated && filter !== "") onFilterRef.current?.("");
    // Only react to open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Dismiss on outside pointer, scroll (outside the menu) or resize while open.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t))
        return;
      setOpen(false);
    };
    // Close on scroll/resize since the menu is fixed to a now-stale rect — but
    // NOT when the scroll happens inside our own (paginated) results list.
    const onScrollCapture = (e: Event) => {
      if (listRef.current && e.target instanceof Node) {
        if (listRef.current === e.target || listRef.current.contains(e.target))
          return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScrollCapture, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScrollCapture, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = React.useCallback(
    (repoId: string) => {
      onSelect(repoId);
      close();
    },
    [onSelect, close],
  );

  React.useEffect(() => {
    if (!loading) loadMoreRequestedRef.current = false;
  }, [loading]);

  // Infinite scroll: when the results list nears its bottom, ask for the next
  // page. The ref closes the gap before the parent's loading prop re-renders,
  // when several scroll events can otherwise start the same page repeatedly.
  const onListScroll = React.useCallback(() => {
    if (
      !paginated ||
      !hasMore ||
      loading ||
      loadMoreRequestedRef.current ||
      !onLoadMore
    )
      return;
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMoreRequestedRef.current = true;
      onLoadMore();
    }
  }, [paginated, hasMore, loading, onLoadMore]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const count = repos.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const current = optionRefs.current.findIndex(
        (el) => el === document.activeElement,
      );
      if (current === -1) {
        // Coming from the filter box (or nothing focused): enter the list.
        optionRefs.current[dir === 1 ? 0 : count - 1]?.focus();
        return;
      }
      const next = (current + dir + count) % count;
      optionRefs.current[next]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      optionRefs.current[count - 1]?.focus();
    }
  };

  return (
    <div className="emr-docnav-repo">
      <button
        ref={triggerRef}
        type="button"
        className="emr-docnav-repo-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={triggerName}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (
            !open &&
            (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <SvgRepo />
        <span className="emr-docnav-repo-name">{triggerName}</span>
        <SvgChevron />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className={`emr-docnav-repo-menu${paginated ? " is-paginated" : ""}`}
          aria-label="Repository"
          style={menuStyle}
          onKeyDown={onMenuKeyDown}
        >
          {paginated ? (
            <div className="emr-docnav-repo-filter">
              <SearchIcon size={14} className="emr-docnav-repo-filter-glyph" />
              <input
                ref={filterInputRef}
                type="text"
                className="emr-docnav-repo-filter-input"
                placeholder="Filter repositories"
                aria-label="Filter repositories"
                value={filterText}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            className="emr-docnav-repo-list"
            role="listbox"
            aria-label="Repository"
            onScroll={paginated ? onListScroll : undefined}
          >
            {repos.map((r, i) => {
              const isSelected = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`emr-docnav-repo-option${
                    isSelected ? " is-selected" : ""
                  }`}
                  onClick={() => choose(r.id)}
                >
                  <SvgRepo />
                  <span className="emr-docnav-repo-option-name">{r.name}</span>
                  <span
                    className="emr-docnav-repo-option-check"
                    aria-hidden="true"
                  >
                    {isSelected ? <SvgCheck /> : null}
                  </span>
                </button>
              );
            })}
            {paginated ? (
              <div
                className="emr-docnav-repo-status emr-docnav-repo-page-status"
                role={loading ? "status" : undefined}
                aria-hidden={!loading && repos.length > 0 ? "true" : undefined}
              >
                {loading ? (
                  <>
                    <span
                      className="emr-docnav-repo-spinner"
                      aria-hidden="true"
                    />
                    Loading repositories…
                  </>
                ) : repos.length === 0 ? (
                  <>No repositories match “{filterText.trim()}”.</>
                ) : null}
              </div>
            ) : repos.length === 0 ? (
              <div className="emr-docnav-repo-status">
                No repositories match “{filterText.trim()}”.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
