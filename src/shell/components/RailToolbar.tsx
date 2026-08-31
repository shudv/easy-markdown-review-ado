// Two-row rail header. Row 1 is the comment toolbar: the "Comments" label —
// which doubles as the filter dropdown (status modes + an "only this file"
// scope toggle) — and a collapsible search field.
// Row 2 is the version stepper — a quiet banded strip naming the pull request
// comments route to (number + title), flanked by ‹ › chevrons that walk the
// document's review history when there is any: left steps older (back through
// earlier PRs), right steps newer (toward the live Current head). Self-contained
// — owns its search open/close state and the small inline icon set it renders.

import * as React from "react";

import { CommentFilterMenu } from "./CommentFilterMenu";
import type { CommentFilterCounts, CommentFilterMode } from "./commentFilter";
import { PlusIcon, SearchIcon } from "./icons";

/**
 * Comment-history stepper controls: ‹ › chevrons that walk a document's review
 * history PR-to-PR. The left chevron steps "older" (back through earlier pull
 * requests); the right chevron steps "newer" (toward the live Current head),
 * matching a left→right timeline.
 */
export interface HistoryNav {
  /** Whether a newer stop exists (not already at Current). */
  canNewer: boolean;
  /** Whether an older stop exists (more history to walk back to). */
  canOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
  /** Tooltip naming the stop the "older" (left) chevron jumps to. */
  olderLabel: string;
  /** Tooltip naming the stop the "newer" (right) chevron jumps to. */
  newerLabel: string;
}

interface RailToolbarProps {
  commentQuery: string;
  onCommentQueryChange: (q: string) => void;
  /**
   * Whether any comment is currently visible in the rail. The search
   * affordance hides when nothing is shown (an active query keeps it open so
   * the user can always clear a no-match filter).
   */
  hasVisibleComments: boolean;
  resolvedThreadCount: number;
  /** Current open (unresolved) thread count; drives the all-resolved delight. */
  openThreadCount: number;
  /**
   * Live per-bucket thread counts backing the filter menu (all / active /
   * resolved / mine). The menu is shown whenever `filterCounts.all > 0`.
   */
  filterCounts: CommentFilterCounts;
  /** The active comment filter mode. */
  filterMode: CommentFilterMode;
  /** Change the active comment filter. */
  onFilterModeChange: (mode: CommentFilterMode) => void;
  /** Whether the "only comments on this file" scope toggle is on. */
  onlyThisFile: boolean;
  /** Toggle the "only this file" scope. */
  onOnlyThisFileChange: (next: boolean) => void;
  /** Optional routed PR shown inline next to the "Comments" label. */
  routedPr?: {
    prId: number;
    title: string;
    status: "active" | "completed";
    url?: string;
  };
  /** Optional comment-history stepper chevrons rendered next to the PR pill. */
  historyNav?: HistoryNav;
  /**
   * Suppress the routed-PR pill even when `routedPr` is set. Used by the PR
   * tab, where the comments obviously belong to the current PR so naming it is
   * redundant.
   */
  hidePrPill?: boolean;
  /** Start a file-scoped comment without a visible text anchor. */
  onAddComment?: () => void;
  /** Optional extra controls appended at the right end of the toolbar. */
  headerActions?: React.ReactNode;
}

