// Pure helpers extracted from `PrTabApp.tsx` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles (which Node
// can't evaluate). The container keeps only the SDK/React glue and imports
// these for its decision logic.

import type { ChangeType } from "../types";
import type { HistoryStop } from "../shell/prShellHelpers";

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
        title,
        ...(dateMs !== undefined && Number.isFinite(dateMs) ? { dateMs } : {}),
        isCurrent,
        readOnly: !isCurrent,
      } satisfies HistoryStop;
    })
    .reverse();
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
  const asNumber = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number.parseInt(v, 10);
    return null;
  };
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
      const n = asNumber(c);
      if (n !== null) return n;
    }
  }
  const m = /\/pullrequest\/(\d+)\b/i.exec(referrer);
  if (m) return Number.parseInt(m[1]!, 10);
  return null;
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

/**
 * Best-effort human web URL for a PR. ADO sometimes omits `_links.web` from PR
 * JSON; return `undefined` then so the rail renders a plain text pill.
 */
export function buildPrWebUrl(
  pr: { _links?: { web?: { href?: string } } } | undefined,
): string | undefined {
  const web = pr?._links?.web?.href;
  if (typeof web === "string" && web.length > 0) return web;
  return undefined;
}

/**
 * Wrap a promise with a hard timeout so a misbehaving SDK/REST call surfaces
 * as a concrete error in the loading UI rather than spinning forever.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms while waiting for ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}
