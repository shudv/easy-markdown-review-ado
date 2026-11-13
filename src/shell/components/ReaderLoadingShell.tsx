import type { CSSProperties, ReactElement, ReactNode } from "react";

import { t } from "../../i18n";
import type { DraftScope } from "../draftStorage";
import { ReaderActivityIndicator, type ReaderActivity } from "./readerActivity";
import {
    readReaderPrefs,
    readerSpacingValues,
    resolveReaderFont,
    widthScale,
} from "../readerPrefs";

interface ReaderLoadingShellProps {
    scope: DraftScope;
    ariaLabel: string;
    hideDocNav?: boolean;
    titleSlot?: ReactNode;
    headerActions?: ReactNode;
    /**
     * What the status bar says while loading; defaults to `ariaLabel` with a
     * spinner. A slow boot passes "Still loading…" with a "Try again" action.
     */
    activity?: ReaderActivity;
}

/** The settled reader geometry, filled with quiet placeholders during boot. */
// eslint-disable-next-line max-lines-per-function -- Boot skeleton: static placeholder markup that mirrors the reader layout so nothing shifts on load. No logic to extract.
export function ReaderLoadingShell({
    scope,
    ariaLabel,
    hideDocNav = false,
    titleSlot,
    headerActions,
    activity = { id: "boot", label: ariaLabel, priority: 100 },
}: Readonly<ReaderLoadingShellProps>): ReactElement {
    const prefs = readReaderPrefs(scope);
    const readerFont = resolveReaderFont(prefs.fontId);
    const readerSpacing = readerSpacingValues(prefs);

    const style = {
        "--emr-reader-font": readerFont.stack,
        "--emr-reader-scale": String(prefs.sizePct / 100),
        "--emr-reader-line-height": String(readerSpacing.lineHeight),
        "--emr-reader-letter-spacing": `${readerSpacing.letterSpacingEm}em`,
        "--emr-reader-word-spacing": `${readerSpacing.wordSpacingEm}em`,
        "--emr-reader-paragraph-spacing": `${readerSpacing.paragraphSpacingPx}px`,
        "--emr-nav-scale": String(widthScale(prefs.navWidthPct)),
        "--emr-rail-scale": String(widthScale(prefs.commentWidthPct)),
    } as CSSProperties;

    return (
        <div
            className={`emr-app emr-reader-loading-shell${
                prefs.showNav && !hideDocNav ? "" : " is-nav-hidden"
            }${prefs.showComments ? "" : " is-comments-hidden"}`}
            style={style}
            aria-label={ariaLabel}
            aria-busy="true"
        >
            <div className={`emr-body-frame${hideDocNav ? " emr-body-frame--no-nav" : ""}`}>
                {hideDocNav ? null : (
                    <div className="emr-body__nav">
                        <aside className="emr-docnav" aria-label={t("common.documentNavigation")}>
                            {hasSlotContent(titleSlot) || hasSlotContent(headerActions) ? (
                                <div className="emr-docnav-header">
                                    {titleSlot}
                                    {headerActions}
                                </div>
                            ) : (
                                <div
                                    className="emr-docnav-header emr-skel-header"
                                    aria-hidden="true"
                                >
                                    <div className="emr-skel-header-label emr-skel-w60" />
                                </div>
                            )}
                            <div className="emr-docnav-skel" aria-hidden="true">
                                <div className="emr-skel-line emr-skel-w80" />
                                <div className="emr-skel-line emr-skel-w60" />
                                <div className="emr-skel-line emr-skel-w70" />
                                <div className="emr-skel-line emr-skel-w50" />
                                <div className="emr-skel-line emr-skel-w65" />
                            </div>
                        </aside>
                    </div>
                )}

                <div className="emr-body">
                    <div className={`emr-grid${hideDocNav ? " emr-grid--no-nav" : ""}`}>
                        <div className="emr-article-wrap emr-skeleton" aria-hidden="true">
                            <div className="emr-skel-line emr-skel-title" />
                            <div className="emr-skel-line emr-skel-w90" />
                            <div className="emr-skel-line emr-skel-w75" />
                            <div className="emr-skel-line emr-skel-w85" />
                            <div className="emr-skel-block" />
                            <div className="emr-skel-line emr-skel-w80" />
                            <div className="emr-skel-line emr-skel-w60" />
                        </div>
                    </div>
                </div>

                <div className="emr-rail">
                    <div className="emr-rail-scroll">
                        <aside className="emr-rail-col emr-skeleton" aria-hidden="true">
                            <RailHeaderSkeleton />
                            <div className="emr-rail-skel-card" />
                            <div className="emr-rail-skel-card" />
                        </aside>
                    </div>
                </div>
            </div>
            <div className="emr-loading-statusbar">
                <ReaderActivityIndicator activity={activity} />
            </div>
        </div>
    );
}

/** Truthiness of a header slot, spelled out for each falsy ReactNode value. */
function hasSlotContent(node: ReactNode): boolean {
    return (
        node !== undefined &&
        node !== null &&
        node !== false &&
        node !== "" &&
        node !== 0 &&
        !Number.isNaN(node)
    );
}

function RailHeaderSkeleton(): ReactElement {
    return (
        <div className="emr-rail-header emr-skel-header">
            <div className="emr-rail-toolbar">
                <div className="emr-skel-header-label emr-skel-w50" />
            </div>
        </div>
    );
}
