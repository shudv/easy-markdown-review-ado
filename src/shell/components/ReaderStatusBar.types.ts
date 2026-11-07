// Public prop and option types of the reader status bar.

import type { ReviewIterationRange, WordCountDelta } from "../shellHelpers";
import type { ReaderActivity } from "./readerActivity";

export interface ReaderStatusBarProps {
    /** Approximate word count of the current document (0/undefined hides it). */
    wordCount?: number;
    /** Words the PR added / removed; shown as a delta when the diff is on. */
    wordDelta?: WordCountDelta;
    /** Latest completed PR associated with the active Documents Hub document. */
    resolvedPullRequest?: {
        prId: number;
        title: string;
        url?: string;
    };

    /** Selected reading-font id (see `READER_FONTS`). */
    fontId: string;
    /** Selected text size as a continuous percentage. */
    sizePct: number;
    /** Selected combined text spacing percentage. */
    spacingPct: number;
    /** Choose a reading font. */
    onFontChange: (fontId: string) => void;
    /** Set the continuous text-size percentage. */
    onSizeChange: (sizePct: number) => void;
    /** Set the combined text-spacing percentage. */
    onSpacingChange: (spacingPct: number) => void;
    /** Optional deterministic availability override for embeds and tests. */
    availableFontIds?: readonly string[];

    /** Whether the document-navigation panel is currently shown. */
    showNav: boolean;
    /** Toggle the document-navigation panel. */
    onToggleNav: () => void;
    /** False in single-file mode (no file tree) — drops the Navigation control. */
    navToggleable: boolean;
    /** Whether the open document's outline is listed in the navigation panel. */
    showOutline?: boolean;
    /**
     * Toggle the navigation outline. Offered next to Navigation while the panel
     * is shown; omitted drops the control.
     */
    onToggleOutline?: () => void;

    /** Whether the comments panel is currently shown. */
    showComments: boolean;
    /** Whether the active surface has a resolved comment target. */
    commentsAvailable?: boolean;
    /** Toggle the comments panel. */
    onToggleComments: () => void;
    /** Visible comment thread ids in cycle order. */
    commentThreadIds?: readonly string[];
    /** Currently selected visible comment thread. */
    activeCommentThreadId?: string | null;
    /** Select a comment while cycling. */
    onCycleComment?: (threadId: string) => void;

    /** Whether the document has changes to show (a PR diff). */
    changesAvailable: boolean;
    /** Whether change highlights are currently shown. */
    changesShown: boolean;
    /** Toggle the change highlights. */
    onToggleChanges: () => void;

    /**
     * Chronological pull-request updates, oldest first. (The picker lists them
     * newest first, under "All updates", like ADO's own update list.)
     */
    iterationOptions?: readonly ReaderIterationOption[];
    /** Pull-request base commit shown by the base-comparison glyph tooltip. */
    iterationBaseCommit?: string;
    /** Current native-PR update comparison interval. */
    iterationRange?: ReviewIterationRange;
    /** Replace the current update comparison interval. */
    onIterationRangeChange?: (range: ReviewIterationRange) => void;

    /** `mailto:`/https feedback target. Omitted drops the Feedback control. */
    feedbackHref?: string;

    /** Refresh the document data + comments. Omitted drops the control. */
    onRefresh?: () => void;
    /** Whether a refresh is in flight — spins the icon and disables the button. */
    refreshing?: boolean;
    /** Tooltip / aria-label for the refresh control. */
    refreshLabel?: string;
    /** Concurrent reader operations eligible for the centered activity display. */
    activities?: readonly ReaderActivity[];
    /** Anti-flicker delay before an activity is announced. Defaults to 250ms. */
    activityDelayMs?: number;
}

export interface ReaderIterationOption {
    /** Index used by Shell's newest-first `historyStops` array. */
    stopIndex: number;
    /** Chronological display position (oldest = 1). */
    number: number;
    /** Pull-request / commit message for this stop. */
    title: string;
    /** Epoch milliseconds, when known. */
    dateMs?: number;
}
