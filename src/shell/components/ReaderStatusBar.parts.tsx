// Status-bar control groups: navigation, comparison, comments, refresh.

import type { ReactElement } from "react";

import { formatNumber, t, tRich } from "../../i18n";
import type { ReviewIterationRange, WordDeltaPart } from "../shellHelpers";
import type { StatusBarVisibility } from "./readerStatusBarModel";
import type { ReaderStatusBarProps } from "./ReaderStatusBar.types";
import {
    IconNav,
    IconComments,
    IconChanges,
    IconChevron,
    StatusBarSeparator,
    IconOutline,
    IconPullRequest,
    IconFeedback,
    IconRefresh,
} from "./ReaderStatusBar.icons";
import { IterationPicker } from "./IterationPicker";

/**
 * Opt-in toggle for the heading outline under the open document in the
 * navigation panel. Only offered while that panel is shown.
 */
function OutlineToggle(
    props: Readonly<{
        navToggleable: boolean;
        navShown: boolean;
        shown: boolean;
        onToggle: (() => void) | undefined;
    }>,
): ReactElement | null {
    const { navToggleable, navShown, shown, onToggle } = props;
    if (!navToggleable || !navShown || !onToggle) return null;

    return (
        <button
            type="button"
            className="emr-statusbar-btn emr-statusbar-outline is-toggle"
            aria-pressed={shown}
            title={
                shown
                    ? t("navigation.statusBar.hideOutline")
                    : t("navigation.statusBar.showOutline")
            }
            onClick={onToggle}
        >
            <IconOutline />
            <span className="emr-sr-only">{t("navigation.statusBar.outline")}</span>
        </button>
    );
}

interface CommentStepperProps {
    threadIds: readonly string[];
    activeThreadId: string | null;
    onCycle: (threadId: string) => void;
}

function CommentStepper({
    threadIds,
    activeThreadId,
    onCycle,
}: Readonly<CommentStepperProps>): ReactElement {
    const total = threadIds.length;

    const activeIndex = hasText(activeThreadId) ? threadIds.indexOf(activeThreadId) : -1;

    const cycle = (direction: -1 | 1) => {
        const nextIndex =
            activeIndex < 0
                ? direction < 0
                    ? total - 1
                    : 0
                : (activeIndex + direction + total) % total;

        onCycle(threadIds[nextIndex]!);
    };

    return (
        <div
            className="emr-statusbar-comment-stepper"
            aria-label={t("navigation.statusBar.commentNavigation")}
        >
            <button
                type="button"
                className="emr-statusbar-comment-step"
                title={t("navigation.statusBar.previousComment")}
                aria-label={t("navigation.statusBar.previousComment")}
                onClick={() => cycle(-1)}
            >
                <IconChevron direction="left" />
            </button>
            <span
                className="emr-statusbar-comment-count"
                aria-live="polite"
                aria-label={
                    activeIndex >= 0
                        ? t("navigation.statusBar.commentOf", {
                              index: activeIndex + 1,
                              total,
                          })
                        : t("navigation.statusBar.commentCount", { count: total })
                }
            >
                <span className="emr-statusbar-comment-count-sizer" aria-hidden="true">
                    {total} / {total}
                </span>
                <span className="emr-statusbar-comment-count-value">
                    {activeIndex >= 0 ? activeIndex + 1 : "—"} / {total}
                </span>
            </span>
            <button
                type="button"
                className="emr-statusbar-comment-step"
                title={t("navigation.statusBar.nextComment")}
                aria-label={t("navigation.statusBar.nextComment")}
                onClick={() => cycle(1)}
            >
                <IconChevron direction="right" />
            </button>
        </div>
    );
}

