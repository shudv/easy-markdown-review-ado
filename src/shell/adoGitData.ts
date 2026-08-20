// ADO REST adapter for the in-context Markdown reader. Wraps `GitRestClient`
// so the panel host stays focused on composition. Concerns: discover repos +
// their root markdown, resolve the routing PR per repo, list a folder's
// markdown on demand, filename search via ALM Code Search, and fetch file
// content + emr-tagged threads. All methods degrade gracefully \u2014 a repo that
// fails to enumerate is logged and dropped rather than killing the caller.

import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitPullRequestQueryType,
  GitVersionOptions,
  GitVersionType,
  PullRequestStatus,
  VersionControlRecursionType,
  type GitItem,
  type GitPullRequest,
  type GitPullRequestQuery,
  type GitQueryCommitsCriteria,
  type GitRepository,
} from "azure-devops-extension-api/Git";

import type { CommentThread, FileInfo } from "../types";
import { adoThreadToLocal } from "./adoCommentApi";
import { withRetry } from "./retry";
import type { DocPrRef } from "./prShellHelpers";
import type { DocRepo, FolderListing } from "./types";
import {
  createAlmSearchClient,
  outcomeFromError,
  type AlmSearchClient,
  type CodeSearchResponse,
  type FileSearchOutcome,
} from "./almSearch";
import {
  buildPrUrl,
  commitIds,
  docPrRefsFromHistory,
  escapeSearchQuery,
  firstCommitId,
  normalizePath,
  normalizeRepoFilter,
  projectMarkdownLevel,
  repoSkeleton,
  selectRoutingPr,
  selectRoutingPrFromQuery,
  selectRoutingPrsFromQuery,
  stripRefsHeads,
} from "./adoGitData.helpers";

// Re-export `buildPrUrl` (the one helper external callers reach for through
// this module's SDK-touching API surface).
export { buildPrUrl };

// ---------------------------------------------------------------------------
// Repo discovery
// ---------------------------------------------------------------------------

/**
 * Enumerate EVERY repository in a project. The non-paged `getRepositories`
/** One page of the project's repos, plus the token to fetch the next page. */
export interface RepoPage {
  repos: DocRepo[];
  rawRepoById: Map<string, GitRepository>;
  /** Pass to the next `fetchRepoPage` call; `null` when this is the last page. */
  continuationToken: string | null;
}

/**
 * Fetch ONE page of the project's repositories for the picker, optionally
 * narrowed by a server-side name filter. Unlike `discoverProjectRepos`, this
 * does NOT list each repo's markdown — repos are returned as content-less
 * skeletons and their files/PR routing are resolved lazily on selection. This
 * keeps the picker cheap and scalable for orgs/projects with thousands of
 * repos: the UI pages in more rows as the user scrolls and re-queries on
 * keyword.
 */
export async function fetchRepoPage(
  projectId: string,
  opts: {
    /** Case-insensitive substring match on the repo name (ADO `filterContains`). */
    filter?: string;
    /** Continuation token from a prior page; omit for the first page. */
    continuationToken?: string;
    /** Page size (ADO caps at 500). Defaults to 50 for snappy scroll loads. */
    top?: number;
  } = {},
): Promise<RepoPage> {
  const gitClient = getClient(GitRestClient);
  const filter = normalizeRepoFilter(opts.filter);
  const batch = await withRetry(
    () =>
      gitClient.getRepositoriesPaged(
        projectId,
        /* includeLinks */ false,
        /* includeAllUrls */ false,
        /* includeHidden */ false,
        /* filterContains */ filter,
        /* top */ opts.top ?? 50,
        opts.continuationToken,
      ),
    { mode: "read", label: "fetchRepoPage.getRepositoriesPaged" },
  );
  const active = batch.filter((r) => !r.isDisabled);
  const rawRepoById = new Map<string, GitRepository>();
  const repos: DocRepo[] = [];
  for (const r of active) {
    rawRepoById.set(r.id, r);
    repos.push(repoSkeleton(r));
  }
  // Normalize an absent token to `null`: `RepoPage.continuationToken` and the
  // picker callers use `null` as the "last page" sentinel (`token !== null`),
  // so leaking `undefined` would keep `hasMore` enabled and reload page one.
  return {
    repos,
    rawRepoById,
    continuationToken: batch.continuationToken ?? null,
  };
}

