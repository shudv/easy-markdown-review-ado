// Pure comment ordering for the split-scroll comment rail.
//
// The rail is a plain top-to-bottom list (no absolute positioning, so overlap
// is impossible by construction), which means its ORDER is the whole UX. The
// order is:
//   1. Anchored comments first, by their anchor's document position (top→bottom).
//   2. Unanchored comments (PR-level "general" + orphaned anchors) after them,
//      grouped at the bottom.
//   3. Tie-break — two comments at the same anchor position, or any two within
//      the unanchored group — newest first (most recent thread at the top).
//
// Kept pure + component-free so the ordering is unit-tested directly rather
// than through the rendered rail.

/** The minimum a thread needs to be placed in the rail's ordered list. */
export interface OrderableComment {
  id: string;
  /**
   * The anchor's resolved vertical position in the document, or `null` when
   * the comment isn't anchored to the current document (PR-level "general"
   * comments, or comments whose quoted anchor text was edited away).
   */
  anchorY: number | null;
  /** Thread creation time as epoch milliseconds (the root comment's timestamp). */
  createdAt: number;
}

/**
 * Order comments for the rail and return their ids top-to-bottom. See the
 * module comment for the ordering rules. The input is not mutated.
 */
export function orderComments(items: readonly OrderableComment[]): string[] {
  return [...items].sort(compareComments).map((i) => i.id);
}

/** Comparator implementing the anchored-then-unanchored, newest-first order. */
export function compareComments(
  a: OrderableComment,
  b: OrderableComment,
): number {
  const aAnchored = a.anchorY !== null;
  const bAnchored = b.anchorY !== null;
  // Anchored comments always precede unanchored ones.
  if (aAnchored !== bAnchored) return aAnchored ? -1 : 1;
  // Both anchored: order by document position (top of the document first).
  if (aAnchored && bAnchored && a.anchorY !== b.anchorY) {
    return a.anchorY! - b.anchorY!;
  }
  // Same anchor position, or both unanchored: newest thread first.
  return b.createdAt - a.createdAt;
}

/** Whether a thread's root comment sorts it into the anchored group. */
export function isAnchored(anchorY: number | null): boolean {
  return anchorY !== null;
}
