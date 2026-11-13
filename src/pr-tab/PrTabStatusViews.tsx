// The PR tab's non-document states: reconnecting after an ADO token dead
// window, a boot failure, and a PR with no changed Markdown files.

import { type ReactElement, useEffect, useState } from "react";

import { OpenElsewhereIcon } from "../shell/components/icons";

/**
 * Public evidence for the dead window: the extension SDK change that would let
 * extensions ask the host for a fresh token, with a write-up of the root cause
 * (the host keeps serving a token whose Azure DevOps grant already expired).
 */
export const DEAD_WINDOW_ISSUE_URL =
    "https://github.com/microsoft/azure-devops-extension-sdk/pull/137";

const ETA_TICK_MS = 15_000;

/** "within about 4 minutes": when the host is due to replace the dead token. */
export function reconnectEta(recoverAtMs: number | undefined, nowMs: number): string {
    if (recoverAtMs === undefined) return "within a few minutes";
    const minutes = Math.ceil((recoverAtMs - nowMs) / 60_000);

    return minutes <= 1 ? "within a minute" : `within about ${minutes} minutes`;
}

function useNow(tickMs: number): number {
    const [now, setNow] = useState(Date.now);

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), tickMs);

        return () => window.clearInterval(id);
    }, [tickMs]);

    return now;
}

const MUTED = { color: "var(--emr-muted)" } as const;

export function SessionRefreshingView({
    autoReload,
    reloadTried = false,
    recoverAtMs,
    onReload,
}: Readonly<{
    /** An automatic host reload is pending, so no manual action is offered. */
    autoReload: boolean;
    /**
     * This window already survived an automatic reload (see
     * `autoReloadRecentlyTried`): another reload can't help, so none is offered.
     */
    reloadTried?: boolean;
    /** When the host is due to replace the dead token (the AAD `exp`). */
    recoverAtMs?: number;
    onReload: () => void;
}>): ReactElement {
    const now = useNow(ETA_TICK_MS);

    return (
        <div className="emr-error" role="status">
            <h2>Reconnecting to Azure DevOps…</h2>
            {autoReload ? (
                <p style={MUTED}>This only takes a moment.</p>
            ) : (
                <>
                    <p style={MUTED}>
                        {reloadTried
                            ? "Azure DevOps is still giving this tab an expired sign-in, " +
                              `so reloading won't help. It will continue by itself ${reconnectEta(recoverAtMs, now)}.`
                            : "This usually fixes itself within a few minutes."}
                    </p>
                    {reloadTried ? null : (
                        <button
                            type="button"
                            className="emr-error-retry"
                            onClick={() => onReload()}
                        >
                            Reload page
                        </button>
                    )}
                    <p style={MUTED}>
                        <a
                            className="emr-error-link"
                            href={DEAD_WINDOW_ISSUE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Why this happens (known Azure DevOps issue)
                        </a>
                    </p>
                </>
            )}
        </div>
    );
}

export function BootErrorView({
    error,
    onRetry,
}: Readonly<{
    error: string;
    onRetry: () => void;
}>): ReactElement {
    return (
        <div className="emr-error">
            <h2>Something went wrong</h2>
            <pre>{error}</pre>
            <button type="button" className="emr-error-retry" onClick={() => onRetry()}>
                Try again
            </button>
        </div>
    );
}

/**
 * A PR whose changes include no Markdown files (about 2% of PR-tab opens): say
 * so, and offer the rest of the repository's documents instead of a dead end.
 */
export function NoMarkdownFilesView({
    onBrowseDocuments,
}: Readonly<{ onBrowseDocuments: () => void }>): ReactElement {
    return (
        <div className="emr-error" style={MUTED}>
            <h2>No Markdown files changed in this PR</h2>
            <p>
                This tab shows the pull request&apos;s .md files. Switch to the Files tab for the
                rest, or read this repository&apos;s documents.
            </p>
            <button type="button" className="emr-error-retry" onClick={() => onBrowseDocuments()}>
                Browse repository documents
            </button>
        </div>
    );
}

/**
 * The PR tab's file-list title, with a quiet way into the Documents hub for
 * every other document in the repository.
 */
export function PrDocNavTitle({
    onOpenDocuments,
}: Readonly<{ onOpenDocuments: () => void }>): ReactElement {
    return (
        <>
            <span className="emr-docnav-title">Documents</span>
            <button
                type="button"
                className="emr-icon-btn"
                title="Open all of this repository's documents (new tab)"
                aria-label="Open all of this repository's documents in a new tab"
                onClick={() => onOpenDocuments()}
            >
                <OpenElsewhereIcon />
            </button>
        </>
    );
}
