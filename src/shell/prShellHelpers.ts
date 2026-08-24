// Small pure helpers extracted from the PR shell + its child components so
// their branches can be unit-tested directly (the components themselves only
// render in the storybook/iframe harness). Keep these dependency-free.

import { extractStatus } from "./retryClassify";
import { diff_match_patch } from "diff-match-patch";

import { diffWords } from "../markdown/wordDiff";
import type { DiffRange } from "../types";
import type {
  DocumentImageResolver,
  RepositoryImageResolver,
} from "../markdown/documentImages";

export interface ReaderActivity {
  /** Stable operation identity used while delayed visibility is pending. */
  id: string;
  /** Concise status-bar message, including an ellipsis for ongoing work. */
  label: string;
  /** Larger values take precedence when operations overlap. */
  priority: number;
}

export function buildReaderActivities(input: {
  navigationActivities: readonly ReaderActivity[];
  commentSyncing: boolean;
  fileRefreshing: boolean;
  historicalLoading: boolean;
  documentLoading: boolean;
}): ReaderActivity[] {
  const activities = [...input.navigationActivities];
  if (input.commentSyncing) {
    activities.push({
      id: "comment-sync",
      label: input.fileRefreshing
        ? "Refreshing files and comments…"
        : "Syncing comments…",
      priority: input.fileRefreshing ? 60 : 20,
    });
  } else if (input.fileRefreshing) {
    activities.push({
      id: "file-refresh",
      label: "Refreshing files…",
      priority: 60,
    });
  }
  if (input.historicalLoading) {
    activities.push({
      id: "history",
      label: "Loading document version…",
      priority: 100,
    });
  } else if (input.documentLoading) {
    activities.push({
      id: "document",
      label: "Loading document…",
      priority: 100,
    });
  }
  return activities;
}

export function bindRepositoryImageResolver(
  resolveImage: DocumentImageResolver | undefined,
  documentPath: string,
  atCommitId: string | null | undefined,
): RepositoryImageResolver | undefined {
  if (!resolveImage) return undefined;
  return (repositoryPath) =>
    resolveImage(documentPath, repositoryPath, atCommitId ?? undefined);
}

/** Human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A calm, user-facing message for a failed comment write, replacing the raw
 * `TF400813: The user '<guid>'…` that used to reach the toast. Transient auth
 * blips (a 401, or ADO's `TF400813` — the SPS/token race that's most common on
 * the legacy `{org}.visualstudio.com` host) and dropped connections are framed
 * as "try again" (the composer keeps the user's draft either way), while a
 * server-provided business rule (e.g. a permission message) is passed through
 * so it stays actionable. Never surfaces a raw `TF` code or identity GUID.
 */
export function friendlyWriteError(label: string, err: unknown): string {
  const status = extractStatus(err);
  const raw = errorMessage(err);
  // Transient auth blip — token refresh race / SPS auth blip.
  if (status === 401 || /\bTF400813\b/.test(raw)) {
    return `${label} didn't go through — your session refreshed. Please try again.`;
  }
  // No HTTP status reached us — a dropped connection.
  if (status === undefined) {
    return `${label} didn't go through — check your connection and try again.`;
  }
  // A server-provided, human-readable reason (permission rules, etc.) — keep it,
  // but only when it isn't an opaque TF code.
  const clean = raw && !/\bTF\d{5,6}\b/.test(raw) ? raw.trim() : "";
  return clean
    ? `${label} failed: ${clean}`
    : `${label} didn't go through. Please try again.`;
}

/**
 * State updater that clears a nullable value to `null`, preserving the current
 * reference when it's already `null` so React can skip a redundant re-render.
 * Uses an explicit null check so falsy-but-valid values (e.g. `0`) still clear.
 */
export function clearIfSet<T>(curr: T | null): T | null {
  return curr != null ? null : curr;
}

/**
 * State-updater factory that clears the value to `null` only when it equals
 * `match`, otherwise leaves it untouched (avoids a redundant re-render).
 */
export function clearIfEquals<T>(match: T): (curr: T | null) => T | null {
  return (curr) => (curr === match ? null : curr);
}

