// Shell: a once-per-load snapshot of the PR's thread statuses, so telemetry
// can show whether threads started in Markdown Review get finished — here or
// in Azure DevOps' own UI (the status is the same wherever it was changed).

import { type CommentThread, isResolvedLike } from "../../types";
import { events, track } from "../../telemetry";

interface ThreadStatusCounts {
    /** Threads started in Markdown Review that are still open / done. */
    ourOpen: number;
    ourDone: number;
    /** Threads started elsewhere (ADO's own UI, bots) that are open / done. */
    otherOpen: number;
    otherDone: number;
}

/** Count open vs done threads, split by whether this extension started them. */
function countThreadStatuses(threads: readonly CommentThread[]): ThreadStatusCounts {
    const counts: ThreadStatusCounts = { ourOpen: 0, ourDone: 0, otherOpen: 0, otherDone: 0 };

    for (const thread of threads) {
        const ours = thread.origin === "extension";
        const done = isResolvedLike(thread.status);
        if (ours) counts[done ? "ourDone" : "ourOpen"] += 1;
        else counts[done ? "otherDone" : "otherOpen"] += 1;
    }

    return counts;
}

/** Report the PR's thread statuses (call once, on the first PR-wide snapshot). */
export function reportThreadSnapshot(threads: readonly CommentThread[]): void {
    track(events.threadsSnapshot(countThreadStatuses(threads)));
}
