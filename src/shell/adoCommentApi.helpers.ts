// Pure helpers extracted from `adoCommentApi.ts` so they can be unit-tested
// without the `azure-devops-extension-{api,sdk}` AMD bundles (which Node can't
// evaluate). `adoCommentApi.ts` re-exports these by name, so the production
// call shape is unchanged.

import type { PullRequestStatus } from "azure-devops-extension-api/Git";
import type {
  GitPullRequestCommentThread,
  Comment as AdoComment,
} from "azure-devops-extension-api/Git";
import type {
  Comment,
  CommentAuthor,
  CommentThread,
  DiffRange,
  MentionedIdentity,
  ReactionKind,
  TextQuoteAnchor,
  ThreadStatus,
} from "../types";
import { identityAvatarUrl } from "./adoGitData.helpers";
import {
  mergeMentionIdentities,
  normalizeIdentityGuid,
} from "../comments/mentions";

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
  if (!orgName) return null;
  const clean = [
    ...new Set(ids.map((i) => i.trim().toLowerCase()).filter(Boolean)),
  ];
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
    if (!entity || typeof entity !== "object") continue;
    const e = entity as {
      id?: unknown;
      providerDisplayName?: unknown;
      customDisplayName?: unknown;
    };
    const id = typeof e.id === "string" ? e.id.toLowerCase() : "";
    const name =
      (typeof e.providerDisplayName === "string" && e.providerDisplayName) ||
      (typeof e.customDisplayName === "string" && e.customDisplayName) ||
      "";
    if (id && name) byId.set(id, name);
  }
  for (const raw of requestedIds) {
    const name = byId.get(raw.trim().toLowerCase());
    if (name) out[raw] = { displayName: name };
  }
  return out;
}

/**
 * Reduce a display name to a 2-letter avatar fallback. Used in both
 * `authorFromAdo` and the identity-picker → suggestion adapter.
 */
