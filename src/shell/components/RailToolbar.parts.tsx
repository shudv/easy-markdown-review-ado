// Sub-components + search-state hook for the RailToolbar, plus the small
// inline icon set they render.

import * as React from "react";

import { CommentFilterMenu } from "./CommentFilterMenu";
import type { CommentFilterCounts, CommentFilterMode } from "./commentFilter";
import { SearchIcon } from "./icons";

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

/** Routed PR named in the version row. */
interface RoutedPrLabel {
  prId: number;
  title: string;
  status: "active" | "completed";
  url?: string;
}

/**
 * Open/closed state of the collapsible search field, plus the input ref it
 * focuses on open.
 */
export function useRailSearchOpen(commentQuery: string): {
  searchOpen: boolean;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inputRef: React.RefObject<HTMLInputElement>;
} {
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

  return { searchOpen, setSearchOpen, inputRef };
}

/** The inline search field that replaces the toolbar's lead label. */
export function RailSearchInput(props: {
  inputRef: React.RefObject<HTMLInputElement>;
  commentQuery: string;
  onCommentQueryChange: (q: string) => void;
  setSearchOpen: (open: boolean) => void;
}): React.ReactElement {
  const { inputRef, commentQuery, onCommentQueryChange, setSearchOpen } = props;
  return (
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
  );
}

/**
 * The "Comments" label — or the filter dropdown once there's anything to
 * filter — followed by the all-resolved celebration badge.
 */
export function RailToolbarTitle(props: {
  filterCounts: CommentFilterCounts;
  filterMode: CommentFilterMode;
  onFilterModeChange: (mode: CommentFilterMode) => void;
  onlyThisFile: boolean;
  onOnlyThisFileChange: (next: boolean) => void;
  allResolved: boolean;
}): React.ReactElement {
  const {
    filterCounts,
    filterMode,
    onFilterModeChange,
    onlyThisFile,
    onOnlyThisFileChange,
    allResolved,
  } = props;
  return (
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
  );
}

/** Search open/close toggle in the toolbar's pinned action region. */
export function RailSearchToggle(props: {
  searchOpen: boolean;
  onClick: () => void;
}): React.ReactElement {
  const { searchOpen, onClick } = props;
  return (
    <button
      type="button"
      className={`emr-icon-btn${searchOpen ? " is-open" : ""}`}
      title={searchOpen ? "Close search (Esc)" : "Search comments"}
      aria-label={searchOpen ? "Close search" : "Search comments"}
      aria-pressed={searchOpen}
      onClick={onClick}
    >
      {searchOpen ? <SvgX /> : <SearchIcon />}
    </button>
  );
}

/**
 * Row 2: the routed PR (when shown) flanked by the comment-history chevrons
 * (when there's history to step through).
 */
export function RailVersionRow(props: {
  pr: RoutedPrLabel | undefined;
  historyNav: HistoryNav | undefined;
}): React.ReactElement {
  const { pr, historyNav } = props;
  return (
    <div
      className={`emr-rail-version${pr ? ` is-${pr.status}` : " is-history-only"}`}
      aria-label={pr ? undefined : "Comment history"}
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
      {pr ? <RailVersionPr pr={pr} /> : null}
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
  );
}

function RailVersionPr(props: { pr: RoutedPrLabel }): React.ReactElement {
  const { pr } = props;
  return (
    <span
      className="emr-rail-version-pr"
      title={`Routes to PR #${pr.prId}: ${pr.title}`}
    >
      {pr.url ? (
        <a
          className="emr-rail-title-pr-link emr-rail-version-num"
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          PR #{pr.prId}
        </a>
      ) : (
        <span className="emr-rail-title-pr-link emr-rail-version-num">
          PR #{pr.prId}
        </span>
      )}
      <span className="emr-rail-version-title">{pr.title}</span>
    </span>
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
