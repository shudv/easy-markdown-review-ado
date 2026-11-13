// Shell article column: the document, or its load error / skeleton / absent notice.

import type { ReactElement, ReactNode } from "react";

import { t, tRich } from "../../i18n";
import { ArticleSkeleton } from "./Skeletons";

interface ArticleColumnProps {
    hideDocNav: boolean | undefined;
    selectedPath: string;
    /** The live document's load error. */
    error: string | null;
    loading: boolean;
    pristineHtml: string;
    absentNotice: { title: string; body: string } | null;
    onShowAllUpdates: () => void;
    historicalLoadError: string | undefined;
    historicalLoading: boolean;
    /** The ArticleView shown once the document is ready. */
    children: ReactNode;
}

/**
 * The article column. Per-file loading + render errors are scoped here (and
 * the comment rail) so switching files never blanks the whole shell — only the
 * middle + rail swap to a subtle skeleton while the next file streams in. The
 * nav rail is a left sibling.
 */
export function ArticleColumn(props: Readonly<ArticleColumnProps>): ReactElement {
    return (
        <div className={`emr-grid${props.hideDocNav ? " emr-grid--no-nav" : ""}`}>
            <ArticleColumnContent {...props} />
        </div>
    );
}

function ArticleColumnContent(props: Readonly<ArticleColumnProps>): ReactNode {
    const { selectedPath, absentNotice } = props;

    if (props.error !== null) {
        return (
            <div className="emr-article-wrap">
                <div className="emr-error">
                    <h2>{t("shell.article.openFailed.title")}</h2>
                    <p>
                        {tRich("shell.article.openFailed.body", {
                            path: <code>{selectedPath}</code>,
                        })}
                    </p>
                    <pre>{props.error}</pre>
                </div>
            </div>
        );
    }

    if (props.loading && !props.pristineHtml) return <ArticleSkeleton />;

    if (absentNotice) {
        return (
            <div className="emr-article-wrap">
                <div className="emr-update-absent" role="status">
                    <h2>{absentNotice.title}</h2>
                    <p>
                        {tRich("shell.article.absent.body", {
                            path: <code>{selectedPath}</code>,
                            reason: absentNotice.body,
                        })}
                    </p>
                    <button
                        type="button"
                        className="emr-update-absent-action"
                        onClick={props.onShowAllUpdates}
                    >
                        {t("shell.article.showAllUpdates")}
                    </button>
                </div>
            </div>
        );
    }

    if (props.historicalLoadError !== undefined) {
        return (
            <div className="emr-article-wrap">
                <div className="emr-error">
                    <h2>{t("shell.article.versionFailed.title")}</h2>
                    <p>
                        {tRich("shell.article.versionFailed.body", {
                            path: <code>{selectedPath}</code>,
                        })}
                    </p>
                    <pre>{props.historicalLoadError}</pre>
                </div>
            </div>
        );
    }

    if (props.historicalLoading) return <ArticleSkeleton />;

    return props.children;
}
