// Shell: the comment rail's filtered trays, cycle order and counts.

import { useCallback, useMemo } from "react";

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
  const { orphanedSet, hiddenSet } = useRailVisibility(opts);
  const trays = useFilteredTrays(opts);

  const commentCycleThreadIds = useCommentCycle(
    opts,
    trays,
    hiddenSet,
    orphanedSet,
  );

  const counts = useRailCounts(opts);

  return {
    orphanedSet,
    hiddenSet,
    ...trays,
    commentCycleThreadIds,
    ...counts,
  };
}

/** The orphaned-thread set and the threads hidden by the search/filter. */
function useRailVisibility(opts: RailModelOptions) {
  const {
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    anchorLayout,
    commentQuery,
    commentFilter,
    currentUserId,
  } = opts;

  const orphanedSet = useMemo(
    () => new Set(anchorLayout.orphanedThreadIds),
    [anchorLayout],
  );

  const hiddenSet = useMemo(() => {
    const s = new Set<string>();

    // Search spans all statuses; otherwise the selected filter applies. The
    // same rule covers current-file, General, and orphaned-file sections.
    for (const section of [
      currentThreadsRaw,
      generalThreads,
      orphanedFileThreads,
    ]) {
      for (const t of section) {
        if (
          !threadVisibleForCommentView(
            t,
            commentQuery,
            commentFilter,
            currentUserId,
          )
        ) {
          s.add(t.id);
        }
      }
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

  return { orphanedSet, hiddenSet };
}

interface FilteredTrays {
  filteredCurrentThreads: CommentThread[];
  filteredGeneralThreads: CommentThread[];
  filteredOrphanedFileThreads: CommentThread[];
}

/** The rail's three trays narrowed to the comment search. */
function useFilteredTrays(opts: RailModelOptions): FilteredTrays {
  const { currentThreadsRaw, generalThreads, orphanedFileThreads } = opts;
  const { commentQuery } = opts;

  // ---- Comment search ----
  // Search spans every rail section and status. Article highlights use the
  // same matching rule, so the prose and rail always show the same result set.
  const matchesQuery = useCallback(
    (t: CommentThread): boolean => threadMatchesQuery(t, commentQuery),
    [commentQuery],
  );

  const filteredCurrentThreads = useMemo(
    () => currentThreadsRaw.filter(matchesQuery),
    [currentThreadsRaw, matchesQuery],
  );

  const filteredGeneralThreads = useMemo(
    () => generalThreads.filter(matchesQuery),
    [generalThreads, matchesQuery],
  );

  const filteredOrphanedFileThreads = useMemo(
    () => orphanedFileThreads.filter(matchesQuery),
    [orphanedFileThreads, matchesQuery],
  );

  return {
    filteredCurrentThreads,
    filteredGeneralThreads,
    filteredOrphanedFileThreads,
  };
}

/** The status-bar cycle order across the visible rail trays. */
function useCommentCycle(
  opts: RailModelOptions,
  trays: FilteredTrays,
  hiddenSet: Set<string>,
  orphanedSet: Set<string>,
): string[] {
  const { anchorLayout, onlyThisFile, activeReadOnly, activeDraft, draftY } =
    opts;

  const {
    filteredCurrentThreads,
    filteredGeneralThreads,
    filteredOrphanedFileThreads,
  } = trays;

  return useMemo(
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
}

/** Thread/comment tallies for the search summary, header and filter menu. */
function useRailCounts(opts: RailModelOptions) {
  const {
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    onlyThisFile,
    currentUserId,
  } = opts;

  // Counts for the search summary line.
  const totalCommentCount = useMemo(() => {
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
  const resolvedThreadCount = useMemo(() => {
    let n = 0;

    for (const t of currentThreadsRaw) {
      if (isResolvedLike(t.status)) n += 1;
    }

    return n;
  }, [currentThreadsRaw]);

  // Number of current threads still open (not resolved/wontFix/closed). When
  // this reaches zero on a file that had comments, the rail header celebrates.
  const openThreadCount = useMemo(() => {
    let n = 0;

    for (const t of currentThreadsRaw) {
      if (!isResolvedLike(t.status)) n += 1;
    }

    return n;
  }, [currentThreadsRaw]);

  // Live per-bucket counts backing the rail's comment filter menu, tallied
  // across every tray the rail surfaces (current file + General + orphaned).
  const filterCounts = useMemo<CommentFilterCounts>(
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
    totalCommentCount,
    resolvedThreadCount,
    openThreadCount,
    filterCounts,
  };
}
