// Pure view-model derivations for PrShell. Each takes the shell's raw state and
// returns the values the render (and child hooks) consume, so their branches
// are unit-tested directly instead of only through the rendered shell.

import type * as React from "react";

import type {
  ChangeType,
  DiffRange,
  FileInfo,
  TextQuoteAnchor,
} from "../../types";
import type { HistoryNav } from "../components/RailToolbar";
import { NEW_DRAFT_THREAD_ID, type DraftTarget } from "../draftStorage";
import {
  absentAtUpdateMessage,
  historyChevronTooltip,
  resolveReviewIterationRange,
  reviewRangeLabel,
  stepStopIndex,
  type HistoryStop,
  type ResolvedReviewIterationRange,
  type ReviewIterationRange,
} from "../prShellHelpers";
import {
  resolveReaderFont,
  readerSpacingValues,
  widthScale,
  type ReaderPrefs,
} from "../readerPrefs";
import type { RoutedPrInfo } from "./types";
import type { ReaderIterationOption } from "../components/ReaderStatusBar";

export function pickInitialPath(
  initialSelectedPath: string | undefined,
  files: readonly FileInfo[],
): string {
  /* v8 ignore next -- files[0]?.path/"" fallbacks are defensive; tests supply initialSelectedPath or a non-empty file list */
  return initialSelectedPath ?? files[0]?.path ?? "";
}

/**
 * In per-document mode a document with no routed PR has nowhere to persist
 * comments, so present it as read-only rather than misleading the user into
 * writing comments that would be dropped.
 */
export function documentReadOnly(
  readOnly: boolean | undefined,
  readOnlyMessage: string | undefined,
  perDocNoWriteTarget: boolean,
): {
  effectiveReadOnly: boolean;
  effectiveReadOnlyMessage: string | undefined;
} {
  return {
    effectiveReadOnly: !!readOnly || perDocNoWriteTarget,
    effectiveReadOnlyMessage:
      readOnly || !perDocNoWriteTarget
        ? readOnlyMessage
        : "Comments are read-only here — this document isn't part of a completed pull request yet.",
  };
}

export function draftTargetsOnScreen(
  activeDraft: DraftTarget | null,
  selectedPath: string,
): {
  draftAnchor: TextQuoteAnchor | null;
  activeReplyThreadId: string | null;
} {
  const onScreen = activeDraft !== null && activeDraft.path === selectedPath;
  return {
    // The new-comment draft's anchor, shown only when its draft targets the
    // file currently on screen (a reply draft, or a draft on another file,
    // shows none).
    draftAnchor:
      onScreen && activeDraft.threadId === NEW_DRAFT_THREAD_ID
        ? activeDraft.anchor
        : null,
    // The open reply composer's thread, shown only on its own file.
    activeReplyThreadId:
      onScreen && activeDraft.threadId !== NEW_DRAFT_THREAD_ID
        ? activeDraft.threadId
        : null,
  };
}

/** Whether `target` re-opens exactly the composer `current` already is. */
export function isSameDraftTarget(
  current: DraftTarget | null,
  target: DraftTarget,
): boolean {
  return (
    current !== null &&
    current.path === target.path &&
    current.threadId === target.threadId &&
    (target.threadId !== NEW_DRAFT_THREAD_ID ||
      JSON.stringify(current.anchor) === JSON.stringify(target.anchor))
  );
}

/**
 * Which review-history stepper the host enabled: the Documents hub's
 * completed-PR history (all three loaders) or the PR tab's native updates.
 */
export function historyModes(opts: {
  loadDocHistory: unknown;
  loadThreadsForPr: unknown;
  loadFileSourceAt: unknown;
  reviewIterationStops: readonly HistoryStop[] | undefined;
  reviewIterationBaseCommit: string | undefined;
}): {
  completedPrHistoryEnabled: boolean;
  nativeIterationMode: boolean;
  nativeUpdateCount: number;
} {
  return {
    completedPrHistoryEnabled: !!(
      opts.loadDocHistory &&
      opts.loadThreadsForPr &&
      opts.loadFileSourceAt
    ),
    nativeIterationMode: !!(
      opts.reviewIterationStops?.length &&
      opts.reviewIterationBaseCommit &&
      opts.loadFileSourceAt
    ),
    nativeUpdateCount: Math.max(1, opts.reviewIterationStops?.length ?? 1),
  };
}

