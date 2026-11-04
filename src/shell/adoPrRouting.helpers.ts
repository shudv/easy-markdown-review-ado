// Routing a document's comments to the pull requests in its history: the most
// recent completed PR that changed it (its comment home in the Documents hub)
// and the ordered PR "stops" of its review history. The Git client is injected
// so this stays loadable (and testable) under Node; numeric literals mirror the
// SDK enums (`GitVersionType.Branch` = 0, `GitVersionOptions.None` = 0,
// `GitPullRequestQueryType.LastMergeCommit` = 1).

import type {
  GitPullRequest,
  GitPullRequestQuery,
  GitQueryCommitsCriteria,
  GitRepository,
  GitRestClient,
} from "azure-devops-extension-api/Git";

import { trackUserFacingError } from "../telemetry";
import { withRetry } from "./retry";
import { isItemNotFoundError, type DocPrRef } from "./shellHelpers";
import {
  buildPrUrl,
  commitIds,
  COMPLETED_PR_STATUS,
  docPrRefsFromHistory,
  firstCommitId,
  normalizePath,
  selectRoutingPr,
  selectRoutingPrFromQuery,
  selectRoutingPrsFromQuery,
  stripRefsHeads,
  type GitScope,
} from "./adoGitData.helpers";

type PrRoutingClient = Pick<
  GitRestClient,
  "getPullRequests" | "getCommits" | "getPullRequestQuery"
>;
type PrRoutingScope = GitScope<PrRoutingClient>;

/** A document's reads: the client, its repo + project, and the file/branch. */
interface DocRead {
  gitClient: PrRoutingClient;
  projectId: string;
  repo: GitRepository;
  branch: string;
  wanted: string;
}

/** Callers check `repo.defaultBranch` first. */
function docRead(
  scope: PrRoutingScope,
  repo: GitRepository,
  docPath: string,
): DocRead {
  return {
    gitClient: scope.git(),
    projectId: scope.projectId,
    repo,
    branch: stripRefsHeads(repo.defaultBranch),
    wanted: normalizePath(docPath),
  };
}

/** `getCommits` criteria for the commits on `branch` that touched a file. */
function fileCommitsCriteria(
  read: DocRead,
  page: { $top: number; $skip?: number },
): GitQueryCommitsCriteria {
  return {
    itemPath: read.wanted,
    itemVersion: {
      version: read.branch,
      versionType: 0 /* GitVersionType.Branch */,
      versionOptions: 0 /* GitVersionOptions.None */,
    },
    ...page,
  } as GitQueryCommitsCriteria;
}

/** A `getPullRequestQuery` for the PRs whose last merge commit is in `ids`. */
function lastMergeCommitQuery(ids: string[]): GitPullRequestQuery {
  return {
    queries: [
      {
        type: 1 /* GitPullRequestQueryType.LastMergeCommit */,
        items: ids,
      },
    ],
  } as GitPullRequestQuery;
}

export async function mostRecentRoutingPr(
  scope: PrRoutingScope,
  repo: GitRepository,
): Promise<GitPullRequest | null> {
  if (!repo.defaultBranch) return null;
  const gitClient = scope.git();
  // Fetch the most recent COMPLETED PRs targeting the default branch and let
  // the pure `selectRoutingPr` helper make the routing decision (most recent
  // completed; active PRs ignored). We over-fetch a small page rather than
  // top-1 so the choice is robust to any host-side ordering quirks — the
  // helper re-sorts by date regardless.
  const criteria = {
    targetRefName: repo.defaultBranch,
    status: COMPLETED_PR_STATUS,
  } as Parameters<GitRestClient["getPullRequests"]>[1];
  try {
    let completed: GitPullRequest[];
    try {
      completed = await withRetry(
        () =>
          gitClient.getPullRequests(
            repo.id,
            criteria,
            scope.projectId,
            undefined,
            0,
            10,
          ),
        { mode: "read", label: "findMostRecentRoutingPr.getPullRequests" },
      );
    } catch (err) {
      // Retries exhausted (or terminal) — degrade to "no routing PR".
      trackUserFacingError({
        error: err,
        source: "DocumentsHubApp.repository",
        operation: "repository-pr-routing",
        impact: "degraded",
      });
      completed = [];
    }
    return selectRoutingPr(completed);
  } catch (err) {
    console.warn(
      `[documents-hub] getPullRequests failed for ${repo.name}:`,
      err,
    );
    trackUserFacingError({
      error: err,
      source: "DocumentsHubApp.repository",
      operation: "repository-pr-routing",
      impact: "degraded",
    });
    return null;
  }
}

