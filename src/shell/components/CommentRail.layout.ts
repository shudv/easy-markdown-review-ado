// Pure layout decisions for the CommentRail (draft placement, header and tray
// visibility, empty-state copy), kept out of the component so it stays a thin
// renderer.

import type { CommentThread, TextQuoteAnchor } from "../../types";
import { chooseRailEmptyMessage, type RailModel } from "./CommentRail.helpers";
import type { CommentFilterMode } from "./commentFilter";

/** The draft's anchor Y while a live draft can be placed, else null. */
export function railDraftY(
  readOnly: boolean,
  draftAnchor: TextQuoteAnchor | null,
  draftY: number | null,
): number | null {
  return !readOnly && draftAnchor && draftY !== null ? draftY : null;
}

/**
 * Whether a collapsible cross-file tray renders expanded: the user opened it,
 * its comment is active (e.g. status-bar navigation landed there, so the
 * selected balloon must be on screen), or a search matched something in it.
 */
export function isRailTrayExpanded(opts: {
  collapsed: boolean;
  threads: CommentThread[];
  activeThreadId: string | null;
  searchActive: boolean;
}): boolean {
  const { collapsed, threads, activeThreadId, searchActive } = opts;
  const activeInTray =
    activeThreadId != null && threads.some((t) => t.id === activeThreadId);
  return !collapsed || activeInTray || (searchActive && threads.length > 0);
}

/**
 * Show the rail header when there are comments OR a (visible) routed PR to
 * link to. When the pill is suppressed (PR tab) the PR alone doesn't warrant
 * a header — comments do.
 */
export function shouldShowRailHeader(opts: {
  readOnly: boolean;
  totalCommentCount: number;
  orphanedFileThreadCount: number;
  hasRoutedPr: boolean;
  hidePrPill: boolean | undefined;
}): boolean {
  return (
    !opts.readOnly ||
    opts.totalCommentCount > 0 ||
    opts.orphanedFileThreadCount > 0 ||
    (opts.hasRoutedPr && !opts.hidePrPill)
  );
}

/** Empty-state copy when nothing is anchored on this file (and no draft). */
export function railEmptyMessageFor(
  model: Pick<
    RailModel,
    | "orderedAnchoredIds"
    | "orphanedThreads"
    | "visibleGeneralThreads"
    | "visibleOrphanedFileThreads"
  >,
  opts: {
    hasDraft: boolean;
    commentQuery: string;
    filterMode: CommentFilterMode;
    fileThreadCount: number;
    readOnly: boolean;
  },
): string | null {
  if (model.orderedAnchoredIds.length > 0 || opts.hasDraft) return null;
  return chooseRailEmptyMessage({
    commentQuery: opts.commentQuery,
    filterMode: opts.filterMode,
    fileThreadCount: opts.fileThreadCount,
    hasOtherSections:
      model.orphanedThreads.length > 0 ||
      model.visibleGeneralThreads.length > 0 ||
      model.visibleOrphanedFileThreads.length > 0,
    readOnly: opts.readOnly,
  });
}
