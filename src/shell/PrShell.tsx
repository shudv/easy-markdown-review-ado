import type { DocumentImageResolver } from "../markdown/documentImages";
import type { ReaderActivity } from "./components/readerActivity";
// PrShell — shared shell for both the real ADO PR tab and the standalone
// dev preview. Owns the selected file, view mode, thread store, active
// thread, and draft anchor. All data arrives via props so callers can swap
// fixtures for live ADO data without changing this component.

import * as React from "react";

import type {
  ChangeType,
  CommentAuthor,
  CommentThread,
  DiffRange,
  FileInfo,
  PrInfo,
} from "../types";
import type { FileSearchOutcome } from "./almSearch";
import type { CommentApi } from "../comments/api";
import { IdentityStoreContext } from "../comments/identityStore";
import { ArticleView, type AnchorLayout } from "./components/ArticleView";
import { DiffMinimap } from "./components/DiffMinimap";
import { CommentRail } from "./components/CommentRail";
import { DocNav } from "./components/DocNav";
import { ReaderStatusBar } from "./components/ReaderStatusBar";
import {
  allReviewIterations,
  buildReaderActivities,
  type DocPrRef,
  type HistoryStop,
  type ReviewIterationRange,
} from "./prShellHelpers";
import type { FolderLister } from "./wikiOrder";
import type { DraftScope } from "./draftStorage";
import type { DocLinkNavigation, RoutedPrInfo } from "./prShell/types";
import {
  appClassName,
  commentAccess,
  documentReadOnly,
  feedbackHrefFor,
  paneLayout,
  pickInitialPath,
  railChrome,
  readerStyleFor,
  statusBarExtras,
} from "./prShell/derive";
import { useCommentApiRouting } from "./prShell/useCommentApiRouting";
import { useReaderToggles } from "./prShell/useReaderToggles";
import { useReaderPrefs } from "./prShell/useReaderPrefs";
import { usePaneResize } from "./prShell/usePaneResize";
import { useDraftController } from "./prShell/useDraftController";
import { useReviewHistory } from "./prShell/useReviewHistory";
import { useThreadStore } from "./prShell/useThreadStore";
import { useHistoryLoaders } from "./prShell/useHistoryLoaders";
import { useDocumentSource } from "./prShell/useDocumentSource";
import { useThreadViews } from "./prShell/useThreadViews";
import { useActiveThreadEffects } from "./prShell/useActiveThreadEffects";
import { useDocScroll } from "./prShell/useDocScroll";
import {
  useDocNavigation,
  usePendingDocScroll,
} from "./prShell/useDocNavigation";
import { useLinkCopy } from "./prShell/useLinkCopy";
import { useThreadSelection } from "./prShell/useThreadSelection";
import { useCommentWrites } from "./prShell/useCommentWrites";
import { useCommentPosting } from "./prShell/useCommentPosting";
import { useThreadMutations } from "./prShell/useThreadMutations";
import { useActiveArticle } from "./prShell/useActiveArticle";
import { useActiveDiff } from "./prShell/useActiveDiff";
import { useTooNarrow } from "./prShell/useTooNarrow";
import { useIterationControls } from "./prShell/useIterationControls";
import { useRailModel } from "./prShell/useRailModel";
import { CommentApiScope } from "./prShell/CommentApiScope";
import { ShellNotices } from "./prShell/ShellNotices";
import { NavPane } from "./prShell/NavPane";
import { ArticleColumn } from "./prShell/ArticleColumn";
import { RailPane } from "./prShell/RailPane";
import { PaneReopenGrabbers } from "./prShell/PaneReopenGrabbers";
import { TooNarrowNotice } from "./prShell/TooNarrowNotice";

export type { DocLinkNavigation, RoutedPrInfo } from "./prShell/types";