/** Document-position status: the word count and the PR word-count delta. */
function WordStatus({
    wordCount,
    hasCount,
    deltaParts,
}: Readonly<{
    wordCount: number | undefined;
    hasCount: boolean;
    deltaParts: readonly WordDeltaPart[];
}>): ReactElement {
    return (
        <div className="emr-statusbar-status">
            {hasCount ? (
                <span className="emr-statusbar-words">
                    {tRich("navigation.statusBar.wordCount", {
                        count: wordCount!,
                        words: <b>{formatNumber(wordCount!)}</b>,
                    })}
                </span>
            ) : null}
            {deltaParts.length > 0 ? (
                <span className="emr-statusbar-delta">
                    {deltaParts.map((part) => (
                        <span
                            key={part.kind}
                            className={
                                part.kind === "added"
                                    ? "emr-statusbar-delta-add"
                                    : "emr-statusbar-delta-rem"
                            }
                            aria-label={part.a11y}
                        >
                            {part.label}
                        </span>
                    ))}
                </span>
            ) : null}
        </div>
    );
}

/** PR-comparison controls: the update picker and the Changes toggle. */
function ContextControls(
    props: Readonly<{
        showIterationPicker: boolean;
        iterationOptions: ReaderStatusBarProps["iterationOptions"];
        iterationBaseCommit: string | undefined;
        iterationRange: ReviewIterationRange | undefined;
        onIterationRangeChange: ReaderStatusBarProps["onIterationRangeChange"];
        changesAvailable: boolean;
        changesShown: boolean;
        onToggleChanges: () => void;
    }>,
): ReactElement {
    const { changesAvailable, changesShown, onToggleChanges } = props;

    return (
        <div className="emr-statusbar-context-controls">
            {props.showIterationPicker ? (
                <IterationPicker
                    options={props.iterationOptions!}
                    baseCommit={props.iterationBaseCommit}
                    range={props.iterationRange!}
                    onChange={props.onIterationRangeChange!}
                />
            ) : null}
            {changesAvailable ? (
                <button
                    type="button"
                    className="emr-statusbar-btn emr-statusbar-changes is-toggle"
                    aria-pressed={changesShown}
                    title={
                        changesShown
                            ? t("navigation.statusBar.hideChanges")
                            : t("navigation.statusBar.showChanges")
                    }
                    onClick={onToggleChanges}
                >
                    <IconChanges />
                    <span className="emr-sr-only">{t("navigation.statusBar.changes")}</span>
                </button>
            ) : null}
        </div>
    );
}

/** Left side: Navigation / Outline toggles, comparison controls, status. */
export function StatusBarLeft({
    props,
    visibility,
}: Readonly<{
    props: ReaderStatusBarProps;
    visibility: StatusBarVisibility;
}>): ReactElement {
    const { navToggleable, showNav } = props;

    const { hasCount, deltaParts, showIterationPicker, showContextControls } = visibility;

    const hasStatus = hasCount || deltaParts.length > 0;

    return (
        <div className="emr-statusbar-left">
            {navToggleable ? (
                <button
                    type="button"
                    className="emr-statusbar-btn is-toggle"
                    aria-pressed={showNav}
                    title={
                        showNav
                            ? t("navigation.statusBar.hideNavigation")
                            : t("navigation.statusBar.showNavigation")
                    }
                    onClick={props.onToggleNav}
                >
                    <IconNav />
                    <span className="emr-statusbar-btn-label">
                        {t("navigation.statusBar.navigation")}
                    </span>
                </button>
            ) : null}
            <OutlineToggle
                navToggleable={navToggleable}
                navShown={showNav}
                shown={props.showOutline === true}
                onToggle={props.onToggleOutline}
            />
            {navToggleable && (showContextControls || hasStatus) ? <StatusBarSeparator /> : null}
            {showContextControls ? (
                <ContextControls
                    showIterationPicker={showIterationPicker}
                    iterationOptions={props.iterationOptions}
                    iterationBaseCommit={props.iterationBaseCommit}
                    iterationRange={props.iterationRange}
                    onIterationRangeChange={props.onIterationRangeChange}
                    changesAvailable={props.changesAvailable}
                    changesShown={props.changesShown}
                    onToggleChanges={props.onToggleChanges}
                />
            ) : null}
            {showContextControls && hasStatus ? <StatusBarSeparator /> : null}

            <WordStatus wordCount={props.wordCount} hasCount={hasCount} deltaParts={deltaParts} />
        </div>
    );
}

