// Pure derivations for the Balloon (thread card): its class list, positioning
// style, and status-chip label.

import type { CSSProperties } from "react";
import type { ThreadStatus } from "../../types";
import { t, type MessageKey } from "../../i18n";

/** Status a balloon displays; orphaned cards override the thread status. */
export type BalloonDisplayStatus = ThreadStatus | "orphaned";

/** Options for posting a reply: `resolve` also resolves the thread once it's saved. */
export interface ReplyOptions {
    resolve?: boolean;
}

const STATUS_LABEL_KEYS = {
    active: "comments.balloon.status.active",
    resolved: "comments.balloon.status.resolved",
    wontFix: "comments.balloon.status.wontFix",
    closed: "comments.balloon.status.closed",
    pending: "comments.balloon.status.pending",
    orphaned: "comments.balloon.status.orphaned",
} as const satisfies Record<BalloonDisplayStatus, MessageKey>;

export function balloonStatusLabel(status: BalloonDisplayStatus): string {
    return t(STATUS_LABEL_KEYS[status]);
}

export function balloonClassName(flags: {
    inline?: boolean;
    isActive: boolean;
    resolved: boolean;
    isOrphaned?: boolean;
    general?: boolean;
    /** A resolve wash is playing (pulses the border green). */
    washing?: boolean;
}): string {
    const classes = ["emr-balloon"];
    if (flags.inline) classes.push("inline");
    if (flags.isActive) classes.push("is-active");
    if (flags.resolved) classes.push("is-resolved");
    if (flags.isOrphaned) classes.push("is-orphaned");
    if (flags.general) classes.push("is-general");
    if (flags.washing) classes.push("is-washing");

    return classes.join(" ");
}

/** Inline balloons flow naturally; positioned ones sit at `topPx` (or 0). */
export function balloonStyle(
    inline: boolean | undefined,
    topPx: number | undefined,
): CSSProperties {
    return inline ? {} : { top: typeof topPx === "number" ? topPx : 0 };
}
