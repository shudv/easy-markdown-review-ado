// Documents hub: the empty-state shell shown when a project has no repositories.

import type { ReactElement, ReactNode } from "react";

import { t, tRich } from "../i18n";
import { SvgRepo } from "./hubIcons";

/**
 * Empty-state shell shown when the selected repo holds no markdown. Keeps the
 * DocNav header (and its repo picker) live so the user can switch to another
 * repo, and replaces the article + rail with a friendly message.
 */
export function DocsEmptyShell({
    titleSlot,
    headerActions,
    repoName,
}: Readonly<{
    titleSlot?: ReactNode;
    headerActions?: ReactNode;
    repoName: string;
}>): ReactElement {
    return (
        <div className="emr-app emr-docs-empty-shell">
            <div className="emr-grid">
                <aside className="emr-docnav" aria-label={t("common.documentNavigation")}>
                    <div className="emr-docnav-header">
                        {titleSlot}
                        {headerActions}
                    </div>
                </aside>
                <div
                    className="emr-article-wrap emr-docs-empty"
                    role="status"
                    aria-label={t("hub.docsEmpty.label", { repo: repoName })}
                >
                    <div className="emr-docs-empty-card">
                        <SvgRepo />
                        <h2>{t("hub.docsEmpty.title")}</h2>
                        <p>
                            {tRich("hub.docsEmpty.body", {
                                repo: <strong>{repoName}</strong>,
                                ext: <code>.md</code>,
                            })}
                        </p>
                    </div>
                </div>
                <aside className="emr-rail-col" aria-hidden="true" />
            </div>
        </div>
    );
}
