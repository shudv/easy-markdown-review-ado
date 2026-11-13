// The PR tab's "still loading" signals — a slow boot, and a PR shown from this
// browser's cache while ADO's version loads — and its loading view.

import { type ReactElement, useEffect, useState } from "react";

import { ReaderLoadingShell } from "../shell/components/ReaderLoadingShell";
import type { ReaderActivity } from "../shell/components/readerActivity";
import { startVisibleTimer, type VisibilityClock } from "./prTabApp.helpers";
import { t } from "../i18n";

/**
 * Visible wait after which boot says it is still loading and offers a retry.
 * Production boots take ~2.3 s at the median and ~4.7 s at p95, so this only
 * reaches the slow tail (one Azure DevOps project's PR lookup took 30 s+).
 */
export const SLOW_BOOT_MS = 8_000;

/**
 * True once boot has been `waiting` for {@link SLOW_BOOT_MS} of VISIBLE time
 * (a background tab's wait doesn't count) in the current `attempt`; a new
 * attempt starts the clock again.
 */
export function useSlowBoot(
    waiting: boolean,
    attempt: number,
    visibility?: VisibilityClock,
): boolean {
    const [slowAttempt, setSlowAttempt] = useState<number | null>(null);

    useEffect(() => {
        if (!waiting) return undefined;

        return startVisibleTimer(SLOW_BOOT_MS, () => setSlowAttempt(attempt), visibility);
    }, [waiting, attempt, visibility]);

    return waiting && slowAttempt === attempt;
}

/** The status-bar message for a slow boot, with its "Try again". */
function slowBootActivity(onRetry: () => void): ReaderActivity {
    return {
        id: "boot-slow",
        label: t("hub.prTab.slowBoot"),
        priority: 100,
        action: { label: t("common.tryAgain"), onClick: onRetry },
    };
}

/** The status bar while a PR shown from this browser's cache waits for ADO's version. */
export function checkingForUpdatesActivity(): ReaderActivity {
    return {
        id: "pr-check-updates",
        label: t("hub.prTab.checkingForUpdates"),
        // Below every shell operation except background comment sync.
        priority: 30,
    };
}

/** Boot is still waiting on the PR: no context yet, no error, not reconnecting. */
export function isBootWaiting(ctx: unknown, error: string | null, refreshing: unknown): boolean {
    return ctx === null && (error === null || error === "") && refreshing === null;
}

/** The PR tab's loading page; a slow boot says so and offers a retry. */
export function PrTabLoadingView({
    slow,
    onRetry,
}: Readonly<{ slow: boolean; onRetry: () => void }>): ReactElement {
    return (
        <ReaderLoadingShell
            scope="pr"
            ariaLabel={t("hub.prTab.loading")}
            activity={slow ? slowBootActivity(onRetry) : undefined}
        />
    );
}
