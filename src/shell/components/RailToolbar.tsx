// Two-row rail header. Row 1 is the comment toolbar: the "Comments" label —
// which doubles as the filter dropdown (status modes + an "only this file"
// scope toggle) — and a collapsible search field.
// Row 2 is the version stepper — a quiet banded strip naming the pull request
// comments route to (number + title), flanked by ‹ › chevrons that walk the
// document's review history when there is any: left steps older (back through
// earlier PRs), right steps newer (toward the live Current head). Self-contained
// — owns its search open/close state and the small inline icon set it renders.

import * as React from "react";

import type { CommentFilterCounts, CommentFilterMode } from "./commentFilter";
import { PlusIcon } from "./icons";
import {
  RailSearchInput,
  RailSearchToggle,
  RailToolbarTitle,
  RailVersionRow,
  useRailSearchOpen,
  type HistoryNav,
} from "./RailToolbar.parts";

export type { HistoryNav } from "./RailToolbar.parts";

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

  const { searchOpen, setSearchOpen, inputRef } =
    useRailSearchOpen(commentQuery);

  const canSearch = hasVisibleComments || commentQuery.length > 0;
  // The routed PR named in the version row; undefined when hidden.
  const prLabel = hidePrPill ? undefined : routedPr;

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
            <RailSearchInput
              inputRef={inputRef}
              commentQuery={commentQuery}
              onCommentQueryChange={onCommentQueryChange}
              setSearchOpen={setSearchOpen}
            />
          ) : (
            <RailToolbarTitle
              filterCounts={filterCounts}
              filterMode={filterMode}
              onFilterModeChange={onFilterModeChange}
              onlyThisFile={onlyThisFile}
              onOnlyThisFileChange={onOnlyThisFileChange}
              allResolved={allResolved}
            />
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
            <RailSearchToggle
              searchOpen={searchOpen}
              onClick={searchOpen ? closeSearch : () => setSearchOpen(true)}
            />
          ) : null}
          {headerActions}
        </div>
      </div>
      {prLabel || historyNav ? (
        <RailVersionRow pr={prLabel} historyNav={historyNav} />
      ) : null}
    </div>
  );
}
