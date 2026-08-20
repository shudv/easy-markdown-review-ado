// Reader preferences — the reading font, text size and panel visibility the
// reader has chosen from the floating document toolbar. Typography (font +
// size) persists under a SINGLE global key so reading comfort follows the
// reader across every surface; panel visibility + nav width persist PER surface
// (keyed by `DraftScope`), because the PR tab and the Documents hub navigate
// differently — hiding a panel or resizing the nav in one shouldn't reshape the
// other. Best-effort throughout, mirroring `src/hub/lastVisited.ts`: every
// accessor swallows errors (private mode, quota, disabled storage, corrupt
// JSON) and degrades to the defaults rather than surfacing.

import type { DraftScope } from "./draftStorage";

/** A curated reading font: a stable id, a display name, and its CSS stack. */
export interface ReaderFont {
  /** Stable id persisted in prefs (never shown to the user). */
  id: string;
  /** Display name shown in the font list (rendered in its own face). */
  name: string;
  /** The `font-family` stack applied to the document prose. */
  stack: string;
}

// A deliberately small, curated set (Kindle-style) rather than an arbitrary
// font picker. Two sans (System / Verdana) and three screen-friendly serifs.
// "System" is the same UI sans as the surrounding app chrome; the serifs suit
// long-form reading. Mono is intentionally absent — code always renders in its
// own monospace face regardless of this choice.
export const READER_FONTS: readonly ReaderFont[] = [
  {
    id: "system",
    name: "System",
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Arial, sans-serif',
  },
  {
    id: "sitka",
    name: "Sitka",
    stack: '"Sitka Text", Sitka, Cambria, Georgia, serif',
  },
  {
    id: "georgia",
    name: "Georgia",
    stack: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "palatino",
    name: "Palatino",
    stack: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  },
  {
    id: "verdana",
    name: "Verdana",
    stack: "Verdana, Geneva, Tahoma, sans-serif",
  },
];

/** The out-of-the-box reading font (the system UI sans). */
export const DEFAULT_FONT_ID = "system";

// Text-size steps as a percentage of the reader's base size, with extra room
// on the small end so a reader can pull dense docs in tight. Discrete steps
// (no free slider) keep the control simple and avoid fiddly in-between sizes.
export const READER_SIZE_STEPS: readonly number[] = [
  70, 80, 90, 100, 115, 130, 150,
];

/** The out-of-the-box text size (100% = the reader's base size). */
export const DEFAULT_SIZE_PCT = 100;

// Document-navigation width bounds, as a percentage of the default rail width.
// The reader drags the nav's right border to resize it anywhere in this range
// (down to half width, up ~30%): pull it in to reclaim reading room — narrow
// enough that a further drag tips it closed — or push it out for long nested
// paths.
export const NAV_WIDTH_MIN_PCT = 50;
export const NAV_WIDTH_MAX_PCT = 130;

// The comment rail floors HIGHER than the nav: a comment thread (avatars, author
// names, the reply composer) looks cramped once its column gets too narrow, so
// it keeps a comfortable min — at the cost of a drag having to travel farther
// before the pane collapses.
export const COMMENT_WIDTH_MIN_PCT = 70;

/** The out-of-the-box document-navigation width (100% = the default rail). */
export const DEFAULT_NAV_WIDTH_PCT = 100;

/**
 * The out-of-the-box comment-rail width (100% = the default rail). The comment
 * rail resizes INDEPENDENTLY of the nav (its own drag handle + stored pref) and
 * shares the nav's ceiling but keeps a higher floor (`clampCommentWidthPct`).
 */
export const DEFAULT_COMMENT_WIDTH_PCT = 100;

/** The persisted reader-preferences shape. */
export interface ReaderPrefs {
  /** Selected reading font id (see `READER_FONTS`). */
  fontId: string;
  /** Selected text size as a percentage step (see `READER_SIZE_STEPS`). */
  sizePct: number;
  /** Whether the document-navigation panel is shown. */
  showNav: boolean;
  /** Whether the comments panel is shown. */
  showComments: boolean;
  /** Document-navigation width as a percentage of the default rail (50–130). */
  navWidthPct: number;
  /** Comment-rail width as a percentage of the default rail (70–130). */
  commentWidthPct: number;
}

/** The defaults applied when nothing is stored (or storage is unreadable). */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontId: DEFAULT_FONT_ID,
  sizePct: DEFAULT_SIZE_PCT,
  showNav: true,
  showComments: true,
  navWidthPct: DEFAULT_NAV_WIDTH_PCT,
  commentWidthPct: DEFAULT_COMMENT_WIDTH_PCT,
};

