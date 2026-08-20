import type { CommentThread } from "../../types";
import type { CommentFilterMode } from "./commentFilter";
import { orderComments } from "./commentOrder";

/** Sentinel id for the in-progress draft balloon in the anchored list. */
export const DRAFT_ID = "__draft__";

/** Epoch ms of a thread's creation (its root comment's timestamp). */
export function threadCreatedAt(t: CommentThread): number {
  const iso = t.comments[0]?.createdAt;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** The rail's derived view model: which comments render, and in what order. */
export interface RailModel {
  /** Anchored (current-file) thread + draft ids, top-to-bottom. */
  orderedAnchoredIds: string[];
  /** Whether each anchored id is a real thread or the in-progress draft. */
  kindById: Map<string, "thread" | "draft">;
  /** True when at least one anchored entry is a real thread (not just a draft). */
  hasAnchoredThreads: boolean;
  /** Current-file threads whose quoted anchor is gone, newest first. */
  orphanedThreads: CommentThread[];
  /** PR-level "general" threads (hidden under "only this file"), newest first. */
  visibleGeneralThreads: CommentThread[];
  /** Threads on files removed from the PR, newest first. */
  visibleOrphanedFileThreads: CommentThread[];
  /** True when at least one comment (any group) is currently visible. */
  hasVisibleComments: boolean;
  /** Every visible comment id in prev/next cycle order (anchored, then trays). */
  cycleThreadIds: string[];
}

/**
 * Shape the rail's threads into an ordered, grouped view model. The rail is a
 * plain flow list, so this is the whole layout: anchored current-file comments
 * ordered by their anchor's document position (newest-first on a tie), then the
 * unanchored trays below. Pure + component-free so the ordering/grouping is
 * unit-tested directly rather than through the rendered rail (and keeps the
 * `CommentRail` component's complexity in check).
 */
export function buildRailModel(params: {
  currentThreads: CommentThread[];
  generalThreads: CommentThread[];
  orphanedFileThreads: CommentThread[];
  hiddenThreadIds: Set<string>;
  orphanedThreadIds: Set<string>;
  yByThreadId: Map<string, number>;
  /** The in-progress draft's anchor Y, or null when there's no live draft. */
  draftY: number | null;
  onlyThisFile: boolean;
}): RailModel {
  const {
    currentThreads,
    generalThreads,
    orphanedFileThreads,
    hiddenThreadIds,
    orphanedThreadIds,
    yByThreadId,
    draftY,
    onlyThisFile,
  } = params;

  const kindById = new Map<string, "thread" | "draft">();
  const orderInput: Array<{ id: string; anchorY: number; createdAt: number }> =
    [];
  for (const t of currentThreads) {
    if (hiddenThreadIds.has(t.id)) continue;
    if (orphanedThreadIds.has(t.id)) continue;
    const y = yByThreadId.get(t.id);
    if (y === undefined) continue;
    kindById.set(t.id, "thread");
    orderInput.push({ id: t.id, anchorY: y, createdAt: threadCreatedAt(t) });
  }
  if (draftY !== null) {
    kindById.set(DRAFT_ID, "draft");
    // The draft is the freshest thing at its anchor, so it sorts as "newest".
    orderInput.push({
      id: DRAFT_ID,
      anchorY: draftY,
      createdAt: Number.MAX_SAFE_INTEGER,
    });
  }
  const orderedAnchoredIds = orderComments(orderInput);
  const hasAnchoredThreads = orderedAnchoredIds.some(
    (id) => kindById.get(id) === "thread",
  );

  const byNewest = (a: CommentThread, b: CommentThread): number =>
    threadCreatedAt(b) - threadCreatedAt(a);
  const notHidden = (t: CommentThread): boolean => !hiddenThreadIds.has(t.id);

  const orphanedThreads = currentThreads
    .filter((t) => orphanedThreadIds.has(t.id) && notHidden(t))
    .sort(byNewest);
  const visibleGeneralThreads = (
    onlyThisFile ? [] : generalThreads.filter(notHidden)
  ).sort(byNewest);
  const visibleOrphanedFileThreads = (
    onlyThisFile ? [] : orphanedFileThreads.filter(notHidden)
  ).sort(byNewest);

  const hasVisibleComments =
    hasAnchoredThreads ||
    orphanedThreads.length > 0 ||
    visibleGeneralThreads.length > 0 ||
    visibleOrphanedFileThreads.length > 0;

  // The prev/next cycler visits every visible comment top-to-bottom: anchored
  // first, then the orphaned-anchor / general / orphaned-file trays (which
  // auto-expand when the cycler lands on them).
  const cycleThreadIds = [
    ...orderedAnchoredIds.filter((id) => kindById.get(id) === "thread"),
    ...orphanedThreads.map((t) => t.id),
    ...visibleGeneralThreads.map((t) => t.id),
    ...visibleOrphanedFileThreads.map((t) => t.id),
  ];

  return {
    orderedAnchoredIds,
    kindById,
    hasAnchoredThreads,
    orphanedThreads,
    visibleGeneralThreads,
    visibleOrphanedFileThreads,
    hasVisibleComments,
    cycleThreadIds,
  };
}

/**
 * Pick the single line shown when the positioned region is empty — kept free of
 * contradictions with the header. An active query reports its empty result;
 * filter-driven emptiness stays silent because the header already names the
 * active class (Active / Resolved / My comments). A rail with threads parked in
 * the historical / orphaned / general trays also says nothing because those
 * sections speak for themselves. Only a genuinely empty file gets the "start a
 * thread" invite.
 *
 * Lives in a component-free helper module so pure-logic tests can import it
 * without dragging the React component tree (and its transitive `CommentRow`
 * import) into the jsdom unit project.
 */
export function chooseRailEmptyMessage(opts: {
  commentQuery: string;
  filterMode: CommentFilterMode;
  /**
   * Number of current-file threads of ANY status, BEFORE the active filter
   * hides some. When positive and the filter is narrowing, the rail is empty
   * because the filter hid everything — so we name the filter rather than
   * inviting a new thread.
   */
  fileThreadCount: number;
  hasOtherSections: boolean;
  readOnly: boolean;
}): string | null {
  const {
    commentQuery,
    filterMode,
    fileThreadCount,
    hasOtherSections,
    readOnly,
  } = opts;
  if (commentQuery) return `No comments match “${commentQuery}”.`;
  if (fileThreadCount > 0 && filterMode !== "all") return null;
  if (hasOtherSections) return null;
  return readOnly
    ? "No comments on this file."
    : "No comments on this file yet. Select any text to start a thread.";
}
