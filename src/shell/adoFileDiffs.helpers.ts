// Per-file pull request diff data for the PR tab: ADO line-diff blocks
// projected to `DiffRange[]`, aggregate add/delete counts, and the
// `getFileDiffs` fetch with its `sessionStorage` cache. The Git client is
// injected (structurally typed) so this module stays loadable under Node
// without the `azure-devops-extension-{api,sdk}` AMD bundles.

import type { FileDiff, GitRestClient } from "azure-devops-extension-api/Git";

import type { DiffRange } from "../types";
import { trackUserFacingError } from "../telemetry";
import { withRetry } from "./retry";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Tiny non-cryptographic string hash (djb2 + xor) for the sessionStorage
 * per-file line-count cache key. Collisions only risk stale data; the
 * commit-SHA portion of the key is the real identity guard.
 */
export function hashString(s: string): string {
  let h = 5381;

  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }

  return (h >>> 0).toString(16);
}

/** JSON replacer that keeps complete base-file content out of browser storage. */
export function fileDiffCacheReplacer(key: string, value: unknown): unknown {
  return key === "originalSource" ? undefined : value;
}

/** Cached deletion diffs need base text rehydrated for precise block diffs. */
export function pathsRequiringOriginalSource(
  entries: Readonly<
    Record<string, { linesDeleted: number; originalSource?: string }>
  >,
): string[] {
  return Object.entries(entries)
    .filter(
      ([, info]) => info.linesDeleted > 0 && info.originalSource === undefined,
    )
    .map(([path]) => path);
}

// ---------------------------------------------------------------------------
// File diff: line-diff blocks → DiffRange[] (SDK-free)
// ---------------------------------------------------------------------------

/**
 * The subset of ADO's `LineDiffBlock` we read (structural to stay SDK-free).
 * Line numbers are 1-based; counts are 0 when the side doesn't participate.
 * `changeType`: 0=None, 1=Add, 2=Delete, 3=Edit.
 */
export interface LineDiffBlockLike {
  changeType?: number;
  originalLineNumberStart?: number;
  originalLinesCount?: number;
  modifiedLineNumberStart?: number;
  modifiedLinesCount?: number;
}

/**
 * Convert ADO `lineDiffBlocks` for one file into `DiffRange[]` in *modified*
 * (new-file) line numbers — matching the renderer's `data-source-line` attrs.
 * Adds/edits become span ranges; deletes become a `deleted-marker` at the
 * deletion point.
 *
 * ADO's `getFileDiffs` returns only line NUMBERS/COUNTS — never the removed
 * text (that lives on `FileDiffDetail`, which no SDK/REST method exposes). So
 * to show *what* was removed, callers fetch the original file at the base
 * commit and pass its lines as `originalLines`; this function then slices the
 * removed range (`originalLineNumberStart .. +originalLinesCount`) into each
 * deletion's `deletedContent`. When `originalLines` is omitted the markers
 * still render, just without an expandable body.
 */
export function lineDiffBlocksToRanges(
  blocks: readonly LineDiffBlockLike[] | undefined,
  originalLines?: readonly string[],
): DiffRange[] {
  const ranges: DiffRange[] = [];

  for (const b of blocks ?? []) {
    const range = lineDiffBlockToRange(b, originalLines);
    if (range) ranges.push(range);
  }

  return ranges;
}

/** Convert one ADO line-diff block to a `DiffRange`, or `undefined` if empty. */
function lineDiffBlockToRange(
  b: LineDiffBlockLike,
  originalLines: readonly string[] | undefined,
): DiffRange | undefined {
  const ct = b.changeType ?? 0;
  const modStart = b.modifiedLineNumberStart ?? 0;
  const modCount = b.modifiedLinesCount ?? 0;
  const origStart = b.originalLineNumberStart ?? 0;
  const origCount = b.originalLinesCount ?? 0;

  if (ct === 1 /* Add */) {
    return modCount > 0 ? addedLinesRange(modStart, modCount) : undefined;
  }

  if (ct === 3 /* Edit */) {
    return editBlockToRange(
      { modStart, modCount, origStart, origCount },
      originalLines,
    );
  }

  if (ct === 2 /* Delete */) {
    const at = Math.max(1, modStart);

    return buildDeletedMarkerRange(at, origCount, originalLines, origStart);
  }

  return undefined;
}

function addedLinesRange(modStart: number, modCount: number): DiffRange {
  return {
    startLine: modStart,
    endLine: modStart + modCount - 1,
    kind: "added",
    linesAdded: modCount,
    linesDeleted: 0,
  };
}

/** An ADO line-diff block's start/count fields with defaults applied. */
interface BlockSpans {
  modStart: number;
  modCount: number;
  origStart: number;
  origCount: number;
}

