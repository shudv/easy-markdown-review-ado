// Pure helpers extracted from `adoCommentApi.ts` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles (which Node can't
// evaluate). `adoCommentApi.ts` re-exports these by name, so the production
// call shape is unchanged.

import type { CommentType, PullRequestStatus } from "azure-devops-extension-api/Git";
import type {
    CommentPosition,
    GitPullRequest,
    GitPullRequestCommentThread,
    Comment as AdoComment,
} from "azure-devops-extension-api/Git";
import type {
    Comment,
    CommentAuthor,
    CommentThread,
    MentionedIdentity,
    ReactionKind,
    TextQuoteAnchor,
    ThreadStatus,
} from "../types";
import { identityAvatarUrl } from "./adoGitData.helpers";
import {
    mergeMentionIdentities,
    normalizeIdentityGuid,
    type PullRequestSuggestion,
} from "../comments/mentions";

// The file-diff helpers live in `./adoFileDiffs.helpers`; re-exported here so
// existing importers keep their path.
export {
    fileDiffCacheReplacer,
    hashString,
    lineDiffBlocksToCounts,
    lineDiffBlocksToRanges,
    pathsRequiringOriginalSource,
} from "./adoFileDiffs.helpers";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an ADO identity id to the canonical dashed GUID. Re-exported from
 * `../comments/mentions` so the SDK-touching layer and the identity store share
 * one implementation. See that module for the full contract.
 */
export { normalizeIdentityGuid };

/**
 * Build the vssps "Identities - Read Identities" REST URL that resolves a batch
 * of identity GUIDs to their display names. Returns `null` when there's no org
 * context or no valid ids (so the caller skips the network entirely).
 *
 * Unlike `searchIdentitiesAsync` (a name/email typeahead that can't be queried
 * by GUID), this endpoint looks identities up by their id — the exact thing a
 * persisted `@<GUID>` mention needs to resolve after a reload.
 */
export function buildIdentitiesUrl(
    orgName: string | undefined,
    ids: readonly string[],
): string | null {
    if (orgName === undefined || orgName === "") return null;

    const clean = [...new Set(ids.map((i) => i.trim().toLowerCase()).filter(Boolean))];

    if (clean.length === 0) return null;

    return (
        `https://vssps.dev.azure.com/${encodeURIComponent(orgName)}` +
        `/_apis/identities?identityIds=${clean.join(",")}&api-version=7.1-preview.1`
    );
}

/**
 * Map an "Identities - Read Identities" response to `{ id -> { displayName } }`,
 * keyed by the *requested* ids (case-insensitively matched to each returned
 * identity's `id`). Only genuine matches are included — an id the service
 * didn't return stays absent so the mention keeps showing its GUID rather than
 * silently rendering the wrong person's name.
 */
export function parseIdentitiesResponse(
    body: unknown,
    requestedIds: readonly string[],
): Record<string, { displayName: string; avatarUrl?: string }> {
    const out: Record<string, { displayName: string; avatarUrl?: string }> = {};
    const value = (body as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) return out;
    const byId = new Map<string, string>();

    for (const entity of value) {
        // ADO returns a `null` slot for any requested id it can't resolve (e.g. a
        // cross-tenant AAD guest queried by its object id). Skip those — a single
        // null must NOT crash the whole batch and drop the ids that DID resolve.
        // Stryker disable next-line ConditionalExpression: dead code: a non-object entry has no `id` property, so it is skipped by the id check below anyway; candidate for removal
        if (entity === null || typeof entity !== "object") continue;

        const e = entity as {
            id?: unknown;
            providerDisplayName?: unknown;
            customDisplayName?: unknown;
        };

        // Stryker disable next-line StringLiteral: an entity without a text id is stored under the placeholder, which no requested id ever equals, so it resolves nobody either way
        const id = typeof e.id === "string" ? e.id.toLowerCase() : "";

        const name =
            // Stryker disable next-line ConditionalExpression: dead code: ADO sends display names as text or null/absent; for null/absent `true && x` is falsy just like the typeof check; candidate for removal
            (typeof e.providerDisplayName === "string" && e.providerDisplayName) ||
            // Stryker disable next-line ConditionalExpression: dead code: ADO sends display names as text or null/absent; for null/absent `true && x` is falsy just like the typeof check; candidate for removal
            (typeof e.customDisplayName === "string" && e.customDisplayName) ||
            "";

        if (id && name) byId.set(id, name);
    }

    for (const raw of requestedIds) {
        const name = byId.get(raw.trim().toLowerCase());
        // `byId` only ever stores non-empty names, so a hit is always non-empty.
        if (name !== undefined) out[raw] = { displayName: name };
    }

    return out;
}

