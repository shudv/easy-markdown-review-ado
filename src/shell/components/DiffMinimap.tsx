// Custom reader scrollbar with an inline diff overview.
//
// Replaces the native scrollbar with ONE thin bar in the usual right-edge
// position: a draggable thumb sized + placed with real native-scrollbar math
// (so it reaches the bottom EXACTLY at max scroll — no end-of-scroll drift),
// over a track that, when "view changes" is on, subtly charts every edit
// (green add / amber edit / red delete). Wheel + keyboard scrolling stay
// native; this owns the visual thumb, drag, click-to-page, and the diff ticks.
// Self-hides when the document fits and hides the native scrollbar only while
// active. Reads the already-decorated article DOM out of the scroll container.
// Pure geometry lives in `./diffMinimap.helpers`.

import * as React from "react";

import {
  classifyDiffElement,
  markerFraction,
  markerInViewport,
  mergeMarkers,
  resolveOverlaps,
  scrollFromThumbDrag,
  scrollTargetForFraction,
  thumbMetrics,
  viewportRange,
  type DiffMarker,
} from "./diffMinimap.helpers";

interface DiffMinimapProps {
  /** The reader's scroll container whose decorated diffs we chart. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Bumped when the article HTML / diff decorations change → remeasure. */
  version: number;
  /**
   * Whether to chart the diff ticks. When false the bar is a plain custom
   * scrollbar (thumb only).
   */
  showDiff: boolean;
}

const MERGE_GAP = 0.012;
const MARKER_SELECTOR = ".emr-diff-block, .emr-diff-deleted-marker";
// Minimum grabbable thumb, like a native scrollbar.
const MIN_THUMB = 28;

const KIND_TITLE: Record<DiffMarker["kind"], string> = {
  added: "Added",
  modified: "Edited",
  deleted: "Removed",
};

interface Metrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

function readMetrics(scroller: HTMLElement): Metrics {
  return {
    scrollTop: scroller.scrollTop,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
  };
}

