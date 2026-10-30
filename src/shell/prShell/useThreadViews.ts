// PrShell: the thread sets shown for the selected document.

import * as React from "react";

import type { CommentThread, FileInfo } from "../../types";
import { isResolvedLike } from "../../types";
import {
  selectGeneralThreads,
  selectThreadsByFile,
  type ThreadState,
} from "../../comments/store";
import {
  threadVisibleForCommentView,
  type CommentFilterMode,
} from "../components/commentFilter";

/** Stable empty thread list for the stepper's read-only historical fallback. */
const EMPTY_THREADS: CommentThread[] = [];

interface ThreadViewsOptions {
  threadState: ThreadState;
  selectedPath: string;
  files: FileInfo[];
  isHub: boolean;
  viewingHistorical: boolean;
  nativeIterationMode: boolean;
  activeStopPrId: number | null;
  historicalThreadsByKey: Record<string, CommentThread[]>;
  commentQuery: string;
  commentFilter: CommentFilterMode;
  currentUserId: string;
}

/** The thread sets the article, rail and file list render from. */
export function useThreadViews(opts: ThreadViewsOptions) {
  const {
    threadState,
    selectedPath,
    files,
    isHub,
    viewingHistorical,
    nativeIterationMode,
    activeStopPrId,
    historicalThreadsByKey,
    commentQuery,
    commentFilter,
    currentUserId,
  } = opts;
  const allThreadsForFile = React.useMemo(
    () => selectThreadsByFile(threadState, selectedPath),
    [threadState, selectedPath],
  );

  // The writable "Current" head's threads for this file (from the live reducer
  // state / poller). When the stepper is parked on a historical stop we show
  // that PR's threads instead — read-only, loaded on demand and cached by id.
  const currentThreadsRaw = React.useMemo(() => {
    if (viewingHistorical && !nativeIterationMode) {
      /* v8 ignore start -- historical-PR view branch; not exercised in the unit/storybook harness */
      return activeStopPrId != null
        ? (historicalThreadsByKey[`${selectedPath}\u0000${activeStopPrId}`] ??
            EMPTY_THREADS)
        : EMPTY_THREADS;
      /* v8 ignore stop */
    }
    return allThreadsForFile;
  }, [
    viewingHistorical,
    nativeIterationMode,
    activeStopPrId,
    selectedPath,
    historicalThreadsByKey,
    allThreadsForFile,
  ]);

  // General PR-level ("Overview") comments — not tied to any file. Suppressed
  // in the hub (single-file, latest-master context — see `isHub`).
  const generalThreads = React.useMemo(
    () => (isHub ? EMPTY_THREADS : selectGeneralThreads(threadState)),
    [threadState, isHub],
  );

  // Threads anchored to a file that is NO LONGER part of this PR (the file was
  // removed from the PR's change set, so it has no tab and can never be opened
  // here). These would otherwise be unreachable, so they get their own tray
  // below the General section. NOTE: this is strictly "file gone from the PR" —
  // comments on files that ARE still in the PR belong to those files and show
  // when the reader opens them, never here. Suppressed in the hub (`isHub`):
  // there's no change-set to leave, and its file list is a partial lazy tree.
  const orphanedFileThreads = React.useMemo(() => {
    if (isHub) return EMPTY_THREADS;
    const inPr = new Set(files.map((f) => f.path));
    const out: CommentThread[] = [];
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- defensive: order ids always have a thread entry */
      if (!t) continue;
      // General/Overview threads have their own tray (an empty filePath always
      // means general in our data model, so this also covers file-less threads).
      if (t.general) continue;
      if (inPr.has(t.filePath)) continue;
      out.push(t);
    }
    return out;
  }, [threadState, files, isHub]);

  // Threads passed to ArticleView for anchoring: only those matching the
  // active comment filter (all / active / resolved / mine) are highlighted in
  // the prose, so the article and the rail always agree on what's shown.
  const visibleForArticle = React.useMemo(() => {
    const out: CommentThread[] = [];
    for (const t of currentThreadsRaw) {
      if (
        threadVisibleForCommentView(
          t,
          commentQuery,
          commentFilter,
          currentUserId,
        )
      ) {
        out.push(t);
      }
    }
    return out;
  }, [currentThreadsRaw, commentQuery, commentFilter, currentUserId]);

  const threadCountsByPath: Record<string, number> = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of threadState.order) {
      const t = threadState.threadsById[id];
      /* v8 ignore next -- defensive: order ids always have a thread entry */
      if (!t) continue;
      if (isResolvedLike(t.status)) continue;
      out[t.filePath] = (out[t.filePath] ?? 0) + 1;
    }
    return out;
  }, [threadState]);

  return {
    currentThreadsRaw,
    generalThreads,
    orphanedFileThreads,
    visibleForArticle,
    threadCountsByPath,
  };
}
