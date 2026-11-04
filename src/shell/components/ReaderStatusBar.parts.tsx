// Status-bar control groups: navigation, comparison, comments, refresh.

import * as React from "react";

import type { ReviewIterationRange, WordDeltaPart } from "../prShellHelpers";
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
function OutlineToggle(props: {
  navToggleable: boolean;
  navShown: boolean;
  shown: boolean;
  onToggle: (() => void) | undefined;
}): React.ReactElement | null {
  const { navToggleable, navShown, shown, onToggle } = props;
  if (!navToggleable || !navShown || !onToggle) return null;
  return (
    <button
      type="button"
      className="emr-statusbar-btn emr-statusbar-outline is-toggle"
      aria-pressed={shown}
      title={
        shown
          ? "Hide the document outline in the navigation"
          : "Show the document outline in the navigation"
      }
      onClick={onToggle}
    >
      <IconOutline />
      <span className="emr-sr-only">Outline</span>
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
}: CommentStepperProps): React.ReactElement {
  const total = threadIds.length;
  const activeIndex = activeThreadId ? threadIds.indexOf(activeThreadId) : -1;
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
      aria-label="Comment navigation"
    >
      <button
        type="button"
        className="emr-statusbar-comment-step"
        title="Previous comment"
        aria-label="Previous comment"
        onClick={() => cycle(-1)}
      >
        <IconChevron direction="left" />
      </button>
      <span
        className="emr-statusbar-comment-count"
        aria-live="polite"
        aria-label={
          activeIndex >= 0
            ? `Comment ${activeIndex + 1} of ${total}`
            : `${total} comments`
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
        title="Next comment"
        aria-label="Next comment"
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
}: {
  wordCount: number | undefined;
  hasCount: boolean;
  deltaParts: readonly WordDeltaPart[];
}): React.ReactElement {
  return (
    <div className="emr-statusbar-status">
      {hasCount ? (
        <span className="emr-statusbar-words">
          <b>{wordCount!.toLocaleString()}</b> words
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
function ContextControls(props: {
  showIterationPicker: boolean;
  iterationOptions: ReaderStatusBarProps["iterationOptions"];
  iterationBaseCommit: string | undefined;
  iterationRange: ReviewIterationRange | undefined;
  onIterationRangeChange: ReaderStatusBarProps["onIterationRangeChange"];
  changesAvailable: boolean;
  changesShown: boolean;
  onToggleChanges: () => void;
}): React.ReactElement {
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
              ? "Hide the change highlights"
              : "Show what changed in this pull request"
          }
          onClick={onToggleChanges}
        >
          <IconChanges />
          <span className="emr-sr-only">Changes</span>
        </button>
      ) : null}
    </div>
  );
}

/** Left side: Navigation / Outline toggles, comparison controls, status. */
export function StatusBarLeft({
  props,
  visibility,
}: {
  props: ReaderStatusBarProps;
  visibility: StatusBarVisibility;
}): React.ReactElement {
  const { navToggleable, showNav } = props;
  const { hasCount, deltaParts, showIterationPicker, showContextControls } =
    visibility;
  const hasStatus = hasCount || deltaParts.length > 0;
  return (
    <div className="emr-statusbar-left">
      {navToggleable ? (
        <button
          type="button"
          className="emr-statusbar-btn is-toggle"
          aria-pressed={showNav}
          title={showNav ? "Hide navigation" : "Show navigation"}
          onClick={props.onToggleNav}
        >
          <IconNav />
          <span className="emr-statusbar-btn-label">Navigation</span>
        </button>
      ) : null}
      <OutlineToggle
        navToggleable={navToggleable}
        navShown={showNav}
        shown={props.showOutline === true}
        onToggle={props.onToggleOutline}
      />
      {navToggleable && (showContextControls || hasStatus) ? (
        <StatusBarSeparator />
      ) : null}
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

      <WordStatus
        wordCount={props.wordCount}
        hasCount={hasCount}
        deltaParts={deltaParts}
      />
    </div>
  );
}

/** Badge linking the latest completed PR for the open Documents Hub file. */
function ResolvedPullRequestBadge({
  pullRequest,
}: {
  pullRequest: ReaderStatusBarProps["resolvedPullRequest"];
}): React.ReactElement | null {
  if (!pullRequest) return null;
  const label = `Latest completed PR for this file: #${pullRequest.prId} ${pullRequest.title}`;
  const content = (
    <>
      <IconPullRequest />
      <span>PR #{pullRequest.prId}</span>
    </>
  );
  return pullRequest.url ? (
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
    <span
      className="emr-statusbar-resolved-pr"
      title={label}
      aria-label={label}
    >
      {content}
    </span>
  );
}

/** Comment stepper, Comments toggle, and the resolved-PR badge. */
export function CommentControls({
  props,
  showCommentStepper,
}: {
  props: ReaderStatusBarProps;
  showCommentStepper: boolean;
}): React.ReactElement {
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
          title={showComments ? "Hide comments" : "Show comments"}
          onClick={props.onToggleComments}
        >
          <IconComments />
          <span className="emr-statusbar-btn-label">Comments</span>
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
}: Pick<
  ReaderStatusBarProps,
  "onRefresh" | "refreshing" | "refreshLabel" | "feedbackHref"
>): React.ReactElement | null {
  if (!onRefresh && !feedbackHref) return null;
  const label = refreshLabel ?? "Refresh";
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
        {feedbackHref ? (
          <a
            className="emr-statusbar-btn emr-statusbar-feedback"
            href={feedbackHref}
            // The extension runs in a sandboxed ADO iframe, which blocks a
            // same-frame `mailto:` navigation; open in a new browsing context
            // so the OS mail handler launches.
            target="_blank"
            rel="noopener noreferrer"
            title="Share feedback or report a bug"
            aria-label="Share feedback or report a bug"
          >
            <IconFeedback />
          </a>
        ) : null}
      </div>
    </>
  );
}