function editBlockToRange(
  { modStart, modCount, origStart, origCount }: BlockSpans,
  originalLines: readonly string[] | undefined,
): DiffRange {
  if (modCount > 0 && origCount === 0) {
    // An "edit" block that removed no original lines is really a pure
    // insertion — surface it as an addition (green) rather than an edit.
    return addedLinesRange(modStart, modCount);
  }

  if (modCount > 0) {
    const originalText = sliceOriginalLines(
      originalLines,
      origStart,
      origCount,
    );

    return {
      startLine: modStart,
      endLine: modStart + modCount - 1,
      kind: "modified",
      originalStartLine: origStart,
      originalEndLine: origStart + origCount - 1,
      linesAdded: modCount,
      linesDeleted: origCount,
      ...(originalText !== undefined ? { originalText } : {}),
    };
  }

  // Edit that left no modified lines behaves like a deletion.
  const at = Math.max(1, modStart);

  return buildDeletedMarkerRange(at, origCount, originalLines, origStart);
}

/**
 * Build a `deleted-marker` range, attaching `deletedContent` only when the
 * removed text could be recovered from `originalLines` (so the range shape
 * stays clean when the original file wasn't fetched).
 */
function buildDeletedMarkerRange(
  at: number,
  origCount: number,
  originalLines: readonly string[] | undefined,
  originalStart: number,
): DiffRange {
  const range: DiffRange = {
    startLine: at,
    endLine: at,
    kind: "deleted-marker",
    linesAdded: 0,
    linesDeleted: origCount,
  };

  const content = sliceOriginalLines(originalLines, originalStart, origCount);
  if (content !== undefined) range.deletedContent = content;

  return range;
}

/**
 * Slice the removed source lines out of the original file's line array.
 * `originalLineNumberStart` is 1-based. Returns `undefined` when the original
 * text isn't available or the range is empty so the marker stays body-less.
 */
function sliceOriginalLines(
  originalLines: readonly string[] | undefined,
  originalStart: number,
  originalCount: number,
): string | undefined {
  if (!originalLines || originalCount <= 0 || originalStart <= 0) {
    return undefined;
  }

  const from = originalStart - 1;
  const slice = originalLines.slice(from, from + originalCount);
  if (slice.length === 0) return undefined;

  return slice.join("\n");
}

/** Aggregate added/deleted line counts from `lineDiffBlocks` for one file. */
export function lineDiffBlocksToCounts(
  blocks: readonly LineDiffBlockLike[] | undefined,
): { linesAdded: number; linesDeleted: number } {
  let added = 0;
  let deleted = 0;

  for (const b of blocks ?? []) {
    switch (b.changeType ?? 0) {
      case 1: // Add
        added += b.modifiedLinesCount ?? 0;
        break;
      case 2: // Delete
        deleted += b.originalLinesCount ?? 0;
        break;
      case 3: // Edit
        added += b.modifiedLinesCount ?? 0;
        deleted += b.originalLinesCount ?? 0;
        break;
      default:
        break;
    }
  }

  return { linesAdded: added, linesDeleted: deleted };
}

// ---------------------------------------------------------------------------
// File diffs (per-file linesAdded / linesDeleted + inline DiffRange[])
// ---------------------------------------------------------------------------

/**
 * Fetches per-file diff data for the given file paths using ADO's
 * `getFileDiffs` endpoint. Returned record is keyed by file path and carries
 * both aggregate add/delete counts (for the file tree) and `DiffRange[]`
 * (for inline change bars / deletion markers in the rendered article).
 *
 * Missing entries imply "no diff data available" — caller should default
 * those to zero counts / empty ranges.
 *
 * Results are cached in `sessionStorage` keyed by
 * `(projectId, repositoryId, baseCommit, targetCommit, sorted paths hash)`
 * so reopening the same PR tab (or its iframe being re-instantiated mid-
 * navigation) doesn't re-hit `getFileDiffs`. The cache invalidates
 * automatically when the PR's iteration changes — `baseCommit` and
 * `targetCommit` are commit SHAs, so new iterations bump them.
 *
 * `getGitClient` is only called when a REST round-trip is actually needed.
 */