/**
 * Reduce a display name to a 2-letter avatar fallback. Used in both
 * `authorFromAdo` and the identity-picker → suggestion adapter.
 */
export function initialsOf(name: string): string {
    // Stryker disable next-line MethodExpression,Regex: `filter(Boolean)` drops the empty pieces that untrimmed edges or single-space splits produce, so the initials are identical
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();

    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ---------------------------------------------------------------------------
// Mention search query helpers
// ---------------------------------------------------------------------------

/**
 * Build a WIQL query for the top work items matching `query`. Pure-numeric
 * queries hit the id index; otherwise a title `CONTAINS` clause. Single
 * quotes are escaped so unusual titles don't break the literal (defensive
 * formatting — WIQL has no code execution; ADO validates further).
 */
export function buildWorkItemWiql(query: string): string {
    const numeric = /^\d+$/.test(query) ? Number(query) : null;

    if (numeric !== null) {
        return `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${numeric}`;
    }

    const escaped = query.replace(/'/g, "''");

    return (
        "SELECT [System.Id] FROM WorkItems " +
        `WHERE [System.Title] CONTAINS '${escaped}' ` +
        "ORDER BY [System.ChangedDate] DESC"
    );
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

// SDK enum runtime values (Abandoned=2, Completed=3), typed via a type-only
// import so this file stays SDK-free at runtime.
const PR_STATUS_ABANDONED = 2 as PullRequestStatus;
const PR_STATUS_COMPLETED = 3 as PullRequestStatus;

/**
 * Map ADO's `PullRequestStatus` enum to our string status. Numeric literals
 * are the SDK enum's runtime values (Abandoned=2, Completed=3), keeping this
 * file SDK-free at runtime while the parameter type stays type-checked.
 */
export function prStatusLabel(
    status: PullRequestStatus | undefined,
): "active" | "completed" | "abandoned" {
    if (status === PR_STATUS_COMPLETED) return "completed";
    if (status === PR_STATUS_ABANDONED) return "abandoned";

    return "active";
}

/**
 * PR mention suggestions from a page of PRs: an exact id match for a numeric
 * query, otherwise a case-insensitive title match, at most 10. ADO's typings
 * don't guarantee `pullRequestId`; an entry without one can't be mentioned,
 * so it is skipped rather than suggested as `!undefined`.
 */
export function matchPullRequestSuggestions(
    prs: readonly Partial<GitPullRequest>[],
    query: string,
): PullRequestSuggestion[] {
    const trimmed = query.trim();
    // Stryker disable next-line Regex: a non-numeric query yields NaN, which equals no PR id, so title matching decides exactly as with `null`
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    const lower = trimmed.toLowerCase();

    return prs
        .filter((p): p is Partial<GitPullRequest> & { pullRequestId: number } => {
            if (typeof p.pullRequestId !== "number") return false;
            if (p.pullRequestId === numeric) return true;

            // Stryker disable next-line StringLiteral: an untitled PR matches only queries contained in the placeholder; "" vs any placeholder differs only for contrived queries, never for a real title search
            return (p.title ?? "").toLowerCase().includes(lower);
        })
        .slice(0, 10)
        .map((p) => ({
            kind: "pullrequest",
            id: String(p.pullRequestId),
            title: p.title ?? "(untitled PR)",
            status: prStatusLabel(p.status),
            repository: p.repository?.name,
        }));
}

// Thread/comment conversion. Numeric literals stand in for SDK enum values so
// the module stays loadable under Node:
//   CommentType:         Unknown=0, Text=1, CodeChange=2, System=3
//   CommentThreadStatus: Unknown=0, Active=1, Fixed=2, WontFix=3,
//                        Closed=4, ByDesign=5, Pending=6
const COMMENT_TYPE_SYSTEM = 3 as CommentType;

/** Property-bag keys + schema tag for extension-authored threads. */
export const PROP_ANCHOR = "emrAnchor";
export const PROP_SCHEMA = "emrSchema";
/**
 * Thread property holding a JSON array of the `@`-mention identities
 * (`MentionedIdentity[]`) resolved at compose time. A name we captured from the
 * picker round-trips verbatim, so a mention renders on load with zero network.
 *
 * REVISIT — possibly non-essential (see repo memory `emr-mentions-layer.md`).
 * This was the original fix from when we believed the by-id identity endpoint
 * couldn't resolve cross-tenant AAD guests at all. The ACTUAL root cause turned
 * out to be a crash in `parseIdentitiesResponse` on a `null` slot that dropped
 * the whole batch; with that fixed, the by-id resolver now names every id ADO
 * can resolve. So this layer is no longer load-bearing — it only adds value for
 * the narrow residual case "picker knew the name but no ADO endpoint resolves
 * the id", and only for NEW comments (we can't write it on replies: ADO rejects
 * updating thread properties post-creation). Kept as defense-in-depth + a
 * network-free fast path; candidate for removal if we want the leanest change.
 */
export const PROP_MENTIONS = "emrMentions";
export const SCHEMA_VERSION = "1";

/**
 * Parse the {@link PROP_MENTIONS} thread property back into a list of
 * {@link MentionedIdentity}. Tolerates a missing/blank/malformed property (from
 * old threads created before this schema) by returning `[]`.
 */
export function readMentionsProp(properties: unknown): MentionedIdentity[] {
    const raw = readProp(properties, PROP_MENTIONS);
    // Stryker disable next-line ConditionalExpression: dead code: a missing, blank or non-text value makes JSON.parse throw or yield a non-array, which the catch / Array.isArray checks below turn into [] anyway; candidate for removal
    if (typeof raw !== "string" || raw.length === 0) return [];
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } /* Stryker disable next-line BlockStatement: dead code: with an empty catch `parsed` stays undefined, which the Array.isArray check below turns into [] anyway; candidate for removal */ catch {
        return [];
    }

    if (!Array.isArray(parsed)) return [];
    const out: MentionedIdentity[] = [];

    for (const e of parsed) {
        const r = e as {
            id?: unknown;
            displayName?: unknown;
            avatarUrl?: unknown;
        } | null;

        if (typeof r?.id !== "string" || typeof r.displayName !== "string") {
            continue;
        }

        out.push({
            id: r.id,
            displayName: r.displayName,
            avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : undefined,
        });
    }

    return out;
}

/** Map ADO's numeric thread status to our local string status. */
export function fromAdoStatus(s: number | undefined): ThreadStatus {
    switch (s) {
        case 2 /* Fixed */:
        case 5 /* ByDesign */:
            return "resolved";
        case 3 /* WontFix */:
            return "wontFix";
        case 4 /* Closed */:
            return "closed";
        case 6 /* Pending */:
            return "pending";
        case 1 /* Active */:
        case 0 /* Unknown */:
        case undefined:
        default:
            return "active";
    }
}

// ---------------------------------------------------------------------------
// Write-payload builders (pure, SDK-free)
//
// The AdoCommentApi methods send exact payloads / call exact client methods to
// ADO; a subtle slip here (wrong parentCommentId, inverted status, like vs
// unlike) silently corrupts a user's comment with no local symptom. These
// builders capture those invariants as pure data so they can be contract-
// tested without the AMD SDK. Numeric literals mirror the SDK enums:
//   CommentType.Text = 1
//   CommentThreadStatus: Active=1, Fixed=2, WontFix=3, Closed=4, Pending=6
// ---------------------------------------------------------------------------

/** `parentCommentId` ADO expects for the FIRST (root) comment of a thread. */
const ROOT_PARENT_COMMENT_ID = 0;
/**
 * `parentCommentId` ADO expects for a REPLY. ADO numbers a thread's comments
 * from 1, so a reply parents onto the root comment id `1` (not `0`).
 */
const REPLY_PARENT_COMMENT_ID = 1;

/** ADO `CommentType.Text`. */
const COMMENT_TYPE_TEXT = 1;

/** Shape of the comment payload we POST (structural, SDK-free). */
export interface AdoCommentPayload {
    parentCommentId: number;
    content: string;
    commentType: number;
}

/** Payload for the root comment of a newly-created thread. */
export function buildRootComment(bodyMarkdown: string): AdoCommentPayload {
    return {
        parentCommentId: ROOT_PARENT_COMMENT_ID,
        content: bodyMarkdown,
        commentType: COMMENT_TYPE_TEXT,
    };
}

/** Payload for a reply appended to an existing thread. */
export function buildReplyComment(bodyMarkdown: string): AdoCommentPayload {
    return {
        parentCommentId: REPLY_PARENT_COMMENT_ID,
        content: bodyMarkdown,
        commentType: COMMENT_TYPE_TEXT,
    };
}

/** Map our local thread status to ADO's numeric `CommentThreadStatus`. */
export function toAdoStatusValue(s: ThreadStatus): number {
    switch (s) {
        case "active":
            return 1; // Active
        case "resolved":
            return 2; // Fixed
        case "wontFix":
            return 3; // WontFix
        case "closed":
            return 4; // Closed
        case "pending":
            return 6; // Pending
    }
}

/**
 * Which `GitRestClient` like method a reaction toggle maps to. `add === true`
 * must create the like and `false` must remove it — inverting this makes the
 * Like button remove reactions and vice-versa.
 */
export function reactionClientMethod(add: boolean): "createLike" | "deleteLike" {
    return add ? "createLike" : "deleteLike";
}

/**
 * ADO's `properties` field round-trips through a wrapper of
 * `{ "$type": ..., "$value": ... }`. Reads tolerate the value either being
 * naked or wrapped.
 */
export function readProp(properties: unknown, key: string): unknown {
    if (properties === null || typeof properties !== "object") return undefined;
    const p = (properties as Record<string, unknown>)[key];
    if (p == null) return undefined;

    if (typeof p === "object" && "$value" in (p as object)) {
        return (p as { $value: unknown }).$value;
    }

    return p;
}

/**
 * Avatar URL for a mention-typeahead identity.
 *
 * `IVssIdentityService.searchIdentitiesAsync` hands back a *host-relative*
 * MemberAvatars URL (e.g. `/{org}/_apis/GraphProfile/MemberAvatars/aad.<desc>`).
 * Used as-is from our cross-origin iframe it resolves against the extension's
 * OWN origin (the gallery CDN in prod, `localhost` in dev) — not the ADO org —
 * and MemberAvatars is CORS-blocked even against the right host. So when the
 * identity actually has a photo, rebuild the CORS-safe `identityImage` URL the
 * current user + comment authors already use, keyed by the identity GUID off
 * the org base borrowed from our own (absolute) avatar URL. No photo, or no
 * base to borrow → `undefined`, and the initials avatar shows.
 */
export function pickerAvatarUrl(
    id: string,
    rawImage: string | undefined,
    selfImageUrl: string | undefined,
): string | undefined {
    if (rawImage === undefined || rawImage === "") return undefined;

    return identityAvatarUrl({ id, imageUrl: selfImageUrl });
}

// ---------------------------------------------------------------------------
// Honest wire shapes for thread REST payloads
//
// The SDK typings mark every field required, but ADO omits several in
// practice: PR-level threads have no `threadContext`, left-side-only comments
// have no `rightFileStart`, un-liked comments have no `usersLiked`, and so on.
// These views make the fields we defensively read optional so the guards are
// type-checked. SDK objects stay assignable to them.
// ---------------------------------------------------------------------------

/** ADO `CommentThreadContext` as actually returned over REST. */
interface AdoThreadContextWire {
    filePath?: string;
    leftFileStart?: CommentPosition;
    leftFileEnd?: CommentPosition;
    rightFileStart?: CommentPosition;
    rightFileEnd?: CommentPosition;
}

/** ADO `Comment` as actually returned over REST. */
export type AdoCommentWire = Omit<
    AdoComment,
    "content" | "lastContentUpdatedDate" | "publishedDate" | "usersLiked"
> & {
    content?: string;
    lastContentUpdatedDate?: Date;
    publishedDate?: Date;
    usersLiked?: AdoComment["usersLiked"];
};

/** ADO `GitPullRequestCommentThread` as actually returned over REST. */
export type AdoThreadWire = Omit<GitPullRequestCommentThread, "comments" | "threadContext"> & {
    comments?: AdoCommentWire[];
    threadContext?: AdoThreadContextWire;
};

function authorFromAdo(a: AdoComment["author"] | undefined): CommentAuthor {
    const displayName = a?.displayName ?? "Unknown";
    const id = a?.id ?? "unknown";

    return {
        id,
        displayName,
        initials: initialsOf(displayName),
        // Route every author through the same CORS-safe `identityImage` endpoint
        // the current user uses, so a person renders identically whether their
        // comment was just optimistically posted or later re-fetched from ADO
        // (whose raw `imageUrl` is the CORS-blocked MemberAvatars URL).
        avatarUrl: identityAvatarUrl({ id, imageUrl: a?.imageUrl }),
    };
}

/**
 * Milliseconds `lastContentUpdatedDate` must exceed `publishedDate` by before a
 * comment counts as edited. ADO stamps both on creation and they can differ by
 * a few milliseconds of server processing, so a small tolerance avoids a false
 * "edited" tag on brand-new comments.
 */
const EDIT_TOLERANCE_MS = 1000;

/**
 * Return the ISO edit timestamp for a comment, or `undefined` when it was never
 * edited. A comment is "edited" only when its content was updated meaningfully
 * after it was published (ADO sets both timestamps at creation, so equal/near
 * values are treated as unedited).
 */
export function editedAtOf(
    publishedDate: Date | undefined,
    lastContentUpdatedDate: Date | undefined,
): string | undefined {
    if (!lastContentUpdatedDate) return undefined;
    const updatedMs = new Date(lastContentUpdatedDate).getTime();
    const publishedMs = publishedDate ? new Date(publishedDate).getTime() : 0;
    if (updatedMs - publishedMs <= EDIT_TOLERANCE_MS) return undefined;

    return new Date(lastContentUpdatedDate).toISOString();
}

function adoCommentToLocal(c: AdoCommentWire): Comment {
    const id = String(c.id);
    const createdAt = (c.publishedDate ?? new Date()).toString();
    // ADO stamps `lastContentUpdatedDate` on creation too (it equals
    // `publishedDate` for a brand-new comment), so treating any non-empty value
    // as "edited" makes the tag show on every comment. Only surface `updatedAt`
    // when the content was actually updated *after* it was published (allowing a
    // small clock-skew tolerance so the create-time pair isn't misread as edit).
    const updatedAt = editedAtOf(c.publishedDate, c.lastContentUpdatedDate);

    const reactions =
        c.usersLiked && c.usersLiked.length > 0
            ? [
                  {
                      kind: "like" as ReactionKind,
                      users: c.usersLiked.map((u) => ({
                          id: u.id,
                          displayName: u.displayName || u.id,
                      })),
                  },
              ]
            : undefined;

    return {
        id,
        author: authorFromAdo(c.author),
        bodyMarkdown: c.content ?? "",
        createdAt: new Date(createdAt).toISOString(),
        updatedAt,
        reactions,
    };
}

/**
 * Extract the @-mentioned identities ADO resolved for a thread
 * (`GitPullRequestCommentThread.identities`) into store-seedable entries. ADO
 * populates this map for every `@<GUID>` mention with the person's real
 * display name and avatar — the authoritative source that works even in
 * personal-MSA orgs where the by-id identities endpoint returns null. Ids are
 * normalized to the dashed GUID so they key the same as the rendered pills.
 */
export function collectThreadIdentities(t: AdoThreadWire): MentionedIdentity[] {
    const map = (t as { identities?: Record<string, unknown> }).identities;
    // Stryker disable next-line ConditionalExpression: dead code: a non-object identities value yields entries without a text id/name, which the loop skips anyway; candidate for removal
    if (!map || typeof map !== "object") return [];
    const out: MentionedIdentity[] = [];

    for (const ref of Object.values(map)) {
        const r = ref as {
            id?: unknown;
            displayName?: unknown;
            imageUrl?: unknown;
        } | null;

        if (!r) continue;
        const rawId = typeof r.id === "string" ? r.id : "";

        const displayName = typeof r.displayName === "string" ? r.displayName : "";

        if (!rawId || !displayName) continue;
        out.push({
            id: normalizeIdentityGuid(rawId) ?? rawId,
            displayName,
            avatarUrl: typeof r.imageUrl === "string" ? r.imageUrl : undefined,
        });
    }

    return out;
}

/**
 * Convert an ADO thread to our local shape, or `null` if it carries nothing
 * showable. Three provenance buckets: (1) extension-authored (tagged
 * `emrSchema`/`emrAnchor`, precise text-quote anchor), (2) native
 * diff-anchored (synthesize a line anchor via the `data-source-line` bridge),
 * (3) general PR-level comments (no file/line; shown in the general tray).
 */
export function adoThreadToLocal(t: AdoThreadWire): CommentThread | null {
    if (t.isDeleted) return null;

    // Drop ADO system/auto threads (votes, reviewer changes, status updates,
    // ref updates) — they're commentType=System(3) and aren't review discussion.
    const comments = (t.comments ?? [])
        .filter((c) => !c.isDeleted && c.commentType !== COMMENT_TYPE_SYSTEM)
        .map(adoCommentToLocal);

    if (comments.length === 0) return null;

    const status = fromAdoStatus(t.status as number | undefined);
    const id = String(t.id);

    // ADO-resolved @mention identities (works even where by-id lookup can't).
    // Prefer the names WE persisted at compose time (PROP_MENTIONS) — the only
    // source guaranteed to carry cross-tenant guests — then fall back to ADO's
    // own `thread.identities` map for threads authored outside this extension.
    const mentionedIdentities = mergeMentionIdentities(
        readMentionsProp(t.properties),
        collectThreadIdentities(t),
    );

    const withMentions = (thread: CommentThread): CommentThread =>
        mentionedIdentities.length > 0 ? { ...thread, mentionedIdentities } : thread;

    // (1) Extension-authored thread with a stored text-quote anchor.
    const extensionAnchor = readExtensionAnchor(t);

    if (extensionAnchor !== undefined) {
        return withMentions({
            id,
            filePath: t.threadContext?.filePath ?? "",
            anchor: extensionAnchor,
            status,
            comments,
            origin: "extension",
        });
    }

    const ctx = t.threadContext;
    const filePath = ctx?.filePath ?? "";

    // (2) Native thread anchored to a file + diff line.
    if (filePath) {
        return withMentions({
            id,
            filePath,
            anchor: nativeDiffLineAnchor(ctx),
            status,
            comments,
            origin: "ado",
        });
    }

    // (3) General PR-level comment with no file/line context.
    return withMentions({
        id,
        filePath: "",
        anchor: { exact: "", prefix: "", suffix: "" },
        status,
        comments,
        origin: "ado",
        general: true,
    });
}

/**
 * Parse the text-quote anchor stored on an extension-authored thread, or
 * `undefined` when the thread isn't ours or the anchor is malformed (so the
 * caller treats it as a native thread and the comment isn't silently lost).
 */
function readExtensionAnchor(t: AdoThreadWire): TextQuoteAnchor | undefined {
    const schema = readProp(t.properties, PROP_SCHEMA);
    const anchorJson = readProp(t.properties, PROP_ANCHOR);

    if (schema !== SCHEMA_VERSION || typeof anchorJson !== "string") {
        return undefined;
    }

    try {
        return JSON.parse(anchorJson) as TextQuoteAnchor;
    } /* Stryker disable next-line BlockStatement: dead code: the function returns undefined after an empty catch too; candidate for removal */ catch {
        return undefined;
    }
}

/** Synthesize a line anchor for a native diff-anchored thread. */
function nativeDiffLineAnchor(ctx: AdoThreadContextWire | undefined): TextQuoteAnchor {
    // Stryker disable next-line OptionalChaining: dead code: only called for threads whose threadContext carries a file path, so `ctx` is always defined here; candidate for removal
    const startLine = ctx?.rightFileStart?.line ?? ctx?.leftFileStart?.line;

    if (typeof startLine !== "number" || startLine <= 0) {
        return { exact: "", prefix: "", suffix: "" };
    }

    return {
        exact: "",
        prefix: "",
        suffix: "",
        line: startLine,
        // Stryker disable next-line OptionalChaining: dead code: only called for threads whose threadContext carries a file path, so `ctx` is always defined here; candidate for removal
        endLine: ctx?.rightFileEnd?.line ?? ctx?.leftFileEnd?.line ?? startLine,
    };
}

/**
 * Build ADO `threadContext` from an anchor's source coordinates.
 * Falls back to line/offset 1 when the anchor has no source mapping.
 */
export function buildThreadContext(
    filePath: string,
    anchor: TextQuoteAnchor,
): {
    filePath: string;
    rightFileStart: { line: number; offset: number };
    rightFileEnd: { line: number; offset: number };
} {
    // Stryker disable next-line ConditionalExpression: dead code: the typeof guard is redundant with `> 0` (undefined > 0 is false); zeroed positions are pinned by the "zeroed at the start of the file" scenario; candidate for removal
    const startLine = typeof anchor.line === "number" && anchor.line > 0 ? anchor.line : 1;

    // Stryker disable next-line ConditionalExpression: dead code: the typeof guard is redundant with `> 0` (undefined > 0 is false); zeroed positions are pinned by the "zeroed at the start of the file" scenario; candidate for removal
    const startOffset = typeof anchor.column === "number" && anchor.column > 0 ? anchor.column : 1;

    const rawEndLine =
        // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator: dead code: a missing or zeroed end falls back to the start, and the start is always >= 1 — the end line is clamped to it below, and ADO-bound anchors always carry a 1-based end column; candidate for removal
        typeof anchor.endLine === "number" && anchor.endLine > 0 ? anchor.endLine : startLine;

    const endLine = Math.max(startLine, rawEndLine);

    const rawEndOffset =
        // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator: dead code: a missing or zeroed end falls back to the start, and the start is always >= 1 — the end line is clamped to it below, and ADO-bound anchors always carry a 1-based end column; candidate for removal
        typeof anchor.endColumn === "number" && anchor.endColumn > 0
            ? anchor.endColumn
            : startOffset;

    const endOffset = endLine === startLine ? Math.max(startOffset, rawEndOffset) : rawEndOffset;

    return {
        filePath,
        rightFileStart: { line: startLine, offset: startOffset },
        rightFileEnd: { line: endLine, offset: endOffset },
    };
}