export function initialsOf(name: string): string {
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

/**
 * Map ADO's `PullRequestStatus` enum to our string status. Numeric literals
 * are the SDK enum's runtime values (Abandoned=2, Completed=3), keeping this
 * file SDK-free at runtime while the parameter type stays type-checked.
 */
export function prStatusLabel(
  status: PullRequestStatus | undefined,
): "active" | "completed" | "abandoned" {
  switch (status) {
    case 3 /* Completed */:
      return "completed";
    case 2 /* Abandoned */:
      return "abandoned";
    default:
      return "active";
  }
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
    const ct = b.changeType ?? 0;
    const modStart = b.modifiedLineNumberStart ?? 0;
    const modCount = b.modifiedLinesCount ?? 0;
    const origStart = b.originalLineNumberStart ?? 0;
    const origCount = b.originalLinesCount ?? 0;

    if (ct === 1 /* Add */ && modCount > 0) {
      ranges.push({
        startLine: modStart,
        endLine: modStart + modCount - 1,
        kind: "added",
        linesAdded: modCount,
        linesDeleted: 0,
      });
    } else if (ct === 3 /* Edit */) {
      if (modCount > 0 && origCount === 0) {
        // An "edit" block that removed no original lines is really a pure
        // insertion — surface it as an addition (green) rather than an edit.
        ranges.push({
          startLine: modStart,
          endLine: modStart + modCount - 1,
          kind: "added",
          linesAdded: modCount,
          linesDeleted: 0,
        });
      } else if (modCount > 0) {
        ranges.push({
          startLine: modStart,
          endLine: modStart + modCount - 1,
          kind: "modified",
          originalStartLine: origStart,
          originalEndLine: origStart + origCount - 1,
          linesAdded: modCount,
          linesDeleted: origCount,
          ...(sliceOriginalLines(originalLines, origStart, origCount) !==
          undefined
            ? {
                originalText: sliceOriginalLines(
                  originalLines,
                  origStart,
                  origCount,
                ),
              }
            : {}),
        });
      } else {
        // Edit that left no modified lines behaves like a deletion.
        const at = Math.max(1, modStart);
        ranges.push(
          buildDeletedMarkerRange(at, origCount, originalLines, origStart),
        );
      }
    } else if (ct === 2 /* Delete */) {
      const at = Math.max(1, modStart);
      ranges.push(
        buildDeletedMarkerRange(at, origCount, originalLines, origStart),
      );
    }
  }
  return ranges;
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

// Thread/comment conversion. Numeric literals stand in for SDK enum values so
// the module stays loadable under Node:
//   CommentType:         Unknown=0, Text=1, CodeChange=2, System=3
//   CommentThreadStatus: Unknown=0, Active=1, Fixed=2, WontFix=3,
//                        Closed=4, ByDesign=5, Pending=6

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
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MentionedIdentity[] = [];
  for (const e of parsed) {
    const r = e as { id?: unknown; displayName?: unknown; avatarUrl?: unknown };
    if (typeof r?.id !== "string" || typeof r.displayName !== "string")
      continue;
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
export const ROOT_PARENT_COMMENT_ID = 0;
/**
 * `parentCommentId` ADO expects for a REPLY. ADO numbers a thread's comments
 * from 1, so a reply parents onto the root comment id `1` (not `0`).
 */
export const REPLY_PARENT_COMMENT_ID = 1;

/** ADO `CommentType.Text`. */
export const COMMENT_TYPE_TEXT = 1;

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
export function reactionClientMethod(
  add: boolean,
): "createLike" | "deleteLike" {
  return add ? "createLike" : "deleteLike";
}

/**
 * ADO's `properties` field round-trips through a wrapper of
 * `{ "$type": ..., "$value": ... }`. Reads tolerate the value either being
 * naked or wrapped.
 */
export function readProp(properties: unknown, key: string): unknown {
  if (!properties || typeof properties !== "object") return undefined;
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
  if (!rawImage) return undefined;
  return identityAvatarUrl({ id, imageUrl: selfImageUrl });
}

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

function adoCommentToLocal(c: AdoComment): Comment {
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
export function collectThreadIdentities(
  t: GitPullRequestCommentThread,
): MentionedIdentity[] {
  const map = (t as { identities?: Record<string, unknown> }).identities;
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
export function adoThreadToLocal(
  t: GitPullRequestCommentThread,
): CommentThread | null {
  if (t.isDeleted) return null;

  // Drop ADO system/auto threads (votes, reviewer changes, status updates,
  // ref updates) — they're commentType=System(3) and aren't review discussion.
  const comments = (t.comments ?? [])
    .filter((c) => !c.isDeleted && c.commentType !== 3 /* System */)
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
    mentionedIdentities.length > 0
      ? { ...thread, mentionedIdentities }
      : thread;

  // (1) Extension-authored thread with a stored text-quote anchor.
  const schema = readProp(t.properties, PROP_SCHEMA);
  const anchorJson = readProp(t.properties, PROP_ANCHOR);
  if (schema === SCHEMA_VERSION && typeof anchorJson === "string") {
    try {
      const anchor = JSON.parse(anchorJson) as TextQuoteAnchor;
      return withMentions({
        id,
        filePath: t.threadContext?.filePath ?? "",
        anchor,
        status,
        comments,
        origin: "extension",
      });
    } catch {
      // Malformed anchor — fall through and treat as a native thread so the
      // comment isn't silently lost.
    }
  }

  const ctx = t.threadContext;
  const filePath = ctx?.filePath ?? "";

  // (2) Native thread anchored to a file + diff line.
  if (filePath) {
    const startLine = ctx?.rightFileStart?.line ?? ctx?.leftFileStart?.line;
    const anchor: TextQuoteAnchor =
      typeof startLine === "number" && startLine > 0
        ? {
            exact: "",
            prefix: "",
            suffix: "",
            line: startLine,
            endLine:
              ctx?.rightFileEnd?.line ?? ctx?.leftFileEnd?.line ?? startLine,
          }
        : { exact: "", prefix: "", suffix: "" };
    return withMentions({
      id,
      filePath,
      anchor,
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
  const startLine =
    typeof anchor.line === "number" && anchor.line > 0 ? anchor.line : 1;
  const startOffset =
    typeof anchor.column === "number" && anchor.column > 0 ? anchor.column : 1;

  const rawEndLine =
    typeof anchor.endLine === "number" && anchor.endLine > 0
      ? anchor.endLine
      : startLine;
  const endLine = Math.max(startLine, rawEndLine);

  const rawEndOffset =
    typeof anchor.endColumn === "number" && anchor.endColumn > 0
      ? anchor.endColumn
      : startOffset;
  const endOffset =
    endLine === startLine ? Math.max(startOffset, rawEndOffset) : rawEndOffset;

  return {
    filePath,
    rightFileStart: { line: startLine, offset: startOffset },
    rightFileEnd: { line: endLine, offset: endOffset },
  };
}
