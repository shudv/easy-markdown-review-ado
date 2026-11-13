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

import * as SDK from "azure-devops-extension-sdk";
import {
    type GitRestClient,
    CommentThreadStatus,
    PullRequestStatus,
    type GitPullRequest,
    type GitPullRequestCommentThread,
    type GitPullRequestSearchCriteria,
    type Comment as AdoComment,
} from "azure-devops-extension-api/Git";
import type { WorkItem, WorkItemQueryResult } from "azure-devops-extension-api/WorkItemTracking";
import {
    IdentityServiceIds,
    type IIdentity,
    type IVssIdentityService,
} from "azure-devops-extension-api/Identities/IdentityService";

import type { CommentThread, ReactionKind, ThreadStatus } from "../types";
import { trackUserFacingError, type HeldWriteKind } from "../telemetry";
import type { CommentApi, CreatedThreadIds, NewThreadInput } from "../comments/api";
import type {
    PullRequestSuggestion,
    UserSuggestion,
    WorkItemSuggestion,
} from "../comments/mentions";
import { t } from "../i18n";
import { withRetry } from "./retry";
import { withAdoSessionRefreshDetection } from "./adoAuthToken";
import { newLinkKey, splitBackLink, withBackLink } from "./backLink";
import { FailureStreaks } from "./failureStreaks";
import { adoSession } from "./adoSession";
import { readHostToken } from "./adoSessionSdk";
import {
    adoThreadToLocal,
    buildReplyComment,
    buildRootComment,
    buildThreadContext,
    buildWorkItemWiql,
    buildIdentitiesUrl,
    initialsOf,
    matchPullRequestSuggestions,
    normalizeIdentityGuid,
    parseIdentitiesResponse,
    pickerAvatarUrl,
    reactionClientMethod,
    toAdoStatusValue,
    PROP_ANCHOR,
    PROP_LINK_KEY,
    PROP_MENTIONS,
    PROP_SCHEMA,
    SCHEMA_VERSION,
    type AdoCommentWire,
    type AdoThreadWire,
} from "./adoCommentApi.helpers";
import { loadFileDiffs, type FileDiffInfo, type FileDiffQuery } from "./adoFileDiffs.helpers";
import { sharedGitClient, sharedWorkItemClient } from "./adoClients";

// Re-export `adoThreadToLocal` (used by adoGitData's thread mapping) from the
// same place as the SDK-touching API surface.
export { adoThreadToLocal };
export type { FileDiffInfo };

/** ADO numbers a thread's comments from 1: the root (first) comment is "1". */
const ROOT_COMMENT_ID = "1";

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/** `s`, or `undefined` when it is missing or empty. */
function nonEmpty(s: string | undefined): string | undefined {
    return s === undefined || s === "" ? undefined : s;
}

/**
 * Resolve the org name from the SDK host context. Returns `undefined` outside
 * the ADO iframe (tests, dev preview), so identity resolution skips the network.
 */
