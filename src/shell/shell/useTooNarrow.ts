// Shell: detects a reader frame too narrow for its columns.

import * as React from "react";

import { readerMinWidth, type ReaderPrefs } from "../readerPrefs";

/**
 * Graceful degradation: when the reader frame is narrower than the VISIBLE
 * columns need (a very narrow window, or zoomed in), disable the reader and
 * show a calm notice instead of crushing the prose. Single-file panels keep
 * their legacy shrink-and-scroll behaviour, so they never trip this.
 */
export function useTooNarrow(
  bodyFrameRef: React.MutableRefObject<HTMLDivElement | null>,
  hideDocNav: boolean | undefined,
  commentsAvailable: boolean,
  readerPrefs: ReaderPrefs,
): boolean {
  const [tooNarrow, setTooNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    // Single-file panels keep their legacy shrink-and-scroll behaviour, so they
    // never disable the reader.
    if (hideDocNav) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- single-file mode tears down the ResizeObserver that owns this flag, so the layout effect clears it before paint; deriving it instead would resurface a stale `true` if the frame is absent when the nav returns.
      setTooNarrow(false);
      return;
    }
    const frame = bodyFrameRef.current;
    if (!frame) return;
    // Budget for the comment rail when it can be revealed. A document that has
    // explicitly resolved without a housing PR has no comments UI to reserve.
    const need = readerMinWidth(
      readerPrefs.showNav,
      commentsAvailable,
      readerPrefs.navWidthPct,
      readerPrefs.commentWidthPct,
    );
    const measure = (): void => setTooNarrow(frame.clientWidth < need);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    hideDocNav,
    commentsAvailable,
    readerPrefs.showNav,
    readerPrefs.navWidthPct,
    readerPrefs.commentWidthPct,
    bodyFrameRef,
  ]);
  return tooNarrow;
}
