// Flat DocNav search-results list shown while the file finder is active.

import { type ReactElement, useContext } from "react";

import { t } from "../../i18n";
import type { FileInfo } from "../../types";
import {
    ChangeIndicatorContext,
    RangeChangesContext,
    fileChangeView,
    basename,
    changeNoteSuffix,
    changeTypeGlyph,
    withChangeNote,
} from "./DocNav.model";
import { SvgInfo } from "./DocNav.icons";

/**
 * Map an `AlmSearchError.kind` to a short user-facing string for the
 * "search unavailable" banner.
 */
function unavailableMessage(reason: string): string {
    switch (reason) {
        case "extension-missing":
            return t("navigation.docNav.searchUnavailable.extensionMissing");
        case "auth":
            return t("navigation.docNav.searchUnavailable.auth");
        case "network":
            return t("navigation.docNav.searchUnavailable.network");
        case "bad-request":
            return t("navigation.docNav.searchUnavailable.badRequest");
        case "no-config":
            return t("navigation.docNav.searchUnavailable.noConfig");
        default:
            return t("navigation.docNav.searchUnavailable.other");
    }
}

// ---------------------------------------------------------------------------
// SearchResultsList — flat results renderer used while searching. Mirrors the
// file-row template but omits the heading sub-tree.
// ---------------------------------------------------------------------------

interface SearchResultsListProps {
    results: ReadonlyArray<FileInfo>;
    loading: boolean;
    query: string;
    /**
     * Non-null when the most recent remote search call returned a
     * `kind: "unavailable"` outcome. Surfaces a small inline banner
     * above the local results so the user knows why the remote search
     * isn't contributing matches.
     */
    unavailable: { reason: string; message?: string } | null;
    selectedPath: string;
    threadCountsByPath: Record<string, number>;
    onSelectFile: (path: string) => void;
}

// eslint-disable-next-line max-lines-per-function -- Navigation search results: result rows with keyboard selection and ARIA listbox semantics in one list.
export function SearchResultsList(props: Readonly<SearchResultsListProps>): ReactElement {
    const { results, loading, query, unavailable, selectedPath, threadCountsByPath, onSelectFile } =
        props;

    const showChangeIndicators = useContext(ChangeIndicatorContext);
    const rangeChanges = useContext(RangeChangesContext);

    const banner = unavailable ? (
        <div
            className="emr-docnav-search-unavailable"
            role="status"
            aria-live="polite"
            title={unavailable.message ?? undefined}
        >
            <SvgInfo />
            <span>{unavailableMessage(unavailable.reason)}</span>
        </div>
    ) : null;

    if (results.length === 0) {
        return (
            <>
                {banner}
                <div className="emr-docnav-search-empty">
                    {loading
                        ? t("navigation.docNav.searchingQuery", { query })
                        : query.length < 2
                          ? t("navigation.docNav.queryTooShort")
                          : t("navigation.docNav.noFilesMatch", { query })}
                </div>
            </>
        );
    }

    return (
        <>
            {banner}
            {loading ? (
                <div className="emr-docnav-search-status" aria-live="polite">
                    {t("navigation.docNav.searchingRepo")}
                </div>
            ) : null}
            {results.map((file) => {
                const isActive = file.path === selectedPath;
                const fileName = basename(file.path);

                const parentPath = file.path.replace(/^\/+/, "").replace(/\/[^/]*$/, "");

                const openComments = threadCountsByPath[file.path] ?? 0;
                const change = fileChangeView(file, rangeChanges);
                const note = change.note ?? "";

                return (
                    <div
                        key={`search:${file.path}`}
                        className={`emr-docnav-item emr-docnav-search-result${
                            isActive ? " is-active" : ""
                        }${change.unchanged ? " is-unchanged-in-range" : ""}`}
                        data-change-type={change.changeType}
                    >
                        <button
                            type="button"
                            className="emr-docnav-label emr-docnav-search-label"
                            onClick={() => onSelectFile(file.path)}
                            title={withChangeNote(file.path, note)}
                        >
                            {showChangeIndicators ? (
                                <span
                                    className={`emr-docnav-file-icon is-${change.changeType}`}
                                    aria-hidden
                                >
                                    {changeTypeGlyph(change.changeType)}
                                </span>
                            ) : null}
                            <span className="emr-docnav-search-name">{fileName}</span>
                            {note !== "" ? (
                                <span className="emr-sr-only">{changeNoteSuffix(note)}</span>
                            ) : null}
                            {parentPath ? (
                                <span className="emr-docnav-search-path" title={parentPath}>
                                    {parentPath}
                                </span>
                            ) : /* v8 ignore next -- the parent path is empty only for an empty or slash-only path, and search results always name a file */ null}
                            {openComments > 0 ? (
                                <span
                                    className="emr-docnav-badge is-open"
                                    aria-label={t("navigation.docNav.openCommentsBadge", {
                                        count: openComments,
                                    })}
                                >
                                    {openComments}
                                </span>
                            ) : null}
                        </button>
                    </div>
                );
            })}
        </>
    );
}
