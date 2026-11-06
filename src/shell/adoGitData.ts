// ADO REST adapter for the in-context Markdown reader. Wraps `GitRestClient`
// so the panel host stays focused on composition. Concerns: discover repos +
// their root markdown, resolve the routing PR per repo, list a folder's
// markdown on demand, filename search via ALM Code Search, and fetch file
// content + emr-tagged threads. Discovery degrades gracefully — a repo that
// fails to enumerate is logged and dropped rather than killing the caller —
// while thread reads reject so the poller / loader that owns the user-facing
// state also owns the report.

import * as SDK from "azure-devops-extension-sdk";
import {
  GitVersionOptions,
  GitVersionType,
  PullRequestStatus,
  type GitPullRequest,
  type GitRepository,
  type GitRestClient,
} from "azure-devops-extension-api/Git";

import type { CommentThread, FileInfo } from "../types";
import { trackUserFacingError } from "../telemetry";
import { adoThreadToLocal, readPrThreads } from "./adoCommentApi";
import { withRetry } from "./retry";
import type { DocPrRef } from "./shellHelpers";
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
  escapeSearchQuery,
  normalizePath,
  normalizeRepoFilter,
  repoSkeleton,
  type GitScope,
} from "./adoGitData.helpers";
import { listMarkdownLevel, type ListedRepo } from "./adoFolderListing.helpers";
import {
  docPrHistory,
  mostRecentRoutingPr,
  routingPrForDoc,
} from "./adoPrRouting.helpers";
import { sharedGitClient } from "./adoClients";

// Re-export `buildPrUrl` (the one helper external callers reach for through
// this module's SDK-touching API surface).
export { buildPrUrl };

/** Injected-client reads in `project`, through the page's shared Git client. */
function gitScope(projectId: string): GitScope<GitRestClient> {
  return { git: sharedGitClient, projectId };
}

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
  const gitClient = sharedGitClient();
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
  const gitClient = sharedGitClient();

  try {
    // The REST client hands back the parsed body as-is, which can be empty.
    const raw = await withRetry<GitRepository | null | undefined>(
      () => gitClient.getRepository(repoId, projectId),
      { mode: "read", label: "fetchRepoById.getRepository" },
    );

    if (!raw || raw.isDisabled) return null;

    return { repo: repoSkeleton(raw), raw };
  } catch (err) {
    console.warn(`[documents-hub] fetchRepoById failed for ${repoId}:`, err);
    trackUserFacingError({
      error: err,
      source: "DocumentsHubApp.discovery",
      operation: "linked-repository-load",
      impact: "degraded",
    });

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
  const pr = await mostRecentRoutingPr(gitScope(projectId), rawRepo);

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
  /** The root folder's wiki `.order` page names, when it has one. */
  rootOrder?: string[];
  recentPr: DocRepo["recentPr"];
  pr: GitPullRequest | null;
}> {
  const [rootResult, routingResult] = await Promise.allSettled([
    listMarkdownRoot(rawRepo, projectId),
    loadRepoPrRouting(rawRepo, projectId),
  ]);

  const root: FolderListing =
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
    rootOrder: root.order,
    recentPr: routing.recentPr,
    pr: routing.pr,
  };
}

/**
 * Project a raw `GitPullRequest` into the compact `DocRepo.recentPr`
 * shape used by the picker + the routed-PR pill. Returns `null` when
 * there's no PR (so callers can assign the result directly).
 */
/** A REST `GitPullRequest`: ADO omits `title` / `createdBy` on some payloads. */
type GitPullRequestWire = Omit<GitPullRequest, "title" | "createdBy"> &
  Partial<Pick<GitPullRequest, "title" | "createdBy">>;

function prMetaFromGitPr(
  repo: GitRepository,
  pr: GitPullRequestWire | null,
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
  return listMarkdownLevel(gitScope(projectId), repo, "/");
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

  return listMarkdownLevel(gitScope(projectId), repoStub(repo), path);
}

