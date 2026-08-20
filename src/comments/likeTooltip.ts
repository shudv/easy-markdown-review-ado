// Pure formatter for the like-pill hover tooltip. Mirrors native ADO, which
// lists the people who liked a comment (with the current user shown as "You"
// and placed first) rather than a bare count.
//
// The list is deliberately bounded: we show at most `MAX_NAMES` names and
// collapse the rest into "and N others", and we further shrink the shown count
// if the joined names would exceed `MAX_CHARS` — so a comment liked by a large
// team never produces a runaway tooltip.

import type { ReactionUser } from "../types";

const MAX_NAMES = 5;
const MAX_CHARS = 120;
const SUFFIX = " liked this";

/**
 * Order likers with the current user first (rendered as "You"), preserving the
 * given order for everyone else.
 */
function orderedNames(
  users: readonly ReactionUser[],
  currentUserId: string,
): string[] {
  const me: string[] = [];
  const others: string[] = [];
  for (const u of users) {
    if (u.id === currentUserId) me.push("You");
    else others.push(u.displayName);
  }
  return [...me, ...others];
}

/** Join up to `shown` names, collapsing the remainder into "and N others". */
function joinNames(names: string[], shown: number): string {
  const visible = names.slice(0, shown);
  const hidden = names.length - visible.length;
  if (hidden > 0) {
    return `${visible.join(", ")} and ${hidden} other${
      hidden === 1 ? "" : "s"
    }`;
  }
  if (visible.length === 1) return visible[0]!;
  if (visible.length === 2) return `${visible[0]} and ${visible[1]}`;
  const head = visible.slice(0, -1).join(", ");
  return `${head} and ${visible[visible.length - 1]}`;
}

/**
 * Build the like tooltip text, e.g. "You, Ada and Bob liked this" or
 * "Ada, Bob, Carol, Dan, Eve and 3 others liked this". Returns "" for no likers.
 */
export function formatLikeTooltip(
  users: readonly ReactionUser[],
  currentUserId: string,
): string {
  const names = orderedNames(users, currentUserId);
  if (names.length === 0) return "";
  // Start from the display cap, then shrink until the joined body fits the
  // character budget (always show at least one name).
  let shown = Math.min(MAX_NAMES, names.length);
  let body = joinNames(names, shown);
  while (shown > 1 && body.length > MAX_CHARS) {
    shown -= 1;
    body = joinNames(names, shown);
  }
  return `${body}${SUFFIX}`;
}