interface PrShellProps {
  pr: PrInfo;
  /** Async loader for the Markdown source of a given file path. */
  loadFileSource: (path: string) => Promise<string>;
  diffsByFile: Record<string, DiffRange[]>;
  /** Complete base-commit Markdown by file, used for trustworthy old-block reconstruction. */
  originalSourcesByFile?: Record<string, string>;
  /** Initial threads — both current and historical, mixed. */
  initialThreads: CommentThread[];
  currentUser: CommentAuthor;
  /**
   * Persistence boundary for thread mutations. Defaults to an in-memory
   * implementation; the real ADO PR tab passes an `AdoCommentApi` instance.
   */
  commentApi?: CommentApi;
  /** Read-only mode: suppresses selection bubbles, draft and reply composers, and shows a banner. */
  readOnly?: boolean;
  /** Message shown in the read-only banner. */
  readOnlyMessage?: string;
  /** PR these comments route through; renders a pill at the top of the comment column. */
  routedPr?: RoutedPrInfo | null;
  /**
   * Per-document routed-PR resolver (Documents hub per-document routing). When
   * provided, the rail PR pill reflects the *selected file's* routing PR
   * instead of the single `routedPr` prop — each document's comments route to
   * the most recent completed PR that changed it. Returns undefined until the
   * routing PR resolves, so the pill simply stays hidden until then.
   */
  routedPrForPath?: (path: string) => RoutedPrInfo | null | undefined;
  /** Folder paths known to exist but not yet enumerated; forwarded to DocNav. */
  unloadedFolders?: ReadonlyArray<string>;
  /** Lazy folder expansion; undefined when every file is already loaded. */
  onExpandFolder?: (
    path: string,
  ) => Promise<{ files: FileInfo[]; folders: string[] } | null>;
  /**
   * Azure DevOps wiki `.order` page names per folder (slash-free path, `""`
   * for the root), forwarded to DocNav so wiki repos list pages in order.
   */
  folderOrders?: Readonly<Record<string, readonly string[]>>;
  /**
   * Lists a repository folder, for a document's `[[_TOSP_]]` (table of
   * subpages) macro. Omitted where folders can't be listed; the macro then
   * says subpages aren't available.
   */
  listFolder?: FolderLister;
  /** Async filename search; omitted in standalone (DocNav falls back to local filter). */
  onSearchFiles?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<FileSearchOutcome>;
  /** Replaces the static "Documents" title in the doc-nav header. */
  docNavTitleSlot?: React.ReactNode;
  /**
   * Host-provided reload of the file list / repo contents. Wired into the
   * reading toolbar's unified refresh (which also re-syncs comments); omitted
   * when the surface has no remote file listing to refresh.
   */
  onRefreshFiles?: () => void | Promise<void>;
  /**
   * Contact address for the subtle "share feedback / report a bug" pill pinned
   * to the bottom-right of the reader. When omitted the pill is hidden.
   */
  feedbackEmail?: string;
  /**
   * Loader for a fresh snapshot of remote threads. When set, the shell polls it
   * on a visibility-aware cadence and merges each snapshot via MERGE_REMOTE_THREADS
   * (preserving optimistic writes). Undefined disables background sync.
   */
  fetchRemoteThreads?: (signal: AbortSignal) => Promise<CommentThread[]>;
  /** Visible-tab poll cadence in milliseconds. Default 30_000. */
  threadSyncIntervalMs?: number;
  /**
   * Single-file mode (used by the in-context "Open in Markdown Review" side
   * panel). Hides the DocNav file tree entirely and collapses the grid to two
   * columns (article + comment rail). The shell still selects `pr.files[0]`,
   * so callers pass a one-file `PrInfo`. All comment behaviour is unchanged.
   */
  hideDocNav?: boolean;
  /**
   * Per-document comment routing (Documents hub "transparent PR" mode). When
   * provided, the shell resolves the active `CommentApi` from the *selected
   * file* instead of using the single `commentApi` prop — each document's
   * comments are persisted to its own dedicated housing PR. Existing consumers
   * (PR tab, standalone) don't pass this and keep the single-api behaviour.
   */
  commentApiForPath?: (path: string) => CommentApi | undefined;
  /**
   * Per-document thread loader (Documents hub "transparent PR" mode). When
   * provided, the shell loads the selected file's threads on demand (and polls
   * the active file) instead of receiving a single `initialThreads` snapshot.
   */
  loadThreadsForPath?: (path: string) => Promise<CommentThread[]>;
  /**
   * Comment-history stepper (Documents hub). The three loaders below are
   * provided together; when all are present the comment rail grows ‹ ›
   * chevrons that walk the document's review history PR-to-PR. Each historical
   * "stop" shows the document as it was at that PR's merge commit plus that
   * PR's comments, read-only. The live head ("Current") stays writable.
   */
  /** Loads a document's review-history stops (completed PRs, most recent first). */
  loadDocHistory?: (path: string) => Promise<DocPrRef[]>;
  /** Loads a historical PR's threads for the file (read-only stop view). */
  loadThreadsForPr?: (prId: number, path: string) => Promise<CommentThread[]>;
  /** Loads the document's Markdown source at a specific commit (a history stop). */
  loadFileSourceAt?: (path: string, commitId: string) => Promise<string>;
  /** Native iterations of the current PR, newest first with Latest at index 0. */
  reviewIterationStops?: readonly HistoryStop[];
  /** Merge base used for Update 1 and the dedicated All updates comparison. */
  reviewIterationBaseCommit?: string;
  /**
   * Comparison of PR updates to open with (from a shared link's
   * `iteration`/`base`). Defaults to "All updates".
   */
  initialIterationRange?: ReviewIterationRange;
  /**
   * Called when the compared PR updates change, so the host can mirror them
   * into the route and shared links. `null` means "All updates".
   */
  onIterationRangeChange?: (range: ReviewIterationRange | null) => void;
  /**
   * Which Markdown files a comparison of PR updates touches, by change type
   * (keyed by repo path). Lets the file list mark the files the selected
   * updates changed and dim the rest.
   */
  loadRangeChanges?: (
    range: ReviewIterationRange,
  ) => Promise<Readonly<Record<string, ChangeType>>>;
  /**
   * Seeds the initially-selected document (deep-link routing, `?path=`). When
   * omitted the shell selects `pr.files[0]`. Read once at mount — a path that
   * isn't in `pr.files` still renders, since `loadFileSource` loads any path.
   */
  initialSelectedPath?: string;
  /**
   * Called whenever the user opens a different document from the nav, so the
   * host can reflect the active file in the route (`?path=`).
   */
  onSelectPath?: (path: string) => void;
  /**
   * Navigate to a document/file this reader can't open in place: a relative
   * Markdown link pointing outside the current PR (→ Documents hub) or a
   * non-Markdown file (→ ADO's native Files view). In-PR / in-hub Markdown
   * links and in-page anchors are handled in place. Omitted in embeds without
   * host navigation.
   */
  onDocNavigate?: (target: DocLinkNavigation) => void;
  /** Resolve a repository image for the active document/version. */
  resolveDocumentImage?: DocumentImageResolver;
  /**
   * Deep-link target (`?comment=`): a thread to activate + scroll into view
   * once it renders. Consumed once — the shell waits for the thread's anchor
   * to mount (the linked document's threads may still be loading), then
   * highlights it and centers it, after which the seed is dropped so later
   * navigation isn't hijacked.
   */
  initialActiveThreadId?: string;
  /**
   * Called whenever the active comment thread changes (selected, deep-linked,
   * or cleared), so the host can keep the route's `?comment=` param in sync —
   * the inverse of `initialActiveThreadId`. This makes deep-linking two-way:
   * selecting a comment produces the same shareable URL the "Link to comment"
   * action would. `null` means no thread is active (param should be removed).
   */
  onActiveThreadChange?: (threadId: string | null) => void;
  /**
   * Deep-link target (`?anchor=`): a heading slug to scroll to once the
   * initially selected document renders. Collapsed sections hiding it are
   * expanded and the heading is held in view while late content settles.
   * Ignored when `initialActiveThreadId` is also set (the comment wins).
   * ADO/GitHub-style slugs (`a-&-b`) are matched onto ours (`a-b`).
   */
  initialAnchor?: string;
  /**
   * Called after the user copies a heading link, with the heading's slug, so
   * the host can mirror it into the route's `?anchor=` param (the address bar
   * then holds the same shareable link, as in ADO's own Markdown preview).
   * The copy affordance itself needs a `DeepLinkContext` builder from the host.
   */
  onHeadingLinkCopied?: (anchor: string) => void;
  /**
   * Deep-link target (`?text=`): a serialized text fragment to scroll to and
   * flash once the initially selected document renders. When the text can't
   * be found (edited since the link was made), `initialAnchor` — the section
   * it was in — is used instead. A `?comment=` link wins over both.
   */
  initialTextFragment?: string;
  /**
   * Called after the user copies a link to selected text, so the host can
   * mirror it into the route's `?text=` (and fallback `?anchor=`) params.
   */
  onTextLinkCopied?: (text: string, anchor: string | undefined) => void;
  /**
   * Which review experience this shell renders, used to (a) namespace the
   * locally-persisted comment draft (one per experience) and (b) drop the
   * routed-PR pill in the PR tab, where it's implicit. Omitted disables draft
   * persistence (standalone/preview embeds).
   */
  draftScope?: DraftScope;
  /** Enables Documents Hub routing behavior and layout-specific chrome. */
  documentsMode?: boolean;
}