/**
 * State-updater factory that applies `patch` to a non-null value, leaving an
 * already-`null` value untouched (avoids a redundant re-render). Uses an
 * explicit null check so falsy-but-valid values (e.g. `0`) still get patched.
 */
export function patchIfSet<T>(
  patch: (prev: T) => T,
): (prev: T | null) => T | null {
  return (prev) => (prev != null ? patch(prev) : prev);
}

/**
 * True when a click target sits inside comment UI chrome that should not be
 * treated as an outside-dismiss click. Besides the highlights / balloons /
 * bubbles themselves, this includes the rail header, status-bar comment
 * stepper, and collapsible section headers — navigating or toggling those must
 * not clear the active comment (the stepper SETS it, and clearing it here would
 * immediately undo that + defeat collapsed-tray auto-expand).
 */
export function isCommentUiClickTarget(target: Element | null): boolean {
  return !!target?.closest(
    ".emr-highlight, .emr-balloon, .emr-selection-bubble, .emr-draft-guard-overlay, .emr-rail-header, .emr-rail-section-header, .emr-statusbar-comment-stepper",
  );
}

/**
 * Approximate word count of a Markdown document, for the subtle title badge.
 * Strips code fences, inline code, HTML tags, images, and link URLs (keeping
 * link text) so the number reflects readable prose rather than syntax. A rough
 * indicator by design — not a precise typesetting metric.
 */
