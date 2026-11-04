// Pure view-model derivations for Shell's chrome: the reader's CSS custom
// properties, the app/pane class names and visibility, and the rail/status-bar
// controls. Split from `derive.ts`; unit-tested directly like it.

import type * as React from "react";

import type { ReaderIterationOption } from "../components/ReaderStatusBar";
import {
  resolveReaderFont,
  readerSpacingValues,
  widthScale,
  type ReaderPrefs,
} from "../readerPrefs";
import type { RoutedPrInfo } from "./types";
/**
 * The reading font + size scale and spacing, which reach the article through
 * CSS custom properties set on the app root.
 */
export function readerStyleFor(readerPrefs: ReaderPrefs): {
  readerFont: ReturnType<typeof resolveReaderFont>;
  readerStyle: React.CSSProperties;
} {
  const readerFont = resolveReaderFont(readerPrefs.fontId);
  const readerSpacing = readerSpacingValues(readerPrefs);
  const readerStyle = {
    "--emr-reader-font": readerFont.stack,
    "--emr-reader-scale": String(readerPrefs.sizePct / 100),
    "--emr-reader-line-height": String(readerSpacing.lineHeight),
    "--emr-reader-letter-spacing": `${readerSpacing.letterSpacingEm}em`,
    "--emr-reader-word-spacing": `${readerSpacing.wordSpacingEm}em`,
    "--emr-reader-paragraph-spacing": `${readerSpacing.paragraphSpacingPx}px`,
    "--emr-nav-scale": String(widthScale(readerPrefs.navWidthPct)),
    "--emr-rail-scale": String(widthScale(readerPrefs.commentWidthPct)),
  } as React.CSSProperties;
  return { readerFont, readerStyle };
}

export function feedbackHrefFor(
  feedbackEmail: string | undefined,
): string | undefined {
  return feedbackEmail
    ? `mailto:${feedbackEmail}?subject=${encodeURIComponent(
        "Markdown Review — bug report / feedback",
      )}`
    : undefined;
}

export function appClassName(opts: {
  navHidden: boolean;
  commentsHidden: boolean;
  documentsMode: boolean | undefined;
  tooNarrow: boolean;
}): string {
  return `emr-app${opts.navHidden ? " is-nav-hidden" : ""}${
    opts.commentsHidden ? " is-comments-hidden" : ""
  }${opts.documentsMode ? " is-documents-mode" : ""}${
    opts.tooNarrow ? " is-too-narrow" : ""
  }`;
}

/**
 * Comment-rail chrome while comparing PR updates: the read-only banner and
 * the routed-PR pill are dropped for earlier updates of THIS PR.
 */
export function railChrome(opts: {
  nativeIterationMode: boolean;
  viewingHistorical: boolean;
  hidePrPill: boolean;
  documentsMode: boolean | undefined;
}): { showReadOnlyBanner: boolean; hidePrPill: boolean } {
  const comparingEarlierUpdate =
    opts.nativeIterationMode && opts.viewingHistorical;
  return {
    showReadOnlyBanner: !comparingEarlierUpdate,
    hidePrPill:
      opts.hidePrPill || !!opts.documentsMode || comparingEarlierUpdate,
  };
}

/**
 * Effective panel visibility. Nav can't be toggled in single-file mode
 * (`hideDocNav` — there's no file tree) so it stays hidden there; comments
 * follow the reader's focus preference.
 */
export function paneLayout(
  hideDocNav: boolean | undefined,
  readerPrefs: ReaderPrefs,
  commentsAvailable: boolean,
): {
  navToggleable: boolean;
  navHidden: boolean;
  commentsHidden: boolean;
  bodyFrameClassName: string;
  railResizable: boolean;
  navReopenShown: boolean;
  commentsReopenShown: boolean;
} {
  const navToggleable = !hideDocNav;
  const navHidden = !!hideDocNav || !readerPrefs.showNav;
  const commentsHidden = !commentsAvailable || !readerPrefs.showComments;
  // The rail resize handle and the edge grabbers belong to the full reader
  // only (single-file panels keep fixed panes).
  const railResizable = navToggleable && commentsAvailable;
  return {
    navToggleable,
    navHidden,
    commentsHidden,
    bodyFrameClassName: `emr-body-frame${hideDocNav ? " emr-body-frame--no-nav" : ""}`,
    railResizable,
    navReopenShown: navToggleable && navHidden,
    commentsReopenShown: railResizable && commentsHidden,
  };
}

/** The reading status bar's mode-dependent controls. */
export function statusBarExtras(opts: {
  documentsMode: boolean | undefined;
  activeRoutedPr: RoutedPrInfo | undefined;
  nativeIterationMode: boolean;
  iterationOptions: ReaderIterationOption[];
  reviewIterationBaseCommit: string | undefined;
  canRefreshComments: boolean;
  handleRefresh: () => void;
  commentsRefreshing: boolean;
  fileRefreshInFlight: boolean;
}): {
  resolvedPullRequest: RoutedPrInfo | undefined;
  iterationOptions: ReaderIterationOption[] | undefined;
  iterationBaseCommit: string | undefined;
  onRefresh: (() => void) | undefined;
  refreshing: boolean;
} {
  const { activeRoutedPr, nativeIterationMode } = opts;
  return {
    resolvedPullRequest:
      opts.documentsMode && activeRoutedPr?.status === "completed"
        ? activeRoutedPr
        : undefined,
    iterationOptions:
      nativeIterationMode && opts.iterationOptions.length > 1
        ? opts.iterationOptions
        : undefined,
    iterationBaseCommit: nativeIterationMode
      ? opts.reviewIterationBaseCommit
      : undefined,
    onRefresh: opts.canRefreshComments ? opts.handleRefresh : undefined,
    refreshing: opts.commentsRefreshing || opts.fileRefreshInFlight,
  };
}
