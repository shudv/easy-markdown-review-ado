// DocumentsApp — repo-aware shell for the Documents hub. Renders the same
// three-pane grid as the PR tab (DocNav | ArticleView | CommentRail) by
// feeding `Shell` a synthesized `PrInfo` whose `files` is the repo's doc
// inventory, a repo-scoped `loadFileSource`, and the repo's threads. Loaders
// are agnostic to fixture-vs-live: standalone passes fixture-backed ones, the
// real ADO entry passes `GitRestClient`-backed ones.

import * as React from "react";

import type { CommentThread, PrInfo } from "../types";
import { Shell } from "../shell/Shell";
import type { RoutedPrInfo } from "../shell/Shell";
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

function renderNoRepositories(): React.ReactElement {
  return (
    <div className="emr-error">
      <h2>No repositories</h2>
      <p>This project has no Markdown documents to review.</p>
    </div>
  );
}

type SearchFilesBound = (
  query: string,
  signal?: AbortSignal,
) => Promise<FileSearchOutcome>;
type FetchRemoteThreads = (signal: AbortSignal) => Promise<CommentThread[]>;
type AppProps = Readonly<DocumentsAppProps>;

/** The first repo's id, or `""` when the list is empty. */
function firstRepoId(repos: readonly DocRepo[]): string {
  return repos.length > 0 ? repos[0]!.id : "";
}

/**
 * Everything `DocumentsApp` resolves before its "No repositories" early
 * return, handed to `DocumentsAppBody` with the repo and synthetic PR
 * narrowed to non-null. Splitting at the early return keeps every hook in
 * both components unconditional (rules-of-hooks).
 */
interface DocumentsAppBodyProps {
  appProps: DocumentsAppProps;
  perDocumentMode: boolean;
  selectedRepo: DocRepo;
  selectedRepoId: string;
  syntheticPr: PrInfo;
  handleSelectRepo: (repoId: string) => void;
  /** Owned by `DocumentsApp` (read during its render); latched here. */
  initialPathConsumedRef: { current: boolean };
  deepLinkSeeds: ReturnType<typeof pickDeepLinkSeeds>;
  tree: ReturnType<typeof useLazyTree>;
  handleSearchFiles: SearchFilesBound | undefined;
  setActiveDocPath: ReturnType<typeof useActiveDocPath>[1];
  bindings: ReturnType<typeof useRepoBindings>;
  routedPr: RoutedPrInfo | null;
  gating: ReturnType<typeof resolveCommentGating>;
  fetchRemoteThreads: FetchRemoteThreads | undefined;
  deepLinkBuilder: DeepLinkBuilder | null;
}