/**
 * List the folder holding a wiki page's subpages (for `[[_TOSP_]]`), at the
 * default branch tip or at `atCommitId` (a pull request's content, or a
 * historical version). A folder that doesn't exist means the page has no
 * subpages, so it lists as empty; any other failure is thrown so the reader
 * says subpages are unavailable rather than claiming there are none.
 */
export async function listSubpageFolder(
  repo: Pick<DocRepo, "id" | "name" | "defaultBranch">,
  projectId: string,
  path: string,
  atCommitId?: string,
): Promise<FolderListing> {
  return listMarkdownLevel(gitScope(projectId), repoStub(repo), path, {
    atCommitId,
    missingOk: true,
    propagate: true,
  });
}

/** The minimum repository shape `listMarkdownLevel` needs, from a DocRepo. */
function repoStub(
  repo: Pick<DocRepo, "id" | "name" | "defaultBranch">,
): ListedRepo {
  return {
    id: repo.id,
    name: repo.name,
    defaultBranch: `refs/heads/${repo.defaultBranch}`,
  };
}

/**
 * Resolve the most recent COMPLETED PR that changed `docPath` — the PR a
 * document's comments are routed to in the Documents hub, falling back to the
 * repo's most recent completed PR. See {@link routingPrForDoc}.
 */
export function findRoutingPrForDoc(
  repo: GitRepository,
  projectId: string,
  docPath: string,
): Promise<GitPullRequest | null> {
  return routingPrForDoc(gitScope(projectId), repo, docPath);
}

/**
 * Load a document's review-history "stops" (the completed PRs that changed
 * it, most recent first) for the comment-history stepper. See
 * {@link docPrHistory}.
 */
export function loadDocPrHistory(
  repo: GitRepository,
  projectId: string,
  docPath: string,
  opts: { top?: number; skip?: number } = {},
): Promise<DocPrRef[]> {
  return docPrHistory(gitScope(projectId), repo, docPath, opts);
}

/**
 * Load the emr / review threads from a specific PR, keeping only those
 * anchored to `docPath`. Used by the Documents hub's per-document comment
 * routing: a document's comments live on the completed PR that last changed
 * it, so we read that PR's threads and filter to the ones for this file
 * (dropping unrelated other-file and general PR threads).
 *
 * Rejects on failure, like the PR tab's `loadAdoThreads`: the caller owns the
 * report. Swallowing it here made every failed 30s poll look like a fresh
 * success-then-failure, so one token dead window reported 45 times.
 */
export async function loadThreadsForRoutedPr(
  repoId: string,
  projectId: string,
  pullRequestId: number,
  docPath: string,
): Promise<CommentThread[]> {
  const wanted = normalizePath(docPath).toLowerCase();

  const raw = await readPrThreads(
    repoId,
    pullRequestId,
    projectId,
    "loadThreadsForRoutedPr.getThreads",
  );

  const out: CommentThread[] = [];

  for (const t of raw) {
    const local = adoThreadToLocal(t);

    if (local && normalizePath(local.filePath).toLowerCase() === wanted) {
      out.push(local);
    }
  }

  return out;
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
  const gitClient = sharedGitClient();

  // Default: the live tip of the default branch (today's document). When a
  // commit id is supplied (the comment-history stepper viewing the document as
  // it was at a PR's merge commit), pin the read to that immutable commit.
  const versionDescriptor =
    atCommitId !== undefined && atCommitId !== ""
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

  if (orgName === undefined) {
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
    // `getHost` throws (caught below) before `init`; once ready it returns the
    // handshake's host context. A blank name counts as "no org".
    const name = SDK.getHost().name;

    return name === "" ? undefined : name;
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
          // heals only a true transient auth race — not the `ado_exp` dead window.
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
  const gitClient = sharedGitClient();

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
    trackUserFacingError({
      error: err,
      source: "Shell.comments",
      operation: "repository-comments-load",
      impact: "degraded",
    });

    return [];
  }
}
