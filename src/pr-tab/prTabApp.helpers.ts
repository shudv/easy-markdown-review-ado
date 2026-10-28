// Pure helpers extracted from `PrTabApp.tsx` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles (which Node
// can't evaluate). The container keeps only the SDK/React glue and imports
// these for its decision logic.

import type { ChangeType } from "../types";
import {
  resolveReviewIterationRange,
  type HistoryStop,
  type ReviewIterationRange,
} from "../shell/prShellHelpers";
import {
  PATH_LINK_PARAM,
  readAnchorParam,
  readTextParam,
  readCommentParam,
  readPathParam,
} from "../shell/deepLink";
import { samePath } from "../markdown/docLinks";

interface PullRequestIterationLike {
  id?: number;
  description?: string;
  createdDate?: Date | string;
  sourceRefCommit?: CommitRefLike;
  commits?: ReadonlyArray<CommitRefLike & { comment?: string }>;
}

/** Map ADO's chronological PR pushes into PrShell's newest-first stop model. */
export function reviewIterationStops(
  iterations: readonly PullRequestIterationLike[],
  prId: number,
): HistoryStop[] {
  const valid = iterations.filter(
    (iteration) =>
      typeof iteration.id === "number" && !!iteration.sourceRefCommit?.commitId,
  );
  return valid
    .map((iteration, chronologicalIndex) => {
      const isCurrent = chronologicalIndex === valid.length - 1;
      const lastCommit = iteration.commits?.[iteration.commits.length - 1];
      const title =
        iteration.description?.trim() ||
        lastCommit?.comment?.trim() ||
        `Iteration ${iteration.id}`;
      const rawDate = iteration.createdDate;
      const dateMs =
        rawDate === undefined ? undefined : new Date(rawDate).getTime();
      return {
        commitId: isCurrent ? null : iteration.sourceRefCommit!.commitId!,
        prId,
        iterationId: iteration.id!,
        title,
        ...(dateMs !== undefined && Number.isFinite(dateMs) ? { dateMs } : {}),
        isCurrent,
        readOnly: !isCurrent,
      } satisfies HistoryStop;
    })
    .reverse();
}

/** A pull-request id from config: a number, or a numeric string. */
function toPullRequestId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number.parseInt(v, 10);
  return null;
}

/**
 * Resolve the active pull-request id from the pr-tab contribution config.
 *
 * ADO has shipped several shapes for this config over the years, so we probe
 * the known ones in order and, as a last resort, parse the id out of the
 * parent-frame URL (which the host writes into the iframe's `referrer` for
 * top-level navigations). `referrer` is passed in so the function stays pure
 * and testable; callers supply `document.referrer`.
 */
export function pickPullRequestId(
  config: Record<string, unknown> | undefined,
  referrer: string,
): number | null {
  if (config) {
    const candidates: unknown[] = [
      config["pullRequestId"],
      (config["pullRequest"] as { pullRequestId?: unknown } | undefined)
        ?.pullRequestId,
      (config["pullRequest"] as { id?: unknown } | undefined)?.id,
      (config["context"] as { pullRequestId?: unknown } | undefined)
        ?.pullRequestId,
      (config["repoContext"] as { pullRequestId?: unknown } | undefined)
        ?.pullRequestId,
    ];
    for (const c of candidates) {
      const n = toPullRequestId(c);
      if (n !== null) return n;
    }
  }
  const m = /\/pullrequest\/(\d+)\b/i.exec(referrer);
  if (m) return Number.parseInt(m[1]!, 10);
  return null;
}

/**
 * The repository id the host hands the PR tab in its configuration
 * (`pullRequest.repository.id`) — but only when that object describes THIS
 * pull request. Knowing it up front lets boot fetch the PR's updates in
 * parallel with the PR itself instead of waiting for it.
 */
