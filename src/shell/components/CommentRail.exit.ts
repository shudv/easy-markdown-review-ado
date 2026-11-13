// Which threads are playing their exit: a filter just hid them while they were
// on screen (e.g. resolved under "Active comments", or the filter switched).
// They stay rendered until their exit has played, then the rail drops them.

import { useState } from "react";

import type { CommentThread } from "../../types";

const NONE: ReadonlySet<string> = new Set();

/**
 * The exiting set after `hidden` changed: threads still leaving stay, and a
 * thread starts leaving when it was visible (present and not hidden) before
 * and is hidden now. A thread that appeared already hidden — another file's,
 * say — never animates.
 */
export function nextExiting(
    p: Readonly<{
        exiting: ReadonlySet<string>;
        prevHidden: ReadonlySet<string>;
        hidden: ReadonlySet<string>;
        before: ReadonlySet<string>;
        now: ReadonlySet<string>;
    }>,
): ReadonlySet<string> {
    const next = new Set<string>();

    for (const id of p.exiting) {
        if (p.hidden.has(id) && p.now.has(id)) next.add(id);
    }

    for (const id of p.hidden) {
        if (!p.prevHidden.has(id) && p.before.has(id) && p.now.has(id)) next.add(id);
    }

    return next.size === 0 ? NONE : next;
}

function keyOf(ids: Iterable<string>): string {
    return [...ids].sort().join("\n");
}

export function useExitingThreads(
    hidden: ReadonlySet<string>,
    threadLists: ReadonlyArray<readonly CommentThread[]>,
): { exiting: ReadonlySet<string>; finishExit: (threadId: string) => void } {
    const now = new Set(threadLists.flatMap((list) => list.map((t) => t.id)));
    const nowKey = keyOf(now);
    const hiddenKey = keyOf(hidden);
    const [seen, setSeen] = useState({ nowKey, hiddenKey, now, hidden });
    const [exiting, setExiting] = useState(NONE);

    // Compared by content, not identity: callers rebuild these collections on
    // every render.
    if (seen.nowKey !== nowKey || seen.hiddenKey !== hiddenKey) {
        setSeen({ nowKey, hiddenKey, now, hidden });
        setExiting(
            nextExiting({ exiting, prevHidden: seen.hidden, hidden, before: seen.now, now }),
        );
    }

    const finishExit = (threadId: string): void => {
        setExiting((current) => {
            const next = new Set(current);
            next.delete(threadId);

            return next.size === 0 ? NONE : next;
        });
    };

    return { exiting, finishExit };
}