export function DocumentsApp(props: AppProps): React.ReactElement {
  const { repos, loadThreadsFor, onSearchFiles } = props;

  // Per-document "transparent PR" mode is enabled when the host supplies a
  // per-document thread loader. In this mode each document owns a dedicated
  // housing PR; the repo-level routing PR / read-only gating is bypassed.
  const perDocumentMode = !!props.loadThreadsForPath;

  const initialRepoId = props.initialRepoId ?? firstRepoId(repos);
  const { selectedRepoId, selectedRepo, handleSelectRepo } = useSelectedRepo(
    repos,
    initialRepoId,
    props.onSelectRepo,
    props.onLoadRepoDetails,
  );

  // Deep-link path (`?path=`). Shell is keyed by repo id, so it only needs
  // to seed the *initial* repo's first mount. Once consumed — or once the user
  // switches repos — it's dropped so it can never override later navigation.
  // NOTE: consumption is latched only once Shell actually mounts (see the
  // `shellMounting` effect in `DocumentsAppBody`), not on this component's
  // mount: in paginated mode the initial repo arrives as a content-less
  // skeleton and Shell is gated behind its details/threads loading, so
  // latching on mount here would drop the deep-link path before Shell ever
  // reads it.
  const initialPathConsumedRef = React.useRef(false);
  const deepLinkSeeds = pickDeepLinkSeeds(
    // eslint-disable-next-line react-hooks/refs -- one-shot latch set when Shell mounts; it must not trigger a re-render, since Shell only reads the seed on its first mount.
    !initialPathConsumedRef.current && selectedRepoId === initialRepoId,
    props,
  );
  const initialSelectedPathForShell = deepLinkSeeds.initialSelectedPath;

  // Threads are NOT fetched up front and awaited before mounting Shell.
  // Instead Shell mounts as soon as the repo's routing is known and loads its
  // threads via the mount-time thread sync (`fetchRemoteThreads` below, which
  // calls the same `loadThreadsFor`), merging them into the rail when they land.
  // This keeps the Markdown render off the thread-fetch critical path — the
  // document paints immediately and comments stream in.

  const tree = useLazyTree(selectedRepo, props.onExpandFolder);

  // Repo-scoped search callback. Returns `undefined` (DocNav local-only
  // filter) when no `onSearchFiles` is wired; otherwise curries the repo id.
  const handleSearchFiles = React.useMemo<SearchFilesBound | undefined>(() => {
    if (!selectedRepo || !onSearchFiles) return undefined;
    const repoIdAtBind = selectedRepo.id;
    return (query: string, signal?: AbortSignal) =>
      onSearchFiles(repoIdAtBind, query, signal);
  }, [selectedRepo, onSearchFiles]);

  const { lazyTree } = tree;
  const syntheticPr: PrInfo | null = React.useMemo(
    () => (selectedRepo ? buildSyntheticPr(selectedRepo, lazyTree) : null),
    [selectedRepo, lazyTree],
  );

  const [activeDocPath, setActiveDocPath] = useActiveDocPath(
    selectedRepoId,
    syntheticPr,
    initialSelectedPathForShell,
    props.onSelectPath,
  );

  const bindings = useRepoBindings(props, selectedRepo, perDocumentMode);

  const routedPr = React.useMemo<RoutedPrInfo | null>(
    () => buildRoutedPr(selectedRepo),
    [selectedRepo],
  );

  const gating = resolveCommentGating(perDocumentMode, selectedRepo);
  const { readOnly } = gating;

  // Background thread sync for the routed PR. Skipped when the repo has no PR.
  // Shell polls this ~30s while visible and merges via `MERGE_REMOTE_THREADS`.
  const fetchRemoteThreads = React.useMemo<
    FetchRemoteThreads | undefined
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

  if (!selectedRepo || !syntheticPr) return renderNoRepositories();

  // Everything past the early return lives in `DocumentsAppBody` so its hooks
  // run unconditionally there, and this component's hook count never changes
  // when the repo list empties/fills or the selected repo disappears.
  return (
    <DocumentsAppBody
      appProps={props}
      perDocumentMode={perDocumentMode}
      selectedRepo={selectedRepo}
      selectedRepoId={selectedRepoId}
      syntheticPr={syntheticPr}
      handleSelectRepo={handleSelectRepo}
      initialPathConsumedRef={initialPathConsumedRef}
      deepLinkSeeds={deepLinkSeeds}
      tree={tree}
      handleSearchFiles={handleSearchFiles}
      setActiveDocPath={setActiveDocPath}
      bindings={bindings}
      routedPr={routedPr}
      gating={gating}
      fetchRemoteThreads={fetchRemoteThreads}
      deepLinkBuilder={deepLinkBuilder}
    />
  );
}

