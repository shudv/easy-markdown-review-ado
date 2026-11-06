// Shell — shared shell for both the real ADO PR tab and the standalone
// dev preview. Owns the selected file, view mode, thread store, active
// thread, and draft anchor. All data arrives via props so callers can swap
// fixtures for live ADO data without changing this component.

/* eslint-disable max-lines -- Holds only the Shell component, itself a documented exception, plus its imports; everything else lives in shell/. */

import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { IdentityStoreContext } from "../comments/identityStore";
import { ArticleView, type AnchorLayout } from "./components/ArticleView";
import { DiffMinimap } from "./components/DiffMinimap";
import { CommentRail } from "./components/CommentRail";
import { DocNav } from "./components/DocNav";
import { ReaderStatusBar } from "./components/ReaderStatusBar";
import type { ReaderActivity } from "./components/readerActivity";
import { allReviewIterations, buildReaderActivities } from "./shellHelpers";
import type { ShellProps } from "./shell/ShellProps";
import {
  commentAccess,
  documentReadOnly,
  pickInitialPath,
} from "./shell/derive";
import {
  appClassName,
  feedbackHrefFor,
  paneLayout,
  railChrome,
  readerStyleFor,
  statusBarExtras,
} from "./shell/deriveChrome";
import { useCommentApiRouting } from "./shell/useCommentApiRouting";
import { useReaderToggles } from "./shell/useReaderToggles";
import { useReaderPrefs } from "./shell/useReaderPrefs";
import { usePaneResize } from "./shell/usePaneResize";
import { useDraftController } from "./shell/useDraftController";
import { useReviewHistory } from "./shell/useReviewHistory";
import { useThreadStore } from "./shell/useThreadStore";
import { useHistoryLoaders } from "./shell/useHistoryLoaders";
import { useDocumentSource } from "./shell/useDocumentSource";
import { useThreadViews } from "./shell/useThreadViews";
import { useActiveThreadEffects } from "./shell/useActiveThreadEffects";
import { useDocScroll } from "./shell/useDocScroll";
import {
  useDocNavigation,
  usePendingDocScroll,
} from "./shell/useDocNavigation";
import { useLinkCopy } from "./shell/useLinkCopy";
import { useThreadSelection } from "./shell/useThreadSelection";
import { useCommentWrites } from "./shell/useCommentWrites";
import { useCommentPosting } from "./shell/useCommentPosting";
import { useThreadMutations } from "./shell/useThreadMutations";
import { useActiveArticle } from "./shell/useActiveArticle";
import { useActiveDiff } from "./shell/useActiveDiff";
import { useTooNarrow } from "./shell/useTooNarrow";
import { useIterationControls } from "./shell/useIterationControls";
import { useRailModel } from "./shell/useRailModel";
import { CommentApiScope } from "./shell/CommentApiScope";
import { ShellNotices } from "./shell/ShellNotices";
import { NavPane } from "./shell/NavPane";
import { ArticleColumn } from "./shell/ArticleColumn";
import { RailPane } from "./shell/RailPane";
import { PaneReopenGrabbers } from "./shell/PaneReopenGrabbers";
import { TooNarrowNotice } from "./shell/TooNarrowNotice";

export type { DocLinkNavigation, RoutedPrInfo } from "./shell/types";

// eslint-disable-next-line max-lines-per-function -- Reader root: composes the single-purpose hooks in shell/ and the nav, article and rail panes. It barely branches; the length is the wiring list itself.
export function Shell(props: Readonly<ShellProps>): ReactElement {
  const { pr, loadFileSource, initialThreads, currentUser } = props;

  // ---- state ----
  const [selectedPath, setSelectedPath] = useState<string>(() =>
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
  const selectedPathRef = useRef(selectedPath);
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);
  const toggles = useReaderToggles();
  const { commentQuery, commentFilter, onlyThisFile } = toggles;
  // Reader preferences, restored from + persisted to localStorage (scoped to
  // this surface: PR tab vs Documents hub).
  const prefs = useReaderPrefs(props.draftScope);
  const { readerPrefs } = prefs;

  const { bodyFrameRef, commentsAvailableRef, ...resize } = usePaneResize(
    readerPrefs,
    prefs.setReaderPrefs,
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

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

  const [navigationActivities, setNavigationActivities] = useState<
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
  const [anchorLayout, setAnchorLayout] = useState<AnchorLayout>(() => ({
    yByThreadId: new Map(),
    orphanedThreadIds: [],
  }));

  const onAnchorsResolved = useCallback(
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
  const articleWrapRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ArticleView renders the single `.emr-article-wrap`; read it from the DOM
  // after each render rather than threading a ref through.
  useLayoutEffect(() => {
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

  const readerActivities = useMemo(
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
  // Read by the nav-resize drag handlers, after this commit.
  useLayoutEffect(() => {
    commentsAvailableRef.current = commentsAvailable;
  }, [commentsAvailableRef, commentsAvailable]);

  const tooNarrow = useTooNarrow(
    bodyFrameRef,
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

          <div ref={bodyFrameRef} className={layout.bodyFrameClassName}>
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
