// CommentApi — minimal persistence boundary the PR shell calls through.
//
// `PrShell` performs an optimistic dispatch on its local thread reducer,
// but it always routes the *mutation* through a CommentApi first so the
// real-ADO build can persist to the Pull Request Threads service while the
// standalone dev preview just generates throwaway ids.
//
// Why route mutations through this seam instead of dispatching directly to
// the reducer:
//   - Real ADO mints the canonical thread / comment ids; the UI must adopt
//     them so subsequent edits/replies target the right server objects.
//   - The "like" reaction round-trips through a separate ADO endpoint and
//     needs to know whether we're adding or removing *before* we call it.
//   - Errors from the remote write can be surfaced inline without leaving
//     stale optimistic state behind.

import * as React from "react";

import type {
  MentionedIdentity,
  ReactionKind,
  TextQuoteAnchor,
  ThreadStatus,
} from "../types";
import {
  type PullRequestSuggestion,
  type UserSuggestion,
  type WorkItemSuggestion,
} from "./mentions";

export interface NewThreadInput {
  filePath: string;
  anchor: TextQuoteAnchor;
  bodyMarkdown: string;
  /**
   * Display names/avatars for the users this comment `@`-mentions, captured
   * from the picker at compose time. Persisted into a thread property we own
   * so mentions render as names on load in every org — including personal-MSA
   * or cross-tenant-guest cases where ADO's `thread.identities` and the by-id
   * identity endpoint both return nothing.
   */
  mentions?: MentionedIdentity[];
}

export interface CreatedThreadIds {
  /** Server-assigned thread id (as a string — ADO mints integers, we stringify). */
  threadId: string;
  /** Server-assigned id of the first comment in the new thread. */
  firstCommentId: string;
  /** ISO timestamp the server stamped on the new thread/comment. */
  createdAt: string;
}

/**
 * Optional persistence layer used by PrShell. When undefined, PrShell
 * falls back to {@link LocalOnlyCommentApi} which keeps everything in
 * memory and is fine for fixtures + standalone dev preview.
 */
export interface CommentApi {
  /** Create a new thread + first comment. Returns the server-minted ids. */
  createThread(input: NewThreadInput): Promise<CreatedThreadIds>;

  /** Append a reply to an existing thread. Returns the new comment's id + timestamp. */
  addReply(
    threadId: string,
    bodyMarkdown: string,
  ): Promise<{ commentId: string; createdAt: string }>;

  /** Replace an existing comment's body. Returns the server-stamped updatedAt. */
  editComment(
    threadId: string,
    commentId: string,
    bodyMarkdown: string,
  ): Promise<{ updatedAt: string }>;

  /** Soft-delete a comment. */
  deleteComment(threadId: string, commentId: string): Promise<void>;

  /** Change a thread's status. */
  setStatus(threadId: string, status: ThreadStatus): Promise<void>;

  /**
   * Toggle the current user's reaction. `add=true` adds, `add=false` removes.
   * Today only `"like"` is supported — ADO PR comments don't round-trip any
   * other reaction kinds.
   */
  toggleReaction(
    threadId: string,
    commentId: string,
    kind: ReactionKind,
    add: boolean,
  ): Promise<void>;

  // -------------------------------------------------------------------------
  // Mention typeahead surfaces. Each method returns at most ~8 ranked
  // suggestions for the given query. Empty / undefined query should return
  // a recency-ordered "recent items" list so the picker is useful before
  // the user starts typing.
  // -------------------------------------------------------------------------

  /** People search powering the `@` picker. */
  searchUsers(query: string): Promise<UserSuggestion[]>;

  /** Work item search powering the `#` picker. */
  searchWorkItems(query: string): Promise<WorkItemSuggestion[]>;

  /** Pull request search powering the `!` picker. */
  searchPullRequests(query: string): Promise<PullRequestSuggestion[]>;

  /**
   * Resolve a batch of user identity ids (GUIDs) to display names / avatars for
   * the identity store, so `@<GUID>` mentions render as names. Optional — when
   * absent, mentions fall back to store entries seeded from comment authors and
   * the @-picker (which already covers self + PR participants). Missing ids may
   * be omitted from the result.
   */
  resolveIdentities?(
    ids: string[],
  ): Promise<Record<string, { displayName: string; avatarUrl?: string }>>;
}