/**
 * Fetch a single repository by id and project it onto a `DocRepo` skeleton.
 * Used to resolve a deep-linked (`?repo=`) or last-visited repo that may not
 * appear on the first picker page, so it can be selected immediately without
 * paging through the whole list. Returns `null` if the repo can't be loaded.
 */
export async function fetchRepoById(
  projectId: string,
  repoId: string,
): Promise<{ repo: DocRepo; raw: GitRepository } | null> {
  const gitClient = getClient(GitRestClient);
  try {
    const raw = await withRetry(
      () => gitClient.getRepository(repoId, projectId),
      { mode: "read", label: "fetchRepoById.getRepository" },
    );
    if (!raw || raw.isDisabled) return null;
    return { repo: repoSkeleton(raw), raw };
  } catch (err) {
    console.warn(`[documents-hub] fetchRepoById failed for ${repoId}:`, err);
    return null;
  }
}

/**
 * Resolve the most recent COMPLETED PR targeting a repo's default branch.
 * Called the first time the user selects a repo, splitting the expensive
 * `getPullRequests` calls out of initial page load. Returns the
 * `DocRepo.recentPr` shape plus the raw PR (for the `prByRepo` map).
 */
export async function loadRepoPrRouting(
  rawRepo: GitRepository,
  projectId: string,
): Promise<{ recentPr: DocRepo["recentPr"]; pr: GitPullRequest | null }> {
  const pr = await findMostRecentRoutingPr(rawRepo, projectId);
  return { recentPr: prMetaFromGitPr(rawRepo, pr), pr };
}

/**
 * Re-run per-repo discovery (root listing + PR routing) for one repo, for the
 * hub's "Refresh" button. Both sub-calls run in parallel; failures still
 * return a best-effort partial result so the UI doesn't stick on loading.
 */
export async function refreshRepoDiscovery(
  rawRepo: GitRepository,
  projectId: string,
): Promise<{
  files: FileInfo[];
  topLevelFolders: string[];
  recentPr: DocRepo["recentPr"];
  pr: GitPullRequest | null;
}> {
  const [rootResult, routingResult] = await Promise.allSettled([
    listMarkdownRoot(rawRepo, projectId),
    loadRepoPrRouting(rawRepo, projectId),
  ]);
  const root =
    rootResult.status === "fulfilled"
      ? rootResult.value
      : { files: [], folders: [] };
  const routing =
    routingResult.status === "fulfilled"
      ? routingResult.value
      : { recentPr: null, pr: null };
  if (rootResult.status === "rejected") {
    console.warn(
      `[documents-hub] refresh root listing failed for ${rawRepo.name}:`,
      rootResult.reason,
    );
  }
  if (routingResult.status === "rejected") {
    console.warn(
      `[documents-hub] refresh PR routing failed for ${rawRepo.name}:`,
      routingResult.reason,
    );
  }
  return {
    files: root.files,
    topLevelFolders: root.folders,
    recentPr: routing.recentPr,
    pr: routing.pr,
  };
}

/**
 * Project a raw `GitPullRequest` into the compact `DocRepo.recentPr`
 * shape used by the picker + the routed-PR pill. Returns `null` when
 * there's no PR (so callers can assign the result directly).
 */
function prMetaFromGitPr(
  repo: GitRepository,
  pr: GitPullRequest | null,
): DocRepo["recentPr"] {
  if (!pr) return null;
  return {
    id: pr.pullRequestId,
    title: pr.title ?? "(untitled PR)",
    author: pr.createdBy?.displayName ?? "unknown",
    status: pr.status === PullRequestStatus.Completed ? "completed" : "active",
    url: buildPrUrl(repo, pr.pullRequestId),
  };
}

/**
 * OneLevel listing of the repo's root folder: immediate `.md` files +
 * immediate subfolder paths. The DocNav renders subfolders as expandable rows.
 */
async function listMarkdownRoot(
  repo: GitRepository,
  projectId: string,
): Promise<FolderListing> {
  return listMarkdownLevel(repo, projectId, "/");
}

/**
 * On-demand expansion: called the first time a user opens a previously
 * unexplored folder. Returns the immediate `.md` files and subfolders under
 * `path` so the DocNav can render a fresh layer of expandable rows.
 */
