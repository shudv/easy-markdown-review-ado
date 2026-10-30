// Pure derivations for a CommentRow: which affordances the viewer gets, the
// like-reaction summary, and display labels.

import type { Comment } from "../../types";
import { formatLikeTooltip } from "../../comments/likeTooltip";

/** Outcome of the last "Link to comment" copy, shown inline in the menu. */
export type CommentLinkState = "idle" | "copied" | "failed";

export interface CommentRowPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  /** Whether the ⋯ menu would have anything in it. */
  hasMenuItems: boolean;
}

export function commentRowPermissions(opts: {
  isOwn: boolean;
  interactive: boolean;
  isFirst: boolean;
  canLink: boolean;
}): CommentRowPermissions {
  // ADO permission model: you can edit/delete your own comments. We gate both
  // on "own comment".
  const canEdit = opts.interactive && opts.isOwn;
  const canDelete = opts.interactive && opts.isOwn;
  // Thread actions always exist on the first comment; a later reply may have
  // nothing to offer (someone else's reply on a surface with no shareable URL),
  // in which case the ⋯ button is hidden rather than opening an empty menu.
  const hasMenuItems = opts.canLink || canEdit || canDelete || opts.isFirst;
  return { canEdit, canDelete, canReact: opts.interactive, hasMenuItems };
}

export interface LikeSummary {
  likedByMe: boolean;
  likeCount: number;
  likeTooltip: string;
}

export function summarizeLikes(
  reactions: Comment["reactions"],
  currentUserId: string,
): LikeSummary {
  const likeReaction = (reactions ?? []).find((r) => r.kind === "like");
  const likeUsers = likeReaction?.users ?? [];
  return {
    likedByMe: likeUsers.some((u) => u.id === currentUserId),
    likeCount: likeUsers.length,
    likeTooltip: formatLikeTooltip(likeUsers, currentUserId),
  };
}

export function commentLinkLabel(state: CommentLinkState): string {
  if (state === "copied") return "Link copied";
  if (state === "failed") return "Couldn't copy link";
  return "Link to comment";
}

// ---------------------------------------------------------------------------
// Date formatting — match the screenshot style ("May 11, 2026 at 11:41 AM").
// ---------------------------------------------------------------------------

export function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}
