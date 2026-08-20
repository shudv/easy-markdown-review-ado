// Pure geometry + classification helpers for the custom reader scrollbar
// (`DiffMinimap`). The bar sits in the usual right-edge position and, when
// "view changes" is on, maps every change onto a proportional tick; a native-
// math thumb tracks what's on screen — so a reviewer sees, at a glance, where
// the diffs live and can drag or click to jump there.
//
// The DOM measurement (getBoundingClientRect) lives in the component; the maths
// below is kept here, component-free, so it can be unit-tested directly.

/** The three change hues a tick can take, mirroring the article diff palette. */
export type DiffMarkerKind = "added" | "modified" | "deleted";

/** A change mapped onto the ruler as fractions (0..1) of the document height. */
export interface DiffMarker {
  /** Fraction of document height where the change starts. */
  top: number;
  /** Fraction of document height the change spans. */
  height: number;
  kind: DiffMarkerKind;
}

/** The on-screen portion of the document, as fractions (0..1). */
export interface ViewportRange {
  top: number;
  height: number;
}

/** A closed [top, bottom] interval in fractional ruler coordinates. */
interface Span {
  top: number;
  bottom: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Native-scrollbar thumb geometry in pixels. The thumb height is proportional
 * to the visible fraction but never smaller than `minThumbPx`, and — crucially
 * — its top is mapped over the AVAILABLE track (`trackPx - thumbHeight`) so it
 * reaches the bottom EXACTLY at max scroll. (A naive `scrollTop/scrollHeight`
 * mapping combined with a min-height thumb overshoots at the ends, which reads
 * as "extra movement" near the bottom.)
 */
export function thumbMetrics(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  trackPx: number,
  minThumbPx: number,
): { topPx: number; heightPx: number } {
  if (trackPx <= 0 || scrollHeight <= clientHeight) {
    return { topPx: 0, heightPx: Math.max(0, trackPx) };
  }
  const heightPx = clamp(
    (clientHeight / scrollHeight) * trackPx,
    Math.min(minThumbPx, trackPx),
    trackPx,
  );
  const maxScroll = scrollHeight - clientHeight;
  const maxTop = trackPx - heightPx;
  // maxScroll > 0 here (the fits-in-view case returned above).
  const topPx = (scrollTop / maxScroll) * maxTop;
  return { topPx: clamp(topPx, 0, maxTop), heightPx };
}

/**
 * The scrollTop that results from dragging the thumb by `deltaY` px from
 * `startScrollTop`. Native feel: the thumb tracks the pointer 1:1 across the
 * available track, and the content scrolls proportionally — clamped so a drag
 * past either end doesn't over-scroll.
 */
export function scrollFromThumbDrag(
  startScrollTop: number,
  deltaY: number,
  clientHeight: number,
  scrollHeight: number,
  trackPx: number,
  minThumbPx: number,
): number {
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0 || trackPx <= 0) return startScrollTop;
  const heightPx = clamp(
    (clientHeight / scrollHeight) * trackPx,
    Math.min(minThumbPx, trackPx),
    trackPx,
  );
  const maxTop = trackPx - heightPx;
  // Degenerate case: a track shorter than the min thumb can't be dragged.
  if (maxTop <= 0) return startScrollTop;
  const startThumbTop = (startScrollTop / maxScroll) * maxTop;
  const nextThumbTop = clamp(startThumbTop + deltaY, 0, maxTop);
  return (nextThumbTop / maxTop) * maxScroll;
}

/**
 * Classify a decorated diff element by its class into a marker hue, or `null`
 * when it isn't a change element we chart. A deleted marker wins (it carries no
 * block modifier), then added, then modified.
 */
export function classifyDiffElement(el: Element): DiffMarkerKind | null {
  if (el.classList.contains("emr-diff-deleted-marker")) return "deleted";
  if (el.classList.contains("emr-diff-block--added")) return "added";
  if (el.classList.contains("emr-diff-block--modified")) return "modified";
  return null;
}

/**
 * Map an element's pixel offset + height within the scrollable content to
 * fractional ruler coordinates. Returns zeroes when the content has no height.
 */
