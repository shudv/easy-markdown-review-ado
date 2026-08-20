// Comment deep-linking.
//
// The ⋯ menu's "Link to comment" action copies a URL that re-opens the host
// surface (Documents hub or PR tab) scrolled to — and highlighting — a
// specific comment thread. The shareable URL is host-specific (it needs the
// real ADO page URL, which the extension iframe can't read), so each host
// supplies a builder through `CommentLinkContext`. `CommentRow` consumes it;
// when no builder is present it falls back to an in-iframe `#comment-<id>`
// hash (dev / standalone).
//
// This module holds only the pure, host-agnostic pieces: the query-param name,
// the URL read/write helpers, and the React context plumbing. Everything here
// is unit-tested; the host wiring that constructs the base URL lives in the
// (SDK-coupled, coverage-excluded) app shells.

import * as React from "react";

/**
 * Query-string parameter that carries the linked thread id on a surface URL,
 * e.g. `…/pullrequest/4?_a=…&comment=t-42`. The value is a *thread* id (the
 * unit the UI highlights), even though the user-facing action says "comment".
 */
export const COMMENT_LINK_PARAM = "comment";

/**
 * Builds a shareable URL for a thread, or `undefined` when it can't (no base
 * URL / no thread). Hosts provide one via `CommentLinkContext`; it closes over
 * the current document + surface so callers only pass the thread id.
 */
export type CommentLinkBuilder = (threadId: string) => string | undefined;

/**
 * React context carrying the active surface's link builder. `null` means "no
 * builder available" — `CommentRow` then uses its in-iframe hash fallback.
 */
export const CommentLinkContext =
  React.createContext<CommentLinkBuilder | null>(null);

/** Read the nearest `CommentLinkContext` builder (or `null`). */
export function useCommentLink(): CommentLinkBuilder | null {
  return React.useContext(CommentLinkContext);
}

/**
 * Return `baseUrl` with the `comment` query param set to `threadId`. Existing
 * query params and the hash are preserved; an existing `comment` param is
 * overwritten. Returns `undefined` when `baseUrl` is empty/unparseable or
 * `threadId` is blank, so callers can fall back rather than emit a broken link.
 */
export function withCommentParam(
  baseUrl: string,
  threadId: string,
): string | undefined {
  const id = threadId.trim();
  if (!baseUrl || !id) return undefined;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  url.searchParams.set(COMMENT_LINK_PARAM, id);
  return url.toString();
}

/**
 * Extract the linked thread id from a surface's query params (as returned by
 * the host navigation service). Returns `undefined` when absent or blank.
 */
export function readCommentParam(
  params: Record<string, string | undefined> | null | undefined,
): string | undefined {
  if (!params) return undefined;
  const raw = params[COMMENT_LINK_PARAM];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