export function DiffMinimap({
  scrollRef,
  version,
  showDiff,
}: DiffMinimapProps): React.ReactElement | null {
  const [markers, setMarkers] = React.useState<DiffMarker[]>([]);
  const [metrics, setMetrics] = React.useState<Metrics>({
    scrollTop: 0,
    clientHeight: 0,
    scrollHeight: 0,
  });
  const [scrollable, setScrollable] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);

  const measure = React.useCallback(() => {
    const scroller = scrollRef.current;
    /* v8 ignore next -- scrollRef (the reader body) is attached before effects run; defensive guard */
    if (!scroller) return;
    const m = readMetrics(scroller);
    const scRect = scroller.getBoundingClientRect();
    const raw: DiffMarker[] = [];
    if (showDiff) {
      scroller.querySelectorAll<HTMLElement>(MARKER_SELECTOR).forEach((el) => {
        const kind = classifyDiffElement(el);
        if (!kind) return;
        const r = el.getBoundingClientRect();
        const elTop = r.top - scRect.top + scroller.scrollTop;
        raw.push({ ...markerFraction(elTop, r.height, m.scrollHeight), kind });
      });
    }
    setMarkers(resolveOverlaps(mergeMarkers(raw, MERGE_GAP)));
    setMetrics(m);
    setScrollable(m.scrollHeight > m.clientHeight + 1);
  }, [scrollRef, showDiff]);

  const syncScroll = React.useCallback(() => {
    const scroller = scrollRef.current;
    /* v8 ignore next -- scroller is present whenever the scroll listener calling this is attached */
    if (!scroller) return;
    setMetrics(readMetrics(scroller));
  }, [scrollRef]);

  // Remeasure whenever the document / diff decorations / toggle change.
  React.useLayoutEffect(() => {
    measure();
  }, [measure, version]);

  // Follow ArticleView's post-decoration signal, plus scroll + resize.
  React.useEffect(() => {
    const scroller = scrollRef.current;
    /* v8 ignore next -- scrollRef is attached before effects run; defensive guard */
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncScroll);
    };
    // Coalesce resize / zoom / re-decoration bursts into ONE measure on the next
    // frame. Measuring synchronously mid-reflow (a zoom fires many resize events
    // while layout is still settling) reads an inconsistent scrollHeight vs the
    // element rects, so the ticks jumped around before snapping back; deferring
    // to a frame reads a settled, self-consistent layout.
    let measureRaf = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(measureRaf);
      measureRaf = requestAnimationFrame(measure);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const wrap = scroller.querySelector(".emr-article-wrap");
    wrap?.addEventListener("emr-sections-changed", scheduleMeasure);
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(scroller);
    // Browser zoom (Ctrl +/-) reflows the article — changing scrollHeight /
    // clientHeight — but doesn't always resize the scroller's own box, so the
    // ResizeObserver can miss it. A window resize fires on every zoom step, so
    // re-measure there too to keep the tick fractions correct at any zoom.
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(measureRaf);
      scroller.removeEventListener("scroll", onScroll);
      wrap?.removeEventListener("emr-sections-changed", scheduleMeasure);
      ro.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [scrollRef, measure, syncScroll]);

  // Teardown for an in-flight thumb drag's document listeners, held in a ref so
  // an unmount mid-drag can run it even if `pointerup`/`pointercancel` never
  // fire (otherwise the listeners would leak and keep closing over a stale
  // scroller).
  const dragCleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    },
    [],
  );

  // The track spans the document's EXACT visible height; the card's top/bottom
  // margins (plus the ruler's CSS top offset) already inset it to align with the
  // reading surface, so no extra inset is subtracted here.
  const rulerH = metrics.clientHeight;
  const thumb = thumbMetrics(
    metrics.scrollTop,
    metrics.clientHeight,
    metrics.scrollHeight,
    rulerH,
    MIN_THUMB,
  );
  const viewportFrac = viewportRange(
    metrics.scrollTop,
    metrics.clientHeight,
    metrics.scrollHeight,
  );

  const jumpTo = (clientY: number) => {
    const track = trackRef.current;
    const scroller = scrollRef.current;
    /* v8 ignore next -- track + scroller exist whenever the rendered bar's click handler runs */
    if (!track || !scroller) return;
    const rect = track.getBoundingClientRect();
    const fraction = (clientY - rect.top) / rect.height;
    scroller.scrollTo({
      top: scrollTargetForFraction(
        fraction,
        scroller.scrollHeight,
        scroller.clientHeight,
      ),
      behavior: "smooth",
    });
  };

  // Drag the thumb to scroll — native 1:1 feel via document-level listeners.
  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    /* v8 ignore next -- scroller exists whenever the rendered thumb is grabbed */
    if (!scroller) return;
    // Tear down any listeners a previous drag left attached (defensive).
    dragCleanupRef.current?.();
    e.preventDefault();
    e.stopPropagation(); // don't let the track's click-to-page fire
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    const ch = scroller.clientHeight;
    const sh = scroller.scrollHeight;
    const onMove = (ev: PointerEvent) => {
      scroller.scrollTop = scrollFromThumbDrag(
        startScroll,
        ev.clientY - startY,
        ch,
        sh,
        // The track spans the full visible height now, so trackPx === clientHeight.
        ch,
        MIN_THUMB,
      );
    };
    // End the drag on pointerup OR pointercancel, and expose the teardown via a
    // ref so an unmount mid-drag can also run it — otherwise these document
    // listeners would leak and keep closing over a stale scroller.
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cleanup);
      document.removeEventListener("pointercancel", cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", cleanup);
    document.addEventListener("pointercancel", cleanup);
  };

  // The document fits — no scrollbar (native or custom) is needed.
  if (!scrollable) return null;

  return (
    <div
      ref={trackRef}
      className="emr-diff-ruler"
      style={{ height: `${rulerH}px` }}
      // A visual scroll aid duplicating the scrollbar; the accessible paths to
      // content + changes are the document and the outline, so it's AT-hidden.
      aria-hidden="true"
      title={
        showDiff
          ? "Changes in this document — drag or click to scroll"
          : "Scroll"
      }
      onClick={(e) => jumpTo(e.clientY)}
    >
      {/*
        The thumb is rendered FIRST so the change ticks paint on TOP of it — a
        tick that fell under the translucent thumb otherwise muddied into an odd
        two-tone blob. Ticks are pointer-events:none, so the thumb underneath
        still receives drags.
      */}
      <div
        className="emr-diff-ruler-thumb"
        style={{ top: `${thumb.topPx}px`, height: `${thumb.heightPx}px` }}
        onPointerDown={onThumbPointerDown}
        onClick={(e) => e.stopPropagation()}
      />
      {markers.map((m, i) => (
        <div
          key={i}
          className={
            `emr-diff-ruler-mark emr-diff-ruler-mark--${m.kind}` +
            (markerInViewport(m, viewportFrac) ? " is-active" : "")
          }
          title={KIND_TITLE[m.kind]}
          style={{ top: `${m.top * 100}%`, height: `${m.height * 100}%` }}
        />
      ))}
    </div>
  );
}
