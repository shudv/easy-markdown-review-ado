// PrShell: the comment rail's filtered trays, cycle order and counts.

import * as React from "react";

import type { CommentThread } from "../../types";
import { isResolvedLike } from "../../types";
import { buildRailModel } from "../components/CommentRail.helpers";
import {
  countCommentFilters,
  threadMatchesQuery,
  threadVisibleForCommentView,
  type CommentFilterCounts,
  type CommentFilterMode,
} from "../components/commentFilter";
import type { AnchorLayout } from "../components/ArticleView";
import type { DraftTarget } from "../draftStorage";

interface RailModelOptions {
  currentThreadsRaw: CommentThread[];
  generalThreads: CommentThread[];
  orphanedFileThreads: CommentThread[];
  anchorLayout: AnchorLayout;
  commentQuery: string;
  commentFilter: CommentFilterMode;
  onlyThisFile: boolean;
  currentUserId: string;
  activeReadOnly: boolean;
  activeDraft: DraftTarget | null;
  draftY: number | null;
}

/**
 * What the comment rail shows: the search-filtered trays, the hidden and
 * orphaned thread sets, the status-bar cycle order, and the summary counts.
 */
export function useRailModel(opts: RailModelOptions) {
  const {
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    anchorLayout,
    commentQuery,
    commentFilter,
    onlyThisFile,
    currentUserId,
    activeReadOnly,
    activeDraft,
    draftY,
  } = opts;
  const orphanedSet = React.useMemo(
    () => new Set(anchorLayout.orphanedThreadIds),
    [anchorLayout],
  );
  const hiddenSet = React.useMemo(() => {
    const s = new Set<string>();
    // Search spans all statuses; otherwise the selected filter applies. The
    // same rule covers current-file, General, and orphaned-file sections.
    for (const t of currentThreadsRaw) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUserId,
        )
      )
        s.add(t.id);
    }
    for (const t of generalThreads) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUserId,
        )
      )
        s.add(t.id);
    }
    for (const t of orphanedFileThreads) {
      if (
        !threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUserId,
        )
      )
        s.add(t.id);
    }
    return s;
  }, [
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    commentQuery,
    commentFilter,
    currentUserId,
  ]);

  // ---- Comment search ----
  // Search spans every rail section and status. Article highlights use the
  // same matching rule, so the prose and rail always show the same result set.
  const matchesQuery = React.useCallback(
    (t: CommentThread): boolean => threadMatchesQuery(t, commentQuery),
    [commentQuery],
  );
  const filteredCurrentThreads = React.useMemo(
    () => currentThreadsRaw.filter(matchesQuery),
    [currentThreadsRaw, matchesQuery],
  );
  const filteredGeneralThreads = React.useMemo(
    () => generalThreads.filter(matchesQuery),
    [generalThreads, matchesQuery],
  );
  const filteredOrphanedFileThreads = React.useMemo(
    () => orphanedFileThreads.filter(matchesQuery),
    [orphanedFileThreads, matchesQuery],
  );
  const commentCycleThreadIds = React.useMemo(
    () =>
      buildRailModel({
        currentThreads: filteredCurrentThreads,
        generalThreads: filteredGeneralThreads,
        orphanedFileThreads: filteredOrphanedFileThreads,
        hiddenThreadIds: hiddenSet,
        orphanedThreadIds: orphanedSet,
        yByThreadId: anchorLayout.yByThreadId,
        draftY:
          !activeReadOnly && activeDraft?.anchor && draftY !== null
            ? draftY
            : null,
        onlyThisFile,
      }).cycleThreadIds,
    [
      filteredCurrentThreads,
      filteredGeneralThreads,
      filteredOrphanedFileThreads,
      hiddenSet,
      orphanedSet,
      anchorLayout.yByThreadId,
      activeReadOnly,
      activeDraft?.anchor,
      draftY,
      onlyThisFile,
    ],
  );
  // Counts for the search summary line.
  const totalCommentCount = React.useMemo(() => {
    let n = 0;
    for (const t of [
      ...currentThreadsRaw,
      ...generalThreads,
      ...orphanedFileThreads,
    ]) {
      n += t.comments.length;
    }
    return n;
  }, [currentThreadsRaw, generalThreads, orphanedFileThreads]);

  // Number of current threads that are resolved/wontFix/closed. Drives the
  // rail header's "all resolved" celebration.
  const resolvedThreadCount = React.useMemo(() => {
    let n = 0;
    for (const t of currentThreadsRaw) {
      if (isResolvedLike(t.status)) n += 1;
    }
    return n;
  }, [currentThreadsRaw]);

  // Number of current threads still open (not resolved/wontFix/closed). When
  // this reaches zero on a file that had comments, the rail header celebrates.
  const openThreadCount = React.useMemo(() => {
    let n = 0;
    for (const t of currentThreadsRaw) {
      if (!isResolvedLike(t.status)) n += 1;
    }
    return n;
  }, [currentThreadsRaw]);

  // Live per-bucket counts backing the rail's comment filter menu, tallied
  // across every tray the rail surfaces (current file + General + orphaned).
  const filterCounts = React.useMemo<CommentFilterCounts>(
    () =>
      countCommentFilters(
        onlyThisFile
          ? currentThreadsRaw
          : [...currentThreadsRaw, ...generalThreads, ...orphanedFileThreads],
        currentUserId,
      ),
    [
      onlyThisFile,
      currentThreadsRaw,
      generalThreads,
      orphanedFileThreads,
      currentUserId,
    ],
  );

  return {
    orphanedSet,
    hiddenSet,
    filteredCurrentThreads,
    filteredGeneralThreads,
    filteredOrphanedFileThreads,
    commentCycleThreadIds,
    totalCommentCount,
    resolvedThreadCount,
    openThreadCount,
    filterCounts,
  };
}
