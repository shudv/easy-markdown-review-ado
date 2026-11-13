// Rich comment filter — the model behind the rail's "which comments to show"
// control. Replaces the old binary show/hide-resolved toggle with a small set
// of named modes (all / active / resolved / mine), mirroring the multi-option
// filter Azure DevOps offers on its own PR discussion.
//
// Kept as a pure, component-free module so the filtering + counting logic is
// unit-tested directly (and imported by both the React toolbar and Shell)
// without dragging the component tree into the jsdom project.

import type { CommentThread } from "../../types";
import { isResolvedLike } from "../../types";
import { t, type MessageKey } from "../../i18n";

/** Which slice of the thread population the rail is currently showing. */
export type CommentFilterMode = "all" | "active" | "resolved" | "mine";

/** The modes in display order — the single source of truth for iteration. */
export const COMMENT_FILTER_MODES: readonly CommentFilterMode[] = [
    "all",
    "active",
    "resolved",
    "mine",
];

/** Catalog key of the human-readable label per mode (used by the trigger + menu items). */
const FILTER_LABEL_KEYS = {
    all: "comments.filter.mode.all",
    active: "comments.filter.mode.active",
    resolved: "comments.filter.mode.resolved",
    mine: "comments.filter.mode.mine",
} as const satisfies Record<CommentFilterMode, MessageKey>;

/** The menu/trigger label for a mode. */
export function commentFilterLabel(mode: CommentFilterMode): string {
    return t(FILTER_LABEL_KEYS[mode]);
}

/** Per-bucket thread counts shown beside each filter option. */
export interface CommentFilterCounts {
    all: number;
    active: number;
    resolved: number;
    mine: number;
}

/** True when the current user authored at least one comment in the thread. */
export function isMyThread(thread: CommentThread, currentUserId: string): boolean {
    return thread.comments.some((c) => c.author.id === currentUserId);
}

/** Whether a thread is visible under the given filter mode. */
export function threadMatchesFilter(
    thread: CommentThread,
    mode: CommentFilterMode,
    currentUserId: string,
): boolean {
    switch (mode) {
        case "all":
            return true;
        case "active":
            return !isResolvedLike(thread.status);
        case "resolved":
            return isResolvedLike(thread.status);
        case "mine":
            return isMyThread(thread, currentUserId);
    }
}

/** Match a thread by any comment body or author name, case-insensitively. */
export function threadMatchesQuery(thread: CommentThread, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    // Stryker disable next-line ConditionalExpression: dead code: every thread has at least one comment (the ADO adapter drops empty threads) and every comment includes "", so an empty query matches either way, candidate for removal
    if (!normalized) return true;

    return thread.comments.some(
        (comment) =>
            comment.bodyMarkdown.toLowerCase().includes(normalized) ||
            comment.author.displayName.toLowerCase().includes(normalized),
    );
}

/**
 * Search is a whole-rail mode and therefore spans every status. Without a
 * query, the selected status/author filter controls visibility as usual.
 */
export function threadVisibleForCommentView(
    thread: CommentThread,
    query: string,
    mode: CommentFilterMode,
    currentUserId: string,
): boolean {
    return query.trim()
        ? threadMatchesQuery(thread, query)
        : threadMatchesFilter(thread, mode, currentUserId);
}

/**
 * Tally each filter bucket across a thread population in a single pass. A
 * thread counts toward `mine` independently of its active/resolved bucket, so
 * the totals overlap exactly like Azure DevOps's own filter counts.
 */
export function countCommentFilters(
    threads: readonly CommentThread[],
    currentUserId: string,
): CommentFilterCounts {
    const counts: CommentFilterCounts = {
        all: 0,
        active: 0,
        resolved: 0,
        mine: 0,
    };

    for (const t of threads) {
        counts.all += 1;
        if (isResolvedLike(t.status)) counts.resolved += 1;
        else counts.active += 1;
        if (isMyThread(t, currentUserId)) counts.mine += 1;
    }

    return counts;
}

/** One entry in the filter menu: the mode, its label, and its live count. */
export interface CommentFilterOption {
    mode: CommentFilterMode;
    label: string;
    count: number;
}

/** Build the ordered menu options from a set of counts. */
export function commentFilterOptions(counts: CommentFilterCounts): CommentFilterOption[] {
    return COMMENT_FILTER_MODES.map((mode) => ({
        mode,
        label: t(FILTER_LABEL_KEYS[mode]),
        count: counts[mode],
    }));
}