export function markerFraction(
  elTop: number,
  elHeight: number,
  scrollHeight: number,
): { top: number; height: number } {
  if (scrollHeight <= 0) return { top: 0, height: 0 };
  return {
    top: clamp01(elTop / scrollHeight),
    height: clamp01(elHeight / scrollHeight),
  };
}

/**
 * Collapse a run of markers into fewer, cleaner bars: adjacent markers of the
 * SAME kind whose gap is within `gap` (fraction units) merge into one span.
 * Input is assumed to be in document order; different kinds never merge so
 * their hues stay distinct. Keeps the ruler concise when a big added/edited
 * section would otherwise render as a stack of tiny ticks.
 */
export function mergeMarkers(
  markers: readonly DiffMarker[],
  gap: number,
): DiffMarker[] {
  const sorted = [...markers].sort((a, b) => a.top - b.top);
  const out: DiffMarker[] = [];
  for (const m of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === m.kind && m.top <= prev.top + prev.height + gap) {
      const bottom = Math.max(prev.top + prev.height, m.top + m.height);
      prev.height = bottom - prev.top;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

/**
 * Remove from `spans` any portion covered by [cutTop, cutBottom], splitting a
 * span that straddles the cut into the parts above and below it.
 */
function subtractSpan(
  spans: readonly Span[],
  cutTop: number,
  cutBottom: number,
): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (cutBottom <= s.top || cutTop >= s.bottom) {
      out.push(s); // no overlap — keep as-is
      continue;
    }
    if (cutTop > s.top) out.push({ top: s.top, bottom: cutTop });
    if (cutBottom < s.bottom) out.push({ top: cutBottom, bottom: s.bottom });
  }
  return out;
}

/**
 * Ensure no two ticks occupy the same span. The ruler charts change blocks
 * (added / modified) AND separate deleted-content markers, and in the document
 * a deletion often sits inside or against an edited block — so their fractional
 * ranges overlap and the delete tick would otherwise paint an odd band inside
 * the edit. The deleted tick takes precedence and KEEPS its own span; the
 * enclosing block is clipped around it — split into the parts above and below
 * the deletion — so a deletion inside an edit reads as edit · removed · edit
 * instead of a muddled overlap. Result: clean, adjacent, non-overlapping ticks.
 */
export function resolveOverlaps(markers: readonly DiffMarker[]): DiffMarker[] {
  const rank = (k: DiffMarkerKind): number => (k === "deleted" ? 1 : 0);
  const ordered = [...markers].sort(
    (a, b) => rank(b.kind) - rank(a.kind) || a.top - b.top,
  );
  const occupied: Span[] = [];
  const kept: DiffMarker[] = [];
  for (const m of ordered) {
    let spans: Span[] = [{ top: m.top, bottom: m.top + m.height }];
    for (const occ of occupied)
      spans = subtractSpan(spans, occ.top, occ.bottom);
    for (const s of spans) {
      kept.push({ top: s.top, height: s.bottom - s.top, kind: m.kind });
      occupied.push(s);
    }
  }
  return kept.sort((a, b) => a.top - b.top);
}

/** The visible viewport as a fraction of the scrollable content. */
export function viewportRange(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): ViewportRange {
  if (scrollHeight <= 0) return { top: 0, height: 1 };
  return {
    top: clamp01(scrollTop / scrollHeight),
    height: clamp01(clientHeight / scrollHeight),
  };
}

/**
 * Given a click at fraction `f` down the ruler, the scrollTop that centres that
 * point of the document in the viewport (clamped to the scrollable range).
 */
export function scrollTargetForFraction(
  fraction: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const target = fraction * scrollHeight - clientHeight / 2;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(target, max));
}

/** Whether a marker overlaps the current viewport (drives the "active" glow). */
export function markerInViewport(
  marker: DiffMarker,
  viewport: ViewportRange,
): boolean {
  const mBottom = marker.top + marker.height;
  const vBottom = viewport.top + viewport.height;
  return marker.top < vBottom && viewport.top < mBottom;
}
