// The PR tab's non-document states: reconnecting after an ADO token dead
// window, a boot failure, and a PR with no changed Markdown files.

import { type ReactElement, useEffect, useState } from "react";

import { t } from "../i18n";
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
    if (recoverAtMs === undefined) return t("hub.prTab.eta.fewMinutes");
    const minutes = Math.ceil((recoverAtMs - nowMs) / 60_000);

    return minutes <= 1
        ? t("hub.prTab.eta.oneMinute")
        : t("hub.prTab.eta.aboutMinutes", { count: minutes });
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
            <h2>{t("hub.prTab.reconnecting.title")}</h2>
            {autoReload ? (
                <p style={MUTED}>{t("hub.prTab.reconnecting.momentary")}</p>
            ) : (
                <>
                    <p style={MUTED}>
                        {reloadTried
                            ? t("hub.prTab.reconnecting.expiredSignIn", {
                                  eta: reconnectEta(recoverAtMs, now),
                              })
                            : t("hub.prTab.reconnecting.usuallyFixes")}
                    </p>
                    {reloadTried ? null : (
                        <button
                            type="button"
                            className="emr-error-retry"
                            onClick={() => onReload()}
                        >
                            {t("common.reloadPage")}
                        </button>
                    )}
                    <p style={MUTED}>
                        <a
                            className="emr-error-link"
                            href={DEAD_WINDOW_ISSUE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t("hub.prTab.reconnecting.why")}
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
            <h2>{t("common.somethingWentWrong")}</h2>
            <pre>{error}</pre>
            <button type="button" className="emr-error-retry" onClick={() => onRetry()}>
                {t("common.tryAgain")}
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
            <h2>{t("hub.prTab.noMarkdown.title")}</h2>
            <p>{t("hub.prTab.noMarkdown.body")}</p>
            <button type="button" className="emr-error-retry" onClick={() => onBrowseDocuments()}>
                {t("hub.prTab.noMarkdown.browse")}
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
            <span className="emr-docnav-title">{t("common.documents")}</span>
            <button
                type="button"
                className="emr-icon-btn"
                title={t("hub.prTab.openAllDocuments.title")}
                aria-label={t("hub.prTab.openAllDocuments.label")}
                onClick={() => onOpenDocuments()}
            >
                <OpenElsewhereIcon />
            </button>
        </>
    );
}
