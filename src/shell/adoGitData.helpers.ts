// Pure helpers extracted from `adoGitData.ts` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles (which Node
// can't evaluate).

import type {
  GitPullRequest,
  GitRepository,
} from "azure-devops-extension-api/Git";
import type { DocPrRef } from "./prShellHelpers";
import type { DocRepo, FolderListing } from "./types";
import type { FileInfo } from "../types";

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Canonicalize a path for the lazy-load / expanded-folder key sets: trailing
 * slashes stripped; empty/falsy maps to `"/"` so a missing path is
 * distinguishable from the repo root.
 */
export function normalizePath(p: string): string {
  if (!p) return "/";
  const stripped = p.replace(/\/+$/, "");
  return stripped.length === 0 ? "/" : stripped;
}

// ---------------------------------------------------------------------------
// Git ref helpers
// ---------------------------------------------------------------------------

/**
 * Strip the `refs/heads/` prefix for a clean branch name. Pass-through when
 * absent; empty string for null/undefined.
 */
export function stripRefsHeads(ref: string | undefined | null): string {
  if (!ref) return "";
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

// ---------------------------------------------------------------------------
// Edit-PR naming / description (pure — the SDK glue pushes the branch/commit)
// ---------------------------------------------------------------------------

/**
 * Build the topic-branch name for a fresh "edit this document" PR: slugify the
 * file name (drop the `.md`, collapse non-`[a-z0-9._-]` runs to a single dash,
 * collapse `.` runs and trim leading/trailing dots — Git refs cannot contain
 * `..` or begin/end with `.` — trim leading/trailing dashes, lower-case; empty
 * slugs fall back to `doc`) and suffix a base-36 timestamp for uniqueness.
 * `now` is injected so the function stays deterministic under test.
 */
export function editBranchName(
  fileName: string,
  now: number = Date.now(),
): string {
  const slug =
    fileName
      .replace(/\.md$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      // Git refs cannot contain `..` and cannot begin/end with `.`.
      .replace(/\.+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "doc";
  return `emr/edit/${slug}-${now.toString(36)}`;
}

/** Markdown body for the bootstrapped edit PR. */
export function editPrDescription(path: string): string {
  return [
    `Drafted from **Easy Markdown Review** to edit \`${path}\`.`,
    "",
    "A placeholder line was added to the top of the file so this pull request",
    "could be created. **Remove it before completing the PR**, then make your",
    "edits here.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Repo / folder projection (pure — the SDK glue just supplies raw items)
// ---------------------------------------------------------------------------

/** Minimal shape of an ADO `GitItem` the projection reads. */
export interface GitItemLike {
  path?: string;
  isFolder?: boolean;
}

/** Minimal shape of a repository the name filter reads. */
export interface NamedRepoLike {
  name: string;
}

/**
 * Narrow a set of repos to the one whose `name` matches `restrictToRepoName`
 * (case-insensitive, EXACT — not substring, so `docs` never also matches
 * `docs-archive`). When the name matches nothing, or no restriction is given,
 * the full input is returned unchanged (the hub falls back to listing all
 * repos rather than showing an empty picker).
 */
export function filterReposByName<R extends NamedRepoLike>(
  repos: readonly R[],
  restrictToRepoName: string | undefined,
): R[] {
  if (!restrictToRepoName) return [...repos];
  const lc = restrictToRepoName.toLowerCase();
  const narrowed = repos.filter((r) => r.name.toLowerCase() === lc);
  return narrowed.length > 0 ? narrowed : [...repos];
}

/**
 * Project an ADO OneLevel `getItems` listing into `{ files, folders }`:
 *   - the scope folder itself (ADO returns it as the first item) is skipped so
 *     e.g. `/` never lists itself as a subfolder of `/` (which would cause a
 *     re-fetch loop / duplicate node);
 *   - subfolders are collected as-is;
 *   - files are kept only when they end in `.md` (case-INSENSITIVE, so `.MD` /
 *     `.Md` survive), projected onto the neutral `FileInfo` shape;
 *   - both lists are sorted for a stable render order.
 * Pure so the scope-self and extension-case invariants can be unit-tested
 * without the SDK.
 */
export function projectMarkdownLevel(
  items: readonly GitItemLike[],
  scopePath: string,
): FolderListing {
  const files: FileInfo[] = [];
  const folders: string[] = [];
  const normalizedScope = normalizePath(scopePath);
  for (const item of items) {
    const path = item.path ?? "";
    if (!path) continue;
    if (normalizePath(path) === normalizedScope) continue;
    if (item.isFolder) {
      folders.push(path);
    } else if (path.toLowerCase().endsWith(".md")) {
      files.push({
        path,
        changeType: "modified",
        linesAdded: 0,
        linesDeleted: 0,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  folders.sort((a, b) => a.localeCompare(b));
  return { files, folders };
}

// ---------------------------------------------------------------------------
// ALM Search query sanitization
// ---------------------------------------------------------------------------

/**
 * Replace characters the ALM Search query language treats as operators with
 * spaces so user input like `path/to/foo:bar` can't compose a malformed query
 * (which would 400). Not exhaustive — just the common delimiters.
 */
export function escapeSearchQuery(s: string): string {
  return s.replace(/[\\:"*?(){}\[\]^~]/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Identity avatar URLs
// ---------------------------------------------------------------------------

/**
 * Build an identity avatar URL that actually renders from the extension's
 * cross-origin iframe. Used for *every* author — the current user and the
 * authors ADO returns on fetched comment threads — so the same person renders
 * identically everywhere instead of diverging (photo when freshly posted,
 * initials once re-fetched).
 *
 * The raw identity image URL ADO hands us (`SDK.getUser().imageUrl`, or a
 * comment author's `imageUrl`) points at `_apis/GraphProfile/MemberAvatars/…`,
 * which does not send `Access-Control-Allow-Origin`, so the authenticated
 * fetch the avatar resolver performs is blocked by CORS and the photo falls
 * back to initials. ADO's `_api/_common/identityImage?id=<identityId>`
 * endpoint instead allows the cross-origin read — so we target that, keyed by
 * the same identity id (`getUser().id`, identical to the comment author id).
 *
 * Returns `undefined` when there's no source URL to derive the org base from
 * (the caller then leaves `avatarUrl` unset and the initials avatar shows).
 */
export function identityAvatarUrl(identity: {
  id: string;
  imageUrl?: string;
}): string | undefined {
  if (!identity.imageUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(identity.imageUrl);
  } catch {
    return undefined;
  }
  // The org base is everything before the API segment, e.g.
  // "https://dev.azure.com/{org}" or "https://{org}.visualstudio.com". When no
  // API segment is present, keep the whole path (sans trailing slash) as base.
  const path = parsed.pathname;
  const apiIdx = path.indexOf("/_apis/");
  const legacyIdx = path.indexOf("/_api/");
  const cut = apiIdx >= 0 ? apiIdx : legacyIdx;
  const base = cut >= 0 ? path.slice(0, cut) : path.replace(/\/+$/, "");
  return `${parsed.origin}${base}/_api/_common/identityImage?id=${encodeURIComponent(
    identity.id,
  )}`;
}

// ---------------------------------------------------------------------------
// Pull request projection helpers
// ---------------------------------------------------------------------------

/** Most-recent ordering key: prefer closedDate when set, else creationDate. */
export function prDate(pr: GitPullRequest): number {
  const closed = pr.closedDate ? new Date(pr.closedDate).getTime() : 0;
  const created = pr.creationDate ? new Date(pr.creationDate).getTime() : 0;
  return Math.max(closed, created);
}

/**
 * Numeric value of `PullRequestStatus.Completed` (the ADO enum is a runtime
 * import we deliberately avoid here so this module stays Node-testable). Kept
 * as a named constant so the magic number has a single, documented home.
 */
export const COMPLETED_PR_STATUS = 3;

/**
 * Pick the PR that the Documents hub and the in-context dialog route comments
 * through: the most recent COMPLETED PR for the file's branch.
 *
 * Active PRs are intentionally ignored. A completed (merged) PR is a stable,
 * immutable anchor for a document's review history; an active PR is transient
 * — it can be abandoned, retargeted, or force-pushed — so routing a doc's
 * comments to it would make the thread silently move or vanish. "The last
 * merged PR for this file" is the mental model the reader expects.
 *
 * (The PR tab is the exception: it links comments to the PR being viewed,
 * resolved from the page context — not via this helper.)
 *
 * Returns the most recent completed PR, or `null` when none exists.
 */
export function selectRoutingPr(
  prs: readonly GitPullRequest[],
): GitPullRequest | null {
  let best: GitPullRequest | null = null;
  for (const pr of prs) {
    if (pr.status !== COMPLETED_PR_STATUS) continue;
    if (best === null || prDate(pr) > prDate(best)) best = pr;
  }
  return best;
}

/**
 * The `commitId` of the most recent commit returned by `getCommits`, or `null`
 * when the result is empty. We request the commits touching a document newest-
 * first with `$top: 1`, so the head of the list is the last commit that
 * changed it — the input to the `LastMergeCommit` PR query.
 */
export function firstCommitId(
  commits: ReadonlyArray<{ commitId?: string }> | undefined | null,
): string | null {
  return commits?.[0]?.commitId ?? null;
}

/**
 * Pick the routing PR from a `getPullRequestQuery` (`LastMergeCommit`)
 * response for `commitId`: the most recent COMPLETED PR associated with that
 * commit, or `null` when the commit has no completed PR (e.g. it landed via a
 * direct push). `results[0]` is a map of commit id -> PRs that merged it.
 * Applying {@link selectRoutingPr} keeps the completed-only rule so a
 * document's comments always anchor to a merged PR, matching the legacy scan.
 */
export function selectRoutingPrFromQuery(
  results:
    | ReadonlyArray<{ [commitId: string]: GitPullRequest[] }>
    | undefined
    | null,
  commitId: string,
): GitPullRequest | null {
  return selectRoutingPr(results?.[0]?.[commitId] ?? []);
}

/**
 * The commit ids from a `getCommits` result, in order (newest-first as ADO
 * returns them), skipping any entry without an id. This is the input set for a
 * batched `getPullRequestQuery` (`LastMergeCommit`) when building a document's
 * review history — {@link selectRoutingPrsFromQuery} maps the resulting PRs
 * back to this order.
 */
export function commitIds(
  commits: ReadonlyArray<{ commitId?: string }> | undefined | null,
): string[] {
  const out: string[] = [];
  for (const c of commits ?? []) {
    if (c.commitId) out.push(c.commitId);
  }
  return out;
}

/**
 * Build a document's ordered review-history PR list from a batched
 * `getPullRequestQuery` (`LastMergeCommit`) response. Walks `commitIds`
 * newest-first (the order `getCommits` returned the file's commits in),
 * collects the COMPLETED PR(s) that merged each commit, and de-dupes by
 * `pullRequestId` — several commits frequently belong to one PR, and one
 * commit can (rarely) be claimed by more than one. The result is the ordered
 * set of "stops" the comment-history stepper walks: most recent PR first.
 *
 * Completed-only mirrors {@link selectRoutingPr}: only a merged PR is a stable
 * anchor for historical comments + the document snapshot at its merge commit.
 */
export function selectRoutingPrsFromQuery(
  results:
    | ReadonlyArray<{ [commitId: string]: GitPullRequest[] }>
    | undefined
    | null,
  commitIds: readonly string[],
): GitPullRequest[] {
  const map = results?.[0];
  if (!map) return [];
  const seen = new Set<number>();
  const out: GitPullRequest[] = [];
  for (const commitId of commitIds) {
    const completed = (map[commitId] ?? [])
      .filter((pr) => pr.status === COMPLETED_PR_STATUS)
      .sort((a, b) => prDate(b) - prDate(a));
    for (const pr of completed) {
      if (typeof pr.pullRequestId !== "number" || seen.has(pr.pullRequestId)) {
        continue;
      }
      seen.add(pr.pullRequestId);
      out.push(pr);
    }
  }
  return out;
}

/**
 * Project a document's review-history PRs (from {@link selectRoutingPrsFromQuery})
 * into the plain, SDK-free {@link DocPrRef} shape the comment-history stepper
 * consumes. Each ref carries the PR's merge commit (the document's state right
 * after that PR landed — `null` when the PR has no recorded merge commit), its
 * title, a web URL (built via `buildUrl`), and an ordering timestamp. PRs
 * without a numeric id are skipped. Order is preserved (most recent first).
 */
export function docPrRefsFromHistory(
  prs: readonly GitPullRequest[],
  buildUrl: (prId: number) => string | undefined,
): DocPrRef[] {
  const out: DocPrRef[] = [];
  for (const pr of prs) {
    const prId = pr.pullRequestId;
    if (typeof prId !== "number" || !Number.isFinite(prId)) continue;
    out.push({
      prId,
      commitId: pr.lastMergeCommit?.commitId ?? null,
      title: pr.title ?? `PR #${prId}`,
      url: buildUrl(prId),
      dateMs: prDate(pr),
    });
  }
  return out;
}

/**
 * Project ADO pull-request change entries to the normalized, lower-cased file
 * paths they touch — the key set the edit control matches the open document
 * against. Skips entries without an `item.path`; tolerates a missing list.
 */
export function changedPathsFromEntries(
  entries: ReadonlyArray<{ item?: { path?: string } }> | undefined | null,
): string[] {
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    const p = entry.item?.path;
    if (p) paths.push(normalizePath(p).toLowerCase());
  }
  return paths;
}

/**
 * Filter PR-with-paths records to those whose changed files include `path`.
 * Path matching is normalized + case-insensitive so leading/trailing-slash
 * and casing differences between the tree path and ADO's change paths don't
 * cause misses. Tolerates a missing list.
 */
export function prsTouchingPath<T extends { paths: readonly string[] }>(
  prs: readonly T[] | undefined | null,
  path: string,
): T[] {
  const key = normalizePath(path).toLowerCase();
  return (prs ?? []).filter((e) => e.paths.includes(key));
}

/**
 * Best-effort web URL for a PR. `webUrl` isn't always present on the REST
 * JSON, so fall back to a link constructed off `repo.webUrl`.
 */
export function buildPrUrl(
  repo: GitRepository,
  prId: number | undefined,
): string | undefined {
  if (typeof prId !== "number") return undefined;
  if (repo.webUrl) {
    return `${repo.webUrl.replace(/\/$/, "")}/pullrequest/${prId}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Concurrency primitive
// ---------------------------------------------------------------------------

/**
 * Run `worker` over `items` with at most `cap` promises in flight. Worker
 * errors propagate so callers decide how to surface them. Tiny semaphore,
 * intentionally not a library dependency.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  cap: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeCap = Math.max(1, Math.min(cap, items.length));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function pump(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]!);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < safeCap; w++) workers.push(pump());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Repo picker projection
// ---------------------------------------------------------------------------

/** Human-readable one-liner shown under a repo name in the picker. */
export function repoDescription(repo: GitRepository): string {
  const branch = stripRefsHeads(repo.defaultBranch) || "main";
  return `Default branch: ${branch}`;
}

/**
 * Project a raw `GitRepository` into a content-less `DocRepo` skeleton for the
 * picker. Root listing + PR routing are both deferred to `loadDetailsFor` on
 * selection (`detailsLoaded: false`) — the picker never needs a repo's
 * contents to list it.
 */
export function repoSkeleton(repo: GitRepository): DocRepo {
  return {
    id: repo.id,
    name: repo.name,
    description: repoDescription(repo),
    defaultBranch: stripRefsHeads(repo.defaultBranch) || "main",
    files: [],
    topLevelFolders: [],
    recentPr: null,
    detailsLoaded: false,
  };
}

/**
 * Normalize a picker filter for ADO's `filterContains`: trimmed, with blank
 * mapped to `undefined` so an empty box requests the unfiltered first page.
 */
export function normalizeRepoFilter(filter?: string): string | undefined {
  return filter?.trim() || undefined;
}