export async function listFolderMarkdown(
  repo: DocRepo,
  projectId: string,
  path: string,
): Promise<FolderListing> {
  if (!repo.defaultBranch) return { files: [], folders: [] };
  const gitClient = getClient(GitRestClient);
  // Synthesise the minimum shape `listMarkdownLevel` needs from the DocRepo.
  const stub = {
    id: repo.id,
    name: repo.name,
    defaultBranch: `refs/heads/${repo.defaultBranch}`,
  } as Pick<GitRepository, "id" | "name" | "defaultBranch">;
  return listMarkdownLevel(stub, projectId, path, gitClient);
}

async function listMarkdownLevel(
  repo: Pick<GitRepository, "id" | "name" | "defaultBranch">,
  projectId: string,
  scopePath: string,
  client?: GitRestClient,
): Promise<FolderListing> {
  if (!repo.defaultBranch) return { files: [], folders: [] };
  const gitClient = client ?? getClient(GitRestClient);

  // Pin reads to the default branch's tip so repos with no default
  // branch ref selection still return a coherent listing.
  const branchName = stripRefsHeads(repo.defaultBranch);
  const versionDescriptor = {
    version: branchName,
    versionType: GitVersionType.Branch,
    versionOptions: GitVersionOptions.None,
  };

  let items: GitItem[];
  try {
    items = await withRetry(
      () =>
        gitClient.getItems(
          repo.id,
          projectId,
          scopePath,
          VersionControlRecursionType.OneLevel,
          false,
          false,
          false,
          false,
          versionDescriptor,
        ),
      { mode: "read", label: "listMarkdownLevel.getItems" },
    );
  } catch (err) {
    console.warn(
      `[documents-hub] getItems(OneLevel) failed for ${repo.name} @ ${scopePath}:`,
      err,
    );
    return { files: [], folders: [] };
  }

  // ADO returns the scope folder itself as the first item — the pure
  // `projectMarkdownLevel` helper skips it, keeps only `.md` files
  // (case-insensitive), and sorts. See adoGitData.helpers for the invariants.
  return projectMarkdownLevel(items, scopePath);
}

