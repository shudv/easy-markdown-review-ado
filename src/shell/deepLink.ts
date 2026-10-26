// Shareable deep links into a review surface (Documents hub or PR tab).
//
// Three actions copy a URL that re-opens the host surface at a specific spot:
//   • "Link to comment" (CommentRow ⋯ menu) → scrolled to + highlighting a
//     comment thread (`?comment=<threadId>`);
//   • the heading link button (ArticleView) → scrolled to a section heading
//     (`?anchor=<slug>`, the same param ADO's own Markdown preview uses);
//   • the selection bubble's link button → scrolled to + flashing a span of
//     text (`?text=<fragment>`, see `textFragment.ts`), with the enclosing
//     section's `?anchor=` as a fallback should the text have changed.
//
// The shareable URL is host-specific (it needs the real ADO page URL, which the
// extension iframe can't read), so each host supplies a builder through
// `DeepLinkContext`; it closes over the current document + surface. When no
// builder is present the copy affordances are hidden — the iframe's own URL is
// a Marketplace-CDN asset that opens a blank page, so it is never a usable
// fallback.
//
// This module holds only the pure, host-agnostic pieces: the query-param names,
// the URL read/write helpers, and the React context plumbing. The host wiring
// that constructs the base URL lives in the (SDK-coupled) app shells.

import * as React from "react";

/**
 * Query-string parameter that carries the linked thread id on a surface URL,
 * e.g. `…/pullrequest/4?_a=…&comment=t-42`. The value is a *thread* id (the
 * unit the UI highlights), even though the user-facing action says "comment".
 */
export const COMMENT_LINK_PARAM = "comment";

/**
 * Query-string parameter that carries a heading slug, e.g. `?anchor=goals`.
 * Matches the param ADO's native repo Markdown preview uses, so links read the
 * same across both experiences.
 */
export const ANCHOR_LINK_PARAM = "anchor";

/**
 * Query-string parameter that carries a serialized text fragment
 * (`[prefix-,]start[,end][,-suffix]`), e.g. `?text=error%20budgets`.
 */
export const TEXT_LINK_PARAM = "text";

/** Query-string parameter that carries the open document's repo path. */
export const PATH_LINK_PARAM = "path";

/** Every param naming a target inside the document (cleared together). */
export const TARGET_LINK_PARAMS = [
  COMMENT_LINK_PARAM,
  ANCHOR_LINK_PARAM,
  TEXT_LINK_PARAM,
] as const;

/** What a shareable link points at inside the current document. */
export type DeepLinkTarget =
  | { kind: "comment"; threadId: string }
  | { kind: "heading"; anchor: string }
  | {
      kind: "text";
      /** Serialized text fragment (see `serializeTextFragment`). */
      text: string;
      /** Enclosing heading slug, used when the text can't be found. */
      anchor?: string;
    };

/**
 * Builds a shareable URL for a target in the active document, or `undefined`
 * when it can't (no base URL / blank target). Hosts provide one via
 * `DeepLinkContext`.
 */
export type DeepLinkBuilder = (target: DeepLinkTarget) => string | undefined;

/**
 * React context carrying the active surface's link builder. `null` means "no
 * shareable URL available" — link affordances are then hidden.
 */
export const DeepLinkContext = React.createContext<DeepLinkBuilder | null>(
  null,
);

/** Read the nearest `DeepLinkContext` builder (or `null`). */
export function useDeepLink(): DeepLinkBuilder | null {
  return React.useContext(DeepLinkContext);
}

/** The `{ param: value }` pairs a target writes into a URL. */
function targetParams(target: DeepLinkTarget): Record<string, string> {
  switch (target.kind) {
    case "comment":
      return { [COMMENT_LINK_PARAM]: target.threadId.trim() };
    case "heading":
      return { [ANCHOR_LINK_PARAM]: target.anchor.trim() };
    case "text": {
      const anchor = target.anchor?.trim();
      return {
        [TEXT_LINK_PARAM]: target.text.trim(),
        ...(anchor ? { [ANCHOR_LINK_PARAM]: anchor } : {}),
      };
    }
  }
}

/**
 * Return `baseUrl` with the target's query param set. Any other target param
 * is dropped, so a link never carries two competing targets (a text link's
 * `anchor` is its fallback, not a competitor). Existing query params and the
 * hash are preserved. Returns `undefined` when `baseUrl` is empty/unparseable
 * or the target value is blank, so callers can report a failure rather than
 * emit a broken link.
 */
export function withDeepLinkTarget(
  baseUrl: string,
  target: DeepLinkTarget,
): string | undefined {
  const params = targetParams(target);
  const primary = Object.values(params)[0]!;
  if (!baseUrl || !primary) return undefined;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  for (const param of TARGET_LINK_PARAMS) url.searchParams.delete(param);
  for (const [param, value] of Object.entries(params)) {
    url.searchParams.set(param, value);
  }
  // Quoted text is mostly spaces: spell them `%20`, not the form-style `+`,
  // which a host that decodes with `decodeURIComponent` would keep literally.
  // (A literal `+` is always serialized as `%2B`, so this is lossless.)
  if (target.kind === "text") {
    url.search = url.searchParams.toString().replace(/\+/g, "%20");
  }
  return url.toString();
}

type RouteParams = Record<string, string | undefined> | null | undefined;

function readTrimmed(params: RouteParams, key: string): string | undefined {
  if (!params) return undefined;
  const raw = params[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract the linked thread id from a surface's query params (as returned by
 * the host navigation service). Returns `undefined` when absent or blank.
 */
export function readCommentParam(params: RouteParams): string | undefined {
  return readTrimmed(params, COMMENT_LINK_PARAM);
}

/**
 * Extract the linked heading slug from a surface's query params. A leading `#`
 * (pasted from an in-page link) is tolerated. Returns `undefined` when absent
 * or blank.
 */
export function readAnchorParam(params: RouteParams): string | undefined {
  const anchor = readTrimmed(params, ANCHOR_LINK_PARAM)?.replace(/^#+/, "");
  return anchor ? anchor : undefined;
}

/**
 * Extract the serialized text fragment (`?text=`). Returns `undefined` when
 * absent or blank; parsing is left to `parseTextFragment`.
 */
export function readTextParam(params: RouteParams): string | undefined {
  return readTrimmed(params, TEXT_LINK_PARAM);
}

/**
 * Extract the linked document path in the repo-rooted form the shell uses
 * (`/docs/a.md`). Accepts both the slash-free hub form (`docs/a.md`) and ADO's
 * leading-slash form. Returns `undefined` when absent or blank.
 */
export function readPathParam(params: RouteParams): string | undefined {
  const bare = readTrimmed(params, PATH_LINK_PARAM)?.replace(/^\/+/, "");
  return bare ? `/${bare}` : undefined;
}
