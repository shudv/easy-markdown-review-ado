// Comment rail: positions balloons absolutely against their anchor Y, then
// resolves collisions by stacking. Also renders the orphaned-anchors tray at
// the bottom of the column.

import * as React from "react";
import type {
  CommentAuthor,
  CommentThread,
  ReactionKind,
  TextQuoteAnchor,
} from "../../types";
import { Balloon } from "./Balloon";
import { RailToolbar, type HistoryNav } from "./RailToolbar";
import { buildRailModel, DRAFT_ID } from "./CommentRail.helpers";
import {
  isRailTrayExpanded,
  railDraftY,
  railEmptyMessageFor,
  shouldShowRailHeader,
} from "./CommentRail.layout";
import {
  RailCollapsibleTray,
  RailDraftBalloon,
  RailReadOnlyBanner,
} from "./CommentRail.parts";
import type { CommentFilterCounts, CommentFilterMode } from "./commentFilter";

export { chooseRailEmptyMessage } from "./CommentRail.helpers";

interface RailProps {
  currentThreads: CommentThread[];
  /** General PR-level ("Overview") comments with no file/line context. */
  generalThreads?: CommentThread[];
  /**
   * Threads anchored to a file that is NO LONGER in this PR (the file left the
   * change set, so it has no tab and can't be opened). Rendered in their own
   * collapsible tray below General, each labelled with its (now-absent) file so
   * the discussion stays reachable. NOT for comments on files still in the PR —
   * those belong to those files' own rails.
   */
  orphanedFileThreads?: CommentThread[];
  orphanedThreadIds: Set<string>;
  /** Threads hidden because they don't match the active comment filter. */
  hiddenThreadIds: Set<string>;
  yByThreadId: Map<string, number>;
  draftAnchor: TextQuoteAnchor | null;
  draftY: number | null;
  activeThreadId: string | null;
  currentUser: CommentAuthor;
  onSelectThread: (id: string) => void;
  onReply: (id: string, body: string) => void;
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
  onMarkPending: (id: string) => void;
  onClose: (id: string) => void;
  onEditComment: (
    threadId: string,
    commentId: string,
    newBody: string,
  ) => void | Promise<boolean>;
  onDeleteComment: (threadId: string, commentId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleReaction: (
    threadId: string,
    commentId: string,
    kind: ReactionKind,
  ) => void;
  onSubmitDraft: (body: string) => void;
  onCancelDraft: () => void;
  /** Seed text for the draft composer (restored from a persisted draft). */
  draftInitialBody?: string;
  /** Notified as the draft/reply composer's text changes (for local persistence). */
  onDraftChange?: (body: string) => void;
  /** Thread whose reply composer is open (the single active reply draft), or null. */
  activeReplyThreadId?: string | null;
  /** Seed text for the open reply composer (restored reply draft). */
  replyInitialBody?: string;
  /** Request to open a thread's reply composer (guarded by the shell). */
  onRequestReply?: (threadId: string) => void;
  /** Dismiss the open reply composer (discards its draft). */
  onCancelReply?: (threadId: string) => void;
  /** Current comment-search text. */
  commentQuery: string;
  onCommentQueryChange: (q: string) => void;
  /** Total comments visible on this file; decides whether to show search. */
  totalCommentCount: number;
  /** Number of current resolved/wontFix threads; drives the header celebration. */
  resolvedThreadCount: number;
  /** Number of current open (unresolved) threads; drives the header celebration. */
  openThreadCount: number;
  /** Live per-bucket counts backing the rail's comment filter menu. */
  filterCounts: CommentFilterCounts;
  /** Active comment filter mode (all / active / resolved / mine). */
  filterMode: CommentFilterMode;
  /** Change the active comment filter. */
  onFilterModeChange: (mode: CommentFilterMode) => void;
  /** Start a current-file comment with an implicit, invisible anchor. */
  onAddComment?: () => void;
  /** Whether the "only comments on this file" scope toggle is on. */
  onlyThisFile?: boolean;
  /** Toggle the "only this file" scope. */
  onOnlyThisFileChange?: (next: boolean) => void;
  /** Read-only mode: hide draft + reply composers, show a banner. */
  readOnly?: boolean;
  /** Override the default read-only banner text. */
  readOnlyMessage?: string;
  /** Hide the banner when read-only context is already explicit elsewhere. */
  showReadOnlyBanner?: boolean;
  /** Optional badge at the top of the rail describing the routed PR. */
  routedPr?: {
    prId: number;
    title: string;
    status: "active" | "completed";
    url?: string;
  };
  /**
   * Comment-history stepper controls (Documents hub). When present the rail
   * header renders ‹ › chevrons that walk the document's review history
   * PR-to-PR. Omitted when there's no history to step through.
   */
  historyNav?: HistoryNav;
  /**
   * Suppress the routed-PR pill in the rail header (PR tab, where it's
   * implicit). Also drops the header's PR-only visibility trigger.
   */
  hidePrPill?: boolean;
  /**
   * Extra controls (e.g. a refresh-threads button) appended to the right end
   * of the rail toolbar, after the resolved-eye toggle.
   */
  headerActions?: React.ReactNode;
}

export function CommentRail(props: RailProps): React.ReactElement {
  const {
    currentThreads,
    generalThreads = [],
    orphanedFileThreads = [],
    orphanedThreadIds,
    hiddenThreadIds,
    yByThreadId,
    draftAnchor,
    draftY,
    activeThreadId,
    currentUser,
    onSelectThread,
    onReply,
    onResolve,
    onReopen,
    onMarkPending,
    onClose,
    onEditComment,
    onDeleteComment,
    onDeleteThread,
    onToggleReaction,
    onSubmitDraft,
    onCancelDraft,
    draftInitialBody,
    onDraftChange,
    activeReplyThreadId,
    replyInitialBody,
    onRequestReply,
    onCancelReply,
    commentQuery,
    onCommentQueryChange,
    totalCommentCount,
    resolvedThreadCount,
    openThreadCount,
    filterCounts,
    filterMode,
    onFilterModeChange,
    onAddComment,
    onlyThisFile = false,
    onOnlyThisFileChange,
    readOnly = false,
    readOnlyMessage,
    showReadOnlyBanner = true,
    routedPr,
    historyNav,
    hidePrPill,
    headerActions,
  } = props;

  // The General ("Overview") tray is PR-wide (not anchored to any file) and
  // shows on every file, so it's collapsed by default to stay out of the way;
  // the user expands it when they want the cross-file / unanchored discussion.
  // Kept in component state (not per-file) so the choice persists as the reader
  // switches files within the same PR mount.
  const [generalCollapsed, setGeneralCollapsed] = React.useState(true);
  // The orphaned-file tray (files removed from the PR) is likewise PR-wide and
  // collapsed by default.
  const [orphanedFilesCollapsed, setOrphanedFilesCollapsed] =
    React.useState(true);

  // Shape the threads into the rail's ordered, grouped view model (anchored
  // comments by document position, then the unanchored trays). Pure + tested in
  // CommentRail.helpers so the rail component stays a thin renderer.
  const model = buildRailModel({
    currentThreads,
    generalThreads,
    orphanedFileThreads,
    hiddenThreadIds,
    orphanedThreadIds,
    yByThreadId,
    draftY: railDraftY(readOnly, draftAnchor, draftY),
    onlyThisFile,
  });
  const {
    orderedAnchoredIds,
    kindById,
    orphanedThreads,
    visibleGeneralThreads,
    visibleOrphanedFileThreads,
    hasVisibleComments,
  } = model;

  // Auto-expand a cross-file tray while its comment is active (e.g. status-bar
  // navigation landed there), so the selected balloon is on screen.
  const searchActive = commentQuery.trim().length > 0;
  const generalExpanded = isRailTrayExpanded({
    collapsed: generalCollapsed,
    threads: visibleGeneralThreads,
    activeThreadId,
    searchActive,
  });
  const orphanedFilesExpanded = isRailTrayExpanded({
    collapsed: orphanedFilesCollapsed,
    threads: visibleOrphanedFileThreads,
    activeThreadId,
    searchActive,
  });

  const showHeader = shouldShowRailHeader({
    readOnly,
    totalCommentCount,
    orphanedFileThreadCount: orphanedFileThreads.length,
    hasRoutedPr: !!routedPr,
    hidePrPill,
  });

  const emptyMessage = railEmptyMessageFor(model, {
    hasDraft: !!draftAnchor,
    commentQuery,
    filterMode,
    fileThreadCount: currentThreads.length,
    readOnly,
  });

  // Props shared by every thread balloon in the rail.
  const balloonProps = {
    currentUser,
    onClick: onSelectThread,
    onReply,
    onResolve,
    onReopen,
    onMarkPending,
    onClose,
    onEditComment,
    onDeleteComment,
    onDeleteThread,
    onToggleReaction,
    readOnly,
    replyInitial: replyInitialBody,
    onReplyChange: onDraftChange,
    onRequestReply,
    onCancelReply,
  };

  return (
    <aside className="emr-rail-col" aria-label="Comments">
      {readOnly && showReadOnlyBanner ? (
        <RailReadOnlyBanner message={readOnlyMessage} />
      ) : null}
      {showHeader ? (
        <div className="emr-rail-sticky-header">
          <RailToolbar
            commentQuery={commentQuery}
            onCommentQueryChange={onCommentQueryChange}
            hasVisibleComments={hasVisibleComments}
            resolvedThreadCount={resolvedThreadCount}
            openThreadCount={openThreadCount}
            filterCounts={filterCounts}
            filterMode={filterMode}
            onFilterModeChange={onFilterModeChange}
            onlyThisFile={onlyThisFile}
            /* v8 ignore next -- onOnlyThisFileChange is wired in every mounted usage; no-op fallback is defensive */
            onOnlyThisFileChange={onOnlyThisFileChange ?? (() => {})}
            routedPr={routedPr}
            historyNav={historyNav}
            hidePrPill={hidePrPill}
            onAddComment={readOnly ? undefined : onAddComment}
            headerActions={headerActions}
          />
        </div>
      ) : null}

      {emptyMessage ? (
        <div className="emr-rail-empty">{emptyMessage}</div>
      ) : null}

      <div className="emr-rail-positioned">
        {orderedAnchoredIds.map((id) => {
          if (kindById.get(id) === "draft" && draftAnchor) {
            return (
              <RailDraftBalloon
                key={DRAFT_ID}
                draftAnchor={draftAnchor}
                currentUser={currentUser}
                draftInitialBody={draftInitialBody}
                onDraftChange={onDraftChange}
                onSubmitDraft={onSubmitDraft}
                onCancelDraft={onCancelDraft}
              />
            );
          }
          const t = currentThreads.find((x) => x.id === id)!;
          return (
            <Balloon
              key={t.id}
              thread={t}
              inline
              isActive={t.id === activeThreadId}
              {...balloonProps}
              replyOpen={t.id === activeReplyThreadId}
            />
          );
        })}
      </div>

      {/* Orphaned-anchor tray: comments on THIS file whose quoted anchor text
          is gone (edited away), so they can't be placed against the prose. */}
      {orphanedThreads.length > 0 ? (
        <div className="emr-rail-section">
          <div className="emr-rail-section-header is-static">
            <span>Comments with no anchor</span>
            <span className="emr-rail-section-count">
              {orphanedThreads.length}
            </span>
          </div>
          <div className="emr-rail-section-body">
            {orphanedThreads.map((t) => (
              <Balloon
                key={t.id}
                thread={t}
                inline
                isOrphaned
                isActive={t.id === activeThreadId}
                {...balloonProps}
                replyOpen={t.id === activeReplyThreadId}
              />
            ))}
          </div>
        </div>
      ) : null}
      {/* General comments tray (ADO Overview / PR-level, no file anchor).
          PR-wide and shown on every file, so it's collapsible and starts
          collapsed — and styled distinctly so it reads as a separate,
          not-anchored-to-this-file section rather than more of this file's
          discussion. */}
      {visibleGeneralThreads.length > 0 ? (
        <RailCollapsibleTray
          title="General comments"
          count={visibleGeneralThreads.length}
          expanded={generalExpanded}
          onToggle={() => setGeneralCollapsed((v) => !v)}
        >
          {visibleGeneralThreads.map((t) => (
            <Balloon
              key={t.id}
              thread={t}
              inline
              general
              isActive={t.id === activeThreadId}
              {...balloonProps}
              replyOpen={t.id === activeReplyThreadId}
            />
          ))}
        </RailCollapsibleTray>
      ) : null}
      {/* Orphaned-file tray: threads on files removed from the PR. No tab to
          open, so they live here (below General), each labelled with its file.
          Collapsible, collapsed by default. */}
      {visibleOrphanedFileThreads.length > 0 ? (
        <RailCollapsibleTray
          title="Comments on files no longer in this PR"
          count={visibleOrphanedFileThreads.length}
          expanded={orphanedFilesExpanded}
          onToggle={() => setOrphanedFilesCollapsed((v) => !v)}
        >
          {visibleOrphanedFileThreads.map((t) => (
            <div key={t.id} className="emr-rail-orphan-file-item">
              <div className="emr-rail-orphan-file-label" title={t.filePath}>
                {baseName(t.filePath)}
              </div>
              <Balloon
                thread={t}
                inline
                general
                isActive={t.id === activeThreadId}
                {...balloonProps}
                replyOpen={t.id === activeReplyThreadId}
              />
            </div>
          ))}
        </RailCollapsibleTray>
      ) : null}
    </aside>
  );
}

/** Filename (last path segment) for the orphaned-file label. */
function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
