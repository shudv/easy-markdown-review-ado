// Shared domain types — mirror ADO's PR / Thread / Comment shape so we can
// later swap fixture data for real `GitRestClient` calls with a small adapter.

export type ChangeType = "added" | "modified" | "renamed" | "deleted";

export interface FileInfo {
  path: string;
  changeType: ChangeType;
  renamedFrom?: string;
  /** Total lines added in this PR for this file. Drives change-bar tooltip. */
  linesAdded: number;
  /** Total lines deleted in this PR for this file. */
  linesDeleted: number;
}

export interface PrInfo {
  prId: number;
  title: string;
  authorName: string;
  files: FileInfo[];
}

/**
 * W3C Web Annotation TextQuoteSelector with a couple of optional hints used
 * by our tiered anchor resolver. Stored verbatim in ADO thread
 * `properties.emrAnchor` (JSON).
 */
export interface TextQuoteAnchor {
  /** The selected text, verbatim. Empty string means "whole file" (file-level thread). */
  exact: string;
  /** Up to ~80 chars of context before `exact`. */
  prefix: string;
  /** Up to ~80 chars of context after `exact`. */
  suffix: string;
  /**
   * Optional path through the document structure (heading hierarchy) for
   * Tier-3 structural fallback when prefix/suffix no longer match.
   * E.g. ["Design doc", "Goals"].
   */
  headingPath?: string[];
  /** Block index within the resolved section. Used with headingPath. */
  blockIndex?: number;
  /**
   * 1-based source line the anchor refers to. Populated for comments that
   * originate from Azure DevOps's native PR UI, which anchors to diff line
   * numbers rather than text quotes. Used as a positioning fallback resolved
   * against the rendered block's `data-source-line` attribute when `exact`
   * is empty or its text-quote match fails.
   */
  line?: number;
  /** 1-based inclusive source end line. Defaults to `line` when omitted. */
  endLine?: number;
  /** 1-based source column where the anchor starts on `line`. */
  column?: number;
  /**
   * 1-based inclusive source end column on `endLine`. Defaults to `column`
   * when omitted.
   */
  endColumn?: number;
}

export interface CommentAuthor {
  /** Stable user id (ADO descriptor in production; arbitrary in fixtures). */
  id: string;
  displayName: string;
  /** Two-letter initials for the avatar fallback. */
  initials: string;
  /** Optional avatar URL; we fall back to initials in a colored circle. */
  avatarUrl?: string;
}

export interface Comment {
  id: string;
  author: CommentAuthor;
  /** Comment body in Markdown source. Rendered via our `renderMarkdown` pipeline. */
  bodyMarkdown: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Edited timestamp, if any. */
  updatedAt?: string;
  /** Emoji reactions, grouped by emoji. */
  reactions?: Reaction[];
}

/** A reaction on a single comment: one entry per distinct kind. */
export interface Reaction {
  /** Reaction kind — mirrors Azure DevOps's CommentReactionType. */
  kind: ReactionKind;
  /** People who reacted with this kind (id + display name, for the tooltip). */
  users: ReactionUser[];
}

/** A person who reacted, carrying just what the like tooltip needs. */
export interface ReactionUser {
  id: string;
  displayName: string;
}

/**
 * Reaction kinds we support. Today ADO PR comments only round-trip a single
 * kind (a "Like"), so the UI mirrors that and we keep this as a string union
 * with a single member for clarity and future expansion.
 *
 * See: `azure-devops-extension-api/Git` → `createLike` / `deleteLike`.
 */
export type ReactionKind = "like";

export type ThreadStatus =
  | "active"
  | "resolved"
  | "wontFix"
  | "closed"
  | "pending";

/**
 * True for statuses that are treated like "resolved" for filtering purposes.
 * `resolved`, `wontFix`, and `closed` are all terminal states grouped together
 * under the rail's "Resolved comments" filter (and hidden by "Active").
 */
export function isResolvedLike(status: ThreadStatus): boolean {
  return status === "resolved" || status === "wontFix" || status === "closed";
}

export interface CommentThread {
  id: string;
  filePath: string;
  anchor: TextQuoteAnchor;
  comments: Comment[];
  status: ThreadStatus;
  /**
   * Provenance of the thread. `"extension"` (default) means this extension
   * authored it with a text-quote anchor. `"ado"` means it was created from
   * Azure DevOps's native PR UI — either diff-line anchored (positioned via
   * the `anchor.line` fallback) or a general PR-level comment.
   */
  origin?: "extension" | "ado";
  /**
   * True for ADO PR-level ("Overview") comments that carry no file/line
   * context. They can't be positioned against any file, so the rail surfaces
   * them in a dedicated "General comments" tray independent of the open file.
   */
  general?: boolean;
  /**
   * Identities @-mentioned anywhere in this thread, as resolved by Azure
   * DevOps itself (`GitPullRequestCommentThread.identities`). This is the
   * authoritative name source for `@<GUID>` mentions — it works in every org,
   * including personal-MSA orgs where the `_apis/identities` by-id endpoint
   * returns null. Used to seed the identity store so mentions render as names
   * on load with zero extra network calls.
   */
  mentionedIdentities?: MentionedIdentity[];
}

/** A person @-mentioned in a thread, resolved by ADO for the identity store. */
export interface MentionedIdentity {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

/** Inclusive line range in the source Markdown that changed in this PR. */
export interface DiffRange {
  /** 1-indexed first line of the change in the new file. */
  startLine: number;
  /** 1-indexed last line of the change in the new file (inclusive). */
  endLine: number;
  /** Kind of change for the segment. */
  kind: "added" | "modified" | "deleted-marker";
  /** For 'deleted-marker': the deleted lines as raw text (rendered struck-through on expand). */
  deletedContent?: string;
  /**
   * For 'modified': the ORIGINAL source text of the changed lines (pre-edit).
   * Enables an inline word-level diff against the rendered block so a small
   * edit shows only the changed words instead of washing the whole block.
   */
  originalText?: string;
  /** 1-indexed first line of the changed range in the original file. */
  originalStartLine?: number;
  /** 1-indexed last line of the changed range in the original file. */
  originalEndLine?: number;
  /** For 'modified' / 'added': counts for the tooltip. */
  linesAdded?: number;
  linesDeleted?: number;
}

/** All data needed to render a single file's view. */
export interface FileViewData {
  path: string;
  source: string;
  renderedHtml: string;
  diff: DiffRange[];
  threads: CommentThread[];
}