interface HistoryView {
  historyStops: readonly HistoryStop[];
  resolvedIterationRange: ResolvedReviewIterationRange;
  clampedStopIndex: number;
  comparingIterations: boolean;
  activeStop: HistoryStop;
  baselineStop: HistoryStop | undefined;
  viewingHistorical: boolean;
  /** The compared updates as a value key (`null` outside native mode). */
  reportedRangeKey: string | null;
  /** Key of a partial comparison whose touched files are loaded. */
  rangeChangesKey: string | null;
}

/** Resolves the active and baseline stops of the review-history stepper. */
export function resolveHistoryView(opts: {
  nativeIterationMode: boolean;
  reviewIterationStops: readonly HistoryStop[] | undefined;
  completedPrHistoryStops: readonly HistoryStop[];
  iterationRange: ReviewIterationRange;
  completedHistoryStopIndex: number;
}): HistoryView {
  const native = opts.nativeIterationMode;
  const historyStops = native
    ? opts.reviewIterationStops!
    : opts.completedPrHistoryStops;
  const resolvedIterationRange = resolveReviewIterationRange(
    opts.iterationRange,
    historyStops.length,
  );
  const clampedStopIndex = native
    ? resolvedIterationRange.activeStopIndex
    : Math.min(opts.completedHistoryStopIndex, historyStops.length - 1);
  const comparingIterations = native && !resolvedIterationRange.isAllChanges;
  const baselineStopIndex = native
    ? resolvedIterationRange.baselineStopIndex
    : clampedStopIndex;
  const activeStop = historyStops[clampedStopIndex]!;
  const { fromUpdate, toUpdate } = resolvedIterationRange.range;
  const reportedRangeKey = native
    ? resolvedIterationRange.isAllChanges
      ? "all"
      : `${fromUpdate}-${toUpdate}`
    : null;
  return {
    historyStops,
    resolvedIterationRange,
    clampedStopIndex,
    comparingIterations,
    activeStop,
    baselineStop:
      baselineStopIndex == null ? undefined : historyStops[baselineStopIndex],
    viewingHistorical: !activeStop.isCurrent,
    reportedRangeKey,
    rangeChangesKey: comparingIterations ? reportedRangeKey : null,
  };
}

/** The file list's "changed in the compared updates" marks, once loaded. */
export function docNavRangeChangesFor(
  rangeChangesKey: string | null,
  rangeChangesByKey: Record<string, Readonly<Record<string, ChangeType>>>,
  range: ReviewIterationRange,
  updateCount: number,
): { label: string; byPath: Readonly<Record<string, ChangeType>> } | undefined {
  if (rangeChangesKey === null || !rangeChangesByKey[rangeChangesKey]) {
    return undefined;
  }
  return {
    label: reviewRangeLabel(range, updateCount),
    byPath: rangeChangesByKey[rangeChangesKey],
  };
}

/**
 * Cache keys (`path\u0000commit`) of the historical endpoints the current
 * selection needs: the active stop's snapshot and, when comparing PR updates,
 * the baseline's.
 */
export function historicalContentKeys(opts: {
  selectedPath: string;
  viewingHistorical: boolean;
  activeStop: HistoryStop;
  baselineStop: HistoryStop | undefined;
  reviewIterationBaseCommit: string | undefined;
  comparingIterations: boolean;
}): {
  historicalContentKey: string | null;
  baselineCommitId: string | null | undefined;
  baselineContentKey: string | null;
} {
  const { selectedPath, activeStop } = opts;
  const baselineCommitId =
    opts.baselineStop?.commitId ?? opts.reviewIterationBaseCommit;
  return {
    historicalContentKey:
      opts.viewingHistorical && activeStop.commitId
        ? `${selectedPath}\u0000${activeStop.commitId}`
        : null,
    baselineCommitId,
    baselineContentKey: opts.comparingIterations
      ? `${selectedPath}\u0000${baselineCommitId!}`
      : null,
  };
}