export function countWords(markdown: string): number {
  if (!markdown) return 0;
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → keep text
    .replace(/<[^>]+>/g, " ") // HTML tags
    .replace(/[#>*_~`|=]+/g, " "); // common md punctuation (keep hyphens)
  const matches = text.match(/\p{L}[\p{L}\p{N}'-]*/gu);
  return matches ? matches.length : 0;
}

/** Words the PR added vs. removed in a document (for the diff word-count badge). */
export interface WordCountDelta {
  /** Prose words present only in the current version. */
  added: number;
  /** Prose words present only in the pre-PR version. */
  removed: number;
}

/**
 * Count how many prose words a PR added vs. removed in a document, derived from
 * its changed line ranges + the current source. An `added` range contributes
 * all its words; a `modified` range is word-diffed against its pre-edit
 * `originalText`; a `deleted-marker` contributes its removed words. Uses
 * {@link countWords} throughout so the totals line up with the badge's count.
 */
export function wordCountDelta(
  source: string,
  diff: readonly DiffRange[],
): WordCountDelta {
  const lines = source.split(/\r?\n/);
  let added = 0;
  let removed = 0;
  for (const range of diff) {
    if (range.kind === "deleted-marker") {
      removed += countWords(range.deletedContent ?? "");
      continue;
    }
    const slice = lines.slice(range.startLine - 1, range.endLine).join("\n");
    if (range.kind === "added") {
      added += countWords(slice);
      continue;
    }
    // modified: word-diff the pre-edit text against the current slice so only
    // the genuinely changed words count on each side.
    for (const op of diffWords(range.originalText ?? "", slice)) {
      if (op.kind === "added") added += countWords(op.value);
      else if (op.kind === "removed") removed += countWords(op.value);
    }
  }
  return { added, removed };
}

/** One coloured segment of the word-count delta badge (`+N` / `−N`). */
export interface WordDeltaPart {
  kind: "added" | "removed";
  /** Rendered label, e.g. `+48` or `−12` (true minus sign). */
  label: string;
  /** Accessible description, e.g. `48 words added`. */
  a11y: string;
}

/**
 * Project a {@link WordCountDelta} into the badge's coloured parts, omitting a
 * side whose count is zero (so a pure addition shows only `+N`, never `−0`).
 */
export function formatWordDelta(delta: WordCountDelta): WordDeltaPart[] {
  const parts: WordDeltaPart[] = [];
  if (delta.added > 0) {
    parts.push({
      kind: "added",
      label: `+${delta.added.toLocaleString()}`,
      a11y: `${delta.added} words added`,
    });
  }
  if (delta.removed > 0) {
    parts.push({
      kind: "removed",
      label: `\u2212${delta.removed.toLocaleString()}`,
      a11y: `${delta.removed} words removed`,
    });
  }
  return parts;
}

/**
 * A completed pull request that touched a document, reduced to the plain
 * (SDK-free) fields the comment-history stepper needs. The hub maps live
 * `GitPullRequest` records to this shape so the view-model stays testable.
 */
export interface DocPrRef {
  prId: number;
  /**
   * Merge commit on the target branch — i.e. the document's state right after
   * this PR landed. `null` when the PR has no recorded merge commit (the stop
   * then falls back to the live head for content).
   */
  commitId: string | null;
  title: string;
  url?: string;
  /** Epoch milliseconds used for ordering and display. */
  dateMs?: number;
}

/** One position in a document's comment-history stepper. */
export interface HistoryStop {
  /** `null` => the live "Current" head (writable); a commit SHA otherwise. */
  commitId: string | null;
  /** PR backing this stop, if any (Current may have none yet). */
  prId: number | null;
  title?: string;
  url?: string;
  dateMs?: number;
  /** Position 0: the live, writable head. */
  isCurrent: boolean;
  /** Historical stops are read-only. */
  readOnly: boolean;
}

/**
 * Comparison endpoints over chronological PR updates; update 0 is the PR base.
 * The picker selection contains updates `fromUpdate + 1` through `toUpdate`.
 */
export interface ReviewIterationRange {
  fromUpdate: number;
  toUpdate: number;
}

export interface ResolvedReviewIterationRange {
  range: ReviewIterationRange;
  isAllChanges: boolean;
  /** Newer endpoint whose document content is rendered. */
  activeStopIndex: number;
  /** Older diff endpoint; null means the pull request merge base. */
  baselineStopIndex: number | null;
}

export function allReviewIterations(updateCount: number): ReviewIterationRange {
  return { fromUpdate: 0, toUpdate: Math.max(1, updateCount) };
}

export function oneReviewUpdate(
  update: number,
  updateCount: number,
): ReviewIterationRange {
  const toUpdate = Math.max(1, Math.min(update, Math.max(1, updateCount)));
  return { fromUpdate: toUpdate - 1, toUpdate };
}

export function betweenReviewUpdates(
  firstUpdate: number,
  secondUpdate: number,
  updateCount: number,
): ReviewIterationRange {
  const max = Math.max(1, updateCount);
  const first = Math.max(1, Math.min(firstUpdate, max));
  const second = Math.max(1, Math.min(secondUpdate, max));
  if (first === second) return oneReviewUpdate(first, max);
  return {
    fromUpdate: Math.min(first, second) - 1,
    toUpdate: Math.max(first, second),
  };
}

/** Normalize an interval and map it to PrShell's newest-first stop indexes. */
export function resolveReviewIterationRange(
  requested: ReviewIterationRange,
  updateCount: number,
): ResolvedReviewIterationRange {
  const max = Math.max(1, updateCount);
  const toUpdate = Math.max(1, Math.min(requested.toUpdate, max));
  const fromUpdate = Math.max(0, Math.min(requested.fromUpdate, toUpdate - 1));
  const range = { fromUpdate, toUpdate };
  return {
    range,
    isAllChanges: fromUpdate === 0 && toUpdate === max,
    activeStopIndex: max - toUpdate,
    baselineStopIndex: fromUpdate === 0 ? null : max - fromUpdate,
  };
}

/**
 * Builds the ordered stepper stops for a document: position 0 is the live
 * "Current" head (writable, backed by the routing PR if there is one), followed
 * by the document's completed PRs newest-first. The routing PR is omitted from
 * the historical tail since Current already represents it, and stops are
 * de-duped by `prId`.
 */
export function buildHistoryStops(
  currentPrId: number | null,
  history: readonly DocPrRef[],
): HistoryStop[] {
  const current: HistoryStop = {
    commitId: null,
    prId: currentPrId,
    isCurrent: true,
    readOnly: false,
  };
  const seen = new Set<number>();
  if (currentPrId != null) seen.add(currentPrId);
  const historical: HistoryStop[] = [];
  for (const ref of history) {
    if (seen.has(ref.prId)) continue;
    seen.add(ref.prId);
    historical.push({
      commitId: ref.commitId,
      prId: ref.prId,
      title: ref.title,
      url: ref.url,
      dateMs: ref.dateMs,
      isCurrent: false,
      readOnly: true,
    });
  }
  return [current, ...historical];
}

/** Build renderer-ready line ranges for an arbitrary source-to-source comparison. */
export function sourceDiffRanges(
  originalSource: string,
  modifiedSource: string,
): DiffRange[] {
  if (originalSource === modifiedSource) return [];

  const dmp = new diff_match_patch();
  const encoded = dmp.diff_linesToChars_(originalSource, modifiedSource);
  const diffs = dmp.diff_main(encoded.chars1, encoded.chars2, false);
  dmp.diff_cleanupSemantic(diffs);
  dmp.diff_charsToLines_(diffs, encoded.lineArray);

  const ranges: DiffRange[] = [];
  let originalLine = 1;
  let modifiedLine = 1;
  let index = 0;
  while (index < diffs.length) {
    const [operation, text] = diffs[index]!;
    if (operation === 0) {
      const count = sourceLineCount(text);
      originalLine += count;
      modifiedLine += count;
      index += 1;
      continue;
    }

    const originalStartLine = originalLine;
    const modifiedStartLine = modifiedLine;
    let deletedText = "";
    let deletedLines = 0;
    let addedLines = 0;
    while (index < diffs.length && diffs[index]![0] !== 0) {
      const [change, changeText] = diffs[index]!;
      const count = sourceLineCount(changeText);
      if (change < 0) {
        deletedText += changeText;
        deletedLines += count;
        originalLine += count;
      } else {
        addedLines += count;
        modifiedLine += count;
      }
      index += 1;
    }

    if (addedLines > 0 && deletedLines > 0) {
      ranges.push({
        startLine: modifiedStartLine,
        endLine: modifiedStartLine + addedLines - 1,
        kind: "modified",
        originalText: stripFinalLineBreak(deletedText),
        originalStartLine,
        originalEndLine: originalStartLine + deletedLines - 1,
        linesAdded: addedLines,
        linesDeleted: deletedLines,
      });
    } else if (addedLines > 0) {
      ranges.push({
        startLine: modifiedStartLine,
        endLine: modifiedStartLine + addedLines - 1,
        kind: "added",
        linesAdded: addedLines,
        linesDeleted: 0,
      });
    } else {
      ranges.push({
        startLine: Math.max(1, modifiedStartLine),
        endLine: Math.max(1, modifiedStartLine),
        kind: "deleted-marker",
        deletedContent: stripFinalLineBreak(deletedText),
        linesAdded: 0,
        linesDeleted: deletedLines,
      });
    }
  }
  return ranges;
}

function sourceLineCount(text: string): number {
  let lines = text.endsWith("\n") ? 0 : 1;
  for (const character of text) {
    if (character === "\n") lines += 1;
  }
  return lines;
}

function stripFinalLineBreak(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/**
 * Clamps a stepper navigation move to a valid index. `delta` is added to the
 * current index (negative = newer/toward Current, positive = older), bounded to
 * `[0, length - 1]`. An empty list clamps to 0.
 */
export function stepStopIndex(
  current: number,
  delta: number,
  length: number,
): number {
  const next = current + delta;
  if (next < 0) return 0;
  const last = length - 1;
  if (next > last) return last < 0 ? 0 : last;
  return next;
}

/**
 * Tooltip text for a comment-history stepper chevron. `target` is the stop the
 * chevron would jump to, or `undefined` when the chevron sits at an end of the
 * history and is disabled. Names the destination PR (or the live current head)
 * so hovering explains exactly where each direction leads — left walks older
 * (back through review history), right walks newer (toward the present).
 */
export function historyChevronTooltip(
  direction: "older" | "newer",
  target: HistoryStop | undefined,
): string {
  if (!target) {
    return direction === "older"
      ? "No earlier versions"
      : "Already at the current version";
  }
  const where = target.isCurrent
    ? target.prId != null
      ? `current version (PR #${target.prId})`
      : "current version"
    : `PR #${target.prId}${target.title ? `: ${target.title}` : ""}`;
  const verb = direction === "older" ? "Older" : "Newer";
  return `${verb} version — ${where}`;
}
