// Shell: persisted reader preferences and their setters.

import { useCallback, useEffect, useState } from "react";

import type { DraftScope } from "../draftStorage";
import {
  readReaderPrefs,
  writeReaderPrefs,
  DEFAULT_NAV_WIDTH_PCT,
  DEFAULT_COMMENT_WIDTH_PCT,
  type ReaderPrefs,
} from "../readerPrefs";

/**
 * Reader preferences, restored from + persisted to localStorage. Typography
 * (font + size) lives in a shared key so it follows the reader across every
 * surface; panel visibility + nav width are scoped to THIS surface (PR tab vs
 * Documents hub) so their different navigation needs don't bleed into each
 * other.
 */
export function useReaderPrefs(draftScope: DraftScope | undefined) {
  const prefsScope: DraftScope = draftScope ?? "pr";

  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() =>
    readReaderPrefs(prefsScope),
  );

  useEffect(() => {
    writeReaderPrefs(prefsScope, readerPrefs);
  }, [prefsScope, readerPrefs]);

  const toggleReaderNav = useCallback(
    () => setReaderPrefs((p) => ({ ...p, showNav: !p.showNav })),
    [],
  );

  const toggleReaderOutline = useCallback(
    () => setReaderPrefs((p) => ({ ...p, showOutline: !p.showOutline })),
    [],
  );

  const toggleReaderComments = useCallback(
    () => setReaderPrefs((p) => ({ ...p, showComments: !p.showComments })),
    [],
  );

  const setReaderFont = useCallback(
    (fontId: string) => setReaderPrefs((p) => ({ ...p, fontId })),
    [],
  );

  const setReaderSize = useCallback(
    (sizePct: number) => setReaderPrefs((p) => ({ ...p, sizePct })),
    [],
  );

  const setReaderSpacing = useCallback(
    (spacingPct: number) =>
      setReaderPrefs((p) => ({
        ...p,
        lineSpacingPct: spacingPct,
        paragraphSpacingPct: spacingPct,
        letterSpacingPct: spacingPct,
        wordSpacingPct: spacingPct,
      })),
    [],
  );

  const resetNavWidth = useCallback(
    () => setReaderPrefs((p) => ({ ...p, navWidthPct: DEFAULT_NAV_WIDTH_PCT })),
    [],
  );

  const resetCommentWidth = useCallback(
    () =>
      setReaderPrefs((p) => ({
        ...p,
        commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
      })),
    [],
  );

  // Reveal the comments pane if it's hidden — called when the reader starts (or
  // restores) a comment/reply draft, whose composer lives in the rail, so the
  // pane always shows the moment there is something to write.
  const revealComments = useCallback(
    () =>
      setReaderPrefs((p) =>
        p.showComments ? p : { ...p, showComments: true },
      ),
    [],
  );

  return {
    readerPrefs,
    setReaderPrefs,
    toggleReaderNav,
    toggleReaderOutline,
    toggleReaderComments,
    setReaderFont,
    setReaderSize,
    setReaderSpacing,
    resetNavWidth,
    resetCommentWidth,
    revealComments,
  };
}
