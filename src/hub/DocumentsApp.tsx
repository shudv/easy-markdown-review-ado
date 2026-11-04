// DocumentsApp — repo-aware shell for the Documents hub. Renders the same
// three-pane grid as the PR tab (DocNav | ArticleView | CommentRail) by
// feeding `PrShell` a synthesized `PrInfo` whose `files` is the repo's doc
// inventory, a repo-scoped `loadFileSource`, and the repo's threads. Loaders
// are agnostic to fixture-vs-live: standalone passes fixture-backed ones, the
// real ADO entry passes `GitRestClient`-backed ones.

import * as React from "react";

import type { CommentThread, PrInfo } from "../types";
import { PrShell } from "../shell/PrShell";
import type { RoutedPrInfo } from "../shell/PrShell";
import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import { MentionLinkContext } from "../comments/mentionLinks";
import {
  DeepLinkContext,
  type DeepLinkBuilder,
  type DeepLinkTarget,
} from "../shell/deepLink";
import { refreshHostTheme } from "../theme/theme";
import { markAppReady } from "../telemetry";

import type { DocRepo } from "../shell/types";
import type { FileSearchOutcome } from "../shell/almSearch";
import {
  buildMentionLinks,
  buildRoutedPr,
  buildSyntheticPr,
  pickDeepLinkSeeds,
  resolveCommentGating,
  resolveShellTree,
} from "./documentsApp.helpers";
import type { DocumentsAppProps } from "./documentsAppProps";
import { useSelectedRepo } from "./useSelectedRepo";
import { useLazyTree } from "./useLazyTree";
import { useActiveDocPath } from "./useActiveDocPath";
import { useRepoBindings } from "./useRepoBindings";
import { RepoPicker } from "./RepoPicker";
import { DocsEmptyShell } from "./DocsEmptyShell";
import { SvgRefresh, SvgRepo } from "./hubIcons";

/** Stable empty seed for per-document mode (threads load lazily per file). */
const EMPTY_THREADS: CommentThread[] = [];

/**
 * Repo-level comment routing (single routing PR + background thread sync).
 * Bypassed in per-document mode, where each document owns its housing PR.
 */
function repoLevelRouting<T extends object>(
  perDocumentMode: boolean,
  routing: T,
): Partial<T> {
  return perDocumentMode ? {} : routing;
}

/**
 * The DocNav title slot: the in-hub repo selector, or a static label for a
 * single non-paginated repo.
 */
function renderDocNavTitleSlot(
  props: DocumentsAppProps,
  selectedRepo: DocRepo,
  onSelect: (repoId: string) => void,
): React.ReactElement {
  const { repos } = props;
  const paginated = !!props.onFilterRepos;
  if (paginated || repos.length > 1) {
    return (
      <RepoPicker
        repos={props.repoPickerView ?? repos}
        selectedId={selectedRepo.id}
        selectedName={selectedRepo.name}
        onSelect={onSelect}
        paginated={paginated}
        filter={props.repoFilter ?? ""}
        hasMore={props.reposHasMore ?? false}
        loading={props.reposLoading ?? false}
        onLoadMore={props.onLoadMoreRepos}
        onFilter={props.onFilterRepos}
      />
    );
  }
  return (
    <span className="emr-docnav-title" title={selectedRepo.name}>
      <SvgRepo />
      <span className="emr-docnav-repo-name">{selectedRepo.name}</span>
    </span>
  );
}

function renderRefreshButton(
  refreshing: boolean,
  onRefresh: () => Promise<void>,
): React.ReactElement {
  return (
    <button
      type="button"
      className="emr-icon-btn emr-docs-refresh-btn"
      onClick={() => {
        void onRefresh();
      }}
      disabled={refreshing}
      aria-label="Refresh repository contents and PR routing"
      title="Refresh repository contents and PR routing"
    >
      <SvgRefresh spinning={refreshing} />
    </button>
  );
}

