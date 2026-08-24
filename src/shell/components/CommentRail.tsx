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
import { Composer } from "./Composer";
import { RailToolbar, type HistoryNav } from "./RailToolbar";
import {
  buildRailModel,
  chooseRailEmptyMessage,
  DRAFT_ID,
} from "./CommentRail.helpers";
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
  onEditComment: (threadId: string, commentId: string, newBody: string) => void;
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
  const {
    orderedAnchoredIds,
    kindById,
    orphanedThreads,
    visibleGeneralThreads,
    visibleOrphanedFileThreads,
    hasVisibleComments,
  } = buildRailModel({
    currentThreads,
    generalThreads,
    orphanedFileThreads,
    hiddenThreadIds,
    orphanedThreadIds,
    yByThreadId,
    draftY: !readOnly && draftAnchor && draftY !== null ? draftY : null,
    onlyThisFile,
  });

  // Auto-expand a cross-file tray while its comment is active (e.g. status-bar
  // navigation landed there), so the selected balloon is on screen.
  const activeInGeneral =
    activeThreadId != null &&
    visibleGeneralThreads.some((t) => t.id === activeThreadId);
  const activeInOrphanedFiles =
    activeThreadId != null &&
    visibleOrphanedFileThreads.some((t) => t.id === activeThreadId);
  const generalExpanded = !generalCollapsed || activeInGeneral;
  const orphanedFilesExpanded =
    !orphanedFilesCollapsed || activeInOrphanedFiles;

  // Show the rail header when there are comments OR a (visible) routed PR to
  // link to. When the pill is suppressed (PR tab) the PR alone doesn't warrant
  // a header — comments do.
  const showHeader =
    totalCommentCount > 0 ||
    orphanedFileThreads.length > 0 ||
    (!!routedPr && !hidePrPill);

  const emptyMessage =
    orderedAnchoredIds.length === 0 && !draftAnchor
      ? chooseRailEmptyMessage({
          commentQuery,
          filterMode,
          fileThreadCount: currentThreads.length,
          hasOtherSections:
            orphanedThreads.length > 0 ||
            visibleGeneralThreads.length > 0 ||
            visibleOrphanedFileThreads.length > 0,
          readOnly,
        })
      : null;

  return (
    <aside className="emr-rail-col" aria-label="Comments">
      {readOnly && showReadOnlyBanner ? (
        <div className="emr-rail-readonly-banner" role="status">
          {readOnlyMessage ??
            "Commenting is disabled because this document has no completed pull request."}
        </div>
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
              <div
                key={DRAFT_ID}
                className="emr-balloon inline is-active is-draft"
                data-thread-id={DRAFT_ID}
              >
                <div className="emr-balloon-header">
                  <span className="emr-balloon-status status-active">New</span>
                  <span className="emr-balloon-meta">
                    Anchored to: <em>“{truncate(draftAnchor.exact, 40)}”</em>
                  </span>
                </div>
                <Composer
                  submitLabel="Comment"
                  placeholder={`Comment as ${currentUser.displayName}…`}
                  autoFocus
                  initial={draftInitialBody}
                  onChange={onDraftChange}
                  onSubmit={onSubmitDraft}
                  onCancel={onCancelDraft}
                />
              </div>
            );
          }
          const t = currentThreads.find((x) => x.id === id)!;
          return (
            <Balloon
              key={t.id}
              thread={t}
              inline
              isActive={t.id === activeThreadId}
              currentUser={currentUser}
              onClick={onSelectThread}
              onReply={onReply}
              onResolve={onResolve}
              onReopen={onReopen}
              onMarkPending={onMarkPending}
              onClose={onClose}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              onDeleteThread={onDeleteThread}
              onToggleReaction={onToggleReaction}
              readOnly={readOnly}
              replyOpen={t.id === activeReplyThreadId}
              replyInitial={replyInitialBody}
              onReplyChange={onDraftChange}
              onRequestReply={onRequestReply}
              onCancelReply={onCancelReply}
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
                currentUser={currentUser}
                onClick={onSelectThread}
                onReply={onReply}
                onResolve={onResolve}
                onReopen={onReopen}
                onMarkPending={onMarkPending}
                onClose={onClose}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onDeleteThread={onDeleteThread}
                onToggleReaction={onToggleReaction}
                readOnly={readOnly}
                replyOpen={t.id === activeReplyThreadId}
                replyInitial={replyInitialBody}
                onReplyChange={onDraftChange}
                onRequestReply={onRequestReply}
                onCancelReply={onCancelReply}
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
        <div className="emr-rail-section emr-rail-section--general">
          <button
            type="button"
            className="emr-rail-section-header emr-rail-section-header--toggle"
            aria-expanded={generalExpanded}
            onClick={() => setGeneralCollapsed((v) => !v)}
          >
            <span className="emr-rail-section-title">
              <span
                className="emr-rail-section-twist"
                data-collapsed={generalExpanded ? undefined : "true"}
                aria-hidden="true"
              >
                <SvgChevronRight />
              </span>
              General comments
            </span>
            <span className="emr-rail-section-count">
              {visibleGeneralThreads.length}
            </span>
          </button>
          {!generalExpanded ? null : (
            <div className="emr-rail-section-body">
              {visibleGeneralThreads.map((t) => (
                <Balloon
                  key={t.id}
                  thread={t}
                  inline
                  general
                  isActive={t.id === activeThreadId}
                  currentUser={currentUser}
                  onClick={onSelectThread}
                  onReply={onReply}
                  onResolve={onResolve}
                  onReopen={onReopen}
                  onMarkPending={onMarkPending}
                  onClose={onClose}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
                  onDeleteThread={onDeleteThread}
                  onToggleReaction={onToggleReaction}
                  readOnly={readOnly}
                  replyOpen={t.id === activeReplyThreadId}
                  replyInitial={replyInitialBody}
                  onReplyChange={onDraftChange}
                  onRequestReply={onRequestReply}
                  onCancelReply={onCancelReply}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
      {/* Orphaned-file tray: threads on files removed from the PR. No tab to
          open, so they live here (below General), each labelled with its file.
          Collapsible, collapsed by default. */}
      {visibleOrphanedFileThreads.length > 0 ? (
        <div className="emr-rail-section emr-rail-section--general">
          <button
            type="button"
            className="emr-rail-section-header emr-rail-section-header--toggle"
            aria-expanded={orphanedFilesExpanded}
            onClick={() => setOrphanedFilesCollapsed((v) => !v)}
          >
            <span className="emr-rail-section-title">
              <span
                className="emr-rail-section-twist"
                data-collapsed={orphanedFilesExpanded ? undefined : "true"}
                aria-hidden="true"
              >
                <SvgChevronRight />
              </span>
              Comments on files no longer in this PR
            </span>
            <span className="emr-rail-section-count">
              {visibleOrphanedFileThreads.length}
            </span>
          </button>
          {!orphanedFilesExpanded ? null : (
            <div className="emr-rail-section-body">
              {visibleOrphanedFileThreads.map((t) => (
                <div key={t.id} className="emr-rail-orphan-file-item">
                  <div
                    className="emr-rail-orphan-file-label"
                    title={t.filePath}
                  >
                    {baseName(t.filePath)}
                  </div>
                  <Balloon
                    thread={t}
                    inline
                    general
                    isActive={t.id === activeThreadId}
                    currentUser={currentUser}
                    onClick={onSelectThread}
                    onReply={onReply}
                    onResolve={onResolve}
                    onReopen={onReopen}
                    onMarkPending={onMarkPending}
                    onClose={onClose}
                    onEditComment={onEditComment}
                    onDeleteComment={onDeleteComment}
                    onDeleteThread={onDeleteThread}
                    onToggleReaction={onToggleReaction}
                    readOnly={readOnly}
                    replyOpen={t.id === activeReplyThreadId}
                    replyInitial={replyInitialBody}
                    onReplyChange={onDraftChange}
                    onRequestReply={onRequestReply}
                    onCancelReply={onCancelReply}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}

/** Filename (last path segment) for the orphaned-file label. */
function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function SvgChevronRight(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
