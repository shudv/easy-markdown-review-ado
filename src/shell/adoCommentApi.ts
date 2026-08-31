// ADO adapter — converts between Azure DevOps's PR Threads API shapes and
// our local `CommentThread` / `CommentApi` types.
//
// Conventions we follow when persisting to ADO:
//   - Every emr-authored thread carries a JSON `TextQuoteAnchor` in
//     `properties.emrAnchor.$value` so we can re-resolve the anchor when
//     the file changes. ADO's native line/column `threadContext` is also
//     populated as a courtesy so the "Files" tab shows the thread on the
//     correct line, but the anchor remains the source of truth.
//   - `properties.emrSchema.$value = "1"` tags the thread as ours so we
//     can ignore non-emr threads in the rail (those still show up in the
//     ADO Overview tab).
//   - `commentType = Text`, `parentCommentId = 0` for the root comment.
//
// On read, threads are bucketed by provenance: extension-authored threads
// (tagged with `emrAnchor`) keep their precise text-quote anchor; threads
// created from ADO's native PR UI are surfaced too — diff-anchored ones are
// positioned via a synthesized line anchor (resolved against the rendered
// block's `data-source-line`), and general PR-level ("Overview") comments,
// which have no file/line context, land in the rail's general tray. ADO
// system threads (votes, reviewer/status changes) are filtered out.

import { getClient } from "azure-devops-extension-api";
import * as SDK from "azure-devops-extension-sdk";
import {
  GitRestClient,
  CommentThreadStatus,
  PullRequestStatus,
  GitVersionType,
  GitVersionOptions,
  type GitPullRequestCommentThread,
  type GitPullRequestSearchCriteria,
  type Comment as AdoComment,
} from "azure-devops-extension-api/Git";
import {
  WorkItemTrackingRestClient,
  type WorkItem,
} from "azure-devops-extension-api/WorkItemTracking";
import {
  IdentityServiceIds,
  type IIdentity,
  type IVssIdentityService,
} from "azure-devops-extension-api/Identities/IdentityService";

import type {
  CommentThread,
  DiffRange,
  ReactionKind,
  ThreadStatus,
} from "../types";
import { trackUserFacingError } from "../telemetry";
import type {
  CommentApi,
  CreatedThreadIds,
  NewThreadInput,
} from "../comments/api";
import type {
  PullRequestSuggestion,
  UserSuggestion,
  WorkItemSuggestion,
} from "../comments/mentions";
import { withRetry } from "./retry";
import { detectSessionRefreshing, ensureAdoSessionLive } from "./adoAuthToken";
import {
  adoThreadToLocal,
  buildReplyComment,
  buildRootComment,
  buildThreadContext,
  buildWorkItemWiql,
  buildIdentitiesUrl,
  fileDiffCacheReplacer,
  hashString,
  initialsOf,
  lineDiffBlocksToCounts,
  lineDiffBlocksToRanges,
  normalizeIdentityGuid,
  parseIdentitiesResponse,
  pickerAvatarUrl,
  pathsRequiringOriginalSource,
  prStatusLabel,
  reactionClientMethod,
  toAdoStatusValue,
  PROP_ANCHOR,
  PROP_MENTIONS,
  PROP_SCHEMA,
  SCHEMA_VERSION,
} from "./adoCommentApi.helpers";

// Re-export `adoThreadToLocal` (used by adoGitData's thread mapping) from the
// same place as the SDK-touching API surface.
export { adoThreadToLocal };

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Resolve the org name from the SDK host context. Returns `undefined` outside
 * the ADO iframe (tests, dev preview), so identity resolution skips the network.
 */
