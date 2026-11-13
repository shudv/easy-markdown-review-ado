// Pure formatter for the like-pill hover tooltip. Mirrors native ADO, which
// lists the people who liked a comment (with the current user shown as "You"
// and placed first) rather than a bare count.
//
// The list is deliberately bounded: we show at most `MAX_NAMES` names and
// collapse the rest into "and N others", and we further shrink the shown count
// if the tooltip would exceed `MAX_CHARS` — so a comment liked by a large team
// never produces a runaway tooltip.

import { t } from "../i18n";
import type { ReactionUser } from "../types";

const MAX_NAMES = 5;
// 120 characters of names plus the English " liked this" (11).
const MAX_CHARS = 131;

/**
 * Order likers with the current user first (rendered as "You"), preserving the
 * given order for everyone else.
 */
function orderedNames(users: readonly ReactionUser[], currentUserId: string): string[] {
    const me: string[] = [];
    const others: string[] = [];

    for (const u of users) {
        if (u.id === currentUserId) me.push(t("comments.like.you"));
        else others.push(u.displayName);
    }

    return [...me, ...others];
}

/** The sentence naming up to `shown` likers, collapsing the remainder into "and N others". */
function likeSentence(names: string[], shown: number): string {
    const visible = names.slice(0, shown);
    const hidden = names.length - visible.length;
    const separator = t("comments.like.separator");

    if (hidden > 0) {
        return t("comments.like.namesAndOthers", {
            names: visible.join(separator),
            count: hidden,
        });
    }

    if (visible.length === 1) return t("comments.like.single", { name: visible[0]! });

    return t("comments.like.namesAndLast", {
        names: visible.slice(0, -1).join(separator),
        last: visible[visible.length - 1]!,
    });
}

/**
 * Build the like tooltip text, e.g. "You, Ada and Bob liked this" or
 * "Ada, Bob, Carol, Dan, Eve and 3 others liked this". Returns "" for no likers.
 */
export function formatLikeTooltip(users: readonly ReactionUser[], currentUserId: string): string {
    const names = orderedNames(users, currentUserId);
    if (names.length === 0) return "";
    // Start from the display cap, then shrink until the sentence fits the
    // character budget (always show at least one name).
    let shown = Math.min(MAX_NAMES, names.length);
    let sentence = likeSentence(names, shown);

    while (shown > 1 && sentence.length > MAX_CHARS) {
        shown -= 1;
        sentence = likeSentence(names, shown);
    }

    return sentence;
}