export async function loadFileDiffs(
  diff: FileDiffQuery,
  paths: string[],
  getGitClient: () => FileDiffClient,
): Promise<Record<string, FileDiffInfo>> {
  if (paths.length === 0) return {};
  const { repositoryId, project, baseCommit, targetCommit } = diff;
  const cacheKey = buildLineCountsCacheKey(diff, paths);
  const cached = readLineCountsCache(cacheKey);

  if (cached) {
    const pathsToHydrate = pathsRequiringOriginalSource(cached);
    if (pathsToHydrate.length === 0) return cached;
    const gitClient = getGitClient();
    await Promise.all(
      pathsToHydrate.map(async (path) => {
        const originalLines = await fetchOriginalLines(gitClient, diff, path);

        if (originalLines) {
          cached[path]!.originalSource = originalLines.join("\n");
        }
      }),
    );

    return cached;
  }

  const gitClient = getGitClient();

  // The REST client returns the parsed body as-is, which can be empty.
  const diffs = await withRetry<FileDiff[] | null | undefined>(
    () =>
      gitClient.getFileDiffs(
        {
          baseVersionCommit: baseCommit,
          targetVersionCommit: targetCommit,
          fileDiffParams: paths.map((p) => ({ originalPath: p, path: p })),
        },
        project,
        repositoryId,
      ),
    { mode: "read", label: "fetchFileDiffs.getFileDiffs" },
  );

  const out: Record<string, FileDiffInfo> = {};

  for (const d of diffs ?? []) {
    if (!d.path) continue;
    const blocks = d.lineDiffBlocks;
    const { linesAdded, linesDeleted } = lineDiffBlocksToCounts(blocks);
    // ADO's diff response carries no removed text, so for files that delete
    // lines we fetch the original at the base commit and slice the removed
    // range into each marker's expandable body. Fetched lazily (only files
    // with deletions) and tolerant of failure — the marker still renders.
    let originalLines: string[] | undefined;

    if (linesDeleted > 0) {
      originalLines = await fetchOriginalLines(gitClient, diff, d.path);
    }

    out[d.path] = {
      linesAdded,
      linesDeleted,
      originalSource: originalLines?.join("\n"),
      ranges: lineDiffBlocksToRanges(blocks, originalLines),
    };
  }

  writeLineCountsCache(cacheKey, out);

  return out;
}

/**
 * Fetch a file's text at the diff's base commit and split it into lines. Used
 * to recover the removed prose that ADO's `getFileDiffs` omits. Returns
 * `undefined` on any failure so diff decoration degrades gracefully.
 */
async function fetchOriginalLines(
  gitClient: FileDiffClient,
  { repositoryId, project, baseCommit }: FileDiffQuery,
  path: string,
): Promise<string[] | undefined> {
  try {
    const text = await withRetry(
      () =>
        gitClient.getItemText(
          repositoryId,
          path,
          project,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            version: baseCommit,
            versionType: 2 /* GitVersionType.Commit */,
            versionOptions: 0 /* GitVersionOptions.None */,
          },
          true,
        ),
      { mode: "read", label: "fetchFileDiffs.getItemText(original)" },
    );

    return text.split(/\r\n|\r|\n/);
  } catch (err) {
    console.warn(
      "[fetchFileDiffs] original content fetch failed; deletion bodies will be empty",
      err,
    );
    trackUserFacingError({
      error: err,
      source: "PrTabApp.diff",
      operation: "original-content-load",
      impact: "degraded",
    });

    return undefined;
  }
}

/** The `GitRestClient` surface {@link loadFileDiffs} calls. */
type FileDiffClient = Pick<GitRestClient, "getFileDiffs" | "getItemText">;

/** The repository and commit pair a {@link loadFileDiffs} batch compares. */
export interface FileDiffQuery {
  repositoryId: string;
  project: string;
  baseCommit: string;
  targetCommit: string;
}

/** Per-file diff summary: aggregate counts plus inline `DiffRange[]`. */
export interface FileDiffInfo {
  linesAdded: number;
  linesDeleted: number;
  /** Complete Markdown source at the diff base commit, when fetched. */
  originalSource?: string;
  ranges: DiffRange[];
}

// `sessionStorage` cache for `loadFileDiffs`. Same iteration = same
// commit SHAs = same cache key, so a re-load of the PR tab in the same
// session skips the (potentially slow) `getFileDiffs` round-trip.
const LINE_COUNTS_CACHE_PREFIX = "emr:fileDiffs:v6:";

function buildLineCountsCacheKey(
  { project, repositoryId, baseCommit, targetCommit }: FileDiffQuery,
  paths: string[],
): string {
  // Sort + join paths so order-independent across calls; commit SHAs
  // already include the iteration identity, so we don't need to encode
  // iteration id separately.
  const sortedPaths = [...paths].sort();
  const pathHash = hashString(sortedPaths.join("\n"));

  return (
    `${LINE_COUNTS_CACHE_PREFIX}${project}:${repositoryId}:` +
    `${baseCommit}:${targetCommit}:${pathHash}`
  );
}

function readLineCountsCache(key: string): Record<string, FileDiffInfo> | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(key);
    if (raw === null || raw === "") return null;
    const parsed = JSON.parse(raw) as Record<string, FileDiffInfo>;

    return parsed;
  } catch {
    return null;
  }
}

function writeLineCountsCache(
  key: string,
  value: Record<string, FileDiffInfo>,
): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(key, JSON.stringify(value, fileDiffCacheReplacer));
  } catch {
    // Quota exceeded / disabled storage — silent. The next call will
    // just refetch.
  }
}