async function findMostRecentRoutingPr(
  repo: GitRepository,
  projectId: string,
): Promise<GitPullRequest | null> {
  if (!repo.defaultBranch) return null;
  const gitClient = getClient(GitRestClient);
  // Fetch the most recent COMPLETED PRs targeting the default branch and let
  // the pure `selectRoutingPr` helper make the routing decision (most recent
  // completed; active PRs ignored). We over-fetch a small page rather than
  // top-1 so the choice is robust to any host-side ordering quirks — the
  // helper re-sorts by date regardless.
  const criteria = {
    targetRefName: repo.defaultBranch,
    status: PullRequestStatus.Completed,
  } as Parameters<GitRestClient["getPullRequests"]>[1];
  try {
    let completed: GitPullRequest[];
    try {
      completed = await withRetry(
        () =>
          gitClient.getPullRequests(
            repo.id,
            criteria,
            projectId,
            undefined,
            0,
            10,
          ),
        { mode: "read", label: "findMostRecentRoutingPr.getPullRequests" },
      );
    } catch {
      // Retries exhausted (or terminal) — degrade to "no routing PR".
      completed = [];
    }
    return selectRoutingPr(completed);
  } catch (err) {
    console.warn(
      `[documents-hub] getPullRequests failed for ${repo.name}:`,
      err,
    );
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
export async function findRoutingPrForDoc(
  repo: GitRepository,
  projectId: string,
  docPath: string,
): Promise<GitPullRequest | null> {
  if (!repo.defaultBranch) return null;
  const gitClient = getClient(GitRestClient);
  const branch = stripRefsHeads(repo.defaultBranch);
  const wanted = normalizePath(docPath);

  // 1. The most recent commit on the default branch that touched this file.
  //    `getCommits` returns newest-first, so `top: 1` is the last change.
  let commitId: string | null = null;
  try {
    const commits = await withRetry(
      () =>
        gitClient.getCommits(
          repo.id,
          {
            itemPath: wanted,
            itemVersion: {
              version: branch,
              versionType: GitVersionType.Branch,
              versionOptions: GitVersionOptions.None,
            },
            $top: 1,
          } as GitQueryCommitsCriteria,
          projectId,
        ),
      { mode: "read", label: "findRoutingPrForDoc.getCommits" },
    );
    commitId = firstCommitId(commits);
  } catch (err) {
    console.warn(
      `[documents-hub] getCommits failed for ${repo.name} @ ${wanted}:`,
      err,
    );
  }

  // 2. The PR that merged that commit (its last-merge commit). When the file
  //    landed via a direct push the commit has no PR and we drop to the
  //    fallback below.
  if (commitId) {
    try {
      const query = await withRetry(
        () =>
          gitClient.getPullRequestQuery(
            {
              queries: [
                {
                  type: GitPullRequestQueryType.LastMergeCommit,
                  items: [commitId],
                },
              ],
            } as GitPullRequestQuery,
            repo.id,
            projectId,
          ),
        { mode: "read", label: "findRoutingPrForDoc.getPullRequestQuery" },
      );
      const pr = selectRoutingPrFromQuery(query.results, commitId);
      if (pr) return pr;
    } catch (err) {
      console.warn(
        `[documents-hub] getPullRequestQuery failed for ${repo.name}:`,
        err,
      );
    }
  }

  // 3. No completed PR touched the document — fall back to the repo's most
  //    recent completed PR so comments still have a home. No PR is ever created.
  return findMostRecentRoutingPr(repo, projectId);
}

/**
 * One page of a document's review history: the ordered, completed-only,
 * de-duped PRs that changed `docPath`, most recent first. Powers the
 * comment-history stepper (the ‹ › chevrons that walk PR-to-PR), where each PR
 * is a "stop" showing the document as it was at that PR's merge commit plus
 * that PR's comments.
 *
 * Built from the same two SDK calls as {@link findRoutingPrForDoc}, just
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

async function findDocPrHistory(
  repo: GitRepository,
  projectId: string,
  docPath: string,
  opts: { top?: number; skip?: number } = {},
): Promise<DocPrHistoryPage> {
  const skip = opts.skip ?? 0;
  const top = opts.top ?? 30;
  const empty: DocPrHistoryPage = {
    prs: [],
    nextCommitSkip: skip,
    hasMore: false,
  };
  if (!repo.defaultBranch) return empty;
  const gitClient = getClient(GitRestClient);
  const branch = stripRefsHeads(repo.defaultBranch);
  const wanted = normalizePath(docPath);

  // 1. Page the commits on the default branch that touched this file,
  //    newest-first.
  let ids: string[];
  try {
    const commits = await withRetry(
      () =>
        gitClient.getCommits(
          repo.id,
          {
            itemPath: wanted,
            itemVersion: {
              version: branch,
              versionType: GitVersionType.Branch,
              versionOptions: GitVersionOptions.None,
            },
            $top: top,
            $skip: skip,
          } as GitQueryCommitsCriteria,
          projectId,
        ),
      { mode: "read", label: "findDocPrHistory.getCommits" },
    );
    ids = commitIds(commits);
  } catch (err) {
    console.warn(
      `[documents-hub] getCommits (history) failed for ${repo.name} @ ${wanted}:`,
      err,
    );
    return empty;
  }
  // A short page means we've reached the start of the file's history.
  const hasMore = ids.length === top;
  const nextCommitSkip = skip + ids.length;
  if (ids.length === 0) return { prs: [], nextCommitSkip, hasMore: false };

  // 2. One batched query maps every commit to the PR(s) that merged it.
  try {
    const query = await withRetry(
      () =>
        gitClient.getPullRequestQuery(
          {
            queries: [
              {
                type: GitPullRequestQueryType.LastMergeCommit,
                items: ids,
              },
            ],
          } as GitPullRequestQuery,
          repo.id,
          projectId,
        ),
      { mode: "read", label: "findDocPrHistory.getPullRequestQuery" },
    );
    return {
      prs: selectRoutingPrsFromQuery(query.results, ids),
      nextCommitSkip,
      hasMore,
    };
  } catch (err) {
    console.warn(
      `[documents-hub] getPullRequestQuery (history) failed for ${repo.name}:`,
      err,
    );
    // Commits resolved but PR mapping failed — report no stops for this page
    // but let the caller keep paging in case older commits map cleanly.
    return { prs: [], nextCommitSkip, hasMore };
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
export async function loadDocPrHistory(
  repo: GitRepository,
  projectId: string,
  docPath: string,
  opts: { top?: number; skip?: number } = {},
): Promise<DocPrRef[]> {
  const page = await findDocPrHistory(repo, projectId, docPath, opts);
  return docPrRefsFromHistory(page.prs, (id) => buildPrUrl(repo, id));
}

/**
 * Load the emr / review threads from a specific PR, keeping only those
 * anchored to `docPath`. Used by the Documents hub's per-document comment
 * routing: a document's comments live on the completed PR that last changed
 * it, so we read that PR's threads and filter to the ones for this file
 * (dropping unrelated other-file and general PR threads). Degrades to `[]` on
 * any failure so a transient read error doesn't break the rail.
 */
export async function loadThreadsForRoutedPr(
  repoId: string,
  projectId: string,
  pullRequestId: number,
  docPath: string,
): Promise<CommentThread[]> {
  const gitClient = getClient(GitRestClient);
  const wanted = normalizePath(docPath).toLowerCase();
  try {
    const raw = await withRetry(
      () => gitClient.getThreads(repoId, pullRequestId, projectId),
      { mode: "read", label: "loadThreadsForRoutedPr.getThreads" },
    );
    const out: CommentThread[] = [];
    for (const t of raw) {
      const local = adoThreadToLocal(t);
      if (local && normalizePath(local.filePath).toLowerCase() === wanted) {
        out.push(local);
      }
    }
    return out;
  } catch (err) {
    console.warn(
      `[documents-hub] getThreads failed for repo ${repoId}, PR ${pullRequestId}:`,
      err,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// File content
// ---------------------------------------------------------------------------

/**
 * Fetch the contents of a file from a repo at its default branch tip.
 * Used when the user navigates to a doc in the in-context reader.
 */
export async function fetchRepoFileContent(
  repo: DocRepo,
  projectId: string,
  path: string,
  atCommitId?: string,
): Promise<string> {
  const gitClient = getClient(GitRestClient);
  // Default: the live tip of the default branch (today's document). When a
  // commit id is supplied (the comment-history stepper viewing the document as
  // it was at a PR's merge commit), pin the read to that immutable commit.
  const versionDescriptor = atCommitId
    ? {
        version: atCommitId,
        versionType: GitVersionType.Commit,
        versionOptions: GitVersionOptions.None,
      }
    : {
        version: repo.defaultBranch,
        versionType: GitVersionType.Branch,
        versionOptions: GitVersionOptions.None,
      };
  const ab = await withRetry(
    () =>
      gitClient.getItemContent(
        repo.id,
        path,
        projectId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        versionDescriptor,
        true,
      ),
    { mode: "read", label: "fetchRepoFileContent.getItemContent" },
  );
  return new TextDecoder("utf-8").decode(new Uint8Array(ab));
}

// ---------------------------------------------------------------------------
// Filename search (ALM Code Search)
//
// ADO's Code Search REST endpoint (`almsearch.dev.azure.com/{org}/...`)
// supports filename/content search across a project's repos. It isn't in the
// `azure-devops-extension-api` package, so we go through our typed wrapper in
// `./almSearch`. Requires the "Code Search" extension (`ms.vss-code-search`)
// installed and read access to the repo. We use the `file:` operator with
// wildcards + an `ext:md` filter; results are re-checked for `.md` client-side.
// ---------------------------------------------------------------------------

interface CodeSearchHit {
  path?: string;
  fileName?: string;
  repository?: { name?: string };
  project?: { name?: string };
}

// Module-scoped client cache. Holding one keeps the `source` / availability
// state observable across calls.
let _almClient: AlmSearchClient | null = null;
let _almUnavailable: { reason: string; message?: string } | null = null;

function getOrCreateAlmClient(): AlmSearchClient | null {
  if (_almClient) return _almClient;
  if (_almUnavailable) return null;
  const orgName = getOrgName();
  if (!orgName) {
    _almUnavailable = { reason: "no-config", message: "no host name" };
    return null;
  }
  const result = createAlmSearchClient({
    orgName,
    getToken: () => SDK.getAccessToken(),
  });
  if (!result.ok) {
    _almUnavailable = { reason: result.reason, message: result.message };
    return null;
  }
  _almClient = result.client;
  return _almClient;
}

/**
 * Search markdown filenames across a single repo. Queries under two chars
 * return `{ kind: "ok", files: [] }` without a network call (the DocNav falls
 * back to its local substring filter). Any failure returns
 * `{ kind: "unavailable", reason, message? }` so the DocNav can hint inline.
 */
export async function searchRepoFiles(
  repo: DocRepo,
  projectName: string,
  query: string,
  signal?: AbortSignal,
): Promise<FileSearchOutcome> {
  const trimmed = query.trim();
  // Below two chars the local filter is faster, and ALM Search 400s on very
  // short queries.
  if (trimmed.length < 2) return { kind: "ok", files: [] };

  const client = getOrCreateAlmClient();
  if (!client) {
    return {
      kind: "unavailable",
      reason: "no-config",
      message: _almUnavailable?.message ?? "unavailable",
    };
  }

  // `file:` + wildcards so "deploy" matches "deployment.md",
  // "auto-deploy.md", "runbooks/deploy.md". `ext:md` cuts the result set to
  // markdown server-side.
  const searchText = `file:*${escapeSearchQuery(trimmed)}* ext:md`;

  let json: CodeSearchResponse;
  try {
    json = await client.searchCode(
      {
        searchText,
        $top: 25,
        $skip: 0,
        filters: {
          Project: [projectName],
          Repository: [repo.name],
          Branch: [repo.defaultBranch],
        },
        $orderBy: [{ field: "filename", sortOrder: "ASC" }],
        includeFacets: false,
      },
      projectName,
      signal,
    );
  } catch (err) {
    console.warn("[documents-hub] code search failed:", err);
    return outcomeFromError(err);
  }

  const out: FileInfo[] = [];
  const seen = new Set<string>();
  for (const hit of (json.results ?? []) as CodeSearchHit[]) {
    const path = hit.path ?? "";
    if (!path) continue;
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      changeType: "modified",
      linesAdded: 0,
      linesDeleted: 0,
    });
  }
  return { kind: "ok", files: out };
}

/**
 * Resolve the org name from the SDK host context. Returns `undefined` outside
 * the ADO iframe (tests, dev preview), short-circuiting search to `no-config`.
 */
function getOrgName(): string | undefined {
  try {
    const host = SDK.getHost();
    return host?.name || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

// Cache resolved object URLs per source URL. Identity photos rarely change
// within a session, and one blob per distinct user is cheap; we deliberately
// don't revoke them since the same avatar re-renders as the rail re-mounts.
const _avatarObjectUrls = new Map<string, Promise<string | undefined>>();

/**
 * Resolve an ADO identity image URL to a locally-renderable object URL.
 *
 * The raw `imageUrl` points at the ADO host and needs auth. Loaded as a bare
 * `<img>` from the localhost extension iframe it's an unauthenticated
 * cross-site request that fails, so we fetch it with the SDK access token and
 * wrap the bytes in an object URL the `<img>` can render. Returns `undefined`
 * on any failure so `Avatar` falls back to initials.
 */
export function resolveAdoAvatarObjectUrl(
  url: string,
): Promise<string | undefined> {
  const cached = _avatarObjectUrls.get(url);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const res = await withRetry(
        async () => {
          // Re-acquire the token per attempt. `SDK.getAccessToken()` is a fresh
          // host round-trip, but the host caches the minted token, so a retry
          // heals only a true transient auth race — not the `ado_exp` dead window
          // (detected + recovered at app boot, see shell/adoAuthToken.ts).
          // Avatars just degrade when auth can't complete.
          const token = await SDK.getAccessToken();
          const r = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "image/*" },
          });
          if (!r.ok) {
            throw Object.assign(new Error(`avatar HTTP ${r.status}`), {
              status: r.status,
              headers: r.headers,
            });
          }
          return r;
        },
        { mode: "read", attempts: 2, label: "resolveAdoAvatarObjectUrl.fetch" },
      );
      if (!res.ok) return undefined;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return undefined;
    }
  })();
  _avatarObjectUrls.set(url, pending);
  return pending;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Load all emr-tagged threads for a repo's routing PR. Returns an empty
 * array if the repo has no active PR (the caller should surface the
 * "no active PR" banner in that case).
 */
export async function loadThreadsForRepo(
  repoId: string,
  projectId: string,
  prByRepo: Record<string, GitPullRequest | undefined>,
): Promise<CommentThread[]> {
  const pr = prByRepo[repoId];
  if (!pr || typeof pr.pullRequestId !== "number") return [];
  const gitClient = getClient(GitRestClient);
  try {
    const raw = await withRetry(
      () => gitClient.getThreads(repoId, pr.pullRequestId, projectId),
      { mode: "read", label: "loadThreadsForRepo.getThreads" },
    );
    const out: CommentThread[] = [];
    for (const t of raw) {
      const local = adoThreadToLocal(t);
      if (local) out.push(local);
    }
    return out;
  } catch (err) {
    console.warn(
      `[documents-hub] getThreads failed for repo ${repoId}, PR ${pr.pullRequestId}:`,
      err,
    );
    return [];
  }
}