interface HistoricalStatus {
  historicalHtml: string | undefined;
  usingHistoricalContent: boolean;
  historicalLoadError: string | undefined;
  absentNotice: { title: string; body: string } | null;
  baselineAbsent: boolean;
  historicalLoading: boolean;
}

/** Load state of the historical endpoints the current selection renders. */
export function historicalStatus(opts: {
  viewingHistorical: boolean;
  comparingIterations: boolean;
  historicalContentKey: string | null;
  baselineContentKey: string | null;
  historicalLoadTargets: readonly { key: string }[];
  currentFileChangeType: ChangeType | undefined;
  toUpdate: number;
  historicalHtmlByKey: Record<string, string>;
  historicalSourceByKey: Record<string, string>;
  historicalErrorByKey: Record<string, string>;
  historicalAbsentByKey: Record<string, true>;
}): HistoricalStatus {
  const { historicalContentKey, baselineContentKey } = opts;
  const historicalHtml = historicalContentKey
    ? opts.historicalHtmlByKey[historicalContentKey]
    : undefined;
  // A historical stop with no recorded merge commit can't load a snapshot
  // (`historicalContentKey` is null), so fall back to the live head content
  // instead of rendering a blank, perpetually-"loading" article.
  const usingHistoricalContent =
    opts.viewingHistorical && !!historicalContentKey;
  const historicalLoadError = opts.historicalLoadTargets.reduce<
    string | undefined
  >(
    (found, target) => found ?? opts.historicalErrorByKey[target.key],
    undefined,
  );
  // Comparing PR updates, the file may not exist at an endpoint. Absent at the
  // NEWER end: nothing to show (the PR adds it later / deleted it) — a notice
  // with a way back to "All updates". Absent at the OLDER end only: the file is
  // new within the selection, so it renders as wholly added (like "All
  // updates" shows a file the PR adds) rather than as a load error. A file the
  // PR deletes is absent at the latest update too, even though the live view
  // (which "All updates" uses) shows its pre-deletion content.
  const activeAbsent =
    (historicalContentKey != null &&
      !!opts.historicalAbsentByKey[historicalContentKey]) ||
    (opts.comparingIterations &&
      historicalContentKey == null &&
      opts.currentFileChangeType === "deleted");
  const baselineAbsent =
    baselineContentKey != null &&
    !!opts.historicalAbsentByKey[baselineContentKey];
  const historicalLoading =
    historicalLoadError === undefined &&
    !activeAbsent &&
    ((usingHistoricalContent && historicalHtml === undefined) ||
      (baselineContentKey != null &&
        !baselineAbsent &&
        opts.historicalSourceByKey[baselineContentKey] === undefined));
  return {
    historicalHtml,
    usingHistoricalContent,
    historicalLoadError,
    absentNotice: activeAbsent
      ? absentAtUpdateMessage(opts.currentFileChangeType, opts.toUpdate)
      : null,
    baselineAbsent,
    historicalLoading,
  };
}

/** The article actually shown: a historical snapshot or the live document. */
export function activeArticleState(opts: {
  status: HistoricalStatus;
  pristineHtml: string;
  viewingHistorical: boolean;
  historicalContentKey: string | null;
  selectedPath: string;
}): {
  activePristineHtml: string;
  activeStorageKey: string;
  articleReady: boolean;
} {
  const { status, historicalContentKey } = opts;
  const activePristineHtml = status.usingHistoricalContent
    ? (status.historicalHtml ?? "")
    : opts.pristineHtml;
  return {
    activePristineHtml,
    activeStorageKey:
      opts.viewingHistorical && historicalContentKey
        ? historicalContentKey
        : opts.selectedPath,
    // "Rendered" means the article actually shown — when a link opens an
    // earlier PR update, that is the earlier version, which loads after the
    // latest one.
    articleReady:
      !!activePristineHtml && !status.historicalLoading && !status.absentNotice,
  };
}