export function configuredRepositoryId(
  config: Record<string, unknown> | undefined,
  pullRequestId: number,
): string | null {
  const pr = config?.["pullRequest"] as
    | { pullRequestId?: unknown; repository?: { id?: unknown } }
    | undefined;
  if (toPullRequestId(pr?.pullRequestId) !== pullRequestId) return null;
  const id = pr!.repository?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Load a PR's changes while the PR itself is still loading, from the
 * repository the host hinted. The hint is only an optimisation: if its load
 * fails or the PR turns out to live elsewhere, the changes load again from the
 * PR's own repository.
 */
export async function loadWithRepositoryHint<
  P extends { repository: { id: string } },
  C,
>(
  prRequest: Promise<P>,
  hint: string | null,
  load: (repositoryId: string) => Promise<C>,
): Promise<{ pr: P; changes: C }> {
  const hinted = hint ? load(hint).catch(() => null) : null;
  const pr = await prRequest;
  const changes =
    (pr.repository.id === hint ? await hinted : null) ??
    (await load(pr.repository.id));
  return { pr, changes };
}

/** A `commitId`-bearing ref, as carried by PR / iteration commit fields. */
interface CommitRefLike {
  commitId?: string;
}

/** The commit pair to diff for inline change highlights. */
export interface DiffCommitPair {
  baseCommit?: string;
  targetCommit?: string;
}

/**
 * Choose the commits to diff for inline change highlights.
 *
 * Uses the PR iteration's merge base (`commonRefCommit`) as the base and its
 * source tip (`sourceRefCommit`) as the target — a THREE-DOT diff (`base...src`)
 * that shows only what the PR itself changed, exactly like ADO's Files tab.
 *
 * The previous behaviour diffed against `pr.lastMergeTargetCommit` — the target
 * branch's CURRENT tip — a TWO-DOT diff. Once the target branch (e.g. master)
 * advances past the fork point, that corrupts highlights for any file also
 * touched on the target: a file whose content converged with the PR shows NO
 * diff at all, and a file edited elsewhere on the target grows phantom hunks.
 * The merge base is fixed at the fork point, so the three-dot diff is immune to
 * the target moving. Verified against ADO's `getFileDiffs` on a stale-master
 * PR: `(commonRefCommit, sourceRefCommit)` reproduces the Files-tab diff where
 * `(lastMergeTargetCommit, lastMergeSourceCommit)` blanks/duplicates it.
 *
 * Falls back to the PR's `lastMerge*` commits if an iteration omits them.
 */
export function selectDiffCommits(
  iteration:
    | { commonRefCommit?: CommitRefLike; sourceRefCommit?: CommitRefLike }
    | undefined,
  pr: {
    lastMergeTargetCommit?: CommitRefLike;
    lastMergeSourceCommit?: CommitRefLike;
  },
): DiffCommitPair {
  return {
    baseCommit:
      iteration?.commonRefCommit?.commitId ??
      pr.lastMergeTargetCommit?.commitId,
    targetCommit:
      iteration?.sourceRefCommit?.commitId ??
      pr.lastMergeSourceCommit?.commitId,
  };
}

/**
 * Map ADO's `VersionControlChangeType` flags enum to our `ChangeType` union.
 * It's a bit-flags enum (1=Add, 8=Rename, 16=Delete); delete wins over rename
 * wins over add, and anything else is a plain content modification.
 */
export function mapChangeType(t: unknown): ChangeType {
  const n = typeof t === "number" ? t : 0;
  if (n & 16) return "deleted";
  if (n & 8) return "renamed";
  if (n & 1) return "added";
  return "modified";
}

/**
 * The subset of changed files that a single batched `getFileDiffs` can handle:
 * only MODIFIED files exist at BOTH the base and target commits under the same
 * path. Added files don't exist at the base, deleted files don't exist at the
 * target, and renamed files live under a different path — and ADO's
 * `getFileDiffs` fails the ENTIRE request (`VS403420 ItemNotFoundException`) if
 * ANY param path is missing at the requested version. So a single added file
 * would blank the diffs for EVERY file in the PR. Added/deleted files already
 * suppress their inline diff in the reader (`isWholeFileChange`), so excluding
 * them here costs nothing.
 */
/**
 * The repo path of a PR change entry when it's a Markdown file, else
 * `undefined`. ADO reports a DELETED file with an empty `item.path` and the
 * path in `originalPath` (verified against real PR iteration changes), so
 * reading `item.path` alone silently drops every deleted document from the PR
 * tab.
 */
export function markdownChangePath(entry: {
  item?: { path?: string };
  originalPath?: string;
}): string | undefined {
  const path = entry.item?.path || entry.originalPath;
  return path?.toLowerCase().endsWith(".md") ? path : undefined;
}

export function diffableFilePaths(
  files: readonly { path: string; changeType: ChangeType }[],
): string[] {
  return files.filter((f) => f.changeType === "modified").map((f) => f.path);
}

/**
 * Choose the commit that still contains a changed file. Deleted files only
 * exist at the merge base; every other change type is rendered from the PR
 * source tip.
 */
export function contentCommitForChange(
  changeType: ChangeType | undefined,
  commits: DiffCommitPair,
): string | undefined {
  return changeType === "deleted" ? commits.baseCommit : commits.targetCommit;
}

/** Where a PR lives, for building its web URL when ADO doesn't supply one. */
export interface PrLocation {
  /** Org root URL, e.g. `https://dev.azure.com/<org>`. */
  orgUrl: string;
  projectName: string;
  repositoryName: string;
  pullRequestId: number;
}

/**
 * Human web URL for a PR. The `getPullRequestById` REST response does not
 * include a `_links.web` entry (only API links: self, repository, iterations…),
 * so the URL is normally assembled from the PR's location:
 * `<org>/<project>/_git/<repo>/pullrequest/<id>`. A `_links.web` href is still
 * preferred if ADO ever returns one. Returns `undefined` when neither is
 * available, so the rail renders a plain text pill and links are withheld.
 */
export function buildPrWebUrl(
  pr: { _links?: { web?: { href?: string } } } | undefined,
  location?: PrLocation,
): string | undefined {
  const web = pr?._links?.web?.href;
  if (typeof web === "string" && web.length > 0) return web;
  if (!location) return undefined;
  const { orgUrl, projectName, repositoryName, pullRequestId } = location;
  if (!orgUrl || !projectName || !repositoryName || !(pullRequestId > 0)) {
    return undefined;
  }
  const url = `${orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(
    projectName,
  )}/_git/${encodeURIComponent(repositoryName)}/pullrequest/${pullRequestId}`;
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

/** Contribution id (manifest) of the Markdown Review PR tab. */
const PR_TAB_CONTRIBUTION = "markdown-review-pr-tab";

/**
 * ADO's own PR-URL parameters for an update comparison: `iteration` is the
 * newer update's iteration id, `base` the one compared against (0 = the PR
 * base). Our links use them too, so a link opens the same comparison and
 * ADO's native Files tab shows the same one.
 */
export const ITERATION_LINK_PARAM = "iteration";
export const BASE_LINK_PARAM = "base";

/** ADO iteration ids for an update comparison (see `ITERATION_LINK_PARAM`). */
export interface IterationParams {
  iteration: number;
  base: number;
}

/**
 * The ADO iteration ids for a comparison of PR updates, or `undefined` for
 * "All updates" (the default view, which links leave unstated) or an update
 * this PR doesn't have. `stops` is PrShell's newest-first update list, where
 * update N is `stops[stops.length - N]`.
 */
export function iterationParamsForRange(
  range: ReviewIterationRange,
  stops: readonly HistoryStop[],
): IterationParams | undefined {
  const count = stops.length;
  const resolved = resolveReviewIterationRange(range, count);
  if (resolved.isAllChanges) return undefined;
  const idOf = (update: number) => stops[count - update]?.iterationId;
  const iteration = idOf(resolved.range.toUpdate);
  const base =
    resolved.range.fromUpdate === 0 ? 0 : idOf(resolved.range.fromUpdate);
  if (iteration === undefined || base === undefined) return undefined;
  return { iteration, base };
}

/**
 * The comparison of PR updates named by `iteration` / `base` route params (the
 * inverse of {@link iterationParamsForRange}), or `undefined` when absent,
 * malformed, unknown to this PR, or not an older→newer pair.
 */
export function rangeFromIterationParams(
  params: Record<string, string | undefined> | null | undefined,
  stops: readonly HistoryStop[],
): ReviewIterationRange | undefined {
  const parse = (value: string | undefined) =>
    /^\s*\d+\s*$/.test(value ?? "") ? Number(value) : undefined;
  const iteration = parse(params?.[ITERATION_LINK_PARAM]);
  if (iteration === undefined) return undefined;
  const base = parse(params?.[BASE_LINK_PARAM] ?? "0");
  if (base === undefined) return undefined;
  const updateOf = (id: number) => {
    const index = stops.findIndex((stop) => stop.iterationId === id);
    return index === -1 ? undefined : stops.length - index;
  };
  const toUpdate = updateOf(iteration);
  const fromUpdate = base === 0 ? 0 : updateOf(base);
  if (toUpdate === undefined || fromUpdate === undefined) return undefined;
  if (fromUpdate >= toUpdate) return undefined;
  return { fromUpdate, toUpdate };
}

/**
 * The Markdown files a comparison of PR updates touches, by change type, from
 * ADO's iteration changes (`iterations/{iteration}/changes?$compareTo={base}`).
 */
export function rangeChangeTypes(
  entries: ReadonlyArray<{
    changeType?: number;
    item?: { path?: string };
    originalPath?: string;
  }>,
): Record<string, ChangeType> {
  const byPath: Record<string, ChangeType> = {};
  for (const entry of entries) {
    const path = markdownChangePath(entry);
    if (path) byPath[path] = mapChangeType(entry.changeType);
  }
  return byPath;
}

/** Page size when listing a PR update's changed files. */
export const ITERATION_CHANGES_PAGE = 500;

/**
 * Every change entry of a PR update, following ADO's `nextSkip` paging.
 * `getPullRequestIterationChanges` returns 100 entries by default, so a single
 * unpaged call silently drops the rest of a large PR's files. Stops when ADO
 * reports no further page or a `nextSkip` that doesn't advance.
 */
export async function fetchAllIterationChanges<T>(
  fetchPage: (
    top: number,
    skip: number,
  ) => Promise<{ changeEntries?: T[]; nextSkip?: number }>,
): Promise<T[]> {
  const entries: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await fetchPage(ITERATION_CHANGES_PAGE, skip);
    entries.push(...(page.changeEntries ?? []));
    if (!page.nextSkip || page.nextSkip <= skip) return entries;
    skip = page.nextSkip;
  }
}

/**
 * Shareable URL that opens the PR on the Markdown Review tab (`_a` selects a
 * contributed PR tab by its fully-qualified contribution id) with `path` set
 * to the open document, so a link to a comment or heading in any changed file
 * lands on that file. The path uses ADO's own PR-URL form (leading slash), so
 * switching to the native Files tab keeps the same file selected. A selected
 * comparison of PR updates rides along as ADO's `iteration` / `base` params.
 * Returns `undefined` when the PR web URL is unavailable or unparseable.
 */
export function buildPrTabDocUrl(
  prWebUrl: string | undefined,
  ext: { publisherId: string; extensionId: string },
  documentPath: string,
  iterationParams?: IterationParams,
): string | undefined {
  if (!prWebUrl) return undefined;
  let url: URL;
  try {
    url = new URL(prWebUrl);
  } catch {
    return undefined;
  }
  url.searchParams.set(
    "_a",
    `${ext.publisherId}.${ext.extensionId}.${PR_TAB_CONTRIBUTION}`,
  );
  const path = prTabRoutePath(documentPath);
  if (path) url.searchParams.set(PATH_LINK_PARAM, path);
  if (iterationParams) {
    url.searchParams.set(
      ITERATION_LINK_PARAM,
      String(iterationParams.iteration),
    );
    url.searchParams.set(BASE_LINK_PARAM, String(iterationParams.base));
  }
  return url.toString();
}

/** A repo path in the PR route's `path` form (`/docs/a.md`); `""` when blank. */
export function prTabRoutePath(documentPath: string): string {
  const bare = documentPath.trim().replace(/^\/+/, "");
  return bare ? `/${bare}` : "";
}

/**
 * The changed file a `?path=` deep link selects, in the PR's own casing — or
 * `undefined` when the link names no file or one this PR doesn't change (the
 * tab then opens its default first file rather than an unloadable path).
 */
function pickRoutedFile(
  routedPath: string | undefined,
  files: ReadonlyArray<{ path: string }>,
): string | undefined {
  if (!routedPath) return undefined;
  return files.find((file) => samePath(file.path, routedPath))?.path;
}

/** Deep-link targets the PR tab opens with, resolved from its route params. */
export interface PrTabRouteSeed {
  /** Changed file to open first; `undefined` → the shell's default file. */
  selectedPath?: string;
  /** Thread to activate (`?comment=`). */
  threadId?: string;
  /** Heading slug to scroll to (`?anchor=`). */
  anchor?: string;
  /** Serialized text fragment to flash (`?text=`). */
  text?: string;
  /** Comparison of PR updates to open (`?iteration=&base=`). */
  iterationRange?: ReviewIterationRange;
}

/**
 * Resolve the PR tab's deep-link targets from its route params. A link naming
 * a file this PR doesn't change (renamed or dropped in a later push) opens the
 * default file and drops the heading target — a same-named heading in another
 * file would be the wrong place. The comment target is kept: thread ids are
 * PR-wide and an unknown one simply never activates. An update comparison the
 * PR doesn't have falls back to "All updates".
 */
export function resolvePrTabRouteSeed(
  params: Record<string, string | undefined> | null | undefined,
  files: ReadonlyArray<{ path: string }>,
  stops: readonly HistoryStop[] = [],
): PrTabRouteSeed {
  const routedPath = readPathParam(params);
  const selectedPath = pickRoutedFile(routedPath, files);
  const pathMissing = routedPath !== undefined && selectedPath === undefined;
  return {
    selectedPath,
    threadId: readCommentParam(params),
    anchor: pathMissing ? undefined : readAnchorParam(params),
    text: pathMissing ? undefined : readTextParam(params),
    iterationRange: rangeFromIterationParams(params, stops),
  };
}
/**
 * The page-visibility signals {@link withTimeout} needs. Injectable so tests
 * can drive hidden/visible transitions deterministically.
 */
export interface VisibilityClock {
  now(): number;
  isVisible(): boolean;
  subscribeVisibilityChange(listener: () => void): () => void;
}

const DOCUMENT_VISIBILITY: VisibilityClock = {
  now: () => Date.now(),
  isVisible: () =>
    /* v8 ignore next -- SSR guard; the app and tests always have a document */
    typeof document === "undefined" || document.visibilityState === "visible",
  subscribeVisibilityChange(listener) {
    /* v8 ignore next -- SSR guard; the app and tests always have a document */
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/**
 * Wrap a promise with a hard timeout so a misbehaving SDK/REST call surfaces
 * as a concrete error in the loading UI rather than spinning forever.
 *
 * Only VISIBLE time counts against the budget. Browsers throttle background
 * tabs (timers, the host↔iframe postMessage channel), so a PR opened in a
 * background tab used to burn the whole budget while hidden and greet the user
 * with a false "Timeout" error on arrival — 96% of production timeouts had a
 * hidden boot interval. The clock pauses while hidden and resumes on reveal.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  visibility: VisibilityClock = DOCUMENT_VISIBILITY,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let remainingMs = ms;
    let visibleSinceMs: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const pause = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (visibleSinceMs !== null) {
        remainingMs -= Math.max(0, visibility.now() - visibleSinceMs);
        visibleSinceMs = null;
      }
    };
    // `finish` / `resume` run only after `unsubscribe` is initialised: the
    // timer and the visibility listener fire asynchronously, never inline.
    const resume = (): void => {
      if (timer !== null) return;
      visibleSinceMs = visibility.now();
      timer = setTimeout(
        () => {
          finish();
          reject(new Error(`Timeout after ${ms}ms while waiting for ${label}`));
        },
        Math.max(0, remainingMs),
      );
    };
    const unsubscribe = visibility.subscribeVisibilityChange(() => {
      if (visibility.isVisible()) resume();
      else pause();
    });
    const finish = (): void => {
      settled = true;
      pause();
      unsubscribe();
    };

    if (visibility.isVisible()) resume();
    promise.then(
      (v) => {
        if (settled) return;
        finish();
        resolve(v);
      },
      (err) => {
        if (settled) return;
        finish();
        reject(err);
      },
    );
  });
}