export function RailToolbar(props: RailToolbarProps): React.ReactElement {
  const {
    commentQuery,
    onCommentQueryChange,
    hasVisibleComments,
    resolvedThreadCount,
    openThreadCount,
    filterCounts,
    filterMode,
    onFilterModeChange,
    onlyThisFile,
    onOnlyThisFileChange,
    routedPr,
    historyNav,
    hidePrPill,
    onAddComment,
    headerActions,
  } = props;

  // Start expanded if a query is already set (e.g. preserved across mounts).
  const [searchOpen, setSearchOpen] = React.useState(commentQuery.length > 0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Auto-focus on open (layout effect so focus lands before paint).
  React.useLayoutEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // Re-open if the query gets set externally while collapsed.
  React.useEffect(() => {
    if (commentQuery && !searchOpen) setSearchOpen(true);
  }, [commentQuery, searchOpen]);

  const canSearch = hasVisibleComments || commentQuery.length > 0;
  const showPrLabel = !!routedPr && !hidePrPill;
  const showVersionRow = showPrLabel || !!historyNav;

  // Every thread on this file is resolved (and there was at least one to
  // resolve). The header trades the count for a quiet green "all resolved"
  // celebration — keyed so it re-animates the moment the last one closes.
  const allResolved = openThreadCount === 0 && resolvedThreadCount > 0;

  const closeSearch = () => {
    onCommentQueryChange("");
    setSearchOpen(false);
  };

  return (
    <div className="emr-rail-header">
      <div className="emr-rail-toolbar">
        {/*
          Lead region (flex:1): the "Comments" label + all-resolved badge, OR
          the inline search input. The right-hand actions stay pinned.
        */}
        <div className="emr-rail-toolbar-lead">
          {searchOpen ? (
            <input
              ref={inputRef}
              type="search"
              className="emr-rail-search-inline"
              placeholder="Search comments…"
              value={commentQuery}
              onChange={(e) => onCommentQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Don't let the global ESC handler also clear the active thread.
                  e.stopPropagation();
                  if (commentQuery) onCommentQueryChange("");
                  else setSearchOpen(false);
                }
              }}
              onBlur={() => {
                // Collapse only if nothing is typed.
                if (!commentQuery) setSearchOpen(false);
              }}
              aria-label="Search comments"
            />
          ) : (
            <>
              {filterCounts.all > 0 ? (
                <CommentFilterMenu
                  mode={filterMode}
                  counts={filterCounts}
                  onChange={onFilterModeChange}
                  onlyThisFile={onlyThisFile}
                  onOnlyThisFileChange={onOnlyThisFileChange}
                />
              ) : (
                <span className="emr-rail-title">Comments</span>
              )}
              {allResolved ? (
                <span
                  key="all-resolved"
                  className="emr-rail-resolved"
                  role="status"
                  aria-live="polite"
                  title="All comments resolved"
                  aria-label="All comments resolved"
                >
                  <SvgCheckCircle />
                </span>
              ) : null}
            </>
          )}
        </div>
        {/*
          Action region (pinned right, fixed width per control): search toggle,
          show/hide-resolved toggle, and any host-supplied actions. Guaranteed
          stable — nothing in the lead can push these around.
        */}
        <div className="emr-rail-toolbar-actions">
          {onAddComment ? (
            <button
              type="button"
              className="emr-icon-btn"
              title="New comment"
              aria-label="New comment"
              onClick={onAddComment}
            >
              <PlusIcon />
            </button>
          ) : null}
          {canSearch ? (
            <button
              type="button"
              className={`emr-icon-btn${searchOpen ? " is-open" : ""}`}
              title={searchOpen ? "Close search (Esc)" : "Search comments"}
              aria-label={searchOpen ? "Close search" : "Search comments"}
              aria-pressed={searchOpen}
              onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
            >
              {searchOpen ? <SvgX /> : <SearchIcon />}
            </button>
          ) : null}
          {headerActions}
        </div>
      </div>
      {showVersionRow ? (
        <div
          className={`emr-rail-version${
            showPrLabel ? ` is-${routedPr.status}` : " is-history-only"
          }`}
          aria-label={showPrLabel ? undefined : "Comment history"}
        >
          {historyNav ? (
            <button
              type="button"
              className="emr-icon-btn emr-history-chevron"
              title={historyNav.olderLabel}
              aria-label="Older version"
              disabled={!historyNav.canOlder}
              onClick={historyNav.onOlder}
            >
              <SvgChevronLeft />
            </button>
          ) : null}
          {showPrLabel ? (
            <span
              className="emr-rail-version-pr"
              title={`Routes to PR #${routedPr.prId}: ${routedPr.title}`}
            >
              {routedPr.url ? (
                <a
                  className="emr-rail-title-pr-link emr-rail-version-num"
                  href={routedPr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  PR #{routedPr.prId}
                </a>
              ) : (
                <span className="emr-rail-title-pr-link emr-rail-version-num">
                  PR #{routedPr.prId}
                </span>
              )}
              <span className="emr-rail-version-title">{routedPr.title}</span>
            </span>
          ) : null}
          {historyNav ? (
            <button
              type="button"
              className="emr-icon-btn emr-history-chevron"
              title={historyNav.newerLabel}
              aria-label="Newer version"
              disabled={!historyNav.canNewer}
              onClick={historyNav.onNewer}
            >
              <SvgChevronRight />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Lucide-style 24-viewBox icons so strokes look balanced at 16px.

const iconStrokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SvgX(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SvgChevronLeft(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function SvgChevronRight(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      {...iconStrokeProps}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SvgCheckCircle(): React.ReactElement {
  // Compact circular check — replaces the wordy "All comments resolved" pill so
  // the header stays tight and the right-hand controls don't shift. The label
  // lives in the title/aria-label instead.
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className="emr-rail-resolved-check"
      {...iconStrokeProps}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.4 12.3 2.5 2.5 4.7-5.1" strokeWidth={2} />
    </svg>
  );
}