/** The Markdown sources behind the rendered article and its diff baseline. */
export function activeSources(opts: {
  usingHistoricalContent: boolean;
  comparingIterations: boolean;
  baselineAbsent: boolean;
  historicalContentKey: string | null;
  baselineContentKey: string | null;
  historicalSourceByKey: Record<string, string>;
  latestSource: string | undefined;
}): { activeSource: string | undefined; baselineSource: string | undefined } {
  const { historicalSourceByKey } = opts;
  const activeSource = opts.usingHistoricalContent
    ? historicalSourceByKey[opts.historicalContentKey!]
    : opts.latestSource;
  if (!opts.comparingIterations)
    return { activeSource, baselineSource: undefined };
  return {
    activeSource,
    baselineSource: opts.baselineAbsent
      ? ""
      : historicalSourceByKey[opts.baselineContentKey!],
  };
}

/**
 * Inputs of the diff layer: the update comparison's own diff while comparing
 * PR updates, otherwise ADO's PR-wide diff against the base commit.
 */
export function diffInputs(opts: {
  comparingIterations: boolean;
  baselineSource: string | undefined;
  activeSource: string | undefined;
  latestSource: string | undefined;
  currentOriginalSource: string | undefined;
  iterationDiff: DiffRange[] | undefined;
  currentFileDiff: DiffRange[] | undefined;
}): {
  activeOriginalSource: string | undefined;
  activeDiffTarget: string | undefined;
  rawActiveDiff: DiffRange[] | undefined;
} {
  if (opts.comparingIterations) {
    return {
      activeOriginalSource: opts.baselineSource,
      activeDiffTarget: opts.activeSource,
      rawActiveDiff: opts.iterationDiff,
    };
  }
  return {
    activeOriginalSource: opts.currentOriginalSource,
    activeDiffTarget: opts.latestSource,
    rawActiveDiff: opts.currentFileDiff,
  };
}

export function isDiffAvailable(opts: {
  comparingIterations: boolean;
  baselineAbsent: boolean;
  iterationDiff: DiffRange[] | undefined;
  viewingHistorical: boolean;
  isWholeFileChange: boolean;
  currentFileDiff: DiffRange[] | undefined;
}): boolean {
  if (opts.comparingIterations) {
    return (
      !opts.baselineAbsent &&
      !!opts.iterationDiff &&
      opts.iterationDiff.length > 0
    );
  }
  return (
    !opts.viewingHistorical &&
    !opts.isWholeFileChange &&
    !!opts.currentFileDiff &&
    opts.currentFileDiff.length > 0
  );
}

/**
 * Who may comment on the active document view, and which routed-PR pill the
 * rail shows for it.
 */
export function commentAccess(opts: {
  viewingHistorical: boolean;
  nativeIterationMode: boolean;
  activeStop: HistoryStop;
  effectiveRoutedPr: RoutedPrInfo | undefined;
  routedPrResolution: RoutedPrInfo | null | undefined;
  documentsMode: boolean | undefined;
  currentFileChangeType: ChangeType | undefined;
  effectiveReadOnly: boolean;
  effectiveReadOnlyMessage: string | undefined;
}): {
  viewingPastPr: boolean;
  activeRoutedPr: RoutedPrInfo | undefined;
  commentsAvailable: boolean;
  activeReadOnly: boolean;
  activeReadOnlyMessage: string | undefined;
} {
  // Comparing earlier updates of THIS PR stays writable: threads belong to
  // the PR, so replies/resolve/likes work anywhere, and a new comment is
  // checked against the latest version before its composer opens (see
  // `commentBlocker`). Only the Documents hub's history stops — earlier,
  // completed PRs — are read-only.
  const viewingPastPr = opts.viewingHistorical && !opts.nativeIterationMode;
  const activeRoutedPr = activeRoutedPrFor(
    viewingPastPr,
    opts.activeStop,
    opts.effectiveRoutedPr,
  );
  const commentsAvailable = commentsAvailableFor(
    opts.documentsMode,
    opts.routedPrResolution,
    activeRoutedPr,
  );
  return {
    viewingPastPr,
    activeRoutedPr,
    commentsAvailable,
    ...activeReadOnlyState({
      effectiveReadOnly: opts.effectiveReadOnly,
      effectiveReadOnlyMessage: opts.effectiveReadOnlyMessage,
      viewingPastPr,
      viewingDeletedFile: opts.currentFileChangeType === "deleted",
      commentsAvailable,
      activeStopPrId: opts.activeStop.prId,
    }),
  };
}