// eslint-disable-next-line max-lines-per-function -- Documents hub container: wires repo selection, the lazy file tree and the active document into PrShell in one render. Its hooks already live in their own modules; splitting the JSX would scatter one layout.
export function DocumentsApp(props: DocumentsAppProps): React.ReactElement {
  const {
    repos,
    loadThreadsFor,
    currentUser,
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

  const initialRepoId = props.initialRepoId ?? repos[0]?.id ?? "";
  const { selectedRepoId, selectedRepo, handleSelectRepo } = useSelectedRepo(
    repos,
    initialRepoId,
    onSelectRepo,
    onLoadRepoDetails,
  );

  // Deep-link path (`?path=`). PrShell is keyed by repo id, so it only needs
  // to seed the *initial* repo's first mount. Once consumed — or once the user
  // switches repos — it's dropped so it can never override later navigation.
  // NOTE: consumption is latched only once PrShell actually mounts (see the
  // `prShellMounting` effect below), not on this component's mount: in
  // paginated mode the initial repo arrives as a content-less skeleton and
  // PrShell is gated behind its details/threads loading, so latching on mount
  // here would drop the deep-link path before PrShell ever reads it.
  const initialPathConsumedRef = React.useRef(false);
  const deepLinkSeeds = pickDeepLinkSeeds(
    !initialPathConsumedRef.current && selectedRepoId === initialRepoId,
    props,
  );
  const initialSelectedPathForShell = deepLinkSeeds.initialSelectedPath;

  // Threads are NOT fetched up front and awaited before mounting PrShell.
  // Instead PrShell mounts as soon as the repo's routing is known and loads its
  // threads via the mount-time thread sync (`fetchRemoteThreads` below, which
  // calls the same `loadThreadsFor`), merging them into the rail when they land.
  // This keeps the Markdown render off the thread-fetch critical path — the
  // document paints immediately and comments stream in.

  const { lazyTree, setLazyTreeByRepo, handleExpandFolder } = useLazyTree(
    selectedRepo,
    onExpandFolder,
  );

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

  const syntheticPr: PrInfo | null = React.useMemo(
    () => (selectedRepo ? buildSyntheticPr(selectedRepo, lazyTree) : null),
    [selectedRepo, lazyTree],
  );

  const [activeDocPath, setActiveDocPath] = useActiveDocPath(
    selectedRepoId,
    syntheticPr,
    initialSelectedPathForShell,
    onSelectPath,
  );

  const {
    repoScopedLoader,
    resolveDocumentImageBound,
    commentApi,
    commentApiForPathBound,
    loadThreadsForPathBound,
    routedPrForPathBound,
    loadDocHistoryBound,
    loadThreadsForPrBound,
    loadFileSourceAtBound,
    listSubpageFolderBound,
  } = useRepoBindings(props, selectedRepo, perDocumentMode);

  const routedPr = React.useMemo<RoutedPrInfo | null>(
    () => buildRoutedPr(selectedRepo),
    [selectedRepo],
  );

  const { readOnly, shellReadOnly, shellReadOnlyMessage } =
    resolveCommentGating(perDocumentMode, selectedRepo);

  // Background thread sync for the routed PR. Skipped when the repo has no PR.
  // PrShell polls this ~30s while visible and merges via `MERGE_REMOTE_THREADS`.
  const fetchRemoteThreads = React.useMemo<
    ((signal: AbortSignal) => Promise<CommentThread[]>) | undefined
  >(() => {
    if (!selectedRepo || readOnly) return undefined;
    const repoIdAtBind = selectedRepo.id;
    return async (_signal: AbortSignal) => loadThreadsFor(repoIdAtBind);
  }, [selectedRepo, readOnly, loadThreadsFor]);

  // Shareable-link builder for the active document. Closes over the current
  // repo + path so callers only pass the target (thread or heading). Null when
  // the host can't build a shareable URL (standalone). Declared before the
  // early return below so the hook order is stable across renders.
  const buildDeepLinkFor = props.buildDeepLink;
  const deepLinkBuilder = React.useMemo<DeepLinkBuilder | null>(
    () =>
      buildDeepLinkFor
        ? (target: DeepLinkTarget) =>
            buildDeepLinkFor(selectedRepoId, activeDocPath, target)
        : null,
    [buildDeepLinkFor, selectedRepoId, activeDocPath],
  );

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
  }, [selectedRepo, onRefreshRepo, setLazyTreeByRepo]);

  // The DocNav header hosts the in-hub repo selector (the host never gives us
  // the selected repo, so this is the only way to switch). The repo name in the
  // header is itself the trigger — clicking it opens an inline dropdown of the
  // project's repos with a keyword filter and scroll-paginated loading. With a
  // single non-paginated repo it degrades to a static label. Lives in the
  // DocNav title slot so the hub mirrors the PR tab's layout without a separate
  // header strip.
  const docNavTitleSlot = renderDocNavTitleSlot(
    props,
    selectedRepo,
    handleSelectRepo,
  );
  const docNavHeaderActions = onRefreshRepo
    ? renderRefreshButton(refreshingRepoId === selectedRepo.id, handleRefresh)
    : null;

  const mentionLinks = buildMentionLinks(
    orgUrl,
    projectName,
    selectedRepo.name,
  );

  const shellTree = resolveShellTree(
    selectedRepo,
    lazyTree,
    syntheticPr.files.length,
  );

  // Latch the deep-link path as consumed only after PrShell has had a chance
  // to read it (`prShellMounting` is true on renders where PrShell is shown).
  const prShellMounting = shellTree.prShellMounting;
  React.useEffect(() => {
    if (prShellMounting) initialPathConsumedRef.current = true;
  }, [prShellMounting]);

  // Boot-time completion for the no-content terminal: a repo with no Markdown
  // never mounts PrShell (which would otherwise fire the "content" signal), so
  // mark boot ready as "empty" here. Idempotent — if a doc later renders,
  // PrShell's "content" already won.
  const isEmptyRepo = shellTree.isEmptyRepo;
  React.useEffect(() => {
    if (isEmptyRepo) markAppReady("empty");
  }, [isEmptyRepo]);

  const routing = repoLevelRouting(perDocumentMode, {
    commentApi,
    routedPr,
    fetchRemoteThreads,
  });

  return (
    <MentionLinkContext.Provider value={mentionLinks}>
      <DeepLinkContext.Provider value={deepLinkBuilder}>
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
              commentApi={routing.commentApi}
              commentApiForPath={commentApiForPathBound}
              loadThreadsForPath={loadThreadsForPathBound}
              routedPrForPath={routedPrForPathBound}
              loadDocHistory={loadDocHistoryBound}
              loadThreadsForPr={loadThreadsForPrBound}
              loadFileSourceAt={loadFileSourceAtBound}
              readOnly={shellReadOnly}
              readOnlyMessage={shellReadOnlyMessage}
              routedPr={routing.routedPr}
              fetchRemoteThreads={routing.fetchRemoteThreads}
              unloadedFolders={shellTree.unloadedFolders}
              onExpandFolder={onExpandFolder ? handleExpandFolder : undefined}
              folderOrders={lazyTree?.folderOrders}
              listFolder={listSubpageFolderBound}
              onSearchFiles={handleSearchFiles}
              docNavTitleSlot={docNavTitleSlot}
              onRefreshFiles={onRefreshRepo ? handleRefresh : undefined}
              feedbackEmail="shubd3@gmail.com"
              initialSelectedPath={initialSelectedPathForShell}
              initialActiveThreadId={deepLinkSeeds.initialActiveThreadId}
              initialAnchor={deepLinkSeeds.initialAnchor}
              initialTextFragment={deepLinkSeeds.initialTextFragment}
              onSelectPath={(path) => {
                setActiveDocPath(path);
                onSelectPath?.(selectedRepoId, path);
              }}
              onActiveThreadChange={(threadId) =>
                props.onActiveThreadChange?.(selectedRepoId, threadId)
              }
              onHeadingLinkCopied={(anchor) =>
                props.onHeadingLinkCopied?.(selectedRepoId, anchor)
              }
              onTextLinkCopied={(text, anchor) =>
                props.onTextLinkCopied?.(selectedRepoId, text, anchor)
              }
              onDocNavigate={(target) =>
                props.onDocNavigate?.(selectedRepoId, target)
              }
            />
          )}
        </div>
      </DeepLinkContext.Provider>
    </MentionLinkContext.Provider>
  );
}