/**
 * Resolve the most recent COMPLETED PR that changed `docPath` — the PR a
 * document's comments are routed to in the Documents hub — so a document's
 * comments live on a real PR in its history and NO comment-housing PR has to
 * be created. This is what keeps the extension off the `vso.code_write` scope
 * (it only reads PRs + writes comment threads).
 *
 * Resolution is a constant two calls regardless of how deep the file's history
 * is: `getCommits(itemPath, top 1)` finds the last commit on the default
 * branch that touched the file, then `getPullRequestQuery(LastMergeCommit)`
 * finds the PR that merged that commit. (The previous implementation scanned
 * up to 20 completed PRs newest-first, loading each one's iteration changes
 * sequentially — up to ~41 serial round-trips for a file last changed long
 * ago.) Falls back to the repo's most recent completed PR (regardless of path)
 * so every document still has a stable comment home — e.g. when the file last
 * changed via a direct push with no associated PR — and finally `null` when
 * the repo has no completed PRs at all.
 */
export async function routingPrForDoc(
  scope: PrRoutingScope,
  repo: GitRepository,
  docPath: string,
): Promise<GitPullRequest | null> {
  if (!repo.defaultBranch) return null;
  const read = docRead(scope, repo, docPath);

  // 1. The most recent commit on the default branch that touched this file.
  //    `getCommits` returns newest-first, so `top: 1` is the last change.
  const commitId = await lastCommitTouching(read);

  // 2. The PR that merged that commit (its last-merge commit). When the file
  //    landed via a direct push the commit has no PR and we drop to the
  //    fallback below.
  if (commitId) {
    const pr = await prMergingCommit(read, commitId);
    if (pr) return pr;
  }

  // 3. No completed PR touched the document — fall back to the repo's most
  //    recent completed PR so comments still have a home. No PR is ever created.
  return mostRecentRoutingPr(scope, repo);
}

async function lastCommitTouching(read: DocRead): Promise<string | null> {
  const { gitClient, projectId, repo, wanted } = read;
  try {
    const commits = await withRetry(
      () =>
        gitClient.getCommits(
          repo.id,
          fileCommitsCriteria(read, { $top: 1 }),
          projectId,
        ),
      { mode: "read", label: "findRoutingPrForDoc.getCommits" },
    );
    return firstCommitId(commits);
  } catch (err) {
    console.warn(
      `[documents-hub] getCommits failed for ${repo.name} @ ${wanted}:`,
      err,
    );
    // A path that's no longer on the branch can't be routed — expected, not a
    // failure; fall through to the repo's most recent completed PR below.
    if (!isItemNotFoundError(err)) {
      trackUserFacingError({
        error: err,
        source: "DocumentsHubApp.comments",
        operation: "document-routing-commit-load",
        impact: "degraded",
      });
    }
    return null;
  }
}

async function prMergingCommit(
  read: DocRead,
  commitId: string,
): Promise<GitPullRequest | null> {
  const { gitClient, projectId, repo } = read;
  try {
    const query = await withRetry(
      () =>
        gitClient.getPullRequestQuery(
          lastMergeCommitQuery([commitId]),
          repo.id,
          projectId,
        ),
      { mode: "read", label: "findRoutingPrForDoc.getPullRequestQuery" },
    );
    return selectRoutingPrFromQuery(query.results, commitId);
  } catch (err) {
    console.warn(
      `[documents-hub] getPullRequestQuery failed for ${repo.name}:`,
      err,
    );
    trackUserFacingError({
      error: err,
      source: "DocumentsHubApp.comments",
      operation: "document-pr-routing",
      impact: "degraded",
    });
    return null;
  }
}

/**
 * One page of a document's review history: the ordered, completed-only,
 * de-duped PRs that changed `docPath`, most recent first. Powers the
 * comment-history stepper (the ‹ › chevrons that walk PR-to-PR), where each PR
 * is a "stop" showing the document as it was at that PR's merge commit plus
 * that PR's comments.
 *
 * Built from the same two SDK calls as {@link routingPrForDoc}, just
 * widened from 1→N: `getCommits(itemPath, $top, $skip)` pages the file's
 * commits newest-first, then a SINGLE `getPullRequestQuery(LastMergeCommit)`
 * over all those commit ids resolves the PRs that merged them. Pass
 * `nextCommitSkip` back as `skip` to load older stops. Note: PRs are de-duped
 * *within* a page; a caller paging across multiple calls should also de-dupe
 * by `pullRequestId` (several commits — across pages — can share one PR).
 * Degrades to an empty page on any failure so the stepper simply shows no
 * earlier history rather than breaking the document view.
 */