/**
 * The routed-PR pill for the active stop: a past PR's own (completed) PR
 * while the stepper is parked on it, otherwise the document's routing PR.
 */
function activeRoutedPrFor(
  viewingPastPr: boolean,
  activeStop: HistoryStop,
  effectiveRoutedPr: RoutedPrInfo | undefined,
): RoutedPrInfo | undefined {
  if (!viewingPastPr) return effectiveRoutedPr;
  return {
    /* v8 ignore start -- a historical stop always carries prId/title; the fallbacks are defensive */
    prId: activeStop.prId ?? 0,
    title: activeStop.title ?? `PR #${activeStop.prId}`,
    /* v8 ignore stop */
    status: "completed",
    url: activeStop.url,
  };
}

function commentsAvailableFor(
  documentsMode: boolean | undefined,
  routedPrResolution: RoutedPrInfo | null | undefined,
  activeRoutedPr: RoutedPrInfo | undefined,
): boolean {
  return (
    !documentsMode ||
    routedPrResolution === undefined ||
    activeRoutedPr?.status === "completed"
  );
}

/** Read-only state + banner text for the active document view. */
function activeReadOnlyState(opts: {
  effectiveReadOnly: boolean;
  effectiveReadOnlyMessage: string | undefined;
  viewingPastPr: boolean;
  viewingDeletedFile: boolean;
  commentsAvailable: boolean;
  activeStopPrId: number | null;
}): { activeReadOnly: boolean; activeReadOnlyMessage: string | undefined } {
  const activeReadOnly =
    opts.effectiveReadOnly ||
    opts.viewingPastPr ||
    opts.viewingDeletedFile ||
    !opts.commentsAvailable;
  if (opts.viewingPastPr) {
    return {
      activeReadOnly,
      activeReadOnlyMessage: `Viewing this document as it was at pull request #${opts.activeStopPrId}. Comments here are read-only — open the pull request to reply.`,
    };
  }
  if (opts.viewingDeletedFile) {
    return {
      activeReadOnly,
      activeReadOnlyMessage:
        "This document was deleted in this pull request. Its previous version is read-only.",
    };
  }
  if (!opts.commentsAvailable) {
    return {
      activeReadOnly,
      activeReadOnlyMessage:
        "Comments are unavailable until this document is part of a completed pull request.",
    };
  }
  return {
    activeReadOnly,
    activeReadOnlyMessage: opts.effectiveReadOnlyMessage,
  };
}

/**
 * The comment rail's ‹ › history chevrons, shown when the Documents hub
 * stepper has more than the live head to step through. `onStep` receives the
 * stop index to move to.
 */
export function buildHistoryNav(
  completedPrHistoryEnabled: boolean,
  historyStops: readonly HistoryStop[],
  clampedStopIndex: number,
  onStep: (stopIndex: number) => void,
): HistoryNav | undefined {
  if (!completedPrHistoryEnabled || historyStops.length <= 1) return undefined;
  return {
    canNewer: clampedStopIndex > 0,
    canOlder: clampedStopIndex < historyStops.length - 1,
    olderLabel: historyChevronTooltip(
      "older",
      historyStops[clampedStopIndex + 1],
    ),
    newerLabel: historyChevronTooltip(
      "newer",
      historyStops[clampedStopIndex - 1],
    ),
    onNewer: () =>
      onStep(stepStopIndex(clampedStopIndex, -1, historyStops.length)),
    onOlder: () =>
      onStep(stepStopIndex(clampedStopIndex, 1, historyStops.length)),
  };
}

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
