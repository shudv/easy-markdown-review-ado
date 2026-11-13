// Leaf pieces of DocNav rows: chevrons, labels, and comment badges.

import type { ReactElement } from "react";

import { type MessageKey, t } from "../../i18n";
import { type NavHeading, type DirNavNode, basename } from "./DocNav.model";
import { SvgCaret, SvgFolder, SvgSpinner } from "./DocNav.icons";

/** A heading row's chevron: folds the doc section + nav children. */
export function HeadingTwist(
    props: Readonly<{
        collapsed: boolean;
        onToggle: () => void;
    }>,
): ReactElement {
    const { collapsed, onToggle } = props;

    return (
        <button
            type="button"
            className="emr-docnav-twist"
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            aria-label={collapsed ? t("common.expandSection") : t("common.collapseSection")}
            aria-expanded={!collapsed}
            title={collapsed ? t("common.expandSection") : t("common.collapseSection")}
            data-collapsed={collapsed ? "true" : undefined}
        >
            <SvgCaret />
        </button>
    );
}

/** Open-comment badge, else a resolved-comment badge; nothing when neither. */
export function HeadingCommentBadge(
    props: Readonly<{
        heading: NavHeading;
    }>,
): ReactElement | null {
    const { heading } = props;

    if (heading.openComments > 0) {
        return (
            <span
                className="emr-docnav-badge is-open"
                aria-label={t("navigation.docNav.openCommentsBadge", {
                    count: heading.openComments,
                })}
            >
                {heading.openComments}
            </span>
        );
    }

    if (heading.totalComments > 0) {
        return (
            <span
                className="emr-docnav-badge is-resolved"
                aria-label={t("navigation.docNav.resolvedCommentsBadge", {
                    count: heading.totalComments,
                })}
            >
                {heading.totalComments}
            </span>
        );
    }

    return null;
}

const DIR_TWIST_KEY = {
    folder: {
        expand: "navigation.docNav.expandFolder",
        collapse: "navigation.docNav.collapseFolder",
    },
    subpages: {
        expand: "navigation.docNav.expandSubpages",
        collapse: "navigation.docNav.collapseSubpages",
    },
} as const satisfies Record<"folder" | "subpages", Record<"expand" | "collapse", MessageKey>>;

/** Accessible name + tooltip for a folder row's chevron. */
export function dirTwistText(
    state: { lazy: boolean; loading: boolean; collapsed: boolean },
    noun: "folder" | "subpages",
): { label: string; title: string } {
    if (state.loading) {
        return { label: t("navigation.docNav.loadingFolderLabel"), title: t("common.loading") };
    }

    if (state.lazy) {
        return {
            label: t("navigation.docNav.loadFolder"),
            title: t("navigation.docNav.loadFolderTitle"),
        };
    }

    const text = t(DIR_TWIST_KEY[noun][state.collapsed ? "expand" : "collapse"]);

    return { label: text, title: text };
}

/**
 * A folder row's chevron: expands/collapses (or loads) the folder. An empty
 * folder has nothing to open, so it gets the chevron's space and no chevron.
 */
export function DirTwistButton(
    props: Readonly<{
        twist: { label: string; title: string };
        isEmpty: boolean;
        isCollapsed: boolean;
        isLoading: boolean;
        onToggle: () => void;
    }>,
): ReactElement {
    const { twist, isEmpty, isCollapsed, isLoading, onToggle } = props;
    if (isEmpty) return <span className="emr-docnav-twist-spacer" aria-hidden />;

    return (
        <button
            type="button"
            className="emr-docnav-twist"
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            aria-label={twist.label}
            aria-expanded={!isCollapsed}
            aria-busy={isLoading || undefined}
            title={twist.title}
            data-collapsed={isCollapsed ? "true" : undefined}
            disabled={isLoading}
        >
            {isLoading ? <SvgSpinner /> : <SvgCaret />}
        </button>
    );
}

/**
 * Label of a plain folder row: expands/collapses (or loads) the folder. An
 * empty folder's label opens nothing, and says so.
 */
export function DirFolderLabel(
    props: Readonly<{
        node: DirNavNode;
        isEmpty: boolean;
        isLazy: boolean;
        isLoading: boolean;
        isCollapsed: boolean;
        onToggle: () => void;
    }>,
): ReactElement {
    const { node, isEmpty, isLazy, isLoading, isCollapsed, onToggle } = props;

    return (
        <button
            type="button"
            className="emr-docnav-label emr-docnav-dir-label"
            onClick={onToggle}
            title={
                isEmpty ? t("navigation.docNav.emptyFolderTitle", { path: node.path }) : node.path
            }
            disabled={isLoading || isEmpty}
        >
            <span className="emr-docnav-file-icon emr-docnav-folder-icon" aria-hidden>
                <SvgFolder open={!isCollapsed} />
            </span>
            <span className="emr-docnav-item-text">{node.displayName}</span>
            {isLazy && !isLoading ? (
                <span className="emr-docnav-lazy-hint" aria-hidden>
                    …
                </span>
            ) : null}
        </button>
    );
}

/** Label of a page-with-subpages row: opens the page; shows its comments. */
export function WikiPageLabel(
    props: Readonly<{
        page: NonNullable<DirNavNode["page"]>;
        onOpen: () => void;
    }>,
): ReactElement {
    const { page, onOpen } = props;

    return (
        <button
            type="button"
            className="emr-docnav-label emr-docnav-page-label"
            onClick={onOpen}
            title={page.file.path}
        >
            <span className="emr-docnav-page-name">{basename(page.file.path)}</span>
            {page.openComments > 0 ? (
                <span
                    className="emr-docnav-badge is-open"
                    aria-label={t("navigation.docNav.openCommentsBadge", {
                        count: page.openComments,
                    })}
                >
                    {page.openComments}
                </span>
            ) : null}
        </button>
    );
}