interface DocPrHistoryPage {
  prs: GitPullRequest[];
  /** Pass as the next call's `skip` to continue paging older commits. */
  nextCommitSkip: number;
  /** Whether more file commits may remain to scan for older PRs. */
  hasMore: boolean;
}

/** Which slice of a document's history to load. */
interface HistoryPageOptions {
  top?: number;
  skip?: number;
}

async function findDocPrHistory(
  scope: PrRoutingScope,
  repo: GitRepository,
  docPath: string,
  opts: HistoryPageOptions,
): Promise<DocPrHistoryPage> {
  const skip = opts.skip ?? 0;
  const top = opts.top ?? 30;
  const empty: DocPrHistoryPage = {
    prs: [],
    nextCommitSkip: skip,
    hasMore: false,
  };
  if (!repo.defaultBranch) return empty;
  const read = docRead(scope, repo, docPath);

  // 1. Page the commits on the default branch that touched this file,
  //    newest-first.
  const ids = await fileCommitIdsPage(read, { $top: top, $skip: skip });
  if (ids === null) return empty;
  // A short page means we've reached the start of the file's history.
  const hasMore = ids.length === top;
  const nextCommitSkip = skip + ids.length;
  if (ids.length === 0) return { prs: [], nextCommitSkip, hasMore: false };

  // 2. One batched query maps every commit to the PR(s) that merged it.
  //    When that mapping fails, report no stops for this page but let the
  //    caller keep paging in case older commits map cleanly.
  const prs = await prsMergingCommits(read, ids);
  return { prs, nextCommitSkip, hasMore };
}

/** The page's file commit ids, or `null` when the commits can't be read. */
async function fileCommitIdsPage(
  read: DocRead,
  page: { $top: number; $skip: number },
): Promise<string[] | null> {
  const { gitClient, projectId, repo, wanted } = read;
  try {
    const commits = await withRetry(
      () =>
        gitClient.getCommits(
          repo.id,
          fileCommitsCriteria(read, page),
          projectId,
        ),
      { mode: "read", label: "findDocPrHistory.getCommits" },
    );
    return commitIds(commits);
  } catch (err) {
    console.warn(
      `[documents-hub] getCommits (history) failed for ${repo.name} @ ${wanted}:`,
      err,
    );
    // A path that's no longer on the branch has no history — expected, not a
    // failure (the reader falls back to another document).
    if (!isItemNotFoundError(err)) {
      trackUserFacingError({
        error: err,
        source: "Shell.history",
        operation: "history-commit-load",
        impact: "degraded",
      });
    }
    return null;
  }
}

/** The completed PRs that merged `ids`, in history order; `[]` on failure. */
async function prsMergingCommits(
  read: DocRead,
  ids: string[],
): Promise<GitPullRequest[]> {
  const { gitClient, projectId, repo } = read;
  try {
    const query = await withRetry(
      () =>
        gitClient.getPullRequestQuery(
          lastMergeCommitQuery(ids),
          repo.id,
          projectId,
        ),
      { mode: "read", label: "findDocPrHistory.getPullRequestQuery" },
    );
    return selectRoutingPrsFromQuery(query.results, ids);
  } catch (err) {
    console.warn(
      `[documents-hub] getPullRequestQuery (history) failed for ${repo.name}:`,
      err,
    );
    trackUserFacingError({
      error: err,
      source: "Shell.history",
      operation: "history-pr-load",
      impact: "degraded",
    });
    return [];
  }
}

/**
 * Load a document's review-history "stops" as plain {@link DocPrRef} records —
 * the completed PRs that changed it, most recent first — for the comment-
 * history stepper. Thin glue over {@link findDocPrHistory} that projects the
 * raw `GitPullRequest`s via {@link docPrRefsFromHistory} (attaching each PR's
 * merge commit + web URL). A single page (default `top` commits) covers a
 * document's history in practice; degrades to `[]` on failure.
 */
export async function docPrHistory(
  scope: PrRoutingScope,
  repo: GitRepository,
  docPath: string,
  opts: HistoryPageOptions = {},
): Promise<DocPrRef[]> {
  const page = await findDocPrHistory(scope, repo, docPath, opts);
  return docPrRefsFromHistory(page.prs, (id) => buildPrUrl(repo, id));
}