function getOrgName(): string | undefined {
    try {
        // `getHost` throws (caught below) before `init`; once ready it returns the
        // handshake's host context.
        return nonEmpty(SDK.getHost().name);
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
        return nonEmpty((SDK.getUser() as { imageUrl?: string }).imageUrl);
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Public: load all emr threads for a PR
// ---------------------------------------------------------------------------

/**
 * Read a PR's raw threads, with the token dead window classified inside the
 * retry so it isn't spent on futile 401s (`SessionRefreshingError` is
 * non-retryable), and so pollers can pause until its `recoverAtMs` instead of
 * re-polling every 30s. The shared session monitor learns about the spell (and
 * its end) from here. Rejects on failure — callers decide how to degrade.
 */
export async function readPrThreads(
    repositoryId: string,
    pullRequestId: number,
    project: string,
    label: string,
): Promise<GitPullRequestCommentThread[]> {
    const gitClient = sharedGitClient();
    let raw: GitPullRequestCommentThread[];
    const startedAt = Date.now();

    try {
        raw = await withRetry(
            () =>
                withAdoSessionRefreshDetection(
                    () => gitClient.getThreads(repositoryId, pullRequestId, project),
                    readHostToken,
                ),
            { mode: "read", label },
        );
    } catch (err) {
        adoSession.report(err, "poll");
        throw err;
    }

    adoSession.noteSuccess(startedAt);

    return raw;
}

export async function loadAdoThreads(
    repositoryId: string,
    pullRequestId: number,
    project: string,
): Promise<CommentThread[]> {
    const raw = await readPrThreads(
        repositoryId,
        pullRequestId,
        project,
        "loadAdoThreads.getThreads",
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
    /**
     * Where a thread started here can be read in Markdown Review, with that
     * thread selected via its `linkKey` — appended as a "Markdown Review | open ↗"
     * badge that only ADO's own comment UI shows (see `backLink.ts`). Omitted:
     * no badge.
     */
    backLinkFor?: (thread: { filePath: string; linkKey: string }) => string | undefined;
}

export class AdoCommentApi implements CommentApi {
    private readonly searchFailures = new FailureStreaks();

    constructor(private readonly ctx: AdoCommentApiContext) {}

    private client(): GitRestClient {
        return sharedGitClient();
    }

    /**
     * Re-inspect caught auth failures for the host token's ADO-grant dead window.
     * The operation must reject first: JWT timestamps alone are not authoritative
     * enough to block a write that Azure DevOps may still accept. A write the
     * dead window rejects is held until the session is live again and retried
     * once (see `adoSession.holdWrite`), instead of failing outright.
     */
    private async write<T>(kind: HeldWriteKind, label: string, op: () => Promise<T>): Promise<T> {
        return adoSession.holdWrite(kind, () =>
            withRetry(() => withAdoSessionRefreshDetection(op, readHostToken), {
                mode: "write",
                label,
            }),
        );
    }

    async createThread(input: NewThreadInput): Promise<CreatedThreadIds> {
        const { repositoryId, pullRequestId, project } = this.ctx;
        const linkKey = newLinkKey();
        const backLink = this.ctx.backLinkFor?.({ filePath: input.filePath, linkKey });

        const threadInput: Partial<GitPullRequestCommentThread> = {
            status: CommentThreadStatus.Active,
            threadContext: buildThreadContext(
                input.filePath,
                input.anchor,
            ) as GitPullRequestCommentThread["threadContext"],
            comments: [buildRootComment(withBackLink(input.bodyMarkdown, backLink)) as AdoComment],
            properties: {
                [PROP_SCHEMA]: {
                    $type: "System.String",
                    $value: SCHEMA_VERSION,
                },
                [PROP_ANCHOR]: {
                    $type: "System.String",
                    $value: JSON.stringify(input.anchor),
                },
                ...(backLink !== undefined
                    ? { [PROP_LINK_KEY]: { $type: "System.String", $value: linkKey } }
                    : {}),
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

        const created: AdoThreadWire = await this.write("create", "createThread", () =>
            this.client().createThread(
                threadInput as GitPullRequestCommentThread,
                repositoryId,
                pullRequestId,
                project,
            ),
        );

        const firstComment: AdoCommentWire | undefined = created.comments?.[0];

        if (!firstComment) {
            throw new Error("ADO createThread returned no comments");
        }

        return {
            threadId: String(created.id),
            firstCommentId: String(firstComment.id),
            createdAt: new Date(firstComment.publishedDate ?? Date.now()).toISOString(),
        };
    }

    async addReply(
        threadId: string,
        bodyMarkdown: string,
    ): Promise<{ commentId: string; createdAt: string }> {
        const { repositoryId, pullRequestId, project } = this.ctx;

        const created: AdoCommentWire = await this.write("reply", "addReply", () =>
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

        const updated: AdoCommentWire = await this.write("edit", "editComment", async () => {
            // The app shows the comment without its back link; keep the link on
            // save. Read inside the write so it is held and retried with it.
            const footer = await this.backLinkFooter(threadId, commentId);

            return this.client().updateComment(
                { content: bodyMarkdown + footer } as AdoComment,
                repositoryId,
                pullRequestId,
                Number(threadId),
                Number(commentId),
                project,
            );
        });

        return {
            updatedAt: new Date(updated.lastContentUpdatedDate ?? Date.now()).toISOString(),
        };
    }

    /**
     * The back-link badge a thread's root comment carries in ADO, or "". Only
     * root comments of threads started here have one.
     */
    private async backLinkFooter(threadId: string, commentId: string): Promise<string> {
        if (commentId !== ROOT_COMMENT_ID) return "";
        const { repositoryId, pullRequestId, project } = this.ctx;

        const current: AdoCommentWire = await this.client().getComment(
            repositoryId,
            pullRequestId,
            Number(threadId),
            Number(commentId),
            project,
        );

        return splitBackLink(current.content ?? "").footer;
    }

    async deleteComment(threadId: string, commentId: string): Promise<void> {
        const { repositoryId, pullRequestId, project } = this.ctx;
        await this.write("delete", "deleteComment", () =>
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
        await this.write("status", "setStatus", () =>
            this.client().updateThread(
                {
                    status: toAdoStatusValue(status),
                } as GitPullRequestCommentThread,
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
        // ADO PR comments only support `like`, the only `ReactionKind` we model.
        _kind: ReactionKind,
        add: boolean,
    ): Promise<void> {
        const { repositoryId, pullRequestId, project } = this.ctx;
        // add → createLike, remove → deleteLike (locked by `reactionClientMethod`).
        const method = reactionClientMethod(add);
        await this.write("reaction", method, () =>
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

        return this.mentionSearch("user-search", "searchUsers", async () => {
            const svc = await SDK.getService<IVssIdentityService>(
                IdentityServiceIds.IdentityService,
            );

            const results = await withRetry(() => svc.searchIdentitiesAsync(trimmed, ["user"]), {
                mode: "read",
                attempts: 2,
                label: "searchUsers",
            });

            const selfImageUrl = currentUserImageUrl();

            return results.slice(0, 10).map((r) => toUserSuggestion(r, selfImageUrl));
        });
    }

    async resolveIdentities(
        ids: string[],
    ): Promise<Record<string, { displayName: string; avatarUrl?: string }>> {
        const empty: Record<string, { displayName: string; avatarUrl?: string }> = {};

        if (ids.length === 0) return empty;

        try {
            // Resolve GUIDs via the vssps "Read Identities" REST endpoint (lookup by
            // id). `searchIdentitiesAsync` is a name/email typeahead and can't be
            // queried by GUID, so a persisted `@<GUID>` mention only resolves here.
            const url = buildIdentitiesUrl(getOrgName(), ids);
            if (url === null) return empty;

            const res = await withRetry(
                async () => {
                    // Re-acquire the token per attempt. `SDK.getAccessToken()` is a fresh
                    // host round-trip, but the host CACHES the token it mints, so a retry
                    // only heals a true transient auth race — not the `ado_exp` dead window
                    // where the host keeps replaying the same lapsed token.
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
        const wiql = buildWorkItemWiql(trimmed);
        if (wiql === null) return [];
        const { project } = this.ctx;

        return this.mentionSearch("work-item-search", "searchWorkItems", async () => {
            const client = sharedWorkItemClient();

            const result: Partial<WorkItemQueryResult> = await withRetry(
                () => client.queryByWiql({ query: wiql }, project, undefined, undefined, 10),
                {
                    mode: "read",
                    attempts: 2,
                    label: "searchWorkItems.queryByWiql",
                },
            );

            const ids = (result.workItems ?? [])
                .map((w) => w.id)
                .filter((id): id is number => typeof id === "number")
                .slice(0, 10);

            if (ids.length === 0) return [];

            const items: Partial<WorkItem>[] = await withRetry(
                () =>
                    client.getWorkItems(ids, project, [
                        "System.Id",
                        "System.Title",
                        "System.WorkItemType",
                        "System.State",
                    ]),
                {
                    mode: "read",
                    attempts: 2,
                    label: "searchWorkItems.getWorkItems",
                },
            );

            // Preserve WIQL ordering.
            const byId = new Map<number, Partial<WorkItem>>();

            for (const w of items) {
                if (typeof w.id === "number") byId.set(w.id, w);
            }

            const ordered: Partial<WorkItem>[] = [];

            for (const id of ids) {
                const w = byId.get(id);
                if (w) ordered.push(w);
            }

            return ordered.map(toWorkItemSuggestion);
        });
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

        return this.mentionSearch("pull-request-search", "searchPullRequests", async () => {
            const client = this.client();

            // ADO's `getPullRequestsByProject` doesn't accept a `title` filter
            // server-side, so we pull a small page of the latest active PRs
            // and filter by title client-side. This mirrors what the in-line
            // PR picker in the native comments UI does — the typeahead in
            // real ADO is also client-filtered against a recent window.
            const criteria: GitPullRequestSearchCriteria = {
                status: PullRequestStatus.Active,
            } as GitPullRequestSearchCriteria;

            const prs: Partial<GitPullRequest>[] = await withRetry(
                () => client.getPullRequestsByProject(project, criteria, undefined, 0, 50),
                { mode: "read", attempts: 2, label: "searchPullRequests" },
            );

            return matchPullRequestSuggestions(prs, trimmed);
        });
    }

    /**
     * Run a mention typeahead lookup. Best-effort: a failure shows "No matches"
     * and is reported once per failure streak — the typeahead re-runs on every
     * keystroke, so a service that keeps failing must not report each one.
     */
    private async mentionSearch<T>(
        operation: string,
        label: string,
        run: () => Promise<T[]>,
    ): Promise<T[]> {
        try {
            const out = await run();
            this.searchFailures.succeed(operation);

            return out;
        } catch (err) {
            console.warn(`[adoCommentApi] ${label} failed:`, err);

            if (this.searchFailures.fail(operation)) {
                trackUserFacingError({
                    error: err,
                    source: "Composer.mentions",
                    operation,
                    impact: "degraded",
                });
            }

            return [];
        }
    }
}

// ---------------------------------------------------------------------------
// File diffs (per-file linesAdded / linesDeleted + inline DiffRange[])
// ---------------------------------------------------------------------------

/**
 * Per-file diff data (aggregate counts + inline `DiffRange[]`) for `paths`,
 * cached per iteration in `sessionStorage`. See {@link loadFileDiffs}.
 */
export function fetchFileDiffs(
    diff: FileDiffQuery,
    paths: string[],
): Promise<Record<string, FileDiffInfo>> {
    return loadFileDiffs(diff, paths, sharedGitClient);
}

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

function toUserSuggestion(raw: IIdentity, selfImageUrl?: string): UserSuggestion {
    const i = raw as IdentityRuntime;

    const displayName =
        i.displayName ?? i.signInAddress ?? i.mail ?? t("comments.author.unknownUser");

    // ADO's native `@<GUID>` mention token — and comment authors — key off the
    // dashed identity GUID, but `entityId` is the storage-key form
    // `vss.ds.v1.ims.user.<32-hex>`. Prefer `localId` (already the GUID); else
    // extract the GUID embedded in `entityId`; fall back to `entityId` only if
    // no GUID can be found (mention won't resolve, but the picker still works).
    const id = normalizeIdentityGuid(i.localId) ?? normalizeIdentityGuid(i.entityId) ?? i.entityId;

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

function stringField(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function toWorkItemSuggestion(w: Partial<WorkItem>): WorkItemSuggestion {
    const fields = (w.fields ?? {}) as Record<string, unknown>;
    const id = w.id ?? Number(fields["System.Id"] ?? 0);
    const title = stringField(fields["System.Title"], "");

    const workItemType = stringField(fields["System.WorkItemType"], "Work item");

    const state = stringField(fields["System.State"], "");

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