// Typography (font + text size) is GLOBAL — reading comfort follows the reader
// across every surface. Panel visibility + nav width are stored PER surface
// (`layoutStorageKey`) so hiding a panel or resizing the nav in the PR tab
// doesn't reshape the Documents hub (and vice versa).
export const READER_TYPE_KEY = "emr.reader.type";
export function layoutStorageKey(scope: DraftScope): string {
  return `emr.reader.layout.${scope}`;
}

/** Resolve a font id to its definition, falling back to the default font. */
export function resolveReaderFont(id: string): ReaderFont {
  // `READER_FONTS[0]` IS the default (system) font, so an unknown id falls back
  // to it. The non-null assertion is safe: the list is a non-empty literal.
  return READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0]!;
}

/** Snap an arbitrary percentage to the nearest step in `steps`. */
function clampToSteps(pct: number, steps: readonly number[]): number {
  let best = steps[0];
  let bestDelta = Math.abs(pct - best);
  for (const step of steps) {
    const delta = Math.abs(pct - step);
    if (delta < bestDelta) {
      best = step;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Step one notch up (`dir > 0`) or down (`dir < 0`) through `steps`, clamped at
 * the ends. Snaps to the current step first so a stray stored value still moves
 * predictably.
 */
function stepThroughSteps(
  pct: number,
  dir: number,
  steps: readonly number[],
): number {
  const current = clampToSteps(pct, steps);
  const idx = steps.indexOf(current);
  const next = Math.min(
    steps.length - 1,
    Math.max(0, idx + (dir < 0 ? -1 : 1)),
  );
  return steps[next];
}

/** Snap an arbitrary percentage to the nearest valid size step. */
export function clampSizePct(pct: number): number {
  return clampToSteps(pct, READER_SIZE_STEPS);
}

/**
 * Step the text size one notch up (`dir > 0`) or down (`dir < 0`) through
 * `READER_SIZE_STEPS`, clamped at the ends.
 */
export function stepSizePct(pct: number, dir: number): number {
  return stepThroughSteps(pct, dir, READER_SIZE_STEPS);
}

function clampWidthPct(pct: number, minPct: number): number {
  return Math.round(Math.max(minPct, Math.min(NAV_WIDTH_MAX_PCT, pct)));
}

/** Clamp a (drag-derived) percentage into the resizable nav-width range. */
export function clampNavWidthPct(pct: number): number {
  return clampWidthPct(pct, NAV_WIDTH_MIN_PCT);
}

/** Clamp a comment-rail percentage — the nav's ceiling, but a higher floor. */
export function clampCommentWidthPct(pct: number): number {
  return clampWidthPct(pct, COMMENT_WIDTH_MIN_PCT);
}

/**
 * A finite, in-range CSS scale factor (0.5–1.3) for a width pref. Clamps to the
 * width bounds and substitutes the default for a non-finite value, so an inline
 * `--emr-*-scale` custom property can never carry `NaN` or an out-of-range
 * factor into the layout `calc()` (which would collapse or balloon the pane).
 */
export function widthScale(pct: number): number {
  return (
    clampNavWidthPct(Number.isFinite(pct) ? pct : DEFAULT_NAV_WIDTH_PCT) / 100
  );
}

// Pane collapse/reopen by drag. Dragging a rail's resize handle so its target
// width drops below `PANE_CLOSE_AT_PCT` (just past the 50% resize floor, so the
// pane shrinks most of the way before it goes rather than snapping shut from a
// stuck min) auto-closes the pane; from the closed state, dragging inward from
// the freed document edge past `PANE_REOPEN_TRIGGER_PX` reopens it. Both drive
// the same showNav/showComments state the status-bar toggles do, so the two
// stay in lockstep.
export const PANE_CLOSE_AT_PCT = 45;
export const PANE_REOPEN_TRIGGER_PX = 24;

/** True when a resize drag's target width pct is small enough to auto-close. */
export function dragClosesPane(targetPct: number): boolean {
  return targetPct < PANE_CLOSE_AT_PCT;
}

/** True when an inward reopen-grab drag (px) is far enough to reopen a pane. */
export function dragReopensPane(inwardPx: number): boolean {
  return inwardPx >= PANE_REOPEN_TRIGGER_PX;
}

/** Coerce an unknown parsed value into a valid `ReaderPrefs` (never throws). */
export function sanitizeReaderPrefs(value: unknown): ReaderPrefs {
  if (!value || typeof value !== "object") return { ...DEFAULT_READER_PREFS };
  const v = value as Partial<Record<keyof ReaderPrefs, unknown>>;
  const fontId =
    typeof v.fontId === "string" && READER_FONTS.some((f) => f.id === v.fontId)
      ? v.fontId
      : DEFAULT_FONT_ID;
  const sizePct =
    typeof v.sizePct === "number" && Number.isFinite(v.sizePct)
      ? clampSizePct(v.sizePct)
      : DEFAULT_SIZE_PCT;
  const navWidthPct =
    typeof v.navWidthPct === "number" && Number.isFinite(v.navWidthPct)
      ? clampNavWidthPct(v.navWidthPct)
      : DEFAULT_NAV_WIDTH_PCT;
  const commentWidthPct =
    typeof v.commentWidthPct === "number" && Number.isFinite(v.commentWidthPct)
      ? clampCommentWidthPct(v.commentWidthPct)
      : DEFAULT_COMMENT_WIDTH_PCT;
  return {
    fontId,
    sizePct,
    showNav: typeof v.showNav === "boolean" ? v.showNav : true,
    showComments: typeof v.showComments === "boolean" ? v.showComments : true,
    navWidthPct,
    commentWidthPct,
  };
}

/** Best-effort JSON read from `key`; null on missing / unreadable / bad JSON. */
function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort read of the reader's prefs for `scope`: the GLOBAL typography
 * (font + size) merged with THIS surface's own layout (panel visibility + nav
 * width). Missing / unreadable halves fall back to the defaults.
 */
export function readReaderPrefs(scope: DraftScope): ReaderPrefs {
  return sanitizeReaderPrefs({
    ...(readStored(READER_TYPE_KEY) as Record<string, unknown> | null),
    ...(readStored(layoutStorageKey(scope)) as Record<string, unknown> | null),
  });
}

/**
 * Best-effort persist of the prefs: the typography half to the shared global
 * key, the layout half to this surface's own key. Silent on failure.
 */
export function writeReaderPrefs(scope: DraftScope, prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(
      READER_TYPE_KEY,
      JSON.stringify({ fontId: prefs.fontId, sizePct: prefs.sizePct }),
    );
    localStorage.setItem(
      layoutStorageKey(scope),
      JSON.stringify({
        showNav: prefs.showNav,
        showComments: prefs.showComments,
        navWidthPct: prefs.navWidthPct,
        commentWidthPct: prefs.commentWidthPct,
      }),
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Anchored-layout width budget (graceful degradation)
// ---------------------------------------------------------------------------
// The reader is a row of anchored columns: a fixed nav rail, a document region
// with a min-width floor plus its overview scrollbar, and a fixed comment rail.
// When the frame is narrower than the VISIBLE columns need, the reader disables
// cleanly (a "more room needed" notice) instead of crushing the prose or
// scrolling horizontally. These constants MIRROR the SCSS layout sizes (the
// 340px nav base in `.emr-body__nav`'s flex-basis, `--emr-doc-min-w`,
// `--emr-grid-rail`, `--emr-scrollbar-w` in styles.scss); keep them in sync.
const READER_NAV_W = 340;
const READER_DOC_MIN_W = 440;
const READER_RAIL_W = 340;
const READER_SCROLLBAR_W = 12;

/**
 * The minimum frame width (px) the reader needs with the given panels visible.
 * The document region + its overview scrollbar are always present; the nav adds
 * its width — scaled by `navWidthPct` — when shown, and the comment rail adds
 * its width — scaled INDEPENDENTLY by `commentWidthPct` — when shown. The comment
 * rail carries a NATIVE scrollbar inside its own width (no separate column), so
 * only the document's overview bar counts as an extra scrollbar column. Hiding a
 * panel LOWERS the threshold, so a reader can recover from the disabled state by
 * hiding a panel as well as by widening.
 */
export function readerMinWidth(
  navShown: boolean,
  commentsShown: boolean,
  navWidthPct: number = DEFAULT_NAV_WIDTH_PCT,
  commentWidthPct: number = DEFAULT_COMMENT_WIDTH_PCT,
): number {
  return (
    (navShown ? Math.round((READER_NAV_W * navWidthPct) / 100) : 0) +
    READER_DOC_MIN_W +
    READER_SCROLLBAR_W +
    (commentsShown ? Math.round((READER_RAIL_W * commentWidthPct) / 100) : 0)
  );
}

/**
 * The widest a resizable rail may grow (as a % of its 340px base) before the
 * document would be squeezed below its min-width floor, given the current frame
 * width and the OTHER rail's current pixel width. Clamped into the rail's ±30%
 * range so a drag also can't exceed the design bounds. Callers cap a drag at
 * this so the resize STOPS at the edge of the usable space instead of tipping
 * the whole reader into the too-narrow ("more room needed") state.
 */
export function maxRailWidthPct(
  frameWidth: number,
  otherRailWidthPx: number,
): number {
  const availPx =
    frameWidth - READER_DOC_MIN_W - READER_SCROLLBAR_W - otherRailWidthPx;
  // Floor so the resolved pixel width can't round back up over the available
  // space and re-trip the too-narrow guard by a pixel.
  const pct = Math.floor((availPx / READER_NAV_W) * 100);
  return Math.max(NAV_WIDTH_MIN_PCT, Math.min(NAV_WIDTH_MAX_PCT, pct));
}