/**
 * In-memory CommentApi used by the standalone dev preview and any other
 * caller that just wants client-side ids. Every method resolves immediately;
 * ids are generated locally with a monotonic counter so they don't collide
 * with fixture ids.
 */
export class LocalOnlyCommentApi implements CommentApi {
  private threadCounter = 0;
  private commentCounter = 0;

  async createThread(_input: NewThreadInput): Promise<CreatedThreadIds> {
    const n = ++this.threadCounter;
    const threadId = `t-local-${n}`;
    return {
      threadId,
      firstCommentId: `${threadId}-c1`,
      createdAt: new Date().toISOString(),
    };
  }

  async addReply(
    _threadId: string,
    _bodyMarkdown: string,
  ): Promise<{ commentId: string; createdAt: string }> {
    return {
      commentId: `c-local-${++this.commentCounter}`,
      createdAt: new Date().toISOString(),
    };
  }

  async editComment(
    _threadId: string,
    _commentId: string,
    _bodyMarkdown: string,
  ): Promise<{ updatedAt: string }> {
    return { updatedAt: new Date().toISOString() };
  }

  async deleteComment(_threadId: string, _commentId: string): Promise<void> {}

  async setStatus(_threadId: string, _status: ThreadStatus): Promise<void> {}

  async toggleReaction(
    _threadId: string,
    _commentId: string,
    _kind: ReactionKind,
    _add: boolean,
  ): Promise<void> {}

  // -------------------------------------------------------------------------
  // Mention search — the production fallback has no directory to search, so it
  // returns nothing. Fixture-backed results for dev/stories live in
  // `FixtureCommentApi` (./fixtureCommentApi), which keeps the sample people /
  // work items / PRs out of the shipped bundles.
  // -------------------------------------------------------------------------

  async searchUsers(_query: string): Promise<UserSuggestion[]> {
    return [];
  }

  async searchWorkItems(_query: string): Promise<WorkItemSuggestion[]> {
    return [];
  }

  async searchPullRequests(_query: string): Promise<PullRequestSuggestion[]> {
    return [];
  }

  async resolveIdentities(
    _ids: string[],
  ): Promise<Record<string, { displayName: string; avatarUrl?: string }>> {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Fixture data for the local picker. These mirror the shape of what ADO
// returns from its identity / WIT / git endpoints so the picker UI can be
// developed against realistic data without spinning up a real PR.
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring matcher used by all three local pickers.
 * Empty query → return everything (recency placeholder).
 *
 * Exported for unit tests; the production call sites are the
 * `LocalOnlyCommentApi.search*` methods above.
 */
export function filterByQuery<T>(
  items: T[],
  query: string,
  keys: (item: T) => string[],
): T[] {
  const q = query.trim().toLowerCase();
  // Stryker disable next-line ConditionalExpression: equivalent mutant — with
  // an empty query the scoring loop below matches every item at offset 0
  // (indexOf("") === 0) and returns the same first-8 slice, so removing this
  // fast path doesn't change the output.
  if (!q) return items.slice(0, 8);
  const matches: { item: T; score: number }[] = [];
  for (const item of items) {
    const hay = keys(item).join(" ").toLowerCase();
    const idx = hay.indexOf(q);
    if (idx >= 0) matches.push({ item, score: idx });
  }
  matches.sort((a, b) => a.score - b.score);
  return matches.slice(0, 8).map((m) => m.item);
}

// ---------------------------------------------------------------------------
// React context
//
// We avoid prop-drilling the CommentApi through Balloon → CommentRow →
// Composer (and similar paths) by exposing it via context. PrShell sets
// the provider once; descendants pull it with `useCommentApi()` when they
// need to fire ad-hoc requests (today: mention typeahead inside Composer).
// ---------------------------------------------------------------------------

const CommentApiContext = React.createContext<CommentApi | null>(null);

export const CommentApiProvider = CommentApiContext.Provider;

/**
 * Returns the active CommentApi. Throws if called outside the provider so
 * misuse is loud rather than silent.
 */
export function useCommentApi(): CommentApi {
  const api = React.useContext(CommentApiContext);
  if (!api) {
    throw new Error(
      "useCommentApi must be used inside <CommentApiProvider value={...}>",
    );
  }
  return api;
}