// eslint-disable-next-line max-lines-per-function -- Documents hub body: the refresh state plus the single DocNav/ArticleView/CommentRail layout (loading, empty, and Shell branches) sharing one title slot and header actions. Its data hooks live in their own modules; splitting the JSX would scatter one layout.
function DocumentsAppBody(
  body: Readonly<DocumentsAppBodyProps>,
): React.ReactElement {
  const {
    appProps: props,
    perDocumentMode,
    selectedRepo,
    selectedRepoId,
    syntheticPr,
    initialPathConsumedRef,
    deepLinkSeeds,
    tree: { lazyTree, setLazyTreeByRepo, handleExpandFolder },
    bindings,
    gating: { shellReadOnly, shellReadOnlyMessage },
  } = body;
  const { currentUser, onExpandFolder, onRefreshRepo, onSelectPath } = props;

  // Refresh handler: bust the lazy-tree cache for the current repo and
  // delegate to the host (which flips `detailsLoaded` false then true,
  // remounting Shell with fresh data).
  const [refreshingRepoId, setRefreshingRepoId] = React.useState<string | null>(
    null,
  );
  const handleRefresh = React.useCallback(async () => {
    if (!onRefreshRepo) return;
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
    body.handleSelectRepo,
  );
  const docNavHeaderActions = onRefreshRepo
    ? renderRefreshButton(refreshingRepoId === selectedRepo.id, handleRefresh)
    : null;

  const mentionLinks = buildMentionLinks(
    props.orgUrl,
    props.projectName,
    selectedRepo.name,
  );

  const shellTree = resolveShellTree(
    selectedRepo,
    lazyTree,
    syntheticPr.files.length,
  );

  // Latch the deep-link path as consumed only after Shell has had a chance
  // to read it (`shellMounting` is true on renders where Shell is shown).
  // The ref is read during `DocumentsApp`'s render, so this effect running
  // before the parent's effects in the same commit doesn't change what the
  // next render sees.
  const shellMounting = shellTree.shellMounting;
  React.useEffect(() => {
    if (shellMounting) initialPathConsumedRef.current = true;
  }, [shellMounting, initialPathConsumedRef]);

  // Boot-time completion for the no-content terminal: a repo with no Markdown
  // never mounts Shell (which would otherwise fire the "content" signal), so
  // mark boot ready as "empty" here. Idempotent — if a doc later renders,
  // Shell's "content" already won.
  const isEmptyRepo = shellTree.isEmptyRepo;
  React.useEffect(() => {
    if (isEmptyRepo) markAppReady("empty");
  }, [isEmptyRepo]);

  const routing = repoLevelRouting(perDocumentMode, {
    commentApi: bindings.commentApi,
    routedPr: body.routedPr,
    fetchRemoteThreads: body.fetchRemoteThreads,
  });

  return (
    <MentionLinkContext.Provider value={mentionLinks}>
      <DeepLinkContext.Provider value={body.deepLinkBuilder}>
        <div className="emr-docs-app">
          {/*
            Shell mounts as soon as the repo's routing is known — it does NOT
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
            // Key on the repo id so Shell remounts on repo switch — it holds
            // per-file HTML caches and selected-path state in local hooks.
            <Shell
              key={selectedRepo.id}
              pr={syntheticPr}
              loadFileSource={bindings.repoScopedLoader}
              resolveDocumentImage={bindings.resolveDocumentImageBound}
              diffsByFile={{}}
              initialThreads={EMPTY_THREADS}
              currentUser={currentUser}
              draftScope="hub"
              documentsMode
              commentApi={routing.commentApi}
              commentApiForPath={bindings.commentApiForPathBound}
              loadThreadsForPath={bindings.loadThreadsForPathBound}
              routedPrForPath={bindings.routedPrForPathBound}
              loadDocHistory={bindings.loadDocHistoryBound}
              loadThreadsForPr={bindings.loadThreadsForPrBound}
              loadFileSourceAt={bindings.loadFileSourceAtBound}
              readOnly={shellReadOnly}
              readOnlyMessage={shellReadOnlyMessage}
              routedPr={routing.routedPr}
              fetchRemoteThreads={routing.fetchRemoteThreads}
              unloadedFolders={shellTree.unloadedFolders}
              onExpandFolder={onExpandFolder ? handleExpandFolder : undefined}
              folderOrders={lazyTree?.folderOrders}
              listFolder={bindings.listSubpageFolderBound}
              onSearchFiles={body.handleSearchFiles}
              docNavTitleSlot={docNavTitleSlot}
              onRefreshFiles={onRefreshRepo ? handleRefresh : undefined}
              feedbackEmail="shubd3@gmail.com"
              initialSelectedPath={deepLinkSeeds.initialSelectedPath}
              initialActiveThreadId={deepLinkSeeds.initialActiveThreadId}
              initialAnchor={deepLinkSeeds.initialAnchor}
              initialTextFragment={deepLinkSeeds.initialTextFragment}
              onSelectPath={(path) => {
                body.setActiveDocPath(path);
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