export function PrShell(props: PrShellProps): React.ReactElement {
  const { pr, loadFileSource, initialThreads, currentUser } = props;

  // ---- state ----
  const [selectedPath, setSelectedPath] = React.useState<string>(() =>
    pickInitialPath(props.initialSelectedPath, pr.files),
  );
  // Effective CommentApi, routed-PR pill and shared identity store for the
  // selected document.
  const routing = useCommentApiRouting({
    commentApi: props.commentApi,
    commentApiForPath: props.commentApiForPath,
    routedPr: props.routedPr,
    routedPrForPath: props.routedPrForPath,
    selectedPath,
  });
  const { identityStore, commentApi, routedPrResolution, effectiveRoutedPr } =
    routing;
  const { effectiveReadOnly, effectiveReadOnlyMessage } = documentReadOnly(
    props.readOnly,
    props.readOnlyMessage,
    routing.perDocNoWriteTarget,
  );

  // Latest selected path for the visibility-aware poller (so its fetch closure
  // stays stable while always targeting the current document).
  const selectedPathRef = React.useRef(selectedPath);
  React.useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);
  const toggles = useReaderToggles();
  const { commentQuery, commentFilter, onlyThisFile } = toggles;
  // Reader preferences, restored from + persisted to localStorage (scoped to
  // this surface: PR tab vs Documents hub).
  const prefs = useReaderPrefs(props.draftScope);
  const { readerPrefs } = prefs;
  const resize = usePaneResize(readerPrefs, prefs.setReaderPrefs);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  );

  // The routed-PR pill is redundant in the PR tab (comments obviously belong to
  // the current PR), so suppress it there.
  const hidePrPill = props.draftScope === "pr";

  // The Documents Hub reviews a SINGLE file at a time against the latest master
  // (it merely borrows a completed PR — possibly one of several — to host the
  // threads). So the cross-file trays don't belong there: General/Overview
  // notes aren't about this document, and "files no longer in this PR" is
  // meaningless when there's no change-set (and the hub's file list is a lazily
  // loaded partial tree, so an ∉-files test would false-positive on
  // not-yet-expanded folders). In the hub we therefore render ONLY the threads
  // anchored to the open file.
  const isHub = props.draftScope === "hub";

  const drafts = useDraftController({
    draftScope: props.draftScope,
    selectedPath,
    selectedPathRef,
    revealComments: prefs.revealComments,
    setActiveThreadId,
  });
  const { dismissEmptyDraftRef, setDraftY } = drafts;

  const history = useReviewHistory({
    selectedPath,
    effectiveRoutedPr,
    loadDocHistory: props.loadDocHistory,
    loadThreadsForPr: props.loadThreadsForPr,
    loadFileSourceAt: props.loadFileSourceAt,
    reviewIterationStops: props.reviewIterationStops,
    reviewIterationBaseCommit: props.reviewIterationBaseCommit,
    initialIterationRange: props.initialIterationRange,
    onIterationRangeChange: props.onIterationRangeChange,
    loadRangeChanges: props.loadRangeChanges,
  });
  const { nativeIterationMode, viewingHistorical, activeStop } = history;

  const store = useThreadStore({
    initialThreads,
    currentUser,
    identityStore,
    selectedPath,
    selectedPathRef,
    fetchRemoteThreads: props.fetchRemoteThreads,
    loadThreadsForPath: props.loadThreadsForPath,
    threadSyncIntervalMs: props.threadSyncIntervalMs,
    onRefreshFiles: props.onRefreshFiles,
  });
  const { threadState, threadSync } = store;

  const historical = useHistoryLoaders({
    ...history,
    selectedPath,
    reviewIterationBaseCommit: props.reviewIterationBaseCommit,
    loadDocHistory: props.loadDocHistory,
    loadThreadsForPr: props.loadThreadsForPr,
    loadFileSourceAt: props.loadFileSourceAt,
  });

  const doc = useDocumentSource(selectedPath, loadFileSource);
  const { htmlByPath, renderVersion } = doc;
  const [navigationActivities, setNavigationActivities] = React.useState<
    readonly ReaderActivity[]
  >([]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------
  const views = useThreadViews({
    threadState,
    selectedPath,
    files: pr.files,
    isHub,
    viewingHistorical,
    nativeIterationMode,
    activeStopPrId: activeStop.prId,
    historicalThreadsByKey: historical.historicalThreadsByKey,
    commentQuery,
    commentFilter,
    currentUserId: currentUser.id,
  });

  // -------------------------------------------------------------------------
  // Anchor layout (Y positions) — reported by ArticleView via callback.
  // -------------------------------------------------------------------------
  const [anchorLayout, setAnchorLayout] = React.useState<AnchorLayout>({
    yByThreadId: new Map(),
    orphanedThreadIds: [],
  });

  const onAnchorsResolved = React.useCallback(
    (layout: AnchorLayout, dY: number | null) => {
      setAnchorLayout(layout);
      setDraftY(dY);
    },
    [setDraftY],
  );

  useActiveThreadEffects({
    activeThreadId,
    setActiveThreadId,
    dismissEmptyDraftRef,
    initialActiveThreadId: props.initialActiveThreadId,
    onActiveThreadChange: props.onActiveThreadChange,
    selectedPath,
    threadState,
    prThreadSnapshots: store.prThreadSnapshots,
    renderVersion,
    anchorLayout,
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const scroll = useDocScroll(selectedPath);
  const { scrollDocToHash, scrollDocToText } = scroll;
  const nav = useDocNavigation({
    initialActiveThreadId: props.initialActiveThreadId,
    initialAnchor: props.initialAnchor,
    initialTextFragment: props.initialTextFragment,
    documentsMode: props.documentsMode,
    files: pr.files,
    selectedPath,
    isHub,
    missingDoc: doc.missingDoc,
    onSelectPath: props.onSelectPath,
    onDocNavigate: props.onDocNavigate,
    setSelectedPath,
    setActiveThreadId,
    setMissingDoc: doc.setMissingDoc,
    setLoading: doc.setLoading,
    dismissEmptyDraftRef,
    handleMissingDocRef: doc.handleMissingDocRef,
    scrollDocToHash,
  });

  // Cross-document `#anchor` and the `?anchor=` deep link: see the effect
  // placed after the active article's render state (`articleReady`).

  const links = useLinkCopy(props.onHeadingLinkCopied, props.onTextLinkCopied);
  const selection = useThreadSelection({
    setActiveThreadId,
    scrollDocToAnchor: scroll.scrollDocToAnchor,
    requestDraft: drafts.requestDraft,
    selectedPathRef,
    nativeIterationMode,
    viewingHistorical,
    htmlByPath,
  });

  const writes = useCommentWrites();
  const posting = useCommentPosting({
    commentApi,
    persistWith: writes.persistWith,
    dispatch: store.dispatch,
    currentUser,
    identityStore,
    selectedPath,
    sourceByPath: doc.sourceByPath,
    draftAnchor: drafts.draftAnchor,
    activeDraftRef: drafts.activeDraftRef,
    draft: drafts.draft,
    isStillPostedDraft: drafts.isStillPostedDraft,
    setActiveDraft: drafts.setActiveDraft,
    setDraftY,
    setActiveThreadId,
  });
  const mutations = useThreadMutations({
    commentApi,
    persistWith: writes.persistWith,
    dispatch: store.dispatch,
    currentUser,
    threadsById: threadState.threadsById,
    setActiveThreadId,
  });

  // -------------------------------------------------------------------------
  // Refs for components that need to measure the article
  // -------------------------------------------------------------------------
  const articleWrapRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // ArticleView renders the single `.emr-article-wrap`; read it from the DOM
  // after each render rather than threading a ref through.
  React.useLayoutEffect(() => {
    articleWrapRef.current = document.querySelector(".emr-article-wrap");
  }, [renderVersion, anchorLayout]);

  const article = useActiveArticle({
    ...historical,
    selectedPath,
    files: pr.files,
    htmlByPath,
    diffsByFile: props.diffsByFile,
    originalSourcesByFile: props.originalSourcesByFile,
    viewingHistorical,
    comparingIterations: history.comparingIterations,
    activeStop,
    toUpdate: history.resolvedIterationRange.range.toUpdate,
    listFolder: props.listFolder,
    resolveDocumentImage: props.resolveDocumentImage,
    activeStorageKeyRef: scroll.activeStorageKeyRef,
  });
  const { historicalLoading } = article;
  const readerActivities = React.useMemo(
    () =>
      buildReaderActivities({
        navigationActivities,
        commentSyncing: threadSync.isRefreshing,
        fileRefreshing: store.fileRefreshInFlight,
        historicalLoading,
        documentLoading: doc.loading,
      }),
    [
      navigationActivities,
      threadSync.isRefreshing,
      store.fileRefreshInFlight,
      historicalLoading,
      doc.loading,
    ],
  );

  // Cross-document `#anchor`: once the newly selected doc has rendered, scroll
  // to its heading (a same-doc anchor scrolls immediately in handleDocLink).
  // Also consumes the `?anchor=` deep link seeded at mount.
  usePendingDocScroll({
    articleReady: article.articleReady,
    selectedPath,
    activePristineHtml: article.activePristineHtml,
    pendingScrollHashRef: nav.pendingScrollHashRef,
    pendingHashIsDeepLinkRef: nav.pendingHashIsDeepLinkRef,
    pendingTextRef: nav.pendingTextRef,
    scrollDocToHash,
    scrollDocToText,
  });
  const diff = useActiveDiff({
    ...article,
    selectedPath,
    sourceByPath: doc.sourceByPath,
    historicalSourceByKey: historical.historicalSourceByKey,
    historicalContentKey: historical.historicalContentKey,
    baselineContentKey: historical.baselineContentKey,
    comparingIterations: history.comparingIterations,
    viewingHistorical,
    diffHidden: toggles.diffHidden,
  });
  const access = commentAccess({
    viewingHistorical,
    nativeIterationMode,
    activeStop,
    effectiveRoutedPr,
    routedPrResolution,
    documentsMode: props.documentsMode,
    currentFileChangeType: article.currentFileChangeType,
    effectiveReadOnly,
    effectiveReadOnlyMessage,
  });
  const { commentsAvailable, activeReadOnly, activeRoutedPr } = access;
  resize.commentsAvailableRef.current = commentsAvailable;
  const tooNarrow = useTooNarrow(
    resize.bodyFrameRef,
    props.hideDocNav,
    commentsAvailable,
    readerPrefs,
  );
  const controls = useIterationControls({
    completedPrHistoryEnabled: history.completedPrHistoryEnabled,
    nativeIterationMode,
    viewingHistorical,
    historyStops: history.historyStops,
    clampedStopIndex: history.clampedStopIndex,
    nativeUpdateCount: history.nativeUpdateCount,
    comparisonStart: history.resolvedIterationRange.range.fromUpdate,
    latestHtml: htmlByPath[selectedPath],
    setCompletedHistoryStopIndex: history.setCompletedHistoryStopIndex,
    setIterationRange: history.setIterationRange,
    setActiveThreadId,
    dismissEmptyDraftRef,
  });
  const { changeIterationRange } = controls;

  const rail = useRailModel({
    ...views,
    anchorLayout,
    commentQuery,
    commentFilter,
    onlyThisFile,
    currentUserId: currentUser.id,
    activeReadOnly,
    activeDraft: drafts.activeDraft,
    draftY: drafts.draftY,
  });

  // The reading font + size scale reach the article through CSS custom
  // properties set on the app root.
  const layout = paneLayout(props.hideDocNav, readerPrefs, commentsAvailable);
  const { readerFont, readerStyle } = readerStyleFor(readerPrefs);
  const chrome = railChrome({
    nativeIterationMode,
    viewingHistorical,
    hidePrPill,
    documentsMode: props.documentsMode,
  });
  const statusExtras = statusBarExtras({
    documentsMode: props.documentsMode,
    activeRoutedPr,
    nativeIterationMode,
    iterationOptions: controls.iterationOptions,
    reviewIterationBaseCommit: props.reviewIterationBaseCommit,
    canRefreshComments: store.canRefreshComments,
    handleRefresh: store.handleRefresh,
    commentsRefreshing: threadSync.isRefreshing,
    fileRefreshInFlight: store.fileRefreshInFlight,
  });
  const showRailSkeleton =
    (doc.loading && !article.pristineHtml) || historicalLoading;
  const linkCopy = access.viewingPastPr ? undefined : links;

  return (
    <IdentityStoreContext.Provider value={identityStore}>
      <CommentApiScope
        api={commentApi}
        busy={writes.writesInFlight > 0}
        registerEditor={writes.registerEditor}
      >
        <div
          className={appClassName({
            navHidden: layout.navHidden,
            commentsHidden: layout.commentsHidden,
            documentsMode: props.documentsMode,
            tooNarrow,
          })}
          style={readerStyle}
        >
          <ShellNotices
            persistError={writes.persistError}
            onDismissPersistError={() => writes.setPersistError(null)}
            reloadAllowed={writes.openEditors === 0}
            missingDoc={doc.missingDoc}
            onDismissMissingDoc={() => doc.setMissingDoc(null)}
            draftGuard={drafts.draftGuard}
            onDiscardExistingDraft={drafts.onDiscardExistingDraft}
            onKeepExistingDraft={drafts.onKeepExistingDraft}
          />

          <div ref={resize.bodyFrameRef} className={layout.bodyFrameClassName}>
            <NavPane
              shown={layout.navToggleable}
              onResizeStart={resize.onNavResizeStart}
              onResizeMove={resize.onNavResizeMove}
              onResizeEnd={resize.onNavResizeEnd}
              onResetWidth={prefs.resetNavWidth}
            >
              <DocNav
                articleWrapRef={articleWrapRef}
                scrollRef={bodyRef}
                version={renderVersion}
                files={pr.files}
                selectedPath={selectedPath}
                onSelectPath={nav.selectDocPath}
                threadCountsByPath={views.threadCountsByPath}
                unloadedFolders={props.unloadedFolders}
                onExpandFolder={props.onExpandFolder}
                folderOrders={props.folderOrders}
                wikiPages={props.documentsMode}
                showOutline={readerPrefs.showOutline}
                onSearchFiles={props.onSearchFiles}
                titleSlot={props.docNavTitleSlot}
                // Per-file A/M/D change indicators only make sense against a
                // PR base. The Documents hub shows the latest master (no diff
                // baseline — every file is just "present"), so it suppresses
                // them.
                showChangeIndicators={!isHub}
                rangeChanges={history.docNavRangeChanges}
                onActivitiesChange={setNavigationActivities}
              />
            </NavPane>
            <div className="emr-body" ref={bodyRef}>
              {/* Document overview scrollbar — the ONLY custom bar in the
                  reader. Lives INSIDE the document (a sticky, zero-height anchor
                  pinned to the scroll viewport's top), hugging the document's
                  RIGHT edge, so the comment rail can sit flush against the
                  document and its resize handle aligns with the document's right
                  edge (mirroring the nav handle on the left). Charts every
                  change in THIS file (green add / amber edit / red delete) as a
                  draggable thumb; maps ONLY the document scroll (bodyRef). */}
              <div className="emr-diff-scrollbar-anchor" aria-hidden="true">
                <DiffMinimap
                  scrollRef={bodyRef}
                  version={renderVersion}
                  showDiff={diff.showDiff}
                />
              </div>
              <ArticleColumn
                hideDocNav={props.hideDocNav}
                selectedPath={selectedPath}
                error={doc.error}
                loading={doc.loading}
                pristineHtml={article.pristineHtml}
                absentNotice={article.absentNotice}
                onShowAllUpdates={() =>
                  changeIterationRange(
                    allReviewIterations(history.nativeUpdateCount),
                  )
                }
                historicalLoadError={article.historicalLoadError}
                historicalLoading={historicalLoading}
              >
                <ArticleView
                  pristineHtml={article.articleHtml}
                  documentPath={selectedPath}
                  readerFontFamily={readerFont.stack}
                  threads={views.visibleForArticle}
                  activeThreadId={activeThreadId}
                  draftAnchor={drafts.draftAnchor}
                  storageKey={article.activeStorageKey}
                  onAnchorsResolved={onAnchorsResolved}
                  onHighlightClick={selection.onHighlightClick}
                  onSelection={selection.onSelectionMade}
                  readOnly={activeReadOnly}
                  diff={diff.activeDiff}
                  originalSource={diff.activeOriginalSource}
                  currentSource={diff.activeSource}
                  showDiff={diff.showDiff}
                  onDocLink={nav.handleDocLink}
                  resolveDocumentImage={article.activeDocumentImageResolver}
                  onCopyHeadingLink={linkCopy?.onCopyHeadingLink}
                  onCopySelectionLink={linkCopy?.onCopySelectionLink}
                  commentBlocker={controls.commentBlocker}
                />
              </ArticleColumn>
            </div>

            <RailPane
              showSkeleton={showRailSkeleton}
              resizable={layout.railResizable}
              onResizeStart={resize.onCommentResizeStart}
              onResizeMove={resize.onCommentResizeMove}
              onResizeEnd={resize.onCommentResizeEnd}
              onResetWidth={prefs.resetCommentWidth}
            >
              <CommentRail
                currentThreads={rail.filteredCurrentThreads}
                generalThreads={rail.filteredGeneralThreads}
                orphanedFileThreads={rail.filteredOrphanedFileThreads}
                orphanedThreadIds={rail.orphanedSet}
                hiddenThreadIds={rail.hiddenSet}
                yByThreadId={anchorLayout.yByThreadId}
                draftAnchor={drafts.draftAnchor}
                draftY={drafts.draftY}
                activeThreadId={activeThreadId}
                currentUser={currentUser}
                onSelectThread={selection.onSelectThread}
                onReply={posting.onReply}
                onResolve={mutations.onResolve}
                onReopen={mutations.onReopen}
                onMarkPending={mutations.onMarkPending}
                onClose={mutations.onCloseThread}
                onEditComment={mutations.onEditComment}
                onDeleteComment={mutations.onDeleteComment}
                onDeleteThread={mutations.onDeleteThread}
                onToggleReaction={mutations.onToggleReaction}
                onSubmitDraft={posting.onSubmitDraft}
                onCancelDraft={drafts.onCancelDraft}
                draftInitialBody={drafts.draft.initialBody}
                onDraftChange={drafts.draft.handleChange}
                activeReplyThreadId={drafts.activeReplyThreadId}
                replyInitialBody={drafts.draft.initialBody}
                onRequestReply={drafts.onRequestReply}
                onCancelReply={drafts.onCancelReply}
                commentQuery={commentQuery}
                onCommentQueryChange={toggles.setCommentQuery}
                totalCommentCount={rail.totalCommentCount}
                resolvedThreadCount={rail.resolvedThreadCount}
                openThreadCount={rail.openThreadCount}
                filterCounts={rail.filterCounts}
                filterMode={commentFilter}
                onFilterModeChange={toggles.handleFilterModeChange}
                onAddComment={drafts.onAddImplicitComment}
                onlyThisFile={onlyThisFile}
                onOnlyThisFileChange={toggles.handleOnlyThisFileChange}
                readOnly={activeReadOnly}
                readOnlyMessage={access.activeReadOnlyMessage}
                showReadOnlyBanner={chrome.showReadOnlyBanner}
                routedPr={activeRoutedPr}
                hidePrPill={chrome.hidePrPill}
                historyNav={controls.historyNav}
              />
            </RailPane>

            <PaneReopenGrabbers
              navShown={layout.navReopenShown}
              commentsShown={layout.commentsReopenShown}
              onNavReopenStart={resize.onNavReopenStart}
              onNavReopenMove={resize.onNavReopenMove}
              onNavReopenEnd={resize.onNavReopenEnd}
              onCommentReopenStart={resize.onCommentReopenStart}
              onCommentReopenMove={resize.onCommentReopenMove}
              onCommentReopenEnd={resize.onCommentReopenEnd}
            />

            <TooNarrowNotice />
          </div>
          {/* Reading status bar — the reader's single docked control surface
              (Word's status-bar model): document status on the left, the
              Navigation / Comments / Changes toggles, reading font, text size,
              refresh and feedback on the right. Full reader width; hidden by CSS
              when the reader is too narrow. */}
          <ReaderStatusBar
            wordCount={diff.docWordCount}
            wordDelta={diff.docWordDelta}
            resolvedPullRequest={statusExtras.resolvedPullRequest}
            fontId={readerPrefs.fontId}
            sizePct={readerPrefs.sizePct}
            spacingPct={readerPrefs.lineSpacingPct}
            onFontChange={prefs.setReaderFont}
            onSizeChange={prefs.setReaderSize}
            onSpacingChange={prefs.setReaderSpacing}
            showNav={readerPrefs.showNav}
            onToggleNav={prefs.toggleReaderNav}
            showOutline={readerPrefs.showOutline}
            onToggleOutline={prefs.toggleReaderOutline}
            navToggleable={layout.navToggleable}
            showComments={readerPrefs.showComments}
            commentsAvailable={commentsAvailable}
            onToggleComments={prefs.toggleReaderComments}
            commentThreadIds={rail.commentCycleThreadIds}
            activeCommentThreadId={activeThreadId}
            onCycleComment={selection.onCycleToThread}
            changesAvailable={diff.diffAvailable}
            changesShown={!toggles.diffHidden}
            onToggleChanges={toggles.handleToggleDiff}
            iterationOptions={statusExtras.iterationOptions}
            iterationBaseCommit={statusExtras.iterationBaseCommit}
            iterationRange={history.iterationRange}
            onIterationRangeChange={changeIterationRange}
            feedbackHref={feedbackHrefFor(props.feedbackEmail)}
            onRefresh={statusExtras.onRefresh}
            refreshing={statusExtras.refreshing}
            refreshLabel={store.refreshLabel}
            activities={readerActivities}
          />
        </div>
      </CommentApiScope>
    </IdentityStoreContext.Provider>
  );
}