function getOrgName(): string | undefined {
  try {
    return SDK.getHost()?.name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The current user's own (absolute) avatar URL, used ONLY to borrow the ADO org
 * base when rewriting other identities' avatars — the identity typeahead hands
 * back a host-relative image URL that would otherwise resolve against the
 * extension iframe's origin. Returns `undefined` outside the iframe.
 */
function currentUserImageUrl(): string | undefined {
  try {
    return (SDK.getUser() as { imageUrl?: string }).imageUrl || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public: load all emr threads for a PR
// ---------------------------------------------------------------------------

export async function loadAdoThreads(
  repositoryId: string,
  pullRequestId: number,
  project: string,
): Promise<CommentThread[]> {
  const gitClient = getClient(GitRestClient);
  const raw = await withRetry(
    () => gitClient.getThreads(repositoryId, pullRequestId, project),
    { mode: "read", label: "loadAdoThreads.getThreads" },
  );
  const out: CommentThread[] = [];
  for (const t of raw) {
    const local = adoThreadToLocal(t);
    if (local) out.push(local);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CommentApi implementation
// ---------------------------------------------------------------------------

export interface AdoCommentApiContext {
  repositoryId: string;
  pullRequestId: number;
  project: string;
}

export class AdoCommentApi implements CommentApi {
  constructor(private readonly ctx: AdoCommentApiContext) {}

  private client(): GitRestClient {
    return getClient(GitRestClient);
  }

  /**
   * Guard every write attempt against the host token's ADO-grant dead window.
   * Re-inspect a caught auth failure too, covering the narrow race where the
   * grant lapses between preflight and the REST call.
   */
  private async write<T>(label: string, op: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(
        async () => {
          await ensureAdoSessionLive(() => SDK.getAccessToken());
          return op();
        },
        { mode: "write", label },
      );
    } catch (err) {
      const refreshing = await detectSessionRefreshing(err, () =>
        SDK.getAccessToken(),
      );
      throw refreshing ?? err;
    }
  }

  async createThread(input: NewThreadInput): Promise<CreatedThreadIds> {
    const { repositoryId, pullRequestId, project } = this.ctx;
    const threadInput: Partial<GitPullRequestCommentThread> = {
      status: CommentThreadStatus.Active,
      threadContext: buildThreadContext(
        input.filePath,
        input.anchor,
      ) as GitPullRequestCommentThread["threadContext"],
      comments: [buildRootComment(input.bodyMarkdown) as AdoComment],
      properties: {
        [PROP_SCHEMA]: { $type: "System.String", $value: SCHEMA_VERSION },
        [PROP_ANCHOR]: {
          $type: "System.String",
          $value: JSON.stringify(input.anchor),
        },
        // Persist the compose-time mention names so they resolve on load even
        // where ADO can't (cross-tenant guests / personal-MSA orgs).
        ...(input.mentions && input.mentions.length > 0
          ? {
              [PROP_MENTIONS]: {
                $type: "System.String",
                $value: JSON.stringify(input.mentions),
              },
            }
          : {}),
      },
    };
    const created = await this.write("createThread", () =>
      this.client().createThread(
        threadInput as GitPullRequestCommentThread,
        repositoryId,
        pullRequestId,
        project,
      ),
    );
    const firstComment = created.comments?.[0];
    if (!firstComment) {
      throw new Error("ADO createThread returned no comments");
    }
    return {
      threadId: String(created.id),
      firstCommentId: String(firstComment.id),
      createdAt: new Date(
        firstComment.publishedDate ?? Date.now(),
      ).toISOString(),
    };
  }

  async addReply(
    threadId: string,
    bodyMarkdown: string,
  ): Promise<{ commentId: string; createdAt: string }> {
    const { repositoryId, pullRequestId, project } = this.ctx;
    const created = await this.write("addReply", () =>
      this.client().createComment(
        buildReplyComment(bodyMarkdown) as AdoComment,
        repositoryId,
        pullRequestId,
        Number(threadId),
        project,
      ),
    );
    // A reply's `@<GUID>` mentions resolve on load via the identity resolver
    // (the token rides in the comment body). We intentionally do NOT persist
    // them onto the thread's emrMentions property: ADO rejects updating thread
    // properties after creation ("Comment thread properties cannot be
    // updated"). Only createThread — which sets properties at creation — carries
    // the persisted-name safety net.
    return {
      commentId: String(created.id),
      createdAt: new Date(created.publishedDate ?? Date.now()).toISOString(),
    };
  }

  async editComment(
    threadId: string,
    commentId: string,
    bodyMarkdown: string,
  ): Promise<{ updatedAt: string }> {
    const { repositoryId, pullRequestId, project } = this.ctx;
    const updated = await this.write("editComment", () =>
      this.client().updateComment(
        { content: bodyMarkdown } as AdoComment,
        repositoryId,
        pullRequestId,
        Number(threadId),
        Number(commentId),
        project,
      ),
    );
    return {
      updatedAt: new Date(
        updated.lastContentUpdatedDate ?? Date.now(),
      ).toISOString(),
    };
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    const { repositoryId, pullRequestId, project } = this.ctx;
    await this.write("deleteComment", () =>
      this.client().deleteComment(
        repositoryId,
        pullRequestId,
        Number(threadId),
        Number(commentId),
        project,
      ),
    );
  }

  async setStatus(threadId: string, status: ThreadStatus): Promise<void> {
    const { repositoryId, pullRequestId, project } = this.ctx;
    await this.write("setStatus", () =>
      this.client().updateThread(
        { status: toAdoStatusValue(status) } as GitPullRequestCommentThread,
        repositoryId,
        pullRequestId,
        Number(threadId),
        project,
      ),
    );
  }

  async toggleReaction(
    threadId: string,
    commentId: string,
    kind: ReactionKind,
    add: boolean,
  ): Promise<void> {
    // ADO PR comments only support `like`; this is the only kind we model.
    if (kind !== "like") return;
    const { repositoryId, pullRequestId, project } = this.ctx;
    // add → createLike, remove → deleteLike (locked by `reactionClientMethod`).
    const method = reactionClientMethod(add);
    await this.write(method, () =>
      this.client()[method](
        repositoryId,
        pullRequestId,
        Number(threadId),
        Number(commentId),
        project,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Mention typeahead
  //
  // Backed by three ADO services:
  //   - `@user`         → IVssIdentityService.searchIdentitiesAsync
  //   - `#workitem`     → WorkItemTrackingRestClient (WIQL + getWorkItems)
  //   - `!pullrequest`  → GitRestClient.getPullRequestsByProject
  //
  // Each method is best-effort: if the service throws (perms, transient
  // failure) we surface an empty list so the picker shows "No matches" and
  // report the visible degradation to reliability telemetry.
  // -------------------------------------------------------------------------

  async searchUsers(query: string): Promise<UserSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    try {
      const svc = await SDK.getService<IVssIdentityService>(
        IdentityServiceIds.IdentityService,
      );
      const results = await withRetry(
        () => svc.searchIdentitiesAsync(trimmed, ["user"]),
        { mode: "read", attempts: 2, label: "searchUsers" },
      );
      const selfImageUrl = currentUserImageUrl();
      return results.slice(0, 10).map((r) => toUserSuggestion(r, selfImageUrl));
    } catch (err) {
      console.warn("[adoCommentApi] searchUsers failed:", err);
      trackUserFacingError({
        error: err,
        source: "Composer.mentions",
        operation: "user-search",
        impact: "degraded",
      });
      return [];
    }
  }

  async resolveIdentities(
    ids: string[],
  ): Promise<Record<string, { displayName: string; avatarUrl?: string }>> {
    const empty: Record<string, { displayName: string; avatarUrl?: string }> =
      {};
    if (ids.length === 0) return empty;
    try {
      // Resolve GUIDs via the vssps "Read Identities" REST endpoint (lookup by
      // id). `searchIdentitiesAsync` is a name/email typeahead and can't be
      // queried by GUID, so a persisted `@<GUID>` mention only resolves here.
      const url = buildIdentitiesUrl(getOrgName(), ids);
      if (!url) return empty;
      const res = await withRetry(
        async () => {
          // Re-acquire the token per attempt. `SDK.getAccessToken()` is a fresh
          // host round-trip, but the host CACHES the token it mints, so a retry
          // only heals a true transient auth race — not the `ado_exp` dead window
          // (detected + recovered at app boot, see shell/adoAuthToken.ts), where
          // the host keeps replaying the same lapsed token.
          const token = await SDK.getAccessToken();
          const r = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });
          // Surface a status-bearing error so the retry classifier can decide
          // whether a non-2xx is transient (retry) or terminal (give up).
          if (!r.ok) {
            throw Object.assign(new Error(`identities HTTP ${r.status}`), {
              status: r.status,
              headers: r.headers,
            });
          }
          return r;
        },
        { mode: "read", label: "resolveIdentities.fetch" },
      );
      if (!res.ok) return empty;
      const body = (await res.json()) as unknown;
      return parseIdentitiesResponse(body, ids);
    } catch (err) {
      console.warn("[adoCommentApi] resolveIdentities failed:", err);
      return empty;
    }
  }

  async searchWorkItems(query: string): Promise<WorkItemSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const { project } = this.ctx;
    try {
      const client = getClient(WorkItemTrackingRestClient);
      const wiql = buildWorkItemWiql(trimmed);
      const result = await withRetry(
        () =>
          client.queryByWiql(
            { query: wiql },
            project,
            undefined,
            undefined,
            10,
          ),
        { mode: "read", attempts: 2, label: "searchWorkItems.queryByWiql" },
      );
      const ids = (result.workItems ?? [])
        .map((w) => w.id)
        .filter((id): id is number => typeof id === "number")
        .slice(0, 10);
      if (ids.length === 0) return [];
      const items = await withRetry(
        () =>
          client.getWorkItems(ids, project, [
            "System.Id",
            "System.Title",
            "System.WorkItemType",
            "System.State",
          ]),
        { mode: "read", attempts: 2, label: "searchWorkItems.getWorkItems" },
      );
      // Preserve WIQL ordering.
      const byId = new Map<number, WorkItem>();
      for (const w of items) {
        if (typeof w.id === "number") byId.set(w.id, w);
      }
      const ordered: WorkItem[] = [];
      for (const id of ids) {
        const w = byId.get(id);
        if (w) ordered.push(w);
      }
      return ordered.map(toWorkItemSuggestion);
    } catch (err) {
      console.warn("[adoCommentApi] searchWorkItems failed:", err);
      trackUserFacingError({
        error: err,
        source: "Composer.mentions",
        operation: "work-item-search",
        impact: "degraded",
      });
      return [];
    }
  }

  async searchPullRequests(query: string): Promise<PullRequestSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    // Skip the network round-trip for short non-numeric queries. The
    // typeahead fires on every keystroke; a single character would
    // match too many recent PRs to be useful anyway, and pulling a
    // 50-PR page on each keystroke is wasteful. Pure-numeric input is
    // exempted because `42` is already a meaningful PR-id lookup.
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    if (numeric === null && trimmed.length < 2) return [];
    const { project } = this.ctx;
    try {
      const client = this.client();
      // ADO's `getPullRequestsByProject` doesn't accept a `title` filter
      // server-side, so we pull a small page of the latest active PRs
      // and filter by title client-side. This mirrors what the in-line
      // PR picker in the native comments UI does — the typeahead in
      // real ADO is also client-filtered against a recent window.
      const criteria: GitPullRequestSearchCriteria = {
        status: PullRequestStatus.Active,
      } as GitPullRequestSearchCriteria;
      const prs = await withRetry(
        () =>
          client.getPullRequestsByProject(project, criteria, undefined, 0, 50),
        { mode: "read", attempts: 2, label: "searchPullRequests" },
      );
      const lower = trimmed.toLowerCase();
      const matches = prs.filter((p) => {
        if (numeric !== null && p.pullRequestId === numeric) return true;
        const t = (p.title ?? "").toLowerCase();
        return t.includes(lower);
      });
      return matches.slice(0, 10).map(
        (p): PullRequestSuggestion => ({
          kind: "pullrequest",
          id: String(p.pullRequestId),
          title: p.title ?? "(untitled PR)",
          status: prStatusLabel(p.status),
          repository: p.repository?.name,
        }),
      );
    } catch (err) {
      console.warn("[adoCommentApi] searchPullRequests failed:", err);
      trackUserFacingError({
        error: err,
        source: "Composer.mentions",
        operation: "pull-request-search",
        impact: "degraded",
      });
      return [];
    }
  }
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
 */
export async function fetchFileDiffs(
  repositoryId: string,
  project: string,
  baseCommit: string,
  targetCommit: string,
  paths: string[],
): Promise<Record<string, FileDiffInfo>> {
  if (paths.length === 0) return {};
  const cacheKey = buildLineCountsCacheKey(
    project,
    repositoryId,
    baseCommit,
    targetCommit,
    paths,
  );
  const cached = readLineCountsCache(cacheKey);
  if (cached) {
    const pathsToHydrate = pathsRequiringOriginalSource(cached);
    if (pathsToHydrate.length === 0) return cached;
    const gitClient = getClient(GitRestClient);
    await Promise.all(
      pathsToHydrate.map(async (path) => {
        const originalLines = await fetchOriginalLines(
          gitClient,
          repositoryId,
          project,
          baseCommit,
          path,
        );
        if (originalLines)
          cached[path]!.originalSource = originalLines.join("\n");
      }),
    );
    return cached;
  }

  const gitClient = getClient(GitRestClient);
  const diffs = await withRetry(
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
      originalLines = await fetchOriginalLines(
        gitClient,
        repositoryId,
        project,
        baseCommit,
        d.path,
      );
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
 * Fetch a file's text at a specific commit and split it into lines. Used to
 * recover the removed prose that ADO's `getFileDiffs` omits. Returns
 * `undefined` on any failure so diff decoration degrades gracefully.
 */
async function fetchOriginalLines(
  gitClient: GitRestClient,
  repositoryId: string,
  project: string,
  commitId: string,
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
            version: commitId,
            versionType: GitVersionType.Commit,
            versionOptions: GitVersionOptions.None,
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

/** Per-file diff summary: aggregate counts plus inline `DiffRange[]`. */
export interface FileDiffInfo {
  linesAdded: number;
  linesDeleted: number;
  /** Complete Markdown source at the diff base commit, when fetched. */
  originalSource?: string;
  ranges: DiffRange[];
}

// `sessionStorage` cache for `fetchFileDiffs`. Same iteration = same
// commit SHAs = same cache key, so a re-load of the PR tab in the same
// session skips the (potentially slow) `getFileDiffs` round-trip.
const LINE_COUNTS_CACHE_PREFIX = "emr:fileDiffs:v6:";

function buildLineCountsCacheKey(
  project: string,
  repositoryId: string,
  baseCommit: string,
  targetCommit: string,
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
    if (!raw) return null;
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

// Tiny non-cryptographic string hash so the cache key stays a sensible
// size even for repos with hundreds of paths. Collisions only mean we
// might serve stale data; the commit-SHA portion of the key is the real
// identity guard. Implementation lives in `./adoCommentApi.helpers`.

// ---------------------------------------------------------------------------
// Mention typeahead — shape adapters
// ---------------------------------------------------------------------------

/**
 * `IIdentity` only declares 4 fields (`entityId/entityType/originDirectory/originId`)
 * in the SDK typings, but the runtime payload carries far more (displayName,
 * mail, image, signInAddress, …). We pull what we need defensively via an
 * extended view so the build still type-checks if the SDK ever tightens
 * the type later.
 */
interface IdentityRuntime extends IIdentity {
  displayName?: string;
  mail?: string;
  signInAddress?: string;
  image?: string;
  thumbnail?: string;
  /** The actual identity GUID (dashed). Present at runtime; not in the typings. */
  localId?: string;
}

function toUserSuggestion(
  raw: IIdentity,
  selfImageUrl?: string,
): UserSuggestion {
  const i = raw as IdentityRuntime;
  const displayName =
    i.displayName ?? i.signInAddress ?? i.mail ?? "(unknown user)";
  // ADO's native `@<GUID>` mention token — and comment authors — key off the
  // dashed identity GUID, but `entityId` is the storage-key form
  // `vss.ds.v1.ims.user.<32-hex>`. Prefer `localId` (already the GUID); else
  // extract the GUID embedded in `entityId`; fall back to `entityId` only if
  // no GUID can be found (mention won't resolve, but the picker still works).
  const id =
    normalizeIdentityGuid(i.localId) ??
    normalizeIdentityGuid(i.entityId) ??
    i.entityId;
  return {
    kind: "user",
    id,
    displayName,
    initials: initialsOf(displayName),
    secondary: i.mail ?? i.signInAddress,
    // NOT the raw `image`/`thumbnail`: that's a host-relative MemberAvatars URL
    // that resolves against the extension iframe's origin and is CORS-blocked.
    // Route it through the same `identityImage` endpoint authors use (see
    // `pickerAvatarUrl`), off the current user's org base.
    avatarUrl: pickerAvatarUrl(id, i.image ?? i.thumbnail, selfImageUrl),
  };
}

/**
 * Build a WIQL string that finds the top 10 work items whose ID or title
 * matches the user's query. Implementation lives in `./adoCommentApi.helpers`.
 */

function toWorkItemSuggestion(w: WorkItem): WorkItemSuggestion {
  const fields = (w.fields ?? {}) as Record<string, unknown>;
  const id = w.id ?? Number(fields["System.Id"] ?? 0);
  const title = String(fields["System.Title"] ?? "");
  const workItemType = String(fields["System.WorkItemType"] ?? "Work item");
  const state = String(fields["System.State"] ?? "");
  return {
    kind: "workitem",
    id: String(id),
    workItemType,
    title,
    state,
  };
}

/**
 * Map ADO's `PullRequestStatus` enum to our string status.
 * Implementation lives in `./adoCommentApi.helpers`.
 */