/** Badge linking the latest completed PR for the open Documents Hub file. */
function ResolvedPullRequestBadge({
    pullRequest,
}: {
    pullRequest: ReaderStatusBarProps["resolvedPullRequest"];
}): ReactElement | null {
    if (!pullRequest) return null;

    const label = t("navigation.statusBar.latestCompletedPr", {
        prId: pullRequest.prId,
        title: pullRequest.title,
    });

    const content = (
        <>
            <IconPullRequest />
            <span>{t("navigation.pr.number", { prId: pullRequest.prId })}</span>
        </>
    );

    return hasText(pullRequest.url) ? (
        <a
            className="emr-statusbar-resolved-pr"
            href={pullRequest.url}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            aria-label={label}
        >
            {content}
        </a>
    ) : (
        <span className="emr-statusbar-resolved-pr" title={label} aria-label={label}>
            {content}
        </span>
    );
}

/** Comment stepper, Comments toggle, and the resolved-PR badge. */
export function CommentControls({
    props,
    showCommentStepper,
}: Readonly<{
    props: ReaderStatusBarProps;
    showCommentStepper: boolean;
}>): ReactElement {
    const { showComments } = props;

    return (
        <>
            <div className="emr-statusbar-control-group emr-statusbar-comment-controls">
                {showCommentStepper ? (
                    <CommentStepper
                        threadIds={props.commentThreadIds!}
                        activeThreadId={props.activeCommentThreadId ?? null}
                        onCycle={props.onCycleComment!}
                    />
                ) : null}
                <button
                    type="button"
                    className="emr-statusbar-btn is-toggle"
                    aria-pressed={showComments}
                    title={
                        showComments
                            ? t("navigation.statusBar.hideComments")
                            : t("navigation.statusBar.showComments")
                    }
                    onClick={props.onToggleComments}
                >
                    <IconComments />
                    <span className="emr-statusbar-btn-label">{t("common.comments")}</span>
                </button>
                <ResolvedPullRequestBadge pullRequest={props.resolvedPullRequest} />
            </div>
            <StatusBarSeparator />
        </>
    );
}

/** Refresh and Feedback controls, after a separator; nothing when neither. */
export function RefreshFeedbackControls({
    onRefresh,
    refreshing,
    refreshLabel,
    feedbackHref,
}: Readonly<
    Pick<ReaderStatusBarProps, "onRefresh" | "refreshing" | "refreshLabel" | "feedbackHref">
>): ReactElement | null {
    if (!onRefresh && !hasText(feedbackHref)) return null;
    const label = refreshLabel ?? t("common.refresh");

    return (
        <>
            <StatusBarSeparator />
            <div className="emr-statusbar-control-group">
                {onRefresh ? (
                    <button
                        type="button"
                        className={`emr-statusbar-btn emr-statusbar-refresh${refreshing ? " is-refreshing" : ""}`}
                        onClick={onRefresh}
                        disabled={refreshing}
                        title={label}
                        aria-label={label}
                    >
                        <IconRefresh />
                    </button>
                ) : null}
                {hasText(feedbackHref) ? (
                    <a
                        className="emr-statusbar-btn emr-statusbar-feedback"
                        href={feedbackHref}
                        // The extension runs in a sandboxed ADO iframe, which blocks a
                        // same-frame `mailto:` navigation; open in a new browsing context
                        // so the OS mail handler launches.
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t("navigation.statusBar.feedback")}
                        aria-label={t("navigation.statusBar.feedback")}
                    >
                        <IconFeedback />
                    </a>
                ) : null}
            </div>
        </>
    );
}

function hasText(value: string | null | undefined): value is string {
    return value != null && value !== "";
}
